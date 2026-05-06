import type { PostQueueItem, PostStatus, NormalizedItem } from '@lbab/shared';
import { MAX_CONTENT_LENGTH } from '@lbab/shared';
import { getDb } from '../db/database.js';
import { nowIso } from '../utils/date.js';
import { newBatchId } from '../utils/ids.js';
import { safeStringify } from '../utils/safeJson.js';

interface QueueRow {
  id: number;
  batch_id: string;
  content: string;
  raw_json: string | null;
  status: PostStatus;
  scheduled_for: string | null;
  posted_at: string | null;
  failed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function rowToItem(row: QueueRow): PostQueueItem {
  return {
    id: row.id,
    batchId: row.batch_id,
    content: row.content,
    rawJson: row.raw_json,
    status: row.status,
    scheduledFor: row.scheduled_for,
    postedAt: row.posted_at,
    failedAt: row.failed_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const queueService = {
  insertBatch(items: NormalizedItem[]): { batchId: string; items: PostQueueItem[] } {
    const db = getDb();
    const batchId = newBatchId();
    const now = nowIso();
    const stmt = db.prepare(
      `INSERT INTO post_queue (batch_id, content, raw_json, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    );
    const ids: number[] = [];
    db.exec('BEGIN');
    try {
      for (const item of items) {
        const result = stmt.run(batchId, item.content, safeStringify(item.raw), now, now);
        ids.push(Number(result.lastInsertRowid));
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const inserted = ids
      .map((id) =>
        db.prepare('SELECT * FROM post_queue WHERE id = ?').get(id) as QueueRow | undefined,
      )
      .filter((r): r is QueueRow => !!r)
      .map(rowToItem);
    return { batchId, items: inserted };
  },

  list(filter: { status?: PostStatus; limit?: number; offset?: number }): PostQueueItem[] {
    const db = getDb();
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
    const offset = Math.max(filter.offset ?? 0, 0);
    if (filter.status) {
      const rows = db
        .prepare(
          'SELECT * FROM post_queue WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        )
        .all(filter.status, limit, offset) as unknown as QueueRow[];
      return rows.map(rowToItem);
    }
    const rows = db
      .prepare('SELECT * FROM post_queue ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as unknown as QueueRow[];
    return rows.map(rowToItem);
  },

  getById(id: number): PostQueueItem | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM post_queue WHERE id = ?').get(id) as
      | QueueRow
      | undefined;
    return row ? rowToItem(row) : null;
  },

  findOldestPending(): PostQueueItem | null {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM post_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
      .get() as QueueRow | undefined;
    return row ? rowToItem(row) : null;
  },

  setStatus(
    id: number,
    status: PostStatus,
    extra?: { errorMessage?: string | null; postedAt?: string | null; failedAt?: string | null; scheduledFor?: string | null },
  ): PostQueueItem | null {
    const db = getDb();
    const current = this.getById(id);
    if (!current) return null;
    const now = nowIso();
    db.prepare(
      `UPDATE post_queue
       SET status = ?,
           error_message = COALESCE(?, error_message),
           posted_at = COALESCE(?, posted_at),
           failed_at = COALESCE(?, failed_at),
           scheduled_for = COALESCE(?, scheduled_for),
           updated_at = ?
       WHERE id = ?`,
    ).run(
      status,
      extra?.errorMessage ?? null,
      extra?.postedAt ?? null,
      extra?.failedAt ?? null,
      extra?.scheduledFor ?? null,
      now,
      id,
    );
    return this.getById(id);
  },

  counts(): Record<PostStatus, number> {
    const db = getDb();
    const rows = db
      .prepare('SELECT status, COUNT(*) as c FROM post_queue GROUP BY status')
      .all() as { status: PostStatus; c: number }[];
    const out: Record<PostStatus, number> = {
      pending: 0,
      scheduled: 0,
      posting: 0,
      posted: 0,
      failed: 0,
      skipped: 0,
    };
    for (const r of rows) out[r.status] = r.c;
    return out;
  },

  countPendingOrScheduled(): number {
    const counts = this.counts();
    return counts.pending + counts.scheduled;
  },

  clear(status?: PostStatus): number {
    const db = getDb();
    if (status) {
      const result = db.prepare('DELETE FROM post_queue WHERE status = ?').run(status);
      return Number(result.changes);
    }
    const result = db.prepare('DELETE FROM post_queue').run();
    return Number(result.changes);
  },

  truncateContent(content: string): { trimmed: string; wasTrimmed: boolean } {
    if (content.length <= MAX_CONTENT_LENGTH) return { trimmed: content, wasTrimmed: false };
    return { trimmed: content.slice(0, MAX_CONTENT_LENGTH), wasTrimmed: true };
  },
};
