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
      (id, is_running, llm_prompt, batch_size, posts_per_generation, min_interval_seconds, max_interval_seconds,
       auto_submit_writer, writer_url_pattern, reader_url_pattern,
       source_urls, source_mode, last_source_index, last_source_url,
       batch_min_interval_seconds, batch_max_interval_seconds, batch_refill_mode,
       next_batch_run_at, last_batch_generated_at, is_batch_generation_running,
       gemini_response_timeout_seconds,
       next_run_at, created_at, updated_at)
     VALUES (1, 0, ?, 10, 10, 60, 240, 0, 'https://x.com/*', 'https://gemini.google.com/*',
             '', 'rotate', -1, NULL,
             900, 1800, 'random_delay',
             NULL, NULL, 0,
             300,
             NULL, ?, ?)`,
  ).run(DEFAULT_LLM_PROMPT, now, now);
}

/**
 * Reset run-time-only fields after a backend restart. The scheduler is in-memory
 * so any previous `is_running=true` / `next_run_at` is stale.
 */
export function resetRuntimeStateOnStartup(): void {
  const db = getDb();
  db.prepare(
    `UPDATE automation_settings
       SET is_running = 0,
           next_run_at = NULL,
           next_batch_run_at = NULL,
           is_batch_generation_running = 0,
           updated_at = ?
       WHERE id = 1`,
  ).run(nowIso());
  // Any rows stuck in `posting` (e.g., crashed mid-flight) should go back to pending.
  db.prepare(
    `UPDATE post_queue
       SET status = 'pending', error_message = 'Reset on backend restart', updated_at = ?
       WHERE status = 'posting'`,
  ).run(nowIso());
}
