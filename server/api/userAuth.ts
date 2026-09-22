import type { DatabaseSync } from 'node:sqlite'
import { sendJson, type RouteContext } from '../http.ts'
import { currentUser } from '../auth/sessions.ts'
import type { UserRecord } from '../auth/users.ts'

// Session/role gate for WORLD administration. The legacy Community token gate stays separate.
export function requireAuthUser(ctx: RouteContext, db: DatabaseSync): UserRecord | undefined {
  const user = currentUser(db, ctx.req)
  if (!user) {
    sendJson(ctx.res, 401, { error: 'not_authenticated' })
    return undefined
  }
  return user
}

export function requireAdminRole(ctx: RouteContext, db: DatabaseSync): UserRecord | undefined {
  const user = currentUser(db, ctx.req)
  if (!user) {
    sendJson(ctx.res, 401, { error: 'not_authenticated' })
    return undefined
  }
  if (user.role !== 'ADMIN') {
    sendJson(ctx.res, 403, { error: 'admin_role_required' })
    return undefined
  }
  if (!['GET', 'HEAD'].includes(ctx.req.method ?? '')) {
    // A custom header forces cross-origin browsers through a CORS preflight (not enabled).
    // Also reject same-site sibling origins; do not trust forwarded host headers.
    const origin = ctx.req.headers.origin
    let originMatches = !origin
    try { if (origin) originMatches = new URL(origin).host === ctx.req.headers.host } catch { originMatches = false }
    if (ctx.req.headers['x-world-admin'] !== '1' || ctx.req.headers['sec-fetch-site'] === 'cross-site' || !originMatches) {
      sendJson(ctx.res, 403, { error: 'invalid_admin_origin' })
      return undefined
    }
  }
  return user
}
