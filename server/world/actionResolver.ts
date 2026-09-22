// Turns a validated ProposedAction into a WorldEvent. Only called after worldValidator has run —
// this file never re-checks rules, it only records the outcome. A rejected action is still turned
// into an event (outcome: 'REJECTED') so the attempt survives in the log for operator review; it
// is never surfaced in the public reading feed (see server/api/worldRoutes.ts).
import type { StateChange, WorldEvent, WorldState } from '../domain/worldTypes.ts'
import type { ActionValidationResult, ProposedAction } from './actionSchema.ts'

const ACTION_TO_EVENT_TYPE: Record<ProposedAction['actionType'], WorldEvent['type']> = {
  MOVE: 'MOVE',
  SPEAK: 'DIALOGUE',
  USE_ITEM: 'DECISION',
  GIVE_ITEM: 'COOPERATION',
  OBSERVE: 'OBSERVATION',
  INTERACT: 'COOPERATION',
  WAIT: 'OBSERVATION',
  COOPERATE: 'COOPERATION',
  ATTACK: 'CONFLICT',
  REST: 'OBSERVATION', SLEEP: 'OBSERVATION', TAKE_ITEM: 'RESOURCE_CHANGE', EAT: 'RESOURCE_CHANGE', DRINK: 'RESOURCE_CHANGE', EXPLORE: 'DISCOVERY', SHARE_INFO: 'DIALOGUE',
}

// Derives the StateChange list for an approved action. Deliberately covers only the action types
// this mock phase needs (MOVE, GIVE_ITEM) — a real engine extends this per action type, but every
// change it produces must still go through stateTransition.applyStateChange, never WorldState
// fields directly.
function deriveStateChanges(action: ProposedAction, worldState: WorldState): StateChange[] {
  const changes: StateChange[] = []
  const actor = worldState.agents.find(a => a.id === action.actorId)
  if (!actor) return changes

  if (action.actionType === 'MOVE' && action.destinationId) {
    changes.push({ field: `agent:${action.actorId}:location`, from: actor.publicState.locationId, to: action.destinationId })
  }
  if (action.actionType === 'GIVE_ITEM' && action.usedItemIds?.length && action.targetIds[0]) {
    changes.push({ field: `object:${action.usedItemIds[0]}:holder`, from: action.actorId, to: action.targetIds[0] })
  }
  return changes
}

export interface ResolveInput {
  id: string
  occurredAt: string
  day: number
  title: string
  summary: string
}

export function resolveAction(action: ProposedAction, validation: ActionValidationResult, worldState: WorldState, meta: ResolveInput): WorldEvent {
  return {
    id: meta.id,
    type: ACTION_TO_EVENT_TYPE[action.actionType],
    occurredAt: meta.occurredAt,
    day: meta.day,
    placeId: action.locationId,
    agentIds: [action.actorId, ...action.targetIds],
    title: meta.title,
    summary: meta.summary,
    stateChanges: validation.approved ? deriveStateChanges(action, worldState) : [],
    importance: 'normal',
    relatedEventIds: [],
    publicQuote: action.actionType === 'SPEAK' ? action.spokenText : undefined,
    outcome: validation.approved ? 'CONFIRMED' : 'REJECTED',
  }
}
