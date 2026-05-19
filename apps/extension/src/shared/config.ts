export const EXTENSION_ID = 'local-browser-automation-bridge';
export const EXTENSION_VERSION = '0.1.0';

// Backend WebSocket URL is baked in at extension build time. Override
// with `VITE_BACKEND_WS_URL=ws://localhost:14000/ws` when building or
// running the extension on dedicated ports.
const VITE_BACKEND_WS_URL = (import.meta as unknown as {
  env?: Record<string, string | undefined>;
}).env?.VITE_BACKEND_WS_URL;
export const BACKEND_WS_URL = VITE_BACKEND_WS_URL ?? 'ws://localhost:4000/ws';

export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 15_000;
