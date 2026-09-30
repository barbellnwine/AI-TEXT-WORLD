// Advances continuous space for v4 each tick: travelers move along their paths and anyone who
// comes into perception range mid-route becomes a pending encounter for the spotlight.
import type { WorldState } from '../../domain/worldTypes.ts'
import type { WorldExecution } from '../../domain/worldAgent.ts'
import type { V4State } from './sceneTypes.ts'
import { ensureGeo } from '../geo/geoBuild.ts'
import { advanceMovement, type Encounter } from '../geo/movement.ts'
import { direction } from '../geo/perception.ts'
import { dist } from '../geo/geoBuild.ts'

export function advanceSpace(world: WorldState, execution: WorldExecution, v4: V4State): Encounter[] {
  const geo = ensureGeo(world, execution.draft)
  const encounters = advanceMovement(world, geo, world.engine!.minute)
  v4.encounters = [...(v4.encounters ?? []), ...encounters.map(e => ({ ids: [...e.ids], minute: e.minute, sense: e.sense }))].slice(-20)
  for (const e of encounters) {
    const [a, b] = e.ids.map(id => world.agents.find(x => x.id === id)!)
    for (const [self, other] of [[a, b], [b, a]] as const) {
      const d = Math.round(dist(self.publicState.coord!, other.publicState.coord!))
      const how = e.sense === 'sight' ? `${direction(self.publicState.coord!, other.publicState.coord!)}쪽 ${d}m 거리에 ${other.name}이(가) 보였다` : `가까운 곳(${d}m)에서 누군가의 인기척이 들렸다`
      self.journal = [...(self.journal ?? []), { minute: e.minute, text: `이동하다 멈췄다. ${how}.` }].slice(-60)
    }
  }
  return encounters
}
