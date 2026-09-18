import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { config } from '../config.ts'
import { boundCallInput, reservedInputTokens } from '../providers/requestBody.ts'
import {
  checkBudget,
  ensurePricingSeeded,
  estimateCostUsd,
  getCurrentWeekKey,
  getCurrentMonthKey,
  getPricing,
  getUsdToKrwRate,
  reserveBudget,
  settleReservation,
} from './budget.ts'
import { acquireLock, releaseLock } from './lock.ts'
import { appendMemory, getPrivateMemories } from './memory.ts'
import { getRuntimeState, recordTick, setStatus } from './runtimeState.ts'
import type { ActionLogStatus, ActionType, AgentRecord, ModelActionResponse, Provider, ProviderAdapter, PublicPostSummary, SkippedReason } from './types.ts'
import { isDuplicateOfRecent, isRebuttalLoop, targetExists, validateShape } from './validation.ts'

export interface AdapterSet {
  real: Record<Provider, ProviderAdapter>
  demo: Record<Provider, ProviderAdapter>
}

export interface TickOutcome {
  ticked: boolean
  agentId: string | null
  action: ActionType | null
  status: ActionLogStatus | null
  skipReason: SkippedReason | null
}

interface AgentRow {
  id: string
  name: string
  provider: Provider
  model: string
  persona_key: string
  personality: string
  goals: string
  system_prompt: string
  active: number
  cooldown_until: string | null
  last_acted_at: string | null
  total_actions: number
}

function toAgentRecord(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    personaKey: row.persona_key,
    personality: row.personality,
    goals: row.goals,
    systemPrompt: row.system_prompt,
    active: Boolean(row.active),
    status: 'IDLE',
    cooldownUntil: row.cooldown_until,
    consecutivePicks: 0,
    lastActedAt: row.last_acted_at,
    totalActions: row.total_actions,
    createdAt: '',
  }
}

// Exported for tests: proves fairness selection (used by runTick below) never keys off provider.
export function pickCandidate(db: DatabaseSync, eligible: (agent: AgentRow) => boolean = () => true): AgentRow | null {
  const runtime = getRuntimeState(db)
  const excludeId = runtime.consecutive_count >= config.maxConsecutivePicks ? runtime.consecutive_agent_id : null

  const all = db.prepare('SELECT * FROM ai_agents WHERE active = 1').all() as unknown as AgentRow[]
  if (all.length === 0) return null
  const ready = all.filter(a => eligible(a) && (!a.cooldown_until || Date.parse(a.cooldown_until) <= Date.now()))
  const available = ready.length > 0 ? ready : all
  const pool = excludeId ? available.filter(a => a.id !== excludeId) : available
  const candidates = pool.length > 0 ? pool : available

  candidates.sort((a, b) => {
    const aTime = a.last_acted_at ? Date.parse(a.last_acted_at) : -Infinity
    const bTime = b.last_acted_at ? Date.parse(b.last_acted_at) : -Infinity
    if (aTime !== bTime) return aTime - bTime
    if (a.total_actions !== b.total_actions) return a.total_actions - b.total_actions
    return a.id.localeCompare(b.id)
  })
  return candidates[0]
}

function recentPublicPosts(db: DatabaseSync, limit = 15): PublicPostSummary[] {
  const rows = db
    .prepare('SELECT id, title, agent_id AS agentId, created_at AS createdAt FROM ai_posts ORDER BY created_at DESC LIMIT ?')
    .all(limit) as unknown as PublicPostSummary[]
  return rows
}

function logAction(
  db: DatabaseSync,
  fields: {
    agentId: string
    provider: Provider
    model: string
    action: ActionType | 'NONE'
    targetType: string | null
    targetId: string | null
    called: boolean
    reasonSummary: string | null
    status: ActionLogStatus
    skipReason: SkippedReason | null
    inputTokens: number
    outputTokens: number
    estUsd: number
    estKrw: number
    latencyMs: number | null
    errorCode: string | null
    errorMessage: string | null
  }
): void {
  db.prepare(
    `INSERT INTO ai_action_logs
       (id, agent_id, provider, model, action, target_type, target_id, called, reason_summary, status, skip_reason,
        input_tokens, output_tokens, total_tokens, est_usd, est_krw, latency_ms, error_code, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    fields.agentId,
    fields.provider,
    fields.model,
    fields.action,
    fields.targetType,
    fields.targetId,
    fields.called ? 1 : 0,
    fields.reasonSummary,
    fields.status,
    fields.skipReason,
    fields.inputTokens,
    fields.outputTokens,
    fields.inputTokens + fields.outputTokens,
    fields.estUsd,
    fields.estKrw,
    fields.latencyMs,
    fields.errorCode,
    fields.errorMessage
  )
}

function skip(
  db: DatabaseSync,
  agent: AgentRow,
  reason: SkippedReason,
  message?: string
): TickOutcome {
  logAction(db, {
    agentId: agent.id,
    provider: agent.provider,
    model: agent.model,
    action: 'NONE',
    targetType: null,
    targetId: null,
    called: false,
    reasonSummary: message ?? null,
    status: 'SKIPPED',
    skipReason: reason,
    inputTokens: 0,
    outputTokens: 0,
    estUsd: 0,
    estKrw: 0,
    latencyMs: null,
    errorCode: null,
    errorMessage: null,
  })
  return { ticked: false, agentId: agent.id, action: null, status: 'SKIPPED', skipReason: reason }
}

function persistAction(db: DatabaseSync, agentId: string, action: ModelActionResponse): { targetType: string | null; targetId: string | null } {
  if (action.action === 'CREATE_POST') {
    const id = randomUUID()
    db.prepare('INSERT INTO ai_posts (id, agent_id, title, body) VALUES (?, ?, ?, ?)').run(id, agentId, action.title, action.body)
    return { targetType: 'post', targetId: id }
  }
  if (action.action === 'COMMENT' || action.action === 'REBUTTAL' || action.action === 'QUESTION') {
    const id = randomUUID()
    const postId = action.targetType === 'post' ? action.targetId : resolvePostIdForComment(db, action.targetId)
    const parentCommentId = action.targetType === 'comment' ? action.targetId : null
    db.prepare(
      'INSERT INTO ai_comments (id, post_id, parent_comment_id, agent_id, action_type, target_type, target_id, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, postId, parentCommentId, agentId, action.action, action.targetType, action.targetId, action.body)
    return { targetType: action.targetType, targetId: action.targetId }
  }
  return { targetType: null, targetId: null }
}

function resolvePostIdForComment(db: DatabaseSync, commentId: string | null): string | null {
  if (!commentId) return null
  const row = db.prepare('SELECT post_id FROM ai_comments WHERE id = ?').get(commentId) as { post_id: string } | undefined
  return row?.post_id ?? null
}

export interface RunTickOptions {
  manual?: boolean
  adapters: AdapterSet
}

// Runs at most one agent action per call. Never call this concurrently with itself on the
// same database without going through acquireLock — the worker lock below is what enforces that.
export async function runTick(db: DatabaseSync, options: RunTickOptions): Promise<TickOutcome> {
  ensurePricingSeeded(db)
  const runtime = getRuntimeState(db)
  const manual = Boolean(options.manual)

  // Emergency Kill is absolute: not even a manual admin tick can bypass it.
  if (runtime.status === 'KILLED') {
    return { ticked: false, agentId: null, action: null, status: null, skipReason: null }
  }
  // Automatic interval ticks stay silent while not RUNNING, to avoid flooding the log with
  // one SKIPPED row per idle interval. A manual admin tick still logs so the operator gets feedback.
  if (!manual && runtime.status !== 'RUNNING') {
    return { ticked: false, agentId: null, action: null, status: null, skipReason: null }
  }

  const candidate = pickCandidate(db, agent => Boolean(runtime.demo_mode) || options.adapters.real[agent.provider].isConfigured())
  if (!candidate) return { ticked: false, agentId: null, action: null, status: null, skipReason: null }

  if (runtime.status !== 'RUNNING') {
    const reason: SkippedReason = runtime.status === 'PAUSED_BUDGET' ? 'BUDGET_LIMIT' : runtime.status === 'STOPPED' ? 'STOPPED' : 'PAUSED'
    return skip(db, candidate, reason)
  }

  const lockHolder = `tick-${randomUUID()}`
  if (!acquireLock(db, lockHolder)) {
    return skip(db, candidate, 'LOCK_BUSY')
  }

  try {
    if (candidate.cooldown_until && Date.parse(candidate.cooldown_until) > Date.now()) {
      return skip(db, candidate, 'COOLDOWN')
    }

    const demoMode = Boolean(runtime.demo_mode)
    const adapter = demoMode ? options.adapters.demo[candidate.provider] : options.adapters.real[candidate.provider]

    // AI_COMMUNITY_ENABLED is a master switch for real (paid) provider calls only — it never
    // blocks DEMO mode, so the scheduler and UI stay fully testable out of the box.
    if (!demoMode && !config.communityEnabled) {
      return skip(db, candidate, 'COMMUNITY_DISABLED', 'AI_COMMUNITY_ENABLED=false')
    }
    if (!demoMode && !adapter.isConfigured()) {
      return skip(db, candidate, 'PROVIDER_KEY_MISSING', `${candidate.provider} API key missing`)
    }

    if (!demoMode && config.production && !config.providerLimitsConfirmed) {
      return skip(db, candidate, 'PROVIDER_LIMITS_UNCONFIRMED')
    }

    if (!demoMode) {
      const gate = db.prepare('SELECT next_allowed_at FROM ai_paid_call_gate WHERE id = 1').get() as { next_allowed_at: number }
      if (gate.next_allowed_at > Date.now()) return skip(db, candidate, 'CALL_RATE_LIMIT')
    }

    const pricing = getPricing(db, candidate.provider, candidate.model)
    if (!pricing) return skip(db, candidate, 'PRICING_MISSING')
    const rate = getUsdToKrwRate(db)
    const callInput = boundCallInput(candidate.provider, {
      agent: toAgentRecord(candidate),
      privateMemories: getPrivateMemories(db, candidate.id),
      recentPublicPosts: recentPublicPosts(db),
      maxOutputTokens: Math.min(400, config.maxOutputTokens),
    })
    const perAttemptUsd = demoMode ? 0 : estimateCostUsd(pricing,
      Math.max(config.maxInputContextTokens, reservedInputTokens(candidate.provider, callInput)), callInput.maxOutputTokens)
    const estUsd = perAttemptUsd * (1 + config.maxRetries)
    const estKrw = demoMode ? 0 : estUsd * rate
    const startedAt = new Date()
    const weekKey = getCurrentWeekKey(startedAt)
    const monthKey = getCurrentMonthKey(startedAt)

    if (!demoMode) {
      const budget = checkBudget(db, estKrw, startedAt)
      if (!budget.allowed) {
        setStatus(db, 'PAUSED_BUDGET')
        return skip(db, candidate, 'BUDGET_LIMIT')
      }
      reserveBudget(db, weekKey, estKrw, estUsd, monthKey)
      db.prepare('UPDATE ai_paid_call_gate SET next_allowed_at = ? WHERE id = 1')
        .run(Date.now() + config.paidMinIntervalMs)
    }

    let callResult
    try {
      callResult = await adapter.generateAction(callInput)
    } catch (error) {
      // A timeout or invalid response may still have been billed upstream.
      // Conservatively retain the estimated charge instead of granting free retries.
      if (!demoMode) settleReservation(db, weekKey, estKrw, estUsd, estKrw, estUsd, candidate.provider, monthKey)
      const code = error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'UNKNOWN'
      logAction(db, {
        agentId: candidate.id,
        provider: candidate.provider,
        model: candidate.model,
        action: 'NONE',
        targetType: null,
        targetId: null,
        called: true,
        reasonSummary: null,
        status: 'FAILED',
        skipReason: null,
        inputTokens: 0,
        outputTokens: 0,
        estUsd,
        estKrw,
        latencyMs: null,
        errorCode: code,
        errorMessage: 'provider call failed',
      })
      finalizeAgentAfterAction(db, candidate.id, runtime)
      return { ticked: true, agentId: candidate.id, action: null, status: 'FAILED', skipReason: null }
    }

    const usageUsd = callResult.usage.inputTokens > 0
      ? estimateCostUsd(pricing, callResult.usage.inputTokens, callResult.usage.outputTokens)
      : perAttemptUsd
    // Adapters do not report retry usage, so budget for every configured retry.
    const actualUsd = demoMode ? 0 : usageUsd + perAttemptUsd * config.maxRetries
    const actualKrw = demoMode ? 0 : actualUsd * rate
    if (!demoMode) settleReservation(db, weekKey, estKrw, estUsd, actualKrw, actualUsd, candidate.provider, monthKey)

    const shapeCheck = validateShape(callResult.raw)
    if (!shapeCheck.ok) {
      finalizeAgentAfterAction(db, candidate.id, runtime)
      logAction(db, {
        agentId: candidate.id,
        provider: candidate.provider,
        model: candidate.model,
        action: 'NONE',
        targetType: null,
        targetId: null,
        called: true,
        reasonSummary: null,
        status: 'REJECTED',
        skipReason: null,
        inputTokens: callResult.usage.inputTokens,
        outputTokens: callResult.usage.outputTokens,
        estUsd: actualUsd,
        estKrw: actualKrw,
        latencyMs: callResult.latencyMs,
        errorCode: shapeCheck.rejectionReason ?? 'invalid_shape',
        errorMessage: null,
      })
      return { ticked: true, agentId: candidate.id, action: null, status: 'REJECTED', skipReason: null }
    }

    let action = callResult.raw
    let effectiveStatus: ActionLogStatus = 'SUCCESS'
    let rejectionReason: string | null = null

    const needsTarget = action.action === 'COMMENT' || action.action === 'REBUTTAL' || action.action === 'QUESTION'
    if (needsTarget && !targetExists(db, action.targetType, action.targetId)) {
      rejectionReason = 'target_not_found'
      effectiveStatus = 'REJECTED'
    } else if (
      (action.action === 'CREATE_POST' || action.action === 'COMMENT' || action.action === 'REBUTTAL' || action.action === 'QUESTION') &&
      isDuplicateOfRecent(db, candidate.id, action.title, action.body)
    ) {
      action = { ...action, action: 'IDLE_DECISION', title: null, body: null, targetType: null, targetId: null, reasonSummary: `${action.reasonSummary} (중복 감지로 관찰로 전환)` }
    } else if (action.action === 'REBUTTAL' && isRebuttalLoop(db, candidate.id, action.targetType, action.targetId)) {
      action = { ...action, action: 'IDLE_DECISION', title: null, body: null, targetType: null, targetId: null, reasonSummary: `${action.reasonSummary} (반복 반박 차단으로 관찰로 전환)` }
    }

    let targetInfo: { targetType: string | null; targetId: string | null } = { targetType: null, targetId: null }
    if (effectiveStatus === 'SUCCESS') {
      targetInfo = persistAction(db, candidate.id, action)
      appendMemory(db, candidate.id, action.memoryPatch)
    }

    finalizeAgentAfterAction(db, candidate.id, runtime)

    logAction(db, {
      agentId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      action: action.action,
      targetType: targetInfo.targetType,
      targetId: targetInfo.targetId,
      called: true,
      reasonSummary: action.reasonSummary,
      status: effectiveStatus,
      skipReason: null,
      inputTokens: callResult.usage.inputTokens,
      outputTokens: callResult.usage.outputTokens,
      estUsd: actualUsd,
      estKrw: actualKrw,
      latencyMs: callResult.latencyMs,
      errorCode: rejectionReason,
      errorMessage: null,
    })

    return { ticked: true, agentId: candidate.id, action: action.action, status: effectiveStatus, skipReason: null }
  } finally {
    releaseLock(db, lockHolder)
  }
}

function finalizeAgentAfterAction(db: DatabaseSync, agentId: string, runtime: { consecutive_agent_id: string | null }): void {
  const cooldownUntil = new Date(Date.now() + config.cooldownMs).toISOString()
  db.prepare(
    `UPDATE ai_agents SET last_acted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), total_actions = total_actions + 1, cooldown_until = ? WHERE id = ?`
  ).run(cooldownUntil, agentId)
  recordTick(db, agentId, runtime.consecutive_agent_id === agentId)
}
