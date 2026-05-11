import type { TabRole, TabRoleAvailablePayload, TabRoleCandidatePayload } from '@lbab/shared';
import { backendSocket } from './websocketClient.js';
import {
  READER_TAB_QUERY,
  WRITER_TAB_QUERY,
  classifyUrl,
  tabRegistry,
} from './tabRegistry.js';

interface PingResponse {
  ok?: boolean;
  role?: TabRole;
  url?: string;
}

function pingTab(tabId: number): Promise<{ ok: boolean; resp?: PingResponse; error?: string }> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'PING_CONTENT' }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: err.message ?? 'lastError' });
          return;
        }
        resolve({ ok: !!response?.ok, resp: response as PingResponse });
      });
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

async function queryByPatterns(patterns: chrome.tabs.QueryInfo[]): Promise<chrome.tabs.Tab[]> {
  const out: chrome.tabs.Tab[] = [];
  for (const q of patterns) {
    try {
      const tabs = await chrome.tabs.query(q);
      out.push(...tabs);
    } catch (err) {
      console.warn('[lbab/background] tabs.query failed', q, err);
    }
  }
  return out;
}

function sendTabAvailable(role: TabRole, tabId: number, url: string): void {
  const payload: TabRoleAvailablePayload = { role, tabId, url };
  backendSocket.send({
    type: 'TAB_ROLE_AVAILABLE',
    requestId: 'tab-' + tabId,
    payload,
  });
}

function sendTabCandidate(role: TabRole, tabId: number, url: string, error: string | null): void {
  const payload: TabRoleCandidatePayload = {
    role,
    tabId,
    url,
    contentScriptReady: false,
    error,
  };
  backendSocket.send({
    type: 'TAB_ROLE_CANDIDATE',
    requestId: 'tab-cand-' + tabId,
    payload,
  });
}

/**
 * Try to dynamically re-inject the content script when ping fails.
 * Requires the "scripting" permission. We pass `files` rather than a
 * function so this works even when CRXJS bundles the script — file
 * paths in the dev/built extension are stable.
 */
async function tryReinject(tabId: number, role: TabRole): Promise<boolean> {
  if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
    return false;
  }
  // CRXJS emits content scripts at predictable paths under
  // src/content/*.ts in dev and assets/*.js in build. Try both.
  const candidates =
    role === 'reader'
      ? ['src/content/geminiReader.ts.js', 'src/content/geminiReader.js']
      : ['src/content/xWriter.ts.js', 'src/content/xWriter.js'];
  for (const file of candidates) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [file],
      });
      console.log('[lbab/background] reinjected content script', { tabId, role, file });
      return true;
    } catch {
      // Try next candidate.
    }
  }
  return false;
}

/**
 * Rediscover existing reader/writer tabs and refresh registry state.
 *
 * MV3 service workers can sleep and lose in-memory state. This sweep
 * walks tabs matching reader/writer URL patterns, pings their content
 * scripts, and re-announces ready ones to the backend without
 * requiring the user to refresh the page.
 */
export async function rediscoverContentTabs(reason: string): Promise<void> {
  console.log('[lbab/background] rediscovering content tabs:', reason);

  const writerTabs = await queryByPatterns(WRITER_TAB_QUERY);
  const readerTabs = await queryByPatterns(READER_TAB_QUERY);
  const seen = new Map<number, { role: TabRole; url: string }>();

  for (const t of writerTabs) {
    if (t.id !== undefined && t.url) {
      seen.set(t.id, { role: 'writer', url: t.url });
      console.log('[lbab/background] candidate writer tab found', t.id, t.url);
    }
  }
  for (const t of readerTabs) {
    if (t.id !== undefined && t.url) {
      seen.set(t.id, { role: 'reader', url: t.url });
      console.log('[lbab/background] candidate reader tab found', t.id, t.url);
    }
  }

  for (const [tabId, { role, url }] of seen) {
    tabRegistry.upsertCandidate(tabId, url);
    const result = await pingTab(tabId);
    if (result.ok) {
      tabRegistry.markPingSuccess(tabId, role, url);
      sendTabAvailable(role, tabId, url);
      console.log(`[lbab/background] ping ${role} success`, tabId);
    } else {
      const error = result.error ?? 'no response';
      tabRegistry.markPingFailure(tabId, role, url, error);
      console.log('[lbab/background] ping failed; content script not ready', {
        tabId,
        role,
        error,
      });

      // Attempt a safe re-injection. If it succeeds, the content script
      // will send CONTENT_READY on its own. We do not retry the ping
      // inline — the heartbeat / re-announce path will catch up.
      const reinjected = await tryReinject(tabId, role);
      if (!reinjected) {
        sendTabCandidate(role, tabId, url, error);
      }
    }
  }

  // Sanity check: drop registry entries for tabs that no longer exist.
  for (const info of tabRegistry.list()) {
    if (!seen.has(info.tabId)) {
      try {
        const t = await chrome.tabs.get(info.tabId);
        // Tab still exists; if it no longer matches a role pattern, drop it.
        if (!classifyUrl(t.url)) {
          tabRegistry.remove(info.tabId);
        }
      } catch {
        // tabs.get throws when the tab is gone.
        tabRegistry.remove(info.tabId);
      }
    }
  }
}
