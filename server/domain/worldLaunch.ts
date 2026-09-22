// START WORLD orchestration (builder spec section 35). Turns a validated DraftDTO into the exact
// shapes WORLD ENGINE already understands (server/domain/worldTypes.ts) and hands them to
// worldStore.loadWorldState() — this file builds data, it never simulates anything itself
// (section 47: Builder produces INITIAL WORLD DATA, WORLD ENGINE runs the world).
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { Agent, Place, Relationship, RelationshipStance, Resource, Season, WorldClock, WorldEvent, WorldState, WorldTimeOfDay } from './worldTypes.ts'
import type { DraftDTO } from './worldDrafts.ts'
import { getRulePreset } from './rulePresets.ts'
import { validateDraftForStart, type ValidationResult } from '../world/builderValidation.ts'
import { setDraftStatus } from './worldDrafts.ts'
import * as store from './worldStore.ts'
import { config } from '../config.ts'
import { initializeEngine } from '../world/worldEngine.ts'

function timeOfDay(time: string): WorldTimeOfDay {
  const hour = Number(time.split(':')[0] ?? 8)
  if (hour < 5) return 'lateNight'
  if (hour < 7) return 'dawn'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 20) return 'evening'
  return 'night'
}

// The existing engine models relationships as a single qualitative stance (server/world/*),
// while the builder captures trust/affection/attraction as separate 1-10 numbers (section 22).
// This maps the richer per-world design data down to the shape WORLD ENGINE already consumes,
// without changing that engine at all.
function deriveStance(trust: number, affection: number): RelationshipStance {
  const avg = (trust + affection) / 2
  if (avg >= 8) return 'ally'
  if (avg >= 6) return 'friendly'
  if (avg >= 4) return 'neutral'
  if (avg >= 2) return 'wary'
  return 'hostile'
}

function buildPlaces(draft: DraftDTO): Place[] {
  const connectedIds = new Map<string, Set<string>>()
  for (const conn of draft.connections) {
    if (conn.blocked) continue
    if (!connectedIds.has(conn.fromPlaceId)) connectedIds.set(conn.fromPlaceId, new Set())
    if (!connectedIds.has(conn.toPlaceId)) connectedIds.set(conn.toPlaceId, new Set())
    connectedIds.get(conn.fromPlaceId)!.add(conn.toPlaceId)
    connectedIds.get(conn.toPlaceId)!.add(conn.fromPlaceId)
  }
  const agentsByPlace = new Map<string, string[]>()
  for (const c of draft.characters) {
    if (!c.initialPlaceId) continue
    agentsByPlace.set(c.initialPlaceId, [...(agentsByPlace.get(c.initialPlaceId) ?? []), c.id])
  }
  return draft.places.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    connectedPlaceIds: [...(connectedIds.get(p.id) ?? [])],
    currentAgentIds: agentsByPlace.get(p.id) ?? [],
    resources: p.resources.map((r): Resource => ({ key: r.key, label: r.label, level: r.level, max: r.max, trend: 'stable', unit: r.unit })),
    locked: false,
    accessCondition: p.facilityStatus || undefined,
    recentEventIds: [],
  }))
}

function buildAgents(draft: DraftDTO, nowIso: string): Agent[] {
  const relationshipsByFrom = new Map<string, Relationship[]>()
  for (const rel of draft.relationships) {
    const relationship: Relationship = { agentId: rel.fromCharacterId, otherAgentId: rel.toCharacterId, stance: deriveStance(rel.trust, rel.affection), note: rel.note || undefined }
    relationshipsByFrom.set(rel.fromCharacterId, [...(relationshipsByFrom.get(rel.fromCharacterId) ?? []), relationship])
  }
  return draft.characters.map((c, index) => ({
    id: c.id,
    name: c.name,
    codeNumber: `C-${String(index + 1).padStart(2, '0')}`,
    avatarId: 'default',
    shortBio: [c.occupation, c.personality].filter(Boolean).join(' · ').slice(0, 200),
    factionIds: [],
    publicState: { locationId: c.initialPlaceId ?? '', status: 'alive', visibleGoal: c.goal || null, lastAction: null, lastActiveAt: nowIso },
    relationships: relationshipsByFrom.get(c.id) ?? [],
    inventory: [...c.inventory],
    knowledge: c.knowledge.map(k => ({ id: randomUUID(), summary: k.summary, learnedAt: nowIso })),
    movementLog: c.initialPlaceId ? [{ placeId: c.initialPlaceId, arrivedAt: nowIso }] : [],
    keyEventIds: [],
    hiddenNotes: c.privateInfo || undefined,
  }))
}

export interface LaunchResult {
  ok: boolean
  errors?: ValidationResult['errors']
  warnings?: ValidationResult['warnings']
}

export function startWorldFromDraft(db: DatabaseSync, draft: DraftDTO): LaunchResult {
  store.assertWorldIdle()
  const validation = validateDraftForStart(draft)
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: validation.warnings }
  if (!['DRAFT', 'READY'].includes(draft.status)) return { ok: false, errors: [{ code: 'WORLD_ALREADY_STARTED', message: '이미 시작한 WORLD입니다. 새 WORLD를 생성해 주세요.' }] }

  // Rule snapshot FIRST and from the live preset at this exact moment — later edits to the
  // preset must never retroactively change this season (section 7/39).
  const preset = draft.rulePresetId ? getRulePreset(db, draft.rulePresetId) : undefined
  db.prepare('INSERT INTO season_rule_snapshots (id, draft_id, source_preset_id, rules_json) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), draft.id, draft.rulePresetId, JSON.stringify(preset?.rules ?? []))

  const nowIso = new Date().toISOString()
  const clock: WorldClock = { day: draft.startDay, time: draft.startTime, timeOfDay: timeOfDay(draft.startTime), weather: (draft.startWeather as WorldClock['weather']) || 'clear', temperatureC: draft.startTemperatureC }
  const places = buildPlaces(draft)
  const agents = buildAgents(draft, nowIso)

  const worldState: WorldState = {
    seasonId: draft.id,
    clock,
    dangerLevel: 'stable',
    places,
    agents,
    factions: [],
    activeEventIds: [],
    updatedAt: nowIso,
  }
  initializeEngine(worldState, draft)

  const initialEvent: WorldEvent = {
    id: randomUUID(),
    type: 'SYSTEM',
    occurredAt: nowIso,
    day: draft.startDay,
    worldTime: draft.startTime,
    worldMinute: worldState.engine!.minute,
    phase: 'COMPLETED',
    cause: 'administrator_created_world',
    placeId: places[0]?.id ?? '',
    agentIds: [],
    title: `${draft.name || draft.seasonName || 'WORLD'} 시즌이 시작되었습니다.`,
    summary: draft.backgroundSituation || draft.initialEvent || 'DAY 1이 시작되었습니다.',
    stateChanges: [],
    importance: 'high',
    relatedEventIds: [],
  }
  worldState.activeEventIds = [initialEvent.id]

  const season: Season = {
    id: draft.id,
    name: draft.seasonName || draft.name,
    premise: draft.intro,
    status: 'RUNNING',
    startedAt: nowIso,
    endedAt: null,
    currentDay: draft.startDay,
    agentCount: agents.length,
    survivorCount: agents.length,
  }

  db.prepare("UPDATE world_drafts SET status='ENDED', ended_at=? WHERE status IN ('RUNNING', 'PAUSED') AND id<>?").run(nowIso, draft.id)
  store.loadWorldState({ season, worldState, initialEvent, execution: { draft, rules: preset?.rules ?? [], mode: config.worldDemoMode ? 'demo' : 'live' } })
  setDraftStatus(db, draft.id, 'RUNNING', { startedAt: nowIso })
  return { ok: true, warnings: validation.warnings }
}
