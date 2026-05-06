import type { PostQueueItem } from '@lbab/shared';
import { extensionGateway } from '../websocket/extensionGateway.js';
import { queueService } from './queueService.js';
import { settingsService } from './settingsService.js';
import { logService } from './logService.js';
import { nowIso } from '../utils/date.js';

export interface PostNextResult {
  success: boolean;
  postId?: number;
  resultStatus?: 'filled' | 'submitted';
  autoSubmitted?: boolean;
  error?: string;
  noPending?: boolean;
}

let isPosting = false;

export const automationService = {
  isLocked(): boolean {
    return isPosting;
  },

  async postOne(item: PostQueueItem): Promise<PostNextResult> {
    if (isPosting) {
      const msg = 'Another post is already in flight; skipping.';
      logService.warn(msg, { postId: item.id });
      return { success: false, error: msg };
    }
    isPosting = true;
    try {
      const settings = settingsService.get();
      queueService.setStatus(item.id, 'posting');
      logService.info('Post command sent: dispatching to writer tab.', {
        postId: item.id,
        autoSubmit: settings.autoSubmitWriter,
        contentPreview: item.content.slice(0, 80),
      });

      let writerResult;
      try {
        writerResult = await extensionGateway.postToWriter({
          postId: item.id,
          content: item.content,
          autoSubmit: settings.autoSubmitWriter,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        queueService.setStatus(item.id, 'failed', {
          errorMessage: errMsg,
          failedAt: nowIso(),
        });
        logService.error('Post-to-writer failed.', { postId: item.id, error: errMsg });
        return { success: false, postId: item.id, error: errMsg };
      }

      if (!writerResult.success) {
        const errMsg = writerResult.error ?? 'Writer reported failure.';
        queueService.setStatus(item.id, 'failed', {
          errorMessage: errMsg,
          failedAt: nowIso(),
        });
        logService.error('Writer rejected post.', { postId: item.id, error: errMsg });
        return { success: false, postId: item.id, error: errMsg };
      }

      const resultStatus = writerResult.status ?? (settings.autoSubmitWriter ? 'submitted' : 'filled');
      queueService.setStatus(item.id, 'posted', { postedAt: nowIso() });
      logService.info(
        resultStatus === 'submitted'
          ? `Item ${item.id} submitted to writer.`
          : `Item ${item.id} filled into writer (no submit).`,
        { postId: item.id, result_status: resultStatus, autoSubmitted: !!writerResult.autoSubmitted },
      );
      return {
        success: true,
        postId: item.id,
        resultStatus,
        autoSubmitted: !!writerResult.autoSubmitted,
      };
    } finally {
      isPosting = false;
    }
  },

  async postNext(): Promise<PostNextResult> {
    const item = queueService.findOldestPending();
    if (!item) {
      return { success: false, noPending: true, error: 'No pending items.' };
    }
    return this.postOne(item);
  },
};
