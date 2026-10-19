import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// No bcrypt dependency (the project keeps prod deps at zero beyond react) — scrypt is
// built into node:crypto and is a fine password KDF at these cost parameters.
const KEY_LENGTH = 64
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${derived.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts
  const n = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltHex, 'hex')
    expected = Buffer.from(hashHex, 'hex')
  } catch {
    return false
  }
  if (expected.length === 0) return false
  const derived = scryptSync(password, salt, expected.length, { N: n, r, p })
  return timingSafeEqual(derived, expected)
}

export function isValidPasswordShape(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 8 && password.length <= 200
}
