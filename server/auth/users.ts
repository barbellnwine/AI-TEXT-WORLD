import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

export type UserRole = 'USER' | 'ADMIN'
export type AuthProvider = 'local' | 'google' | 'kakao'

export interface UserRecord {
  id: string
  email: string | null
  username: string | null
  nickname: string
  password_hash: string | null
  provider: AuthProvider
  provider_id: string | null
  role: UserRole
  locale: string
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export type PublicUser = Omit<UserRecord, 'password_hash'>

export function toPublicUser(user: UserRecord): PublicUser {
  const { password_hash: _passwordHash, ...rest } = user
  return rest
}

export function findUserByEmail(db: DatabaseSync, email: string): UserRecord | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRecord | undefined
}

export function findUserByUsername(db: DatabaseSync, username: string): UserRecord | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase()) as UserRecord | undefined
}

export function findUserByIdentifier(db: DatabaseSync, identifier: string): UserRecord | undefined {
  const normalized = identifier.toLowerCase()
  return db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(normalized, normalized) as UserRecord | undefined
}

export function findUserById(db: DatabaseSync, id: string): UserRecord | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined
}

export function hasAdminUser(db: DatabaseSync): boolean {
  return Boolean(db.prepare("SELECT 1 FROM users WHERE role = 'ADMIN' LIMIT 1").get())
}

export function findUserByProvider(db: DatabaseSync, provider: AuthProvider, providerId: string): UserRecord | undefined {
  return db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get(provider, providerId) as UserRecord | undefined
}

export interface CreateUserInput {
  email?: string | null
  username?: string | null
  nickname: string
  passwordHash?: string | null
  provider: AuthProvider
  providerId?: string | null
  role?: UserRole
  locale?: string
}

export function createUser(db: DatabaseSync, input: CreateUserInput): UserRecord {
  const id = randomUUID()
  db.prepare(`
    INSERT INTO users (id, email, username, nickname, password_hash, provider, provider_id, role, locale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.email ? input.email.toLowerCase() : null,
    input.username ? input.username.toLowerCase() : null,
    input.nickname,
    input.passwordHash ?? null,
    input.provider,
    input.providerId ?? null,
    input.role ?? 'USER',
    input.locale ?? 'ko-KR',
  )
  return findUserById(db, id) as UserRecord
}

export function touchLastLogin(db: DatabaseSync, userId: string): void {
  db.prepare(`UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(userId)
}

export function updateUserLocale(db: DatabaseSync, userId: string, locale: string): void {
  db.prepare(`UPDATE users SET locale = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(locale, userId)
}
