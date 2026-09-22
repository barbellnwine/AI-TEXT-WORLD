import type { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseCookies, setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME } from './cookies.ts'
import { findUserById, type UserRecord } from './users.ts'

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createSession(db: DatabaseSync, res: ServerResponse, userId: string, userAgent?: string): void {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString()
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)')
    .run(digest(token), userId, expiresAt, userAgent?.slice(0, 300) ?? null)
  setSessionCookie(res, token, SESSION_TTL_SECONDS)
}

export function destroySession(db: DatabaseSync, req: IncomingMessage, res: ServerResponse): void {
  const token = parseCookies(req)[SESSION_COOKIE_NAME]
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(digest(token))
  clearSessionCookie(res)
}

// Also prunes expired rows opportunistically so the table doesn't grow unbounded.
export function currentUser(db: DatabaseSync, req: IncomingMessage): UserRecord | undefined {
  const token = parseCookies(req)[SESSION_COOKIE_NAME]
  if (!token) return undefined
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').get(digest(token)) as
    | { user_id: string; expires_at: string }
    | undefined
  if (!row) return undefined
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(digest(token))
    return undefined
  }
  return findUserById(db, row.user_id)
}

export function pruneExpiredSessions(db: DatabaseSync): void {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).run()
}
