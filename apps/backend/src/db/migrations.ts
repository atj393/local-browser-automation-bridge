import { getDb } from './database.js';
import { SCHEMA_SQL } from './schema.js';
import { nowIso } from '../utils/date.js';

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function listColumns(table: string): string[] {
  const db = getDb();
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[];
  return rows.map((r) => r.name);
}

function ensureColumn(table: string, column: string, ddl: string): boolean {
  const existing = listColumns(table);
  if (existing.includes(column)) return false;
  const db = getDb();
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
  return true;
}

const TECH_KEYWORD_RE =
  /\b(tech|technology|ai|ml|software|developer|dev|github|openai|gemini|google|microsoft|engineering|programming|coding|llm)\b/i;

function categorizeUrlHeuristically(url: string): 'tech-news' | 'general-news' {
  return TECH_KEYWORD_RE.test(url) ? 'tech-news' : 'general-news';
}

function seedDefaultCategories(): void {
  const db = getDb();
  const count = db
    .prepare('SELECT COUNT(*) as c FROM categories')
    .get() as { c: number };
  if (count.c > 0) return;
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO categories (name, slug, description, color, is_enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
  );
  insert.run('General News', 'general-news', 'Default catch-all category for non-tech sources.', '#2563eb', 0, now, now);
  insert.run('Tech News', 'tech-news', 'Software, AI, engineering, and product news.', '#16a34a', 1, now, now);
}

/**
 * Move legacy automation_settings.source_urls newline-list into the new
 * content_sources table. Heuristically assigns each URL a category.
 * Runs once when content_sources is empty AND source_urls is not.
 */
function migrateLegacySourceUrls(): void {
  const db = getDb();
  const existingCount = (
    db.prepare('SELECT COUNT(*) as c FROM content_sources').get() as { c: number }
  ).c;
  if (existingCount > 0) return;

  const settings = db
    .prepare('SELECT source_urls FROM automation_settings WHERE id = 1')
    .get() as { source_urls?: string } | undefined;
  if (!settings || !settings.source_urls) return;
  const urls = settings.source_urls
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (urls.length === 0) return;

  // Make sure categories exist (we depend on them).
  seedDefaultCategories();
  const categoryRows = db
    .prepare('SELECT id, slug FROM categories')
    .all() as { id: number; slug: string }[];
  const slugToId = new Map<string, number>(categoryRows.map((c) => [c.slug, c.id]));
  const fallbackId = slugToId.get('general-news') ?? slugToId.values().next().value;
  if (!fallbackId) return;

  const seen = new Set<string>();
  const insert = db.prepare(
    `INSERT INTO content_sources
       (url, label, category_id, is_enabled, sort_order, created_at, updated_at)
     VALUES (?, NULL, ?, 1, ?, ?, ?)`,
  );
  const now = nowIso();
  let order = 0;
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const slug = categorizeUrlHeuristically(url);
    const categoryId = slugToId.get(slug) ?? fallbackId;
    insert.run(url, categoryId, order, now, now);
    order += 1;
  }
}

export function runMigrations(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);

  // ---- automation_settings columns ----
  ensureColumn(
    'automation_settings',
    'posts_per_generation',
    'posts_per_generation INTEGER NOT NULL DEFAULT 10',
  );
  ensureColumn('automation_settings', 'source_urls', "source_urls TEXT NOT NULL DEFAULT ''");
  ensureColumn('automation_settings', 'source_mode', "source_mode TEXT NOT NULL DEFAULT 'rotate'");
  ensureColumn(
    'automation_settings',
    'last_source_index',
    'last_source_index INTEGER NOT NULL DEFAULT -1',
  );
  ensureColumn('automation_settings', 'last_source_url', 'last_source_url TEXT');
  ensureColumn('automation_settings', 'last_source_id', 'last_source_id INTEGER');
  ensureColumn(
    'automation_settings',
    'batch_min_interval_seconds',
    'batch_min_interval_seconds INTEGER NOT NULL DEFAULT 900',
  );
  ensureColumn(
    'automation_settings',
    'batch_max_interval_seconds',
    'batch_max_interval_seconds INTEGER NOT NULL DEFAULT 1800',
  );
  ensureColumn(
    'automation_settings',
    'batch_refill_mode',
    "batch_refill_mode TEXT NOT NULL DEFAULT 'random_delay'",
  );
  ensureColumn('automation_settings', 'next_batch_run_at', 'next_batch_run_at TEXT');
  ensureColumn('automation_settings', 'last_batch_generated_at', 'last_batch_generated_at TEXT');
  ensureColumn(
    'automation_settings',
    'is_batch_generation_running',
    'is_batch_generation_running INTEGER NOT NULL DEFAULT 0',
  );
  ensureColumn(
    'automation_settings',
    'queue_selection_mode',
    "queue_selection_mode TEXT NOT NULL DEFAULT 'rotate_categories'",
  );
  ensureColumn(
    'automation_settings',
    'last_posted_category_id',
    'last_posted_category_id INTEGER',
  );

  // ---- post_queue columns ----
  ensureColumn('post_queue', 'source_url', 'source_url TEXT');
  ensureColumn('post_queue', 'source_id', 'source_id INTEGER');
  ensureColumn('post_queue', 'category_id', 'category_id INTEGER');
  ensureColumn('post_queue', 'category_name', 'category_name TEXT');

  // ---- Seed + legacy migration ----
  seedDefaultCategories();
  migrateLegacySourceUrls();
  seedDefaultPersonalProfile();
}

/**
 * Insert an empty disabled personal profile row on first run. The
 * profile JSON shape mirrors `PersonalProfile` in `@lbab/shared`.
 * Disabled by default — users opt-in from the dashboard.
 */
function seedDefaultPersonalProfile(): void {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM personal_profile WHERE id = 1')
    .get();
  if (existing) return;
  const defaultProfile = {
    whoAmI: '',
    shortBio: '',
    likes: [],
    dislikes: [],
    avoidTopics: [],
    tone: { primary: [], avoid: [] },
    geographicPreferences: [],
    topicInterests: [],
    values: [],
    writingRules: [],
    hashtagPreferences: {
      enabled: true,
      min: 1,
      max: 3,
      preferred: [],
      avoid: [],
    },
    languagePreference: 'English',
    customInstructions: '',
    safetyRules: [
      'Do not generate hate, harassment, or insults against protected groups.',
      'Avoid offensive religious comparisons.',
      'Keep opinions strong but respectful.',
    ],
  };
  const now = nowIso();
  db.prepare(
    `INSERT INTO personal_profile (id, profile_json, is_enabled, created_at, updated_at)
     VALUES (1, ?, 0, ?, ?)`,
  ).run(JSON.stringify(defaultProfile), now, now);
}
