// Builds a deterministic continuous map from a world's places, and maps coordinates back to
// semantic place labels. Works for any setting (island, city, lab…): nothing is island-specific
// except an optional surrounding sea when the premise says it is an island.
import type { Agent, Place, WorldState } from '../../domain/worldTypes.ts'
import { TERRAIN_BY_CODE, TERRAIN_CODES, type GeoPoint, type GeoRegion, type Terrain, type WorldGeo } from './geoTypes.ts'

export const DEFAULT_WORLD_METERS = 2000
export const CELL_METERS = 50
const POI_RADIUS = 40
const SPAWN_JITTER = 20

export const dist = (a: GeoPoint, b: GeoPoint) => Math.hypot(a.x - b.x, a.y - b.y)
function hash01(text: string): number {
  let h = 2166136261
  for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 100000) / 100000
}

const POI_PATTERN = /샘|우물|야영지|캠프|동굴|굴$|굴\s|입구|오두막|건물|폐가|창고|벙커|등대|초소|제단|천막|대피소|camp|cave|hut|spring|well|shelter|bunker|lighthouse/i
const TERRAIN_RULES: Array<[RegExp, Terrain]> = [
  [/해변|해안|모래|갯벌|beach|shore|sand/i, 'BEACH'],
  [/숲|수풀|정글|덤불|forest|wood|jungle/i, 'FOREST'],
  [/절벽|cliff/i, 'CLIFF'],
  [/바위|고지대|암벽|언덕|협곡|계곡|산|rock|hill|canyon|ridge/i, 'ROCK'],
  [/강|하천|개울|river|stream|creek/i, 'RIVER'],
  [/호수|바다|늪|연못|lake|sea|swamp|pond/i, 'WATER'],
  [/폐허|유적|잔해|ruin/i, 'RUINS'],
  [/도시|거리|건물|시설|실내|홀|복도|연구소|학교|병원|기지|city|street|building|hall|lab|base/i, 'URBAN'],
  [/초원|들판|평원|풀밭|meadow|field|plain|grass/i, 'GRASS'],
]

// Automatic classification (source: 'auto'). A designer override can later set kind/terrain.
export function classifyPlace(place: Pick<Place, 'name' | 'description'> & { type?: string }): { kind: GeoRegion['kind']; terrain: Terrain } {
  const text = `${place.name} ${place.description}`
  const kind = POI_PATTERN.test(place.name) ? 'POI' : 'TERRAIN'
  const terrain = TERRAIN_RULES.find(([pattern]) => pattern.test(place.name))?.[1]
    ?? TERRAIN_RULES.find(([pattern]) => pattern.test(text))?.[1]
    ?? (place.type === '실내' ? 'URBAN' : 'GRASS')
  return { kind, terrain }
}

export function buildGeo(places: Array<Place & { type?: string }>, options: { widthMeters?: number; heightMeters?: number; island?: boolean; minute?: number } = {}): WorldGeo {
  const W = options.widthMeters ?? DEFAULT_WORLD_METERS, H = options.heightMeters ?? DEFAULT_WORLD_METERS
  const cols = Math.ceil(W / CELL_METERS), rows = Math.ceil(H / CELL_METERS)
  // Designer canvas coordinates keep their relative layout; the world keeps a margin (sea for islands).
  const margin = options.island ? 0.2 : 0.1
  const xs = places.map(p => p.x ?? 0), ys = places.map(p => p.y ?? 0)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const regions: GeoRegion[] = places.map((place, i) => {
    const angle = i * 2.399963229728653, r = 0.3 * Math.sqrt((i + 0.5) / places.length)
    const nx = maxX > minX ? ((place.x ?? 0) - minX) / (maxX - minX) : 0.5 + Math.cos(angle) * r
    const ny = maxY > minY ? ((place.y ?? 0) - minY) / (maxY - minY) : 0.5 + Math.sin(angle) * r
    const { kind, terrain } = classifyPlace(place)
    return { placeId: place.id, kind, terrain, center: { x: Math.round(W * (margin + nx * (1 - 2 * margin))), y: Math.round(H * (margin + ny * (1 - 2 * margin))) }, radius: POI_RADIUS, source: 'auto' as const }
  })
  for (const region of regions.filter(r => r.kind === 'TERRAIN')) {
    const nearest = Math.min(...regions.filter(o => o !== region).map(o => dist(o.center, region.center)), W / 2)
    region.radius = Math.round(Math.min(400, nearest / 2))
  }
  // Terrain regions own the ground (noisy Voronoi for organic borders); a POI-only world uses POIs.
  const seeds = regions.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === 'TERRAIN')
  const owners = seeds.length ? seeds : regions.map((r, i) => ({ r, i }))
  const centroid = { x: regions.reduce((n, r) => n + r.center.x, 0) / Math.max(1, regions.length), y: regions.reduce((n, r) => n + r.center.y, 0) / Math.max(1, regions.length) }
  const landRadius = Math.max(...regions.map(r => dist(r.center, centroid)), Math.min(W, H) * 0.2) + 180
  let cells = ''
  const cellRegion: number[] = []
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const c = { x: (col + 0.5) * CELL_METERS, y: (row + 0.5) * CELL_METERS }
    let best = owners[0], bestScore = Infinity
    for (const seed of owners) {
      const score = dist(c, seed.r.center) * (0.88 + 0.24 * hash01(`${col}:${row}:${seed.i}`))
      if (score < bestScore) { bestScore = score; best = seed }
    }
    let terrain = best.r.terrain
    if (options.island) {
      const shore = dist(c, centroid) + (hash01(`coast:${col}:${row}`) - 0.5) * 90
      if (shore > landRadius) terrain = 'WATER'
      else if (shore > landRadius - 70 && !['ROCK', 'CLIFF'].includes(terrain)) terrain = 'BEACH'
    }
    cells += TERRAIN_CODES[terrain]
    cellRegion.push(best.i)
  }
  return { version: 1, widthMeters: W, heightMeters: H, cellMeters: CELL_METERS, cols, rows, cells, cellRegion, regions, minute: options.minute ?? 0 }
}

function cellIndex(geo: WorldGeo, p: GeoPoint): number {
  const col = Math.min(geo.cols - 1, Math.max(0, Math.floor(p.x / geo.cellMeters)))
  const row = Math.min(geo.rows - 1, Math.max(0, Math.floor(p.y / geo.cellMeters)))
  return row * geo.cols + col
}
export function terrainAt(geo: WorldGeo, p: GeoPoint): Terrain { return TERRAIN_BY_CODE[geo.cells[cellIndex(geo, p)]] ?? 'GRASS' }

// The semantic label for a point: the POI you stand at, otherwise the terrain region you are in.
export function regionAt(geo: WorldGeo, p: GeoPoint): GeoRegion {
  const poi = geo.regions.filter(r => r.kind === 'POI' && dist(r.center, p) <= r.radius).sort((a, b) => dist(a.center, p) - dist(b.center, p))[0]
  return poi ?? geo.regions[geo.cellRegion[cellIndex(geo, p)]] ?? geo.regions[0]
}

export function clampToWorld(geo: WorldGeo, p: GeoPoint): GeoPoint {
  return { x: Math.min(geo.widthMeters - 1, Math.max(1, p.x)), y: Math.min(geo.heightMeters - 1, Math.max(1, p.y)) }
}

// A stable spot near a region's center for a given person (so arrivals don't stack exactly).
export function pointNear(geo: WorldGeo, placeId: string, salt: string, jitter = SPAWN_JITTER): GeoPoint {
  const region = geo.regions.find(r => r.placeId === placeId) ?? geo.regions[0]
  const a = hash01(`${salt}:a`) * Math.PI * 2, r = hash01(`${salt}:r`) * Math.min(jitter, region.radius)
  const p = clampToWorld(geo, { x: Math.round(region.center.x + Math.cos(a) * r), y: Math.round(region.center.y + Math.sin(a) * r) })
  return terrainAt(geo, p) === 'WATER' ? { ...region.center } : p
}

export function isIslandWorld(text: string): boolean { return /섬|무인도|island/i.test(text) }

// Place names follow coordinates: locationId, occupancy and the movement log are derived.
export function syncLabels(world: WorldState): void {
  const geo = world.engine?.geo
  if (!geo) return
  for (const agent of world.agents) {
    if (!agent.publicState.coord) continue
    const label = regionAt(geo, agent.publicState.coord).placeId
    if (label === agent.publicState.locationId) continue
    for (const place of world.places) place.currentAgentIds = place.currentAgentIds.filter(id => id !== agent.id)
    if (agent.publicState.status !== 'deceased') world.places.find(p => p.id === label)?.currentAgentIds.push(agent.id)
    agent.publicState.locationId = label
    agent.movementLog = [...agent.movementLog, { placeId: label, arrivedAt: new Date().toISOString() }].slice(-50)
  }
}

export function ensureGeo(world: WorldState, draft: { places: Array<{ id: string; type?: string }>; studio?: { widthMeters?: number; heightMeters?: number }; genre: string; intro: string; background: string }): WorldGeo {
  const engine = world.engine!
  if (!engine.geo) {
    const places = world.places.map(p => ({ ...p, type: draft.places.find(d => d.id === p.id)?.type }))
    const island = isIslandWorld(`${draft.genre} ${draft.intro} ${draft.background}`) || places.some(p => classifyPlace(p).terrain === 'BEACH')
    engine.geo = buildGeo(places, { widthMeters: draft.studio?.widthMeters, heightMeters: draft.studio?.heightMeters, island, minute: engine.minute })
  }
  // Anyone without a coordinate (new season, or a checkpoint from before continuous space)
  // starts near the place they were recorded at.
  for (const agent of world.agents) agent.publicState.coord ??= pointNear(engine.geo, agent.publicState.locationId, agent.id)
  syncLabels(world)
  return engine.geo
}

export function agentCoord(agent: Agent): GeoPoint | undefined { return agent.publicState.coord }
