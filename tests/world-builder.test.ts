import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { once } from 'node:events'

process.env.AI_WORLD_DEMO_MODE = 'true'
process.env.AI_COMMUNITY_ADMIN_TOKEN = 'test-admin-token'

const { migrate } = await import('../server/db/connection.ts')
const { Router } = await import('../server/http.ts')
const { registerWorldRoutes } = await import('../server/api/worldRoutes.ts')
const {
  createRulePreset, duplicateRulePreset, setPresetRules, getRulePreset, deleteRulePreset, seedDefaultRulePreset,
} = await import('../server/domain/rulePresets.ts')
const {
  createDraft, updateBasicInfo, updateRuleSelection, updateEnvironment, replacePlacesAndConnections,
  createCharacter, updateCharacter, getDraft, replaceRelationships,
} = await import('../server/domain/worldDrafts.ts')
const { generateCharacters, contextFromDraft } = await import('../server/domain/characterGen.ts')
const { validateDraftForStart } = await import('../server/world/builderValidation.ts')
const { startWorldFromDraft } = await import('../server/domain/worldLaunch.ts')
const store = await import('../server/domain/worldStore.ts')

after(() => store.stopSimulationTimerForTests())

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return db
}

test('RULE PRESET create/duplicate/edit, with system_locked rules protected from deletion and edits', () => {
  const db = freshDb()
  try {
    const preset = createRulePreset(db, { name: 'TEST_WORLD', description: 'test' })
    setPresetRules(db, preset.id, [
      { category: 'CUSTOM', title: '커스텀 규칙', description: '설명', enabled: true, priority: 0 },
    ])
    let loaded = getRulePreset(db, preset.id)!
    assert.equal(loaded.rules.length, 1)

    // Lock it directly (simulating a seeded system rule) then try to delete/edit it via setPresetRules.
    db.prepare('UPDATE world_rules SET system_locked = 1 WHERE preset_id = ?').run(preset.id)
    setPresetRules(db, preset.id, []) // attempt to delete everything
    loaded = getRulePreset(db, preset.id)!
    assert.equal(loaded.rules.length, 1, 'a system_locked rule must survive an attempted deletion')

    setPresetRules(db, preset.id, [{ id: loaded.rules[0].id, category: 'CUSTOM', title: 'HACKED', description: 'HACKED', enabled: false, priority: 5 }])
    loaded = getRulePreset(db, preset.id)!
    assert.equal(loaded.rules[0].title, '커스텀 규칙', 'title/description must not change on a locked rule')
    assert.equal(loaded.rules[0].enabled, false, 'enabled is allowed to change on a locked rule')

    const duplicate = duplicateRulePreset(db, preset.id, 'TEST_WORLD copy')!
    assert.equal(duplicate.rules[0].systemLocked, false, 'a duplicate is always fully editable, even from a locked source')

    seedDefaultRulePreset(db)
    const systemPreset = getRulePreset(db, 'preset-realistic-world')!
    const del = deleteRulePreset(db, systemPreset.id)
    assert.equal(del.ok, false, 'the seeded system preset cannot be deleted')
  } finally { db.close() }
})

test('WORLD DRAFT create/save through steps 1-4, and connections dropped when a referenced place is removed', () => {
  const db = freshDb()
  try {
    const draft = createDraft(db, 'PROJECT ISLAND')
    updateBasicInfo(db, draft.id, { name: 'PROJECT ISLAND', intro: '', genre: '생존', background: '', seasonName: 'Season 1', maxDays: null, simSpeedMs: 60000, targetPopulation: 3, isPublic: true })
    const preset = createRulePreset(db, { name: 'P1' })
    updateRuleSelection(db, draft.id, preset.id)
    updateEnvironment(db, draft.id, { startDay: 1, startTime: '08:00', startWeather: 'clear', startTemperatureC: 20, backgroundSituation: '', initialEvent: '', powerStatus: '', initialResources: [], facilityStatus: '', hiddenWorldTruth: '', endCondition: '' })

    let saved = replacePlacesAndConnections(db, draft.id, [
      { tempId: 'a', name: '숙소', description: '', type: 'GENERIC', x: 0, y: 0, isPublic: true, isDiscovered: true, capacity: null, resources: [], items: [], facilityStatus: '' },
      { tempId: 'b', name: '복도', description: '', type: 'GENERIC', x: 1, y: 0, isPublic: true, isDiscovered: true, capacity: null, resources: [], items: [], facilityStatus: '' },
    ], [
      { fromPlaceRef: 'a', toPlaceRef: 'b', travelTime: 5, connectionType: 'PATH', blocked: false, requirements: '' },
    ])!
    assert.equal(saved.places.length, 2)
    assert.equal(saved.connections.length, 1)
    const placeA = saved.places.find(p => p.name === '숙소')!

    saved = replacePlacesAndConnections(db, draft.id, [
      { id: placeA.id, name: '숙소', description: '', type: 'GENERIC', x: 0, y: 0, isPublic: true, isDiscovered: true, capacity: null, resources: [], items: [], facilityStatus: '' },
    ], [])!
    assert.equal(saved.places.length, 1, 'removed place must actually be deleted')
    assert.equal(saved.connections.length, 0, 'a connection referencing a removed place must be dropped, not dangling')
  } finally { db.close() }
})

test('contextFromDraft structurally excludes HIDDEN WORLD TRUTH, and generation never leaks it', async () => {
  const db = freshDb()
  try {
    const draft = createDraft(db, 'PROJECT ISLAND')
    updateBasicInfo(db, draft.id, { name: 'PROJECT ISLAND', intro: '표류 시즌', genre: '생존', background: '무인도에 표류했다.', seasonName: 'S1', maxDays: null, simSpeedMs: 60000, targetPopulation: 5, isPublic: true })
    updateEnvironment(db, draft.id, { startDay: 1, startTime: '08:00', startWeather: 'clear', startTemperatureC: 20, backgroundSituation: '', initialEvent: '', powerStatus: '', initialResources: [], facilityStatus: '', hiddenWorldTruth: 'SECRET_UNDERGROUND_LAB', endCondition: '' })
    const draftWithSecret = getDraft(db, draft.id)!
    assert.equal(draftWithSecret.hiddenWorldTruth, 'SECRET_UNDERGROUND_LAB')

    const ctx = contextFromDraft(draftWithSecret, [])
    assert.ok(!('hiddenWorldTruth' in ctx), 'the generation context type/value must never carry hiddenWorldTruth')
    assert.ok(!JSON.stringify(ctx).includes('SECRET_UNDERGROUND_LAB'), 'the hidden truth must not leak into the context sent to the model')

    const result = await generateCharacters('openai', 5, ctx)
    assert.equal(result.usedDemo, true)
    assert.equal(result.characters.length, 5)
    const names = new Set(result.characters.map(c => c.name))
    assert.equal(names.size, 5, 'a batch of 5 must not contain duplicate names')
    for (const c of result.characters) {
      for (const key of ['survival_need', 'fatigue', 'stress', 'sexual_desire', 'greed', 'ambition'] as const) {
        assert.ok(c.humanState[key] >= 1 && c.humanState[key] <= 10)
      }
      assert.ok(!JSON.stringify(c).includes('SECRET_UNDERGROUND_LAB'), 'generated character text must never contain the hidden-truth marker')
    }
  } finally { db.close() }
})

test('regenerating a single character does not touch any other character', async () => {
  const db = freshDb()
  try {
    const draft = createDraft(db)
    const c1 = createCharacter(db, draft.id, manualCharacterInput('철수'), 'AI_AUTO')!
    const c2 = createCharacter(db, draft.id, manualCharacterInput('영희'), 'AI_AUTO')!
    const regenerated = await generateCharacters('openai', 1, { worldName: 'X', genre: '', background: '', seasonPremise: '', existingNames: [c1.name, c2.name] })
    const updated = updateCharacter(db, draft.id, c1.id, { ...manualCharacterInput(regenerated.characters[0].name), initialPlaceId: c1.initialPlaceId })!
    const untouched = getDraft(db, draft.id)!.characters.find(c => c.id === c2.id)!
    assert.equal(untouched.name, '영희', 'the other character must be completely unaffected')
    assert.notEqual(updated.name, '철수')
  } finally { db.close() }
})

test('editing an AI_AUTO character marks it AI_EDITED, but a MANUAL character stays MANUAL', () => {
  const db = freshDb()
  try {
    const draft = createDraft(db)
    const auto = createCharacter(db, draft.id, manualCharacterInput('AI캐릭터'), 'AI_AUTO')!
    const manual = createCharacter(db, draft.id, manualCharacterInput('직접입력'), 'MANUAL')!
    const editedAuto = updateCharacter(db, draft.id, auto.id, manualCharacterInput('AI캐릭터-수정'))!
    const editedManual = updateCharacter(db, draft.id, manual.id, manualCharacterInput('직접입력-수정'))!
    assert.equal(editedAuto.source, 'AI_EDITED')
    assert.equal(editedManual.source, 'MANUAL')
  } finally { db.close() }
})

test('relationships are directional: A->B and B->A are stored independently', () => {
  const db = freshDb()
  try {
    const draft = createDraft(db)
    const a = createCharacter(db, draft.id, manualCharacterInput('A'), 'MANUAL')!
    const b = createCharacter(db, draft.id, manualCharacterInput('B'), 'MANUAL')!
    const saved = replaceRelationships(db, draft.id, [
      { fromCharacterId: a.id, toCharacterId: b.id, trust: 8, affection: 7, attraction: 8, note: '' },
      { fromCharacterId: b.id, toCharacterId: a.id, trust: 4, affection: 5, attraction: 2, note: '' },
    ])!
    assert.equal(saved.length, 2)
    const aToB = saved.find(r => r.fromCharacterId === a.id)!
    const bToA = saved.find(r => r.fromCharacterId === b.id)!
    assert.equal(aToB.trust, 8)
    assert.equal(bToA.trust, 4)
  } finally { db.close() }
})

test('START WORLD validation blocks missing initial location, duplicate unique item, and capacity overflow', () => {
  const db = freshDb()
  try {
    const draft = createDraft(db)
    updateBasicInfo(db, draft.id, { name: 'W', intro: '', genre: '', background: '', seasonName: '', maxDays: null, simSpeedMs: 60000, targetPopulation: 2, isPublic: true })
    const preset = createRulePreset(db, { name: 'P' })
    updateRuleSelection(db, draft.id, preset.id)
    updateEnvironment(db, draft.id, { startDay: 1, startTime: '08:00', startWeather: 'clear', startTemperatureC: 20, backgroundSituation: '', initialEvent: '', powerStatus: '', initialResources: [], facilityStatus: '', hiddenWorldTruth: '', endCondition: '' })
    const saved = replacePlacesAndConnections(db, draft.id, [
      { tempId: 'p1', name: '방1', description: '', type: 'GENERIC', x: 0, y: 0, isPublic: true, isDiscovered: true, capacity: 1, resources: [], items: [], facilityStatus: '' },
    ], [])!
    const place = saved.places[0]
    createCharacter(db, draft.id, { ...manualCharacterInput('철수'), initialPlaceId: place.id, inventory: ['무전기'] }, 'MANUAL')
    createCharacter(db, draft.id, { ...manualCharacterInput('영희'), initialPlaceId: place.id, inventory: ['무전기'] }, 'MANUAL')

    const validation = validateDraftForStart(getDraft(db, draft.id)!)
    assert.equal(validation.ok, false)
    const codes = validation.errors.map(e => e.code)
    assert.ok(codes.includes('DUPLICATE_ITEM'), 'the same unique item assigned to two characters must be blocked')
    assert.ok(codes.includes('CAPACITY_EXCEEDED'), 'placing 2 characters in a capacity-1 place must be blocked')
  } finally { db.close() }
})

test('START WORLD succeeds end-to-end: creates a rule snapshot and hands a real WorldState to WORLD ENGINE', () => {
  const db = freshDb()
  try {
    const draft = createDraft(db, 'LAUNCH TEST')
    updateBasicInfo(db, draft.id, { name: 'LAUNCH TEST', intro: '개요', genre: '생존', background: '', seasonName: 'Season 1', maxDays: null, simSpeedMs: 60000, targetPopulation: 1, isPublic: true })
    const preset = createRulePreset(db, { name: 'LAUNCH_PRESET' })
    setPresetRules(db, preset.id, [{ category: 'BASIC_PRINCIPLE', title: 'r1', description: 'd1', enabled: true, priority: 0 }])
    updateRuleSelection(db, draft.id, preset.id)
    updateEnvironment(db, draft.id, { startDay: 1, startTime: '08:00', startWeather: 'clear', startTemperatureC: 18, backgroundSituation: '시작 상황', initialEvent: '', powerStatus: '', initialResources: [], facilityStatus: '', hiddenWorldTruth: '비밀', endCondition: '' })
    const saved = replacePlacesAndConnections(db, draft.id, [
      { tempId: 'p1', name: '숙소', description: '', type: 'GENERIC', x: 0, y: 0, isPublic: true, isDiscovered: true, capacity: null, resources: [], items: [], facilityStatus: '' },
    ], [])!
    createCharacter(db, draft.id, { ...manualCharacterInput('주인공'), initialPlaceId: saved.places[0].id }, 'MANUAL')

    const finalDraft = getDraft(db, draft.id)!
    const result = startWorldFromDraft(db, finalDraft)
    assert.equal(result.ok, true, JSON.stringify(result.errors))

    const snapshot = db.prepare('SELECT * FROM season_rule_snapshots WHERE draft_id = ?').get(draft.id) as { rules_json: string } | undefined
    assert.ok(snapshot, 'a rule snapshot row must be created at START WORLD')
    assert.equal(JSON.parse(snapshot!.rules_json).length, 1)

    const worldState = store.getWorldState()
    assert.equal(worldState.agents.length, 1)
    assert.equal(worldState.agents[0].name, '주인공')
    assert.equal(worldState.places[0].name, '숙소')

    // Editing the preset AFTER launch must never retroactively change the snapshot already taken.
    setPresetRules(db, preset.id, [{ category: 'BASIC_PRINCIPLE', title: 'changed after launch', description: 'd2', enabled: true, priority: 0 }])
    const snapshotAfter = db.prepare('SELECT rules_json FROM season_rule_snapshots WHERE draft_id = ?').get(draft.id) as { rules_json: string }
    assert.equal(JSON.parse(snapshotAfter.rules_json)[0].title, 'r1', 'the snapshot must stay frozen even after the source preset changes')
  } finally { db.close() }
})

test('CHARACTER PRIVATE INFORMATION never leaks through the public agent list or detail API', async () => {
  const db = freshDb()
  let server: ReturnType<typeof createServer> | undefined
  try {
    const draft = createDraft(db, 'PRIVACY TEST')
    updateBasicInfo(db, draft.id, { name: 'PRIVACY TEST', intro: '', genre: '', background: '', seasonName: '', maxDays: null, simSpeedMs: 60000, targetPopulation: 1, isPublic: true })
    const preset = createRulePreset(db, { name: 'P' })
    updateRuleSelection(db, draft.id, preset.id)
    updateEnvironment(db, draft.id, { startDay: 1, startTime: '08:00', startWeather: 'clear', startTemperatureC: 20, backgroundSituation: '', initialEvent: '', powerStatus: '', initialResources: [], facilityStatus: '', hiddenWorldTruth: '', endCondition: '' })
    const saved = replacePlacesAndConnections(db, draft.id, [
      { tempId: 'p1', name: '숙소', description: '', type: 'GENERIC', x: 0, y: 0, isPublic: true, isDiscovered: true, capacity: null, resources: [], items: [], facilityStatus: '' },
    ], [])!
    createCharacter(db, draft.id, { ...manualCharacterInput('비공개인물'), initialPlaceId: saved.places[0].id, privateInfo: 'TOP_SECRET_PAST_EVENT' }, 'MANUAL')

    const result = startWorldFromDraft(db, getDraft(db, draft.id)!)
    assert.equal(result.ok, true)

    const router = new Router()
    registerWorldRoutes(router)
    server = createServer((req, res) => { void router.handle(req, res) })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

    const listRes = await fetch(`${base}/api/world/agents`)
    const listBody = await listRes.text()
    assert.ok(!listBody.includes('TOP_SECRET_PAST_EVENT'), 'the agent LIST endpoint must never include hiddenNotes/privateInfo')
    assert.ok(!listBody.includes('hiddenNotes'), 'the hiddenNotes field itself must not be present in the list response')

    const agentId = store.getWorldState().agents[0].id
    const detailRes = await fetch(`${base}/api/world/agents/${agentId}`)
    const detailBody = await detailRes.text()
    assert.ok(!detailBody.includes('TOP_SECRET_PAST_EVENT'), 'the agent DETAIL endpoint must never include hiddenNotes/privateInfo')
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())) }
    db.close()
  }
})

function manualCharacterInput(name: string) {
  return {
    name, age: 25, gender: '', appearance: '', background: '', occupation: '', personality: '', goal: '',
    strengths: [], weaknesses: [], provider: 'openai', model: '',
    humanState: { survival_need: 5, fatigue: 3, stress: 3, sexual_desire: 3, greed: 3, ambition: 4 },
    emotion: { mood: 6, anger: 2, fear: 2 }, knowledge: [], privateInfo: '', inventory: [] as string[], initialPlaceId: null as string | null,
  }
}
