import type { DatabaseSync } from 'node:sqlite'
import { Router, sendJson, readJsonBody, HttpError, paginationNumber } from '../http.ts'
import { requireAdminRole } from './userAuth.ts'
import * as store from '../domain/worldStore.ts'
import { PROMPT_REGISTRY } from '../prompts/promptVersions.ts'
import { config } from '../config.ts'
import { getPrepaidBudget } from '../domain/budget.ts'

export function registerWorldAdminRoutes(router: Router, db: DatabaseSync): void {
  router.get('/api/admin/world/runtime', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { runtime: store.getAdminRuntime(), season: store.getSeason(), operatorLog: store.listOperatorLog(), actionAudit: store.listActionAudit(), prepaidBudget: getPrepaidBudget(db), providers: { openai: Boolean(config.openaiApiKey), anthropic: Boolean(config.anthropicApiKey) } })
  })

  router.post('/api/admin/world/tick', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    await store.runWorldTick()
    sendJson(ctx.res, 200, { runtime: store.getAdminRuntime() })
  })

  router.get('/api/admin/world/action-audit', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { events: store.listActionAudit() })
  })

  router.post('/api/admin/world/start', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { runtime: store.startSeason() })
  })

  router.post('/api/admin/world/pause', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { runtime: store.pauseSeason() })
  })

  router.post('/api/admin/world/resume', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { runtime: store.resumeSeason() })
  })

  router.post('/api/admin/world/end', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { runtime: store.endSeason() })
  })

  router.post('/api/admin/world/tick-interval', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    const body = await readJsonBody<{ ms?: number }>(ctx.req)
    if (typeof body.ms !== 'number' || !Number.isFinite(body.ms) || body.ms < 5_000 || body.ms > 3_600_000) {
      throw new HttpError(400, 'ms_must_be_between_5s_and_1h')
    }
    sendJson(ctx.res, 200, { runtime: store.setTickInterval(body.ms) })
  })

  router.post('/api/admin/world/max-agents', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    const body = await readJsonBody<{ maxActiveAgents?: number }>(ctx.req)
    if (typeof body.maxActiveAgents !== 'number' || !Number.isInteger(body.maxActiveAgents) || body.maxActiveAgents < 1 || body.maxActiveAgents > config.maxActiveCharacters) {
      throw new HttpError(400, `max_active_characters_${config.maxActiveCharacters}`)
    }
    sendJson(ctx.res, 200, { runtime: store.setMaxActiveAgents(body.maxActiveAgents) })
  })

  router.post('/api/admin/world/call-budget', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    const body = await readJsonBody<{ callBudget?: number }>(ctx.req)
    if (typeof body.callBudget !== 'number' || !Number.isSafeInteger(body.callBudget) || body.callBudget < 0) {
      throw new HttpError(400, 'callBudget_must_be_non_negative')
    }
    sendJson(ctx.res, 200, { runtime: store.setCallBudget(body.callBudget) })
  })

  router.post('/api/admin/world/events', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    const body = await readJsonBody<{
      type?: string
      placeId?: string
      agentIds?: string[]
      title?: string
      summary?: string
      importance?: string
    }>(ctx.req)
    if (typeof body.placeId !== 'string' || typeof body.title !== 'string' || typeof body.summary !== 'string') {
      throw new HttpError(400, 'placeId_title_summary_required')
    }
    const result = store.addOperatorEvent({
      type: 'OPERATOR_EVENT',
      placeId: body.placeId,
      agentIds: Array.isArray(body.agentIds) ? body.agentIds.filter((id): id is string => typeof id === 'string') : [],
      title: body.title,
      summary: body.summary,
      importance: body.importance,
      addedBy: 'operator',
    })
    if (!result.ok) return sendJson(ctx.res, 422, { error: 'world_rule_violation', details: result.errors })
    sendJson(ctx.res, 200, { event: result.event })
  })

  router.delete('/api/admin/world/seasons/:id', ctx => {
    if (!requireAdminRole(ctx, db)) return
    const result = store.deleteArchivedSeason(db, ctx.params.id)
    if (!result.ok) throw new HttpError(result.error === 'season_not_found' ? 404 : 409, result.error)
    sendJson(ctx.res, 200, { ok: true })
  })

  router.get('/api/admin/world/operator-log', ctx => {
    if (!requireAdminRole(ctx, db)) return
    const limit = paginationNumber(ctx.query.get('limit'), 50, 1, 100)
    sendJson(ctx.res, 200, { entries: store.listOperatorLog().slice(0, limit) })
  })

  // Metadata only (role/version/hash) — never the prompt text itself over HTTP, even to the
  // authenticated operator. Full templates stay in server/prompts/*.ts source only.
  router.get('/api/admin/world/prompts', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { prompts: PROMPT_REGISTRY })
  })
}
