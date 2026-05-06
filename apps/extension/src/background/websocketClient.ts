import type { WsBaseMessage } from '@lbab/shared';
import { BACKEND_WS_URL, EXTENSION_ID, EXTENSION_VERSION, RECONNECT_BASE_MS, RECONNECT_MAX_MS } from '../shared/config.js';

type Handler = (msg: WsBaseMessage) => void;

class BackendSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private handler: Handler | null = null;
  private connectTimer: number | null = null;
  private wantOpen = true;

  setHandler(handler: Handler): void {
    this.handler = handler;
  }

  start(): void {
    this.wantOpen = true;
    this.connect();
  }

  private connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      this.ws = new WebSocket(BACKEND_WS_URL);
    } catch (err) {
      console.warn('[lbab/ws] failed to construct WebSocket', err);
      this.scheduleReconnect();
      return;
    }
    this.ws.addEventListener('open', () => {
      console.log('[lbab/ws] connected');
      this.reconnectAttempts = 0;
      this.send({
        type: 'REGISTER_EXTENSION',
        requestId: 'reg-' + Date.now(),
        payload: { extensionId: EXTENSION_ID, version: EXTENSION_VERSION },
      });
      // Notify dependents (background) so they can re-announce tabs.
      try {
        chrome.runtime.sendMessage({ type: 'WS_OPENED', requestId: '', payload: {} });
      } catch {
        // ignore
      }
    });
    this.ws.addEventListener('message', (ev) => {
      let msg: WsBaseMessage | null = null;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as WsBaseMessage;
      } catch {
        return;
      }
      if (this.handler) this.handler(msg);
    });
    this.ws.addEventListener('close', () => {
      console.log('[lbab/ws] closed');
      this.ws = null;
      if (this.wantOpen) this.scheduleReconnect();
    });
    this.ws.addEventListener('error', (err) => {
      console.warn('[lbab/ws] error', err);
    });
  }

  private scheduleReconnect(): void {
    if (this.connectTimer !== null) return;
    const attempt = this.reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, Math.min(attempt, 5)), RECONNECT_MAX_MS);
    console.log(`[lbab/ws] reconnecting in ${delay}ms`);
    this.connectTimer = self.setTimeout(() => {
      this.connectTimer = null;
      this.connect();
    }, delay);
  }

  send(message: WsBaseMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

export const backendSocket = new BackendSocket();
