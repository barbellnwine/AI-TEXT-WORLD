import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

// WORLD RULE PRESET — reusable per-world rule sets the admin Builder manages. This is distinct
// from the site-wide WORLD CONSTITUTION (server/prompts/worldRules.ts), which is baked into every
// AGENT/GM/NARRATOR prompt regardless of preset and is never editable here (see START_WORLD.md-style
// notes in worldLaunch.ts). A preset only ever affects the specific world(s) it's attached to.

export const RULE_CATEGORIES = [
  'BASIC_PRINCIPLE', 'PHYSICS', 'SPACE_MOVEMENT', 'RESOURCE_ITEM', 'SURVIVAL_BODY',
  'EMOTION_DESIRE', 'RELATIONSHIP', 'KNOWLEDGE_INFO', 'TECHNOLOGY_SETTING', 'DEATH_INJURY', 'CUSTOM',
] as const
export type RuleCategory = typeof RULE_CATEGORIES[number]

export interface WorldRuleRow {
  id: string
  preset_id: string
  category: RuleCategory
  title: string
  description: string
  enabled: number
  priority: number
  system_locked: number
  custom: number
  sort_order: number
}

export interface WorldRuleDTO {
  id: string
  category: RuleCategory
  title: string
  description: string
  enabled: boolean
  priority: number
  systemLocked: boolean
  custom: boolean
}

export interface RulePresetSummary {
  id: string
  name: string
  description: string
  isSystem: boolean
  ruleCount: number
  createdAt: string
  updatedAt: string
}

export interface RulePresetDTO extends RulePresetSummary {
  rules: WorldRuleDTO[]
}

function toRuleDTO(row: WorldRuleRow): WorldRuleDTO {
  return {
    id: row.id, category: row.category, title: row.title, description: row.description,
    enabled: Boolean(row.enabled), priority: row.priority, systemLocked: Boolean(row.system_locked), custom: Boolean(row.custom),
  }
}

function rulesForPreset(db: DatabaseSync, presetId: string): WorldRuleRow[] {
  return db.prepare('SELECT * FROM world_rules WHERE preset_id = ? ORDER BY sort_order, created_at')
    .all(presetId) as unknown as WorldRuleRow[]
}

export function listRulePresets(db: DatabaseSync): RulePresetSummary[] {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.description, p.is_system as isSystem, p.created_at as createdAt, p.updated_at as updatedAt,
      (SELECT COUNT(*) FROM world_rules r WHERE r.preset_id = p.id) as ruleCount
    FROM world_rule_presets p ORDER BY p.is_system DESC, p.created_at
  `).all() as unknown as Array<{ id: string; name: string; description: string; isSystem: number; createdAt: string; updatedAt: string; ruleCount: number }>
  return rows.map(r => ({ ...r, isSystem: Boolean(r.isSystem) }))
}

export function getRulePreset(db: DatabaseSync, id: string): RulePresetDTO | undefined {
  const row = db.prepare('SELECT * FROM world_rule_presets WHERE id = ?').get(id) as
    | { id: string; name: string; description: string; is_system: number; created_at: string; updated_at: string }
    | undefined
  if (!row) return undefined
  const rules = rulesForPreset(db, id).map(toRuleDTO)
  return { id: row.id, name: row.name, description: row.description, isSystem: Boolean(row.is_system), ruleCount: rules.length, createdAt: row.created_at, updatedAt: row.updated_at, rules }
}

export function createRulePreset(db: DatabaseSync, input: { name: string; description?: string }): RulePresetDTO {
  const id = randomUUID()
  db.prepare('INSERT INTO world_rule_presets (id, name, description) VALUES (?, ?, ?)').run(id, input.name, input.description ?? '')
  return getRulePreset(db, id) as RulePresetDTO
}

export function updateRulePresetMeta(db: DatabaseSync, id: string, input: { name?: string; description?: string }): RulePresetDTO | undefined {
  const existing = db.prepare('SELECT id FROM world_rule_presets WHERE id = ?').get(id)
  if (!existing) return undefined
  if (input.name !== undefined) db.prepare(`UPDATE world_rule_presets SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(input.name, id)
  if (input.description !== undefined) db.prepare(`UPDATE world_rule_presets SET description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(input.description, id)
  return getRulePreset(db, id)
}

export function duplicateRulePreset(db: DatabaseSync, id: string, newName: string): RulePresetDTO | undefined {
  const source = getRulePreset(db, id)
  if (!source) return undefined
  const newId = randomUUID()
  db.prepare('INSERT INTO world_rule_presets (id, name, description, is_system) VALUES (?, ?, ?, 0)').run(newId, newName, source.description)
  for (const rule of source.rules) {
    // A duplicate is a free-standing, fully-editable copy — nothing stays system_locked, even if
    // the source rule was (that protection only makes sense on the original seed preset).
    insertRule(db, newId, { category: rule.category, title: rule.title, description: rule.description, enabled: rule.enabled, priority: rule.priority, systemLocked: false, custom: rule.custom })
  }
  return getRulePreset(db, newId)
}

export function deleteRulePreset(db: DatabaseSync, id: string): { ok: true } | { ok: false; error: string } {
  const preset = db.prepare('SELECT is_system FROM world_rule_presets WHERE id = ?').get(id) as { is_system: number } | undefined
  if (!preset) return { ok: false, error: 'preset_not_found' }
  if (preset.is_system) return { ok: false, error: 'cannot_delete_system_preset' }
  const inUse = db.prepare('SELECT id FROM world_drafts WHERE rule_preset_id = ? LIMIT 1').get(id)
  if (inUse) return { ok: false, error: 'preset_in_use_by_a_draft' }
  db.prepare('DELETE FROM world_rules WHERE preset_id = ?').run(id)
  db.prepare('DELETE FROM world_rule_presets WHERE id = ?').run(id)
  return { ok: true }
}

interface NewRuleInput {
  category: RuleCategory
  title: string
  description: string
  enabled: boolean
  priority: number
  systemLocked: boolean
  custom: boolean
}

function insertRule(db: DatabaseSync, presetId: string, rule: NewRuleInput): void {
  db.prepare(`
    INSERT INTO world_rules (id, preset_id, category, title, description, enabled, priority, system_locked, custom, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), presetId, rule.category, rule.title, rule.description, rule.enabled ? 1 : 0, rule.priority, rule.systemLocked ? 1 : 0, rule.custom ? 1 : 0, 0)
}

export interface IncomingRule {
  id?: string
  category: RuleCategory
  title: string
  description: string
  enabled: boolean
  priority: number
}

// Full-list replace with locked-rule protection: a system_locked rule can never be deleted, and
// its category/title/description can never change via this call — only enabled/priority can.
export function setPresetRules(db: DatabaseSync, presetId: string, incoming: IncomingRule[]): RulePresetDTO | undefined {
  const preset = db.prepare('SELECT id FROM world_rule_presets WHERE id = ?').get(presetId)
  if (!preset) return undefined
  const existing = new Map(rulesForPreset(db, presetId).map(r => [r.id, r]))
  const seenIds = new Set<string>()

  for (const rule of incoming) {
    const current = rule.id ? existing.get(rule.id) : undefined
    if (current) {
      seenIds.add(current.id)
      if (current.system_locked) {
        db.prepare(`UPDATE world_rules SET enabled = ?, priority = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
          .run(rule.enabled ? 1 : 0, rule.priority, current.id)
      } else {
        db.prepare(`
          UPDATE world_rules SET category = ?, title = ?, description = ?, enabled = ?, priority = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?
        `).run(rule.category, rule.title, rule.description, rule.enabled ? 1 : 0, rule.priority, current.id)
      }
    } else {
      insertRule(db, presetId, { ...rule, systemLocked: false, custom: true })
    }
  }
  // Anything system_locked that the incoming list dropped is silently kept (deletion is ignored).
  // Anything non-locked and not present in the incoming list is a real deletion.
  for (const row of existing.values()) {
    if (!row.system_locked && !seenIds.has(row.id)) {
      db.prepare('DELETE FROM world_rules WHERE id = ?').run(row.id)
    }
  }
  db.prepare(`UPDATE world_rule_presets SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(presetId)
  return getRulePreset(db, presetId)
}

const SYSTEM_PRESET_ID = 'preset-realistic-world'

// Idempotent, same pattern as agentsSeed.ts — safe to call on every boot.
export function seedDefaultRulePreset(db: DatabaseSync): void {
  const exists = db.prepare('SELECT id FROM world_rule_presets WHERE id = ?').get(SYSTEM_PRESET_ID)
  if (exists) return
  db.prepare('INSERT INTO world_rule_presets (id, name, description, is_system) VALUES (?, ?, ?, 1)')
    .run(SYSTEM_PRESET_ID, 'REALISTIC_WORLD', '현실 물리 법칙을 따르는 기본 프리셋. 새 WORLD를 만들 때의 출발점으로 사용하세요.')
  const defaults: NewRuleInput[] = [
    { category: 'BASIC_PRINCIPLE', title: 'WORLD STATE가 유일한 현실 기준', description: 'WORLD STATE에 기록되지 않은 사실은 존재하지 않는 것으로 취급한다.', enabled: true, priority: 100, systemLocked: true, custom: false },
    { category: 'PHYSICS', title: '현실 물리 법칙 적용', description: '초자연적 현상이나 현실에 없는 물리 법칙은 적용되지 않는다.', enabled: true, priority: 90, systemLocked: true, custom: false },
    { category: 'SPACE_MOVEMENT', title: '연결된 경로로만 이동', description: '캐릭터는 정의된 연결 관계가 없는 장소로 순간 이동할 수 없다.', enabled: true, priority: 90, systemLocked: true, custom: false },
    { category: 'RESOURCE_ITEM', title: '실재하는 자원·물품만 사용', description: '캐릭터는 WORLD STATE에 실제로 존재하는 소지품과 자원만 사용할 수 있다.', enabled: true, priority: 80, systemLocked: true, custom: false },
    { category: 'SURVIVAL_BODY', title: '신체 상태 무시 금지', description: '부상, 피로, 배고픔, 감금 등의 상태를 임의로 무시할 수 없다.', enabled: true, priority: 80, systemLocked: true, custom: false },
    { category: 'EMOTION_DESIRE', title: '욕구 수치는 행동을 강제하지 않음', description: 'HUMAN STATE 수치가 높다고 해서 특정 행동이 자동으로 실행되지 않는다.', enabled: true, priority: 70, systemLocked: true, custom: false },
    { category: 'RELATIONSHIP', title: '타인의 동의는 대신 결정 불가', description: '한 캐릭터가 다른 캐릭터의 감정, 동의, 반응을 대신 확정할 수 없다.', enabled: true, priority: 80, systemLocked: true, custom: false },
    { category: 'KNOWLEDGE_INFO', title: '직접 관찰·전달 정보만 인지', description: '캐릭터는 자신이 직접 관찰했거나 전달받은 정보만 알고 있는 것으로 취급된다.', enabled: true, priority: 80, systemLocked: true, custom: false },
    { category: 'TECHNOLOGY_SETTING', title: '현재 인류 기술 수준', description: '이 세계의 기술 수준은 특별한 설정이 없는 한 현재 인류 기술 범위를 넘지 않는다.', enabled: true, priority: 50, systemLocked: false, custom: false },
    { category: 'DEATH_INJURY', title: '사망 캐릭터는 부활 불가', description: '사망 판정을 받은 캐릭터는 이후 어떤 사건으로도 되살아날 수 없다.', enabled: true, priority: 100, systemLocked: true, custom: false },
  ]
  for (const rule of defaults) insertRule(db, SYSTEM_PRESET_ID, rule)
}
