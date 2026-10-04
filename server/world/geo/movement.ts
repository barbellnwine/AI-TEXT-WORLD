// Movement along real coordinates. A trip is a timed path: position is interpolated every step,
// so a traveler can run into someone halfway. Terrain slows travel; open water is impassable.
import type { Agent, WorldState } from '../../domain/worldTypes.ts'
import type { GeoPoint, GeoTravel, Terrain, WorldGeo } from './geoTypes.ts'
import { clampToWorld, dist, syncLabels, terrainAt } from './geoBuild.ts'
import { isWalkable } from './islandMap.ts'
import { aware, type Sense } from './perception.ts'

export const WALK_METERS_PER_MINUTE = 67 // ~4 km/h on open ground
export const TERRAIN_SPEED: Record<Terrain, number> = { GRASS: 1, BEACH: 0.9, FOREST: 0.7, RUINS: 0.8, URBAN: 1, ROCK: 0.5, CANYON: 0.55, CLIFF: 0.35, RIVER: 0.4, WATER: 0 }
const SAMPLE_METERS = 25
// Blocking is checked more finely than travel time, so a route cannot step over a narrow inlet.
const BLOCK_SAMPLE_METERS = 8
const STEP_MINUTES = 0.25

// Open water and sheer cliff both stop a walker; a route has to go around either one. Terrain is
// known per 50 m cell, so this is accurate to the cell — a path may still clip a cell corner.
function crossesBlocked(geo: WorldGeo, points: GeoPoint[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], n = Math.max(1, Math.ceil(dist(a, b) / BLOCK_SAMPLE_METERS))
    for (let s = 1; s < n; s++) if (!isWalkable(terrainAt(geo, { x: a.x + (b.x - a.x) * s / n, y: a.y + (b.y - a.y) * s / n }))) return true
  }
  return false
}

// Does this route stay on ground a person can walk? The planner's own test, for callers and tests.
export function routeAvoidsBlocked(geo: WorldGeo, points: GeoPoint[]): boolean {
  return !crossesBlocked(geo, points)
}

// --- route finding ---------------------------------------------------------------------------
// Walking is not swimming: a route has to stay on ground a person can actually cross. The grid is
// small (a few thousand cells), a route is planned once per trip, and the search prefers fast
// ground, so people take the path around the lagoon rather than straight through it.

const cellOf = (geo: WorldGeo, p: GeoPoint) => {
  const col = Math.min(geo.cols - 1, Math.max(0, Math.floor(p.x / geo.cellMeters)))
  const row = Math.min(geo.rows - 1, Math.max(0, Math.floor(p.y / geo.cellMeters)))
  return row * geo.cols + col
}
const cellCentre = (geo: WorldGeo, index: number): GeoPoint =>
  ({ x: Math.round((index % geo.cols + 0.5) * geo.cellMeters), y: Math.round((Math.floor(index / geo.cols) + 0.5) * geo.cellMeters) })
const cellWalkable = (geo: WorldGeo, index: number) => isWalkable(terrainAt(geo, cellCentre(geo, index)))

// The nearest cell you could stand in, for a start or end that sits just off walkable ground.
function nearestWalkableCell(geo: WorldGeo, index: number): number {
  if (cellWalkable(geo, index)) return index
  const from = cellCentre(geo, index)
  let best = index, bestGap = Infinity
  for (let i = 0; i < geo.cols * geo.rows; i++) {
    if (!cellWalkable(geo, i)) continue
    const d = dist(from, cellCentre(geo, i))
    if (d < bestGap) { bestGap = d; best = i }
  }
  return best
}

function searchCells(geo: WorldGeo, from: GeoPoint, to: GeoPoint): number[] | null {
  const start = nearestWalkableCell(geo, cellOf(geo, from)), goal = nearestWalkableCell(geo, cellOf(geo, to))
  if (start === goal) return [start]
  const size = geo.cols * geo.rows
  const cost = new Float64Array(size).fill(Infinity), cameFrom = new Int32Array(size).fill(-1), done = new Uint8Array(size)
  const estimate = (i: number) => dist(cellCentre(geo, i), cellCentre(geo, goal)) / (WALK_METERS_PER_MINUTE * 1)
  cost[start] = 0
  const open: number[] = [start]
  while (open.length) {
    let pick = 0
    for (let i = 1; i < open.length; i++) if (cost[open[i]] + estimate(open[i]) < cost[open[pick]] + estimate(open[pick])) pick = i
    const current = open.splice(pick, 1)[0]
    if (current === goal) {
      const path = [goal]
      for (let node = goal; cameFrom[node] >= 0; node = cameFrom[node]) path.unshift(cameFrom[node])
      return path
    }
    done[current] = 1
    const col = current % geo.cols, row = Math.floor(current / geo.cols)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const c = col + dx, r = row + dy
      if (c < 0 || r < 0 || c >= geo.cols || r >= geo.rows) continue
      const next = r * geo.cols + c
      if (done[next] || !cellWalkable(geo, next)) continue
      // No cutting a corner between two cells of sea: a diagonal step needs both sides walkable.
      if (dx && dy && !(cellWalkable(geo, row * geo.cols + c) && cellWalkable(geo, r * geo.cols + col))) continue
      const speed = TERRAIN_SPEED[terrainAt(geo, cellCentre(geo, next))] || 0.3
      const step = geo.cellMeters * (dx && dy ? Math.SQRT2 : 1) / (WALK_METERS_PER_MINUTE * speed)
      if (cost[current] + step >= cost[next]) continue
      cost[next] = cost[current] + step
      cameFrom[next] = current
      if (!open.includes(next)) open.push(next)
    }
  }
  return null
}

// Straight line when the ground allows it, otherwise the shortest walk around what blocks it.
export function routeBetween(geo: WorldGeo, from: GeoPoint, to: GeoPoint): GeoPoint[] {
  const direct = [from, to]
  if (!crossesBlocked(geo, direct)) return direct
  const cells = searchCells(geo, from, to)
  if (!cells) return direct
  // String-pulling: keep a waypoint only when the shortcut past it would cross blocked ground.
  const points = [from, ...cells.map(i => cellCentre(geo, i)), clampToWorld(geo, to)]
  const route = [points[0]]
  let anchor = 0
  for (let i = 1; i < points.length; i++) {
    if (!crossesBlocked(geo, [points[anchor], points[i]])) continue
    route.push(points[i - 1])
    anchor = i - 1
  }
  route.push(points.at(-1)!)
  return route
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
