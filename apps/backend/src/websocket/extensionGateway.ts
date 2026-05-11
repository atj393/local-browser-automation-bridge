import { WebSocket, WebSocketServer } from 'ws';
import type { Server as HttpServer } from 'node:http';
import type {
  WsBaseMessage,
  GenerateNextBatchPayload,
  GenerateNextBatchResultPayload,
  PostToWriterPayload,
  PostToWriterResultPayload,
  TabRoleAvailablePayload,
  TabRoleRemovedPayload,
  TabRoleCandidatePayload,
  ExtensionConnectionStatus,
  TabConnectionStatus,
  TabReadiness,
} from '@lbab/shared';
import { CONTENT_READY_TTL_MS, TIMEOUTS, WS_PATH } from '@lbab/shared';
import { requestRegistry } from './requestRegistry.js';
import { logService } from '../services/logService.js';
import { newRequestId } from '../utils/ids.js';

interface TabState {
  tabId: number | null;
  url: string | null;
  /** True after CONTENT_READY/TAB_ROLE_AVAILABLE; false after TAB_ROLE_CANDIDATE. */
  contentScriptReady: boolean;
  lastSeenAt: number | null;
  lastError: string | null;
}

function emptyTabState(): TabState {
  return { tabId: null, url: null, contentScriptReady: false, lastSeenAt: null, lastError: null };
}

class ExtensionGateway {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private extensionLastSeenAt: number | null = null;
  private writer: TabState = emptyTabState();
  private reader: TabState = emptyTabState();

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: WS_PATH });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    logService.info('WebSocket gateway listening', { path: WS_PATH });
  }

  private onConnection(ws: WebSocket): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      logService.warn('A second extension is connecting; replacing previous connection.');
      try {
        this.socket.close(1000, 'Replaced by new extension connection');
      } catch {
        // ignore
      }
    }
    this.socket = ws;
    this.extensionLastSeenAt = Date.now();
    logService.info('Extension connected.');

    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('close', () => this.onClose());
    ws.on('error', (err) => {
      logService.warn('WebSocket error', { error: String(err) });
    });

    // After a backend restart, the extension may already have ready
    // tabs but we (the backend) lost that state. Ask it to rediscover
    // and re-announce them so the dashboard recovers without a manual
    // tab refresh.
    setTimeout(() => this.requestRediscovery('backend-startup'), 50);
  }

  private onClose(): void {
    if (this.socket) {
      logService.info('Extension disconnected.');
    }
    this.socket = null;
    // Mark tabs as not-ready but keep the URLs so the dashboard can show
    // "previously connected" rather than wiping everything.
    this.writer.contentScriptReady = false;
    this.reader.contentScriptReady = false;
    requestRegistry.rejectAll('Extension disconnected before responding.');
  }

  private onMessage(raw: string): void {
    let msg: WsBaseMessage | null = null;
    try {
      msg = JSON.parse(raw) as WsBaseMessage;
    } catch {
      logService.warn('Received non-JSON ws message.');
      return;
    }
    if (!msg || typeof msg !== 'object' || !msg.type) {
      logService.warn('Received malformed ws message.');
      return;
    }
    this.extensionLastSeenAt = Date.now();
    switch (msg.type) {
      case 'REGISTER_EXTENSION':
        this.send({
          type: 'REGISTER_EXTENSION_ACK',
          requestId: msg.requestId,
          payload: { ok: true },
        });
        logService.info('Extension registered.', msg.payload);
        // Ask the extension to re-scan tabs so we recover after a
        // backend restart even when the extension's WS reconnected
        // before this onConnection ran.
        this.requestRediscovery('register-extension');
        break;
      case 'TAB_ROLE_AVAILABLE': {
        const p = msg.payload as TabRoleAvailablePayload;
        const target = p.role === 'writer' ? this.writer : this.reader;
        target.tabId = p.tabId;
        target.url = p.url;
        target.contentScriptReady = true;
        target.lastSeenAt = Date.now();
        target.lastError = null;
        logService.info(`Tab role available: ${p.role}`, p);
        break;
      }
      case 'TAB_ROLE_CANDIDATE': {
        const p = msg.payload as TabRoleCandidatePayload;
        const target = p.role === 'writer' ? this.writer : this.reader;
        target.tabId = p.tabId;
        target.url = p.url;
        target.contentScriptReady = false;
        target.lastError = p.error ?? 'Content script not responding';
        // Don't bump lastSeenAt — we don't have a live content script.
        logService.warn(`Tab role candidate (content script not ready): ${p.role}`, p);
        break;
      }
      case 'TAB_ROLE_REMOVED': {
        const p = msg.payload as TabRoleRemovedPayload;
        const target = p.role === 'writer' ? this.writer : this.reader;
        if (target.tabId === p.tabId) {
          target.tabId = null;
          target.url = null;
          target.contentScriptReady = false;
        }
        logService.info(`Tab role removed: ${p.role}`, p);
        break;
      }
      case 'GENERATE_NEXT_BATCH_RESULT':
      case 'POST_TO_WRITER_RESULT': {
        const accepted = requestRegistry.resolve(msg.requestId, msg.payload);
        if (!accepted) {
          // Duplicate / late response — pending entry already settled or timed out.
          logService.warn('Duplicate post result ignored.', {
            type: msg.type,
            requestId: msg.requestId,
            payload: msg.payload,
          });
        }
        break;
      }
      case 'PONG':
        break;
      default:
        logService.debug('Unknown ws message', msg);
    }
  }

  private send(message: WsBaseMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Ask the extension to rediscover reader/writer tabs. */
  requestRediscovery(reason: string): void {
    this.send({
      type: 'REDISCOVER_TABS',
      requestId: 'rediscover-' + Date.now(),
      payload: { reason },
    });
  }

  isConnected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  /** A tab is "live" only when content script ready AND heartbeat fresh. */
  private isTabLive(state: TabState): boolean {
    if (!state.contentScriptReady || state.tabId == null) return false;
    if (state.lastSeenAt == null) return false;
    return Date.now() - state.lastSeenAt < CONTENT_READY_TTL_MS;
  }

  hasWriter(): boolean {
    return this.isTabLive(this.writer);
  }
  hasReader(): boolean {
    return this.isTabLive(this.reader);
  }

  /** Detailed status for the dashboard. */
  getStatus(): {
    extension: ExtensionConnectionStatus;
    reader: TabConnectionStatus;
    writer: TabConnectionStatus;
  } {
    return {
      extension: this.buildExtensionStatus(),
      reader: this.buildTabStatus('reader', this.reader),
      writer: this.buildTabStatus('writer', this.writer),
    };
  }

  private buildExtensionStatus(): ExtensionConnectionStatus {
    const connected = this.isConnected();
    const lastSeenAt = this.extensionLastSeenAt
      ? new Date(this.extensionLastSeenAt).toISOString()
      : null;
    const stale = connected
      ? this.extensionLastSeenAt != null &&
        Date.now() - this.extensionLastSeenAt > CONTENT_READY_TTL_MS
      : false;
    let message: string;
    if (!connected) {
      message = 'Extension is not connected. Make sure the extension is loaded in Chrome.';
    } else if (stale) {
      message = 'Extension is connected but has been quiet for a while.';
    } else {
      message = 'Extension is connected.';
    }
    return { connected, lastSeenAt, stale, message };
  }

  private buildTabStatus(
    role: 'reader' | 'writer',
    state: TabState,
  ): TabConnectionStatus {
    const lastSeenIso = state.lastSeenAt ? new Date(state.lastSeenAt).toISOString() : null;
    const live = this.isTabLive(state);
    const stale =
      state.contentScriptReady &&
      state.lastSeenAt != null &&
      Date.now() - state.lastSeenAt >= CONTENT_READY_TTL_MS;

    let readiness: TabReadiness;
    let message: string;
    const roleLabel = role === 'reader' ? 'Reader' : 'Writer';

    if (!this.isConnected()) {
      readiness = 'disconnected';
      message = `${roleLabel} tab is not connected. Extension is offline.`;
    } else if (live) {
      readiness = 'ready';
      message = `${roleLabel} tab is connected.`;
    } else if (stale) {
      readiness = 'stale';
      message = `${roleLabel} tab was previously connected but heartbeat is stale. The extension is trying to rediscover it.`;
    } else if (state.tabId != null && state.url) {
      // URL matched but content script never reported ready / dropped ready.
      readiness = 'url-found';
      message = `${roleLabel} tab found but content script is not responding. Refresh the tab if this does not recover automatically.`;
    } else {
      readiness = 'disconnected';
      message =
        role === 'reader'
          ? 'Reader tab is not connected. Open Gemini or http://localhost:4000/test/llm.'
          : 'Writer tab is not connected. Open X.com or http://localhost:4000/test/writer.';
    }

    return {
      readiness,
      connected: readiness === 'ready',
      stale,
      url: state.url,
      lastSeenAt: lastSeenIso,
      message,
    };
  }

  async generateNextBatch(payload: GenerateNextBatchPayload): Promise<GenerateNextBatchResultPayload> {
    if (!this.isConnected()) {
      throw new Error('Extension is not connected.');
    }
    if (!this.hasReader()) {
      // Try to recover before failing the user: ask the extension to
      // rediscover and give it a brief window to respond.
      this.requestRediscovery('generateNextBatch-no-reader');
      await this.waitForReader(2000);
      if (!this.hasReader()) {
        throw new Error(
          'Reader tab is not ready. Open Gemini or the local LLM test page and refresh the page if this persists.',
        );
      }
    }
    const requestId = newRequestId();
    const promise = requestRegistry.create<GenerateNextBatchResultPayload>(
      requestId,
      TIMEOUTS.generateBatchMs,
      'Timed out waiting for Gemini response.',
    );
    this.send({ type: 'GENERATE_NEXT_BATCH', requestId, payload });
    return promise;
  }

  async postToWriter(payload: PostToWriterPayload): Promise<PostToWriterResultPayload> {
    if (!this.isConnected()) {
      throw new Error('Extension is not connected.');
    }
    if (!this.hasWriter()) {
      this.requestRediscovery('postToWriter-no-writer');
      await this.waitForWriter(2000);
      if (!this.hasWriter()) {
        throw new Error(
          'Writer tab is not ready. Open X.com/home or the local writer test page and refresh the page if this persists.',
        );
      }
    }
    const requestId = newRequestId();
    const promise = requestRegistry.create<PostToWriterResultPayload>(
      requestId,
      TIMEOUTS.postToWriterMs,
      'Timed out waiting for writer tab to respond.',
    );
    logService.info('[backend] POST_TO_WRITER dispatch', {
      postId: payload.postId,
      operationId: payload.operationId,
      autoSubmitWriter: payload.autoSubmit,
      requestId,
    });
    this.send({ type: 'POST_TO_WRITER', requestId, payload });
    return promise;
  }

  private waitForReader(timeoutMs: number): Promise<void> {
    return this.waitFor(() => this.hasReader(), timeoutMs);
  }

  private waitForWriter(timeoutMs: number): Promise<void> {
    return this.waitFor(() => this.hasWriter(), timeoutMs);
  }

  private waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = (): void => {
        if (check()) return resolve();
        if (Date.now() - start >= timeoutMs) return resolve();
        setTimeout(tick, 100);
      };
      tick();
    });
  }
}

export const extensionGateway = new ExtensionGateway();
