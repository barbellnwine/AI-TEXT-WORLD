// CONTINUOUS SPATIAL WORLD — one metric coordinate system for the whole world.
// X/Y in meters is the source of truth for where anyone is. Place names survive only as
// semantic labels ("which terrain region / POI contains this point").
// Pure types: also imported by the client (src/world/types.ts).

export interface GeoPoint { x: number; y: number }

export type Terrain = 'GRASS' | 'FOREST' | 'BEACH' | 'ROCK' | 'CLIFF' | 'WATER' | 'RIVER' | 'RUINS' | 'URBAN'

// Terrain = a region that occupies map area. POI = a point of interest sitting on terrain.
export interface GeoRegion {
  placeId: string
  kind: 'TERRAIN' | 'POI'
  terrain: Terrain
  center: GeoPoint
  // POI: radius within which you are "at" it. TERRAIN: nominal size used for spawning.
  radius: number
  // auto = inferred from name/description; designer = set explicitly (future studio field).
  source: 'auto' | 'designer'
}

export interface GeoTravel {
  from: GeoPoint
  to: GeoPoint
  // Waypoints including from and to, with the world minute each one is reached.
  path: Array<GeoPoint & { minute: number }>
  startMinute: number
  arriveMinute: number
  destinationPlaceId: string | null
}

export interface WorldGeo {
  version: 1
  widthMeters: number
  heightMeters: number
  cellMeters: number
  cols: number
  rows: number
  // One terrain code per cell, row-major (see TERRAIN_CODES).
  cells: string
  // Index into regions (TERRAIN kind) that owns each cell, row-major.
  cellRegion: number[]
  regions: GeoRegion[]
  // Last world minute movement/perception was advanced to.
  minute: number
}

export const TERRAIN_CODES: Record<Terrain, string> = { GRASS: 'g', FOREST: 'f', BEACH: 'b', ROCK: 'r', CLIFF: 'c', WATER: 'w', RIVER: 'v', RUINS: 'u', URBAN: 'n' }
export const TERRAIN_BY_CODE: Record<string, Terrain> = Object.fromEntries(Object.entries(TERRAIN_CODES).map(([k, v]) => [v, k as Terrain]))
