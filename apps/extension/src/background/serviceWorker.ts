import type {
  WsBaseMessage,
  GenerateNextBatchPayload,
  PostToWriterPayload,
  TabRoleAvailablePayload,
  TabRoleRemovedPayload,
  TabRole,
} from '@lbab/shared';
import { backendSocket } from './websocketClient.js';
import { commandRouter } from './commandRouter.js';
import { classifyUrl, tabRegistry } from './tabRegistry.js';

backendSocket.setHandler(handleBackendMessage);
backendSocket.start();

scanExistingTabs();

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined) return;
  if (tab.url) registerCandidate(tab.id, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' || info.url) {
    if (tab.url) registerCandidate(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  unregisterTab(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  tabRegistry.touch(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.type === 'WS_OPENED') {
    // Re-announce all known *ready* tabs once the socket is up.
    for (const info of tabRegistry.listReady()) {
      sendTabAvailable(info.role, info.tabId, info.url);
    }
    return false;
  }

  if (message.type === 'CONTENT_READY' && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const role = message.role as TabRole;
    const url = message.url ?? sender.tab.url ?? '';
    console.log('[lbab/background] CONTENT_READY received', role, tabId, url);
    if (role === 'writer' || role === 'reader') {
      tabRegistry.markReady(tabId, role, url);
      sendTabAvailable(role, tabId, url);
    }
    sendResponse({ ok: true, ackedBy: 'background', tabId });
    return false;
  }

  return false;
});

async function scanExistingTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined && tab.url) registerCandidate(tab.id, tab.url);
    }
  } catch (err) {
    console.warn('[lbab/bg] scanExistingTabs failed', err);
  }
}

/**
 * URL-based candidate registration. Does NOT announce to backend until
 * CONTENT_READY arrives. If a tab navigates away from a matching URL,
 * the tab is dropped and TAB_ROLE_REMOVED is sent if it was previously ready.
 */
function registerCandidate(tabId: number, url: string): void {
  const before = tabRegistry.list().find((t) => t.tabId === tabId);
  const wasReady = before?.ready ?? false;
  const beforeRole = before?.role;
  const next = tabRegistry.upsertCandidate(tabId, url);
  if (!next && before && wasReady && beforeRole) {
    sendTabRemoved(beforeRole, tabId);
  }
}

function unregisterTab(tabId: number): void {
  const removed = tabRegistry.remove(tabId);
  if (removed && removed.ready) sendTabRemoved(removed.role, tabId);
}

function sendTabAvailable(role: TabRole, tabId: number, url: string): void {
  const payload: TabRoleAvailablePayload = { role, tabId, url };
  backendSocket.send({
    type: 'TAB_ROLE_AVAILABLE',
    requestId: 'tab-' + tabId,
    payload,
  });
}

function sendTabRemoved(role: TabRole, tabId: number): void {
  const payload: TabRoleRemovedPayload = { role, tabId };
  backendSocket.send({
    type: 'TAB_ROLE_REMOVED',
    requestId: 'tab-rm-' + tabId,
    payload,
  });
}

async function handleBackendMessage(msg: WsBaseMessage): Promise<void> {
  switch (msg.type) {
    case 'REGISTER_EXTENSION_ACK':
      console.log('[lbab/bg] backend ack', msg.payload);
      // Re-announce ready tabs whenever the backend acks (after restarts).
      for (const info of tabRegistry.listReady()) {
        sendTabAvailable(info.role, info.tabId, info.url);
      }
      break;
    case 'GENERATE_NEXT_BATCH': {
      const payload = msg.payload as GenerateNextBatchPayload;
      const result = await commandRouter.generateNextBatch(msg.requestId, payload);
      backendSocket.send({
        type: 'GENERATE_NEXT_BATCH_RESULT',
        requestId: msg.requestId,
        payload: result,
      });
      break;
    }
    case 'POST_TO_WRITER': {
      const payload = msg.payload as PostToWriterPayload;
      const result = await commandRouter.postToWriter(msg.requestId, payload);
      backendSocket.send({
        type: 'POST_TO_WRITER_RESULT',
        requestId: msg.requestId,
        payload: result,
      });
      break;
    }
    default:
      // ignore other messages.
      break;
  }
}

// Suppress unused variable warning for classifyUrl import resolution.
void classifyUrl;
