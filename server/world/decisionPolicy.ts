import type { WorldEvent, WorldState } from '../domain/worldTypes.ts'
import type { Candidate } from './motivations.ts'
import { decisionKey, decisionKeyMatches, ensureAgentV2, moralProfileFor } from './agentV2State.ts'
import { decisionPerception } from './decisionPerception.ts'

const clamp = (n: number) => Math.max(0, Math.min(10, n))
const violent = new Set(['ATTACK', 'ROB', 'STEAL'])
function decisionVariation(key: string, minute: number): number {
  let hash = 2166136261
  for (const char of `${minute}:${key}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return (hash % 9 - 4) / 20 // deterministic, too small to override meaningful needs
}

// This is the only goal/repetition/human-behavior scoring pass. It receives the
// perception projection, never authoritative WORLD TRUTH.
export function evaluateV2(world: WorldState, actorId: string, events: WorldEvent[], candidates: Candidate[]): Candidate[] {
  const seen = decisionPerception(world, actorId, events)
  const actor = seen.agents.find(a => a.id === actorId)!
  const liveActor = world.agents.find(a => a.id === actorId)!
  const v = ensureAgentV2(liveActor, world)
  const d = actor.dispositions!
  v.human.moralProfile = moralProfileFor(d)
  const minute = seen.engine!.minute
  const h = actor.vitals?.hunger ?? actor.humanState?.survival_need ?? 0
  const thirst = actor.vitals?.thirst ?? h
  const injury = actor.body?.injury ?? 0
  const pain = actor.trauma?.pain ?? injury
  const fatigue = actor.humanState?.fatigue ?? 0
  const fear = actor.emotion?.fear ?? 0
  const isolation = seen.agents.filter(a => a.id !== actorId).length === 0 ? 1.5 : 0
  const nearbyThreat = seen.engine!.ongoingActions.some(t => violent.has(t.proposal.actionType) && t.proposal.targetIds.includes(actorId)) ? 3 : 0
  const recentSetbacks = v.recentFailures.filter(r => seen.engine!.minute - r.minute < 360).length
  const objective=seen.engine!.objectiveStatus
  const urgency=objective?.remainingMinutes===null||objective?.remainingMinutes===undefined?0:Math.max(0,1-objective.remainingMinutes/1440)
  const objectiveGap=(objective?.targets??[]).reduce((n,t)=>n+t.gap,0)
  const survivorGap=objective?.targets.find(t=>t.type==='survivors')?.gap??0
  const scarcity = seen.places.find(p => p.id === actor.publicState.locationId)?.resources.filter(r => ['food', 'water'].includes(r.key)).reduce((n, r) => n + r.level, 0) ?? 0
  v.human.desperation = clamp(Math.max(h, thirst) * .35 + pain * .2 + fear * .15 + fatigue * .15 +
    (scarcity < 2 ? 1.5 : 0) + isolation + nearbyThreat + Math.min(2, recentSetbacks * .5) +
    (d.selfInterest - d.empathy) * .06)
  const owned = seen.engine!.objects.filter(o => o.location.kind === 'agent' && o.location.id === actorId)
  v.human.resourceControl = clamp(owned.filter(o => ['food', 'water'].includes(o.kind) || (o.physical?.attackPower ?? 0) > 0)
    .reduce((n, o) => n + Math.min(3, o.quantity), 0) * 2)
  v.human.physicalPower = clamp((actor.body?.health ?? 5) - injury)
  v.human.informationPower = clamp((actor.knowledge?.filter(k => k.verified).length ?? 0) / 2)
  v.human.socialInfluence = clamp(actor.relationships.filter(r => (r.trust ?? 5) >= 7).length * 2)
  v.human.dependencyControl = clamp((seen.engine!.interactions ?? []).filter(i => i.targetId === actorId && i.status === 'pending').length * 2)
  v.human.power = clamp(v.human.physicalPower * .6 + v.human.resourceControl * .25 +
    v.human.informationPower * .05 + v.human.socialInfluence * .05 + v.human.dependencyControl * .05)
  const goal = actor.motivations?.goals.find(g => g.id === actor.motivations?.currentId)
  const interrupted = Boolean(actor.wakeReason && ['visible_attack_attempt', 'local_danger', 'action_interrupted', 'addressed_directly', 'theft_attempt', 'witnessed_conflict'].includes(actor.wakeReason)) || injury >= 7 || goal?.status === 'achieved' || goal?.status === 'blocked' || v.goalFailureCount >= 2
  const activePlan = v.decisionV3?.status === 'active' && !v.decisionV3.replanRequired ? v.decisionV3 : undefined
  const plannedAction = activePlan?.steps[activePlan.stepIndex]
  const plannedTarget = activePlan?.stepTargets?.[activePlan.stepIndex]
  const isPlannedCandidate = (c: Candidate) => Boolean(plannedAction && c.action.actionType === plannedAction &&
    (!plannedTarget || c.action.targetIds.includes(plannedTarget)))
  const current = v.currentGoal && !interrupted ? candidates.filter(c => c.goal === v.currentGoal || isPlannedCandidate(c)) : []
  const bestCurrent = Math.max(-Infinity, ...current.map(c => c.score))
  const urgent = (c: Candidate) => c.goal === 'DEFEND_SELF' || c.goal === 'TREAT_INJURY' && injury >= 6 ||
    c.score > Math.max(bestCurrent, v.goalPriority) + Math.max(5, v.goalCommitment)
  const scored = candidates.flatMap(c => {
    const a = c.action, target = a.targetIds[0]
    const recent = v.recentActions.filter(r => decisionKeyMatches(r.key, a) && minute - r.minute < 360)
    // A finished exchange remains relevant after the short action cooldown. Compare
    // the actual opponent, means and target area, not only a broad ATTACK key.
    const repeatedAttack = a.actionType === 'ATTACK' ? v.recentActions.filter(r =>
      r.actionType === 'ATTACK' && r.targetId === target && r.locationId === a.locationId &&
      minute - r.minute >= 0 && minute - r.minute < 360 && r.result !== 'cancelled') : []
    const failures = v.recentFailures.filter(r => (decisionKeyMatches(r.key, a) || !r.key && r.actionType === a.actionType) && minute - r.minute < 360)
    const crowding = seen.engine!.ongoingActions.filter(t => t.proposal.actorId !== actorId && t.proposal.actionType === a.actionType && t.proposal.locationId === a.locationId && (t.proposal.resourceKey === a.resourceKey || t.proposal.targetIds.some(id => a.targetIds.includes(id)))).length
    const immediateThreat = seen.engine!.ongoingActions.some(t => violent.has(t.proposal.actionType) && t.proposal.targetIds.includes(actorId))
    const grievance = target ? (v.human.resentment[target] ?? 0) : 0
    const hostility = target ? (actor.relationships.find(r => r.otherAgentId === target)?.hostility ?? 0) : 0
    const suspicion = target ? (v.human.suspicion[target] ?? 0) : 0
    const debt = target ? (v.human.socialDebt[target] ?? 0) : 0
    const morals = v.human.moralProfile
    const extreme = violent.has(a.actionType)
    // Extreme actions are possible for an urgent defense, a sustained grievance,
    // or a desperate opportunist. Genre alone does not unlock them.
    if (extreme && !immediateThreat && v.human.desperation < 5 && grievance < 4 && hostility < 6 && d.aggression < 8) return []
    const trusted = target ? (actor.relationships.find(r => r.otherAgentId === target)?.trust ?? 5) >= 7 : false
    if (extreme && trusted && target) v.human.betrayalProcess[target] = clamp(Math.max(v.human.betrayalProcess[target] ?? 0,
      grievance * .6 + suspicion * .3 + v.human.desperation * .4 - morals.loyalty * .5 - Math.max(0, debt) * .3))
    const betrayalCost = extreme && trusted ? Math.max(0, morals.betrayalAversion + morals.loyalty * .4 -
      (v.human.betrayalProcess[target!] ?? 0) - grievance - v.human.desperation * .25) : 0
    const moralCost = a.actionType === 'STEAL' ? morals.stealingAversion + morals.deceptionAversion * .25 :
      a.actionType === 'ATTACK' || a.actionType === 'ROB' ? morals.violenceAversion +
        (a.aim === 'HEAD' ? morals.killingAversion * .5 : 0) : 0
    const violenceCost = extreme ? Math.max(0, moralCost + morals.moralResistance * .25 +
      v.human.guilt * .5 + v.human.trauma * .3 + betrayalCost - v.human.desperation * .7 -
      grievance * morals.revengeAcceptance / 6 - v.human.desensitization * .4 -
      v.human.violenceEscalation * .2 - v.human.power * .1) : 0
    const social = target ? a.actionType === 'SPEAK' || a.actionType === 'COOPERATE' ? debt * .8 - suspicion * .4 : extreme ? grievance * .8 + suspicion * .3 - Math.max(0, debt) : 0 : 0
    const moralBenefit = a.actionType === 'GIVE_ITEM' ? morals.protectWeak * .4 + morals.fairness * .2 :
      a.actionType === 'COOPERATE' ? morals.loyalty * .3 :
      a.actionType === 'SPEAK' && a.intent === 'REQUEST_HELP' ? morals.selfPreservation * .2 :
      a.actionType === 'SPEAK' && a.intent === 'WARN' ? morals.protectLovedOnes * .2 :
      a.actionType === 'SPEAK' && a.intent === 'THREATEN' ? v.human.fearReputation * .3 :
      a.actionType === 'OBSERVE' ? v.human.paranoia * .25 :
      a.actionType === 'REST' ? v.human.grief * .15 : 0
    const abandonmentCost = a.actionType === 'MOVE' && !immediateThreat &&
      actor.relationships.some(r => (r.trust ?? 5) >= 7 && seen.agents.some(other => other.id === r.otherAgentId))
      ? morals.abandonmentAversion * .25 : 0
    const confidenceBenefit = a.actionType === 'ATTACK' ? v.human.confidence * .15 : 0
    const continuation = current.length && (c.goal === v.currentGoal || isPlannedCandidate(c)) ? Math.max(2, v.goalCommitment - v.goalFailureCount * 2) : 0
    const switchCost = current.length && c.goal !== v.currentGoal && !isPlannedCandidate(c) && !urgent(c) ? Math.max(3, v.goalCommitment) : 0
    const sameTool = (r: typeof repeatedAttack[number]) => (r.toolId ?? '') === (a.usedItemIds?.[0] ?? a.pickupItemId ?? '')
    const semanticPenalty = immediateThreat ? 0 : repeatedAttack.reduce((total, r) => {
      const sameAim = (r.aim ?? 'TORSO') === (a.aim ?? 'TORSO')
      const sameMotive = r.intent === (a.intent ?? a.goalKey ?? '')
      const sameReason = Boolean(r.reason && a.publicReason && r.reason === a.publicReason)
      const samePattern = sameTool(r) && sameAim
      const outcome = r.combatOutcome === 'HIT' ? 4 : r.combatOutcome ? 6 : 0
      return total + (samePattern ? 18 : 4) + (sameMotive ? 3 : 0) + (sameReason ? 2 : 0) + outcome
    }, 0)
    const repetitionPenalty = recent.length * (extreme ? 8 : 5) + semanticPenalty
    const recentFailurePenalty = failures.length * 6
    const cooldownPenalty = recent.length && !immediateThreat && !['EAT', 'DRINK', 'USE_ITEM', 'REST', 'WAIT'].includes(a.actionType) ? 8 : 0
    const unproductiveObservations=a.actionType==='OBSERVE'?v.recentActions.filter(r=>{
      const outcome=events.find(e=>e.id===r.eventId)
      return r.actionType==='OBSERVE'&&r.locationId===a.locationId&&r.targetId===target&&
        minute-r.minute>=0&&minute-r.minute<360&&r.result==='completed'&&!!outcome&&
        !outcome.stateChanges.some(change=>change.field.startsWith('knowledge:')||change.field.endsWith(':status')||change.field.endsWith(':location'))
    }).length:0
    const stagnationPenalty=!immediateThreat&&a.actionType==='OBSERVE'?Math.min(18,unproductiveObservations*6):0
    const recoverySatisfiedPenalty=a.actionType==='REST'&&fatigue<=3?10:0
    const recentDestinationPenalty=a.actionType==='MOVE'&&a.destinationId?Math.min(12,v.recentActions.filter(r=>r.actionType==='MOVE'&&r.destinationId===a.destinationId&&minute-r.minute>=0&&minute-r.minute<360).length*6):0
    const strategy = v.strategy && minute - v.strategy.updatedMinute < 720 ? v.strategy : undefined
    let strategyValue = 0
    if (strategy?.failedActionType === 'ATTACK') {
      const usefulTool = a.actionType === 'TAKE_ITEM' && seen.engine!.objects.some(o => o.id === a.usedItemIds?.[0] && (o.physical?.attackPower ?? 0) > 0)
      if (strategy.stage === 'prepare') strategyValue = usefulTool ? 18 : a.actionType === 'EXPLORE' && c.goal === 'PREPARE_PROTECTION' ? 5 : a.actionType === 'OBSERVE' && target === strategy.targetId ? 5 : a.actionType === 'ATTACK' && target === strategy.targetId && (a.usedItemIds?.[0] ?? a.pickupItemId) === strategy.failedToolId ? -14 : 0
      if (strategy.stage === 'ready' && a.actionType === 'ATTACK' && target === strategy.targetId) strategyValue = a.usedItemIds?.[0] && a.usedItemIds[0] !== strategy.failedToolId ? 11 : -8
    } else if (strategy?.failedActionType === 'SPEAK' && target === strategy.targetId) {
      strategyValue = a.actionType === 'SPEAK' && a.intent === strategy.failedIntent ? -16 : a.actionType === 'OBSERVE' ? 7 : a.actionType === 'SPEAK' || a.actionType === 'COOPERATE' ? 4 : 0
    }
    const itemPlan=v.itemPlan && minute-v.itemPlan.updatedMinute<720?v.itemPlan:undefined
    const itemPlanValue=itemPlan && a.usedItemIds?.[0]===itemPlan.itemId &&
      (itemPlan.stage==='take'&&a.actionType==='TAKE_ITEM'||itemPlan.stage==='use'&&a.actionType==='USE_ITEM')?12:0
    const objectiveContribution=objectiveGap>0?(
      ['TREAT_INJURY','SECURE_SUPPLIES','SEEK_KNOWN_ITEM','PREPARE_PROTECTION'].includes(c.goal)?2+urgency*4:
      a.actionType==='MOVE'&&objective?.targets.some(t=>t.type==='place'&&t.target===a.destinationId)?4+urgency*5:
      a.actionType==='WAIT'?-(1+urgency*3):0):0
    const competitorContribution=survivorGap>0?(
      c.goal==='LOCATE_COMPETITOR'?7+urgency*4:
      c.goal==='SCOUT_OBJECTIVE'?5+urgency*3:
      c.goal==='APPROACH_CONTACT'?6+urgency*3:
      c.goal==='CONFRONT_RIVAL'?5+Math.min(4,survivorGap)+urgency*4:
      c.goal==='ASSESS_OPPORTUNITY'&&target?3+urgency*2:0):0
    const planContribution=v.plan&&!v.plan.abandoned&&v.plan.goal===c.goal?Math.max(0,2-v.plan.failures)+v.plan.progress*.2:0
    const longPlan = v.decisionV3?.status === 'active' ? v.decisionV3 : undefined
    const stepTarget = longPlan?.stepTargets?.[longPlan.stepIndex]
    const planTargetMatches = stepTarget !== undefined ? !stepTarget || a.targetIds.includes(stepTarget) : !longPlan?.targetId || a.targetIds.includes(longPlan.targetId) ||
      // Preparatory movement, search and equipment steps may have no target yet.
      !a.targetIds.length && ['MOVE','EXPLORE','TAKE_ITEM','USE_ITEM','OBSERVE','HIDE','REST'].includes(a.actionType)
    const plannedStep = longPlan?.steps[longPlan.stepIndex]
    const stepValue = longPlan && planTargetMatches && plannedStep === a.actionType ?
      Math.max(0, 5 + longPlan.commitment * .5 - longPlan.failureCount * 2) : 0
    const failedMethod = longPlan?.replanRequired && longPlan.lastActionType === a.actionType &&
      planTargetMatches && (longPlan.targetId ? a.targetIds.includes(longPlan.targetId) : true)
    const replanValue = longPlan?.replanRequired && planTargetMatches && a.actionType !== longPlan.lastActionType ? 3 : 0
    const reasonCodes = [v.human.desperation >= 6 ? 'DESPERATION' : 'STABLE_NEED', scarcity < 2 ? 'SURVIVAL_NECESSITY' : 'AVAILABLE_RESOURCES', target && grievance >= 3 ? 'REVENGE' : '', target && debt > 0 ? 'SOCIAL_DEBT' : '', immediateThreat ? 'SELF_DEFENSE' : '', extreme && trusted ? 'BETRAYAL_RISK' : '', failures.length ? 'RECENT_FAILURE' : ''].filter(Boolean)
    const justification = extreme ? reasonCodes.includes('SELF_DEFENSE') ? 4 : reasonCodes.includes('REVENGE') ? 2 : reasonCodes.includes('DESPERATION') && reasonCodes.includes('SURVIVAL_NECESSITY') ? 1 : 0 : 0
    const score = c.score + social + moralBenefit + confidenceBenefit + continuation + justification + strategyValue + itemPlanValue + objectiveContribution + competitorContribution + planContribution + stepValue + replanValue - (failedMethod ? 8 : 0) -
      switchCost - abandonmentCost - violenceCost - repetitionPenalty - recentFailurePenalty -
      cooldownPenalty - stagnationPenalty - recoverySatisfiedPenalty - recentDestinationPenalty - crowding * 3 + decisionVariation(decisionKey(a), minute)
    const evidenceEventIds=[...new Set([...c.evidenceEventIds,...(strategyValue&&strategy?[strategy.sourceEventId]:[]),...(itemPlanValue&&itemPlan?.sourceEventId?[itemPlan.sourceEventId]:[])])]
    return [{ ...c, evidenceEventIds, reasonCodes: [...reasonCodes,...(strategyValue?['STRATEGY_CONSEQUENCE']:[]),...(itemPlanValue?['ITEM_PLAN']:[]),...(objectiveContribution||competitorContribution?['OBJECTIVE_GAP']:[]),...(stagnationPenalty?['NO_NEW_EVIDENCE']:[]),...(recentDestinationPenalty?['RECENT_DESTINATION']:[]),...(stepValue?['PLAN_STEP']:[]),...(replanValue?['REPLAN_AFTER_FAILURE']:[])], score: Math.round(score * 10) / 10 }]
  })
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}
