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

export type WriterSubmitMethod = 'ctrl_enter' | 'meta_enter' | 'button_click' | 'none';

export interface PostToWriterResultPayload {
  success: boolean;
  postId: number;
  operationId?: string;
  status?: 'filled' | 'submitted' | 'duplicate_ignored' | 'needs_manual_post';
  autoSubmitted?: boolean;
  /** Which submit strategy actually completed. 'none' when autoSubmit was off. */
  submitMethod?: WriterSubmitMethod;
  duplicate?: boolean;
  /**
   * True when the writer page rejected automated input and the user must
   * paste/post manually. Backend uses this to flip the queue item to
   * `needs_manual_post` instead of `failed`.
   */
  manualActionRequired?: boolean;
  /** True if the writer was able to copy the content to the clipboard. */
  clipboardCopied?: boolean;
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
