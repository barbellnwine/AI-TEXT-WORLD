// CHARACTER KNOWLEDGE filter. This is the single place that decides what one character is
// allowed to see. AGENT PROMPT (server/prompts/agentPrompt.ts) and MEMORY PROMPT
// (server/prompts/memoryPrompt.ts) must build their input exclusively through this function —
// never by reading WorldState/Agent objects directly. This is also where "hiddenNotes" (HIDDEN
// WORLD TRUTH) gets structurally excluded: the return type doesn't have a field for it.
import type { Agent, AgentKnowledgeEntry, Place, Relationship, WorldEvent, WorldState } from '../domain/worldTypes.ts'

export interface ObservableAgent {
  id: string
  name: string
  status: Agent['publicState']['status']
  // Only what is visible by standing in the same place — not their inventory, memory, or plans.
}

export interface AgentKnowledgeView {
  self: {
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
}

export function buildAgentKnowledgeView(agentId: string, worldState: WorldState, allEvents: WorldEvent[]): AgentKnowledgeView | null {
  const self = worldState.agents.find(a => a.id === agentId)
  if (!self) return null
  const currentPlace = worldState.places.find(p => p.id === self.publicState.locationId)
  if (!currentPlace) return null

  const othersPresent: ObservableAgent[] = worldState.agents
    .filter(a => a.id !== agentId && a.publicState.locationId === currentPlace.id)
    .map(a => ({ id: a.id, name: a.name, status: a.publicState.status }))

  const observedEvents = allEvents.filter(
    event => event.agentIds.includes(agentId) || (event.placeId === currentPlace.id && event.agentIds.length === 0)
  )

  return {
    self: {
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
      connectedPlaceIds: currentPlace.connectedPlaceIds,
      resources: currentPlace.resources,
      locked: currentPlace.locked,
      accessCondition: currentPlace.accessCondition,
    },
    othersPresent,
    relationships: self.relationships,
    knownFacts: self.knowledge,
    observedEvents,
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
