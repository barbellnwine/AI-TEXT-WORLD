import type { Agent, StateChange, WorldState } from '../../domain/worldTypes.ts'

// Damage burden is 0 (unhurt) … 10 (dead), the same scale v3 uses for body.health.
export const LETHAL_BURDEN = 10

export function killAgent(world: WorldState, agent: Agent, changes: StateChange[]): void {
  if (agent.publicState.status === 'deceased') return
  changes.push({ field: `agent:${agent.id}:status`, from: agent.publicState.status, to: 'deceased' })
  agent.publicState.status = 'deceased'
  agent.body = { health: LETHAL_BURDEN, injury: LETHAL_BURDEN }
  agent.nextDecisionAt = Number.MAX_SAFE_INTEGER
  // The body's possessions stay where they fell, for anyone to take.
  for (const obj of world.engine!.objects.filter(x => x.location.kind === 'agent' && x.location.id === agent.id)) {
    obj.location = { kind: 'place', id: agent.publicState.locationId }
    changes.push({ field: `object:${obj.id}:holder`, from: agent.id, to: `place:${agent.publicState.locationId}` })
  }
  agent.inventory = []
}

// Adds damage; reaching the lethal burden kills. Returns true if this killed the agent.
export function hurtAgent(world: WorldState, agent: Agent, amount: number, changes: StateChange[]): boolean {
  if (agent.publicState.status === 'deceased') return false
  agent.body ??= { health: 1, injury: 1 }
  const before = agent.body.health
  agent.body.health = Math.min(LETHAL_BURDEN, before + amount)
  agent.body.injury = agent.body.health
  changes.push({ field: `agent:${agent.id}:health`, from: String(before), to: String(agent.body.health) })
  if (agent.body.health >= LETHAL_BURDEN) { killAgent(world, agent, changes); return true }
  if (agent.body.health >= 4 && agent.publicState.status === 'alive') { agent.publicState.status = 'injured'; changes.push({ field: `agent:${agent.id}:status`, from: 'alive', to: 'injured' }) }
  return false
}
