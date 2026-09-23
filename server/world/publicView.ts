import type { Agent, WorldEvent, WorldState } from '../domain/worldTypes.ts'

export function toPublicAgent(agent: Agent): Omit<Agent, 'hiddenNotes'> {
  const { hiddenNotes: _hidden, ...publicAgent } = agent
  return { ...publicAgent, knowledge: [], memories: [], knownPlaceIds: [], wakeReason: undefined,
    relationships: agent.relationships.map(({ note: _note, ...relationship }) => relationship) }
}

export function toPublicEvent(event: WorldEvent): Omit<WorldEvent, 'provenance'> {
  const { provenance: _provenance, attemptedAction: _attempt, ...publicEvent } = event
  return { ...publicEvent, stateChanges: event.stateChanges.filter(c => !c.field.startsWith('knowledge:')) }
}

export function toPublicWorld(world: WorldState): WorldState {
  const places = world.places.filter(p => p.isDiscovered !== false)
  const visible = new Set(places.map(p => p.id))
  return { ...world, places: places.map(p => ({ ...p, connectedPlaceIds: p.connectedPlaceIds.filter(id => visible.has(id)) })), agents: world.agents.map(toPublicAgent),
    engine: world.engine ? { ...world.engine, studio: undefined, truths: [],
      connections: world.engine.connections.filter(c => visible.has(c.fromPlaceId) && visible.has(c.toPlaceId)).map(c => ({ ...c, requirements: '' })),
      objects: world.engine.objects.filter(o => o.location.kind === 'place' && visible.has(o.location.id)),
      ongoingActions: world.engine.ongoingActions.map(a => ({ ...a, proposal: { actorId: a.proposal.actorId, actionType: a.proposal.actionType,
        locationId: a.proposal.locationId, destinationId: visible.has(a.proposal.destinationId ?? '') ? a.proposal.destinationId : undefined,
        targetIds: [], intendedAction: '', referencedEventIds: [] } })) } : undefined }
}
