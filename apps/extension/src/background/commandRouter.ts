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
  async postToWriter(requestId: string, payload: PostToWriterPayload): Promise<PostToWriterResultPayload> {
    const tab = tabRegistry.getMostRecent('writer');
    if (!tab) {
      return {
        success: false,
        postId: payload.postId,
        error:
          'No ready writer tab. Open X.com or http://localhost:4000/test/writer and refresh; wait for "CONTENT_READY sent" in the page console.',
      };
    }
    if (!(await pingTab(tab.tabId))) {
      return {
        success: false,
        postId: payload.postId,
        error: `Writer tab ${tab.tabId} did not respond to ping. Refresh the writer page so the content script reloads.`,
      };
    }
    try {
      return await sendToTab<PostToWriterResultPayload>(tab.tabId, {
        type: 'POST_TO_WRITER_CONTENT',
        requestId,
        payload,
      });
    } catch (err) {
      return {
        success: false,
        postId: payload.postId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
