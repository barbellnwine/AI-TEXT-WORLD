// AI TEXT WORLD — public API contract types (camelCase JSON, matches server/domain/worldTypes.ts).
// Deliberately has no field for hidden world truths: the API never sends them, so the type
// system here can't accidentally imply the client has access to information a character doesn't.

export type WorldTimeOfDay = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night' | 'lateNight'
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow'
export type DangerLevel = 'stable' | 'tense' | 'unstable' | 'critical'
export type AgentStatus = 'alive' | 'injured' | 'missing' | 'deceased'
export type RelationshipStance = 'ally' | 'friendly' | 'neutral' | 'wary' | 'hostile'
export type SeasonStatus = 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED'
export type Importance = 'low' | 'normal' | 'high' | 'critical'

export type EventType =
  | 'MOVE'
  | 'DIALOGUE'
  | 'DISCOVERY'
  | 'COOPERATION'
  | 'CONFLICT'
  | 'INJURY'
  | 'RELATIONSHIP_CHANGE'
  | 'RESOURCE_CHANGE'
  | 'DECISION'
  | 'OBSERVATION'
  | 'SYSTEM'
  | 'OPERATOR_EVENT'

export interface WorldClock {
  day: number
  time: string
  timeOfDay: WorldTimeOfDay
  weather: Weather
  temperatureC: number
}

export interface Resource {
  key: string
  label: string
  level: number
  max: number
  trend: 'up' | 'down' | 'stable'
  unit?: string
}

export interface Place {
  x?: number
  y?: number
  isDiscovered?: boolean
  id: string
  name: string
  description: string
  connectedPlaceIds: string[]
  currentAgentIds: string[]
  resources: Resource[]
  locked: boolean
  accessCondition?: string
  recentEventIds: string[]
}

export interface Faction {
  id: string
  name: string
  description: string
  memberAgentIds: string[]
  foundedDay: number
}

export interface Relationship {
  agentId: string
  otherAgentId: string
  stance: RelationshipStance
  note?: string
  lastChangedEventId?: string
  lastChangedAt?: string
}

export interface AgentPublicState {
  locationId: string
  status: AgentStatus
  visibleGoal: string | null
  lastAction: string | null
  lastActiveAt: string
}

export interface AgentKnowledgeEntry {
  id: string
  summary: string
  sourceEventId?: string
  learnedAt: string
}

export interface MovementLogEntry {
  placeId: string
  arrivedAt: string
}

export interface Agent {
  humanState?: { survival_need: number; fatigue: number; stress: number; sexual_desire: number; greed: number; ambition: number }
  emotion?: { mood: number; anger: number; fear: number }
  body?: { health: number; injury: number }
  nextDecisionAt?: number
  id: string
  name: string
  codeNumber: string
  avatarId: string
  shortBio: string
  factionIds: string[]
  publicState: AgentPublicState
  relationships: Relationship[]
  inventory: string[]
  knowledge: AgentKnowledgeEntry[]
  movementLog: MovementLogEntry[]
  keyEventIds: string[]
}

export interface StateChange {
  field: string
  from: string
  to: string
}

export interface WorldEvent {
  sequence?: number
  worldMinute?: number
  worldTime?: string
  actionType?: string
  phase?: 'STARTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'STATE_UPDATE'
  id: string
  type: EventType
  occurredAt: string
  day: number
  placeId: string
  agentIds: string[]
  title: string
  summary: string
  stateChanges: StateChange[]
  importance: Importance
  beforeStateSummary?: string
  attemptedAction?: string
  engineVerdict?: string
  afterStateSummary?: string
  relatedEventIds: string[]
  publicQuote?: string
  operator?: { addedBy: string; addedAt: string }
}

// A day/story-level grouping of ChronicleEntry scenes — the coarsest reading unit ("지난 이야기").
export interface Chapter {
  status?: 'IN_PROGRESS' | 'COMPLETED'
  number?: number
  sceneId?: string
  id: string
  day: number
  title: string
  summary: string
  agentIds: string[]
  changes: string[]
  eventIds: string[]
}

export type SceneImportance = 'ordinary' | 'notable' | 'major'

// A NARRATOR-produced scene: several WorldEvents folded into one readable passage. This is what
// the main reading page renders — never a raw WorldEvent.
export interface ChronicleEntry {
  id: string
  seasonId: string
  worldDay: number
  timeStart: string
  timeEnd: string
  title: string
  body: string
  locationIds: string[]
  agentIds: string[]
  sourceEventIds: string[]
  stateChanges: StateChange[]
  importance: SceneImportance
  createdAt: string
  operator?: { addedBy: string; addedAt: string }
}

export interface WorldState {
  engine?: {
    minute: number
    connections: Array<{ fromPlaceId: string; toPlaceId: string; travelMinutes: number; blocked: boolean }>
    ongoingActions: Array<{ id: string; startedMinute: number; completesMinute: number; proposal: { actorId: string; actionType: string; locationId: string; destinationId?: string } }>
  }
  seasonId: string
  clock: WorldClock
  dangerLevel: DangerLevel
  places: Place[]
  agents: Agent[]
  factions: Faction[]
  activeEventIds: string[]
  updatedAt: string
}

export interface Season {
  id: string
  name: string
  premise: string
  status: SeasonStatus
  startedAt: string | null
  endedAt: string | null
  currentDay: number
  agentCount: number
  survivorCount: number
  biggestEventTitle?: string
  finalStateSummary?: string
  seasonSummary?: string
}

export interface ProviderUsage {
  provider: string
  calls: number
  estTokens: number
  estCostUsd: number
}

export interface RuntimeError {
  id: string
  occurredAt: string
  scope: string
  message: string
}

export interface OperatorLogEntry {
  id: string
  addedBy: string
  addedAt: string
  eventId: string
  summary: string
}

export interface PublicWorldRuntime {
  connected: boolean
  status: SeasonStatus
  paused: boolean
  lastTickAt: string | null
  nextTickAt: string | null
}

export interface AdminWorldRuntime extends PublicWorldRuntime {
  decisionsPaused?: boolean
  decisionStatus?: string
  maxActiveCharacters?: number
  worldMinutesPerTick?: number
  mode?: 'preview' | 'demo' | 'live'
  tickIntervalMs: number
  maxActiveAgents: number
  callBudget: number
  callsUsed: number
  providerUsage: ProviderUsage[]
  lockHolder: string | null
  lockExpiresAt: string | null
  queuedEvents: number
  failedJobs: number
  retryCount: number
  agentLastCallAt: Record<string, string>
  recentErrors: RuntimeError[]
  operatorLog: OperatorLogEntry[]
}

export interface CurrentWorldResponse {
  season: Season
  worldState: WorldState
  spotlightEvent: WorldEvent | null
}

export interface EventListResponse {
  items: WorldEvent[]
  total: number
  hasMore: boolean
}

export interface SceneListResponse {
  items: ChronicleEntry[]
  hasMore: boolean
  totalDays: number
}
