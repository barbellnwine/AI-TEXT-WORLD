import type { DatabaseSync } from 'node:sqlite'
import { getCurrentWeekKey, getSafetyMargin, getUsdToKrwRate, getWeeklyBudgetKrw, getWeeklyLedger } from '../domain/budget.ts'
import { getRuntimeState } from '../domain/runtimeState.ts'
import { Router, sendJson } from '../http.ts'

interface AgentRow {
  id: string
  name: string
  provider: string
  model: string
  persona_key: string
  personality: string
  goals: string
  status: string
  cooldown_until: string | null
  last_acted_at: string | null
  total_actions: number
  created_at: string
}

function publicAgent(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    personaKey: row.persona_key,
    personality: row.personality,
    goals: row.goals,
    status: row.status,
    cooldownUntil: row.cooldown_until,
    lastActedAt: row.last_acted_at,
    totalActions: row.total_actions,
    createdAt: row.created_at,
  }
}

export function registerPublicRoutes(router: Router, db: DatabaseSync): void {
  router.get('/api/ai-community/status', ctx => {
    const runtime = getRuntimeState(db)
    const weekKey = getCurrentWeekKey()
    const ledger = getWeeklyLedger(db, weekKey)
    const budgetKrw = getWeeklyBudgetKrw(db)
    const margin = getSafetyMargin(db)
    const rate = getUsdToKrwRate(db)
    const thresholdKrw = budgetKrw * (1 - margin)
    const committedKrw = ledger.reserved_krw + ledger.settled_krw
    sendJson(ctx.res, 200, {
      status: runtime.status,
      demoMode: Boolean(runtime.demo_mode),
      week: {
        weekKey,
        budgetKrw,
        thresholdKrw,
        committedKrw,
        remainingKrw: Math.max(0, thresholdKrw - committedKrw),
        settledKrw: ledger.settled_krw,
        settledUsd: ledger.settled_usd,
        usdToKrwRate: rate,
      },
    })
  })

  router.get('/api/ai-community/agents', ctx => {
    const rows = db.prepare('SELECT * FROM ai_agents ORDER BY id ASC').all() as unknown as AgentRow[]
    sendJson(ctx.res, 200, { agents: rows.map(publicAgent) })
  })

  router.get('/api/ai-community/agents/:id', ctx => {
    const row = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(ctx.params.id) as AgentRow | undefined
    if (!row) return sendJson(ctx.res, 404, { error: 'agent_not_found' })

    const posts = db.prepare('SELECT id, title, created_at AS createdAt FROM ai_posts WHERE agent_id = ? ORDER BY created_at DESC LIMIT 30').all(row.id)
    const comments = db
      .prepare('SELECT id, post_id AS postId, action_type AS actionType, body, created_at AS createdAt FROM ai_comments WHERE agent_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(row.id)
    const actionCounts = db
      .prepare('SELECT action, COUNT(*) AS n FROM ai_action_logs WHERE agent_id = ? AND status = ? GROUP BY action')
      .all(row.id, 'SUCCESS')
    const totals = db
      .prepare('SELECT COALESCE(SUM(total_tokens),0) AS totalTokens, COALESCE(SUM(est_usd),0) AS totalUsd, COALESCE(SUM(est_krw),0) AS totalKrw FROM ai_action_logs WHERE agent_id = ?')
      .get(row.id)

    sendJson(ctx.res, 200, { agent: publicAgent(row), posts, comments, actionCounts, totals })
  })

  router.get('/api/ai-community/feed', ctx => {
    const agentId = ctx.query.get('agentId')
    const action = ctx.query.get('action')
    const limit = Math.min(50, Number(ctx.query.get('limit')) || 20)
    const offset = Math.max(0, Number(ctx.query.get('offset')) || 0)

    const postFilterOk = !action || action === 'CREATE_POST'
    const posts = postFilterOk
      ? (db
          .prepare(
            `SELECT p.id, 'CREATE_POST' AS action, p.agent_id AS agentId, p.title, p.body, p.created_at AS createdAt
             FROM ai_posts p WHERE (?1 IS NULL OR p.agent_id = ?1) ORDER BY p.created_at DESC LIMIT ?2`
          )
          .all(agentId, limit + offset) as Array<Record<string, unknown>>)
      : []

    const comments = action !== 'CREATE_POST'
      ? (db
          .prepare(
            `SELECT c.id, c.action_type AS action, c.agent_id AS agentId, c.post_id AS postId, c.body, c.created_at AS createdAt
             FROM ai_comments c
             WHERE (?1 IS NULL OR c.agent_id = ?1) AND (?2 IS NULL OR c.action_type = ?2)
             ORDER BY c.created_at DESC LIMIT ?3`
          )
          .all(agentId, action, limit + offset) as Array<Record<string, unknown>>)
      : []

    const merged = [...posts, ...comments].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(offset, offset + limit)
    sendJson(ctx.res, 200, { items: merged })
  })

  router.get('/api/ai-community/posts/:id', ctx => {
    const post = db.prepare('SELECT id, agent_id AS agentId, title, body, created_at AS createdAt FROM ai_posts WHERE id = ?').get(ctx.params.id)
    if (!post) return sendJson(ctx.res, 404, { error: 'post_not_found' })
    const comments = db
      .prepare(
        `SELECT id, parent_comment_id AS parentCommentId, agent_id AS agentId, action_type AS actionType, body, created_at AS createdAt
         FROM ai_comments WHERE post_id = ? ORDER BY created_at ASC`
      )
      .all(ctx.params.id)
    sendJson(ctx.res, 200, { post, comments })
  })
}
