import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { config } from '../config.ts'
import type { StudioConfig } from './studioConfig.ts'
import { getRulePreset, type RuleCategory } from './rulePresets.ts'

export type DraftStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'ENDED' | 'ARCHIVED'
export type CharacterSource = 'AI_AUTO' | 'MANUAL' | 'AI_EDITED'

export interface HumanState { survival_need: number; fatigue: number; stress: number; sexual_desire: number; greed: number; ambition: number }
export interface Emotion { mood: number; anger: number; fear: number }
export interface DraftResource { key: string; label: string; level: number; max: number; unit?: string }
export interface DraftKnowledgeItem { summary: string }

export const DEFAULT_HUMAN_STATE: HumanState = { survival_need: 5, fatigue: 3, stress: 3, sexual_desire: 3, greed: 3, ambition: 4 }
export const DEFAULT_EMOTION: Emotion = { mood: 6, anger: 2, fear: 2 }

// --- row shapes -------------------------------------------------------------

interface DraftRow {
  id: string; status: DraftStatus; wizard_step: number; name: string; intro: string; genre: string; background: string
  season_name: string; max_days: number | null; sim_speed_ms: number; target_population: number; is_public: number
  rule_preset_id: string | null; start_day: number; start_time: string; start_weather: string; start_temperature_c: number
  background_situation: string; initial_event: string; power_status: string; initial_resources_json: string
  facility_status: string; hidden_world_truth: string; end_condition: string
  created_at: string; updated_at: string; started_at: string | null; ended_at: string | null
}

interface PlaceRow {
  id: string; draft_id: string; name: string; description: string; type: string; x: number; y: number
  is_public: number; is_discovered: number; capacity: number | null; resources_json: string; items_json: string
  facility_status: string; sort_order: number
}

interface ConnectionRow {
  id: string; draft_id: string; from_place_id: string; to_place_id: string; travel_time: number
  connection_type: string; blocked: number; requirements: string
}

interface CharacterRow {
  id: string; draft_id: string; name: string; age: number | null; gender: string; appearance: string; background: string
  occupation: string; personality: string; goal: string; strengths_json: string; weaknesses_json: string
  provider: string; model: string; human_state_json: string; emotion_json: string; knowledge_json: string
  private_info: string; inventory_json: string; initial_place_id: string | null; source: CharacterSource
  sort_order: number; created_at: string; updated_at: string
}

interface RelationshipRow {
  id: string; draft_id: string; from_character_id: string; to_character_id: string
  trust: number; affection: number; attraction: number; note: string
}

// --- DTOs ---------------------------------------------------------------

export interface DraftSummary {
  id: string; status: DraftStatus; name: string; seasonName: string; targetPopulation: number
  placeCount: number; characterCount: number; updatedAt: string
}

export interface PlaceDTO {
  id: string; name: string; description: string; type: string; x: number; y: number
  isPublic: boolean; isDiscovered: boolean; capacity: number | null
  resources: DraftResource[]; items: string[]; facilityStatus: string
}

export interface ConnectionDTO {
  id: string; fromPlaceId: string; toPlaceId: string; travelTime: number
  connectionType: string; blocked: boolean; requirements: string
}

export interface CharacterDTO {
  id: string; name: string; age: number | null; gender: string; appearance: string; background: string
  occupation: string; personality: string; goal: string; strengths: string[]; weaknesses: string[]
  provider: string; model: string; humanState: HumanState; emotion: Emotion; knowledge: DraftKnowledgeItem[]
  privateInfo: string; inventory: string[]; initialPlaceId: string | null; source: CharacterSource
  createdAt: string; updatedAt: string
}

export interface RelationshipDTO {
  id: string; fromCharacterId: string; toCharacterId: string; trust: number; affection: number; attraction: number; note: string
}

export interface DraftDTO {
  studio?: StudioConfig
  maxActiveCharacters?: number
  discoverableTruths?: Array<{ id: string; summary: string; placeId: string; revealedPlaceId?: string }>
  id: string; status: DraftStatus; wizardStep: number
  name: string; intro: string; genre: string; background: string; seasonName: string
  maxDays: number | null; simSpeedMs: number; targetPopulation: number; isPublic: boolean
  rulePresetId: string | null
  startDay: number; startTime: string; startWeather: string; startTemperatureC: number
  backgroundSituation: string; initialEvent: string; powerStatus: string; initialResources: DraftResource[]
  facilityStatus: string; hiddenWorldTruth: string; endCondition: string
  createdAt: string; updatedAt: string; startedAt: string | null; endedAt: string | null
  places: PlaceDTO[]; connections: ConnectionDTO[]; characters: CharacterDTO[]; relationships: RelationshipDTO[]
}

function draftDTO(row: DraftRow): Omit<DraftDTO, 'places' | 'connections' | 'characters' | 'relationships'> {
  return {
    id: row.id, status: row.status, wizardStep: row.wizard_step, name: row.name, intro: row.intro, genre: row.genre,
    background: row.background, seasonName: row.season_name, maxDays: row.max_days, simSpeedMs: row.sim_speed_ms,
    targetPopulation: row.target_population, isPublic: Boolean(row.is_public), rulePresetId: row.rule_preset_id,
    startDay: row.start_day, startTime: row.start_time, startWeather: row.start_weather, startTemperatureC: row.start_temperature_c,
    backgroundSituation: row.background_situation, initialEvent: row.initial_event, powerStatus: row.power_status,
    initialResources: JSON.parse(row.initial_resources_json), facilityStatus: row.facility_status,
    hiddenWorldTruth: row.hidden_world_truth, endCondition: row.end_condition,
    createdAt: row.created_at, updatedAt: row.updated_at, startedAt: row.started_at, endedAt: row.ended_at,
  }
}

function placeDTO(row: PlaceRow): PlaceDTO {
  return {
    id: row.id, name: row.name, description: row.description, type: row.type, x: row.x, y: row.y,
    isPublic: Boolean(row.is_public), isDiscovered: Boolean(row.is_discovered), capacity: row.capacity,
    resources: JSON.parse(row.resources_json), items: JSON.parse(row.items_json), facilityStatus: row.facility_status,
  }
}

function connectionDTO(row: ConnectionRow): ConnectionDTO {
  return {
    id: row.id, fromPlaceId: row.from_place_id, toPlaceId: row.to_place_id, travelTime: row.travel_time,
    connectionType: row.connection_type, blocked: Boolean(row.blocked), requirements: row.requirements,
  }
}

function characterDTO(row: CharacterRow): CharacterDTO {
  return {
    id: row.id, name: row.name, age: row.age, gender: row.gender, appearance: row.appearance, background: row.background,
    occupation: row.occupation, personality: row.personality, goal: row.goal,
    strengths: JSON.parse(row.strengths_json), weaknesses: JSON.parse(row.weaknesses_json),
    provider: row.provider, model: row.model, humanState: JSON.parse(row.human_state_json), emotion: JSON.parse(row.emotion_json),
    knowledge: JSON.parse(row.knowledge_json), privateInfo: row.private_info, inventory: JSON.parse(row.inventory_json),
    initialPlaceId: row.initial_place_id, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function relationshipDTO(row: RelationshipRow): RelationshipDTO {
  return { id: row.id, fromCharacterId: row.from_character_id, toCharacterId: row.to_character_id, trust: row.trust, affection: row.affection, attraction: row.attraction, note: row.note }
}

// --- reads ----------------------------------------------------------------

export function listDrafts(db: DatabaseSync): DraftSummary[] {
  const rows = db.prepare(`
    SELECT d.id, d.status, d.name, d.season_name as seasonName, d.target_population as targetPopulation, d.updated_at as updatedAt,
      (SELECT COUNT(*) FROM draft_places p WHERE p.draft_id = d.id) as placeCount,
      (SELECT COUNT(*) FROM draft_characters c WHERE c.draft_id = d.id) as characterCount
    FROM world_drafts d ORDER BY d.updated_at DESC
  `).all() as unknown as DraftSummary[]
  return rows
}

function getDraftRow(db: DatabaseSync, id: string): DraftRow | undefined {
  return db.prepare('SELECT * FROM world_drafts WHERE id = ?').get(id) as DraftRow | undefined
}

export function getDraft(db: DatabaseSync, id: string): DraftDTO | undefined {
  const row = getDraftRow(db, id)
  if (!row) return undefined
  const places = (db.prepare('SELECT * FROM draft_places WHERE draft_id = ? ORDER BY sort_order, name').all(id) as unknown as PlaceRow[]).map(placeDTO)
  const connections = (db.prepare('SELECT * FROM draft_place_connections WHERE draft_id = ?').all(id) as unknown as ConnectionRow[]).map(connectionDTO)
  const characters = (db.prepare('SELECT * FROM draft_characters WHERE draft_id = ? ORDER BY sort_order, created_at').all(id) as unknown as CharacterRow[]).map(characterDTO)
  const relationships = (db.prepare('SELECT * FROM draft_relationships WHERE draft_id = ?').all(id) as unknown as RelationshipRow[]).map(relationshipDTO)
  const truthRow = db.prepare('SELECT payload FROM draft_discoverable_truths WHERE draft_id=?').get(id) as { payload: string } | undefined
  const studioRow = db.prepare('SELECT payload FROM world_studio_config WHERE draft_id=?').get(id) as { payload: string } | undefined
  return { ...draftDTO(row), studio: studioRow ? JSON.parse(studioRow.payload) : undefined, places, connections, characters, relationships, maxActiveCharacters: config.maxActiveCharacters, discoverableTruths: truthRow ? JSON.parse(truthRow.payload) : [] }
}

export function draftExists(db: DatabaseSync, id: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM world_drafts WHERE id = ?').get(id))
}

export function getDraftStatus(db: DatabaseSync, id: string): DraftStatus | undefined {
  return (db.prepare('SELECT status FROM world_drafts WHERE id = ?').get(id) as { status: DraftStatus } | undefined)?.status
}

// --- create / delete --------------------------------------------------------

export function createDraft(db: DatabaseSync, name?: string): DraftDTO {
  const id = randomUUID()
  db.prepare('INSERT INTO world_drafts (id, name, target_population) VALUES (?, ?, ?)').run(id, name?.trim() || '새 WORLD', config.maxActiveCharacters)
  return getDraft(db, id) as DraftDTO
}

export function deleteDraft(db: DatabaseSync, id: string): { ok: true } | { ok: false; error: string } {
  const status = getDraftStatus(db, id)
  if (!status) return { ok: false, error: 'draft_not_found' }
  if (status !== 'DRAFT') return { ok: false, error: 'only_draft_status_can_be_deleted' }
  db.prepare('DELETE FROM draft_relationships WHERE draft_id = ?').run(id)
  db.prepare('DELETE FROM draft_characters WHERE draft_id = ?').run(id)
  db.prepare('DELETE FROM draft_place_connections WHERE draft_id = ?').run(id)
  db.prepare('DELETE FROM draft_places WHERE draft_id = ?').run(id)
  db.prepare('DELETE FROM season_rule_snapshots WHERE draft_id = ?').run(id)
  db.prepare('DELETE FROM world_drafts WHERE id = ?').run(id)
  return { ok: true }
}

function touch(db: DatabaseSync, id: string): void {
  db.prepare(`UPDATE world_drafts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(id)
}

export function setWizardStep(db: DatabaseSync, id: string, step: number): void {
  db.prepare(`UPDATE world_drafts SET wizard_step = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(step, id)
}

// --- STEP 1: basic info ------------------------------------------------------

export interface BasicInfoInput {
  name: string; intro: string; genre: string; background: string; seasonName: string
  maxDays: number | null; simSpeedMs: number; targetPopulation: number; isPublic: boolean
}

export function updateBasicInfo(db: DatabaseSync, id: string, input: BasicInfoInput): DraftDTO | undefined {
  if (!draftExists(db, id)) return undefined
  db.prepare(`
    UPDATE world_drafts SET name=?, intro=?, genre=?, background=?, season_name=?, max_days=?, sim_speed_ms=?, target_population=?, is_public=?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(input.name, input.intro, input.genre, input.background, input.seasonName, input.maxDays, input.simSpeedMs, input.targetPopulation, input.isPublic ? 1 : 0, id)
  return getDraft(db, id)
}

// --- STEP 2: rule preset selection -------------------------------------------

export function updateRuleSelection(db: DatabaseSync, id: string, rulePresetId: string | null): DraftDTO | undefined {
  if (!draftExists(db, id)) return undefined
  if (rulePresetId && !getRulePreset(db, rulePresetId)) return undefined
  db.prepare(`UPDATE world_drafts SET rule_preset_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(rulePresetId, id)
  return getDraft(db, id)
}

// --- STEP 3: start environment ------------------------------------------------

export interface EnvironmentInput {
  discoverableTruths?: DraftDTO['discoverableTruths']
  startDay: number; startTime: string; startWeather: string; startTemperatureC: number
  backgroundSituation: string; initialEvent: string; powerStatus: string; initialResources: DraftResource[]
  facilityStatus: string; hiddenWorldTruth: string; endCondition: string
}

export function updateEnvironment(db: DatabaseSync, id: string, input: EnvironmentInput): DraftDTO | undefined {
  if (!draftExists(db, id)) return undefined
  if (input.discoverableTruths) db.prepare('INSERT INTO draft_discoverable_truths (draft_id, payload) VALUES (?, ?) ON CONFLICT(draft_id) DO UPDATE SET payload=excluded.payload').run(id, JSON.stringify(input.discoverableTruths))
  db.prepare(`
    UPDATE world_drafts SET start_day=?, start_time=?, start_weather=?, start_temperature_c=?, background_situation=?, initial_event=?,
      power_status=?, initial_resources_json=?, facility_status=?, hidden_world_truth=?, end_condition=?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(
    input.startDay, input.startTime, input.startWeather, input.startTemperatureC, input.backgroundSituation, input.initialEvent,
    input.powerStatus, JSON.stringify(input.initialResources), input.facilityStatus, input.hiddenWorldTruth, input.endCondition, id,
  )
  return getDraft(db, id)
}

// --- STEP 4: places + connections ---------------------------------------------

export interface IncomingPlace {
  id?: string; tempId?: string; name: string; description: string; type: string; x: number; y: number
  isPublic: boolean; isDiscovered: boolean; capacity: number | null
  resources: DraftResource[]; items: string[]; facilityStatus: string
}

export interface IncomingConnection {
  id?: string; fromPlaceRef: string; toPlaceRef: string; travelTime: number
  connectionType: string; blocked: boolean; requirements: string
}

export function replacePlacesAndConnections(db: DatabaseSync, draftId: string, places: IncomingPlace[], connections: IncomingConnection[]): DraftDTO | undefined {
  if (!draftExists(db, draftId)) return undefined
  const existingPlaces = new Map((db.prepare('SELECT id FROM draft_places WHERE draft_id = ?').all(draftId) as unknown as { id: string }[]).map(r => [r.id, true]))
  const refMap = new Map<string, string>() // tempId or existing id -> real id
  const keptIds = new Set<string>()

  places.forEach((place, index) => {
    const realId = place.id && existingPlaces.has(place.id) ? place.id : randomUUID()
    keptIds.add(realId)
    if (place.tempId) refMap.set(place.tempId, realId)
    if (place.id) refMap.set(place.id, realId)
    const values = [
      place.name, place.description, place.type, place.x, place.y, place.isPublic ? 1 : 0, place.isDiscovered ? 1 : 0,
      place.capacity, JSON.stringify(place.resources), JSON.stringify(place.items), place.facilityStatus, index,
    ]
    if (place.id && existingPlaces.has(place.id)) {
      db.prepare(`UPDATE draft_places SET name=?, description=?, type=?, x=?, y=?, is_public=?, is_discovered=?, capacity=?, resources_json=?, items_json=?, facility_status=?, sort_order=? WHERE id=?`)
        .run(...values, realId)
    } else {
      db.prepare(`INSERT INTO draft_places (id, draft_id, name, description, type, x, y, is_public, is_discovered, capacity, resources_json, items_json, facility_status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(realId, draftId, ...values)
    }
  })

  for (const existingId of existingPlaces.keys()) {
    if (!keptIds.has(existingId)) {
      db.prepare('UPDATE draft_characters SET initial_place_id = NULL WHERE draft_id = ? AND initial_place_id = ?').run(draftId, existingId)
      db.prepare('DELETE FROM draft_place_connections WHERE draft_id = ? AND (from_place_id = ? OR to_place_id = ?)').run(draftId, existingId, existingId)
      db.prepare('DELETE FROM draft_places WHERE id = ?').run(existingId)
    }
  }

  db.prepare('DELETE FROM draft_place_connections WHERE draft_id = ?').run(draftId)
  for (const conn of connections) {
    const fromId = refMap.get(conn.fromPlaceRef)
    const toId = refMap.get(conn.toPlaceRef)
    if (!fromId || !toId) continue // a connection referencing an unknown/removed place is dropped silently
    db.prepare(`INSERT INTO draft_place_connections (id, draft_id, from_place_id, to_place_id, travel_time, connection_type, blocked, requirements) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), draftId, fromId, toId, conn.travelTime, conn.connectionType, conn.blocked ? 1 : 0, conn.requirements)
  }

  touch(db, draftId)
  return getDraft(db, draftId)
}

// --- STEP 6/7: characters -----------------------------------------------------

export interface CharacterInput {
  name: string; age: number | null; gender: string; appearance: string; background: string; occupation: string
  personality: string; goal: string; strengths: string[]; weaknesses: string[]; provider: string; model: string
  humanState: HumanState; emotion: Emotion; knowledge: DraftKnowledgeItem[]; privateInfo: string
  inventory: string[]; initialPlaceId: string | null
}

export function createCharacter(db: DatabaseSync, draftId: string, input: CharacterInput, source: CharacterSource): CharacterDTO | undefined {
  if (!draftExists(db, draftId)) return undefined
  const id = randomUUID()
  const count = (db.prepare('SELECT COUNT(*) as n FROM draft_characters WHERE draft_id = ?').get(draftId) as { n: number }).n
  db.prepare(`
    INSERT INTO draft_characters (id, draft_id, name, age, gender, appearance, background, occupation, personality, goal,
      strengths_json, weaknesses_json, provider, model, human_state_json, emotion_json, knowledge_json, private_info,
      inventory_json, initial_place_id, source, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, draftId, input.name, input.age, input.gender, input.appearance, input.background, input.occupation, input.personality, input.goal,
    JSON.stringify(input.strengths), JSON.stringify(input.weaknesses), input.provider, input.model,
    JSON.stringify(input.humanState), JSON.stringify(input.emotion), JSON.stringify(input.knowledge), input.privateInfo,
    JSON.stringify(input.inventory), input.initialPlaceId, source, count,
  )
  touch(db, draftId)
  return characterDTO(db.prepare('SELECT * FROM draft_characters WHERE id = ?').get(id) as unknown as CharacterRow)
}

export function updateCharacter(db: DatabaseSync, draftId: string, charId: string, input: CharacterInput): CharacterDTO | undefined {
  const current = db.prepare('SELECT * FROM draft_characters WHERE id = ? AND draft_id = ?').get(charId, draftId) as CharacterRow | undefined
  if (!current) return undefined
  const nextSource: CharacterSource = current.source === 'AI_AUTO' ? 'AI_EDITED' : current.source
  db.prepare(`
    UPDATE draft_characters SET name=?, age=?, gender=?, appearance=?, background=?, occupation=?, personality=?, goal=?,
      strengths_json=?, weaknesses_json=?, provider=?, model=?, human_state_json=?, emotion_json=?, knowledge_json=?,
      private_info=?, inventory_json=?, initial_place_id=?, source=?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(
    input.name, input.age, input.gender, input.appearance, input.background, input.occupation, input.personality, input.goal,
    JSON.stringify(input.strengths), JSON.stringify(input.weaknesses), input.provider, input.model,
    JSON.stringify(input.humanState), JSON.stringify(input.emotion), JSON.stringify(input.knowledge), input.privateInfo,
    JSON.stringify(input.inventory), input.initialPlaceId, nextSource, charId,
  )
  touch(db, draftId)
  return characterDTO(db.prepare('SELECT * FROM draft_characters WHERE id = ?').get(charId) as unknown as CharacterRow)
}

export function deleteCharacter(db: DatabaseSync, draftId: string, charId: string): boolean {
  const existing = db.prepare('SELECT id FROM draft_characters WHERE id = ? AND draft_id = ?').get(charId, draftId)
  if (!existing) return false
  db.prepare('DELETE FROM draft_relationships WHERE draft_id = ? AND (from_character_id = ? OR to_character_id = ?)').run(draftId, charId, charId)
  db.prepare('DELETE FROM draft_characters WHERE id = ?').run(charId)
  touch(db, draftId)
  return true
}

export function listCharacters(db: DatabaseSync, draftId: string): CharacterDTO[] {
  return (db.prepare('SELECT * FROM draft_characters WHERE draft_id = ? ORDER BY sort_order, created_at').all(draftId) as unknown as CharacterRow[]).map(characterDTO)
}

export function getCharacter(db: DatabaseSync, draftId: string, charId: string): CharacterDTO | undefined {
  const row = db.prepare('SELECT * FROM draft_characters WHERE id = ? AND draft_id = ?').get(charId, draftId) as CharacterRow | undefined
  return row ? characterDTO(row) : undefined
}

// --- relationships (directional, bulk replace) --------------------------------

export interface IncomingRelationship {
  fromCharacterId: string; toCharacterId: string; trust: number; affection: number; attraction: number; note: string
}

export function replaceRelationships(db: DatabaseSync, draftId: string, relationships: IncomingRelationship[]): RelationshipDTO[] | undefined {
  if (!draftExists(db, draftId)) return undefined
  const validCharacterIds = new Set((db.prepare('SELECT id FROM draft_characters WHERE draft_id = ?').all(draftId) as unknown as { id: string }[]).map(r => r.id))
  db.prepare('DELETE FROM draft_relationships WHERE draft_id = ?').run(draftId)
  for (const rel of relationships) {
    if (!validCharacterIds.has(rel.fromCharacterId) || !validCharacterIds.has(rel.toCharacterId)) continue
    if (rel.fromCharacterId === rel.toCharacterId) continue
    db.prepare(`INSERT INTO draft_relationships (id, draft_id, from_character_id, to_character_id, trust, affection, attraction, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), draftId, rel.fromCharacterId, rel.toCharacterId, rel.trust, rel.affection, rel.attraction, rel.note)
  }
  touch(db, draftId)
  return (db.prepare('SELECT * FROM draft_relationships WHERE draft_id = ?').all(draftId) as unknown as RelationshipRow[]).map(relationshipDTO)
}

export function setDraftStatus(db: DatabaseSync, id: string, status: DraftStatus, extra?: { startedAt?: string; endedAt?: string }): void {
  db.prepare(`
    UPDATE world_drafts SET status = ?, started_at = COALESCE(?, started_at), ended_at = COALESCE(?, ended_at),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(status, extra?.startedAt ?? null, extra?.endedAt ?? null, id)
}

export type { RuleCategory }
