import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../server/db/connection.ts'
import { seedDefaultRulePreset } from '../server/domain/rulePresets.ts'
import { createTestIsland } from '../server/domain/studioExample.ts'
import { saveStudio } from '../server/domain/studioStore.ts'
import { startWorldFromDraft } from '../server/domain/worldLaunch.ts'
import * as store from '../server/domain/worldStore.ts'
import { config } from '../server/config.ts'
import type { WorldModelAdapter, WorldModelRequest } from '../server/domain/worldAgent.ts'
import { toPublicAgent } from '../server/world/publicView.ts'
import { parseGmResult } from '../server/world/v4/sceneApply.ts'
import { environmentHints } from '../server/world/v4/environment.ts'
import { resolveChase, runSpeed } from '../server/world/v4/pursuit.ts'
import { terrainAt } from '../server/world/geo/geoBuild.ts'
import { deathPressure } from '../server/world/v4/director.ts'

const PROSE = '중앙홀의 형광등이 낮게 떨렸다. 그는 벽에 기대어 있던 부러진 나무 의자 다리를 집어 들고, 거친 콘크리트 턱에 끝을 천천히 갈았다. 부스러기가 발치에 쌓였고, 한참 뒤 손에 쥔 것은 조잡하지만 끝이 뾰족한 창이었다. 맞은편에서 지켜보던 사람은 말없이 숙소 쪽 복도로 걸어 나갔다.'
const emptyOutcomes = { moves: [], injuries: [], deaths: [], created: [], transfers: [], consumed: [], needs: [], relations: [], memories: [] }
// Every scene now has to declare what actually happened in it and whether a fight is still running.
const BEATS = [{ who: 'P1', did: '의자 다리를 갈아 끝이 뾰족한 창을 만들었다' }, { who: 'P2', did: '그 모습을 보고 말없이 복도로 걸어 나갔다' }]
const CALM = { active: false, resolution: 'none', fleeing: null, chasing: [] }
const NEWLINE = String.fromCharCode(10)
// The name of someone the spotlight left out, read back from the prompt the GM was given.
const absentName = (prompt: string) => prompt.split('등장시키지 말 것]')[1].trim().split(',')[0].split(NEWLINE)[0].trim()

function v4World(gm: (request: WorldModelRequest, attempt: number) => unknown, demo = false, cooldownMs?: number) {
  const requests: WorldModelRequest[] = []
  let gmCalls = 0
  const adapter: WorldModelAdapter = async request => {
    requests.push(request)
    if (request.role === 'character') return { raw: { thought: '여기서 버티려면 무기가 필요하다.', action: '부러진 의자 다리를 깎아 창을 만든다.', speech: null, targetName: null, moveTo: null }, inputTokens: 1, outputTokens: 1 }
    if (request.role === 'gm') return { raw: gm(request, gmCalls++), inputTokens: 1, outputTokens: 1 }
    throw new Error(`unexpected role ${request.role}`)
  }
  const previousDemo = config.worldDemoMode, previousCooldown = config.worldSceneCooldownMs
  if (cooldownMs !== undefined) config.worldSceneCooldownMs = cooldownMs
  const db = new DatabaseSync(':memory:'); migrate(db); seedDefaultRulePreset(db)
  store.initializeWorldRuntime(db, adapter, false); config.worldDemoMode = demo
  const draft = createTestIsland(db); draft.studio!.engine = 'v4'; draft.studio!.events = []
  const saved = saveStudio(db, draft.id, draft)
  assert.equal(startWorldFromDraft(db, saved).ok, true)
  store.stopSimulationTimerForTests()
  return { db, requests, async close() { await store.shutdownWorldRuntime(); db.close(); config.worldDemoMode = previousDemo; config.worldSceneCooldownMs = previousCooldown } }
}

test('v4 runs one scene: free character intents, GM prose published, crafted item and move applied', async () => {
  const world = v4World(() => ({ title: '의자 다리로 만든 창', prose: PROSE, durationMinutes: 90, beats: BEATS, conflict: CALM, outcomes: { ...emptyOutcomes,
    created: [{ name: '조잡한 나무창', kind: 'tool', holder: 'P1', description: '의자 다리를 깎아 만든 창' }],
    moves: [{ who: 'P2', to: 'L1' }],
    needs: [{ who: 'P1', ate: 0, drank: 3, rested: 2 }],
    relations: [{ from: 'P2', to: 'P1', trust: -1, note: '무기를 만드는 모습을 보고 경계하게 됐다' }],
    memories: [{ who: 'P1', text: '의자 다리를 깎아 창을 만들었다.' }] } }))
  try {
    assert.equal(store.getAdminRuntime().engine, 'v4')
    await store.runWorldTick()
    const roles = world.requests.map(r => r.role)
    assert.equal(roles.filter(r => r === 'gm').length, 1)
    assert.ok(roles.filter(r => r === 'character').length >= 2, 'every character in the spotlight decides freely')
    assert.ok(!roles.some(r => ['agent', 'planner', 'judge', 'narrator'].includes(r)), 'v3 pipeline must not run')
    const gmPrompt = world.requests.find(r => r.role === 'gm')!.prompt
    assert.match(gmPrompt, /\[수위\]/)
    assert.match(gmPrompt, /성폭력은[^\n]*묘사하거나 암시하지 않는다/, 'sexual content is excluded at every intensity')
    assert.match(gmPrompt, /생존자 5명/)
    assert.doesNotMatch(gmPrompt, /한자리에서 마주치게/, 'no "same place = meet" rule survives')
    assert.match(gmPrompt, /같은 이름의 장소에 있다는 것만으로 마주쳤다고 쓰지 않는다/)
    assert.match(gmPrompt, /P\dm?까지 \d+m/, 'the GM sees real distances between the cast')
    const scene = store.listScenes({ limit: 5 }).items.find(s => s.id.startsWith('scene-v4-'))
    assert.ok(scene); assert.equal(scene.body, PROSE); assert.equal(scene.title, '의자 다리로 만든 창')
    const w = store.getWorldState()
    const spear = w.engine!.objects.find(o => o.name === '조잡한 나무창')
    assert.ok(spear && spear.location.kind === 'agent')
    const crafter = w.agents.find(a => a.id === spear.location.id)!
    assert.ok(crafter.inventory.includes(spear.id))
    assert.equal(crafter.journal?.at(-1)?.text, '의자 다리를 깎아 창을 만들었다.')
    assert.equal((toPublicAgent(crafter) as { journal?: unknown }).journal, undefined, 'private journal never leaves the server')
    // A move is a departure along a timed path, not a teleport.
    const walker = w.agents.find(a => a.publicState.travel)!
    assert.ok(walker, 'P2 set off on a trip')
    const start = { ...walker.publicState.coord! }, trip = walker.publicState.travel!
    assert.ok(trip.arriveMinute > trip.startMinute)
    assert.deepEqual(walker.publicState.coord, trip.from, 'still at the start the moment they leave')
    await store.runWorldTick()
    assert.notDeepEqual(walker.publicState.coord, start, 'the coordinate moves as world time passes')
    assert.ok(store.listDayStories()[0].body.includes(PROSE))
  } finally { await world.close() }
})

test('v4 rejects an unjustified death and has the GM rewrite once', async () => {
  const world = v4World((_request, attempt) => attempt === 0
    ? { title: '갑작스러운 죽음', prose: `${PROSE} 그는 그대로 숨을 거두었다.`, durationMinutes: 30, beats: BEATS, conflict: CALM, outcomes: { ...emptyOutcomes, deaths: [{ who: 'P2', cause: '갑자기 쓰러졌다', by: null }] } }
    : { title: '긴장된 침묵', prose: PROSE, durationMinutes: 30, beats: BEATS, conflict: CALM, outcomes: emptyOutcomes })
  try {
    await store.runWorldTick()
    const gm = world.requests.filter(r => r.role === 'gm')
    assert.equal(gm.length, 2)
    assert.match(gm[1].prompt, /이전 판정 오류/)
    assert.ok(store.getWorldState().agents.every(a => a.publicState.status !== 'deceased'))
    assert.ok(store.listScenes({ limit: 5 }).items.some(s => s.title === '긴장된 침묵'))
  } finally { await world.close() }
})

test('v4 falls back to v3 in demo mode, and environment hints come from place text', async () => {
  const world = v4World(() => ({}), true)
  try { assert.equal(store.getAdminRuntime().engine, 'v3') } finally { await world.close() }
  const beach = environmentHints({ name: '동쪽 해변', description: '개방된 해변' })
  assert.ok(beach.includes('모래') && beach.includes('바다 물고기'))
  assert.ok(environmentHints({ name: '깊은 숲', description: '' }).includes('곧은 가지'))
  const parsed = parseGmResult({ title: 't', prose: PROSE, durationMinutes: 9999, outcomes: { ...emptyOutcomes, injuries: [{ who: 'P1', severity: 99, description: '', by: null }] } })
  assert.equal(parsed.durationMinutes, 240); assert.equal(parsed.outcomes.injuries[0].severity, 5)
  // "I1=단검" must move the existing dagger, never mint a new item named "I1=단검".
  const refs = parseGmResult({ title: 't', prose: PROSE, durationMinutes: 30, outcomes: { ...emptyOutcomes,
    transfers: [{ item: 'I1=단검', to: 'P2=캐릭터 B' }], moves: [{ who: 'P1', to: 'L1=숙소' }], created: [{ name: 'I3=나무창', kind: 'tool', holder: 'P1', description: '' }] } })
  assert.deepEqual(refs.outcomes.transfers[0], { item: 'I1', to: 'P2' })
  assert.equal(refs.outcomes.moves[0].to, 'L1'); assert.equal(refs.outcomes.created[0].name, '나무창')
})

// --- the narrator may not invent the world -------------------------------------------------------

const SOLO_BEATS = [{ who: 'P1', did: '부러진 의자 다리를 집어 들었다' }, { who: 'P1', did: '턱에 갈아 끝을 뾰족하게 만들었다' }]
const plain = (prose: string, extra: Record<string, unknown> = {}) =>
  ({ title: '중앙홀', prose, durationMinutes: 30, beats: SOLO_BEATS, conflict: CALM, outcomes: emptyOutcomes, ...extra })

test('v4 refuses prose that invents a weapon or a person who is not in the scene', async () => {
  const world = v4World((request, attempt) => {
    if (attempt === 0) return plain(`그는 품에서 단검을 꺼내 손잡이를 고쳐 잡았다. ${PROSE}`)
    if (attempt === 2) return plain(`${absentName(request.prompt)}이(가) 복도 끝에서 걸어 들어와 두 사람을 지켜보았다. ${PROSE}`)
    return plain(PROSE)
  }, false, 0)
  try {
    await store.runWorldTick()
    await store.runWorldTick()
    const gm = world.requests.filter(r => r.role === 'gm')
    assert.equal(gm.length, 4, 'each invented fact costs the GM a rewrite')
    assert.match(gm[1].prompt, /이전 판정 오류/)
    assert.match(gm[1].prompt, /단검.*이 장면에 없는 물건/, 'an object nobody was given cannot appear in the prose')
    assert.match(gm[3].prompt, /이 장면에 없는 사람이다/, 'someone outside the spotlight cannot walk onto the page')
    const scene = store.listScenes({ limit: 5 }).items.find(s => s.id.startsWith('scene-v4-'))
    assert.equal(scene?.body, PROSE)
  } finally { await world.close() }
})

test('v4 refuses a padded scene and keeps prose proportional to what happened', async () => {
  const PADDED = '복도의 공기는 무거웠다. '.repeat(24) + PROSE
  const world = v4World((_request, attempt) => attempt === 0
    ? plain(PADDED, { beats: [{ who: 'P1', did: '복도에 서서 숨을 고르며 오래 생각했다' }], durationMinutes: 180 })
    : plain(PROSE), false, 0)
  try {
    await store.runWorldTick()
    const gm = world.requests.filter(r => r.role === 'gm')
    assert.equal(gm.length, 2)
    assert.match(gm[1].prompt, /사건 수에 비해 너무 길다/)
    assert.match(gm[1].prompt, /180분을 다루면서/, 'a long stretch needs more than one thing happening in it')
    assert.equal(store.listScenes({ limit: 5 }).items.find(s => s.id.startsWith('scene-v4-'))?.body, PROSE)
  } finally { await world.close() }
})

// --- a fight lasts until it actually ends --------------------------------------------------------

const FIGHT_PROSE = '캐릭터 하나가 먼저 거리를 좁혔다. 벽으로 밀린 쪽이 팔을 들어 막았고, 둔탁한 소리와 함께 팔뚝에 멍이 번졌다. 둘은 숨을 몰아쉬며 다시 서로를 노려보았고, 복도 한가운데서 간격이 또 줄어들었다.'
const fightBeats = [{ who: 'P1', did: '거리를 좁혀 상대를 벽으로 밀어붙였다' },
  { who: 'P2', did: '팔로 막아내다 팔뚝에 멍이 들었다' },
  { who: 'P1', did: '물러서지 않고 다시 간격을 좁혔다' }]
const fightScene = (conflict: Record<string, unknown>) => ({ title: '복도의 충돌', prose: FIGHT_PROSE, durationMinutes: 20,
  beats: fightBeats, conflict, outcomes: { ...emptyOutcomes, injuries: [{ who: 'P2', severity: 1, description: '팔뚝에 멍', by: 'P1' }] } })

test('v4 keeps the spotlight on an unresolved fight and forces it to end', async () => {
  const world = v4World(() => fightScene({ active: true, resolution: 'none', fleeing: null, chasing: [] }), false, 0)
  try {
    for (let tick = 0; tick < 5; tick++) await store.runWorldTick()
    const gm = world.requests.filter(r => r.role === 'gm')
    const scenes = store.listScenes({ limit: 20 }).items.filter(s => s.id.startsWith('scene-v4-'))
    assert.match(gm[1].prompt, /진행 중인 충돌 — 아직 끝나지 않았다/, 'the fight is handed back to the GM, not restarted')
    assert.match(gm[1].prompt, /곧바로 다음 공방으로/)
    assert.deepEqual(scenes[1].agentIds, scenes[0].agentIds, 'the same people hold the spotlight while they fight')
    // Four scenes in, an unresolved fight has to be settled; a fifth standoff is thrown away.
    assert.match(gm[4].prompt, /이번 장면에서 반드시 끝낸다/)
    assert.match(gm[5].prompt, /이미 여러 장면째/, 'the GM is told to produce a real ending')
    assert.equal(gm.length, 6, 'the fifth scene was rejected twice and published nothing')
    assert.equal(scenes.length, 4)
  } finally { await world.close() }
})

test('v4 resolves flight on the ground: a hurt runner is caught and the fight stays open', async () => {
  const world = v4World(() => ({ title: '도주', prose: FIGHT_PROSE, durationMinutes: 20, beats: fightBeats,
    conflict: { active: false, resolution: 'fled', fleeing: 'P2', chasing: ['P1'] },
    outcomes: { ...emptyOutcomes, injuries: [{ who: 'P2', severity: 4, description: '옆구리를 세게 맞았다', by: 'P1' }] } }), false, 0)
  try {
    await store.runWorldTick()
    const scene = store.listScenes({ limit: 5 }).items.find(s => s.id.startsWith('scene-v4-'))!
    assert.ok(scene.body.startsWith(FIGHT_PROSE), 'the GM prose is published as written')
    assert.match(scene.body, /따라잡았다/, 'the world, not the prose, decides whether a wounded runner gets away')
    assert.match(scene.body, /성한 몸을 두고 달아날 수는 없었다/)
    await store.runWorldTick()
    const gm = world.requests.filter(r => r.role === 'gm')
    assert.match(gm[1].prompt, /진행 중인 충돌/, 'being caught puts both of them back in the same fight')
  } finally { await world.close() }
})

// --- people actually die -------------------------------------------------------------------------

test('v4 lets a killing blow kill, and refuses a lethal wound written as a scratch', async () => {
  const lethal = [{ who: 'P2', severity: 5, description: '머리를 세게 맞았다', by: 'P1' },
    { who: 'P2', severity: 5, description: '쓰러진 뒤 한 번 더 맞았다', by: 'P1' }]
  const world = v4World((_request, attempt) => ({ title: '복도의 끝', prose: attempt === 0 ? FIGHT_PROSE : `${FIGHT_PROSE} 상대는 그 자리에서 숨을 거두었다.`,
    durationMinutes: 20, beats: fightBeats, conflict: { active: false, resolution: attempt === 0 ? 'subdued' : 'killed', fleeing: null, chasing: [] },
    outcomes: { ...emptyOutcomes, injuries: lethal, deaths: attempt === 0 ? [] : [{ who: 'P2', cause: '머리를 맞아 숨졌다', by: 'P1' }] } }), false, 0)
  try {
    await store.runWorldTick()
    const gm = world.requests.filter(r => r.role === 'gm')
    assert.equal(gm.length, 2)
    assert.match(gm[1].prompt, /이 부상으로 죽는다\(누적 10\/10\)/, 'the engine does not quietly cap a fatal wound')
    const dead = store.getWorldState().agents.filter(a => a.publicState.status === 'deceased')
    assert.equal(dead.length, 1, 'the full severity applies, so the blow kills')
    assert.equal(dead[0].body?.health, 10)
    assert.equal(store.getAdminRuntime().survivorCount ?? 4, 4)
  } finally { await world.close() }
})

test('v4 chase speed follows the body: a hurt runner cannot outrun a healthy one on the same ground', async () => {
  const world = v4World(() => plain(PROSE), false, 0)
  try {
    await store.runWorldTick()
    const w = store.getWorldState(), geo = w.engine!.geo!
    const [runner, hunter] = w.agents.filter(a => a.publicState.status !== 'deceased')
    // Two spots on identical, non-water ground 30 m apart, so only the bodies differ.
    const base = runner.publicState.coord!
    let spot: Array<{ x: number; y: number }> | null = null
    for (let offset = 0; offset < 600 && !spot; offset += 10) {
      const near = { x: base.x + offset, y: base.y }, far = { x: near.x + 30, y: near.y }
      if (terrainAt(geo, near) !== 'WATER' && terrainAt(geo, far) === terrainAt(geo, near)) spot = [near, far]
    }
    assert.ok(spot, 'the island has open ground to run on')
    const place = (hurt: typeof runner, well: typeof runner) => {
      hurt.publicState.coord = { ...spot![0] }; well.publicState.coord = { ...spot![1] }
      hurt.body = { health: 7, injury: 7 }; well.body = { health: 0, injury: 0 }
      hurt.humanState = { ...hurt.humanState!, fatigue: 6 }; well.humanState = { ...well.humanState!, fatigue: 1 }
    }
    place(runner, hunter)
    assert.ok(runSpeed(geo, hunter) > runSpeed(geo, runner), 'injury and fatigue cost real metres per minute')
    assert.equal(resolveChase(w, geo, runner, [hunter], [])?.status, 'caught')
    // Swap the bodies and the same 30 m head start is enough to break away.
    place(hunter, runner)
    assert.notEqual(resolveChase(w, geo, runner, [hunter], [])?.status, 'caught')
  } finally { await world.close() }
})

test('the director squeezes harder the longer nobody dies', () => {
  const v4 = { director: { lastDeathMinute: 0 } } as unknown as Parameters<typeof deathPressure>[0]
  assert.equal(deathPressure(v4, 600), 0)
  assert.equal(deathPressure(v4, 1500), 1, 'a day without a death closes zones twice as often')
  assert.equal(deathPressure(v4, 3000), 2, 'two days without a death makes the closed zones deadlier')
})

test('v4 lets a runner nobody chased actually leave, so the scene cannot repeat itself', async () => {
  const world = v4World(() => ({ title: '등을 돌리고', prose: FIGHT_PROSE, durationMinutes: 20, beats: fightBeats,
    conflict: { active: false, resolution: 'fled', fleeing: 'P2', chasing: [] },
    outcomes: { ...emptyOutcomes, injuries: [{ who: 'P2', severity: 1, description: '팔뚝에 멍', by: 'P1' }] } }), false, 0)
  try {
    // The first tick lays the world out on the map; the flight that matters is the next one.
    await store.runWorldTick()
    const before = store.getWorldState().agents.map(a => ({ id: a.id, coord: { ...a.publicState.coord! } }))
    await store.runWorldTick()
    const scene = store.listScenes({ limit: 20 }).items.filter(s => s.id.startsWith('scene-v4-')).at(-1)!
    assert.match(scene.body, /아무도 뒤를 쫓지 않았고/)
    const ran = store.getWorldState().agents.map(a => {
      const start = before.find(b => b.id === a.id)!.coord
      return Math.round(Math.hypot(a.publicState.coord!.x - start.x, a.publicState.coord!.y - start.y))
    })
    assert.equal(ran.filter(d => d > 100).length, 1, 'exactly one person sprinted away')
    const gm = world.requests.filter(r => r.role === 'gm')
    assert.doesNotMatch(gm[1].prompt, /진행 중인 충돌/, 'letting someone go ends the encounter')
  } finally { await world.close() }
})
