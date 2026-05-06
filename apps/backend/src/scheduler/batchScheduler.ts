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
 * Lifecycle (when automation is running):
 *   - Queue has items  → batch scheduler is idle. The post scheduler runs.
 *   - Queue is empty   → onQueueEmpty() decides:
 *       refillMode === 'immediate'    → generateBatchNow() right away.
 *       refillMode === 'random_delay' → arm a setTimeout for
 *                                        now + random(batchMin, batchMax).
 *   - Generation succeeds → recompute the post schedule and let the post
 *                            scheduler resume; clear the batch timer.
 *   - Generation fails    → schedule another attempt using the same random
 *                            range (no immediate retry storm).
 */
class BatchScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isGenerating = false;

  /** Initial assessment when automation starts. */
  start(): void {
    if (queueService.countPendingOrScheduled() === 0) {
      this.onQueueEmpty('automation-started');
    } else {
      logService.info(
        'Batch scheduler started; queue has items, batch generation is idle.',
        { pending: queueService.countPendingOrScheduled() },
      );
      settingsService.setNextBatchRunAt(null);
      this.clearBatchTimer();
    }
  }

  stop(): void {
    this.clearBatchTimer();
    settingsService.setNextBatchRunAt(null);
  }

  clearBatchTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      logService.debug('Batch timer cleared.');
    }
  }

  /**
   * Called by the post scheduler (or at automation start) once the queue
   * runs out.
   */
  onQueueEmpty(reason: string): void {
    const settings = settingsService.get();
    if (!settings.isRunning) {
      logService.debug('Batch scheduler: automation stopped; not arming.');
      return;
    }
    if (this.isGenerating) {
      logService.debug('Batch scheduler: generation already in progress; not arming.');
      return;
    }
    logService.info('Queue empty; scheduling next batch.', {
      reason,
      mode: settings.batchRefillMode,
    });

    if (settings.batchRefillMode === 'immediate') {
      this.clearBatchTimer();
      // Fire on the next tick so the caller can finish whatever it was doing.
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.generateBatchNow('queue-empty-immediate');
      }, 0);
      return;
    }

    // Random delay mode (default).
    const delayMs = getRandomDelay(
      settings.batchMinIntervalSeconds,
      settings.batchMaxIntervalSeconds,
    );
    const nextRunAt = isoFromMsFromNow(delayMs);
    settingsService.setNextBatchRunAt(nextRunAt);
    this.clearBatchTimer();
    logService.info(
      `Batch generation scheduled in ${Math.round(delayMs / 1000)}s.`,
      { nextRunAt },
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.generateBatchNow('batch-timer-fired');
    }, delayMs);
  }

  /**
   * Force a generation right now. Used by the manual /api/batches/generate
   * route, the immediate-refill path, and the timer firing.
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
      logService.warn('Batch generation already in progress.', { reason });
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
    settingsService.setNextBatchRunAt(null);
    logService.info('Batch generation started.', { reason });

    try {
      const result = await promptService.generateAndStoreBatch();
      if (result.error) {
        logService.error('Batch generation failed.', { reason, error: result.error });
        // Schedule another attempt later if automation is running.
        if (settingsService.get().isRunning) {
          this.onQueueEmpty('batch-generation-failed-retry');
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
   * Called by settings.routes when the batch interval / mode changes while
   * automation is running. Re-evaluates only if we are currently waiting
   * (queue empty + timer armed).
   */
  onSettingsChanged(): void {
    const settings = settingsService.get();
    if (!settings.isRunning) {
      // Don't actively rearm while stopped, but clear stale next_batch_run_at
      // so the dashboard doesn't show ghost countdowns from old values.
      this.clearBatchTimer();
      settingsService.setNextBatchRunAt(null);
      logService.info('Batch interval settings changed; cleared stale next_batch_run_at.');
      return;
    }
    if (this.isGenerating) {
      logService.debug('Batch interval settings changed during generation; not rearming.');
      return;
    }
    if (queueService.countPendingOrScheduled() > 0) {
      // Queue has items → batch scheduler is idle. Nothing to do; the new
      // interval will apply the next time the queue empties.
      this.clearBatchTimer();
      settingsService.setNextBatchRunAt(null);
      return;
    }
    // Queue empty + running + not generating → re-arm with the new interval.
    logService.info('Batch interval settings changed; batch schedule recalculated.');
    this.onQueueEmpty('settings-changed');
  }

  isLocked(): boolean {
    return this.isGenerating;
  }
}

export const batchScheduler = new BatchScheduler();
