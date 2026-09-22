import type { DatabaseSync } from 'node:sqlite'
import { config } from '../config.ts'
import { hashPassword } from './password.ts'
import { createUser, findUserByUsername } from './users.ts'

// Idempotent boot-time seed, same pattern as agentsSeed.ts: only creates the account if it
// doesn't already exist yet, and only runs when the operator supplied credentials via env vars
// (never hardcoded, never committed — see .env, which is gitignored).
export function seedAdminUser(db: DatabaseSync): void {
  const username = config.adminSeedUsername
  const password = config.adminSeedPassword
  if (!username || !password) return
  if (findUserByUsername(db, username)) return
  createUser(db, {
    username,
    nickname: username,
    provider: 'local',
    role: 'ADMIN',
    passwordHash: hashPassword(password),
  })
  console.log(`[auth] seeded ADMIN user "${username}" from ADMIN_SEED_USERNAME/ADMIN_SEED_PASSWORD`)
}
