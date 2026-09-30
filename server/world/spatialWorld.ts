import type { Agent, WorldState } from '../domain/worldTypes.ts'
import type { WorldObject, WorldTruth } from './engineTypes.ts'
import type { ProposedAction } from './actionSchema.ts'

export interface Point { x: number; y: number }
export const CONTACT_RADIUS = .12
export const SIGHT_RADIUS = .28
export const HEARING_RADIUS = .48
export const SEARCH_RADIUS = .16
const center: Point = { x: .5, y: .5 }
const clamp = (n: number) => Math.max(0, Math.min(1, n))
export function validPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false
  const p = value as Point
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
}
export function distance(a: Point, b: Point): number { return Math.hypot(a.x-b.x, a.y-b.y) }
export function stablePoint(id: string): Point {
  let h=2166136261
  for(const c of id){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}
  const x=.1+((h>>>0)%801)/1000
  h=Math.imul(h^0x9e3779b9,16777619)
  return {x,y:.1+((h>>>0)%801)/1000}
}
export function agentPoint(agent: Agent): Point { return validPoint(agent.publicState.position) ? agent.publicState.position : center }
export function objectPoint(object: WorldObject): Point { return validPoint(object.position) ? object.position : center }
export function truthPoint(truth: WorldTruth, world: WorldState): Point {
  const item = truth.itemId && world.engine?.objects.find(o => o.id === truth.itemId)
  return item ? objectPoint(item) : validPoint(truth.position) ? truth.position : center
}
export function sameArea(a: Agent, b: Agent): boolean {
  return a.publicState.locationId === b.publicState.locationId && (a.publicState.localArea ?? 'CENTER') === (b.publicState.localArea ?? 'CENTER')
}
export function canSee(world: WorldState, observerId: string, subjectId: string): boolean {
  const a=world.agents.find(x=>x.id===observerId), b=world.agents.find(x=>x.id===subjectId)
  if(!a||!b||!sameArea(a,b)||b.publicState.status==='deceased')return false
  if(world.engine?.ongoingActions.some(t=>t.proposal.actorId===a.id&&t.proposal.actionType==='SLEEP'))return false
  return distance(agentPoint(a),agentPoint(b))<=SIGHT_RADIUS
}
export function canHear(world: WorldState, observerId: string, subjectId: string): boolean {
  const a=world.agents.find(x=>x.id===observerId), b=world.agents.find(x=>x.id===subjectId)
  return !!a&&!!b&&sameArea(a,b)&&distance(agentPoint(a),agentPoint(b))<=HEARING_RADIUS
}
export function searchDestination(world: WorldState, actor: Agent, action: ProposedAction): Point {
  if(validPoint(action.searchPoint))return action.searchPoint
  const area=action.areaHint??actor.publicState.localArea??'CENTER'
  const previous=(world.engine?.outcomes?.[actor.id]??[]).filter(o=>o.actionType==='EXPLORE'&&o.area===area).length
  const route: Point[]=[center,{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8},{x:.5,y:.12},{x:.88,y:.5},{x:.5,y:.88},{x:.12,y:.5}]
  return route[previous%route.length]
}
export function nearSearchPath(origin: Point, end: Point, target: Point): boolean {
  const vx=end.x-origin.x, vy=end.y-origin.y
  const t=clamp((vx*(target.x-origin.x)+vy*(target.y-origin.y))/(vx*vx+vy*vy||1))
  return distance({x:origin.x+t*vx,y:origin.y+t*vy},target)<=SEARCH_RADIUS
}
