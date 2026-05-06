import type {
  GenerateNextBatchPayload,
  GenerateNextBatchResultPayload,
  PostToWriterPayload,
  PostToWriterResultPayload,
  TabRole,
} from '@lbab/shared';
import { tabRegistry } from './tabRegistry.js';

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

// Defense-in-depth: refuse to send POST_TO_WRITER_CONTENT twice for the same
// operationId, even if the backend (or a buggy WS reconnect) emits two
// commands with the same id. Cleared after the response or on error.
const activeWriterOperations = new Set<string>();

export const commandRouter = {
  async generateNextBatch(
    requestId: string,
    payload: GenerateNextBatchPayload,
  ): Promise<GenerateNextBatchResultPayload> {
    const tab = tabRegistry.getMostRecent('reader');
    if (!tab) {
      return {
        success: false,
        error:
          'No ready reader tab. Open Gemini or http://localhost:4000/test/llm and refresh; wait for "CONTENT_READY sent" in the page console.',
      };
    }
    if (!(await pingTab(tab.tabId))) {
      return {
        success: false,
        error: `Reader tab ${tab.tabId} did not respond to ping. Refresh the reader page so the content script reloads.`,
      };
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

    const tab = tabRegistry.getMostRecent('writer');
    if (!tab) {
      return {
        success: false,
        postId: payload.postId,
        operationId,
        error:
          'No ready writer tab. Open X.com or http://localhost:4000/test/writer and refresh; wait for "CONTENT_READY sent" in the page console.',
      };
    }

    console.log(
      '[lbab/cmd] dispatching POST_TO_WRITER_CONTENT',
      'operationId:',
      operationId,
      'postId:',
      payload.postId,
      'tabId:',
      tab.tabId,
    );

    if (!(await pingTab(tab.tabId))) {
      return {
        success: false,
        postId: payload.postId,
        operationId,
        error: `Writer tab ${tab.tabId} did not respond to ping. Refresh the writer page so the content script reloads.`,
      };
    }

    if (operationId) activeWriterOperations.add(operationId);
    try {
      const resp = await sendToTab<PostToWriterResultPayload>(tab.tabId, {
        type: 'POST_TO_WRITER_CONTENT',
        requestId,
        payload,
      });
      // Echo operationId back if content script forgot to.
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
