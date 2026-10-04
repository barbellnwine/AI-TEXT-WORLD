// Perception in meters. Two people notice each other by real distance, terrain, light and
// weather — never because they share a place name.
import type { Agent, WorldState } from '../../domain/worldTypes.ts'
import type { GeoPoint, Terrain, WorldGeo } from './geoTypes.ts'
import { dist, terrainAt } from './geoBuild.ts'

export const BASE_SIGHT_METERS = 80
export const QUIET_HEARING_METERS = 30
export const LOUD_HEARING_METERS = 120
// Close enough to talk, hand things over or strike.
export const CONTACT_METERS = 6

const TERRAIN_SIGHT: Record<Terrain, number> = { GRASS: 1, FOREST: 0.45, BEACH: 1.15, ROCK: 1.25, CANYON: 0.5, CLIFF: 1.4, WATER: 1.2, RIVER: 1, RUINS: 0.7, URBAN: 0.6 }
// How well the terrain around a target hides them from someone looking in.
const TERRAIN_COVER: Record<Terrain, number> = { GRASS: 1, FOREST: 0.7, BEACH: 1, ROCK: 0.85, CANYON: 0.65, CLIFF: 0.9, WATER: 1, RIVER: 1, RUINS: 0.75, URBAN: 0.8 }

export function sightRange(world: WorldState, geo: WorldGeo, at: GeoPoint): number {
  const light = { lateNight: 0.4, night: 0.4, dawn: 0.75, evening: 0.75, morning: 1, afternoon: 1 }[world.clock.timeOfDay] ?? 1
  const weather = { fog: 0.45, storm: 0.5, blizzard: 0.4, rain: 0.75, snow: 0.75, wind: 0.95, cloudy: 0.95, clear: 1 }[world.clock.weather] ?? 1
  return BASE_SIGHT_METERS * TERRAIN_SIGHT[terrainAt(geo, at)] * light * weather
}

export type Sense = 'sight' | 'hearing'
export function perceive(world: WorldState, geo: WorldGeo, observer: Agent, subject: Agent): Sense | null {
  const a = observer.publicState.coord, b = subject.publicState.coord
  if (!a || !b || observer.id === subject.id || subject.publicState.status === 'deceased' || observer.publicState.status === 'deceased') return null
  const d = dist(a, b)
  if (d <= sightRange(world, geo, a) * TERRAIN_COVER[terrainAt(geo, b)]) return 'sight'
  if (d <= QUIET_HEARING_METERS) return 'hearing'
  return null
}

// Either one noticing the other is enough for them to share a scene.
export function aware(world: WorldState, geo: WorldGeo, a: Agent, b: Agent): Sense | null {
  return perceive(world, geo, a, b) ?? perceive(world, geo, b, a)
}

const DIRECTIONS = ['동', '남동', '남', '남서', '서', '북서', '북', '북동']
// Compass direction from a to b (map y grows southward).
export function direction(a: GeoPoint, b: GeoPoint): string {
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  return DIRECTIONS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8]
}
