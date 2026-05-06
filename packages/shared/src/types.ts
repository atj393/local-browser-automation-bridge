import type { POST_STATUSES, LOG_LEVELS } from './constants.js';

export type PostStatus = typeof POST_STATUSES[number];
export type LogLevel = typeof LOG_LEVELS[number];

export interface AutomationSettings {
  isRunning: boolean;
  llmPrompt: string;
  batchSize: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  autoSubmitWriter: boolean;
  writerUrlPattern: string;
  readerUrlPattern: string;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateSettingsBody {
  llmPrompt: string;
  batchSize: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  autoSubmitWriter: boolean;
  writerUrlPattern: string;
  readerUrlPattern: string;
}

export interface PostQueueItem {
  id: number;
  batchId: string;
  content: string;
  rawJson: string | null;
  status: PostStatus;
  scheduledFor: string | null;
  postedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationLog {
  id: number;
  level: LogLevel;
  message: string;
  detailsJson: string | null;
  createdAt: string;
}

export interface StatusResponse {
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
  lastLog: AutomationLog | null;
}

export type TabRole = 'writer' | 'reader';

export interface NormalizedItem {
  content: string;
  raw: unknown;
}
