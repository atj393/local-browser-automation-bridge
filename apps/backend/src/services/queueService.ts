import type {
  PostQueueItem,
  PostStatus,
  NormalizedItem,
  QueueSelectionMode,
} from '@lbab/shared';
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
  source_id: number | null;
  source_url: string | null;
  category_id: number | null;
  category_name: string | null;
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
    sourceId: row.source_id ?? null,
    sourceUrl: row.source_url ?? null,
    categoryId: row.category_id ?? null,
    categoryName: row.category_name ?? null,
    scheduledFor: row.scheduled_for,
    postedAt: row.posted_at,
    failedAt: row.failed_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Pure ordering helper. Given a list of pending items, produces the order in
 * which they should be posted under `mode`, starting from `lastCategoryId`.
 *
 * For `rotate_categories`: repeatedly picks the oldest remaining item whose
 * category differs from the previous pick (with `lastCategoryId` as the
 * seed). Falls back to oldest overall when only one category remains.
 *
 * For `oldest_first`: returns items unchanged (assumed already in oldest-
 * first order).
 */
export function orderItemsForPosting(
  items: PostQueueItem[],
  lastCategoryId: number | null,
  mode: QueueSelectionMode,
): PostQueueItem[] {
  if (mode === 'oldest_first' || items.length <= 1) return [...items];
  // Group by category, preserving input order (which is oldest-first).
  const byCategory = new Map<number | null, PostQueueItem[]>();
  for (const it of items) {
    const key = it.categoryId;
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(it);
    else byCategory.set(key, [it]);
  }
  const result: PostQueueItem[] = [];
  let prev: number | null = lastCategoryId;
  while (
    Array.from(byCategory.values()).some((b) => b.length > 0)
  ) {
    // Candidate categories with non-empty buckets and not equal to prev.
    const nonEmptyKeys = Array.from(byCategory.entries())
      .filter(([, b]) => b.length > 0)
      .map(([k]) => k);
    const otherKeys = nonEmptyKeys.filter((k) => k !== prev);
    const pickKey = otherKeys.length > 0 ? otherKeys : nonEmptyKeys;
    // Within the candidate set, pick the category whose oldest item has
    // the earliest created_at. This gives a stable rotation that respects
    // queue age within each category.
    let chosenKey: number | null = pickKey[0]!;
    let chosenOldest = byCategory.get(chosenKey)![0]!.createdAt;
    for (let i = 1; i < pickKey.length; i++) {
      const k = pickKey[i]!;
      const head = byCategory.get(k)![0]!;
      if (head.createdAt < chosenOldest) {
        chosenKey = k;
        chosenOldest = head.createdAt;
      }
    }
    const picked = byCategory.get(chosenKey)!.shift()!;
    result.push(picked);
    prev = picked.categoryId;
  }
  return result;
}

export const queueService = {
  orderItemsForPosting,
  insertBatch(
    items: NormalizedItem[],
    options?: {
      sourceId?: number | null;
      sourceUrl?: string | null;
      categoryId?: number | null;
      categoryName?: string | null;
    },
  ): { batchId: string; items: PostQueueItem[] } {
    const db = getDb();
    const batchId = newBatchId();
    const now = nowIso();
    const sourceId = options?.sourceId ?? null;
    const sourceUrl = options?.sourceUrl ?? null;
    const categoryId = options?.categoryId ?? null;
    const categoryName = options?.categoryName ?? null;
    const stmt = db.prepare(
      `INSERT INTO post_queue
         (batch_id, content, raw_json, status, source_id, source_url, category_id, category_name, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    );
    const ids: number[] = [];
    db.exec('BEGIN');
    try {
      for (const item of items) {
        const result = stmt.run(
          batchId,
          item.content,
          safeStringify(item.raw),
          sourceId,
          sourceUrl,
          categoryId,
          categoryName,
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
   * Category-aware claim. For `mode === 'rotate_categories'`, prefers the
   * oldest pending item whose category differs from `lastPostedCategoryId`
   * — but falls back to the absolute oldest pending row when no other
   * category is available. For `mode === 'oldest_first'`, identical to
   * `claimNextPendingPost()`.
   *
   * The most important correctness rule for the rotate mode: if multiple
   * categories are pending, the next claimed item MUST NOT be in the same
   * category as the last posted item. If only one category is pending,
   * claim from it.
   */
  claimNextPostForPosting(
    mode: 'oldest_first' | 'rotate_categories',
    lastPostedCategoryId: number | null,
  ): PostQueueItem | null {
    const db = getDb();
    const now = nowIso();
    let claimedId: number | null = null;
    db.exec('BEGIN IMMEDIATE');
    try {
      let id: number | undefined;
      if (mode === 'rotate_categories') {
        // Distinct categories present in pending rows (null counts as its own bucket).
        const distinct = db
          .prepare(
            "SELECT DISTINCT category_id FROM post_queue WHERE status = 'pending'",
          )
          .all() as { category_id: number | null }[];
        const distinctCount = distinct.length;
        if (distinctCount > 1) {
          // Prefer oldest item whose category differs from last posted.
          let row: { id?: number } | undefined;
          if (lastPostedCategoryId === null) {
            row = db
              .prepare(
                "SELECT id FROM post_queue WHERE status = 'pending' AND category_id IS NOT NULL ORDER BY created_at ASC, id ASC LIMIT 1",
              )
              .get() as { id?: number } | undefined;
          } else {
            row = db
              .prepare(
                "SELECT id FROM post_queue WHERE status = 'pending' AND (category_id IS NULL OR category_id != ?) ORDER BY created_at ASC, id ASC LIMIT 1",
              )
              .get(lastPostedCategoryId) as { id?: number } | undefined;
          }
          // If no alternative bucket somehow (shouldn't happen given distinctCount>1
          // but be safe), fall back to oldest pending.
          if (!row?.id) {
            row = db
              .prepare(
                "SELECT id FROM post_queue WHERE status = 'pending' ORDER BY created_at ASC, id ASC LIMIT 1",
              )
              .get() as { id?: number } | undefined;
          }
          id = row?.id;
        } else {
          // Only one category in pending → just oldest.
          const row = db
            .prepare(
              "SELECT id FROM post_queue WHERE status = 'pending' ORDER BY created_at ASC, id ASC LIMIT 1",
            )
            .get() as { id?: number } | undefined;
          id = row?.id;
        }
      } else {
        const row = db
          .prepare(
            "SELECT id FROM post_queue WHERE status = 'pending' ORDER BY created_at ASC, id ASC LIMIT 1",
          )
          .get() as { id?: number } | undefined;
        id = row?.id;
      }
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
      needs_manual_post: 0,
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
   * Returns all unposted (pending) items in **posting order** — earliest
   * scheduled_for first, NULLs (unscheduled) last, then created_at / id
   * as tie-breakers.
   *
   * Every caller that reasons about "what posts next" uses this:
   *   - status route to pick the dashboard's `nextPost` card
   *   - postScheduler to arm its timer
   *   - queue route to assign 1-based queue positions
   *
   * For consumers that need the canonical *oldest-first by created_at*
   * order (the input to category rotation), use `listPendingByCreatedAt`.
   */
  listPending(): PostQueueItem[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM post_queue
         WHERE status = 'pending'
         ORDER BY scheduled_for IS NULL ASC,
                  scheduled_for ASC,
                  created_at ASC,
                  id ASC`,
      )
      .all() as unknown as QueueRow[];
    return rows.map(rowToItem);
  },

  /**
   * Oldest-first ordering by created_at / id. This is the canonical
   * input order for category rotation: within each category bucket,
   * items must be oldest-first so the rotation picks the oldest item
   * from each category in turn. Do NOT use this for "what posts next".
   */
  listPendingByCreatedAt(): PostQueueItem[] {
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
