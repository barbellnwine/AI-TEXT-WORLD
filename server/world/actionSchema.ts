// Shape of what an AGENT (or GM) may ever propose. Proposing is not deciding: nothing here
// touches WorldState directly. Only worldValidator.ts + actionResolver.ts may do that, and only
// after every check in worldValidator.ts passes. This file has no dependency on any LLM SDK.

export type ProposedActionType =
  | 'MOVE'
  | 'SPEAK'
  | 'USE_ITEM'
  | 'GIVE_ITEM'
  | 'OBSERVE'
  | 'INTERACT'
  | 'WAIT'
  | 'COOPERATE'
  | 'ATTACK'

// What an AGENT PROMPT (or GM PROMPT) is allowed to return. This is a proposal only — the actor
// itself never gets to decide whether it succeeds.
export interface ProposedAction {
  actorId: string
  actionType: ProposedActionType
  targetIds: string[]
  locationId: string
  intendedAction: string
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
