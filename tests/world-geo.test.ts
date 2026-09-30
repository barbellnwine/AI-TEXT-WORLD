import test from 'node:test'
import assert from 'node:assert/strict'
import type { Agent, Place, WorldState } from '../server/domain/worldTypes.ts'
import { buildGeo, classifyPlace, dist, regionAt, syncLabels, terrainAt } from '../server/world/geo/geoBuild.ts'
import { perceive } from '../server/world/geo/perception.ts'
import { advanceMovement, planTravel, positionAt, routeBetween } from '../server/world/geo/movement.ts'
import { selectSpotlight } from '../server/world/v4/sceneEngine.ts'
import { toPublicWorld } from '../server/world/publicView.ts'
import type { V4State } from '../server/world/v4/sceneTypes.ts'

const place = (id: string, name: string, description: string, x: number, y: number): Place =>
  ({ id, name, description, x, y, connectedPlaceIds: [], currentAgentIds: [], resources: [], locked: false, recentEventIds: [] })
const PLACES = [place('forest', '깊은 숲', '나무가 빽빽한 숲', 50, 50), place('beach', '동쪽 해변', '모래사장', 85, 50),
  place('rock', '바위 고지대', '노출된 고지대', 50, 15), place('spring', '샘터', '담수 샘', 40, 70), place('grass', '넓은 초원', '풀밭', 15, 50)]

function agent(id: string, x: number, y: number): Agent {
  return { id, name: id, codeNumber: id, avatarId: 'a', shortBio: '', factionIds: [], relationships: [], inventory: [], knowledge: [], movementLog: [], keyEventIds: [],
    publicState: { locationId: 'forest', status: 'alive', visibleGoal: null, lastAction: null, lastActiveAt: '', coord: { x, y } } }
}
function world(agents: Agent[], timeOfDay: WorldState['clock']['timeOfDay'] = 'afternoon'): WorldState {
  const geo = buildGeo(PLACES)
  return { seasonId: 's', clock: { day: 1, time: '14:00', timeOfDay, weather: 'clear', temperatureC: 20 }, dangerLevel: 'stable', places: structuredClone(PLACES), agents, factions: [], activeEventIds: [], updatedAt: '',
    engine: { version: 1, minute: 840, lastVitalsMinute: 840, connections: [], objects: [], truths: [], ongoingActions: [], environment: { powerStatus: '', facilityStatus: '' }, geo: { ...geo, minute: 840 } } }
}
const v4 = (): V4State => ({ version: 1, sceneCount: 0, lastSceneMinute: {}, repeatCount: 0, consecutiveFailures: 0, director: { enabled: false, nextEventMinute: 0, dropCount: 0, closures: [], announcements: [] } })
// A point inside a region, stepping from its center toward a direction until the label holds.
function inside(geo: ReturnType<typeof buildGeo>, placeId: string, dx: number, dy: number) {
  const c = geo.regions.find(r => r.placeId === placeId)!.center
  const p = { x: c.x + dx, y: c.y + dy }
  assert.equal(regionAt(geo, p).placeId, placeId, `test point must lie in ${placeId}`)
  return p
}

test('the map is deterministic, separates terrain from POIs, and uses the configured world size', () => {
  const a = buildGeo(PLACES), b = buildGeo(PLACES)
  assert.deepEqual(a, b)
  assert.equal(a.widthMeters, 2000); assert.equal(buildGeo(PLACES, { widthMeters: 800, heightMeters: 600 }).cols, 16)
  assert.deepEqual(classifyPlace(PLACES[0]), { kind: 'TERRAIN', terrain: 'FOREST' })
  assert.equal(classifyPlace(PLACES[3]).kind, 'POI')
  assert.equal(terrainAt(a, a.regions.find(r => r.placeId === 'forest')!.center), 'FOREST')
  assert.ok(a.regions.every(r => r.source === 'auto'))
})

test('the coordinate is the source of truth: place names are labels derived from X/Y', () => {
  const w = world([agent('a', 0, 0)])
  const geo = w.engine!.geo!
  w.agents[0].publicState.coord = { ...geo.regions.find(r => r.placeId === 'spring')!.center }
  syncLabels(w)
  assert.equal(w.agents[0].publicState.locationId, 'spring')
  assert.ok(w.places.find(p => p.id === 'spring')!.currentAgentIds.includes('a'))
})

test('same place name but far apart: they do not perceive each other or share a scene', () => {
  const geo = world([]).engine!.geo!
  const p = inside(geo, 'forest', -150, 0), q = inside(geo, 'forest', 150, 0)
  assert.ok(dist(p, q) >= 300)
  const w = world([agent('a', p.x, p.y), agent('b', q.x, q.y)])
  syncLabels(w)
  assert.equal(w.agents[0].publicState.locationId, w.agents[1].publicState.locationId, 'same label')
  assert.equal(perceive(w, w.engine!.geo!, w.agents[0], w.agents[1]), null)
  const spot = selectSpotlight(w, v4())!
  assert.equal(spot.agents.length, 1, 'no scene groups people by place name')
})

test('different place names but 10 m apart: they perceive each other and share a scene', () => {
  const geo = world([]).engine!.geo!
  const f = geo.regions.find(r => r.placeId === 'forest')!.center, b = geo.regions.find(r => r.placeId === 'beach')!.center
  // Walk from the forest toward the beach until the label flips, then stand 5 m either side.
  let t = 0
  while (regionAt(geo, { x: f.x + (b.x - f.x) * t, y: f.y + (b.y - f.y) * t }).placeId === 'forest') t += 0.002
  const len = dist(f, b), ux = (b.x - f.x) / len, uy = (b.y - f.y) / len
  const edge = { x: f.x + (b.x - f.x) * t, y: f.y + (b.y - f.y) * t }
  const w = world([agent('a', edge.x - ux * 6, edge.y - uy * 6), agent('b', edge.x + ux * 5, edge.y + uy * 5)])
  syncLabels(w)
  assert.notEqual(w.agents[0].publicState.locationId, w.agents[1].publicState.locationId, 'different labels')
  assert.ok(dist(w.agents[0].publicState.coord!, w.agents[1].publicState.coord!) <= 12)
  assert.ok(perceive(w, w.engine!.geo!, w.agents[1], w.agents[0]))
  assert.equal(selectSpotlight(w, v4())!.agents.length, 2)
})

test('terrain and light change perception range', () => {
  const geo = world([]).engine!.geo!
  const g = inside(geo, 'grass', 0, 0)
  const day = world([agent('a', g.x, g.y), agent('b', g.x + 60, g.y)])
  assert.equal(perceive(day, day.engine!.geo!, day.agents[0], day.agents[1]), 'sight', '60 m on open grass by day')
  const night = world([agent('a', g.x, g.y), agent('b', g.x + 60, g.y)], 'night')
  assert.equal(perceive(night, night.engine!.geo!, night.agents[0], night.agents[1]), null, 'not at night')
  const f = inside(geo, 'forest', 0, 0)
  const forest = world([agent('a', f.x, f.y), agent('b', f.x + 50, f.y)])
  assert.equal(perceive(forest, forest.engine!.geo!, forest.agents[0], forest.agents[1]), null, 'dense forest hides 50 m')
})

test('a trip moves the coordinate over time along the path', () => {
  const geo = world([]).engine!.geo!
  const from = geo.regions.find(r => r.placeId === 'grass')!.center, to = geo.regions.find(r => r.placeId === 'beach')!.center
  const trip = planTravel(geo, from, to, 100, 'beach')
  assert.ok(trip.arriveMinute > 100)
  const mid = positionAt(trip, Math.round((100 + trip.arriveMinute) / 2))
  assert.ok(dist(mid, from) > 50 && dist(mid, to) > 50, 'halfway is between the ends')
  assert.deepEqual(positionAt(trip, trip.arriveMinute + 10), trip.to)
})

test('two people can meet halfway: movement stops both on mutual perception', () => {
  const geo = world([]).engine!.geo!
  const g = inside(geo, 'grass', 0, 0), beach = geo.regions.find(r => r.placeId === 'beach')!.center
  const w = world([agent('waiting', g.x + 400, g.y), agent('walker', g.x, g.y)])
  const walker = w.agents[1]
  walker.publicState.travel = planTravel(w.engine!.geo!, walker.publicState.coord!, beach, 840, 'beach')
  assert.equal(perceive(w, w.engine!.geo!, walker, w.agents[0]), null, 'not aware at the start')
  const encounters = advanceMovement(w, w.engine!.geo!, walker.publicState.travel.arriveMinute)
  assert.equal(encounters.length, 1)
  assert.deepEqual([...encounters[0].ids].sort(), ['waiting', 'walker'])
  assert.equal(walker.publicState.travel, undefined, 'the walker stopped at the encounter')
  assert.ok(dist(walker.publicState.coord!, beach) > 100, 'stopped mid-route, not at the destination')
  assert.ok(perceive(w, w.engine!.geo!, walker, w.agents[0]) || perceive(w, w.engine!.geo!, w.agents[0], walker))
})

test('island worlds route around open water, and public state exposes the same coordinates', () => {
  const island = buildGeo(PLACES, { island: true })
  assert.ok(island.cells.includes('w'), 'the island has a sea')
  const west = island.regions.find(r => r.placeId === 'grass')!.center, east = island.regions.find(r => r.placeId === 'beach')!.center
  const route = routeBetween(island, west, east)
  for (let i = 1; i < route.length; i++) for (let s = 1; s < 40; s++) {
    const p = { x: route[i - 1].x + (route[i].x - route[i - 1].x) * s / 40, y: route[i - 1].y + (route[i].y - route[i - 1].y) * s / 40 }
    assert.notEqual(terrainAt(island, p), 'WATER')
  }
  const w = world([agent('a', 321, 654)])
  const pub = toPublicWorld(w)
  assert.deepEqual(pub.agents[0].publicState.coord, { x: 321, y: 654 }, 'the minimap reads the simulation coordinate unchanged')
  assert.equal(pub.engine!.geo!.cells, w.engine!.geo!.cells)
})
