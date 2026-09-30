import {accessibleObject} from './physicalActions.ts'
import { inContact } from './interactions.ts'
// CHARACTER KNOWLEDGE filter. This is the single place that decides what one character is
// allowed to see. AGENT PROMPT (server/prompts/agentPrompt.ts) and MEMORY PROMPT
// (server/prompts/memoryPrompt.ts) must build their input exclusively through this function —
// never by reading WorldState/Agent objects directly. This is also where "hiddenNotes" (HIDDEN
// WORLD TRUTH) gets structurally excluded: the return type doesn't have a field for it.
import type { Agent, AgentKnowledgeEntry, Place, Relationship, WorldEvent, WorldState } from '../domain/worldTypes.ts'
import { toPublicEvent } from './publicView.ts'
import { combatOpportunity } from './combatOpportunity.ts'
import {agentPoint,canSee,distance} from './spatialWorld.ts'

export interface ObservableAgent {
  position?: {x:number;y:number}
  distance?:number
  canContact?:boolean
  age?:number|null
  combatCue?: string
  localArea?: string
  id: string
  name: string
  status: Agent['publicState']['status']
  // Only what is visible by standing in the same place — not their inventory, memory, or plans.
}

export interface AgentKnowledgeView {
  failedEventIds?: string[]
  decisionEvidence?: Array<{eventId:string;minute:number;phase?:WorldEvent['phase'];actorId:string;actionType?:string;result?:string;quote?:string;changes:WorldEvent['stateChanges'];combat?:{attackerId:string;targetId:string;outcome:string;damage:number;reaction:string}}>

  observedPossessions?: Agent['observedPossessions']
  observedObjects?: Agent['observedObjects']
  threats?: Array<{ actorId: string; completesMinute: number }>

  self: {
    trauma?:import('./trauma.ts').TraumaState
    age?:number|null
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
    localArea?: string
    position?: {x:number;y:number}
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
  visibleObjects?: Array<{ id: string; name: string; quantity: number; condition: string; physical?:import('./engineTypes.ts').PhysicalProperties; localArea?:string }>
}

export function buildAgentKnowledgeView(agentId: string, worldState: WorldState, allEvents: WorldEvent[]): AgentKnowledgeView | null {
  const self = worldState.agents.find(a => a.id === agentId)
  if (!self) return null
  const currentPlace = worldState.places.find(p => p.id === self.publicState.locationId)
  if (!currentPlace) return null

  const othersPresent: ObservableAgent[] = worldState.agents
    .filter(a => a.id !== agentId && canSee(worldState,agentId,a.id) && a.publicState.locationId === currentPlace.id && !worldState.engine?.ongoingActions.some(task => task.proposal.actorId === a.id && task.proposal.actionType === 'MOVE'))
    .map(a => ({ age:a.age??null, id: a.id, name: a.name, status: a.publicState.status, localArea: a.publicState.localArea ?? 'CENTER',position:{...agentPoint(a)},distance:distance(agentPoint(self),agentPoint(a)),canContact:inContact(worldState,agentId,a.id), combatCue: worldState.engine&&inContact(worldState,agentId,a.id) ? combatOpportunity(worldState, a, false).cue : undefined }))

  const observedEvents = allEvents.filter(
    event => event.phase !== 'STARTED' && !(event.visibility === 'private' && event.phase === 'STATE_UPDATE' && !event.agentIds.includes(agentId)) && event.outcome !== 'REJECTED' && (event.visibility !== 'private' || event.agentIds.includes(agentId)) && (event.agentIds.includes(agentId) || event.witnessIds?.includes(agentId) || event.perceptions?.some(p=>p.agentId===agentId&&p.sense==='hearing') || self.knowledge.some(k => k.sourceEventId === event.id))
  )

  return {
    failedEventIds:worldState.engine?.outcomes?.[agentId]?.filter(o=>o.failed).slice(-4).map(o=>o.eventId),
    observedPossessions: self.observedPossessions,
    observedObjects: self.observedObjects?.filter(o=>o.placeId!==currentPlace.id||o.localArea!==(self.publicState.localArea??'CENTER')).slice(-20),
    threats: worldState.engine?.ongoingActions.filter(t => ['ATTACK','ROB'].includes(t.proposal.actionType) && t.proposal.targetIds.includes(agentId) && inContact(worldState, agentId, t.proposal.actorId)).map(t => ({ actorId: t.proposal.actorId, completesMinute: t.completesMinute })),
    self: {
      age:self.age??null,
      exposure: self.exposure, vitals: self.vitals,
      trauma:self.trauma?{...self.trauma,injuries:self.trauma.injuries.filter(w=>!w.healed)}:undefined,
      humanState: self.humanState, emotion: self.emotion, body: self.body, memories: self.memories?.slice(-8), wakeReason: self.wakeReason,
      id: self.id,
      name: self.name,
      status: self.publicState.status,
      locationId: self.publicState.locationId,
      localArea: self.publicState.localArea ?? 'CENTER',
      position:{...agentPoint(self)},
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
    observedEvents: observedEvents.map(e => {
      if(e.perceptions?.some(p=>p.agentId===agentId&&p.sense==='hearing')&&!e.agentIds.includes(agentId)&&!e.witnessIds?.includes(agentId))return {...toPublicEvent(e),agentIds:[],witnessIds:[],perceptions:e.perceptions.filter(p=>p.agentId===agentId),actionType:undefined,cause:'heard_event',relatedEventIds:[],summary:e.type==='CONFLICT'?'가까운 곳에서 충돌 소리가 들렸다.':'가까운 곳에서 사람의 움직임이나 말소리가 들렸다.',title:'소리로 감지한 사건',actionResult:undefined,actionMotive:undefined,publicQuote:undefined,detail:undefined,stateChanges:[]}
      return { ...toPublicEvent(e), stateChanges: e.stateChanges.filter(c => c.field.startsWith('place:') || c.field.startsWith('object:') || c.field.startsWith(`agent:${agentId}:`) || c.field.startsWith(`relationship:${agentId}:`) || c.field.startsWith('interaction:') && c.field.endsWith(':status') || c.field.endsWith(':location') || c.field.endsWith(':status')) }
    }),
    visibleObjects: worldState.engine?.objects.filter(o => o.location.kind === 'place' && accessibleObject(worldState,self,o)).map(o => ({ id: o.id, name: o.name, quantity: o.quantity, condition: o.condition,physical:o.physical,localArea:o.localArea })),
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
