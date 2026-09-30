// Shape of what an AGENT (or GM) may ever propose. Proposing is not deciding: nothing here
// touches WorldState directly. Only worldValidator.ts + actionResolver.ts may do that, and only
// after every check in worldValidator.ts passes. This file has no dependency on any LLM SDK.

// A generic set of sub-areas any single place can contain (a "place" can be a whole 2km island —
// this lets an agent's position on the map move within it without needing a separate place per
// spot). Deliberately setting-agnostic so it applies to an island, a building, a forest, etc.
export const LOCAL_AREAS = ['SHORE', 'FOREST', 'HIGH_GROUND', 'CAVE', 'WATER', 'CAMP', 'CENTER'] as const
export type LocalArea = typeof LOCAL_AREAS[number]

export const ACTION_INTENTS = ['PROPOSE_SURVIVAL_PLAN', 'SEARCH_WATER', 'SEARCH_FOOD', 'FIND_SHELTER', 'KEEP_WATCH', 'RECOVER', 'SOCIAL', 'SELF_STATE_DISCLOSURE', 'QUESTION', 'NEGOTIATE', 'REQUEST_HELP', 'WARN', 'THREATEN', 'OTHER'] as const
export type ActionIntent = typeof ACTION_INTENTS[number]

export type ProposedActionType =
  | 'MOVE'
  | 'SPEAK'
  | 'USE_ITEM'
  | 'DROP_ITEM'
  | 'GIVE_ITEM'
  | 'OBSERVE'
  | 'INTERACT'
  | 'WAIT'
  | 'COOPERATE'
  | 'ATTACK'
  | 'STEAL'
  | 'ROB'
  | 'HIDE'
  | 'REST'
  | 'SLEEP'
  | 'TAKE_ITEM'
  | 'EAT'
  | 'DRINK'
  | 'EXPLORE'
  | 'SHARE_INFO'

// What an AGENT PROMPT (or GM PROMPT) is allowed to return. This is a proposal only — the actor
// itself never gets to decide whether it succeeds.
export interface ProposedAction {
  interaction?: { operation: 'separate' | 'alter' | 'combine'; sourceObjectIds: string[]; resultName: string; resultForm: string; materials: string[]; quantity: number }
  // Private decision metadata. The engine still binds the executable action to a
  // validated candidate; this cannot assert facts or change an action's effects.
  decisionV3?: {
    transition: 'CONTINUE' | 'MODIFY' | 'ABANDON' | 'COMPLETE'
    goal: string
    purpose: string
    method: string
    nextSteps: ProposedActionType[]
    nextStepTargets?: (string | null)[]
    expectedReward: number
    expectedRisk: number
  }
  searchPoint?: { x: number; y: number }
  pickupItemId?: string
  aim?: 'HEAD'|'TORSO'|'ARM'|'LEG'
  defense?: 'DODGE'|'BLOCK'
  candidateId?: string
  goalKey?: string
  // A reply belongs to a recorded invitation; it cannot stand in for the other person's consent.
  replyTo?: string
  response?: 'ACCEPT' | 'REFUSE'
  offerItemId?: string
  requestItemId?: string
  intent?: ActionIntent
  taskId?: string
  actorId: string
  actionType: ProposedActionType
  targetIds: string[]
  locationId: string
  intendedAction: string
  // Short public narrative, not private reasoning or hidden information.
  publicAction?: string
  publicReason?: string
  spokenText?: string
  usedItemIds?: string[]
  // Only relevant for MOVE: the place the actor is trying to reach.
  destinationId?: string
  // Only relevant when the action claims to rely on some fact — WORLD ENGINE checks the actor
  // actually knows it (see knowledgeFilter.ts) before approving.
  claimedKnowledgeId?: string
  // Only relevant when the action would draw down a place resource.
  requiredResource?: { placeId: string; key: string; minLevel: number }
  reasoningSummary?: string
  resourceKey?: string
  factId?: string
  durationMinutes?: number
  // Where within the current (possibly large) place this action is happening. Sticky: WORLD
  // ENGINE keeps the actor's last known area when an action doesn't specify one.
  areaHint?: LocalArea
}

export type RejectionReason =
  | 'ACTOR_NOT_ACTIONABLE'
  | 'LOCATION_MISMATCH'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_UNREACHABLE'
  | 'ITEM_NOT_OWNED'
  | 'RESOURCE_UNAVAILABLE'
  | 'NO_PATH'
  | 'UNKNOWN_INFORMATION'
  | 'RULE_VIOLATION'
  | 'REPETITION_LIMIT'

export interface ActionValidationResult {
  approved: boolean
  reasons: RejectionReason[]
  notes: string[]
}

export function approve(notes: string[] = []): ActionValidationResult {
  return { approved: true, reasons: [], notes }
}

export function reject(reasons: RejectionReason[], notes: string[] = []): ActionValidationResult {
  return { approved: false, reasons, notes }
}
