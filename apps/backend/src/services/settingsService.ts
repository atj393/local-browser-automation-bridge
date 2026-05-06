import type {
  AutomationSettings,
  UpdateSettingsBody,
  SourceMode,
  BatchRefillMode,
} from '@lbab/shared';
import { SOURCE_MODES, BATCH_REFILL_MODES } from '@lbab/shared';
import { getDb } from '../db/database.js';
import { nowIso } from '../utils/date.js';

interface SettingsRow {
  id: number;
  is_running: number;
  llm_prompt: string;
  batch_size: number;
  posts_per_generation: number;
  min_interval_seconds: number;
  max_interval_seconds: number;
  auto_submit_writer: number;
  writer_url_pattern: string;
  reader_url_pattern: string;
  source_urls: string;
  source_mode: string;
  last_source_index: number;
  last_source_url: string | null;
  batch_min_interval_seconds: number;
  batch_max_interval_seconds: number;
  batch_refill_mode: string;
  next_batch_run_at: string | null;
  last_batch_generated_at: string | null;
  is_batch_generation_running: number;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseSourceUrls(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function serializeSourceUrls(urls: string[]): string {
  return urls.map((u) => u.trim()).filter((u) => u.length > 0).join('\n');
}

function asSourceMode(value: string): SourceMode {
  return (SOURCE_MODES as readonly string[]).includes(value)
    ? (value as SourceMode)
    : 'rotate';
}

function asBatchRefillMode(value: string): BatchRefillMode {
  return (BATCH_REFILL_MODES as readonly string[]).includes(value)
    ? (value as BatchRefillMode)
    : 'random_delay';
}

function rowToSettings(row: SettingsRow): AutomationSettings {
  return {
    isRunning: !!row.is_running,
    llmPrompt: row.llm_prompt,
    batchSize: row.batch_size,
    postsPerGeneration: row.posts_per_generation,
    minIntervalSeconds: row.min_interval_seconds,
    maxIntervalSeconds: row.max_interval_seconds,
    autoSubmitWriter: !!row.auto_submit_writer,
    writerUrlPattern: row.writer_url_pattern,
    readerUrlPattern: row.reader_url_pattern,
    sourceUrls: parseSourceUrls(row.source_urls),
    sourceMode: asSourceMode(row.source_mode),
    lastSourceIndex: row.last_source_index,
    lastSourceUrl: row.last_source_url,
    batchMinIntervalSeconds: row.batch_min_interval_seconds,
    batchMaxIntervalSeconds: row.batch_max_interval_seconds,
    batchRefillMode: asBatchRefillMode(row.batch_refill_mode),
    nextBatchRunAt: row.next_batch_run_at,
    lastBatchGeneratedAt: row.last_batch_generated_at,
    isBatchGenerationRunning: !!row.is_batch_generation_running,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const settingsService = {
  get(): AutomationSettings {
    const db = getDb();
    const row = db.prepare('SELECT * FROM automation_settings WHERE id = 1').get() as
      | unknown as SettingsRow | undefined;
    if (!row) throw new Error('Settings row missing. Did seed run?');
    return rowToSettings(row);
  },
  update(body: UpdateSettingsBody): AutomationSettings {
    const db = getDb();
    const postsPerGeneration = body.postsPerGeneration;
    db.prepare(
      `UPDATE automation_settings
       SET llm_prompt = ?, batch_size = ?, posts_per_generation = ?,
           min_interval_seconds = ?, max_interval_seconds = ?,
           auto_submit_writer = ?, writer_url_pattern = ?, reader_url_pattern = ?,
           source_urls = ?, source_mode = ?,
           batch_min_interval_seconds = ?, batch_max_interval_seconds = ?, batch_refill_mode = ?,
           updated_at = ?
       WHERE id = 1`,
    ).run(
      body.llmPrompt,
      postsPerGeneration,
      postsPerGeneration,
      body.minIntervalSeconds,
      body.maxIntervalSeconds,
      body.autoSubmitWriter ? 1 : 0,
      body.writerUrlPattern,
      body.readerUrlPattern,
      serializeSourceUrls(body.sourceUrls),
      body.sourceMode,
      body.batchMinIntervalSeconds,
      body.batchMaxIntervalSeconds,
      body.batchRefillMode,
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
  setSourceProgress(index: number, url: string | null): AutomationSettings {
    const db = getDb();
    db.prepare(
      'UPDATE automation_settings SET last_source_index = ?, last_source_url = ?, updated_at = ? WHERE id = 1',
    ).run(index, url, nowIso());
    return this.get();
  },
  setNextBatchRunAt(value: string | null): AutomationSettings {
    const db = getDb();
    db.prepare(
      'UPDATE automation_settings SET next_batch_run_at = ?, updated_at = ? WHERE id = 1',
    ).run(value, nowIso());
    return this.get();
  },
  setBatchGenerationRunning(running: boolean): AutomationSettings {
    const db = getDb();
    db.prepare(
      'UPDATE automation_settings SET is_batch_generation_running = ?, updated_at = ? WHERE id = 1',
    ).run(running ? 1 : 0, nowIso());
    return this.get();
  },
  setLastBatchGeneratedAt(value: string | null): AutomationSettings {
    const db = getDb();
    db.prepare(
      'UPDATE automation_settings SET last_batch_generated_at = ?, updated_at = ? WHERE id = 1',
    ).run(value, nowIso());
    return this.get();
  },
};
