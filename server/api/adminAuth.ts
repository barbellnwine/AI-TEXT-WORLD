import { config } from '../config.ts'
import { sendJson, type RouteContext } from '../http.ts'

// Minimal server-side admin guard: the AI Amnesty app has no existing auth system to reuse,
// so operator control endpoints require a shared secret header instead of being left open.
// Fails closed: an unset AI_COMMUNITY_ADMIN_TOKEN disables every admin endpoint entirely.
export function requireAdmin(ctx: RouteContext): boolean {
  if (!config.adminToken) {
    sendJson(ctx.res, 503, { error: 'admin_token_not_configured' })
    return false
  }
  const provided = ctx.req.headers['x-admin-token']
  if (provided !== config.adminToken) {
    sendJson(ctx.res, 401, { error: 'unauthorized' })
    return false
  }
  return true
}
