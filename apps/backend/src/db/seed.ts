import { DEFAULT_LLM_PROMPT } from '@lbab/shared';
import { getDb } from './database.js';
import { nowIso } from '../utils/date.js';

export function seedDefaultSettings(): void {
  const db = getDb();
  const row = db.prepare('SELECT id FROM automation_settings WHERE id = 1').get();
  if (row) return;
  const now = nowIso();
  db.prepare(
    `INSERT INTO automation_settings
      (id, is_running, llm_prompt, batch_size, min_interval_seconds, max_interval_seconds,
       auto_submit_writer, writer_url_pattern, reader_url_pattern, next_run_at, created_at, updated_at)
     VALUES (1, 0, ?, 10, 60, 240, 0, 'https://x.com/*', 'https://gemini.google.com/*', NULL, ?, ?)`,
  ).run(DEFAULT_LLM_PROMPT, now, now);
}

/**
 * Reset run-time-only fields after a backend restart. The scheduler is in-memory
 * so any previous `is_running=true` / `next_run_at` is stale.
 */
export function resetRuntimeStateOnStartup(): void {
  const db = getDb();
  db.prepare(
    'UPDATE automation_settings SET is_running = 0, next_run_at = NULL, updated_at = ? WHERE id = 1',
  ).run(nowIso());
  // Any rows stuck in `posting` (e.g., crashed mid-flight) should go back to pending.
  db.prepare(
    `UPDATE post_queue
       SET status = 'pending', error_message = 'Reset on backend restart', updated_at = ?
       WHERE status = 'posting'`,
  ).run(nowIso());
}
