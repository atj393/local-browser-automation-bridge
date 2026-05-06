import { randomUUID } from 'node:crypto';

export function newRequestId(): string {
  return randomUUID();
}

export function newBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
