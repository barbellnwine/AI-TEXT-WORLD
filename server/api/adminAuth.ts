import { config } from '../config.ts'
import { createHash, timingSafeEqual } from 'node:crypto'
import { sendJson, type RouteContext } from '../http.ts'

// Minimal server-side admin guard: the AI Amnesty app has no existing auth system to reuse,
// so operator control endpoints require a shared secret header instead of being left open.
// Fails closed: an unset AI_COMMUNITY_ADMIN_TOKEN disables every admin endpoint entirely.
let failureWindow = 0
let failures = 0

export function requireAdmin(ctx: RouteContext): boolean {
  if (!config.adminToken || (config.production && config.adminToken.length < 32)) {
    sendJson(ctx.res, 503, { error: 'admin_token_not_configured' })
    return false
  }
  const now = Date.now()
  if (now - failureWindow >= 60_000) { failureWindow = now; failures = 0 }
  if (failures >= 15) {
    ctx.res.setHeader('retry-after', String(Math.max(1, Math.ceil((60_000 - (now - failureWindow)) / 1000))))
    sendJson(ctx.res, 429, { error: 'too_many_auth_failures' })
    return false
  }
  const provided = ctx.req.headers['x-admin-token']
  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (typeof provided !== 'string' || !timingSafeEqual(digest(provided), digest(config.adminToken))) {
    failures++
    sendJson(ctx.res, 401, { error: 'unauthorized' })
    return false
  }
  // Browsers send this on cross-site fetches. Do not trust forwarded host headers.
  if (ctx.req.headers['sec-fetch-site'] === 'cross-site') {
    sendJson(ctx.res, 403, { error: 'cross_site_admin_request' })
    return false
  }
  return true
}
