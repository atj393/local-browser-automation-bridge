import type {
  POST_STATUSES,
  LOG_LEVELS,
  SOURCE_MODES,
  BATCH_REFILL_MODES,
  QUEUE_SELECTION_MODES,
} from './constants.js';

export type PostStatus = typeof POST_STATUSES[number];
export type LogLevel = typeof LOG_LEVELS[number];
export type SourceMode = typeof SOURCE_MODES[number];
export type BatchRefillMode = typeof BATCH_REFILL_MODES[number];
export type QueueSelectionMode = typeof QUEUE_SELECTION_MODES[number];

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  isEnabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentSource {
  id: number;
  url: string;
  label: string | null;
  categoryId: number;
  categoryName: string;
  categorySlug: string;
  categoryColor: string | null;
  isEnabled: boolean;
  sortOrder: number;
  lastUsedAt: string | null;
  lastFetchStatus: string | null;
  lastFetchError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryBody {
  name: string;
  description?: string | null;
  color?: string | null;
}

export interface UpdateCategoryBody {
  name?: string;
  description?: string | null;
  color?: string | null;
  isEnabled?: boolean;
  sortOrder?: number;
}

export interface CreateContentSourceBody {
  url: string;
  label?: string | null;
  categoryId: number;
  isEnabled?: boolean;
  sortOrder?: number;
}

export interface UpdateContentSourceBody {
  url?: string;
  label?: string | null;
  categoryId?: number;
  isEnabled?: boolean;
  sortOrder?: number;
}

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
  queueSelectionMode: QueueSelectionMode;
  lastPostedCategoryId: number | null;
  lastSourceId: number | null;
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
  queueSelectionMode: QueueSelectionMode;
}

export interface PostQueueItem {
  id: number;
  batchId: string;
  content: string;
  rawJson: string | null;
  status: PostStatus;
  sourceId: number | null;
  sourceUrl: string | null;
  categoryId: number | null;
  categoryName: string | null;
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
  categoryId: number | null;
  categoryName: string | null;
}

export interface QueueTimelineEntry {
  id: number;
  content: string;
  status: PostStatus;
  scheduledFor: string | null;
  countdownSeconds: number | null;
  position: number;
  sourceUrl: string | null;
  categoryId: number | null;
  categoryName: string | null;
}

export interface CategoryQueueCount {
  categoryId: number | null;
  categoryName: string;
  pendingCount: number;
  postedCount: number;
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

  // Category-aware fields.
  queueSelectionMode: QueueSelectionMode;
  lastPostedCategoryId: number | null;
  lastPostedCategoryName: string | null;
  categoryQueueCounts: CategoryQueueCount[];
}

export type TabRole = 'writer' | 'reader';

export interface NormalizedItem {
  content: string;
  raw: unknown;
}
