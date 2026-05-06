import type { TabRole } from './types.js';

export type WsMessageType =
  | 'REGISTER_EXTENSION'
  | 'REGISTER_EXTENSION_ACK'
  | 'TAB_ROLE_AVAILABLE'
  | 'TAB_ROLE_REMOVED'
  | 'GENERATE_NEXT_BATCH'
  | 'GENERATE_NEXT_BATCH_RESULT'
  | 'POST_TO_WRITER'
  | 'POST_TO_WRITER_RESULT'
  | 'PING'
  | 'PONG';

export interface WsBaseMessage<TPayload = unknown> {
  type: WsMessageType;
  requestId: string;
  payload: TPayload;
}

export interface RegisterExtensionPayload {
  extensionId: string;
  version: string;
}

export interface TabRoleAvailablePayload {
  role: TabRole;
  tabId: number;
  url: string;
}

export interface TabRoleRemovedPayload {
  role: TabRole;
  tabId: number;
}

export interface GenerateNextBatchPayload {
  prompt: string;
  batchSize: number;
}

export interface GenerateNextBatchResultPayload {
  success: boolean;
  rawText?: string;
  url?: string;
  error?: string;
}

export interface PostToWriterPayload {
  postId: number;
  content: string;
  autoSubmit: boolean;
  /**
   * Deterministic id for a single post attempt. Format: `post:<postId>:<requestId>`.
   * Used to dedupe across backend / background / content script.
   */
  operationId: string;
}

export interface PostToWriterResultPayload {
  success: boolean;
  postId: number;
  operationId?: string;
  status?: 'filled' | 'submitted' | 'duplicate_ignored';
  autoSubmitted?: boolean;
  duplicate?: boolean;
  url?: string;
  error?: string;
}

// Background <-> content script (chrome.runtime.sendMessage)
export type RuntimeMessageType =
  | 'POST_TO_WRITER_CONTENT'
  | 'POST_TO_WRITER_CONTENT_RESULT'
  | 'GENERATE_NEXT_BATCH_CONTENT'
  | 'GENERATE_NEXT_BATCH_CONTENT_RESULT'
  | 'CONTENT_HELLO';

export interface RuntimeMessage<TPayload = unknown> {
  type: RuntimeMessageType;
  requestId: string;
  payload: TPayload;
}
