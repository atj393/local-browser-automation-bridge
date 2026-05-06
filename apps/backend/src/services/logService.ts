import type { AutomationLog, LogLevel } from '@lbab/shared';
import { getDb } from '../db/database.js';
import { nowIso } from '../utils/date.js';
import { safeStringify } from '../utils/safeJson.js';

interface LogRow {
  id: number;
  level: LogLevel;
  message: string;
  details_json: string | null;
  created_at: string;
}

function rowToLog(row: LogRow): AutomationLog {
  return {
    id: row.id,
    level: row.level,
    message: row.message,
    detailsJson: row.details_json,
    createdAt: row.created_at,
  };
}

export const logService = {
  log(level: LogLevel, message: string, details?: unknown): AutomationLog {
    const db = getDb();
    const detailsJson = details === undefined ? null : safeStringify(details);
    const created = nowIso();
    const result = db
      .prepare(
        'INSERT INTO automation_logs (level, message, details_json, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(level, message, detailsJson, created);
    const id = Number(result.lastInsertRowid);
    // Console mirror
    const consoleFn =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(`[${level}] ${message}`, details ?? '');
    return { id, level, message, detailsJson, createdAt: created };
  },
  info(message: string, details?: unknown): AutomationLog {
    return this.log('info', message, details);
  },
  debug(message: string, details?: unknown): AutomationLog {
    return this.log('debug', message, details);
  },
  warn(message: string, details?: unknown): AutomationLog {
    return this.log('warn', message, details);
  },
  error(message: string, details?: unknown): AutomationLog {
    return this.log('error', message, details);
  },
  list(limit = 200): AutomationLog[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM automation_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as LogRow[];
    return rows.map(rowToLog);
  },
  last(): AutomationLog | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM automation_logs ORDER BY id DESC LIMIT 1').get() as
      | unknown as LogRow | undefined;
    return row ? rowToLog(row) : null;
  },
  clear(): void {
    const db = getDb();
    db.prepare('DELETE FROM automation_logs').run();
  },
};
