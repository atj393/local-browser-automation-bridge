import { settingsService } from '../services/settingsService.js';
import { queueService } from '../services/queueService.js';
import { automationService } from '../services/automationService.js';
import { logService } from '../services/logService.js';
import { getRandomDelay } from './randomDelay.js';
import { batchScheduler } from './batchScheduler.js';

class PostScheduler {
  private timer: NodeJS.Timeout | null = null;

  /**
   * Start automation: assign scheduled_for to every pending row, set
   * next_run_at to the first one, and arm a timer that fires when the
   * earliest scheduled item is due. The batch scheduler is started in
   * parallel by automation.routes; if the queue is empty it owns the
   * decision of when to ask Gemini for a refill.
   */
  start(): void {
    settingsService.setRunning(true);
    logService.info('Automation started.');
    this.recomputeFullSchedule('start');
    this.armTimerForNextDue();
  }

  stop(): void {
    settingsService.setRunning(false);
    settingsService.setNextRunAt(null);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logService.info('Automation stopped.');
  }

  /**
   * Public hook for callers (settings update, new batch arrival) to refresh
   * the schedule while automation is running.
   */
  onScheduleAffectingChange(reason: string): void {
    const settings = settingsService.get();
    if (!settings.isRunning) return;
    if (reason === 'new-batch') {
      this.scheduleAppendOnly();
    } else {
      this.recomputeFullSchedule(reason);
    }
    this.armTimerForNextDue();
  }

  /**
   * Recompute scheduled_for for every pending item starting from `now`.
   * The first item is at now + random(min,max); each subsequent one is
   * previous + random(min,max). next_run_at is the first scheduled time.
   */
  private recomputeFullSchedule(reason: string): void {
    const settings = settingsService.get();
    const items = queueService.listPending();
    if (items.length === 0) {
      settingsService.setNextRunAt(null);
      logService.info('Queue schedule recalculated: empty queue.', { reason });
      return;
    }
    const updates: { id: number; scheduledFor: string }[] = [];
    let cursorMs = Date.now();
    for (const item of items) {
      cursorMs += getRandomDelay(settings.minIntervalSeconds, settings.maxIntervalSeconds);
      updates.push({ id: item.id, scheduledFor: new Date(cursorMs).toISOString() });
    }
    queueService.setSchedule(updates);
    const first = updates[0];
    const last = updates[updates.length - 1];
    if (first) settingsService.setNextRunAt(first.scheduledFor);
    logService.info('Queue schedule recalculated.', {
      reason,
      itemCount: updates.length,
      minInterval: settings.minIntervalSeconds,
      maxInterval: settings.maxIntervalSeconds,
      firstScheduled: first?.scheduledFor,
      lastScheduled: last?.scheduledFor,
    });
  }

  /**
   * Append-only: keep existing scheduled_for values; add new ones starting
   * from the latest existing scheduled_for (or now if none).
   */
  private scheduleAppendOnly(): void {
    const settings = settingsService.get();
    const items = queueService.listPending().filter((i) => i.scheduledFor === null);
    if (items.length === 0) return;
    const anchor = queueService.latestScheduledFor();
    let cursorMs = anchor ? Date.parse(anchor) : Date.now();
    if (Number.isNaN(cursorMs)) cursorMs = Date.now();
    const updates: { id: number; scheduledFor: string }[] = [];
    for (const item of items) {
      cursorMs += getRandomDelay(settings.minIntervalSeconds, settings.maxIntervalSeconds);
      updates.push({ id: item.id, scheduledFor: new Date(cursorMs).toISOString() });
    }
    queueService.setSchedule(updates);
    logService.info('Queue schedule appended for new batch.', {
      itemCount: updates.length,
      from: anchor,
      lastScheduled: updates[updates.length - 1]?.scheduledFor,
    });
    // Ensure next_run_at reflects the earliest pending scheduled time.
    const firstAll = queueService.listPending()[0];
    if (firstAll?.scheduledFor) settingsService.setNextRunAt(firstAll.scheduledFor);
  }

  /**
   * Arm a single timer for the soonest-due pending item. Replaces any
   * existing timer.
   */
  private armTimerForNextDue(): void {
    const settings = settingsService.get();
    if (!settings.isRunning) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const items = queueService.listPending();
    const next = items[0];
    if (!next) {
      settingsService.setNextRunAt(null);
      logService.debug('No pending items; not arming timer.');
      return;
    }
    if (!next.scheduledFor) {
      // Defensive: if a row somehow has no schedule, plan now.
      this.recomputeFullSchedule('no-schedule-recovery');
      return;
    }
    settingsService.setNextRunAt(next.scheduledFor);
    const delayMs = Math.max(0, Date.parse(next.scheduledFor) - Date.now());
    logService.info(`Next post scheduled in ${Math.round(delayMs / 1000)}s.`, {
      postId: next.id,
      scheduledFor: next.scheduledFor,
    });
    this.timer = setTimeout(() => {
      this.fireDueItem().catch((err) => {
        logService.error('fireDueItem errored.', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.armTimerForNextDue();
      });
    }, delayMs);
  }

  private async fireDueItem(): Promise<void> {
    const settings = settingsService.get();
    if (!settings.isRunning) return;

    if (automationService.isLocked()) {
      logService.warn('Scheduler tick: another post is in flight; rescheduling.');
      this.armTimerForNextDue();
      return;
    }

    if (queueService.countPendingOrScheduled() === 0) {
      // Hand off to the batch scheduler. It decides immediate vs random
      // delay and will re-arm the post timer once new items arrive
      // (via onScheduleAffectingChange('new-batch-from-batch-scheduler')).
      logService.info('Post scheduler tick: queue empty; handing off to batch scheduler.');
      settingsService.setNextRunAt(null);
      batchScheduler.onQueueEmpty('post-tick-queue-empty');
      return;
    }

    logService.info('Posting due item.');
    try {
      const result = await automationService.postNext();
      if (result.success) {
        logService.info('Posting completed.', {
          postId: result.postId,
          status: result.resultStatus,
        });
      } else if (!result.noPending) {
        logService.warn('Posting failed in scheduler tick.', {
          postId: result.postId,
          error: result.error,
        });
      }
    } catch (err) {
      logService.error('automationService.postNext raised.', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (settingsService.get().isRunning) {
      if (queueService.countPendingOrScheduled() === 0) {
        logService.info('Last queue item posted; handing off to batch scheduler.');
        settingsService.setNextRunAt(null);
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        batchScheduler.onQueueEmpty('queue-emptied-after-post');
      } else {
        this.armTimerForNextDue();
      }
    }
  }

  isArmed(): boolean {
    return this.timer !== null;
  }
}

export const postScheduler = new PostScheduler();
