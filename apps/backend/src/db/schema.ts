export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS automation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  is_running INTEGER NOT NULL DEFAULT 0,
  llm_prompt TEXT NOT NULL,
  batch_size INTEGER NOT NULL DEFAULT 10,
  posts_per_generation INTEGER NOT NULL DEFAULT 10,
  min_interval_seconds INTEGER NOT NULL DEFAULT 60,
  max_interval_seconds INTEGER NOT NULL DEFAULT 240,
  auto_submit_writer INTEGER NOT NULL DEFAULT 0,
  writer_url_pattern TEXT NOT NULL DEFAULT 'https://x.com/*',
  reader_url_pattern TEXT NOT NULL DEFAULT 'https://gemini.google.com/*',
  source_urls TEXT NOT NULL DEFAULT '',
  source_mode TEXT NOT NULL DEFAULT 'rotate',
  last_source_index INTEGER NOT NULL DEFAULT -1,
  last_source_url TEXT,
  batch_min_interval_seconds INTEGER NOT NULL DEFAULT 900,
  batch_max_interval_seconds INTEGER NOT NULL DEFAULT 1800,
  batch_refill_mode TEXT NOT NULL DEFAULT 'random_delay',
  next_batch_run_at TEXT,
  last_batch_generated_at TEXT,
  is_batch_generation_running INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  content TEXT NOT NULL,
  raw_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  source_url TEXT,
  scheduled_for TEXT,
  posted_at TEXT,
  failed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_queue_status ON post_queue (status);
CREATE INDEX IF NOT EXISTS idx_post_queue_created ON post_queue (created_at);

CREATE TABLE IF NOT EXISTS automation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_created ON automation_logs (created_at);
`;
