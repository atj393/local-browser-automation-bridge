import type { PostQueueItem } from '@lbab/shared';
import { extensionGateway } from '../websocket/extensionGateway.js';
import { queueService } from './queueService.js';
import { settingsService } from './settingsService.js';
import { logService } from './logService.js';
import { nowIso } from '../utils/date.js';
import { newRequestId } from '../utils/ids.js';

export interface PostNextResult {
  success: boolean;
  postId?: number;
  operationId?: string;
  resultStatus?: 'filled' | 'submitted' | 'duplicate_ignored';
  autoSubmitted?: boolean;
  duplicate?: boolean;
  error?: string;
  noPending?: boolean;
}

// Global lock so manual + scheduler share it.
let isPosting = false;

/**
 * Tracks which postIds are currently in flight. Maps postId → operationId.
 * Used to block a second concurrent attempt for the same postId in case the
 * lock contract is bypassed (e.g., by future code paths).
 */
const activePostOperations = new Map<number, string>();

function buildOperationId(postId: number, requestId: string): string {
  return `post:${postId}:${requestId}`;
}

async function postClaimed(item: PostQueueItem): Promise<PostNextResult> {
  // The row is already in `posting` status. Generate a deterministic id for
  // this attempt and dispatch.
  const requestId = newRequestId();
  const operationId = buildOperationId(item.id, requestId);

  if (activePostOperations.has(item.id)) {
    const existing = activePostOperations.get(item.id);
    logService.warn('Duplicate post command blocked (postId already active).', {
      postId: item.id,
      existing,
      attempted: operationId,
    });
    return {
      success: false,
      postId: item.id,
      error: 'Post item is already being processed.',
    };
  }
  activePostOperations.set(item.id, operationId);

  const settings = settingsService.get();
  logService.info('Post command sent: dispatching to writer tab.', {
    postId: item.id,
    operationId,
    autoSubmit: settings.autoSubmitWriter,
    contentPreview: item.content.slice(0, 80),
  });

  try {
    let writerResult;
    try {
      writerResult = await extensionGateway.postToWriter({
        postId: item.id,
        content: item.content,
        autoSubmit: settings.autoSubmitWriter,
        operationId,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // The DB row is `posting`. Move to `failed` because we never got a
      // success acknowledgment from the writer.
      const fresh = queueService.getById(item.id);
      if (fresh && fresh.status === 'posting') {
        queueService.setStatus(item.id, 'failed', {
          errorMessage: errMsg,
          failedAt: nowIso(),
        });
      } else {
        logService.warn(
          'Post-to-writer threw, but DB row is no longer `posting`; not overwriting.',
          { postId: item.id, currentStatus: fresh?.status, error: errMsg },
        );
      }
      logService.error('Post-to-writer failed.', {
        postId: item.id,
        operationId,
        error: errMsg,
      });
      return { success: false, postId: item.id, operationId, error: errMsg };
    }

    if (!writerResult.success) {
      const errMsg = writerResult.error ?? 'Writer reported failure.';
      const fresh = queueService.getById(item.id);
      if (fresh && fresh.status === 'posting') {
        queueService.setStatus(item.id, 'failed', {
          errorMessage: errMsg,
          failedAt: nowIso(),
        });
      }
      logService.error('Writer rejected post.', {
        postId: item.id,
        operationId,
        error: errMsg,
      });
      return { success: false, postId: item.id, operationId, error: errMsg };
    }

    if (writerResult.duplicate || writerResult.status === 'duplicate_ignored') {
      // The content script told us this operation was already executed.
      // Do NOT mark posted again — only normalize state if needed.
      logService.warn('Writer reported duplicate operation; not re-posting.', {
        postId: item.id,
        operationId,
        status: writerResult.status,
      });
      const fresh = queueService.getById(item.id);
      if (fresh && fresh.status === 'posting') {
        // We got the row stuck in `posting` because of a duplicate; settle it.
        queueService.setStatus(item.id, 'posted', { postedAt: nowIso() });
      }
      return {
        success: true,
        postId: item.id,
        operationId,
        resultStatus: 'duplicate_ignored',
        duplicate: true,
        autoSubmitted: !!writerResult.autoSubmitted,
      };
    }

    // Idempotent state transition. Only flip `posting` → `posted`; never
    // overwrite a row that is already `posted`.
    const fresh = queueService.getById(item.id);
    if (fresh && fresh.status === 'posted') {
      logService.warn('Post item already posted; skipping status update.', {
        postId: item.id,
        operationId,
      });
    } else if (fresh && fresh.status === 'posting') {
      queueService.setStatus(item.id, 'posted', { postedAt: nowIso() });
    } else {
      logService.warn(
        'Writer returned success but DB row is in an unexpected status; not overwriting.',
        { postId: item.id, status: fresh?.status, operationId },
      );
    }

    // Duplicate case is already handled above; here status is filled/submitted/undefined.
    const resultStatus: 'filled' | 'submitted' =
      writerResult.status === 'submitted' || writerResult.status === 'filled'
        ? writerResult.status
        : settings.autoSubmitWriter
          ? 'submitted'
          : 'filled';

    logService.info(
      resultStatus === 'submitted'
        ? `Item ${item.id} submitted to writer.`
        : `Item ${item.id} filled into writer (no submit).`,
      {
        postId: item.id,
        operationId,
        result_status: resultStatus,
        autoSubmitted: !!writerResult.autoSubmitted,
      },
    );

    return {
      success: true,
      postId: item.id,
      operationId,
      resultStatus,
      autoSubmitted: !!writerResult.autoSubmitted,
    };
  } finally {
    activePostOperations.delete(item.id);
  }
}

export const automationService = {
  isLocked(): boolean {
    return isPosting;
  },

  /**
   * Atomically claim the oldest pending row and post it. Returns
   * `noPending` if nothing is claimable. Refuses to run if another post
   * is in flight.
   */
  async postNext(): Promise<PostNextResult> {
    if (isPosting) {
      const msg = 'Another post is already in flight; skipping.';
      logService.warn(msg);
      return { success: false, error: msg };
    }
    isPosting = true;
    try {
      logService.info('Post claim requested (oldest pending).');
      const claimed = queueService.claimNextPendingPost();
      if (!claimed) {
        return { success: false, noPending: true, error: 'No pending items.' };
      }
      logService.info('Post item claimed.', {
        postId: claimed.id,
        previousStatus: 'pending',
      });
      return await postClaimed(claimed);
    } finally {
      isPosting = false;
    }
  },

  /**
   * Atomically claim a specific row by id and post it. Returns a clear
   * error if the row is not currently `pending`.
   */
  async postById(postId: number): Promise<PostNextResult> {
    if (isPosting) {
      const msg = 'Another post is already in flight; skipping.';
      logService.warn(msg, { postId });
      return { success: false, postId, error: msg };
    }
    isPosting = true;
    try {
      logService.info('Post claim requested by id.', { postId });
      const claimed = queueService.claimPostById(postId);
      if (!claimed) {
        const fresh = queueService.getById(postId);
        if (!fresh) return { success: false, postId, error: 'Not found.' };
        return {
          success: false,
          postId,
          error: `Cannot claim post ${postId} (status: ${fresh.status}). Reset to 'pending' first via Retry.`,
        };
      }
      logService.info('Post item claimed.', { postId });
      return await postClaimed(claimed);
    } finally {
      isPosting = false;
    }
  },
};
