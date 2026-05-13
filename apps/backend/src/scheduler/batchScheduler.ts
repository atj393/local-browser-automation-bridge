import { settingsService } from '../services/settingsService.js';
import { queueService } from '../services/queueService.js';
import { promptService } from '../services/promptService.js';
import { logService } from '../services/logService.js';
import { extensionGateway } from '../websocket/extensionGateway.js';
import { isoFromMsFromNow } from '../utils/date.js';
import { getRandomDelay } from './randomDelay.js';

/**
 * Owns the timer that controls **when Gemini is asked for a new batch**.
 *
 * Behavior contract (when automation is running):
 *   - Queue has items  → batch scheduler is idle. Post scheduler runs.
 *   - Queue is empty   → generate a batch IMMEDIATELY (no random delay).
 *   - Generation fails → schedule a retry using the batch interval.
 *   - Generation OK    → recompute post schedule via post scheduler hook.
 *
 * The batch interval (`batchMin/MaxIntervalSeconds`) is **only** used for
 * retry-after-failure, not for the first refill when the queue empties.
 */
class BatchScheduler {
  private retryTimer: NodeJS.Timeout | null = null;
  private isGenerating = false;
  /** True only when the *currently scheduled* batch timer is a retry. */
  private retryPending = false;

  /** Initial assessment when automation starts. */
  start(): void {
    if (queueService.countPendingOrScheduled() === 0) {
      void this.ensureQueueHasItemsOrGenerateImmediately('automation-started');
    } else {
      logService.info(
        'Batch scheduler started; queue has items, batch generation is idle.',
        { pending: queueService.countPendingOrScheduled() },
      );
      settingsService.setNextBatchRunAt(null);
      this.clearRetryTimer();
    }
  }

  stop(): void {
    this.clearRetryTimer();
    settingsService.setNextBatchRunAt(null);
    this.retryPending = false;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      logService.debug('Batch retry timer cleared.');
    }
  }

  /**
   * Single entry point for "queue went empty, get more posts".
   *
   * Behavior:
   *  - Queue has items     → returns without generating.
   *  - Already generating  → returns "already generating".
   *  - Automation stopped  → no-op.
   *  - Otherwise           → generate immediately.
   *
   * Called from automation start, post scheduler after the last item posts,
   * and any retry timer firing.
   */
  async ensureQueueHasItemsOrGenerateImmediately(
    reason: string,
  ): Promise<{ inserted: number; skipped?: string; error?: string }> {
    const settings = settingsService.get();
    if (!settings.isRunning) {
      logService.debug('Batch refill skipped: automation stopped.', { reason });
      return { inserted: 0, skipped: 'not-running' };
    }
    if (queueService.countPendingOrScheduled() > 0) {
      this.clearRetryTimer();
      settingsService.setNextBatchRunAt(null);
      this.retryPending = false;
      return { inserted: 0, skipped: 'queue-not-empty' };
    }
    if (this.isGenerating) {
      logService.info('Batch generation already in progress; skipping duplicate request.', {
        reason,
      });
      return { inserted: 0, skipped: 'in-progress' };
    }
    return this.generateBatchImmediatelyBecauseQueueEmpty(reason);
  }

  /**
   * Immediate-refill path: fires generation right now because the queue
   * is empty. The retry timer (if any) is cleared so we don't double-fire.
   */
  private async generateBatchImmediatelyBecauseQueueEmpty(
    reason: string,
  ): Promise<{ inserted: number; skipped?: string; error?: string }> {
    this.clearRetryTimer();
    settingsService.setNextBatchRunAt(null);
    this.retryPending = false;
    logService.info('Queue empty; generating batch immediately.', { reason });
    const result = await this.generateBatchNow(`immediate-refill:${reason}`);
    return { inserted: result.inserted, skipped: result.skipped, error: result.error };
  }

  /**
   * Failure retry path: schedule another generation attempt after a
   * random delay drawn from `batchMin/MaxIntervalSeconds`. Used when an
   * immediate refill fails (reader disconnected, Gemini error, JSON
   * parse failure, etc.). Prevents a tight retry loop.
   */
  private scheduleBatchRetryAfterFailure(reason: string): void {
    const settings = settingsService.get();
    if (!settings.isRunning) {
      logService.debug('Retry not scheduled: automation stopped.', { reason });
      return;
    }
    const delayMs = getRandomDelay(
      settings.batchMinIntervalSeconds,
      settings.batchMaxIntervalSeconds,
    );
    const nextRunAt = isoFromMsFromNow(delayMs);
    settingsService.setNextBatchRunAt(nextRunAt);
    this.clearRetryTimer();
    this.retryPending = true;
    logService.warn(
      `Batch generation retry scheduled in ${Math.round(delayMs / 1000)}s.`,
      { nextRunAt, reason },
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryPending = false;
      void this.ensureQueueHasItemsOrGenerateImmediately(`retry-timer:${reason}`);
    }, delayMs);
  }

  /**
   * Optional top-up entry point. Currently a no-op placeholder — the
   * product spec reserves the batch interval for future top-up behavior
   * when the queue has content but might empty soon.
   */
  scheduleBatchTopUpIfNeeded(reason: string): void {
    // Intentionally not implemented yet; documented entry point so the
    // future top-up feature has an obvious place to land.
    logService.debug('scheduleBatchTopUpIfNeeded called (no-op).', { reason });
  }

  /**
   * Force a generation right now. Used by the manual /api/batches/generate
   * route, the immediate-refill path, and the retry timer firing.
   *
   * Always single-flight via isGenerating + DB flag. Never starts a second
   * generation while one is in progress.
   */
  async generateBatchNow(reason: string): Promise<{
    inserted: number;
    batchId: string;
    sourceUrl: string | null;
    error?: string;
    skipped?: 'in-progress' | 'reader-disconnected' | 'queue-not-empty';
  }> {
    if (this.isGenerating) {
      logService.warn('Batch generation already running; skipping duplicate request.', {
        reason,
      });
      return {
        inserted: 0,
        batchId: '',
        sourceUrl: null,
        error: 'Batch generation already in progress.',
        skipped: 'in-progress',
      };
    }

    if (!extensionGateway.hasReader()) {
      logService.warn('Batch generation skipped: reader disconnected.', { reason });
      // Treat reader-disconnected as a failure and schedule a retry so the
      // app recovers automatically once the reader reconnects.
      if (settingsService.get().isRunning) {
        this.scheduleBatchRetryAfterFailure('reader-disconnected');
      }
      return {
        inserted: 0,
        batchId: '',
        sourceUrl: null,
        error: 'Reader tab is not connected.',
        skipped: 'reader-disconnected',
      };
    }

    this.isGenerating = true;
    settingsService.setBatchGenerationRunning(true);
    // Immediate-refill mode: nextBatchRunAt is null while we generate.
    settingsService.setNextBatchRunAt(null);
    this.retryPending = false;
    logService.info('Batch generation started.', { reason });

    try {
      const result = await promptService.generateAndStoreBatch();
      if (result.error) {
        logService.error('Batch generation failed.', { reason, error: result.error });
        if (settingsService.get().isRunning) {
          this.scheduleBatchRetryAfterFailure(`generation-failed:${reason}`);
        }
        return result;
      }
      settingsService.setLastBatchGeneratedAt(new Date().toISOString());
      logService.info('Batch generation completed.', {
        reason,
        inserted: result.inserted,
        batchId: result.batchId,
        sourceUrl: result.sourceUrl,
      });
      // Successful generation → notify the post scheduler so it picks up
      // the new items via its append-aware path.
      try {
        // Lazy import to break the import cycle between the two schedulers.
        const mod = await import('./postScheduler.js');
        if (settingsService.get().isRunning) {
          mod.postScheduler.onScheduleAffectingChange('new-batch-from-batch-scheduler');
        }
      } catch (err) {
        logService.warn('postScheduler hook after batch failed.', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return result;
    } finally {
      this.isGenerating = false;
      settingsService.setBatchGenerationRunning(false);
    }
  }

  /**
   * Called by settings.routes when the batch interval / mode changes
   * while automation is running. The interval now only affects the
   * retry-after-failure timer, so we only need to re-arm if we are
   * currently waiting on a retry.
   */
  onSettingsChanged(): void {
    const settings = settingsService.get();
    if (!settings.isRunning) {
      this.clearRetryTimer();
      settingsService.setNextBatchRunAt(null);
      this.retryPending = false;
      logService.info('Batch interval settings changed; cleared stale next_batch_run_at.');
      return;
    }
    if (this.isGenerating) {
      logService.debug('Batch interval settings changed during generation; not rearming.');
      return;
    }
    if (queueService.countPendingOrScheduled() > 0) {
      // Queue has items → batch scheduler is idle.
      this.clearRetryTimer();
      settingsService.setNextBatchRunAt(null);
      this.retryPending = false;
      return;
    }
    if (this.retryPending) {
      // Re-arm the retry with the new interval.
      logService.info('Batch interval settings changed; rearming retry timer.');
      this.scheduleBatchRetryAfterFailure('settings-changed');
      return;
    }
    // Queue empty, not generating, no retry pending → try immediate again.
    logService.info('Batch interval settings changed; attempting immediate refill.');
    void this.ensureQueueHasItemsOrGenerateImmediately('settings-changed');
  }

  isLocked(): boolean {
    return this.isGenerating;
  }

  /** True when a retry-after-failure timer is currently armed. */
  isRetryPending(): boolean {
    return this.retryPending;
  }
}

export const batchScheduler = new BatchScheduler();
