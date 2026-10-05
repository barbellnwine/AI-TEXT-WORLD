// What the map shows about a fight, derived from what the engine already recorded — never from a
// new judgement of its own. A scene counts as combat because the engine raised someone's damage or
// wrote their death into the scene's state changes; the weapon is read from the scene's own words,
// because a firearm exists in this world only if the engine put one into that scene.
import type { Agent, ChronicleEntry, WorldState } from './types'

// Simulation metres, and the map's own regions — reached through the client's WorldState rather
// than by importing server code, which never belongs in this bundle.
export interface MapPoint { x: number; y: number }
type MapGeo = NonNullable<NonNullable<WorldState['engine']>['geo']>

export type CombatMarkKind = 'gunfire' | 'melee'
export interface CombatMark { sceneId: string; kind: CombatMarkKind; coord: MapPoint; agentIds: string[] }

const HURT = /^agent:[^:]+:health$/
const STATUS = /^agent:[^:]+:status$/

// server/world/v4/mortality.ts writes exactly these two records, and nothing else does.
export function sceneHasCombat(scene: Pick<ChronicleEntry, 'stateChanges'>): boolean {
  return (scene.stateChanges ?? []).some(c =>
    HURT.test(c.field) && Number(c.to) > Number(c.from) || STATUS.test(c.field) && c.to === 'deceased')
}

// The firearm words the engine itself knows (the MANUFACTURED list in server/world/v4/sceneApply.ts)
// plus the act of firing one. Only ever consulted for a scene already established as a fight, so a
// stray match cannot invent a battle — at worst it draws a gun where a blade was swung.
const FIREARM = ['총', '권총', '소총', '엽총', '산탄', '총알', '탄창', '총성', '총구', '방아쇠', '발포', '사격']

export function usedFirearm(scene: Pick<ChronicleEntry, 'title' | 'body'>): boolean {
  const text = `${scene.title ?? ''} ${scene.body ?? ''}`
  return FIREARM.some(word => text.includes(word))
}

// Where the fight happened: the middle of the people the scene was about. Their own coordinates are
// the only record of the spot, so a scene whose cast has no coordinate falls back to the centre of
// the region it names, and a scene with neither is simply not marked.
export function combatMark(scene: ChronicleEntry, agents: Agent[], geo?: MapGeo): CombatMark | null {
  if (!sceneHasCombat(scene)) return null
  const cast = agents.filter(a => scene.agentIds.includes(a.id) && a.publicState.coord)
  const region = geo?.regions.find(r => scene.locationIds.includes(r.placeId))
  const coord = cast.length
    ? { x: cast.reduce((n, a) => n + a.publicState.coord!.x, 0) / cast.length, y: cast.reduce((n, a) => n + a.publicState.coord!.y, 0) / cast.length }
    : region?.center
  if (!coord) return null
  return { sceneId: scene.id, kind: usedFirearm(scene) ? 'gunfire' : 'melee', coord, agentIds: cast.map(a => a.id) }
}
