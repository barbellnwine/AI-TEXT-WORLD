// v4 PURSUIT — when one side runs, the world decides whether they get away, not the story.
// A flight is never an exit from a fight: the other side chooses to chase or to let go, and a
// chase is settled on real ground — head start, run speed after injury, fatigue and thirst,
// terrain, concealment, light — so a badly hurt person cannot outrun a healthy one across open
// sand. Whoever is caught is back in the same fight, which is where the next scene picks up.
import type { Agent, StateChange, WorldState } from '../../domain/worldTypes.ts'
import type { GeoPoint, WorldGeo } from '../geo/geoTypes.ts'
import { clampToWorld, dist, terrainAt } from '../geo/geoBuild.ts'
import { TERRAIN_SPEED, WALK_METERS_PER_MINUTE } from '../geo/movement.ts'
import { CONTACT_METERS, sightRange } from '../geo/perception.ts'
import { TERRAIN_NAMES } from './scenePrompts.ts'

// Nobody sprints for long. Eight minutes of flat-out running decides it one way or the other.
export const CHASE_MINUTES = 8
const SPRINT = 2.2
const STEP = 0.25
// Terrain you can lose someone in, as opposed to terrain you are merely slow on.
const CONCEALING = new Set(['FOREST', 'RUINS', 'URBAN', 'CANYON'])
// Close enough to physically get in a chaser's way — and it takes a reason, not just proximity.
const INTERFERE_METERS = 40

export type ChaseStatus = 'caught' | 'escaped' | 'chasing'
export interface ChaseOutcome { status: ChaseStatus; fleerId: string; pursuerId: string; gap: number; minutes: number; text: string }

// Metres per minute at a dead run, after what the body and the ground take away.
export function runSpeed(geo: WorldGeo, agent: Agent): number {
  const ground = TERRAIN_SPEED[terrainAt(geo, agent.publicState.coord!)] || 0.3
  const burden = agent.body?.health ?? 0, fatigue = agent.humanState?.fatigue ?? 0, thirst = agent.vitals?.thirst ?? 0
  const condition = Math.max(0.15, 1 - burden * 0.08 - fatigue * 0.03 - thirst * 0.02)
  return WALK_METERS_PER_MINUTE * SPRINT * ground * condition
}

// Pushes a point away from `from` by `meters`, staying on land and inside the map.
function flee(geo: WorldGeo, at: GeoPoint, from: GeoPoint, meters: number): GeoPoint {
  const span = Math.max(1, dist(at, from))
  const unit = { x: (at.x - from.x) / span, y: (at.y - from.y) / span }
  for (let reach = meters; reach > 0; reach -= Math.max(10, meters / 8)) {
    const point = clampToWorld(geo, { x: Math.round(at.x + unit.x * reach), y: Math.round(at.y + unit.y * reach) })
    if (terrainAt(geo, point) !== 'WATER') return point
  }
  return { ...at }
}

function moveTo(agent: Agent, point: GeoPoint, changes: StateChange[]): void {
  const before = agent.publicState.coord!
  if (before.x === point.x && before.y === point.y) return
  agent.publicState.coord = point
  // A sprint cancels whatever trip they were on; they are running, not travelling.
  agent.publicState.travel = undefined
  changes.push({ field: `agent:${agent.id}:coord`, from: `${before.x},${before.y}`, to: `${point.x},${point.y}` })
}

// Resolves one flight: caught, still being run down, or gone. Letting someone go is the one way
// running away ends an encounter — and even then the runner really leaves, rather than standing
// in front of the person they just fled. Returns null only when there is nobody to flee from.
export function resolveChase(world: WorldState, geo: WorldGeo, fleer: Agent, pursuers: Agent[], changes: StateChange[]): ChaseOutcome | null {
  if (!fleer.publicState.coord) return null
  const nearest = (people: Agent[]) => [...people].sort((a, b) => dist(a.publicState.coord!, fleer.publicState.coord!) - dist(b.publicState.coord!, fleer.publicState.coord!))[0]
  const living = (a: Agent) => a.id !== fleer.id && a.publicState.status !== 'deceased' && a.publicState.coord
  const chaser = nearest(pursuers.filter(living))
  if (!chaser) {
    // Nobody followed. The runner still spends the same sprint putting distance behind them.
    const left = nearest(world.agents.filter(living))
    if (!left) return null
    const ran = Math.round(runSpeed(geo, fleer) * CHASE_MINUTES)
    moveTo(fleer, flee(geo, fleer.publicState.coord, left.publicState.coord!, ran), changes)
    const text = `아무도 뒤를 쫓지 않았고, ${fleer.name}은(는) 그대로 ${ran}m를 벗어났다.`
    fleer.journal = [...(fleer.journal ?? []), { minute: world.engine!.minute, text }].slice(-60)
    return { status: 'escaped', fleerId: fleer.id, pursuerId: left.id, gap: ran, minutes: CHASE_MINUTES, text }
  }
  const start = fleer.publicState.coord, head = dist(start, chaser.publicState.coord!)
  const fleerSpeed = runSpeed(geo, fleer), chaserSpeed = runSpeed(geo, chaser)
  const gapAt = (minutes: number) => head + (fleerSpeed - chaserSpeed) * minutes
  let minutes = CHASE_MINUTES, status: ChaseStatus = 'chasing'
  for (let t = STEP; t <= CHASE_MINUTES + 0.001; t += STEP) if (gapAt(t) <= CONTACT_METERS) { minutes = t; status = 'caught'; break }
  const gap = Math.max(0, gapAt(minutes))
  const ran = Math.round(fleerSpeed * minutes)
  const fleerPoint = flee(geo, start, chaser.publicState.coord!, ran)
  const terrain = terrainAt(geo, fleerPoint)
  const hidden = CONCEALING.has(terrain)
  // A third party only breaks a pursuit when they have a reason to: someone hostile to the chaser,
  // standing close enough to put themselves in the way. Bystanders do not rescue anyone.
  const interloper = world.agents.find(a => a.id !== fleer.id && a.id !== chaser.id && a.publicState.status !== 'deceased'
    && a.publicState.coord && dist(a.publicState.coord, chaser.publicState.coord!) <= INTERFERE_METERS
    && a.relationships.some(r => r.otherAgentId === chaser.id && r.stance === 'hostile'))
  const vanishAt = sightRange(world, geo, fleerPoint) * (hidden ? 0.7 : 1)
  let text: string
  if (status === 'caught' && interloper) {
    status = 'escaped'
    text = `${interloper.name}이(가) 사이에 끼어들며 추격이 끊겼고, ${fleer.name}은(는) 그 틈에 ${ran}m를 벗어났다.`
  } else if (status === 'caught') {
    text = `${chaser.name}은(는) ${Math.max(1, Math.round(minutes))}분을 쫓아 ${ran}m 만에 ${fleer.name}을(를) 따라잡았다.`
      + (fleerSpeed < chaserSpeed ? ` 성한 몸을 두고 달아날 수는 없었다.` : '')
  } else if (gap > vanishAt) {
    status = 'escaped'
    text = `${fleer.name}은(는) ${Math.round(gap)}m를 벌려 ${hidden ? `${TERRAIN_NAMES[terrain]} 속으로 ` : ''}${chaser.name}의 시야에서 사라졌다.`
  } else {
    text = `${fleer.name}은(는) ${ran}m를 달아났지만 ${Math.round(gap)}m 뒤에서 ${chaser.name}이(가) 아직 따라오고 있다.`
  }
  moveTo(fleer, fleerPoint, changes)
  // The chaser ends the sprint where their own legs carried them along the same line.
  moveTo(chaser, flee(geo, start, chaser.publicState.coord!, Math.max(0, Math.round(chaserSpeed * minutes - head))), changes)
  for (const [self, other] of [[fleer, chaser], [chaser, fleer]] as const)
    self.journal = [...(self.journal ?? []), { minute: world.engine!.minute, text: `${text} (상대: ${other.name})`.slice(0, 240) }].slice(-60)
  return { status, fleerId: fleer.id, pursuerId: chaser.id, gap: Math.round(gap), minutes: Math.round(minutes), text }
}
