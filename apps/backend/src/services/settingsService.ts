import type { AutomationSettings, UpdateSettingsBody } from '@lbab/shared';
import { getDb } from '../db/database.js';
import { nowIso } from '../utils/date.js';

interface SettingsRow {
  id: number;
  is_running: number;
  llm_prompt: string;
  batch_size: number;
  min_interval_seconds: number;
  max_interval_seconds: number;
  auto_submit_writer: number;
  writer_url_pattern: string;
  reader_url_pattern: string;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSettings(row: SettingsRow): AutomationSettings {
  return {
    isRunning: !!row.is_running,
    llmPrompt: row.llm_prompt,
    batchSize: row.batch_size,
    minIntervalSeconds: row.min_interval_seconds,
    maxIntervalSeconds: row.max_interval_seconds,
    autoSubmitWriter: !!row.auto_submit_writer,
    writerUrlPattern: row.writer_url_pattern,
    readerUrlPattern: row.reader_url_pattern,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const settingsService = {
  get(): AutomationSettings {
    const db = getDb();
    const row = db.prepare('SELECT * FROM automation_settings WHERE id = 1').get() as
      | SettingsRow
      | undefined;
    if (!row) throw new Error('Settings row missing. Did seed run?');
    return rowToSettings(row);
  },
  update(body: UpdateSettingsBody): AutomationSettings {
    const db = getDb();
    db.prepare(
      `UPDATE automation_settings
       SET llm_prompt = ?, batch_size = ?, min_interval_seconds = ?, max_interval_seconds = ?,
           auto_submit_writer = ?, writer_url_pattern = ?, reader_url_pattern = ?, updated_at = ?
       WHERE id = 1`,
    ).run(
      body.llmPrompt,
      body.batchSize,
      body.minIntervalSeconds,
      body.maxIntervalSeconds,
      body.autoSubmitWriter ? 1 : 0,
      body.writerUrlPattern,
      body.readerUrlPattern,
      nowIso(),
    );
    return this.get();
  },
  setRunning(isRunning: boolean): AutomationSettings {
    const db = getDb();
    db.prepare('UPDATE automation_settings SET is_running = ?, updated_at = ? WHERE id = 1').run(
      isRunning ? 1 : 0,
      nowIso(),
    );
    return this.get();
  },
  setNextRunAt(value: string | null): AutomationSettings {
    const db = getDb();
    db.prepare('UPDATE automation_settings SET next_run_at = ?, updated_at = ? WHERE id = 1').run(
      value,
      nowIso(),
    );
    return this.get();
  },
};
