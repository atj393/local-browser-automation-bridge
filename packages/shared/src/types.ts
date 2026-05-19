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
  /**
   * How long the extension waits for Gemini's response before declaring
   * a timeout. Bump this when using Gemini's "thinking" mode, which can
   * take a minute or more before the final answer streams in.
   */
  geminiResponseTimeoutSeconds: number;
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
  geminiResponseTimeoutSeconds: number;
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

/**
 * Health for the long-lived extension websocket connection. `stale` is
 * true when the connection looks open but no message has been received
 * recently. `lastSeenAt` is the most recent message timestamp.
 */
export interface ExtensionConnectionStatus {
  connected: boolean;
  lastSeenAt: string | null;
  stale: boolean;
  message: string;
}

export type TabReadiness =
  | 'ready'
  | 'stale'
  | 'url-found'
  | 'disconnected';

/**
 * Health for a single reader/writer tab. Distinguishes between
 * "ready" (content script heartbeat is fresh), "stale" (was ready,
 * heartbeat went silent), "url-found" (a matching tab exists but the
 * content script never answered), and "disconnected".
 */
export interface TabConnectionStatus {
  readiness: TabReadiness;
  connected: boolean;
  stale: boolean;
  url: string | null;
  lastSeenAt: string | null;
  message: string;
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

  // Detailed connection health (so the dashboard can distinguish
  // "URL found but content script not responding" from "disconnected").
  extensionStatus: ExtensionConnectionStatus;
  readerStatus: TabConnectionStatus;
  writerStatus: TabConnectionStatus;
}

export type TabRole = 'writer' | 'reader';

/**
 * Per-user identity, preferences, and writing rules used to shape
 * generated posts. Persisted as JSON so the schema can evolve without
 * a migration. `isEnabled` is the master switch: when false the
 * prompt builder ignores the profile entirely.
 */
export interface PersonalProfileHashtagPreferences {
  enabled: boolean;
  min: number;
  max: number;
  preferred: string[];
  avoid: string[];
}

export interface PersonalProfileTone {
  primary: string[];
  avoid: string[];
}

export interface PersonalProfile {
  whoAmI: string;
  shortBio: string;
  likes: string[];
  dislikes: string[];
  avoidTopics: string[];
  tone: PersonalProfileTone;
  geographicPreferences: string[];
  topicInterests: string[];
  values: string[];
  writingRules: string[];
  hashtagPreferences: PersonalProfileHashtagPreferences;
  languagePreference: string;
  customInstructions: string;
  /**
   * Per-profile safety rules. The backend always appends a fixed
   * non-negotiable safety block on top of these.
   */
  safetyRules: string[];
}

export interface PersonalProfileResponse {
  isEnabled: boolean;
  profile: PersonalProfile;
  updatedAt: string;
}

export interface UpdatePersonalProfileRequest {
  isEnabled?: boolean;
  profile?: Partial<PersonalProfile>;
}

export interface NormalizedItem {
  content: string;
  raw: unknown;
}
