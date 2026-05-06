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
  source_url: string | null;
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
    sourceUrl: row.source_url ?? null,
    scheduledFor: row.scheduled_for,
    postedAt: row.posted_at,
    failedAt: row.failed_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const queueService = {
  insertBatch(
    items: NormalizedItem[],
    options?: { sourceUrl?: string | null },
  ): { batchId: string; items: PostQueueItem[] } {
    const db = getDb();
    const batchId = newBatchId();
    const now = nowIso();
    const sourceUrl = options?.sourceUrl ?? null;
    const stmt = db.prepare(
      `INSERT INTO post_queue (batch_id, content, raw_json, status, source_url, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    );
    const ids: number[] = [];
    db.exec('BEGIN');
    try {
      for (const item of items) {
        const result = stmt.run(
          batchId,
          item.content,
          safeStringify(item.raw),
          sourceUrl,
          now,
          now,
        );
        ids.push(Number(result.lastInsertRowid));
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const inserted = ids
      .map((id) =>
        db.prepare('SELECT * FROM post_queue WHERE id = ?').get(id) as
          | unknown as QueueRow
          | undefined,
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
      | unknown as QueueRow | undefined;
    return row ? rowToItem(row) : null;
  },

  findOldestPending(): PostQueueItem | null {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM post_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
      .get() as unknown as QueueRow | undefined;
    return row ? rowToItem(row) : null;
  },

  /**
   * Atomically claim the oldest pending row, flipping it to `posting`.
   * Uses a transaction with a conditional UPDATE so two concurrent callers
   * cannot both claim the same row.
   *
   * Returns the claimed item, or null if no pending row exists.
   */
  claimNextPendingPost(): PostQueueItem | null {
    const db = getDb();
    const now = nowIso();
    let claimedId: number | null = null;
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db
        .prepare(
          "SELECT id FROM post_queue WHERE status = 'pending' ORDER BY created_at ASC, id ASC LIMIT 1",
        )
        .get() as { id?: number } | undefined;
      const id = row?.id;
      if (id != null) {
        const result = db
          .prepare(
            "UPDATE post_queue SET status = 'posting', updated_at = ? WHERE id = ? AND status = 'pending'",
          )
          .run(now, id);
        if (Number(result.changes) === 1) claimedId = id;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    if (claimedId == null) return null;
    return this.getById(claimedId);
  },

  /**
   * Atomically claim a specific pending row by id. Returns null if the
   * row does not exist or is not currently `pending`.
   */
  claimPostById(id: number): PostQueueItem | null {
    const db = getDb();
    const now = nowIso();
    let ok = false;
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db
        .prepare(
          "UPDATE post_queue SET status = 'posting', updated_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(now, id);
      ok = Number(result.changes) === 1;
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    if (!ok) return null;
    return this.getById(id);
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

  /**
   * Returns all unposted (pending) items in stable order. Used by the
   * scheduler to compute / re-compute the posting plan.
   */
  listPending(): PostQueueItem[] {
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT * FROM post_queue WHERE status = 'pending' ORDER BY created_at ASC, id ASC",
      )
      .all() as unknown as QueueRow[];
    return rows.map(rowToItem);
  },

  /**
   * Returns the latest scheduled_for value among unposted (pending) items, or null.
   * Used to append new batches to an existing posting plan without overlap.
   */
  latestScheduledFor(): string | null {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT scheduled_for FROM post_queue WHERE status = 'pending' AND scheduled_for IS NOT NULL ORDER BY scheduled_for DESC LIMIT 1",
      )
      .get() as { scheduled_for?: string | null } | undefined;
    return row?.scheduled_for ?? null;
  },

  /**
   * Bulk-update scheduled_for for the given pending ids in order. Atomic.
   */
  setSchedule(updates: { id: number; scheduledFor: string }[]): void {
    if (updates.length === 0) return;
    const db = getDb();
    const stmt = db.prepare(
      "UPDATE post_queue SET scheduled_for = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    );
    db.exec('BEGIN');
    try {
      const now = nowIso();
      for (const u of updates) stmt.run(u.scheduledFor, now, u.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  /**
   * Clear scheduled_for on all currently-pending rows (used when stopping or
   * recomputing the plan from scratch).
   */
  clearSchedule(): void {
    const db = getDb();
    db.prepare(
      "UPDATE post_queue SET scheduled_for = NULL, updated_at = ? WHERE status = 'pending'",
    ).run(nowIso());
  },
};
