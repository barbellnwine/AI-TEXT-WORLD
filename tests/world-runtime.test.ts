import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { once } from 'node:events'
import { migrate } from '../server/db/connection.ts'
import * as store from '../server/domain/worldStore.ts'
import { createDraft, getDraft, updateBasicInfo, updateRuleSelection, replacePlacesAndConnections, createCharacter, DEFAULT_HUMAN_STATE, DEFAULT_EMOTION } from '../server/domain/worldDrafts.ts'
import { createRulePreset, setPresetRules, seedDefaultRulePreset, getRulePreset } from '../server/domain/rulePresets.ts'
import { startWorldFromDraft } from '../server/domain/worldLaunch.ts'
import { beginAction, advanceEngine, selectDecisionAgents, validateEngineAction, recordExperience } from '../server/world/worldEngine.ts'
import { buildAgentKnowledgeView } from '../server/world/knowledgeFilter.ts'
import { validateDraftForStart } from '../server/world/builderValidation.ts'
import { applyStateChange } from '../server/world/stateTransition.ts'
import type { ProposedAction } from '../server/world/actionSchema.ts'
import { generateCharacters } from '../server/domain/characterGen.ts'
import { config } from '../server/config.ts'
import { parseProposedAction, worldModelAdapter, ACTION_SCHEMA, agentRequest, judgeRequest, worldRequestBody, type WorldModelAdapter } from '../server/domain/worldAgent.ts'
import { MAX_PROVIDER_REQUEST_BYTES } from '../server/providers/requestBody.ts'
import { toPublicWorld } from '../server/world/publicView.ts'
import { Router } from '../server/http.ts'
import { registerAuthRoutes } from '../server/api/authRoutes.ts'
import { registerWorldAdminRoutes } from '../server/api/worldAdminRoutes.ts'
import { registerWorldBuilderRoutes } from '../server/api/worldBuilderRoutes.ts'
import { registerWorldRoutes } from '../server/api/worldRoutes.ts'
import { createUser } from '../server/auth/users.ts'
import { hashPassword } from '../server/auth/password.ts'
import { getMonthlyLedger, setSetting } from '../server/domain/budget.ts'

after(() => store.stopSimulationTimerForTests())

function setup(adapter?: WorldModelAdapter, live = true, privateWorld = false, endCondition = '', enableNarrator = false) {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  store.initializeWorldRuntime(db, adapter, enableNarrator)
  config.worldDemoMode = !live
  const draft = createDraft(db, 'Runtime test')
  updateBasicInfo(db, draft.id, { name: 'Runtime test', intro: 'An island', genre: 'survival', background: 'KNOWN_BACKGROUND', seasonName: 'Test', maxDays: 2, simSpeedMs: 3600000, targetPopulation: 2, isPublic: true })
  const preset = createRulePreset(db, { name: 'Test rules' })
  setPresetRules(db, preset.id, [{ category: 'CUSTOM', title: 'ORIGINAL_RULE', description: 'No attacks.', enabled: true, priority: 1 }])
  updateRuleSelection(db, draft.id, preset.id)
  const places = replacePlacesAndConnections(db, draft.id, ['A', 'B'].map(id => ({ tempId: id, name: id, description: '', type: 'GENERIC', x: 0, y: 0, isPublic: true, isDiscovered: true, capacity: 3, resources: [], items: [], facilityStatus: '' })), [{ fromPlaceRef: 'A', toPlaceRef: 'B', travelTime: 15, connectionType: 'PATH', blocked: false, requirements: '' }])!.places
  for (const name of ['Alice', 'Bob']) createCharacter(db, draft.id, {
    name, age: 30, gender: '', appearance: '', background: '', occupation: 'engineer', personality: `${name}_PERSONALITY`, goal: 'Explore', strengths: [], weaknesses: [], provider: 'openai', model: '',
    humanState: DEFAULT_HUMAN_STATE, emotion: DEFAULT_EMOTION, knowledge: [], privateInfo: `${name}_PRIVATE_SECRET`, inventory: name === 'Alice' ? ['key'] : [], initialPlaceId: places[0].id,
  }, 'MANUAL')
  const design = getDraft(db, draft.id)!
  design.hiddenWorldTruth = 'HIDDEN_WORLD_SECRET'
  design.isPublic = !privateWorld
  design.endCondition = endCondition
  assert.equal(startWorldFromDraft(db, design).ok, true)
  store.setMaxActiveAgents(1)
  store.setCallBudget(20)
  store.stopSimulationTimerForTests()
  return { db, design, places, preset, async close() { await store.shutdownWorldRuntime(); db.close() } }
}

function moveAction() {
  const world = store.getWorldState(), actor = world.agents[0]
  return { actorId: actor.id, locationId: actor.publicState.locationId, actionType: 'MOVE', targetIds: [], usedItemIds: [], destinationId: world.places.find(p => p.id !== actor.publicState.locationId)!.id, intendedAction: 'move', spokenText: null, claimedKnowledgeId: null }
}

test('live tick uses frozen design, updates location/occupancy/memory/scenes and restores a paused checkpoint', async () => {
  const prompts: string[] = []
  const ctx = setup(async request => { prompts.push(request.prompt); return { raw: request.role === 'agent' ? moveAction() : { approved: true, reason: '', ended: false }, inputTokens: 100, outputTokens: 30 } })
  try {
    setPresetRules(ctx.db, ctx.preset.id, [{ category: 'CUSTOM', title: 'LATER_RULE', description: 'Changed', enabled: true, priority: 0 }])
    const chunks: string[] = []
    const unsubscribe = store.subscribeStream({ write: (s: string) => { chunks.push(s); return true } } as unknown as ServerResponse)
    await store.runWorldTick()
    assert.equal(store.getWorldState().agents[0].publicState.locationId, ctx.places[0].id)
    assert.equal(store.listScenes({ limit: 10 }).items.length, 0)
    store.advanceWorldTick(15)
    store.advanceWorldTick(45)
    unsubscribe()
    const world = store.getWorldState(), actor = world.agents[0]
    assert.equal(actor.publicState.locationId, ctx.places[1].id)
    assert.ok(!world.places[0].currentAgentIds.includes(actor.id))
    assert.ok(world.places[1].currentAgentIds.includes(actor.id))
    assert.ok(actor.movementLog.length > 1)
    assert.equal(store.getAdminRuntime().callsUsed, 2)
    assert.equal(store.getAdminRuntime().providerUsage[0].estTokens, 260)
    assert.match(prompts[0], /ORIGINAL_RULE/)
    assert.doesNotMatch(prompts[0], /LATER_RULE|Bob_PRIVATE_SECRET|HIDDEN_WORLD_SECRET/)
    assert.match(prompts[0], /Alice_PERSONALITY|Alice_PRIVATE_SECRET/)
    assert.match(prompts[1], /HIDDEN_WORLD_SECRET/)
    assert.doesNotMatch(chunks.join(''), /PRIVATE_SECRET|HIDDEN_WORLD_SECRET|provenance/)
    const scene = store.listScenes({ limit: 1 }).items[0]
    assert.equal(scene.seasonId, ctx.design.id)
    assert.ok(scene.sourceEventIds.length)
    const savedLocation = actor.publicState.locationId
    store.initializeWorldRuntime(ctx.db)
    assert.equal(store.getAdminRuntime().status, 'PAUSED')
    assert.equal(store.getWorldState().agents[0].publicState.locationId, savedLocation)
    assert.equal(store.getAdminRuntime().callsUsed, 2)
    assert.equal(getDraft(ctx.db, ctx.design.id)!.status, 'PAUSED')
  } finally { await ctx.close() }
})

test('concurrent ticks share one call and pause invalidates an in-flight response', async () => {
  let complete!: (value: Awaited<ReturnType<WorldModelAdapter>>) => void
  let calls = 0
  const ctx = setup(async () => { calls++; return new Promise(resolve => { complete = resolve }) })
  try {
    const location = store.getWorldState().agents[0].publicState.locationId
    const first = store.runWorldTick(), second = store.runWorldTick()
    assert.equal(first, second)
    assert.equal(calls, 1)
    assert.throws(() => startWorldFromDraft(ctx.db, ctx.design), /world_tick_in_progress/)
    store.pauseSeason()
    complete({ raw: moveAction(), inputTokens: 10, outputTokens: 10 })
    await first
    assert.equal(store.getWorldState().agents[0].publicState.locationId, location)
    assert.equal(store.listActionAudit().length, 0)
    assert.equal(store.getAdminRuntime().callsUsed, 1)
    assert.equal(store.getAdminRuntime().lockHolder, null)
  } finally { await ctx.close() }
})

test('call budget is enforced before a pair of paid calls; provider failure pauses without demo fallback', async () => {
  let calls = 0
  const ctx = setup(async () => { calls++; throw new Error('SECRET_API_ERROR') })
  try {
    store.setCallBudget(1)
    await store.runWorldTick()
    assert.equal(calls, 0)
    assert.equal(store.getAdminRuntime().status, 'RUNNING')
    assert.equal(store.getAdminRuntime().decisionsPaused, true)
    store.setCallBudget(2)
    store.resumeSeason()
    await store.runWorldTick()
    assert.equal(calls, 1)
    assert.equal(store.getAdminRuntime().callsUsed, 1)
    assert.equal(store.getAdminRuntime().status, 'RUNNING')
    assert.equal(store.getAdminRuntime().decisionsPaused, true)
    assert.doesNotMatch(JSON.stringify(store.getAdminRuntime()), /SECRET_API_ERROR/)
    assert.ok(getMonthlyLedger(ctx.db).settled_usd > 0, 'failed requests retain an estimated charge')
    assert.equal(store.listActionAudit().length, 0)
  } finally { await ctx.close() }
})

test('shared monthly ceiling blocks the world adapter before any paid request', async () => {
  let called = false
  const ctx = setup(async () => { called = true; throw new Error('not expected') })
  try {
    setSetting(ctx.db, 'monthly_budget_krw', '0')
    await store.runWorldTick()
    assert.equal(called, false)
    assert.equal(store.getAdminRuntime().callsUsed, 0)
    assert.equal(store.getAdminRuntime().recentErrors[0].message, 'BUDGET_LIMIT')
  } finally { await ctx.close() }
})

test('a configured timer triggers the same serialized simulation path', async t => {
  const ctx = setup(undefined, false)
  try {
    t.mock.timers.enable({ apis: ['setInterval'] })
    store.setTickInterval(5000)
    t.mock.timers.tick(5000)
    await store.runWorldTick()
    assert.equal(store.getWorldState().agents[0].publicState.locationId, ctx.places[0].id)
    store.advanceWorldTick(15)
    assert.equal(store.getWorldState().agents[0].publicState.locationId, ctx.places[1].id)
    assert.equal(store.listActionAudit().length, 1)
  } finally { await ctx.close(); t.mock.timers.reset() }
})

test('judge rejection produces only an admin audit record and no public state change', async () => {
  const ctx = setup(async request => ({ raw: request.role === 'agent' ? moveAction() : { approved: false, reason: 'HIDDEN_WORLD_SECRET prohibits this', ended: false }, inputTokens: 1, outputTokens: 1 }))
  try {
    const before = store.listEvents({ limit: 100, offset: 0 }).total
    await store.runWorldTick()
    assert.equal(store.listEvents({ limit: 100, offset: 0 }).total, before)
    assert.equal(store.getWorldState().agents[0].publicState.locationId, ctx.places[0].id)
    assert.equal(store.listActionAudit()[0].outcome, 'REJECTED')
    assert.doesNotMatch(JSON.stringify(toPublicWorld(store.getWorldState())), /PRIVATE_SECRET/)
  } finally { await ctx.close() }
})

test('a satisfied configured end condition ends the season without applying the proposal', async () => {
  const ctx = setup(async request => ({ raw: request.role === 'agent' ? moveAction() : { approved: true, reason: 'End condition satisfied', ended: true }, inputTokens: 1, outputTokens: 1 }), true, false, 'End when both characters are in A')
  try {
    await store.runWorldTick()
    assert.equal(store.getAdminRuntime().status, 'ENDED')
    assert.equal(store.getWorldState().agents[0].publicState.locationId, ctx.places[0].id)
    assert.equal(store.getAdminRuntime().callsUsed, 2)
    assert.equal(getDraft(ctx.db, ctx.design.id)!.status, 'ENDED')
  } finally { await ctx.close() }
})

test('demo executes state transitions without calls; end day stops further ticks', async () => {
  const ctx = setup(async () => { throw new Error('must never call model') }, false)
  try {
    await store.runWorldTick()
    assert.equal(store.getAdminRuntime().callsUsed, 0)
    store.advanceWorldTick(15)
    assert.equal(store.getWorldState().agents[0].publicState.locationId, ctx.places[1].id)
    const world = store.getWorldState()
    world.engine!.minute = (ctx.design.startDay + ctx.design.maxDays! - 1) * 1440 - 1
    world.engine!.lastVitalsMinute = world.engine!.minute
    await store.runWorldTick()
    assert.equal(store.getAdminRuntime().status, 'ENDED')
    const count = store.listEvents({ limit: 100, offset: 0 }).total
    await store.runWorldTick()
    assert.equal(store.listEvents({ limit: 100, offset: 0 }).total, count)
    assert.throws(() => store.resumeSeason(), /season_ended/)
  } finally { await ctx.close() }
})

test('GIVE_ITEM transfers ownership and schema rejects forged actors and malformed fields', async () => {
  const ctx = setup(async request => ({ raw: request.role === 'agent' ? { ...moveAction(), actionType: 'GIVE_ITEM', destinationId: null, targetIds: [store.getWorldState().agents[1].id], usedItemIds: ['key'] } : { approved: true, reason: '', ended: false }, inputTokens: 1, outputTokens: 1 }))
  try {
    assert.throws(() => parseProposedAction({ ...moveAction(), actorId: 'forged' }, store.getWorldState().agents[0].id))
    assert.throws(() => parseProposedAction({ ...moveAction(), targetIds: 'bad' }, store.getWorldState().agents[0].id))
    await store.runWorldTick()
    assert.deepEqual(store.getWorldState().agents[0].inventory, ['key'])
    store.advanceWorldTick(1)
    assert.deepEqual(store.getWorldState().agents[0].inventory, [])
    assert.deepEqual(store.getWorldState().agents[1].inventory, ['key'])
  } finally { await ctx.close() }
})

test('ADMIN sessions authorize world APIs, USER/anonymous/token-only and cross-origin mutations fail', async () => {
  const ctx = setup(undefined, false)
  const router = new Router()
  registerAuthRoutes(router, ctx.db); registerWorldAdminRoutes(router, ctx.db); registerWorldBuilderRoutes(router, ctx.db); registerWorldRoutes(router)
  const server = createServer((req, res) => { void router.handle(req, res) })
  try {
    createUser(ctx.db, { username: 'operator', nickname: 'Operator', provider: 'local', role: 'ADMIN', passwordHash: hashPassword('test-password') })
    createUser(ctx.db, { email: 'user@example.com', nickname: 'Reader', provider: 'local', passwordHash: hashPassword('test-password') })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    async function login(identifier: string) {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password: 'test-password' }) })
      assert.equal(response.status, 200)
      return response.headers.get('set-cookie')!.split(';')[0]
    }
    const adminCookie = await login('operator'), userCookie = await login('user@example.com')
    for (const path of ['runtime', 'drafts', 'rule-presets']) {
      assert.equal((await fetch(`${base}/api/admin/world/${path}`)).status, 401)
      assert.equal((await fetch(`${base}/api/admin/world/${path}`, { headers: { cookie: userCookie } })).status, 403)
      assert.equal((await fetch(`${base}/api/admin/world/${path}`, { headers: { cookie: adminCookie } })).status, 200)
    }
    assert.equal((await fetch(`${base}/api/admin/world/runtime`, { headers: { 'x-admin-token': config.adminToken } })).status, 401)
    assert.equal((await fetch(`${base}/api/admin/world/pause`, { method: 'POST', headers: { cookie: adminCookie } })).status, 403)
    assert.equal((await fetch(`${base}/api/admin/world/pause`, { method: 'POST', headers: { cookie: adminCookie, 'x-world-admin': '1', origin: 'https://evil.example' } })).status, 403)
    assert.equal((await fetch(`${base}/api/admin/world/pause`, { method: 'POST', headers: { cookie: adminCookie, 'x-world-admin': '1', origin: base } })).status, 200)
    const publicBody = await (await fetch(`${base}/api/world/current`)).text()
    assert.doesNotMatch(publicBody, /PRIVATE_SECRET|HIDDEN_WORLD_SECRET/)
    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: adminCookie } })
    assert.equal((await fetch(`${base}/api/admin/world/runtime`, { headers: { cookie: adminCookie } })).status, 401)
  } finally { server.close(); server.closeAllConnections(); await ctx.close() }
})

test('real adapter uses structured JSON output with bounded single-attempt transport (no live API)', async () => {
  const originalFetch = globalThis.fetch, originalKey = config.openaiApiKey
  config.openaiApiKey = 'test-key'
  let body: Record<string, unknown> = {}
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"approved":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }), { status: 200 }) }
  try {
    const result = await worldModelAdapter({ role: 'agent', provider: 'openai', model: config.openaiModel, prompt: 'test', schema: ACTION_SCHEMA })
    assert.equal(result.inputTokens, 12)
    assert.equal((body.response_format as { type: string }).type, 'json_schema')
  } finally { globalThis.fetch = originalFetch; config.openaiApiKey = originalKey }
})

test('private worlds reject all unauthenticated world reads including stream and full state', async () => {
  const ctx = setup(undefined, false, true)
  const router = new Router()
  registerWorldRoutes(router, ctx.db)
  const server = createServer((req, res) => { void router.handle(req, res) })
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    for (const path of ['current', 'agents', 'places', 'events', 'scenes', 'stream']) {
      const response = await fetch(`${base}/api/world/${path}`)
      assert.equal(response.status, 401)
      assert.doesNotMatch(await response.text(), /PRIVATE_SECRET|HIDDEN_WORLD_SECRET|Alice/)
    }
  } finally { server.close(); server.closeAllConnections(); await ctx.close() }
})


test('engine time and due actions continue while an AI response is pending', async () => {
  let resolve!: (v: Awaited<ReturnType<WorldModelAdapter>>) => void
  const ctx = setup(async () => new Promise(done => { resolve = done }))
  try {
    const world = store.getWorldState(), before = world.engine!.minute
    const tick = store.runWorldTick()
    store.advanceWorldTick(60)
    assert.equal(world.engine!.minute, before + 61)
    assert.equal(world.agents[0].humanState!.survival_need, DEFAULT_HUMAN_STATE.survival_need + 1)
    assert.equal(store.getAdminRuntime().callsUsed, 1)
    store.pauseSeason()
    resolve({ raw: moveAction(), inputTokens: 1, outputTokens: 1 })
    await tick
  } finally { await ctx.close() }
})

test('busy and sleeping characters are excluded; direct speech wakes only the addressed sleeper', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [a, b] = world.agents
    const sleep: ProposedAction = { actorId: b.id, locationId: b.publicState.locationId, targetIds: [], actionType: 'SLEEP', intendedAction: 'sleep', durationMinutes: 180 }
    beginAction(world, sleep)
    assert.ok(!selectDecisionAgents(world, 10).some(c => c.id === b.id))
    const speech = beginAction(world, { actorId: a.id, locationId: a.publicState.locationId, targetIds: [b.id], actionType: 'SPEAK', intendedAction: 'ask', spokenText: 'Can you hear me?' })
    assert.equal(speech.phase, 'STARTED')
    advanceEngine(world, 1, [], e => recordExperience(world, e))
    assert.equal(world.engine!.ongoingActions.length, 0)
    assert.equal(b.wakeReason, 'addressed_directly')
    assert.ok(selectDecisionAgents(world, 10).some(c => c.id === b.id))
    assert.ok(!selectDecisionAgents(world, 10).some(c => c.id === a.id))
    assert.equal(b.knowledge.at(-1)!.verified, false)
  } finally { await ctx.close() }
})

test('reserved food cannot be consumed twice and consumption has a logged physical source', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [a, b] = world.agents
    const place = world.places[0]
    place.resources.push({ key: 'food', label: 'Food', level: 1, max: 1, trend: 'stable' })
    const action: ProposedAction = { actorId: a.id, actionType: 'EAT', locationId: place.id, targetIds: [], intendedAction: 'eat', resourceKey: 'food' }
    assert.equal(validateEngineAction(action, world, []).approved, true)
    beginAction(world, action)
    assert.equal(place.resources[0].level, 1)
    assert.equal(validateEngineAction({ ...action, actorId: b.id }, world, []).approved, false)
    const before = a.humanState!.survival_need
    const events = advanceEngine(world, 5)
    assert.equal(place.resources[0].level, 0)
    assert.equal(a.humanState!.survival_need, before - 2)
    assert.ok(events[0].stateChanges.some(c => c.field === `place:${place.id}:food` && c.to === '0'))
    assert.equal(validateEngineAction(action, world, []).approved, false)
  } finally { await ctx.close() }
})

test('exploration reveals only registered local truths, sharing records report provenance', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [a, b] = world.agents
    world.engine!.truths.push({ id: 'local-truth', summary: 'LOCAL_SECRET', placeId: a.publicState.locationId, discoveredBy: [] }, { id: 'remote-truth', summary: 'REMOTE_SECRET', placeId: world.places[1].id, discoveredBy: [] })
    assert.doesNotMatch(JSON.stringify(buildAgentKnowledgeView(a.id, world, [])), /LOCAL_SECRET|REMOTE_SECRET/)
    beginAction(world, { actorId: a.id, locationId: a.publicState.locationId, actionType: 'EXPLORE', targetIds: [], intendedAction: 'explore' })
    const discovered = advanceEngine(world, 10)
    assert.match(JSON.stringify(a.knowledge), /LOCAL_SECRET/)
    assert.doesNotMatch(JSON.stringify(a.knowledge), /REMOTE_SECRET/)
    assert.doesNotMatch(JSON.stringify(b.knowledge), /LOCAL_SECRET/)
    assert.doesNotMatch(JSON.stringify(toPublicWorld(world)), /LOCAL_SECRET|REMOTE_SECRET|HIDDEN_WORLD_SECRET/)
    const fact = a.knowledge.find(k => k.truthId === 'local-truth')!
    assert.equal(fact.sourceEventId, discovered[0].id)
    const share: ProposedAction = { actorId: a.id, locationId: a.publicState.locationId, actionType: 'SHARE_INFO', targetIds: [b.id], intendedAction: 'share', factId: fact.id }
    assert.equal(validateEngineAction({ ...share, factId: 'invented' }, world, []).approved, false)
    beginAction(world, share)
    const result = advanceEngine(world, 1)
    assert.equal(b.knowledge[0].acquisition, 'report')
    assert.equal(b.knowledge[0].verified, false)
    assert.equal(b.knowledge[0].sourceAgentId, a.id)
    assert.equal(b.knowledge[0].sourceEventId, result[0].id)
  } finally { await ctx.close() }
})

test('unknown destinations, blocked routes, severe fatigue and destroyed items fail closed', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), actor = world.agents[0]
    const move = moveAction() as ProposedAction
    actor.knownPlaceIds = [actor.publicState.locationId]
    assert.equal(validateEngineAction(move, world, []).approved, false)
    actor.knownPlaceIds.push(move.destinationId!)
    world.engine!.connections[0].blocked = true
    assert.equal(validateEngineAction(move, world, []).approved, false)
    world.engine!.connections[0].blocked = false
    actor.humanState!.fatigue = 10
    assert.equal(validateEngineAction(move, world, []).approved, false)
    world.engine!.objects[0].condition = 'destroyed'
    assert.equal(validateEngineAction({ ...move, actionType: 'GIVE_ITEM', usedItemIds: ['key'], targetIds: [world.agents[1].id] }, world, []).approved, false)
    actor.publicState.status = 'deceased'
    applyStateChange(world, { field: `agent:${actor.id}:status`, from: 'deceased', to: 'alive' })
    assert.equal(actor.publicState.status, 'deceased')
  } finally { await ctx.close() }
})

test('operator notices cannot rewrite reality and event history survives beyond the RAM window', async () => {
  const ctx = setup(undefined, false)
  try {
    const before = store.awaySummary('2000-01-01T00:00:00.000Z').eventCount
    const stateBefore = structuredClone(store.getWorldState().agents)
    let first = ''
    for (let i = 0; i < 505; i++) {
      const e = store.addOperatorEvent({ type: 'SYSTEM', placeId: ctx.places[0].id, agentIds: [], title: `Notice ${i}`, summary: 'An operator message', addedBy: 'test' }).event!
      if (!first) first = e.id
    }
    assert.deepEqual(store.getWorldState().agents, stateBefore)
    assert.equal(store.listEvents({ limit: 100, offset: 500 }).items.length, 6)
    assert.equal(store.awaySummary('2000-01-01T00:00:00.000Z').eventCount, before + 505)
    assert.equal(store.getEvent(first)?.cause, 'operator_announcement')
    store.initializeWorldRuntime(ctx.db)
    assert.equal(store.getEvent(first)?.cause, 'operator_announcement')
    assert.equal(store.listEvents({ limit: 1, offset: 0 }).total, before + 505)
  } finally { await ctx.close() }
})

test('configured character ceiling blocks launch and preserves the existing world', async () => {
  const ctx = setup(undefined, false)
  const prior = config.maxActiveCharacters
  try {
    config.maxActiveCharacters = 1
    assert.equal(validateDraftForStart(ctx.design).ok, false)
    assert.equal(startWorldFromDraft(ctx.db, ctx.design).ok, false)
    assert.equal(store.getWorldState().agents.length, 2)
    assert.throws(() => store.startSeason(), /max_active_characters/)
  } finally { config.maxActiveCharacters = prior; await ctx.close() }
})

test('world chapters wait for results, span multiple events, and never narrate unfinished actions', async () => {
  const ctx = setup(undefined, false)
  try {
    await store.runWorldTick()
    assert.equal(store.listChapters()[0].status, 'IN_PROGRESS')
    assert.equal(store.listScenes({ limit: 10 }).items.length, 0)
    store.advanceWorldTick(59)
    const scene = store.listScenes({ limit: 10 }).items[0]
    assert.ok(scene.sourceEventIds.length >= 2)
    assert.ok(scene.sourceEventIds.every(id => store.getEvent(id)?.phase !== 'STARTED'))
    assert.equal(store.listChapters()[0].status, 'COMPLETED')
    assert.equal(scene.worldDay, ctx.design.startDay)
    assert.equal(store.getAdminRuntime().callsUsed, 0)
  } finally { await ctx.close() }
})

test('narrator enhancement rewrites a completed chapter scene without affecting decision call accounting', async () => {
  const ctx = setup(async request => {
    if (request.role === 'agent') return { raw: moveAction(), inputTokens: 1, outputTokens: 1 }
    if (request.role === 'judge') return { raw: { approved: true, reason: 'ok', ended: false }, inputTokens: 1, outputTokens: 1 }
    return { raw: { title: 'AI_TITLE', body: 'AI_BODY_TEXT', sourceEventIds: [] }, inputTokens: 1, outputTokens: 1 }
  }, true, false, '', true)
  try {
    await store.runWorldTick()
    store.advanceWorldTick(59)
    const deterministic = store.listScenes({ limit: 10 }).items[0]
    assert.notEqual(deterministic.body, 'AI_BODY_TEXT')
    const callsBefore = store.getAdminRuntime().callsUsed
    await store.shutdownWorldRuntime()
    const enhanced = store.listScenes({ limit: 10 }).items[0]
    assert.equal(enhanced.id, deterministic.id)
    assert.equal(enhanced.title, 'AI_TITLE')
    assert.equal(enhanced.body, 'AI_BODY_TEXT')
    // A supplementary enrichment call, not a world decision — must never inflate callsUsed.
    assert.equal(store.getAdminRuntime().callsUsed, callsBefore)
  } finally { ctx.db.close() }
})


test('default constitutional preset fits bounded agent and judge requests without a network call', async () => {
  const ctx = setup(undefined, false)
  try {
    seedDefaultRulePreset(ctx.db)
    const execution = { draft: ctx.design, rules: getRulePreset(ctx.db, 'preset-realistic-world')!.rules, mode: 'live' as const }
    const world = store.getWorldState()
    const actor = world.agents[0]
    for (let i = 2; i < 10; i++) world.agents.push({ ...structuredClone(actor), id: `character-${i}`, name: `Character ${i}` })
    const request = agentRequest(execution, actor.id, world, [])
    assert.ok(Buffer.byteLength(worldRequestBody(request)) <= MAX_PROVIDER_REQUEST_BYTES)
    const judgment = judgeRequest(execution, moveAction() as ProposedAction, world, [])
    assert.ok(Buffer.byteLength(worldRequestBody(judgment)) <= MAX_PROVIDER_REQUEST_BYTES)
  } finally { await ctx.close() }
})


test('character generation obeys prepaid limits and charges failed requests without fake fallback', async () => {
  const db = new DatabaseSync(':memory:'); migrate(db)
  const original = { key: config.openaiApiKey, mode: config.worldDemoMode, prepaid: config.prepaidBudgetUsd, production: config.production, fetch: globalThis.fetch }
  let called = 0
  const ctx = { worldName: 'test', genre: '', background: '', seasonPremise: '', existingNames: [] }
  config.openaiApiKey = 'test-key'; config.worldDemoMode = false; config.prepaidBudgetUsd = 0; config.production = false
  globalThis.fetch = async () => { called++; return new Response('{}', { status: 429 }) }
  try {
    await assert.rejects(generateCharacters('openai', 1, ctx, db), /generation budget exhausted/)
    assert.equal(called, 0)
    config.prepaidBudgetUsd = 20
    const result = await generateCharacters('openai', 1, ctx, db)
    assert.equal(called, 1)
    assert.equal(result.usedDemo, false)
    assert.equal(result.characters.length, 0)
    assert.ok(result.errors.includes('OPENAI_HTTP_429'))
    assert.ok(getMonthlyLedger(db).settled_usd > 0)
    assert.equal(getMonthlyLedger(db).reserved_usd, 0)
  } finally {
    config.openaiApiKey = original.key; config.worldDemoMode = original.mode; config.prepaidBudgetUsd = original.prepaid; config.production = original.production; globalThis.fetch = original.fetch; db.close()
  }
})
