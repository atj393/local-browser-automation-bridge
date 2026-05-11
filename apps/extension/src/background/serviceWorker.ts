import type {
  WsBaseMessage,
  GenerateNextBatchPayload,
  PostToWriterPayload,
  TabRoleAvailablePayload,
  TabRoleRemovedPayload,
  TabRole,
} from '@lbab/shared';
import { BG_REDISCOVERY_PERIOD_MIN } from '@lbab/shared';
import { backendSocket } from './websocketClient.js';
import { commandRouter } from './commandRouter.js';
import { classifyUrl, tabRegistry } from './tabRegistry.js';
import { rediscoverContentTabs } from './rediscovery.js';

const ALARM_NAME = 'lbab-heartbeat';

backendSocket.setHandler(handleBackendMessage);
backendSocket.start();

// Service worker startup: scan current tabs and try to re-establish
// reader/writer state without waiting for a page refresh.
void rediscoverContentTabs('service-worker-startup');

chrome.runtime.onStartup?.addListener(() => {
  void rediscoverContentTabs('runtime-onStartup');
});

chrome.runtime.onInstalled?.addListener(() => {
  void rediscoverContentTabs('runtime-onInstalled');
});

// Periodic rediscovery sweep. chrome.alarms survives service-worker
// sleep cycles, which a plain setInterval does not.
try {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: BG_REDISCOVERY_PERIOD_MIN });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      void rediscoverContentTabs('alarm-heartbeat');
    }
  });
} catch (err) {
  console.warn('[lbab/background] chrome.alarms unavailable', err);
}

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined) return;
  if (tab.url) registerCandidate(tab.id, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' || info.url) {
    if (tab.url) registerCandidate(tabId, tab.url);
    if (info.status === 'complete' && classifyUrl(tab.url)) {
      // Tab finished loading on a matching URL — make sure we have a
      // fresh ready state. Content script will normally re-announce on
      // load, but this covers the race where it ran before our SW woke.
      void rediscoverContentTabs('tab-complete-' + tabId);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  unregisterTab(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  tabRegistry.touch(tabId);
});

chrome.windows?.onFocusChanged.addListener(() => {
  void rediscoverContentTabs('window-focus-changed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.type === 'WS_OPENED') {
    // Re-announce all known *ready* tabs once the socket is up, then
    // sweep for new candidates.
    for (const info of tabRegistry.listReady()) {
      sendTabAvailable(info.role, info.tabId, info.url);
    }
    void rediscoverContentTabs('ws-opened');
    return false;
  }

  if (message.type === 'CONTENT_READY' && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const role = message.role as TabRole;
    const url = message.url ?? sender.tab.url ?? '';
    if (!message.heartbeat) {
      console.log('[lbab/background] CONTENT_READY received', role, tabId, url);
    }
    if (role === 'writer' || role === 'reader') {
      tabRegistry.markReady(tabId, role, url);
      sendTabAvailable(role, tabId, url);
    }
    sendResponse({ ok: true, ackedBy: 'background', tabId });
    return false;
  }

  return false;
});

/**
 * URL-based candidate registration. Does NOT announce to backend until
 * CONTENT_READY arrives. If a tab navigates away from a matching URL,
 * the tab is dropped and TAB_ROLE_REMOVED is sent if it was previously ready.
 */
function registerCandidate(tabId: number, url: string): void {
  const before = tabRegistry.list().find((t) => t.tabId === tabId);
  const wasReady = before?.contentScriptReady ?? false;
  const beforeRole = before?.role;
  const next = tabRegistry.upsertCandidate(tabId, url);
  if (!next && before && wasReady && beforeRole) {
    sendTabRemoved(beforeRole, tabId);
  }
}

function unregisterTab(tabId: number): void {
  const removed = tabRegistry.remove(tabId);
  if (removed && removed.contentScriptReady) sendTabRemoved(removed.role, tabId);
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
      // And rediscover — backend may have just restarted and lost state.
      void rediscoverContentTabs('register-extension-ack');
      break;
    case 'REDISCOVER_TABS':
      void rediscoverContentTabs('backend-request');
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

// Keep the classifyUrl import alive — used indirectly via tabRegistry,
// kept here so editor "remove unused import" doesn't break the type.
void classifyUrl;
