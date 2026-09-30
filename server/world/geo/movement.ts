// Movement along real coordinates. A trip is a timed path: position is interpolated every step,
// so a traveler can run into someone halfway. Terrain slows travel; open water is impassable.
import type { Agent, WorldState } from '../../domain/worldTypes.ts'
import type { GeoPoint, GeoTravel, Terrain, WorldGeo } from './geoTypes.ts'
import { clampToWorld, dist, syncLabels, terrainAt } from './geoBuild.ts'
import { aware, type Sense } from './perception.ts'

export const WALK_METERS_PER_MINUTE = 67 // ~4 km/h on open ground
export const TERRAIN_SPEED: Record<Terrain, number> = { GRASS: 1, BEACH: 0.9, FOREST: 0.7, RUINS: 0.8, URBAN: 1, ROCK: 0.5, CLIFF: 0.35, RIVER: 0.4, WATER: 0 }
const SAMPLE_METERS = 25
const STEP_MINUTES = 0.25

function crossesWater(geo: WorldGeo, points: GeoPoint[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], n = Math.max(1, Math.ceil(dist(a, b) / SAMPLE_METERS))
    for (let s = 1; s < n; s++) if (terrainAt(geo, { x: a.x + (b.x - a.x) * s / n, y: a.y + (b.y - a.y) * s / n }) === 'WATER') return true
  }
  return false
}

// Straight line if possible, otherwise the first sideways detour that stays on land.
export function routeBetween(geo: WorldGeo, from: GeoPoint, to: GeoPoint): GeoPoint[] {
  const direct = [from, to]
  if (!crossesWater(geo, direct)) return direct
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, len = Math.max(1, dist(from, to))
  const normal = { x: -(to.y - from.y) / len, y: (to.x - from.x) / len }
  for (const offset of [200, -200, 400, -400, 700, -700]) {
    const route = [from, clampToWorld(geo, { x: mid.x + normal.x * offset, y: mid.y + normal.y * offset }), to]
    if (!crossesWater(geo, route)) return route
  }
  return direct
}

export function travelMinutes(geo: WorldGeo, points: GeoPoint[]): number[] {
  const minutes = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], n = Math.max(1, Math.ceil(dist(a, b) / SAMPLE_METERS)), step = dist(a, b) / n
    let t = 0
    for (let s = 0; s < n; s++) {
      const speed = TERRAIN_SPEED[terrainAt(geo, { x: a.x + (b.x - a.x) * (s + 0.5) / n, y: a.y + (b.y - a.y) * (s + 0.5) / n })] || 0.3
      t += step / (WALK_METERS_PER_MINUTE * speed)
    }
    minutes.push(minutes[i - 1] + t)
  }
  return minutes
}

export function planTravel(geo: WorldGeo, from: GeoPoint, to: GeoPoint, startMinute: number, destinationPlaceId: string | null): GeoTravel {
  const route = routeBetween(geo, from, clampToWorld(geo, to))
  const minutes = travelMinutes(geo, route)
  // The trip starts exactly where they stand; later waypoints are rounded to the meter.
  const path = route.map((p, i) => ({ x: i === 0 ? p.x : Math.round(p.x), y: i === 0 ? p.y : Math.round(p.y), minute: startMinute + Math.round(minutes[i]) }))
  return { from: { x: path[0].x, y: path[0].y }, to: { x: path.at(-1)!.x, y: path.at(-1)!.y }, path, startMinute, arriveMinute: path.at(-1)!.minute, destinationPlaceId }
}

export function positionAt(travel: GeoTravel, minute: number): GeoPoint {
  if (minute <= travel.startMinute) return { ...travel.from }
  if (minute >= travel.arriveMinute) return { ...travel.to }
  for (let i = 1; i < travel.path.length; i++) {
    const a = travel.path[i - 1], b = travel.path[i]
    if (minute <= b.minute) {
      const f = b.minute === a.minute ? 1 : (minute - a.minute) / (b.minute - a.minute)
      return { x: Math.round(a.x + (b.x - a.x) * f), y: Math.round(a.y + (b.y - a.y) * f) }
    }
  }
  return { ...travel.to }
}

export interface Encounter { ids: [string, string]; minute: number; sense: Sense; at: GeoPoint }

const living = (a: Agent) => a.publicState.status !== 'deceased'
const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`

// Advances every traveler to `toMinute` in small steps. When two people who were not aware of
// each other become aware (at least one of them moving), both stop there: that is an encounter.
export function advanceMovement(world: WorldState, geo: WorldGeo, toMinute: number): Encounter[] {
  const encounters: Encounter[] = []
  const people = world.agents.filter(a => living(a) && a.publicState.coord)
  const awareNow = () => {
    const pairs = new Map<string, Sense>()
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const sense = aware(world, geo, people[i], people[j])
      if (sense) pairs.set(pairKey(people[i].id, people[j].id), sense)
    }
    return pairs
  }
  const anyoneMoving = () => people.some(a => a.publicState.travel)
  let before = awareNow()
  // Nobody walks faster than ~17 m per step, so no one can slip past another's perception range.
  for (let minute = geo.minute; minute < toMinute && anyoneMoving();) {
    minute = Math.min(toMinute, minute + STEP_MINUTES)
    const moving = new Set<string>()
    for (const agent of people) {
      const travel = agent.publicState.travel
      if (!travel) continue
      moving.add(agent.id)
      agent.publicState.coord = positionAt(travel, minute)
      if (minute >= travel.arriveMinute) agent.publicState.travel = undefined
    }
    const after = awareNow()
    for (const [key, sense] of after) {
      if (before.has(key)) continue
      const [a, b] = key.split('|').map(id => people.find(p => p.id === id)!)
      if (!moving.has(a.id) && !moving.has(b.id)) continue
      // Both stop where they noticed each other; what happens next is the scene's business.
      a.publicState.travel = undefined
      b.publicState.travel = undefined
      encounters.push({ ids: [a.id, b.id], minute: Math.round(minute), sense, at: { ...a.publicState.coord! } })
    }
    before = after
  }
  geo.minute = Math.max(geo.minute, toMinute)
  syncLabels(world)
  return encounters
}
