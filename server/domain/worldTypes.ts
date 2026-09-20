// AI TEXT WORLD — server-side domain types.
// These mirror the public API contract (camelCase JSON) that src/world/types.ts also declares.
// Server and client intentionally keep separate copies (same convention as ai-community's
// server/domain/types.ts vs src/ai-community/types.ts) since they build under different tsconfigs.

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
  // Never serialized to any API response — demonstrates the hidden-truth/known-info split.
  hiddenNotes?: string
}

export interface StateChange {
  field: string
  from: string
  to: string
}

export interface WorldEvent {
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
  // CONFIRMED unless set — a REJECTED entry is a failed action that WORLD ENGINE still logged
  // (see server/world/actionResolver.ts). Never shown in the public reading feed by default;
  // exists for operator verification only.
  outcome?: 'CONFIRMED' | 'REJECTED'
  provenance?: ModelCallProvenance
}

// Per-call bookkeeping for a future real AGENT/GM/NARRATOR call. Never sent to the public API —
// see server/api/worldRoutes.ts, which strips this field before responding.
export interface ModelCallProvenance {
  provider?: string
  model?: string
  promptVersionId?: string
  inputDataVersion?: string
  calledAt?: string
  validation?: { approved: boolean; reasons: string[] }
  rejectedReason?: string
}

// A day/story-level grouping of ChronicleEntry scenes — the coarsest reading unit.
export interface Chapter {
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
// the main reading page renders — never a raw WorldEvent. See server/domain/narrator.ts for the
// (currently mock) adapter that produces these.
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

export interface WorldRuntime {
  connected: boolean
  status: SeasonStatus
  paused: boolean
  tickIntervalMs: number
  maxActiveAgents: number
  callBudget: number
  callsUsed: number
  providerUsage: ProviderUsage[]
  lastTickAt: string | null
  nextTickAt: string | null
  lockHolder: string | null
  lockExpiresAt: string | null
  queuedEvents: number
  failedJobs: number
  retryCount: number
  agentLastCallAt: Record<string, string>
  recentErrors: RuntimeError[]
  operatorLog: OperatorLogEntry[]
}
