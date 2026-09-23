// Applies a confirmed StateChange to a WorldState in place. This is the only function allowed to
// mutate WorldState from a change record — worldStore.ts calls this instead of touching fields
// directly, so a real simulation engine can reuse the exact same transition logic later.
import type { Agent, StateChange, WorldState } from '../domain/worldTypes.ts'

export function applyStateChange(worldState: WorldState, change: StateChange): void {
  const [kind, ...rest] = change.field.split(':')

  if (kind === 'place' && rest.length === 2) {
    const [placeId, resourceKey] = rest
    const place = worldState.places.find(p => p.id === placeId)
    const resource = place?.resources.find(r => r.key === resourceKey)
    if (resource) {
      const numeric = Number(change.to)
      if (Number.isFinite(numeric) && numeric >= 0 && numeric <= resource.max) {
        resource.trend = numeric < resource.level ? 'down' : numeric > resource.level ? 'up' : 'stable'
        resource.level = numeric
      }
    }
    if (resourceKey === 'locked' && place) place.locked = change.to === 'true'
    return
  }

  if (kind === 'agent' && rest.length === 2) {
    const [agentId, prop] = rest
    const agentRecord = worldState.agents.find(a => a.id === agentId)
    if (!agentRecord) return
    if (prop === 'status' && agentRecord.publicState.status !== 'deceased' && ['alive', 'injured', 'missing', 'deceased'].includes(change.to)) agentRecord.publicState.status = change.to as Agent['publicState']['status']
    if (prop === 'location') {
      if (agentRecord.publicState.status === 'deceased' || !worldState.places.some(p => p.id === change.to)) return
      agentRecord.publicState.locationId = change.to
      // A move to a different place leaves any prior sub-area behind — the new area is
      // unspecified until the next action names one.
      agentRecord.publicState.localArea = undefined
      for (const place of worldState.places) {
        place.currentAgentIds = place.currentAgentIds.filter(id => id !== agentId)
        if (place.id === change.to) place.currentAgentIds.push(agentId)
      }
      agentRecord.movementLog.push({ placeId: change.to, arrivedAt: new Date().toISOString() })
      agentRecord.movementLog = agentRecord.movementLog.slice(-100)
    }
    return
  }

  if (kind === 'object' && rest.at(-1) === 'holder') {
    const item = rest.slice(0, -1).join(':')
    const from = worldState.agents.find(a => a.id === change.from)
    const to = worldState.agents.find(a => a.id === change.to)
    if (from?.inventory.includes(item) && to && !to.inventory.includes(item)) {
      from.inventory = from.inventory.filter(id => id !== item)
      to.inventory.push(item)
    }
    return
  }

  if (kind === 'world' && rest[0] === 'dangerLevel') {
    worldState.dangerLevel = change.to as WorldState['dangerLevel']
  }
}

export function applyStateChanges(worldState: WorldState, changes: StateChange[]): void {
  for (const change of changes) applyStateChange(worldState, change)
}
