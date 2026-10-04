import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../server/db/connection.ts'
import { seedDefaultRulePreset } from '../server/domain/rulePresets.ts'
import { createDraft, DEFAULT_HUMAN_STATE, DEFAULT_EMOTION, type DraftDTO } from '../server/domain/worldDrafts.ts'
import { defaultStudio, defaultCharacter } from '../server/domain/studioConfig.ts'
import { saveStudio } from '../server/domain/studioStore.ts'
import { startWorldFromDraft } from '../server/domain/worldLaunch.ts'
import * as store from '../server/domain/worldStore.ts'
import { config } from '../server/config.ts'
import type { WorldExecution, WorldModelAdapter, WorldModelRequest } from '../server/domain/worldAgent.ts'
import { toPublicWorld } from '../server/world/publicView.ts'
import { ensureGeo, closestPair, spawnPoints, standablePoints, terrainAt } from '../server/world/geo/geoBuild.ts'
import { ISLAND_PLACES, isWalkable, matchesIslandMap, terrainOnIsland } from '../server/world/geo/islandMap.ts'
import { advanceMovement, planTravel, routeAvoidsBlocked, routeBetween, TERRAIN_SPEED } from '../server/world/geo/movement.ts'
import { aware, perceive } from '../server/world/geo/perception.ts'
import { runDirector, ensureV4State } from '../server/world/v4/director.ts'
import { buildSceneContext } from '../server/world/v4/scenePrompts.ts'
import { resolveChase } from '../server/world/v4/pursuit.ts'
import type { WorldState } from '../server/domain/worldTypes.ts'

// The painted island, built as a real world: same seven places the artwork labels.
function islandDraft(db: DatabaseSync): DraftDTO {
  const d = createDraft(db, '무인도')
  d.genre = '서바이벌 스릴러'
  d.background = '통제된 무인도에서 최후의 1인만 살아남는다.'
  d.intro = '여덟 명이 섬의 서로 다른 지점에서 눈을 뜬다.'
  d.endCondition = '최후의 1인'
  d.seasonName = 'Season 1'
  d.rulePresetId = 'preset-realistic-world'
  d.targetPopulation = 8
  d.startWeather = 'clear'
  d.startTemperatureC = 22
  d.startTime = '06:00'
  d.simSpeedMs = 60000
  d.maxDays = 7
  d.places = ISLAND_PLACES.map((p, i) => ({ id: `place-${i}`, name: p.name, description: `${p.name}이다.`, type: '실외',
    x: i * 100, y: 0, isPublic: true, isDiscovered: true, capacity: null,
    resources: p.name === '샘터' ? [{ key: 'water', label: '민물', level: 20, max: 20, unit: 'L' }] : [], items: [], facilityStatus: '' }))
  d.connections = d.places.slice(1).map((p, i) => ({ id: `edge-${i}`, fromPlaceId: d.places[0].id, toPlaceId: p.id, travelTime: 20, connectionType: 'PATH', blocked: false, requirements: '' }))
  d.characters = ['강민혁', '박태건', '윤서', '한지우', '오세라', '정우진', '서다인', '임도현'].map((name, i) => ({
    id: `char-${i}`, name, age: 24 + i, gender: i % 2 ? '여성' : '남성', appearance: '', background: '섬에서 눈을 떴다.',
    occupation: '참가자', personality: '냉정함 / 계산적', goal: '살아남는다.', strengths: ['체력'], weaknesses: ['불신'],
    provider: 'openai', model: '', humanState: { ...DEFAULT_HUMAN_STATE }, emotion: { ...DEFAULT_EMOTION }, knowledge: [],
    privateInfo: '', inventory: [], initialPlaceId: d.places[i % d.places.length].id, source: 'MANUAL', createdAt: '', updatedAt: '',
  }))
  d.studio = defaultStudio()
  d.studio.engine = 'v4'
  d.studio.minutesPerTick = 15
  d.studio.events = []
  d.studio.endings = [{ id: 'last-one', type: 'survivors', value: 1, ref: '' }]
  d.studio.characters = Object.fromEntries(d.characters.map(c => [c.id, defaultCharacter()]))
  return saveStudio(db, d.id, d)
}

const CALM = { active: false, resolution: 'none', fleeing: null, chasing: [] }
const emptyOutcomes = { moves: [], injuries: [], deaths: [], created: [], transfers: [], consumed: [], needs: [], relations: [], memories: [] }
const QUIET_PROSE = '해가 능선 위로 올라오는 동안 그는 발밑의 흙을 살피며 걸음을 옮겼다. 멀리 파도 소리가 들렸고, 숨을 고르며 주변을 확인했다. 아직 아무도 보이지 않았다.'

function islandWorld(gm: (request: WorldModelRequest, attempt: number) => unknown = () => ({
  title: '섬의 아침', prose: QUIET_PROSE, durationMinutes: 30, conflict: CALM, outcomes: emptyOutcomes,
  beats: [{ who: 'P1', did: '주변을 살피며 자리를 옮겼다' }, { who: 'P1', did: '발밑의 흙과 파도 소리로 위치를 가늠했다' }],
})) {
  let gmCalls = 0
  const requests: WorldModelRequest[] = []
  const adapter: WorldModelAdapter = async request => {
    requests.push(request)
    if (request.role === 'character') return { raw: { thought: '살아남아야 한다.', action: '주변을 살핀다.', speech: null, targetName: null, moveTo: null }, inputTokens: 1, outputTokens: 1 }
    if (request.role === 'gm') return { raw: gm(request, gmCalls++), inputTokens: 1, outputTokens: 1 }
    throw new Error(`unexpected role ${request.role}`)
  }
  const previousDemo = config.worldDemoMode, previousCooldown = config.worldSceneCooldownMs
  const db = new DatabaseSync(':memory:'); migrate(db); seedDefaultRulePreset(db)
  store.initializeWorldRuntime(db, adapter, false)
  config.worldDemoMode = false
  config.worldSceneCooldownMs = 0
  const saved = islandDraft(db)
  assert.equal(startWorldFromDraft(db, saved).ok, true)
  store.stopSimulationTimerForTests()
  const execution: WorldExecution = { draft: saved, rules: [], mode: 'live', engine: 'v4' }
  return { db, execution, requests, async close() { await store.shutdownWorldRuntime(); db.close(); config.worldDemoMode = previousDemo; config.worldSceneCooldownMs = previousCooldown } }
}

// --- 1. the map itself ---------------------------------------------------------------------------

test('the island world is built on the painted map, 2000m square, with every landmark on walkable ground', async () => {
  const world = islandWorld()
  try {
    const state = store.getWorldState(), geo = state.engine!.geo!
    assert.equal(geo.widthMeters, 2000)
    assert.equal(geo.heightMeters, 2000)
    assert.equal(geo.image, '/world/island-map.png', 'the minimap background is the painted map')
    assert.ok(existsSync('public/world/island-map.png'), 'the picture ships with the app')
    assert.ok(matchesIslandMap(state.places))
    assert.ok(geo.regions.every(r => r.source === 'designer'), 'places are placed by the artwork, not guessed')
    for (const region of geo.regions) {
      const name = state.places.find(p => p.id === region.placeId)!.name
      assert.ok(isWalkable(terrainOnIsland(region.center)), `${name} must sit on ground you can stand on`)
      const design = ISLAND_PLACES.find(p => p.name === name)!
      assert.ok(Math.hypot(region.center.x - design.seed.x, region.center.y - design.seed.y) < 400, `${name} stays where the map labels it`)
    }
    // Sea and cliff are off limits; the gorge is passable but slow.
    assert.equal(TERRAIN_SPEED.WATER, 0)
    assert.ok(!isWalkable('WATER') && !isWalkable('CLIFF'))
    assert.ok(isWalkable('CANYON') && TERRAIN_SPEED.CANYON < TERRAIN_SPEED.GRASS)
  } finally { await world.close() }
})

// --- 2. starting positions -----------------------------------------------------------------------

test('a season starts with everyone scattered, alone, on ground they can leave', async () => {
  const world = islandWorld()
  try {
    const state = store.getWorldState(), geo = state.engine!.geo!
    const spots = state.agents.map(a => a.publicState.coord!)
    assert.equal(spots.length, 8)
    assert.ok(spots.every(p => isWalkable(terrainAt(geo, p))), 'nobody wakes up in the sea or on a cliff')
    assert.ok(closestPair(spots) >= 200, `the closest pair started ${Math.round(closestPair(spots))}m apart`)
    // Nobody can see anybody: the island opens with eight separate stories.
    for (let i = 0; i < state.agents.length; i++) for (let j = i + 1; j < state.agents.length; j++)
      assert.equal(aware(state, geo, state.agents[i], state.agents[j]), null, 'no two people start in sight of each other')
    // Deterministic: the same cast always wakes in the same places.
    const again = spawnPoints(geo, 8, state.agents.map(a => a.id).join(','))
    assert.deepEqual(again, spots)
  } finally { await world.close() }
})

// --- 3. real movement, and the markers that follow it ---------------------------------------------

test('a trip crosses the real ground step by step and the public map shows the same coordinates', async () => {
  const world = islandWorld()
  try {
    const state = store.getWorldState(), geo = state.engine!.geo!
    // One walker alone on the island: bumping into somebody is its own test, below.
    state.agents.splice(1)
    const walker = state.agents[0]
    // The far side of the island, so the walk is a journey rather than a step.
    const target = geo.regions.filter(r => r.placeId !== walker.publicState.locationId)
      .reduce((best, r) => Math.hypot(r.center.x - walker.publicState.coord!.x, r.center.y - walker.publicState.coord!.y)
        > Math.hypot(best.center.x - walker.publicState.coord!.x, best.center.y - walker.publicState.coord!.y) ? r : best)
    const from = { ...walker.publicState.coord! }
    walker.publicState.travel = planTravel(geo, from, target.center, state.engine!.minute, target.placeId)
    const trip = walker.publicState.travel!
    assert.ok(trip.arriveMinute > trip.startMinute, 'walking takes world time')

    const seen: Array<{ x: number; y: number }> = []
    for (let minute = trip.startMinute; minute <= trip.arriveMinute; minute += 5) {
      advanceMovement(state, geo, minute)
      seen.push({ ...walker.publicState.coord! })
      // The public world the minimap reads is the same object the engine moved.
      const published = toPublicWorld(state).agents.find(a => a.id === walker.id)!
      assert.deepEqual(published.publicState.coord, walker.publicState.coord, 'marker coordinates are the simulation coordinates')
    }
    assert.ok(seen.length > 3, 'the walk is many positions, not two')
    const steps = seen.slice(1).map((p, i) => Math.hypot(p.x - seen[i].x, p.y - seen[i].y))
    assert.ok(Math.max(...steps) < 800, 'no step is a teleport')
    assert.ok(seen.some(p => Math.hypot(p.x - from.x, p.y - from.y) > 50 && Math.hypot(p.x - target.center.x, p.y - target.center.y) > 50), 'it passes through the middle')
    advanceMovement(state, geo, trip.arriveMinute)
    assert.ok(Math.hypot(walker.publicState.coord!.x - target.center.x, walker.publicState.coord!.y - target.center.y) < 60, 'and arrives')
    // A route never cuts across open water or cliff — checked with the planner's own sampler,
    // which is accurate to the 50 m terrain cell.
    assert.ok(routeAvoidsBlocked(geo, routeBetween(geo, from, target.center)), 'the path stays on the island')
    // And the same holds between every pair of landmarks: no leg of any route passes through open
    // water. (Terrain is known per 50 m cell, so a path may touch a cell corner; "open water"
    // means more than 3 m inside a water cell.)
    const openWater = (p: { x: number; y: number }) =>
      terrainAt(geo, p) === 'WATER' && p.x % 50 > 3 && p.x % 50 < 47 && p.y % 50 > 3 && p.y % 50 < 47
    for (const a of geo.regions) for (const b of geo.regions) {
      if (a === b) continue
      const legs = routeBetween(geo, a.center, b.center)
      assert.ok(routeAvoidsBlocked(geo, legs), 'every landmark is reachable on foot')
      for (let i = 1; i < legs.length; i++) {
        const steps = Math.ceil(Math.hypot(legs[i].x - legs[i - 1].x, legs[i].y - legs[i - 1].y) / 3)
        for (let s = 0; s <= steps; s++) {
          const p = { x: legs[i - 1].x + (legs[i].x - legs[i - 1].x) * s / steps, y: legs[i - 1].y + (legs[i].y - legs[i - 1].y) * s / steps }
          assert.ok(!openWater(p), `route ${a.placeId}->${b.placeId} swims at ${Math.round(p.x)},${Math.round(p.y)}`)
        }
      }
    }
  } finally { await world.close() }
})

// --- 4. meeting on the way -----------------------------------------------------------------------

test('two people who come within sight while walking stop and become an encounter', async () => {
  const world = islandWorld()
  try {
    const state = store.getWorldState(), geo = state.engine!.geo!
    const [a, b] = state.agents
    // Put them on open ground a few hundred metres apart and send one at the other.
    const ground = standablePoints(geo).filter(p => terrainAt(geo, p) === 'GRASS' || terrainAt(geo, p) === 'BEACH')
    const start = ground[0]
    const far = ground.reduce((best, p) => Math.abs(Math.hypot(p.x - start.x, p.y - start.y) - 400) < Math.abs(Math.hypot(best.x - start.x, best.y - start.y) - 400) ? p : best)
    a.publicState.coord = { ...start }
    b.publicState.coord = { ...far }
    for (const other of state.agents.slice(2)) other.publicState.coord = { x: 50, y: 50 }
    assert.equal(aware(state, geo, a, b), null, 'they cannot see each other yet')
    a.publicState.travel = planTravel(geo, a.publicState.coord, b.publicState.coord, state.engine!.minute, b.publicState.locationId)
    const encounters = advanceMovement(state, geo, state.engine!.minute + 240)
    const met = encounters.find(e => e.ids.includes(a.id) && e.ids.includes(b.id))
    assert.ok(met, 'walking into someone is an encounter')
    assert.ok(perceive(state, geo, a, b) || perceive(state, geo, b, a), 'and it only happens once one can really perceive the other')
    assert.equal(a.publicState.travel, undefined, 'the walker stops where they noticed each other')
  } finally { await world.close() }
})

// --- 5. flight and pursuit on the real ground -----------------------------------------------------

test('a chase is settled by distance, body and terrain, not by who said they ran', async () => {
  const world = islandWorld()
  try {
    const state = store.getWorldState(), geo = state.engine!.geo!
    const [runner, hunter] = state.agents
    const open = standablePoints(geo).filter(p => terrainAt(geo, p) === 'GRASS')
    const spot = open[Math.floor(open.length / 2)]
    const place = (hurt: typeof runner, well: typeof runner) => {
      hurt.publicState.coord = { ...spot }
      well.publicState.coord = { x: spot.x + 30, y: spot.y }
      hurt.body = { health: 7, injury: 7 }
      well.body = { health: 0, injury: 0 }
    }
    place(runner, hunter)
    const caught = resolveChase(state, geo, runner, [hunter], [])
    assert.equal(caught?.status, 'caught', 'a badly hurt runner does not outrun a healthy one across open ground')
    assert.notDeepEqual(runner.publicState.coord, spot, 'the sprint actually moved them on the map')
    place(hunter, runner)
    assert.notEqual(resolveChase(state, geo, runner, [hunter], [])?.status, 'caught', 'the same head start works when the legs do')
  } finally { await world.close() }
})

// --- 6, 7, 8. supplies, closure notice, and avoiding the closed ground -----------------------------

test('supplies fall on real coordinates and zones are announced twelve hours before they close', async () => {
  const world = islandWorld()
  try {
    const state = store.getWorldState() as WorldState
    const execution = world.execution
    const v4 = ensureV4State(state, execution)
    const geo = ensureGeo(state, execution.draft)
    assert.equal(v4.director.enabled, true, 'a last-survivor island runs the director')

    // Run the director until the island has both dropped a crate and announced a closure.
    let drops = 0, warning: { minute: number; text: string } | undefined
    for (let step = 0; step < 20 && (!warning || drops < 2); step++) {
      state.engine!.minute += 120
      for (const event of runDirector(state, execution)) {
        if (event.cause === 'director:supply_drop') drops++
        if (event.cause === 'director:zone_warning') warning = { minute: event.worldMinute!, text: event.summary }
      }
    }
    assert.ok(drops >= 2 && warning, `director produced ${drops} drops and ${warning ? 1 : 0} warnings`)

    const crates = state.engine!.objects.filter(o => o.id.startsWith('drop-'))
    assert.ok(crates.length >= 3, 'a drop is a crate of several things')
    assert.ok(crates.every(o => o.coord), 'every crate has a real position on the map')
    assert.ok(crates.every(o => isWalkable(terrainAt(geo, o.coord!))), 'nothing is dropped into the sea')
    const kinds = new Set(crates.map(o => o.name))
    assert.ok([...kinds].some(name => /소총|탄약|칼|조끼/.test(name)), 'weapons and armour are part of the supply table')

    const closure = v4.director.closures[0]
    assert.ok(v4.director.announcements.some(a => a.kind === 'ZONE_WARNING'), 'the island is told over the speakers')
    assert.match(warning!.text, /12시간 뒤/, 'twelve hours of notice')
    assert.equal(closure.effectiveMinute - warning!.minute, 720)

    // What a person is told: their own position, the countdown, and the crates — never anyone else.
    const target = state.agents[0]
    target.publicState.coord = { ...geo.regions.find(r => r.placeId === closure.placeId)!.center }
    const ctx = buildSceneContext(state, v4, state.places.find(p => p.id === closure.placeId)!, [target])
    assert.ok(ctx.closures.some(c => c.placeId === closure.placeId && c.minutesUntil > 0), 'the countdown reaches the scene')
    assert.ok(ctx.supplies.length > 0 && ctx.supplies.every(s => s.distance >= 0 && s.direction), 'crates carry a bearing and a distance')
    assert.equal(ctx.placeDanger, 'warned', 'standing in a doomed zone is marked as such')

    // Closed ground actually hurts, which is what makes avoiding it a decision.
    const closingMinute = closure.effectiveMinute
    state.engine!.minute = closingMinute + 61
    const before = target.body?.health ?? 0
    target.publicState.locationId = closure.placeId
    runDirector(state, execution)
    assert.ok((target.body?.health ?? 0) > before, 'staying inside a closed zone costs you')
    assert.ok((target.journal ?? []).some(e => /위험 구역/.test(e.text)), 'and they know it')
  } finally { await world.close() }
})

// --- the story is written from the map ------------------------------------------------------------

test('a scene is written from the spatial world: GPS for the person, coordinates for the GM', async () => {
  const world = islandWorld()
  try {
    await store.runWorldTick()
    const character = world.requests.find(r => r.role === 'character')!
    const gm = world.requests.find(r => r.role === 'gm')!
    // What the person knows: their own dot, the island's shape, the broadcast — and nobody else.
    assert.match(character.prompt, /\[내 GPS\]/)
    assert.match(character.prompt, /내 위치: 동쪽으로 \d+m, 남쪽으로 \d+m/)
    assert.match(character.prompt, /섬 크기: 가로 2000m, 세로 2000m/)
    assert.match(character.prompt, /GPS에 다른 참가자의 위치는 표시되지 않는다/)
    // What the narrator is given: real positions, real ground, and a ban on inventing either.
    assert.match(gm.prompt, /\[공간 상태 — 지도와 어긋나게 쓰지 말 것\]/)
    assert.match(gm.prompt, /"좌표":\{"x":\d+,"y":\d+\}/)
    assert.match(gm.prompt, /지도에 없는 길, 다리, 건물, 동굴, 강을 만들지 마라/)
    assert.match(gm.prompt, /같은 지역에 있어도 수백 m 떨어져 있으면 마주친 것이 아니고/)
    assert.ok(store.listScenes({ limit: 5 }).items.some(s => s.id.startsWith('scene-v4-')), 'and the scene is published')
  } finally { await world.close() }
})
