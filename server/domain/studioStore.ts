import {LOCAL_AREAS} from '../world/actionSchema.ts'
import { parseDispositions } from '../world/dispositions.ts'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from '../http.ts'
import { config } from '../config.ts'
import { CLIMATES, defaultStudio, defaultCharacter, RELATIONS, type StudioConfig } from './studioConfig.ts'
import { getDraft, createDraft, updateBasicInfo, updateEnvironment, updateRuleSelection, replacePlacesAndConnections, createCharacter, updateCharacter, deleteCharacter, replaceRelationships, setWizardStep, type DraftDTO } from './worldDrafts.ts'

// A new season must have fresh IDs; saveStudio remaps every place, character and
// relationship reference while preserving the design and each character's settings.
export function copyWorldDesign(db: DatabaseSync, sourceId: string): DraftDTO {
  const source = getDraft(db, sourceId)
  if (!source) throw new HttpError(404, 'draft_not_found')
  db.exec('SAVEPOINT copy_world_design')
  try {
    const target = createDraft(db, source.name)
    const copied = saveStudio(db, target.id, { ...source, studio: source.studio ?? migrateStudio(source) })
    db.exec('RELEASE copy_world_design')
    return copied
  } catch (error) { db.exec('ROLLBACK TO copy_world_design; RELEASE copy_world_design'); throw error }
}

export function saveStudio(db: DatabaseSync, id: string, input: DraftDTO): DraftDTO {
  const old = getDraft(db, id)
  if (!old) throw new HttpError(404, 'draft_not_found')
  if (!['DRAFT', 'READY'].includes(old.status)) throw new HttpError(409, 'world_design_locked')
  const data = structuredClone(input)
  if (!data || !Array.isArray(data.places) || !Array.isArray(data.characters) || !Array.isArray(data.connections) || !data.studio) throw new HttpError(400, 'invalid_studio')
  const s = data.studio
  if (s.version !== 2 || !s.characters || !['items','events','truths','relationships','endings'].every(k=>Array.isArray(s[k as 'items']))) throw new HttpError(400,'invalid_studio_shape')
  const validNum = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max
  if (!validNum(s.activeLimit, 1, config.maxActiveCharacters) || !Number.isInteger(s.activeLimit) || !validNum(s.minutesPerTick, 1, 1440) || !Number.isInteger(s.minutesPerTick) || !CLIMATES.includes(s.climate) || !validNum(s.rainChance, 0, 100) || !validNum(s.persistence, 0, 100) || !validNum(s.baseTemperature, -60, 60)) throw new HttpError(400, 'invalid_simulation_settings')
  if (!validNum(data.simSpeedMs, 5000, 3600000) || !validNum(data.targetPopulation, 1, 100) || !Number.isInteger(data.targetPopulation) || data.characters.length > 100 || data.places.length > 100 || data.maxDays !== null && (!Number.isInteger(data.maxDays) || data.maxDays < 1)) throw new HttpError(400, 'invalid_world_limits')
  for (const c of data.characters) {
    try { if (c.dispositions) c.dispositions = parseDispositions(c.dispositions) } catch { throw new HttpError(400, 'invalid_dispositions') }
    s.characters[c.id] ??= defaultCharacter()
    if (!['이성애', '동성애'].includes(s.characters[c.id].orientation)) throw new HttpError(400, 'invalid_orientation')
    for (const [k, v] of Object.entries(s.characters[c.id])) if (k !== 'orientation' && !validNum(v as number, 0, 10)) throw new HttpError(400, 'invalid_character_state')
    for (const v of [...Object.values(c.humanState), ...Object.values(c.emotion)]) if (!validNum(v, 0, 10)) throw new HttpError(400, 'invalid_character_state')
  }
  const placeIds = new Set(data.places.map(p => p.id)), charIds = new Set(data.characters.map(c => c.id))
  if (placeIds.size !== data.places.length || charIds.size !== data.characters.length) throw new HttpError(400, 'duplicate_id')
  for (const p of data.places) for (const r of p.resources) if (!validNum(r.level, 0, 1e9) || !validNum(r.max, r.level, 1e9)) throw new HttpError(400, 'invalid_resource_quantity')
  for (const c of data.connections) if (!placeIds.has(c.fromPlaceId) || !placeIds.has(c.toPlaceId) || !validNum(c.travelTime, 1, 1440)) throw new HttpError(400, 'invalid_connection')
  for (const r of s.relationships) if (!charIds.has(r.from) || !charIds.has(r.to) || r.from === r.to || !(r.kind in RELATIONS)) throw new HttpError(400, 'invalid_relationship')
  for (const i of s.items) if (!['item','food','water','medicine','tool','fuel'].includes(i.kind) || !['place','agent'].includes(i.holderKind) || !validNum(i.quantity, 1, 10000) || !Number.isInteger(i.quantity) || !(i.holderKind === 'place' ? placeIds : charIds).has(i.holderId)) throw new HttpError(400, 'invalid_inventory')
  for(const i of s.items){
    if(i.localArea&&!(LOCAL_AREAS as readonly string[]).includes(i.localArea))throw new HttpError(400,'invalid_item_area')
    if(i.mass!==undefined&&!validNum(i.mass,0.001,1000000))throw new HttpError(400,'invalid_item_mass')
    if(i.form!==undefined&&(typeof i.form!=='string'||!i.form.trim()||i.form.length>100))throw new HttpError(400,'invalid_item_form')
    if(i.materials!==undefined&&(!Array.isArray(i.materials)||!i.materials.length||i.materials.length>8||i.materials.some(m=>typeof m!=='string'||!m.trim()||m.length>60)))throw new HttpError(400,'invalid_item_materials')
    const p=i.physical
    if(p&&(!p.material?.trim()||p.material.length>60||p.edge!==undefined&&!['sharp','blunt'].includes(p.edge)||typeof p.portable!=='boolean'||!validNum(p.attackPower,0,2)||!validNum(p.cover,0,2)||!Number.isInteger(p.attackPower)||!Number.isInteger(p.cover)||p.hardness!==undefined&&!validNum(p.hardness,0,10)||['modifiable','separable','combinable'].some(key=>p[key as 'modifiable']!==undefined&&typeof p[key as 'modifiable']!=='boolean')||(p.material==='terrain'&&p.portable)))throw new HttpError(400,'invalid_physical_item')
  }
  if (new Set(s.items.map(i => i.id)).size !== s.items.length) throw new HttpError(400, 'duplicate_item')
  for (const e of s.events) if (!Number.isInteger(e.day) || e.day < 1 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time) || e.placeId && !placeIds.has(e.placeId) || !['power_off','power_on','flood','resource','goal','notice'].includes(e.effect) || !validNum(e.amount, -1e9, 1e9)) throw new HttpError(400, 'invalid_scheduled_event')
  if (!['AND','OR'].includes(s.endMode) || s.endings.some(e => !['day','survivors','place','goal','event','all_dead'].includes(e.type) || !validNum(e.value, 0, 1e6))) throw new HttpError(400, 'invalid_end_condition')
  const ids: Record<string,string> = {}
  db.exec('SAVEPOINT studio_save')
  try {
    updateBasicInfo(db, id, { ...data, seasonName: data.seasonName || 'Season 1' })
    updateRuleSelection(db, id, data.rulePresetId)
    updateEnvironment(db, id, data)
    const placed = replacePlacesAndConnections(db, id, data.places.map(p => ({ ...p, tempId: p.id })), data.connections.map(c => ({ ...c, fromPlaceRef: c.fromPlaceId, toPlaceRef: c.toPlaceId })))!
    data.places.forEach((p, i) => { ids[p.id] = placed.places[i].id })
    for (const c of old.characters) if (!charIds.has(c.id)) deleteCharacter(db, id, c.id)
    for (const c of data.characters) {
      c.initialPlaceId = c.initialPlaceId ? ids[c.initialPlaceId] ?? null : null
      const saved = old.characters.some(o => o.id === c.id) ? updateCharacter(db, id, c.id, c)! : createCharacter(db, id, c, c.source ?? 'MANUAL')!
      ids[c.id] = saved.id
    }
    // Remap temporary references without ever replacing arbitrary user text.
    s.characters = Object.fromEntries(Object.entries(s.characters).filter(([k]) => charIds.has(k)).map(([k,v]) => [ids[k],v]))
    s.items.forEach(i => { i.holderId = ids[i.holderId] ?? i.holderId })
    s.events.forEach(e => { e.placeId = ids[e.placeId] ?? e.placeId })
    s.truths.forEach(t => { t.placeId = ids[t.placeId] ?? t.placeId; t.revealedPlaceId = ids[t.revealedPlaceId] ?? t.revealedPlaceId; t.knownBy = t.knownBy.filter(k => charIds.has(k)).map(k => ids[k]) })
    s.relationships.forEach(r => { r.from = ids[r.from]; r.to = ids[r.to] })
    s.endings.forEach(e => { if (e.type === 'place') e.ref = ids[e.ref] ?? e.ref })
    replaceRelationships(db, id, data.relationships.map(r => ({ ...r, fromCharacterId: ids[r.fromCharacterId], toCharacterId: ids[r.toCharacterId] })))
    db.prepare('INSERT INTO world_studio_config(draft_id,payload) VALUES (?,?) ON CONFLICT(draft_id) DO UPDATE SET payload=excluded.payload').run(id, JSON.stringify(s))
    setWizardStep(db, id, Math.min(10, Math.max(1, data.wizardStep || 1)))
    db.exec('RELEASE studio_save')
    return getDraft(db, id)!
  } catch (e) { db.exec('ROLLBACK TO studio_save'); db.exec('RELEASE studio_save'); throw e }
}

export function migrateStudio(draft: DraftDTO): StudioConfig {
  const s = defaultStudio(draft.maxActiveCharacters)
  s.baseTemperature = draft.startTemperatureC
  s.truths = (draft.discoverableTruths ?? []).map(t => ({ ...t, itemId: '', eventId: '', discoverable: true, knownBy: [], revealedPlaceId: t.revealedPlaceId ?? '' }))
  if (draft.hiddenWorldTruth) s.truths.push({ id: 'legacy-truth', summary: draft.hiddenWorldTruth, placeId: '', itemId: '', eventId: '', discoverable: false, knownBy: [], revealedPlaceId: '' })
  return s
}
