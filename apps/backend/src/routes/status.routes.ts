import { Router } from 'express';
import type {
  StatusResponse,
  NextPostSummary,
  QueueTimelineEntry,
  PostSchedulerStatus,
  BatchSchedulerStatus,
  QueueCountsSummary,
  SchedulerState,
} from '@lbab/shared';
import { settingsService } from '../services/settingsService.js';
import { queueService } from '../services/queueService.js';
import { logService } from '../services/logService.js';
import { extensionGateway } from '../websocket/extensionGateway.js';

export const statusRouter = Router();

const TIMELINE_LIMIT = 10;

function countdownFromIso(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - Date.now()) / 1000));
}

function previewContent(content: string, max = 140): string {
  return content.length <= max ? content : content.slice(0, max).trimEnd() + '…';
}

function formatHms(totalSeconds: number): string {
  if (totalSeconds < 0) return '00:00';
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatDurationHuman(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0 seconds';
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`;
  if (s < 3600 && s % 60 === 0) {
    const m = s / 60;
    return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  }
  if (s % 3600 === 0) {
    const h = s / 3600;
    return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rs = s % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (rs > 0) parts.push(`${rs}s`);
  return parts.join(' ');
}

function bestUnit(seconds: number): { value: number; unit: 'seconds' | 'minutes' | 'hours' } {
  if (seconds <= 0) return { value: 0, unit: 'seconds' };
  if (seconds % 3600 === 0) return { value: seconds / 3600, unit: 'hours' };
  if (seconds % 60 === 0) return { value: seconds / 60, unit: 'minutes' };
  return { value: seconds, unit: 'seconds' };
}

function buildIntervalRangeLabel(minS: number, maxS: number): string {
  const a = bestUnit(minS);
  const b = bestUnit(maxS);
  if (a.unit === b.unit) {
    if (a.value === b.value) return `${a.value} ${a.unit}`;
    return `${a.value}–${b.value} ${a.unit}`;
  }
  return `${formatDurationHuman(minS)} – ${formatDurationHuman(maxS)}`;
}

function buildScheduleWarning(minS: number, maxS: number): string | null {
  if (maxS < 60) return 'Very short intervals are recommended only for local testing.';
  if (maxS > 3600) {
    return 'Your maximum interval is more than 1 hour. The next post may be scheduled much later.';
  }
  return null;
}

function buildAutomationMessage(args: {
  isRunning: boolean;
  pendingCount: number;
  postingCount: number;
  writerConnected: boolean;
  readerConnected: boolean;
  nextPostCountdownSeconds: number | null;
}): string {
  const { isRunning, pendingCount, postingCount, writerConnected, readerConnected } = args;
  if (postingCount > 0) {
    return 'Posting is currently in progress.';
  }
  if (isRunning && !writerConnected) {
    return 'Writer tab is disconnected. Posting cannot continue until the writer tab is ready.';
  }
  if (isRunning) {
    if (pendingCount === 0) {
      if (!readerConnected) {
        return 'Queue is empty and the reader tab is disconnected. Generate batch will not work.';
      }
      return 'Queue is empty. The next batch will be generated automatically.';
    }
    const cd = args.nextPostCountdownSeconds;
    if (cd != null) {
      return `Automation is running. Next post is scheduled in ${formatHms(cd)}.`;
    }
    return 'Automation is running.';
  }
  if (pendingCount === 0) {
    return readerConnected
      ? 'Queue is empty. Generate a batch first.'
      : 'Reader tab is disconnected. Generate batch will not work.';
  }
  return 'Queue is ready, but automation is stopped. Click Start automation to schedule randomized posting.';
}

function buildPostSchedulerStatus(args: {
  isRunning: boolean;
  pendingCount: number;
  postingCount: number;
  writerConnected: boolean;
  firstPending: NextPostSummary | null;
  nextRunAt: string | null;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
}): PostSchedulerStatus {
  const cd =
    args.isRunning && args.firstPending?.scheduledFor
      ? countdownFromIso(args.firstPending.scheduledFor)
      : args.isRunning
        ? countdownFromIso(args.nextRunAt)
        : null;

  let state: SchedulerState;
  let message: string;
  if (!args.isRunning) {
    state = 'stopped';
    message = 'Post scheduler stopped.';
  } else if (args.postingCount > 0) {
    state = 'running';
    message = 'Posting in progress.';
  } else if (args.pendingCount === 0) {
    state = 'waiting-for-batch';
    message = 'Queue is empty. Waiting for the batch scheduler to refill it.';
  } else if (!args.writerConnected) {
    state = 'paused';
    message = 'Writer tab is disconnected; posting paused.';
  } else if (cd != null) {
    state = 'running';
    message = `Next post in ${formatHms(cd)}.`;
  } else {
    state = 'running';
    message = 'Post scheduler running.';
  }

  return {
    state,
    message,
    nextPostRunAt: args.firstPending?.scheduledFor ?? args.nextRunAt,
    nextPostCountdownSeconds: cd,
    minIntervalSeconds: args.minIntervalSeconds,
    maxIntervalSeconds: args.maxIntervalSeconds,
    intervalRangeLabel: buildIntervalRangeLabel(args.minIntervalSeconds, args.maxIntervalSeconds),
    minIntervalLabel: formatDurationHuman(args.minIntervalSeconds),
    maxIntervalLabel: formatDurationHuman(args.maxIntervalSeconds),
    scheduleWarning: buildScheduleWarning(args.minIntervalSeconds, args.maxIntervalSeconds),
    nextPost: args.firstPending,
  };
}

function buildBatchSchedulerStatus(args: {
  isRunning: boolean;
  pendingCount: number;
  readerConnected: boolean;
  nextBatchRunAt: string | null;
  isGeneratingBatch: boolean;
  lastBatchGeneratedAt: string | null;
  batchMinIntervalSeconds: number;
  batchMaxIntervalSeconds: number;
  refillMode: BatchSchedulerStatus['refillMode'];
}): BatchSchedulerStatus {
  const cd = args.isRunning ? countdownFromIso(args.nextBatchRunAt) : null;

  let state: SchedulerState;
  let message: string;
  if (args.isGeneratingBatch) {
    state = 'running';
    message = 'Generating batch now.';
  } else if (!args.isRunning) {
    state = 'stopped';
    message = 'Automation is stopped. Batch generation is paused.';
  } else if (args.pendingCount > 0) {
    state = 'idle';
    message = `Queue has ${args.pendingCount} item${args.pendingCount === 1 ? '' : 's'}. Batch generation is waiting until the queue becomes empty.`;
  } else if (!args.readerConnected) {
    state = 'paused';
    message = 'Reader tab is disconnected. Batch generation cannot run.';
  } else if (args.refillMode === 'immediate') {
    state = 'running';
    message = 'Queue is empty. Generating next batch now.';
  } else if (cd != null) {
    state = 'waiting-for-batch';
    message = `Queue is empty. Next batch will be generated in ${formatHms(cd)}.`;
  } else {
    state = 'waiting-for-batch';
    message = 'Queue is empty. Scheduling next batch.';
  }

  return {
    state,
    message,
    nextBatchRunAt: args.nextBatchRunAt,
    nextBatchCountdownSeconds: cd,
    batchMinIntervalSeconds: args.batchMinIntervalSeconds,
    batchMaxIntervalSeconds: args.batchMaxIntervalSeconds,
    batchIntervalRangeLabel: buildIntervalRangeLabel(
      args.batchMinIntervalSeconds,
      args.batchMaxIntervalSeconds,
    ),
    batchMinIntervalLabel: formatDurationHuman(args.batchMinIntervalSeconds),
    batchMaxIntervalLabel: formatDurationHuman(args.batchMaxIntervalSeconds),
    refillMode: args.refillMode,
    isGeneratingBatch: args.isGeneratingBatch,
    lastBatchGeneratedAt: args.lastBatchGeneratedAt,
  };
}

statusRouter.get('/api/status', (_req, res) => {
  const settings = settingsService.get();
  const counts = queueService.counts();
  const lastLog = logService.last();
  const pending = queueService.listPending();

  const writerConnected = extensionGateway.hasWriter();
  const readerConnected = extensionGateway.hasReader();
  const extensionConnected = extensionGateway.isConnected();

  const firstPending = pending[0] ?? null;
  const nextPost: NextPostSummary | null = firstPending
    ? {
        id: firstPending.id,
        content: firstPending.content,
        status: firstPending.status,
        scheduledFor: firstPending.scheduledFor,
        sourceUrl: firstPending.sourceUrl,
      }
    : null;

  const nextPostCountdownSeconds = settings.isRunning
    ? countdownFromIso(firstPending?.scheduledFor ?? settings.nextRunAt)
    : null;

  const queueTimeline: QueueTimelineEntry[] = pending.slice(0, TIMELINE_LIMIT).map((p, i) => ({
    id: p.id,
    content: previewContent(p.content),
    status: p.status,
    scheduledFor: p.scheduledFor,
    countdownSeconds: settings.isRunning ? countdownFromIso(p.scheduledFor) : null,
    position: i + 1,
    sourceUrl: p.sourceUrl,
  }));

  const queue: QueueCountsSummary = {
    pendingCount: counts.pending,
    scheduledCount: counts.scheduled,
    postingCount: counts.posting,
    postedCount: counts.posted,
    failedCount: counts.failed,
    skippedCount: counts.skipped,
    unpostedCount: counts.pending + counts.scheduled,
  };

  const postSchedulerStatus = buildPostSchedulerStatus({
    isRunning: settings.isRunning,
    pendingCount: counts.pending,
    postingCount: counts.posting,
    writerConnected,
    firstPending: nextPost,
    nextRunAt: settings.nextRunAt,
    minIntervalSeconds: settings.minIntervalSeconds,
    maxIntervalSeconds: settings.maxIntervalSeconds,
  });

  const batchSchedulerStatus = buildBatchSchedulerStatus({
    isRunning: settings.isRunning,
    pendingCount: counts.pending,
    readerConnected,
    nextBatchRunAt: settings.nextBatchRunAt,
    isGeneratingBatch: settings.isBatchGenerationRunning,
    lastBatchGeneratedAt: settings.lastBatchGeneratedAt,
    batchMinIntervalSeconds: settings.batchMinIntervalSeconds,
    batchMaxIntervalSeconds: settings.batchMaxIntervalSeconds,
    refillMode: settings.batchRefillMode,
  });

  const body: StatusResponse = {
    isRunning: settings.isRunning,
    writerConnected,
    readerConnected,
    extensionConnected,
    pendingCount: counts.pending,
    scheduledCount: counts.scheduled,
    postingCount: counts.posting,
    postedCount: counts.posted,
    failedCount: counts.failed,
    skippedCount: counts.skipped,
    nextRunAt: settings.nextRunAt,
    nextPost,
    nextPostCountdownSeconds,
    minIntervalSeconds: settings.minIntervalSeconds,
    maxIntervalSeconds: settings.maxIntervalSeconds,
    intervalRangeLabel: postSchedulerStatus.intervalRangeLabel,
    minIntervalLabel: postSchedulerStatus.minIntervalLabel,
    maxIntervalLabel: postSchedulerStatus.maxIntervalLabel,
    scheduleWarning: postSchedulerStatus.scheduleWarning,
    queueTimeline,
    automationMessage: buildAutomationMessage({
      isRunning: settings.isRunning,
      pendingCount: counts.pending,
      postingCount: counts.posting,
      writerConnected,
      readerConnected,
      nextPostCountdownSeconds,
    }),
    lastLog,
    postScheduler: postSchedulerStatus,
    batchScheduler: batchSchedulerStatus,
    queue,
  };
  res.json(body);
});
