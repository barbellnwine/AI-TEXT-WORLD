import type { DatabaseSync } from 'node:sqlite'
import { config, DEFAULT_PRICING } from '../config.ts'
import { getPricing, getSafetyMargin, getUsdToKrwRate, getWeeklyBudgetKrw, getWeeklyLedger, setPricing, setSetting } from '../domain/budget.ts'
import { getMonthlyBudgetKrw, getMonthlyLedger } from '../domain/budget.ts'
import { getRuntimeState, setDemoMode, setStatus } from '../domain/runtimeState.ts'
import type { AdapterSet } from '../domain/scheduler.ts'
import { runTick } from '../domain/scheduler.ts'
import { Router, readJsonBody, sendJson, HttpError, paginationNumber } from '../http.ts'
import { requireAdmin } from './adminAuth.ts'

interface AgentAdminRow {
  id: string
  name: string
  provider: string
  model: string
  active: number
  status: string
  cooldown_until: string | null
  last_acted_at: string | null
  total_actions: number
}

export function registerAdminRoutes(router: Router, db: DatabaseSync, adapters: AdapterSet): void {
  router.post('/api/ai-community/admin/start', ctx => {
    if (!requireAdmin(ctx)) return
    setStatus(db, 'RUNNING')
    sendJson(ctx.res, 200, { status: 'RUNNING' })
  })

  router.post('/api/ai-community/admin/pause', ctx => {
    if (!requireAdmin(ctx)) return
    setStatus(db, 'PAUSED')
    sendJson(ctx.res, 200, { status: 'PAUSED' })
  })

  router.post('/api/ai-community/admin/stop', ctx => {
    if (!requireAdmin(ctx)) return
    setStatus(db, 'STOPPED')
    sendJson(ctx.res, 200, { status: 'STOPPED' })
  })

  router.post('/api/ai-community/admin/kill', ctx => {
    if (!requireAdmin(ctx)) return
    setStatus(db, 'KILLED')
    sendJson(ctx.res, 200, { status: 'KILLED' })
  })

  router.post('/api/ai-community/admin/tick', async ctx => {
    if (!requireAdmin(ctx)) return
    const outcome = await runTick(db, { manual: true, adapters })
    sendJson(ctx.res, 200, { outcome })
  })

  router.post('/api/ai-community/admin/mode', async ctx => {
    if (!requireAdmin(ctx)) return
    const body = await readJsonBody<{ demoMode: boolean }>(ctx.req)
    if (typeof body.demoMode !== 'boolean') throw new HttpError(400, 'demoMode_must_be_boolean')
    setDemoMode(db, Boolean(body.demoMode))
    sendJson(ctx.res, 200, { demoMode: Boolean(body.demoMode) })
  })

  router.post('/api/ai-community/admin/agents/:id/toggle', async ctx => {
    if (!requireAdmin(ctx)) return
    const body = await readJsonBody<{ active: boolean }>(ctx.req)
    if (typeof body.active !== 'boolean') throw new HttpError(400, 'active_must_be_boolean')
    if (!db.prepare('SELECT id FROM ai_agents WHERE id = ?').get(ctx.params.id)) {
      throw new HttpError(404, 'agent_not_found')
    }
    db.prepare('UPDATE ai_agents SET active = ? WHERE id = ?').run(body.active ? 1 : 0, ctx.params.id)
    sendJson(ctx.res, 200, { id: ctx.params.id, active: Boolean(body.active) })
  })

  router.get('/api/ai-community/admin/agents', ctx => {
    if (!requireAdmin(ctx)) return
    const rows = db.prepare('SELECT id, name, provider, model, active, status, cooldown_until, last_acted_at, total_actions FROM ai_agents ORDER BY id').all() as unknown as AgentAdminRow[]
    sendJson(ctx.res, 200, { agents: rows })
  })

  router.get('/api/ai-community/admin/settings', ctx => {
    if (!requireAdmin(ctx)) return
    const pricing = db.prepare('SELECT provider, model, input_usd_per_mtok AS inputUsdPerMTok, output_usd_per_mtok AS outputUsdPerMTok FROM ai_model_pricing').all()
    sendJson(ctx.res, 200, {
      weeklyBudgetKrw: getWeeklyBudgetKrw(db),
      monthlyBudgetKrw: getMonthlyBudgetKrw(db),
      safetyMargin: getSafetyMargin(db),
      usdToKrwRate: getUsdToKrwRate(db),
      pricing,
      openaiConfigured: Boolean(config.openaiApiKey),
      anthropicConfigured: Boolean(config.anthropicApiKey),
      limits: { monthlyBudgetKrw: config.monthlyBudgetKrw, weeklyBudgetKrw: config.weeklyBudgetKrw,
        minimumSafetyMargin: config.budgetSafetyMargin, minimumUsdToKrwRate: config.usdToKrwRate },
    })
  })

  router.post('/api/ai-community/admin/settings', async ctx => {
    if (!requireAdmin(ctx)) return
    const body = await readJsonBody<{
      weeklyBudgetKrw?: number
      monthlyBudgetKrw?: number
      safetyMargin?: number
      usdToKrwRate?: number
      pricing?: Array<{ provider: 'openai' | 'anthropic'; model: string; inputUsdPerMTok: number; outputUsdPerMTok: number }>
    }>(ctx.req)
    const validNumber = (value: unknown, minimum: number, maximum = Number.MAX_VALUE) =>
      typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    if (
      (body.weeklyBudgetKrw !== undefined && !validNumber(body.weeklyBudgetKrw, 0, config.weeklyBudgetKrw)) ||
      (body.monthlyBudgetKrw !== undefined && !validNumber(body.monthlyBudgetKrw, 0, config.monthlyBudgetKrw)) ||
      (body.safetyMargin !== undefined && !validNumber(body.safetyMargin, config.budgetSafetyMargin, 1)) ||
      (body.usdToKrwRate !== undefined && !validNumber(body.usdToKrwRate, config.usdToKrwRate)) ||
      (body.pricing !== undefined && (!Array.isArray(body.pricing) || body.pricing.some(p =>
        !p || !['openai', 'anthropic'].includes(p.provider) || typeof p.model !== 'string' || !p.model.trim() ||
        !DEFAULT_PRICING.some(floor => floor.provider === p.provider && floor.model === p.model &&
          validNumber(p.inputUsdPerMTok, floor.inputUsdPerMTok) && validNumber(p.outputUsdPerMTok, floor.outputUsdPerMTok))
      )))
    ) throw new HttpError(400, 'invalid_settings')
    if (typeof body.weeklyBudgetKrw === 'number') setSetting(db, 'weekly_budget_krw', String(body.weeklyBudgetKrw))
    if (typeof body.monthlyBudgetKrw === 'number') setSetting(db, 'monthly_budget_krw', String(body.monthlyBudgetKrw))
    if (typeof body.safetyMargin === 'number') setSetting(db, 'budget_safety_margin', String(body.safetyMargin))
    if (typeof body.usdToKrwRate === 'number') setSetting(db, 'usd_to_krw_rate', String(body.usdToKrwRate))
    for (const p of body.pricing ?? []) setPricing(db, p)
    sendJson(ctx.res, 200, { ok: true })
  })

  router.get('/api/ai-community/admin/usage', ctx => {
    if (!requireAdmin(ctx)) return
    const ledger = getWeeklyLedger(db)
    sendJson(ctx.res, 200, { ledger, monthlyLedger: getMonthlyLedger(db) })
  })

  router.get('/api/ai-community/admin/logs', ctx => {
    if (!requireAdmin(ctx)) return
    const limit = paginationNumber(ctx.query.get('limit'), 50, 1, 200)
    const onlyErrors = ctx.query.get('errorsOnly') === 'true'
    const rows = onlyErrors
      ? db.prepare(`SELECT * FROM ai_action_logs WHERE status IN ('FAILED','REJECTED') ORDER BY created_at DESC LIMIT ?`).all(limit)
      : db.prepare('SELECT * FROM ai_action_logs ORDER BY created_at DESC LIMIT ?').all(limit)
    sendJson(ctx.res, 200, { logs: rows })
  })

  router.get('/api/ai-community/admin/status', ctx => {
    if (!requireAdmin(ctx)) return
    const runtime = getRuntimeState(db)
    const pricing = { openai: getPricing(db, 'openai', config.openaiModel), anthropic: getPricing(db, 'anthropic', config.anthropicModel) }
    sendJson(ctx.res, 200, {
      runtime,
      openaiConfigured: Boolean(config.openaiApiKey),
      anthropicConfigured: Boolean(config.anthropicApiKey),
      communityEnabled: config.communityEnabled,
      providerLimitsConfirmed: config.providerLimitsConfirmed,
      paidCallsBlocked: config.production && !config.providerLimitsConfirmed,
      pricing,
    })
  })
}
