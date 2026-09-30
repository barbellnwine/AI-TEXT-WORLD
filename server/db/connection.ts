import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

// Additive-only migration: schema.sql uses CREATE TABLE IF NOT EXISTS / INSERT OR IGNORE,
// so re-running it never drops or truncates existing rows.
export function migrate(db: DatabaseSync): void {
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8')
  db.exec(schema)
  const columns = db.prepare('PRAGMA table_info(draft_characters)').all() as Array<{ name: string }>
  if (!columns.some(c => c.name === 'dispositions_json')) db.exec('ALTER TABLE draft_characters ADD COLUMN dispositions_json TEXT')
}
