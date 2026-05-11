import type {
  GenerateNextBatchPayload,
  GenerateNextBatchResultPayload,
  PostToWriterPayload,
  PostToWriterResultPayload,
  TabRole,
} from '@lbab/shared';
import { tabRegistry } from './tabRegistry.js';
import { rediscoverContentTabs } from './rediscovery.js';

function sendToTab<TResp>(tabId: number, message: unknown): Promise<TResp> {
  return new Promise<TResp>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message ?? 'Tab message failed'));
        return;
      }
      resolve(response as TResp);
    });
  });
}

interface PingResponse {
  ok?: boolean;
  role?: TabRole;
  url?: string;
}

/**
 * Liveness check. Returns true if the content script in `tabId` answers
 * a PING_CONTENT round-trip; false otherwise. Never throws.
 */
async function pingTab(tabId: number): Promise<boolean> {
  try {
    const resp = await sendToTab<PingResponse>(tabId, { type: 'PING_CONTENT' });
    return !!resp?.ok;
  } catch (err) {
    console.warn('[lbab/cmd] PING_CONTENT failed', tabId, err);
    return false;
  }
}

/**
 * Resolve a usable ready tab for `role`, attempting recovery if the
 * cached ready tab fails its ping. Returns the live tabId or null.
 */
async function resolveLiveTab(role: TabRole): Promise<{ tabId: number; url: string } | null> {
  // 1) Prefer a fresh (within TTL) ready tab — usually nothing to ping.
  let candidate = tabRegistry.getMostRecentFresh(role) ?? tabRegistry.getMostRecent(role);
  if (candidate && (await pingTab(candidate.tabId))) {
    tabRegistry.markPingSuccess(candidate.tabId, candidate.role, candidate.url);
    return { tabId: candidate.tabId, url: candidate.url };
  }
  if (candidate) {
    tabRegistry.markPingFailure(
      candidate.tabId,
      candidate.role,
      candidate.url,
      'ping returned no response',
    );
  }

  // 2) Sweep: registry may have stale or missing entries after SW sleep.
  await rediscoverContentTabs('command-router-' + role);

  // 3) Try again after the sweep — rediscovery may have promoted a
  //    candidate to ready via successful ping.
  candidate = tabRegistry.getMostRecentFresh(role) ?? tabRegistry.getMostRecent(role);
  if (candidate && (await pingTab(candidate.tabId))) {
    tabRegistry.markPingSuccess(candidate.tabId, candidate.role, candidate.url);
    return { tabId: candidate.tabId, url: candidate.url };
  }
  return null;
}

const READER_NOT_READY =
  'Reader tab is not ready. The extension is reconnecting; refresh Gemini or http://localhost:4000/test/llm if this persists.';
const WRITER_NOT_READY =
  'Writer tab is not ready. The extension is reconnecting; refresh X.com or http://localhost:4000/test/writer if this persists.';

// Defense-in-depth: refuse to send POST_TO_WRITER_CONTENT twice for the same
// operationId, even if the backend (or a buggy WS reconnect) emits two
// commands with the same id. Cleared after the response or on error.
const activeWriterOperations = new Set<string>();

export const commandRouter = {
  async generateNextBatch(
    requestId: string,
    payload: GenerateNextBatchPayload,
  ): Promise<GenerateNextBatchResultPayload> {
    const tab = await resolveLiveTab('reader');
    if (!tab) {
      return { success: false, error: READER_NOT_READY };
    }
    try {
      return await sendToTab<GenerateNextBatchResultPayload>(tab.tabId, {
        type: 'GENERATE_NEXT_BATCH_CONTENT',
        requestId,
        payload,
      });
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
  async postToWriter(
    requestId: string,
    payload: PostToWriterPayload,
  ): Promise<PostToWriterResultPayload> {
    const operationId = payload.operationId;

    if (operationId && activeWriterOperations.has(operationId)) {
      console.warn(
        '[lbab/cmd] Duplicate writer operation blocked.',
        operationId,
        'postId:',
        payload.postId,
      );
      return {
        success: false,
        postId: payload.postId,
        operationId,
        error: 'Duplicate writer operation blocked.',
      };
    }

    const tab = await resolveLiveTab('writer');
    if (!tab) {
      return {
        success: false,
        postId: payload.postId,
        operationId,
        error: WRITER_NOT_READY,
      };
    }

    console.log(
      '[lbab/background] POST_TO_WRITER autoSubmit:',
      !!payload.autoSubmit,
      'postId:',
      payload.postId,
      'operationId:',
      operationId,
      'tabId:',
      tab.tabId,
    );

    if (operationId) activeWriterOperations.add(operationId);
    try {
      const resp = await sendToTab<PostToWriterResultPayload>(tab.tabId, {
        type: 'POST_TO_WRITER_CONTENT',
        requestId,
        payload,
      });
      return { ...resp, operationId: resp.operationId ?? operationId };
    } catch (err) {
      return {
        success: false,
        postId: payload.postId,
        operationId,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (operationId) activeWriterOperations.delete(operationId);
    }
  },
};
