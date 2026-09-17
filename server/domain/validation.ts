import type { DatabaseSync } from 'node:sqlite'
import type { ActionType, ModelActionResponse } from './types.ts'

export interface ValidationResult {
  ok: boolean
  rejectionReason?: string
  /** When a borderline response should quietly become IDLE_DECISION instead of a hard reject. */
  downgradeToIdle?: boolean
}

const MAX_TITLE_LEN = 120
const MAX_BODY_LEN = 1200
const MAX_REASON_LEN = 300
const MAX_MEMORY_LEN = 400
const VALID_ACTIONS: ActionType[] = ['CREATE_POST', 'COMMENT', 'REBUTTAL', 'QUESTION', 'OBSERVE', 'IDLE_DECISION']

export function validateShape(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, rejectionReason: 'not_an_object' }
  const r = raw as Partial<ModelActionResponse>

  if (typeof r.action !== 'string' || !VALID_ACTIONS.includes(r.action as ActionType)) {
    return { ok: false, rejectionReason: 'invalid_action' }
  }
  if (typeof r.reasonSummary !== 'string' || r.reasonSummary.trim().length === 0) {
    return { ok: false, rejectionReason: 'missing_reason_summary' }
  }
  if (r.reasonSummary.length > MAX_REASON_LEN) return { ok: false, rejectionReason: 'reason_summary_too_long' }
  if (typeof r.memoryPatch !== 'string') return { ok: false, rejectionReason: 'missing_memory_patch' }
  if (r.memoryPatch.length > MAX_MEMORY_LEN) return { ok: false, rejectionReason: 'memory_patch_too_long' }

  const needsBody = r.action === 'CREATE_POST' || r.action === 'COMMENT' || r.action === 'REBUTTAL' || r.action === 'QUESTION'
  if (needsBody) {
    if (typeof r.body !== 'string' || r.body.trim().length === 0) return { ok: false, rejectionReason: 'missing_body' }
    if (r.body.length > MAX_BODY_LEN) return { ok: false, rejectionReason: 'body_too_long' }
  }
  if (r.action === 'CREATE_POST') {
    if (typeof r.title !== 'string' || r.title.trim().length === 0) return { ok: false, rejectionReason: 'missing_title' }
    if (r.title.length > MAX_TITLE_LEN) return { ok: false, rejectionReason: 'title_too_long' }
  }
  const needsTarget = r.action === 'COMMENT' || r.action === 'REBUTTAL' || r.action === 'QUESTION'
  if (needsTarget) {
    if (r.targetType !== 'post' && r.targetType !== 'comment') return { ok: false, rejectionReason: 'missing_target_type' }
    if (typeof r.targetId !== 'string' || r.targetId.length === 0) return { ok: false, rejectionReason: 'missing_target_id' }
  }
  return { ok: true }
}

export function targetExists(db: DatabaseSync, targetType: string | null, targetId: string | null): boolean {
  if (!targetType || !targetId) return false
  if (targetType === 'post') return Boolean(db.prepare('SELECT 1 FROM ai_posts WHERE id = ?').get(targetId))
  if (targetType === 'comment') return Boolean(db.prepare('SELECT 1 FROM ai_comments WHERE id = ?').get(targetId))
  if (targetType === 'topic') return Boolean(db.prepare('SELECT 1 FROM ai_topics WHERE id = ?').get(targetId))
  return false
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean))
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = wordSet(a)
  const setB = wordSet(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const word of setA) if (setB.has(word)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

const DUPLICATE_SIMILARITY_THRESHOLD = 0.82

// Blocks near-identical self-replication: compares the new text against this agent's own
// recent posts/comments only (not the whole community), so honest repeated agreement by
// different agents is never penalized.
export function isDuplicateOfRecent(db: DatabaseSync, agentId: string, title: string | null, body: string | null): boolean {
  const text = `${title ?? ''} ${body ?? ''}`.trim()
  if (!text) return false
  const recentPosts = db.prepare('SELECT title, body FROM ai_posts WHERE agent_id = ? ORDER BY created_at DESC LIMIT 5').all(agentId) as Array<{ title: string; body: string }>
  const recentComments = db.prepare('SELECT body FROM ai_comments WHERE agent_id = ? ORDER BY created_at DESC LIMIT 5').all(agentId) as Array<{ body: string }>
  for (const p of recentPosts) if (jaccardSimilarity(text, `${p.title} ${p.body}`) >= DUPLICATE_SIMILARITY_THRESHOLD) return true
  for (const c of recentComments) if (jaccardSimilarity(text, c.body) >= DUPLICATE_SIMILARITY_THRESHOLD) return true
  return false
}

const MAX_CONSECUTIVE_REBUTTAL_VOLLEYS = 3

function resolvePostId(db: DatabaseSync, targetType: string, targetId: string): string | null {
  if (targetType === 'post') return targetId
  if (targetType === 'comment') {
    const row = db.prepare('SELECT post_id FROM ai_comments WHERE id = ?').get(targetId) as { post_id: string } | undefined
    return row?.post_id ?? null
  }
  return null
}

// Blocks an infinite two-agent rebuttal volley on the same post thread: once the last
// MAX_CONSECUTIVE_REBUTTAL_VOLLEYS comments on that thread are all REBUTTALs alternating
// between exactly two agents, neither of them may add another rebuttal there.
export function isRebuttalLoop(db: DatabaseSync, agentId: string, targetType: string | null, targetId: string | null): boolean {
  if (!targetType || !targetId) return false
  const postId = resolvePostId(db, targetType, targetId)
  if (!postId) return false

  const recent = db
    .prepare('SELECT agent_id, action_type FROM ai_comments WHERE post_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(postId, MAX_CONSECUTIVE_REBUTTAL_VOLLEYS) as Array<{ agent_id: string; action_type: string }>

  if (recent.length < MAX_CONSECUTIVE_REBUTTAL_VOLLEYS) return false
  if (!recent.every(row => row.action_type === 'REBUTTAL')) return false

  const participants = new Set(recent.map(row => row.agent_id))
  return participants.size <= 2 && participants.has(agentId)
}
