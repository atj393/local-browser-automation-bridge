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
} from '@lbab/shared';
import { TIMEOUTS, WS_PATH } from '@lbab/shared';
import { requestRegistry } from './requestRegistry.js';
import { logService } from '../services/logService.js';
import { newRequestId } from '../utils/ids.js';

class ExtensionGateway {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private writerTabId: number | null = null;
  private readerTabId: number | null = null;
  private writerUrl: string | null = null;
  private readerUrl: string | null = null;

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
    logService.info('Extension connected.');

    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('close', () => this.onClose());
    ws.on('error', (err) => {
      logService.warn('WebSocket error', { error: String(err) });
    });
  }

  private onClose(): void {
    if (this.socket) {
      logService.info('Extension disconnected.');
    }
    this.socket = null;
    this.writerTabId = null;
    this.readerTabId = null;
    this.writerUrl = null;
    this.readerUrl = null;
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
    switch (msg.type) {
      case 'REGISTER_EXTENSION':
        this.send({
          type: 'REGISTER_EXTENSION_ACK',
          requestId: msg.requestId,
          payload: { ok: true },
        });
        logService.info('Extension registered.', msg.payload);
        break;
      case 'TAB_ROLE_AVAILABLE': {
        const p = msg.payload as TabRoleAvailablePayload;
        if (p.role === 'writer') {
          this.writerTabId = p.tabId;
          this.writerUrl = p.url;
        } else if (p.role === 'reader') {
          this.readerTabId = p.tabId;
          this.readerUrl = p.url;
        }
        logService.info(`Tab role available: ${p.role}`, p);
        break;
      }
      case 'TAB_ROLE_REMOVED': {
        const p = msg.payload as TabRoleRemovedPayload;
        if (p.role === 'writer' && this.writerTabId === p.tabId) {
          this.writerTabId = null;
          this.writerUrl = null;
        } else if (p.role === 'reader' && this.readerTabId === p.tabId) {
          this.readerTabId = null;
          this.readerUrl = null;
        }
        logService.info(`Tab role removed: ${p.role}`, p);
        break;
      }
      case 'GENERATE_NEXT_BATCH_RESULT':
      case 'POST_TO_WRITER_RESULT': {
        requestRegistry.resolve(msg.requestId, msg.payload);
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

  isConnected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  hasWriter(): boolean {
    return this.writerTabId !== null;
  }
  hasReader(): boolean {
    return this.readerTabId !== null;
  }

  async generateNextBatch(payload: GenerateNextBatchPayload): Promise<GenerateNextBatchResultPayload> {
    if (!this.isConnected()) {
      throw new Error('Extension is not connected.');
    }
    if (!this.hasReader()) {
      throw new Error(
        'Reader tab is not connected. Open Gemini or the local LLM test page and refresh the page.',
      );
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
      throw new Error(
        'Writer tab is not connected. Open X.com/home or the local writer test page and refresh the page.',
      );
    }
    const requestId = newRequestId();
    const promise = requestRegistry.create<PostToWriterResultPayload>(
      requestId,
      TIMEOUTS.postToWriterMs,
      'Timed out waiting for writer tab to respond.',
    );
    this.send({ type: 'POST_TO_WRITER', requestId, payload });
    return promise;
  }
}

export const extensionGateway = new ExtensionGateway();
