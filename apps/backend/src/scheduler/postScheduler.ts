import { settingsService } from '../services/settingsService.js';
import { queueService } from '../services/queueService.js';
import { promptService } from '../services/promptService.js';
import { automationService } from '../services/automationService.js';
import { logService } from '../services/logService.js';
import { isoFromMsFromNow } from '../utils/date.js';
import { getRandomDelay } from './randomDelay.js';

class PostScheduler {
  private timer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    settingsService.setRunning(true);
    logService.info('Automation started.');
    if (queueService.countPendingOrScheduled() === 0) {
      logService.info('Queue empty on start; requesting batch.');
      try {
        await promptService.generateAndStoreBatch();
      } catch (err) {
        logService.error('Failed to generate batch on start.', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.scheduleNextPost();
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

  private scheduleNextPost(): void {
    const settings = settingsService.get();
    if (!settings.isRunning) {
      logService.debug('scheduleNextPost called while stopped; returning.');
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const delayMs = getRandomDelay(settings.minIntervalSeconds, settings.maxIntervalSeconds);
    const nextRunAt = isoFromMsFromNow(delayMs);
    settingsService.setNextRunAt(nextRunAt);
    logService.info(`Next post scheduled in ${Math.round(delayMs / 1000)}s.`, { nextRunAt });
    this.timer = setTimeout(() => {
      this.postNextAndReschedule().catch((err) => {
        logService.error('postNextAndReschedule errored.', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.scheduleNextPost();
      });
    }, delayMs);
  }

  private async postNextAndReschedule(): Promise<void> {
    const settings = settingsService.get();
    if (!settings.isRunning) return;

    if (automationService.isLocked()) {
      logService.warn('Scheduler tick: another post is in flight; rescheduling.');
      this.scheduleNextPost();
      return;
    }

    let item = queueService.findOldestPending();
    if (!item) {
      logService.info('Queue empty; requesting new batch from Gemini.');
      try {
        await promptService.generateAndStoreBatch();
      } catch (err) {
        logService.error('Generating batch failed in scheduler.', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      item = queueService.findOldestPending();
      if (!item) {
        logService.warn('Still no pending items after batch attempt; rescheduling.');
        this.scheduleNextPost();
        return;
      }
    }

    try {
      await automationService.postOne(item);
    } catch (err) {
      logService.error('postOne raised.', {
        postId: item.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (settingsService.get().isRunning) this.scheduleNextPost();
  }
}

export const postScheduler = new PostScheduler();
