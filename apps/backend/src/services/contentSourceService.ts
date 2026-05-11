import type {
  ContentSource,
  CreateContentSourceBody,
  SourceMode,
  UpdateContentSourceBody,
} from '@lbab/shared';
import { getDb } from '../db/database.js';
import { nowIso } from '../utils/date.js';
import { categoryService } from './categoryService.js';

interface ContentSourceRow {
  id: number;
  url: string;
  label: string | null;
  category_id: number;
  is_enabled: number;
  sort_order: number;
  last_used_at: string | null;
  last_fetch_status: string | null;
  last_fetch_error: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  category_name: string;
  category_slug: string;
  category_color: string | null;
}

function rowToSource(row: ContentSourceRow): ContentSource {
  return {
    id: row.id,
    url: row.url,
    label: row.label,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
    categoryColor: row.category_color,
    isEnabled: !!row.is_enabled,
    sortOrder: row.sort_order,
    lastUsedAt: row.last_used_at,
    lastFetchStatus: row.last_fetch_status,
    lastFetchError: row.last_fetch_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_WITH_CATEGORY = `
  SELECT cs.*,
         c.name AS category_name,
         c.slug AS category_slug,
         c.color AS category_color
  FROM content_sources cs
  JOIN categories c ON c.id = cs.category_id
`;

export const contentSourceService = {
  list(): ContentSource[] {
    const db = getDb();
    const rows = db
      .prepare(`${SELECT_WITH_CATEGORY} ORDER BY cs.sort_order ASC, cs.id ASC`)
      .all() as unknown as ContentSourceRow[];
    return rows.map(rowToSource);
  },

  getById(id: number): ContentSource | null {
    const db = getDb();
    const row = db
      .prepare(`${SELECT_WITH_CATEGORY} WHERE cs.id = ?`)
      .get(id) as unknown as ContentSourceRow | undefined;
    return row ? rowToSource(row) : null;
  },

  listEnabled(): ContentSource[] {
    return this.list().filter((s) => s.isEnabled);
  },

  create(body: CreateContentSourceBody): ContentSource {
    const url = body.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('URL must start with http:// or https://');
    }
    const category = categoryService.getById(body.categoryId);
    if (!category) throw new Error('Category not found.');
    const db = getDb();
    const now = nowIso();
    const maxOrder =
      (db.prepare('SELECT MAX(sort_order) as m FROM content_sources').get() as { m?: number })
        ?.m ?? -1;
    const sortOrder = body.sortOrder ?? maxOrder + 1;
    const result = db
      .prepare(
        `INSERT INTO content_sources
           (url, label, category_id, is_enabled, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        url,
        body.label?.trim() ? body.label.trim() : null,
        body.categoryId,
        body.isEnabled === false ? 0 : 1,
        sortOrder,
        now,
        now,
      );
    const id = Number(result.lastInsertRowid);
    const created = this.getById(id);
    if (!created) throw new Error('Failed to create content source.');
    return created;
  },

  update(id: number, body: UpdateContentSourceBody): ContentSource {
    const current = this.getById(id);
    if (!current) throw new Error('Content source not found.');
    if (body.url !== undefined && !/^https?:\/\//i.test(body.url.trim())) {
      throw new Error('URL must start with http:// or https://');
    }
    if (body.categoryId !== undefined) {
      const category = categoryService.getById(body.categoryId);
      if (!category) throw new Error('Category not found.');
    }
    const db = getDb();
    db.prepare(
      `UPDATE content_sources
       SET url = ?, label = ?, category_id = ?, is_enabled = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      body.url !== undefined ? body.url.trim() : current.url,
      body.label !== undefined ? (body.label?.trim() ? body.label.trim() : null) : current.label,
      body.categoryId !== undefined ? body.categoryId : current.categoryId,
      body.isEnabled !== undefined ? (body.isEnabled ? 1 : 0) : current.isEnabled ? 1 : 0,
      body.sortOrder !== undefined ? body.sortOrder : current.sortOrder,
      nowIso(),
      id,
    );
    const updated = this.getById(id);
    if (!updated) throw new Error('Failed to update content source.');
    return updated;
  },

  remove(id: number): void {
    const db = getDb();
    db.prepare('DELETE FROM content_sources WHERE id = ?').run(id);
  },

  /**
   * Returns the next enabled source using `mode` and the persisted
   * `lastSourceId`. Falls back to null when no enabled source exists.
   */
  chooseNext(
    mode: SourceMode,
    lastSourceId: number | null,
  ): ContentSource | null {
    if (mode === 'none') return null;
    const enabled = this.listEnabled();
    if (enabled.length === 0) return null;
    if (mode === 'first') return enabled[0] ?? null;
    // rotate
    if (lastSourceId == null) return enabled[0] ?? null;
    const lastIdx = enabled.findIndex((s) => s.id === lastSourceId);
    const nextIdx = lastIdx >= 0 ? (lastIdx + 1) % enabled.length : 0;
    return enabled[nextIdx] ?? null;
  },

  markUsed(
    id: number,
    status: 'ok' | 'error',
    error?: string | null,
  ): void {
    const db = getDb();
    db.prepare(
      `UPDATE content_sources
         SET last_used_at = ?, last_fetch_status = ?, last_fetch_error = ?, updated_at = ?
       WHERE id = ?`,
    ).run(nowIso(), status, error ?? null, nowIso(), id);
  },
};
