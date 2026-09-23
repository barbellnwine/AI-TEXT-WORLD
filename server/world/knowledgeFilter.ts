// CHARACTER KNOWLEDGE filter. This is the single place that decides what one character is
// allowed to see. AGENT PROMPT (server/prompts/agentPrompt.ts) and MEMORY PROMPT
// (server/prompts/memoryPrompt.ts) must build their input exclusively through this function —
// never by reading WorldState/Agent objects directly. This is also where "hiddenNotes" (HIDDEN
// WORLD TRUTH) gets structurally excluded: the return type doesn't have a field for it.
import type { Agent, AgentKnowledgeEntry, Place, Relationship, WorldEvent, WorldState } from '../domain/worldTypes.ts'
import { toPublicEvent } from './publicView.ts'

export interface ObservableAgent {
  id: string
  name: string
  status: Agent['publicState']['status']
  // Only what is visible by standing in the same place — not their inventory, memory, or plans.
}

export interface AgentKnowledgeView {
  self: {
    exposure?: Agent['exposure']; vitals?: Agent['vitals']
    humanState?: Agent['humanState']
    emotion?: Agent['emotion']
    body?: Agent['body']
    memories?: Agent['memories']
    wakeReason?: string
    id: string
    name: string
    status: Agent['publicState']['status']
    locationId: string
    inventory: string[]
    visibleGoal: string | null
  }
  currentPlace: Pick<Place, 'id' | 'name' | 'description' | 'connectedPlaceIds' | 'resources' | 'locked' | 'accessCondition'>
  othersPresent: ObservableAgent[]
  relationships: Relationship[]
  knownFacts: AgentKnowledgeEntry[]
  // Public events this agent was directly involved in or physically present for — never another
  // agent's private memory, and never HIDDEN WORLD TRUTH.
  observedEvents: WorldEvent[]
  visibleObjects?: Array<{ id: string; name: string; quantity: number; condition: string }>
}

export function buildAgentKnowledgeView(agentId: string, worldState: WorldState, allEvents: WorldEvent[]): AgentKnowledgeView | null {
  const self = worldState.agents.find(a => a.id === agentId)
  if (!self) return null
  const currentPlace = worldState.places.find(p => p.id === self.publicState.locationId)
  if (!currentPlace) return null

  const othersPresent: ObservableAgent[] = worldState.agents
    .filter(a => a.id !== agentId && a.publicState.locationId === currentPlace.id && !worldState.engine?.ongoingActions.some(task => task.proposal.actorId === a.id && task.proposal.actionType === 'MOVE'))
    .map(a => ({ id: a.id, name: a.name, status: a.publicState.status }))

  const observedEvents = allEvents.filter(
    event => event.outcome !== 'REJECTED' && (event.visibility !== 'private' || event.agentIds.includes(agentId)) && (event.agentIds.includes(agentId) || event.witnessIds?.includes(agentId) || self.knowledge.some(k => k.sourceEventId === event.id))
  )

  return {
    self: {
      exposure: self.exposure, vitals: self.vitals,
      humanState: self.humanState, emotion: self.emotion, body: self.body, memories: self.memories?.slice(-8), wakeReason: self.wakeReason,
      id: self.id,
      name: self.name,
      status: self.publicState.status,
      locationId: self.publicState.locationId,
      inventory: self.inventory,
      visibleGoal: self.publicState.visibleGoal,
    },
    currentPlace: {
      id: currentPlace.id,
      name: currentPlace.name,
      description: currentPlace.description,
      connectedPlaceIds: currentPlace.connectedPlaceIds.filter(id => !self.knownPlaceIds || self.knownPlaceIds.includes(id)),
      resources: currentPlace.resources,
      locked: currentPlace.locked,
      accessCondition: currentPlace.accessCondition,
    },
    othersPresent,
    relationships: self.relationships,
    knownFacts: self.knowledge,
    observedEvents: observedEvents.map(e => ({ ...toPublicEvent(e), stateChanges: e.stateChanges.filter(c => c.field.startsWith('place:') || c.field.startsWith('object:') || c.field.startsWith(`agent:${agentId}:`) || c.field.endsWith(':location') || c.field.endsWith(':status')) })),
    visibleObjects: worldState.engine?.objects.filter(o => o.location.kind === 'place' && o.location.id === currentPlace.id && o.condition !== 'destroyed').map(o => ({ id: o.id, name: o.name, quantity: o.quantity, condition: o.condition })),
  }
}

// Whether `agentId` may claim to know `factId` (either their own recorded knowledge, or a fact
// sourced from an event they were physically part of). Used by worldValidator for
// UNKNOWN_INFORMATION checks.
export function agentKnowsFact(agentId: string, factId: string, worldState: WorldState, allEvents: WorldEvent[]): boolean {
  const self = worldState.agents.find(a => a.id === agentId)
  if (!self) return false
  if (self.knowledge.some(k => k.id === factId || k.sourceEventId === factId)) return true
  return allEvents.some(event => event.id === factId && event.agentIds.includes(agentId))
}
