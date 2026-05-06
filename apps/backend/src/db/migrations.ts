import { getDb } from './database.js';
import { SCHEMA_SQL } from './schema.js';

export function runMigrations(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);
}
