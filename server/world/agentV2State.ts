import type { Agent, WorldEvent, WorldState } from '../domain/worldTypes.ts'
import type { BrainIntent } from '../domain/worldAgent.ts'
import type { ProposedAction } from './actionSchema.ts'
import { DEFAULT_DISPOSITIONS, type Dispositions } from './dispositions.ts'
import {agentPoint,distance,objectPoint,SIGHT_RADIUS} from './spatialWorld.ts'

export interface MoralProfile {
  harmAversion: number; fairness: number
  violenceAversion: number; killingAversion: number; stealingAversion: number
  betrayalAversion: number; deceptionAversion: number; abandonmentAversion: number
  protectWeak: number; protectLovedOnes: number; loyalty: number
  revengeAcceptance: number; selfPreservation: number; moralResistance: number
}

export function moralProfileFor(d: Dispositions): MoralProfile {
  const care = clamp((d.empathy * 2 + 10 - d.aggression) / 3)
  const principle = clamp((d.empathy + d.trust + 10 - d.selfInterest) / 3)
  return { harmAversion: care, fairness: clamp((d.empathy + d.trust) / 2),
    violenceAversion: care, killingAversion: clamp(care + 2),
    stealingAversion: clamp((principle + 10 - d.selfInterest) / 2),
    betrayalAversion: clamp((principle + d.trust) / 2),
    deceptionAversion: principle, abandonmentAversion: clamp((care + d.trust) / 2),
    protectWeak: care, protectLovedOnes: clamp((d.empathy + d.trust) / 2),
    loyalty: clamp((d.trust + 10 - d.selfInterest) / 2),
    revengeAcceptance: clamp((d.aggression + d.competitiveness) / 2),
    selfPreservation: clamp((d.selfInterest + d.riskTolerance + 10 - d.empathy) / 3),
    moralResistance: principle }
}

export interface RecentDecision {
  key: string; actionType: string; intent: string; targetId?: string; locationId: string; destinationId?: string
  minute: number; result?: 'completed' | 'failed' | 'cancelled'
  actionId?: string; eventId?: string; aim?: ProposedAction['aim']; toolId?: string
  factId?: string
  reason?: string; combatOutcome?: string; speech?: string
  goal?: string; method?: string; targetReference?: string; failureStage?: string
}
export interface AgentV2State {
  version: 2
  freePlan?: { brain: BrainIntent; steps: ProposedAction[]; createdMinute: number; activeActionId?: string; futureSteps?: unknown[] }
  decisionV3?: {
    goal: string; goalDescription: string; intent: string; purpose: string; method: string
    targetId?: string; itemId?: string; steps: ProposedAction['actionType'][]; stepTargets: (string | null)[]; stepIndex: number
    commitment: number; expectedReward: number; expectedRisk: number
    lastActionType?: ProposedAction['actionType']; lastResult?: string; failureCount: number
    lastFailureReason?: string; replanRequired: boolean
    transition: 'CONTINUE' | 'MODIFY' | 'ABANDON' | 'COMPLETE'
    status: 'active' | 'abandoned' | 'completed'
    previousGoal?: string
    createdMinute: number; updatedMinute: number; sourceEventIds: string[]
  }
  plan?: { goal: string; stage: string; progress: number; failures: number; lastFailureReason?: string; nextStep?: string; replanned: boolean; abandoned: boolean; sourceEventIds: string[] }
  // A consequence can redirect several subsequent decisions without replacing the
  // actor's goal whenever the next step has a different action type.
  strategy?: { targetId: string; goal: string; failedActionType: string; failedIntent: string; failedToolId?: string; stage: 'reassess' | 'prepare' | 'ready'; sourceEventId: string; updatedMinute: number }
  itemPlan?: { itemId: string; kind: string; stage: 'reach' | 'take' | 'use'; sourceEventId?: string; updatedMinute: number }
  currentGoal: string | null
  goalStartedAt: number | null
  goalPriority: number
  goalCommitment: number
  goalProgress: number
  goalFailureCount: number
  currentAction: { id: string; type: string; status: 'planned' | 'active' | 'paused' | 'completed' | 'failed' | 'interrupted' | 'pending' | 'ongoing'; startedAt: number } | null
  lastActionResult: { eventId: string; actionType: string; result: string; minute: number } | null
  nextDecisionAt: number
  recentActions: RecentDecision[]
  recentFailures: RecentDecision[]
  human: {
    moralProfile: MoralProfile
    desperation: number; guilt: number; desensitization: number; trauma: number
    confidence: number; paranoia: number; grief: number
    significantExperiences: string[]
    resentment: Record<string, number>; suspicion: Record<string, number>
    socialDebt: Record<string, number>; power: number; resourceControl: number
    physicalPower: number; informationPower: number; socialInfluence: number
    fearReputation: number; dependencyControl: number
    betrayalProcess: Record<string, number>; violenceEscalation: number
  }
}

const clamp = (n: number) => Math.max(0, Math.min(10, n))
function legacyDecisionKey(raw: string): string {
  try {
    const [actor, type, intent, targets, location] = JSON.parse(raw) as [string, string, string, string[], string]
    if (typeof actor === 'string' && typeof type === 'string' && Array.isArray(targets) && typeof location === 'string')
      return JSON.stringify([actor, type === 'SOCIAL' ? 'SPEAK' : type, intent, [...targets].sort(), location])
  } catch { /* malformed legacy audit keys do not block a season from loading */ }
  return raw
}
export function ensureAgentV2(actor: Agent, world?: WorldState): AgentV2State {
  const d = actor.dispositions ?? DEFAULT_DISPOSITIONS
  if (actor.v2?.version === 2) {
    // Older V2 checkpoints can be resumed without resetting goals, memories or history.
    const v = actor.v2
    v.goalPriority ??= 0
    v.human.moralProfile = { ...moralProfileFor(d), ...v.human.moralProfile }
    v.human.confidence ??= 0; v.human.paranoia ??= 0; v.human.grief ??= 0
    v.human.significantExperiences ??= []
    v.human.physicalPower ??= v.human.power; v.human.informationPower ??= 0
    v.human.socialInfluence ??= 0; v.human.fearReputation ??= 0; v.human.dependencyControl ??= 0
    if (v.decisionV3) v.decisionV3.stepTargets ??= []
    return v
  }
  const minute = world?.engine?.minute ?? 0
  const legacy = actor.motivations?.goals.find(g => g.id === actor.motivations?.currentId)
  const ongoing = world?.engine?.ongoingActions.find(a => a.proposal.actorId === actor.id)
  const outcomes = world?.engine?.outcomes?.[actor.id] ?? []
  const history = (world?.engine?.behavior?.history ?? []).filter(h => h.actorId === actor.id)
  actor.v2 = {
    version: 2, currentGoal: legacy?.status === 'active' ? legacy.goal : null,
    goalStartedAt: legacy?.createdMinute ?? null, goalPriority: 0, goalCommitment: 5, goalProgress: 0,
    goalFailureCount: legacy?.failures ?? 0,
    currentAction: ongoing ? { id: ongoing.id, type: ongoing.proposal.actionType, status: 'active', startedAt: ongoing.startedMinute } : null,
    lastActionResult: outcomes.length ? { eventId: outcomes.at(-1)!.eventId, actionType: outcomes.at(-1)!.actionType, result: outcomes.at(-1)!.failed ? 'failed' : 'completed', minute: outcomes.at(-1)!.minute } : null,
    nextDecisionAt: actor.nextDecisionAt ?? minute,
    recentActions: history.slice(-24).map(h => ({ key: legacyDecisionKey(h.key), actionType: h.type, intent: h.type, locationId: actor.publicState.locationId, minute: h.minute })),
    recentFailures: outcomes.filter(o => o.failed).slice(-12).map(o => ({ key: '', actionType: o.actionType, intent: '', locationId: actor.publicState.locationId, minute: o.minute, result: 'failed' })),
    human: { moralProfile: moralProfileFor(d),
      desperation: 0, guilt: 0, desensitization: 0, trauma: 0, confidence: 0, paranoia: 0, grief: 0,
      significantExperiences: [], resentment: {}, suspicion: {}, socialDebt: {}, power: 0, resourceControl: 0,
      physicalPower: 0, informationPower: 0, socialInfluence: 0, fearReputation: 0, dependencyControl: 0,
      betrayalProcess: {}, violenceEscalation: 0 },
  }
  return actor.v2
}
export function decisionKey(action: ProposedAction) {
  // Public wording is presentation, not intent. The Brain's structured purpose
  // distinguishes a new conversational turn without making paraphrases new actions.
  const purpose = (action.decisionV3?.purpose ?? action.publicReason ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 160)
  return JSON.stringify([action.actorId, action.actionType, action.intent ?? action.goalKey ?? '', [...action.targetIds].sort(), action.locationId, action.destinationId ?? '', action.areaHint ?? '',
    [...(action.usedItemIds??[]),...(action.interaction?.sourceObjectIds??[]),action.pickupItemId??'',action.resourceKey??''].filter(Boolean).sort(), purpose])
}
export function decisionKeyMatches(key: string, action: ProposedAction) {
  if (key === decisionKey(action)) return true
  // Legacy keys did not store the purpose. They cannot establish that a later
  // conversation, observation or search is semantically identical.
  if (['SPEAK','OBSERVE','EXPLORE'].includes(action.actionType)) return false
  // Checkpoints saved before destinations were part of the key retain their
  // cooldown history until it naturally expires.
  if (action.usedItemIds?.length || action.interaction?.sourceObjectIds.length || action.pickupItemId || action.resourceKey) return false
  if (key === JSON.stringify([action.actorId, action.actionType, action.intent ?? action.goalKey ?? '', [...action.targetIds].sort(), action.locationId, action.destinationId ?? '', action.areaHint ?? ''])) return true
  return key === JSON.stringify([action.actorId, action.actionType, action.intent ?? action.goalKey ?? '', [...action.targetIds].sort(), action.locationId])
}
export function rememberIntent(actor: Agent, action: ProposedAction, id: string, minute: number) {
  const v = ensureAgentV2(actor)
  const requested = action.decisionV3
  const prior = v.decisionV3?.status === 'active' ? v.decisionV3 : undefined
  const continuingStrategy = v.strategy && minute - v.strategy.updatedMinute < 720 &&
    (v.strategy.failedActionType === 'ATTACK' && action.goalKey === 'PREPARE_PROTECTION' && ['TAKE_ITEM','EXPLORE'].includes(action.actionType) ||
      v.strategy.failedActionType === 'SPEAK' && action.actionType === 'OBSERVE' && action.targetIds.includes(v.strategy.targetId))
  const continuingItem = v.itemPlan && minute - v.itemPlan.updatedMinute < 720 &&
    (v.itemPlan.stage === 'take' && action.actionType === 'TAKE_ITEM' && action.usedItemIds?.[0] === v.itemPlan.itemId ||
      v.itemPlan.stage === 'use' && action.actionType === 'USE_ITEM' && action.usedItemIds?.[0] === v.itemPlan.itemId)
  const keep = Boolean(prior && (requested?.transition === 'CONTINUE' ||
    !requested && (action.goalKey === prior.goal || prior.steps[prior.stepIndex] === action.actionType || continuingStrategy || continuingItem)))
  const modify = Boolean(prior && ['MODIFY','COMPLETE'].includes(requested?.transition ?? ''))
  const planGoal = keep || modify ? prior!.goal : action.goalKey ?? action.intent ?? action.actionType
  const steps = [action.actionType, ...(requested?.nextSteps ?? [])].slice(0, 5)
  const stepTargets = [action.targetIds[0] ?? null, ...(requested?.nextSteps ?? []).map((_, index) => requested?.nextStepTargets?.[index] ?? null)].slice(0, 5)
  v.decisionV3 = {
    goal: planGoal, goalDescription: requested?.goal ?? (keep || modify ? prior!.goalDescription ?? prior!.goal : planGoal),
    intent: action.intent ?? action.actionType,
    purpose: requested?.purpose ?? action.intendedAction,
    method: requested?.method ?? action.actionType,
    targetId: keep || modify ? prior!.targetId ?? action.targetIds[0] : action.targetIds[0],
    itemId: keep || modify ? prior!.itemId ?? action.usedItemIds?.[0] ?? action.pickupItemId : action.usedItemIds?.[0] ?? action.pickupItemId,
    steps: keep && !requested ? prior!.steps : steps,
    stepTargets: keep && !requested ? prior!.stepTargets ?? [] : stepTargets,
    stepIndex: keep && !requested ? prior!.stepIndex : 0,
    commitment: keep || modify ? prior!.commitment : clamp(3 + (10 - (actor.dispositions?.impulsivity ?? 5)) * .5),
    expectedReward: requested?.expectedReward ?? (keep || modify ? prior!.expectedReward : 5),
    expectedRisk: requested?.expectedRisk ?? (keep || modify ? prior!.expectedRisk : 5),
    lastActionType: action.actionType, lastResult: keep || modify ? prior!.lastResult : undefined,
    failureCount: keep || modify ? prior!.failureCount : 0,
    lastFailureReason: keep || modify ? prior!.lastFailureReason : undefined,
    replanRequired: false, transition: requested?.transition ?? (keep ? 'CONTINUE' : 'MODIFY'),
    status: 'active', createdMinute: keep || modify ? prior!.createdMinute : minute,
    previousGoal: !keep && !modify ? prior?.goal : prior?.previousGoal,
    updatedMinute: minute, sourceEventIds: keep || modify ? prior!.sourceEventIds : [],
  }
  if (action.goalKey === 'SEEK_KNOWN_ITEM' && ['MOVE','EXPLORE'].includes(action.actionType)) {
    const remembered = [...(actor.observedObjects ?? [])].reverse().find(o => action.actionType === 'MOVE' ? o.placeId === action.destinationId :
      o.placeId === actor.publicState.locationId && o.localArea === action.areaHint)
    if (remembered) v.itemPlan = { itemId: remembered.id, kind: remembered.kind, stage: 'reach', updatedMinute: minute }
  }
  const planStep = v.strategy && minute - v.strategy.updatedMinute < 720 &&
    (v.strategy.failedActionType === 'ATTACK' && action.goalKey === 'PREPARE_PROTECTION' && ['TAKE_ITEM','EXPLORE'].includes(action.actionType) ||
      v.strategy.failedActionType === 'SPEAK' && action.actionType === 'OBSERVE' && action.targetIds.includes(v.strategy.targetId))
  const itemStep = v.itemPlan && minute - v.itemPlan.updatedMinute < 720 &&
    (v.itemPlan.stage === 'take' && action.actionType === 'TAKE_ITEM' && action.usedItemIds?.[0] === v.itemPlan.itemId ||
      v.itemPlan.stage === 'use' && action.actionType === 'USE_ITEM' && action.usedItemIds?.[0] === v.itemPlan.itemId)
  const nextGoal = v.decisionV3.goal ?? (planStep ? v.strategy!.goal : itemStep ? 'SEEK_KNOWN_ITEM' : action.goalKey ?? action.intent ?? action.actionType)
  if (v.currentGoal !== nextGoal) {
    if(v.plan&&v.plan.goal!==nextGoal)v.plan.abandoned=true
    v.currentGoal = nextGoal
    v.goalStartedAt = minute; v.goalProgress = 0; v.goalFailureCount = 0
    v.goalPriority = 0
    v.goalCommitment = clamp(3 + (10 - (actor.dispositions?.impulsivity ?? 5)) * .5)
  }
  if(!v.plan||v.plan.abandoned||v.plan.goal!==nextGoal)v.plan={goal:nextGoal,stage:action.actionType,progress:0,failures:0,nextStep:action.actionType,replanned:false,abandoned:false,sourceEventIds:[]}
  else {v.plan.stage=action.actionType;v.plan.nextStep=action.actionType}
  v.currentAction = { id, type: action.actionType, status: 'active', startedAt: minute }
  v.recentActions.push({ key: decisionKey(action), actionType: action.actionType, intent: action.intent ?? action.goalKey ?? '', targetId: action.targetIds[0], locationId: action.locationId, destinationId: action.destinationId, minute, actionId: id, aim: action.aim, toolId: action.usedItemIds?.[0] ?? action.pickupItemId, factId:action.factId, reason: action.publicReason, speech:action.spokenText })
  v.recentActions = v.recentActions.slice(-24)
  v.nextDecisionAt = actor.nextDecisionAt ?? minute
}
export function rememberResult(actor: Agent, event: WorldEvent, action?: ProposedAction, world?: WorldState) {
  if (!event.actionType || !['COMPLETED', 'FAILED', 'CANCELLED'].includes(event.phase ?? '')) return
  const v = ensureAgentV2(actor)
  const failed = event.phase !== 'COMPLETED' || event.outcome === 'REJECTED' ||
    event.actionType === 'EXPLORE' && !event.stateChanges.some(c => c.field.startsWith('knowledge:')) ||
    ['STEAL', 'ROB'].includes(event.actionType) && !event.stateChanges.some(c => c.field.endsWith(':holder') && c.to === actor.id) ||
    event.stateChanges.some(c => c.field.startsWith('interaction:') && c.field.endsWith(':status') && c.to === 'refused')
  v.currentAction = { id: event.actionId ?? v.currentAction?.id ?? event.id,
    type: event.actionType, status: event.phase === 'CANCELLED' ? 'interrupted' : failed ? 'failed' : 'completed',
    startedAt: v.currentAction?.startedAt ?? event.worldMinute ?? 0 }
  v.lastActionResult = { eventId: event.id, actionType: event.actionType, result: failed ? 'failed' : 'completed', minute: event.worldMinute ?? 0 }
  v.nextDecisionAt = actor.nextDecisionAt ?? event.worldMinute ?? 0
  const previous = [...v.recentActions].reverse().find(a => a.actionId === event.actionId) ?? (action ? [...v.recentActions].reverse().find(a => a.key === decisionKey(action)) : undefined)
  if (previous) {
    previous.result = event.phase === 'CANCELLED' ? 'cancelled' : failed ? 'failed' : 'completed'
    previous.eventId = event.id
    previous.combatOutcome = event.detail?.combat?.outcome
  }
  if (failed) {
    if (v.decisionV3?.status === 'active') {
      v.decisionV3.failureCount++
      v.decisionV3.replanRequired = true
      v.decisionV3.lastFailureReason = event.engineVerdict ?? event.actionResult ?? event.summary
    }
    v.goalFailureCount++
    if(v.plan){v.plan.failures++;v.plan.lastFailureReason=event.engineVerdict??event.actionResult??event.summary;v.plan.replanned=v.plan.failures>=2;v.plan.nextStep=event.actionType==='EXPLORE'?'다른 좌표 또는 다른 획득 방법 평가':'다른 전략 평가';v.plan.sourceEventIds=[...new Set([...v.plan.sourceEventIds,event.id])].slice(-8)}
    if (previous) { const failure = { ...previous, result: 'failed' as const, minute: event.worldMinute ?? previous.minute }; v.recentFailures.push(failure); v.recentFailures = v.recentFailures.slice(-12) }
  } else if (event.stateChanges.length) {v.goalProgress = Math.min(10, v.goalProgress + 2);if(v.plan){v.plan.progress=v.goalProgress;v.plan.sourceEventIds=[...new Set([...v.plan.sourceEventIds,event.id])].slice(-8)}}
  if (v.decisionV3?.status === 'active') {
    const plan = v.decisionV3
    const tacticalSetback = failed || event.actionType === 'ATTACK' && event.phase === 'COMPLETED' && event.detail?.combat?.damage === 0
    plan.lastResult = tacticalSetback ? 'failed' : 'completed'
    plan.updatedMinute = event.worldMinute ?? plan.updatedMinute
    plan.sourceEventIds = [...new Set([...plan.sourceEventIds, event.id])].slice(-8)
    if (tacticalSetback && !failed) {
      plan.failureCount++
      plan.replanRequired = true
      plan.lastFailureReason = event.detail?.combat?.outcome ?? event.summary
    }
    if (!tacticalSetback && plan.steps[plan.stepIndex] === event.actionType) plan.stepIndex = Math.min(plan.steps.length, plan.stepIndex + 1)
    if(event.actionType==='REST' && (actor.humanState?.fatigue??10)<=3){
      plan.replanRequired=true
      plan.lastFailureReason='recovery_goal_satisfied'
    }
    // Completing an action does not complete the goal. The legacy goal resolver
    // has already evaluated the concrete state changes before this hook runs.
    const achieved = actor.motivations?.goals.find(g => g.id === actor.motivations?.currentId)?.status === 'achieved'
    if (!tacticalSetback && achieved && plan.transition === 'COMPLETE') plan.status = 'completed'
  }
  if (v.itemPlan && world && ['MOVE','EXPLORE'].includes(event.actionType) && previous?.intent === 'SEEK_KNOWN_ITEM') {
    const item=world.engine?.objects.find(o=>o.id===v.itemPlan!.itemId)
    if (event.phase === 'COMPLETED' && item?.location.kind === 'place' && item.location.id === actor.publicState.locationId &&
      (item.localArea??'CENTER') === (actor.publicState.localArea??'CENTER') && distance(agentPoint(actor),objectPoint(item))<=SIGHT_RADIUS) {
      v.itemPlan.stage='take'; v.itemPlan.sourceEventId=event.id; v.itemPlan.updatedMinute=event.worldMinute??0
    } else v.itemPlan=undefined
  } else if (v.itemPlan && event.actionType === 'TAKE_ITEM' && event.phase === 'COMPLETED') {
    const transfer=event.stateChanges.find(c=>c.field.startsWith('object:')&&c.field.endsWith(':holder')&&c.to===actor.id)
    if (transfer && previous?.toolId===v.itemPlan.itemId) {
      v.itemPlan.itemId=transfer.field.split(':')[1]; v.itemPlan.sourceEventId=event.id; v.itemPlan.updatedMinute=event.worldMinute??0
      const usefulNow=v.itemPlan.kind==='food'&&(actor.vitals?.hunger??actor.humanState?.survival_need??0)>=3 ||
        v.itemPlan.kind==='water'&&(actor.vitals?.thirst??actor.humanState?.survival_need??0)>=3 ||
        v.itemPlan.kind==='medicine'&&Boolean(actor.trauma?.injuries.some(w=>!w.healed&&w.treatedAt===null))
      if (usefulNow) v.itemPlan.stage='use'
      else v.itemPlan=undefined
    }
  } else if (v.itemPlan && event.actionType === 'USE_ITEM' && previous?.toolId===v.itemPlan.itemId && event.phase === 'COMPLETED') v.itemPlan=undefined
  const targetId = event.detail?.combat?.targetId ?? previous?.targetId ?? action?.targetIds[0]
  if (event.actionType === 'ATTACK' && targetId && event.phase === 'COMPLETED' && event.detail?.combat?.damage === 0) {
    v.strategy = { targetId, goal: actor.v2?.currentGoal ?? 'DEFEND_SELF', failedActionType: 'ATTACK', failedIntent: previous?.intent ?? action?.intent ?? '', failedToolId: previous?.toolId, stage: 'prepare', sourceEventId: event.id, updatedMinute: event.worldMinute ?? 0 }
  } else if (v.strategy && event.phase === 'COMPLETED' && event.actionType === 'TAKE_ITEM' && event.stateChanges.some(c => c.field.endsWith(':holder') && c.to === actor.id &&
    (world?.engine?.objects.find(o => o.id === c.field.split(':')[1])?.physical?.attackPower ?? 0) > 0)) {
    v.strategy.stage = 'ready'; v.strategy.updatedMinute = event.worldMinute ?? 0
  } else if (v.strategy && (event.actionType === 'ATTACK' && targetId === v.strategy.targetId && (event.detail?.combat?.damage ?? 0) > 0 || event.stateChanges.some(c => c.field === `agent:${v.strategy!.targetId}:status` && c.to === 'deceased'))) {
    v.strategy = undefined
  }
}

export function rememberSocialRefusal(world: WorldState, event: WorldEvent) {
  if (event.phase !== 'COMPLETED') return
  for (const change of event.stateChanges.filter(c => c.field.startsWith('interaction:') && c.field.endsWith(':status') && c.to === 'refused')) {
    const id = change.field.slice('interaction:'.length,-':status'.length)
    const interaction = world.engine?.interactions?.find(i => i.id === id)
    const initiator = world.agents.find(a => a.id === interaction?.actorId)
    if (!interaction || !initiator) continue
    const v = ensureAgentV2(initiator, world)
    v.strategy = { targetId: interaction.targetId, goal: v.currentGoal ?? 'BUILD_TRUST', failedActionType: 'SPEAK', failedIntent: interaction.intent, stage: 'reassess', sourceEventId: event.id, updatedMinute: event.worldMinute ?? world.engine!.minute }
    if (v.decisionV3?.status === 'active') {
      v.decisionV3.lastResult = 'refused'
      v.decisionV3.failureCount++
      v.decisionV3.replanRequired = true
      v.decisionV3.lastFailureReason = 'proposal_refused'
      v.decisionV3.updatedMinute = event.worldMinute ?? world.engine!.minute
      v.decisionV3.sourceEventIds = [...new Set([...v.decisionV3.sourceEventIds, event.id])].slice(-8)
    }
  }
}

export function updateHumanAfterEvent(world: WorldState, event: WorldEvent) {
  if (event.phase !== 'COMPLETED' || event.outcome === 'REJECTED') return
  const [sourceId, targetId] = event.agentIds
  const source = world.agents.find(a => a.id === sourceId)
  const target = world.agents.find(a => a.id === targetId)
  if (!source) return
  const s = ensureAgentV2(source, world).human
  const reasonCodes = world.engine?.decisions?.[source.id]?.reasonCodes ?? []
  const harm = event.detail?.combat?.damage ?? 0
  const aggression = event.actionType === 'ATTACK' || event.actionType === 'ROB' || event.actionType === 'STEAL'
  if (aggression && target) {
    const t = ensureAgentV2(target, world).human
    const aware = event.agentIds.includes(target.id) && (event.witnessIds?.includes(target.id) ?? true)
    if (aware) {
      t.resentment[source.id] = Math.min(10, (t.resentment[source.id] ?? 0) + (harm ? 3 : 1))
      t.suspicion[source.id] = Math.min(10, (t.suspicion[source.id] ?? 0) + 2)
      t.trauma = Math.min(10, t.trauma + harm * .5)
      t.paranoia = Math.min(10, t.paranoia + (harm ? 1.5 : .5))
      if (harm > 0 && !t.significantExperiences.includes('FIRST_VIOLENCE_SUFFERED')) t.significantExperiences.push('FIRST_VIOLENCE_SUFFERED')
    }
    s.violenceEscalation = Math.min(10, s.violenceEscalation + (harm ? 2 : 1))
    s.desensitization = Math.min(10, s.desensitization + (harm ? 1 : .2))
    const justification = reasonCodes.includes('SELF_DEFENSE') ? .4 : reasonCodes.includes('SURVIVAL_NECESSITY') ? .7 : 1
    s.guilt = Math.min(10, s.guilt + Math.max(0, s.moralProfile.harmAversion - s.desperation / 2) * (harm ? .3 : .1) * justification)
    if (harm > 0) {
      s.confidence = Math.min(10, s.confidence + Math.max(0, 5 - s.moralProfile.violenceAversion) * .2)
      if (!s.significantExperiences.includes('FIRST_SERIOUS_VIOLENCE')) s.significantExperiences.push('FIRST_SERIOUS_VIOLENCE')
      s.fearReputation = Math.min(10, s.fearReputation + Math.min(2, (event.witnessIds?.length ?? 0) / 3))
      if (target.publicState.status === 'deceased') {
        if (!s.significantExperiences.includes('FIRST_KILL')) s.significantExperiences.push('FIRST_KILL')
        s.guilt = Math.min(10, s.guilt + s.moralProfile.killingAversion * .4)
      }
    }
    if (event.actionType === 'STEAL' && event.stateChanges.some(c => c.field.endsWith(':holder') && c.to === source.id) && !s.significantExperiences.includes('FIRST_THEFT')) s.significantExperiences.push('FIRST_THEFT')
    const trust = source.relationships.find(r => r.otherAgentId === target.id)?.trust ?? 5
    if (trust >= 7) s.betrayalProcess[target.id] = Math.min(10, (s.betrayalProcess[target.id] ?? 0) + 3)
    if (trust >= 7 && harm > 0 && !s.significantExperiences.includes('FIRST_BETRAYAL')) s.significantExperiences.push('FIRST_BETRAYAL')
    if (harm > 0) for (const witnessId of event.witnessIds ?? []) {
      if (witnessId === source.id || witnessId === target.id) continue
      const witness = world.agents.find(a => a.id === witnessId)
      if (!witness) continue
      const w = ensureAgentV2(witness, world).human
      w.paranoia = Math.min(10, w.paranoia + Math.max(0, 7 - (witness.dispositions?.riskTolerance ?? 5)) * .2)
      if (target.publicState.status === 'deceased') {
        const affection = witness.relationships.find(r => r.otherAgentId === target.id)?.affection ?? 0
        w.grief = Math.min(10, w.grief + affection * .4)
        if (!w.significantExperiences.includes('FIRST_WITNESSED_DEATH')) w.significantExperiences.push('FIRST_WITNESSED_DEATH')
      }
    }
  }
  const transfer = event.stateChanges.find(c => c.field.endsWith(':holder') && c.from === source.id && c.to === targetId)
  if (transfer && target && ['GIVE_ITEM', 'SPEAK'].includes(event.actionType ?? '')) {
    const t = ensureAgentV2(target, world).human
    t.socialDebt[source.id] = Math.min(10, (t.socialDebt[source.id] ?? 0) + 2)
  }
}
