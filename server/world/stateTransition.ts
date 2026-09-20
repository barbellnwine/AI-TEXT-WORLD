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
      const numeric = Number.parseFloat(change.to)
      if (Number.isFinite(numeric)) {
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
    if (prop === 'status') agentRecord.publicState.status = change.to as Agent['publicState']['status']
    if (prop === 'location') agentRecord.publicState.locationId = change.to
    return
  }

  if (kind === 'world' && rest[0] === 'dangerLevel') {
    worldState.dangerLevel = change.to as WorldState['dangerLevel']
  }
}

export function applyStateChanges(worldState: WorldState, changes: StateChange[]): void {
  for (const change of changes) applyStateChange(worldState, change)
}
