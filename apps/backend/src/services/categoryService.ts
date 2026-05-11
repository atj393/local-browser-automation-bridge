import type { Category, CreateCategoryBody, UpdateCategoryBody } from '@lbab/shared';
import { getDb } from '../db/database.js';
import { nowIso } from '../utils/date.js';

interface CategoryRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  is_enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    color: row.color,
    isEnabled: !!row.is_enabled,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const categoryService = {
  list(): Category[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM categories ORDER BY sort_order ASC, id ASC')
      .all() as unknown as CategoryRow[];
    return rows.map(rowToCategory);
  },

  getById(id: number): Category | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as
      | unknown as CategoryRow
      | undefined;
    return row ? rowToCategory(row) : null;
  },

  getBySlug(slug: string): Category | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug) as
      | unknown as CategoryRow
      | undefined;
    return row ? rowToCategory(row) : null;
  },

  create(body: CreateCategoryBody): Category {
    const name = body.name.trim();
    if (!name) throw new Error('Category name is required.');
    const slug = slugify(name);
    if (!slug) throw new Error('Category name must contain alphanumeric characters.');
    const db = getDb();
    const existing = db
      .prepare('SELECT id FROM categories WHERE slug = ? OR name = ?')
      .get(slug, name);
    if (existing) throw new Error('A category with that name already exists.');
    const now = nowIso();
    const maxOrder =
      (db.prepare('SELECT MAX(sort_order) as m FROM categories').get() as { m?: number })
        ?.m ?? -1;
    const result = db
      .prepare(
        `INSERT INTO categories (name, slug, description, color, is_enabled, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(name, slug, body.description ?? null, body.color ?? null, maxOrder + 1, now, now);
    const id = Number(result.lastInsertRowid);
    const created = this.getById(id);
    if (!created) throw new Error('Failed to create category.');
    return created;
  },

  update(id: number, body: UpdateCategoryBody): Category {
    const current = this.getById(id);
    if (!current) throw new Error('Category not found.');
    const db = getDb();
    const name = body.name?.trim() ?? current.name;
    const slug = body.name ? slugify(name) : current.slug;
    if (!slug) throw new Error('Category name must contain alphanumeric characters.');
    if (slug !== current.slug || name !== current.name) {
      const dup = db
        .prepare('SELECT id FROM categories WHERE (slug = ? OR name = ?) AND id != ?')
        .get(slug, name, id);
      if (dup) throw new Error('A category with that name already exists.');
    }
    db.prepare(
      `UPDATE categories
       SET name = ?, slug = ?, description = ?, color = ?, is_enabled = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      name,
      slug,
      body.description !== undefined ? body.description : current.description,
      body.color !== undefined ? body.color : current.color,
      body.isEnabled !== undefined ? (body.isEnabled ? 1 : 0) : current.isEnabled ? 1 : 0,
      body.sortOrder !== undefined ? body.sortOrder : current.sortOrder,
      nowIso(),
      id,
    );
    const updated = this.getById(id);
    if (!updated) throw new Error('Failed to update category.');
    return updated;
  },

  disable(id: number): Category {
    return this.update(id, { isEnabled: false });
  },

  /**
   * Hard delete: only allowed if no content_sources reference this category.
   * Use `disable` instead in the common case.
   */
  remove(id: number): { ok: boolean; error?: string } {
    const db = getDb();
    const inUse = db
      .prepare('SELECT COUNT(*) as c FROM content_sources WHERE category_id = ?')
      .get(id) as { c: number };
    if (inUse.c > 0) {
      return {
        ok: false,
        error: `Cannot delete: ${inUse.c} content source(s) still use this category. Disable it instead, or reassign the sources first.`,
      };
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return { ok: true };
  },
};
