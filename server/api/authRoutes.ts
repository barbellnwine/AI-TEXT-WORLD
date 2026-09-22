import type { DatabaseSync } from 'node:sqlite'
import { Router, readJsonBody, sendJson, HttpError } from '../http.ts'
import { hashPassword, verifyPassword, isValidPasswordShape } from '../auth/password.ts'
import { createSession, destroySession, currentUser } from '../auth/sessions.ts'
import {
  createUser, findUserByEmail, findUserByIdentifier,
  touchLastLogin, updateUserLocale, toPublicUser,
} from '../auth/users.ts'
import { requireAuthUser } from './userAuth.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SUPPORTED_LOCALES = new Set(['ko-KR', 'en-US', 'ja-JP', 'zh-CN'])

// Global (not per-IP) sliding-window counter, same rationale as adminAuth.ts: forwarded-IP
// headers can't be trusted without a known reverse-proxy chain, so this bounds total load
// from credential-stuffing attempts rather than isolating a single attacker.
let failureWindow = 0
let failures = 0
function loginRateLimited(): boolean {
  const now = Date.now()
  if (now - failureWindow >= 60_000) { failureWindow = now; failures = 0 }
  return failures >= 30
}
function recordLoginFailure(): void {
  failures++
}

export function registerAuthRoutes(router: Router, db: DatabaseSync): void {
  router.post('/api/auth/signup', async ctx => {
    const body = await readJsonBody<{ email?: string; password?: string; nickname?: string; locale?: string }>(ctx.req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : ''
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'invalid_email')
    if (!isValidPasswordShape(body.password)) throw new HttpError(400, 'password_must_be_8_to_200_chars')
    if (!nickname || nickname.length > 60) throw new HttpError(400, 'invalid_nickname')
    const locale = typeof body.locale === 'string' && SUPPORTED_LOCALES.has(body.locale) ? body.locale : 'ko-KR'
    if (findUserByEmail(db, email)) throw new HttpError(409, 'email_already_registered')

    const user = createUser(db, {
      email, nickname, provider: 'local', locale,
      passwordHash: hashPassword(body.password as string),
    })
    touchLastLogin(db, user.id)
    createSession(db, ctx.res, user.id, ctx.req.headers['user-agent'])
    sendJson(ctx.res, 201, { user: toPublicUser({ ...user, last_login_at: new Date().toISOString() }) })
  })

  router.post('/api/auth/login', async ctx => {
    if (loginRateLimited()) {
      ctx.res.setHeader('retry-after', '30')
      sendJson(ctx.res, 429, { error: 'too_many_login_attempts' })
      return
    }
    const body = await readJsonBody<{ identifier?: string; password?: string }>(ctx.req)
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!identifier || !password) {
      recordLoginFailure()
      throw new HttpError(400, 'identifier_and_password_required')
    }
    const user = identifier.includes('@') ? findUserByEmail(db, identifier) : findUserByIdentifier(db, identifier)
    if (!user || user.provider !== 'local' || !user.password_hash || !verifyPassword(password, user.password_hash)) {
      recordLoginFailure()
      throw new HttpError(401, 'invalid_credentials')
    }
    touchLastLogin(db, user.id)
    createSession(db, ctx.res, user.id, ctx.req.headers['user-agent'])
    sendJson(ctx.res, 200, { user: toPublicUser(user) })
  })

  router.post('/api/auth/logout', ctx => {
    destroySession(db, ctx.req, ctx.res)
    sendJson(ctx.res, 200, { ok: true })
  })

  router.get('/api/auth/me', ctx => {
    const user = currentUser(db, ctx.req)
    sendJson(ctx.res, 200, { user: user ? toPublicUser(user) : null })
  })

  router.post('/api/auth/locale', async ctx => {
    const user = requireAuthUser(ctx, db)
    if (!user) return
    const body = await readJsonBody<{ locale?: string }>(ctx.req)
    if (typeof body.locale !== 'string' || !SUPPORTED_LOCALES.has(body.locale)) throw new HttpError(400, 'unsupported_locale')
    updateUserLocale(db, user.id, body.locale)
    sendJson(ctx.res, 200, { locale: body.locale })
  })
}
