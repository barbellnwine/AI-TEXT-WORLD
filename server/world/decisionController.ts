import type { ProposedAction } from './actionSchema.ts'
import type { WorldState, WorldEvent } from '../domain/worldTypes.ts'
import { deliberation, ensureMotivations, observeLocalObjects, type Candidate } from './motivations.ts'
import { validateEngineAction } from './worldEngine.ts'
import { evaluateV2 } from './decisionPolicy.ts'
import { ensureAgentV2 } from './agentV2State.ts'

export function prepareDecision(world: WorldState, actorId: string, events: WorldEvent[]) {
  ensureMotivations(world.agents.find(a => a.id === actorId)!, world.engine!.minute)
  ensureAgentV2(world.agents.find(a => a.id === actorId)!, world)
  observeLocalObjects(world, actorId)
  const assessment = deliberation(world, actorId, events)
  const feasible = evaluateV2(world, actorId, events, assessment.choices).filter(c => validateEngineAction(c.action, world, events).approved)
  const choices: Candidate[] = []
  const covered = new Set<string>()
  // evaluateV2 already rewards a useful active plan. Present candidates by actual
  // evaluated utility; a stale plan step must not be inserted ahead of better options.
  for (const c of feasible) if (!covered.has(c.action.actionType) && choices.length < 12) { choices.push(c); covered.add(c.action.actionType) }
  for (const c of feasible) if (!choices.includes(c) && choices.length < 12) choices.push(c)
  const wait = feasible.find(c => c.action.actionType === 'WAIT')
  if (wait && !choices.includes(wait)) choices.push(wait)
  return { ...assessment, choices }
}
export function selectCandidate(choices: Candidate[], id?: string): Candidate | undefined {
  return id ? choices.find(c => c.id === id) : choices[0]
}
function sameAttempt(a: ProposedAction, b: ProposedAction) {
  return a.pickupItemId===b.pickupItemId && a.aim===b.aim && a.defense===b.defense && a.actionType === b.actionType && (a.intent ?? 'OTHER') === (b.intent ?? 'OTHER') && [...a.targetIds].sort().join() === [...b.targetIds].sort().join() &&
    a.areaHint === b.areaHint && a.destinationId === b.destinationId && a.replyTo === b.replyTo && a.response === b.response &&
    a.resourceKey === b.resourceKey && (a.usedItemIds??[]).join() === (b.usedItemIds??[]).join() &&
    a.offerItemId === b.offerItemId && a.requestItemId === b.requestItemId
}
export function bindCandidate(proposed: ProposedAction, choices: Candidate[]): ProposedAction {
  const chosen = proposed.candidateId ? selectCandidate(choices, proposed.candidateId) : choices.find(c => sameAttempt(c.action, proposed))
  if (proposed.candidateId && !chosen) throw new Error('candidate_not_available')
  if (!chosen) throw new Error('candidate_not_available')
  // Models may phrase their own dialogue/motivation, but cannot change the candidate's
  // target, item, place or effects by attaching its ID to a different action.
  return { ...chosen.action, candidateId: chosen.id, decisionV3: proposed.decisionV3, spokenText: proposed.spokenText ?? chosen.action.spokenText,
    publicReason: proposed.publicReason ?? chosen.action.publicReason, publicAction: proposed.publicAction,
    intendedAction: proposed.intendedAction, goalKey: chosen.goal }
}
