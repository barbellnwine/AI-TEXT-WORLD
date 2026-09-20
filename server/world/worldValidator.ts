// WORLD ENGINE — the only code allowed to decide whether a proposed action actually happens.
// Every check below is plain code, not a prompt instruction: an AGENT or GM can propose anything,
// but nothing reaches WorldState unless it passes every check here. This is the enforcement layer
// behind WORLD_RULES (server/prompts/worldRules.ts) — that file is what the model reads; this file
// is what actually holds the line.
import type { WorldState } from '../domain/worldTypes.ts'
import { agentKnowsFact } from './knowledgeFilter.ts'
import { approve, reject, type ActionValidationResult, type ProposedAction, type RejectionReason } from './actionSchema.ts'

export interface ValidationContext {
  worldState: WorldState
  allEventIds: Set<string>
  // Recent actions by the same actor, most recent first — used for the repetition check.
  recentActionsByActor?: ProposedAction[]
}

const NON_ACTIONABLE_STATUSES = new Set(['deceased'])

export function validateAction(action: ProposedAction, ctx: ValidationContext, allEvents: Parameters<typeof agentKnowsFact>[3] = []): ActionValidationResult {
  const reasons: RejectionReason[] = []
  const notes: string[] = []
  const { worldState } = ctx

  const actor = worldState.agents.find(a => a.id === action.actorId)
  if (!actor) {
    return reject(['ACTOR_NOT_ACTIONABLE'], [`actor ${action.actorId} does not exist in this world`])
  }
  if (NON_ACTIONABLE_STATUSES.has(actor.publicState.status)) {
    reasons.push('ACTOR_NOT_ACTIONABLE')
    notes.push(`actor status is '${actor.publicState.status}'`)
  }

  if (actor.publicState.locationId !== action.locationId) {
    reasons.push('LOCATION_MISMATCH')
    notes.push(`actor is at '${actor.publicState.locationId}', action claims '${action.locationId}'`)
  }

  const currentPlace = worldState.places.find(p => p.id === action.locationId)

  for (const targetId of action.targetIds) {
    const targetAgent = worldState.agents.find(a => a.id === targetId)
    const targetPlace = worldState.places.find(p => p.id === targetId)
    if (!targetAgent && !targetPlace) {
      reasons.push('TARGET_NOT_FOUND')
      notes.push(`target '${targetId}' does not exist`)
      continue
    }
    if (targetAgent && targetAgent.publicState.locationId !== action.locationId && action.actionType !== 'SPEAK') {
      reasons.push('TARGET_UNREACHABLE')
      notes.push(`target '${targetId}' is not at the actor's location`)
    }
  }

  if (action.actionType === 'MOVE') {
    if (!action.destinationId) {
      reasons.push('RULE_VIOLATION')
      notes.push('MOVE requires destinationId')
    } else if (!currentPlace?.connectedPlaceIds.includes(action.destinationId)) {
      reasons.push('NO_PATH')
      notes.push(`'${action.destinationId}' is not connected to '${action.locationId}'`)
    } else {
      const destination = worldState.places.find(p => p.id === action.destinationId)
      if (destination?.locked) {
        reasons.push('RULE_VIOLATION')
        notes.push(`'${action.destinationId}' is locked (${destination.accessCondition ?? 'no access condition recorded'})`)
      }
    }
  }

  for (const itemId of action.usedItemIds ?? []) {
    if (!actor.inventory.includes(itemId)) {
      reasons.push('ITEM_NOT_OWNED')
      notes.push(`actor does not have '${itemId}'`)
    }
  }

  if (action.requiredResource) {
    const place = worldState.places.find(p => p.id === action.requiredResource!.placeId)
    const resource = place?.resources.find(r => r.key === action.requiredResource!.key)
    if (!resource || resource.level < action.requiredResource.minLevel) {
      reasons.push('RESOURCE_UNAVAILABLE')
      notes.push(`resource '${action.requiredResource.key}' at '${action.requiredResource.placeId}' is insufficient`)
    }
  }

  if (action.claimedKnowledgeId && !agentKnowsFact(action.actorId, action.claimedKnowledgeId, worldState, allEvents)) {
    reasons.push('UNKNOWN_INFORMATION')
    notes.push(`actor has no basis to know '${action.claimedKnowledgeId}'`)
  }

  const repetitionLimit = 3
  const recent = ctx.recentActionsByActor ?? []
  if (recent.length >= repetitionLimit && recent.slice(0, repetitionLimit).every(r => r.actionType === action.actionType && r.intendedAction === action.intendedAction)) {
    reasons.push('REPETITION_LIMIT')
    notes.push(`same action repeated ${repetitionLimit}+ times in a row`)
  }

  return reasons.length > 0 ? reject([...new Set(reasons)], notes) : approve(notes)
}

// GM-proposed external events go through the same existence checks as an operator event: they
// may only reference places/agents that already exist in this world. This is deliberately a
// narrower check than validateAction (a GM event has no single "actor" or location match to
// enforce) — see server/api/worldAdminRoutes.ts for where this backs the "외부 사건 추가" feature.
export function validateGmEvent(input: { placeId: string; agentIds: string[] }, worldState: WorldState): ActionValidationResult {
  const notes: string[] = []
  const reasons: RejectionReason[] = []
  if (!worldState.places.some(p => p.id === input.placeId)) {
    reasons.push('TARGET_NOT_FOUND')
    notes.push(`place '${input.placeId}' does not exist in this world`)
  }
  for (const agentId of input.agentIds) {
    if (!worldState.agents.some(a => a.id === agentId)) {
      reasons.push('TARGET_NOT_FOUND')
      notes.push(`agent '${agentId}' does not exist in this world`)
    }
  }
  return reasons.length > 0 ? reject([...new Set(reasons)], notes) : approve(notes)
}
