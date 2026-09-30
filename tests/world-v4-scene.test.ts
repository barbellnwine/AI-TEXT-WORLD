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

const PROSE = '중앙홀의 형광등이 낮게 떨렸다. 그는 벽에 기대어 있던 부러진 의자 다리를 집어 들고, 주머니칼로 끝을 천천히 깎아 나갔다. 나무 부스러기가 발치에 쌓였고, 한참 뒤 손에 쥔 것은 조잡하지만 끝이 뾰족한 창이었다. 맞은편에서 지켜보던 사람은 말없이 숙소 쪽 복도로 걸어 나갔다.'
const emptyOutcomes = { moves: [], injuries: [], deaths: [], created: [], transfers: [], consumed: [], needs: [], relations: [], memories: [] }

function v4World(gm: (request: WorldModelRequest, attempt: number) => unknown, demo = false) {
  const requests: WorldModelRequest[] = []
  let gmCalls = 0
  const adapter: WorldModelAdapter = async request => {
    requests.push(request)
    if (request.role === 'character') return { raw: { thought: '여기서 버티려면 무기가 필요하다.', action: '부러진 의자 다리를 깎아 창을 만든다.', speech: null, targetName: null, moveTo: null }, inputTokens: 1, outputTokens: 1 }
    if (request.role === 'gm') return { raw: gm(request, gmCalls++), inputTokens: 1, outputTokens: 1 }
    throw new Error(`unexpected role ${request.role}`)
  }
  const previousDemo = config.worldDemoMode
  const db = new DatabaseSync(':memory:'); migrate(db); seedDefaultRulePreset(db)
  store.initializeWorldRuntime(db, adapter, false); config.worldDemoMode = demo
  const draft = createTestIsland(db); draft.studio!.engine = 'v4'; draft.studio!.events = []
  const saved = saveStudio(db, draft.id, draft)
  assert.equal(startWorldFromDraft(db, saved).ok, true)
  store.stopSimulationTimerForTests()
  return { db, requests, async close() { await store.shutdownWorldRuntime(); db.close(); config.worldDemoMode = previousDemo } }
}

test('v4 runs one scene: free character intents, GM prose published, crafted item and move applied', async () => {
  const world = v4World(() => ({ title: '의자 다리로 만든 창', prose: PROSE, durationMinutes: 90, outcomes: { ...emptyOutcomes,
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
    assert.match(gmPrompt, /한자리에서 마주치게/, 'people sharing a place meet on the page')
    const scene = store.listScenes({ limit: 5 }).items.find(s => s.id.startsWith('scene-v4-'))
    assert.ok(scene); assert.equal(scene.body, PROSE); assert.equal(scene.title, '의자 다리로 만든 창')
    const w = store.getWorldState()
    const spear = w.engine!.objects.find(o => o.name === '조잡한 나무창')
    assert.ok(spear && spear.location.kind === 'agent')
    const crafter = w.agents.find(a => a.id === spear.location.id)!
    assert.ok(crafter.inventory.includes(spear.id))
    assert.equal(crafter.journal?.at(-1)?.text, '의자 다리를 깎아 창을 만들었다.')
    assert.equal((toPublicAgent(crafter) as { journal?: unknown }).journal, undefined, 'private journal never leaves the server')
    assert.ok(w.agents.some(a => a.publicState.locationId !== 'place-0'), 'P2 walked to a connected place')
    assert.ok(store.listDayStories()[0].body.includes(PROSE))
  } finally { await world.close() }
})

test('v4 rejects an unjustified death and has the GM rewrite once', async () => {
  const world = v4World((_request, attempt) => attempt === 0
    ? { title: '갑작스러운 죽음', prose: PROSE, durationMinutes: 30, outcomes: { ...emptyOutcomes, deaths: [{ who: 'P2', cause: '갑자기 쓰러졌다', by: null }] } }
    : { title: '긴장된 침묵', prose: PROSE, durationMinutes: 30, outcomes: emptyOutcomes })
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
