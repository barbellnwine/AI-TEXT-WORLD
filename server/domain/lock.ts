import type { DatabaseSync } from 'node:sqlite'

const LEASE_MS = 30_000

// Compare-and-swap style lock so two ticks (e.g. the interval loop and a manual admin tick)
// can never call a provider at the same time.
export function acquireLock(db: DatabaseSync, holder: string): boolean {
  const nowIso = new Date().toISOString()
  const expiresIso = new Date(Date.now() + LEASE_MS).toISOString()
  const result = db
    .prepare(
      `UPDATE ai_worker_locks SET holder = ?, expires_at = ?
       WHERE id = 1 AND (holder IS NULL OR expires_at < ?)`
    )
    .run(holder, expiresIso, nowIso)
  if (result.changes === 0) return false
  const row = db.prepare('SELECT holder FROM ai_worker_locks WHERE id = 1').get() as { holder: string }
  return row.holder === holder
}

export function releaseLock(db: DatabaseSync, holder: string): void {
  db.prepare('UPDATE ai_worker_locks SET holder = NULL, expires_at = NULL WHERE id = 1 AND holder = ?').run(holder)
}
