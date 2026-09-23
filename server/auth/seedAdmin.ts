import type { DatabaseSync } from 'node:sqlite'
import { config } from '../config.ts'
import { hashPassword } from './password.ts'
import { createUser, hasAdminUser } from './users.ts'

const ADMIN_USERNAME_RE = /^[a-zA-Z0-9._-]{3,64}$/
const MIN_ADMIN_PASSWORD_LENGTH = 12

// Idempotent boot-time seed, same pattern as agentsSeed.ts: only creates the account if it
// doesn't already exist yet, and only runs when the operator supplied credentials via env vars
// (never hardcoded, never committed — see .env, which is gitignored).
export function seedAdminUser(db: DatabaseSync): void {
  const username = config.adminSeedUsername
  const password = config.adminSeedPassword
  if (!username && !password) return
  if (!username || !password) throw new Error('ADMIN_SEED_USERNAME and ADMIN_SEED_PASSWORD must be set together')
  if (hasAdminUser(db)) {
    console.warn('[auth] ADMIN already exists; bootstrap credentials were ignored and should be removed from the environment')
    return
  }
  if (!ADMIN_USERNAME_RE.test(username)) throw new Error('ADMIN_SEED_USERNAME must be 3-64 letters, numbers, dots, underscores, or hyphens')
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH || password.length > 200) throw new Error(`ADMIN_SEED_PASSWORD must be ${MIN_ADMIN_PASSWORD_LENGTH}-200 characters`)
  createUser(db, {
    username,
    nickname: username,
    provider: 'local',
    role: 'ADMIN',
    passwordHash: hashPassword(password),
  })
  console.log('[auth] initial ADMIN account created; remove ADMIN_SEED_PASSWORD from the environment before the next start')
}
