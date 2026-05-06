import type { POST_STATUSES, LOG_LEVELS, SOURCE_MODES, BATCH_REFILL_MODES } from './constants.js';

export type PostStatus = typeof POST_STATUSES[number];
export type LogLevel = typeof LOG_LEVELS[number];
export type SourceMode = typeof SOURCE_MODES[number];
export type BatchRefillMode = typeof BATCH_REFILL_MODES[number];

export interface AutomationSettings {
  isRunning: boolean;
  llmPrompt: string;
  batchSize: number;
  postsPerGeneration: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  autoSubmitWriter: boolean;
  writerUrlPattern: string;
  readerUrlPattern: string;
  sourceUrls: string[];
  sourceMode: SourceMode;
  lastSourceIndex: number;
  lastSourceUrl: string | null;
  batchMinIntervalSeconds: number;
  batchMaxIntervalSeconds: number;
  batchRefillMode: BatchRefillMode;
  nextBatchRunAt: string | null;
  lastBatchGeneratedAt: string | null;
  isBatchGenerationRunning: boolean;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateSettingsBody {
  llmPrompt: string;
  batchSize?: number;
  postsPerGeneration: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  autoSubmitWriter: boolean;
  writerUrlPattern: string;
  readerUrlPattern: string;
  sourceUrls: string[];
  sourceMode: SourceMode;
  batchMinIntervalSeconds: number;
  batchMaxIntervalSeconds: number;
  batchRefillMode: BatchRefillMode;
}

export interface PostQueueItem {
  id: number;
  batchId: string;
  content: string;
  rawJson: string | null;
  status: PostStatus;
  sourceUrl: string | null;
  scheduledFor: string | null;
  postedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  /** Computed by /api/posts at request time. Pending+scheduled items only. */
  countdownSeconds?: number | null;
  /** Computed by /api/posts: 1-based queue position among pending items. */
  queuePosition?: number | null;
}

export interface AutomationLog {
  id: number;
  level: LogLevel;
  message: string;
  detailsJson: string | null;
  createdAt: string;
}

export interface NextPostSummary {
  id: number;
  content: string;
  status: PostStatus;
  scheduledFor: string | null;
  sourceUrl: string | null;
}

export interface QueueTimelineEntry {
  id: number;
  content: string;
  status: PostStatus;
  scheduledFor: string | null;
  countdownSeconds: number | null;
  position: number;
  sourceUrl: string | null;
}

export type SchedulerState =
  | 'idle'
  | 'running'
  | 'waiting-for-batch'
  | 'paused'
  | 'stopped';

export interface PostSchedulerStatus {
  state: SchedulerState;
  message: string;
  nextPostRunAt: string | null;
  nextPostCountdownSeconds: number | null;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  intervalRangeLabel: string;
  minIntervalLabel: string;
  maxIntervalLabel: string;
  scheduleWarning: string | null;
  nextPost: NextPostSummary | null;
}

export interface BatchSchedulerStatus {
  state: SchedulerState;
  message: string;
  nextBatchRunAt: string | null;
  nextBatchCountdownSeconds: number | null;
  batchMinIntervalSeconds: number;
  batchMaxIntervalSeconds: number;
  batchIntervalRangeLabel: string;
  batchMinIntervalLabel: string;
  batchMaxIntervalLabel: string;
  refillMode: BatchRefillMode;
  isGeneratingBatch: boolean;
  lastBatchGeneratedAt: string | null;
}

export interface QueueCountsSummary {
  pendingCount: number;
  scheduledCount: number;
  postingCount: number;
  postedCount: number;
  failedCount: number;
  skippedCount: number;
  unpostedCount: number;
}

export interface StatusResponse {
  // Top-level (kept for backward compat with the existing dashboard).
  isRunning: boolean;
  writerConnected: boolean;
  readerConnected: boolean;
  extensionConnected: boolean;
  pendingCount: number;
  scheduledCount: number;
  postingCount: number;
  postedCount: number;
  failedCount: number;
  skippedCount: number;
  nextRunAt: string | null;
  nextPost: NextPostSummary | null;
  nextPostCountdownSeconds: number | null;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  /** Plain-English range, e.g. "1–4 minutes" or "1h 23m 20s – 2h 30m". */
  intervalRangeLabel: string;
  /** Plain-English duration, e.g. "1 minute". */
  minIntervalLabel: string;
  /** Plain-English duration, e.g. "4 minutes". */
  maxIntervalLabel: string;
  /** Non-null when the interval is unusually short or long. */
  scheduleWarning: string | null;
  queueTimeline: QueueTimelineEntry[];
  automationMessage: string;
  lastLog: AutomationLog | null;

  // New structured shape for the two automation loops.
  postScheduler: PostSchedulerStatus;
  batchScheduler: BatchSchedulerStatus;
  queue: QueueCountsSummary;
}

export type TabRole = 'writer' | 'reader';

export interface NormalizedItem {
  content: string;
  raw: unknown;
}
