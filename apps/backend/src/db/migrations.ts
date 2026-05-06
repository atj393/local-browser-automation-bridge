import { getDb } from './database.js';
import { SCHEMA_SQL } from './schema.js';

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

function ensureColumn(
  table: string,
  column: string,
  ddl: string,
): boolean {
  const existing = listColumns(table);
  if (existing.includes(column)) return false;
  const db = getDb();
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
  return true;
}

export function runMigrations(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);

  // Idempotent column additions for upgrades from older databases.
  ensureColumn(
    'automation_settings',
    'posts_per_generation',
    "posts_per_generation INTEGER NOT NULL DEFAULT 10",
  );
  ensureColumn(
    'automation_settings',
    'source_urls',
    "source_urls TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    'automation_settings',
    'source_mode',
    "source_mode TEXT NOT NULL DEFAULT 'rotate'",
  );
  ensureColumn(
    'automation_settings',
    'last_source_index',
    'last_source_index INTEGER NOT NULL DEFAULT -1',
  );
  ensureColumn(
    'automation_settings',
    'last_source_url',
    'last_source_url TEXT',
  );
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
  ensureColumn(
    'automation_settings',
    'next_batch_run_at',
    'next_batch_run_at TEXT',
  );
  ensureColumn(
    'automation_settings',
    'last_batch_generated_at',
    'last_batch_generated_at TEXT',
  );
  ensureColumn(
    'automation_settings',
    'is_batch_generation_running',
    'is_batch_generation_running INTEGER NOT NULL DEFAULT 0',
  );

  ensureColumn('post_queue', 'source_url', 'source_url TEXT');
}
