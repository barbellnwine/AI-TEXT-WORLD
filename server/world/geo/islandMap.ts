// THE ISLAND — the painted map turned into simulation data.
//
// The picture in public/world/island-map.png is the only map of this world: the minimap draws it,
// and this module makes the same ground walkable. Metres and pixels share one frame — the
// picture's top-left corner is (0,0) m and its bottom-right is (2000,2000) m — so an agent's
// X/Y is literally where its marker sits on the image.
//
// Terrain comes from ISLAND_MASK (generated offline by tool/build-island-mask.mjs; nothing here
// ever reads a pixel). Named places are seeded at the spots the artwork labels them and then
// snapped onto ground you can actually walk to, so no landmark ends up stranded in the lagoon.
import type { Place } from '../../domain/worldTypes.ts'
import { ISLAND_MASK } from './islandMask.ts'
import { TERRAIN_BY_CODE, TERRAIN_CODES, type GeoPoint, type GeoRegion, type Terrain, type WorldGeo } from './geoTypes.ts'

export interface IslandPlace {
  name: string
  // Where the artwork puts the label, in metres.
  seed: GeoPoint
  terrain: Terrain
  kind: GeoRegion['kind']
  radius: number
}

export const ISLAND_PLACES: IslandPlace[] = [
  { name: '바위 고지대', seed: { x: 987, y: 300 }, terrain: 'ROCK', kind: 'TERRAIN', radius: 420 },
  { name: '서쪽 바위굴', seed: { x: 268, y: 560 }, terrain: 'ROCK', kind: 'POI', radius: 90 },
  { name: '좁은 협곡', seed: { x: 625, y: 993 }, terrain: 'CANYON', kind: 'TERRAIN', radius: 260 },
  { name: '버려진 야영지', seed: { x: 552, y: 1334 }, terrain: 'GRASS', kind: 'POI', radius: 120 },
  { name: '샘터', seed: { x: 1047, y: 928 }, terrain: 'GRASS', kind: 'POI', radius: 90 },
  { name: '깊은 숲', seed: { x: 1435, y: 871 }, terrain: 'FOREST', kind: 'TERRAIN', radius: 460 },
  { name: '동쪽 해변', seed: { x: 1831, y: 904 }, terrain: 'BEACH', kind: 'TERRAIN', radius: 320 },
]

export const ISLAND_IMAGE = ISLAND_MASK.image

// Ground nobody walks on: open sea and sheer coastal rock.
export const IMPASSABLE: ReadonlySet<Terrain> = new Set<Terrain>(['WATER', 'CLIFF'])
export const isWalkable = (terrain: Terrain) => !IMPASSABLE.has(terrain)

const cellTerrain = (col: number, row: number): Terrain =>
  TERRAIN_BY_CODE[ISLAND_MASK.cells[row * ISLAND_MASK.cols + col]] ?? 'GRASS'

// The island this world is played on: the largest group of walkable cells that touch each other.
// Detached crags and sandbars are excluded, so nobody is ever spawned somewhere they cannot leave.
function mainland(): boolean[] {
  const { cols, rows } = ISLAND_MASK
  const walkable = Array.from({ length: cols * rows }, (_, i) => isWalkable(cellTerrain(i % cols, Math.floor(i / cols))))
  const seen = new Array<number>(cols * rows).fill(0)
  let best: number[] = [], group = 0
  for (let start = 0; start < walkable.length; start++) {
    if (!walkable[start] || seen[start]) continue
    group++
    const stack = [start], found: number[] = []
    seen[start] = group
    while (stack.length) {
      const index = stack.pop()!
      found.push(index)
      const col = index % cols, row = Math.floor(index / cols)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = col + dx, r = row + dy, next = r * cols + c
        if (c < 0 || r < 0 || c >= cols || r >= rows || seen[next] || !walkable[next]) continue
        seen[next] = group
        stack.push(next)
      }
    }
    if (found.length > best.length) best = found
  }
  const onMainland = new Array<boolean>(cols * rows).fill(false)
  for (const index of best) onMainland[index] = true
  return onMainland
}

const MAINLAND = mainland()
const centreOf = (index: number): GeoPoint => ({
  x: Math.round((index % ISLAND_MASK.cols + 0.5) * ISLAND_MASK.cellMeters),
  y: Math.round((Math.floor(index / ISLAND_MASK.cols) + 0.5) * ISLAND_MASK.cellMeters),
})

// Every cell a person can stand on, ordered: the shared pool for spawning and for snapping.
export const WALKABLE_POINTS: GeoPoint[] = MAINLAND.flatMap((ok, index) => ok ? [centreOf(index)] : [])

const gap = (a: GeoPoint, b: GeoPoint) => Math.hypot(a.x - b.x, a.y - b.y)

// Pulls a labelled spot onto reachable ground — preferring ground of the kind the label describes,
// so the gorge marker lands in the gorge rather than on the forest beside it.
export function snapToGround(point: GeoPoint, terrain?: Terrain, preferWithin = 260): GeoPoint {
  const nearest = (candidates: GeoPoint[]) => candidates.length
    ? candidates.reduce((best, p) => gap(p, point) < gap(best, point) ? p : best)
    : null
  if (terrain) {
    const matching = WALKABLE_POINTS.filter(p => terrainOnIsland(p) === terrain && gap(p, point) <= preferWithin)
    const match = nearest(matching)
    if (match) return match
  }
  return nearest(WALKABLE_POINTS) ?? point
}

export function terrainOnIsland(p: GeoPoint): Terrain {
  const col = Math.min(ISLAND_MASK.cols - 1, Math.max(0, Math.floor(p.x / ISLAND_MASK.cellMeters)))
  const row = Math.min(ISLAND_MASK.rows - 1, Math.max(0, Math.floor(p.y / ISLAND_MASK.cellMeters)))
  return cellTerrain(col, row)
}

export function isMainlandPoint(p: GeoPoint): boolean {
  const col = Math.min(ISLAND_MASK.cols - 1, Math.max(0, Math.floor(p.x / ISLAND_MASK.cellMeters)))
  const row = Math.min(ISLAND_MASK.rows - 1, Math.max(0, Math.floor(p.y / ISLAND_MASK.cellMeters)))
  return MAINLAND[row * ISLAND_MASK.cols + col]
}

// This world is the painted island when its places are the island's places.
export function matchesIslandMap(places: Array<Pick<Place, 'name'>>): boolean {
  const names = new Set(places.map(p => p.name.trim()))
  return ISLAND_PLACES.filter(p => names.has(p.name)).length >= 5
}

// Builds the world's geography from the artwork. Terrain is the generated mask; every place in
// the world claims the ground nearest to its own labelled seed, so "which place am I in" is
// answered by X/Y alone — exactly what the minimap shows.
export function buildIslandGeo(places: Array<Pick<Place, 'id' | 'name'>>, minute = 0): WorldGeo {
  const { cols, rows, cellMeters, widthMeters, heightMeters, cells } = ISLAND_MASK
  const regions: GeoRegion[] = places.map(place => {
    const design = ISLAND_PLACES.find(p => p.name === place.name.trim())
    const seed = design ? snapToGround(design.seed, design.terrain) : snapToGround({ x: widthMeters / 2, y: heightMeters / 2 })
    return {
      placeId: place.id,
      kind: design?.kind ?? 'TERRAIN',
      terrain: design?.terrain ?? terrainOnIsland(seed),
      center: seed,
      radius: design?.radius ?? 200,
      source: 'designer' as const,
    }
  })
  // Ground ownership: nearest seed wins, so the labels partition the island with no gaps.
  const cellRegion: number[] = []
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const c = { x: (col + 0.5) * cellMeters, y: (row + 0.5) * cellMeters }
    let best = 0, bestGap = Infinity
    regions.forEach((region, i) => {
      const d = gap(c, region.center)
      if (d < bestGap) { bestGap = d; best = i }
    })
    cellRegion.push(best)
  }
  return { version: 1, widthMeters, heightMeters, cellMeters, cols, rows, cells, cellRegion, regions, minute, image: ISLAND_IMAGE }
}

export { TERRAIN_CODES }
