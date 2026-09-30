import type { Agent, ChronicleEntry, WorldEvent, WorldState } from '../domain/worldTypes.ts'
import { actionFailure } from './actionNarrative.ts'
import { eventProse } from '../domain/eventProse.ts'

export function toPublicAgent(agent: Agent): Omit<Agent, 'hiddenNotes'> {
  const { hiddenNotes: _hidden, ...publicAgent } = agent
  return { ...publicAgent, dispositions: undefined, motivations: undefined, observedPossessions: undefined, knowledge: [], memories: [], journal: undefined, knownPlaceIds: [], wakeReason: undefined,
    relationships: agent.relationships.map(({ note: _note, ...relationship }) => relationship) }
}

export function toPublicScene(scene: ChronicleEntry, sources: WorldEvent[]): ChronicleEntry {
  return { ...scene, resolvedActionIds: [...new Set([...(scene.resolvedActionIds ?? []), ...sources.filter(e => scene.sourceEventIds.includes(e.id) && e.visibility !== 'private' && e.outcome !== 'REJECTED' && e.actionId && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(e.phase ?? '')).map(e => e.actionId!)])] }
}

export function toPublicEvent(event: WorldEvent): Omit<WorldEvent, 'provenance'> {
  const { provenance: _provenance, attemptedAction: _attempt, ...publicEvent } = event
  const legacyFailure = event.phase === 'FAILED' && !event.actionContext && event.engineVerdict
  const summary = legacyFailure ? `${event.summary.replace('조건 변화로 중단되었다.', '중단되었다.')} ${actionFailure({ approved: false, reasons: [], notes: event.engineVerdict!.split(/,\s*/) })}. 당시 선택의 구체적인 동기는 기록되지 않았다.` : event.summary
  const display = event.cause?.startsWith('scheduled:') ? eventProse(event, new Map()) : summary
  const detail=publicEvent.detail?.adjudication?{...publicEvent.detail,adjudication:{...publicEvent.detail.adjudication,proposal:{...publicEvent.detail.adjudication.proposal,basis:''}}}:publicEvent.detail
  return { ...publicEvent,detail, summary: display, title: event.cause?.startsWith('scheduled:') ? display : publicEvent.title, stateChanges: event.stateChanges.filter(c => !c.field.startsWith('knowledge:')) }
}

export function toPublicWorld(world: WorldState): WorldState {
  const places = world.places.filter(p => p.isDiscovered !== false)
  const visible = new Set(places.map(p => p.id))
  return { ...world, places: places.map(p => ({ ...p, connectedPlaceIds: p.connectedPlaceIds.filter(id => visible.has(id)) })), agents: world.agents.map(toPublicAgent),
    engine: world.engine ? { ...world.engine, decisions: undefined, interactions: undefined, outcomes: undefined, studio: undefined, truths: [], behavior: undefined, combatAlerts: undefined, v4: undefined,
      connections: world.engine.connections.filter(c => visible.has(c.fromPlaceId) && visible.has(c.toPlaceId)).map(c => ({ ...c, requirements: '' })),
      objects: world.engine.objects.filter(o => o.location.kind === 'place' && visible.has(o.location.id)),
      ongoingActions: world.engine.ongoingActions.map(a => ({ ...a, adjudication:undefined, proposal: { actorId: a.proposal.actorId, actionType: a.proposal.actionType,
        locationId: a.proposal.locationId, destinationId: visible.has(a.proposal.destinationId ?? '') ? a.proposal.destinationId : undefined,
          areaHint: a.proposal.areaHint,searchPoint:a.proposal.searchPoint, targetIds: [], intendedAction: '', referencedEventIds: [] } })) } : undefined }
}
