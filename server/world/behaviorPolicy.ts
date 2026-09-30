import { decisionKeyMatches, ensureAgentV2 } from './agentV2State.ts'
import { randomUUID } from 'node:crypto'
import type { WorldState } from '../domain/worldTypes.ts'
import { type ProposedAction, type ActionIntent } from './actionSchema.ts'

export const ACTION_COOLDOWN_MINUTES = 360
function policy(world: WorldState, write = false) {
  const engine = world.engine!
  const state = structuredClone(engine.behavior ?? { history: [], plans: [] })
  state.history = state.history.filter(h => engine.minute - h.minute < ACTION_COOLDOWN_MINUTES)
  for (const plan of state.plans) if (plan.expiresMinute <= engine.minute && ['proposed', 'active'].includes(plan.status)) plan.status = 'expired'
  state.plans = state.plans.filter(p => p.expiresMinute > engine.minute - 1440)
  if (write) engine.behavior = state
  return state
}
export function actionIntent(action: ProposedAction): ActionIntent {
  return action.intent ?? (action.actionType === 'COOPERATE' ? 'PROPOSE_SURVIVAL_PLAN' : action.actionType === 'SPEAK' ? 'SOCIAL' : ['REST', 'SLEEP'].includes(action.actionType) ? 'RECOVER' : 'OTHER')
}
export function behaviorRejection(world: WorldState, action: ProposedAction): string | undefined {
  const state = policy(world), intent = actionIntent(action)
  const actor = world.agents.find(a => a.id === action.actorId)!
  const compatible: Partial<Record<ActionIntent, string[]>> = {
    PROPOSE_SURVIVAL_PLAN: ['SPEAK', 'COOPERATE'], SEARCH_WATER: ['EXPLORE', 'TAKE_ITEM', 'DRINK', 'MOVE', 'USE_ITEM'],
    SEARCH_FOOD: ['EXPLORE', 'TAKE_ITEM', 'EAT', 'MOVE', 'USE_ITEM'], FIND_SHELTER: ['EXPLORE', 'MOVE'],
    QUESTION: ['SPEAK'], NEGOTIATE: ['SPEAK'], REQUEST_HELP: ['SPEAK'], SELF_STATE_DISCLOSURE:['SPEAK'], WARN: ['SPEAK'], THREATEN: ['SPEAK'],
    KEEP_WATCH: ['OBSERVE', 'EXPLORE'], RECOVER: ['REST', 'SLEEP'], SOCIAL: ['SPEAK', 'SHARE_INFO', 'COOPERATE'],
  }
  const prerequisite = Boolean(action.decisionV3 && ['MOVE','EXPLORE'].includes(action.actionType))
  if (compatible[intent] && !compatible[intent]!.includes(action.actionType) && !prerequisite) return 'intent_action_mismatch'
  if (['SEARCH_FOOD', 'SEARCH_WATER'].includes(intent)) {
    const kind = intent === 'SEARCH_FOOD' ? 'food' : 'water'
    if (['EAT', 'DRINK'].includes(action.actionType) && action.actionType !== (kind === 'food' ? 'EAT' : 'DRINK')) return 'intent_action_mismatch'
    if (['TAKE_ITEM', 'USE_ITEM'].includes(action.actionType) && world.engine!.objects.find(o => o.id === action.usedItemIds?.[0])?.kind !== kind) return 'intent_action_mismatch'
  }
  if (intent === 'PROPOSE_SURVIVAL_PLAN' && !action.targetIds.length) return 'cooperation_requires_present_partner'
  if (action.taskId) {
    const task = state.plans.filter(p => ['proposed', 'active'].includes(p.status)).flatMap(p => p.tasks).find(t => t.id === action.taskId)
    if (!task || task.actorId !== actor.id || task.intent !== intent || task.status !== 'suggested') return 'task_not_available'
  }
  if (intent === 'PROPOSE_SURVIVAL_PLAN' && state.plans.some(p => p.placeId === action.locationId && ['proposed', 'active'].includes(p.status))) return 'survival_plan_already_active'
  if (intent === 'PROPOSE_SURVIVAL_PLAN' && world.engine!.ongoingActions.some(a => a.proposal.locationId === action.locationId && actionIntent(a.proposal) === intent)) return 'survival_plan_already_active'
  if (action.actionType === 'ATTACK') {
    const reacting = actor.wakeReason === 'visible_attack_attempt' || world.engine!.ongoingActions.some(t => ['ATTACK', 'ROB'].includes(t.proposal.actionType) && t.proposal.targetIds.includes(actor.id))
    if (!reacting && ensureAgentV2(actor, world).recentActions.some(h => decisionKeyMatches(h.key, action) && world.engine!.minute - h.minute < 30)) return 'semantic_attack_cooldown_30m'
    return
  }
  // Physical need may remain urgent after a small meal, treatment or short rest.
  if (['EAT', 'DRINK', 'USE_ITEM', 'REST', 'SLEEP', 'WAIT'].includes(action.actionType)) return
  if (action.replyTo) return // A pending invitation is independently validated by the engine.
  if(action.actionType==='SHARE_INFO'&&action.factId&& !ensureAgentV2(actor,world).recentActions.some(h=>h.actionType==='SHARE_INFO'&&h.targetId===action.targetIds[0]&&h.factId===action.factId))return
  const duplicate=[...ensureAgentV2(actor, world).recentActions].reverse().find(h =>
    decisionKeyMatches(h.key, action) && world.engine!.minute - h.minute < ACTION_COOLDOWN_MINUTES)
  if (duplicate) {
    const targetId=action.targetIds[0]
    const dialogueAdvanced=action.actionType==='SPEAK'&&targetId&&action.spokenText&&
      action.spokenText!==duplicate.speech&&world.engine!.interactions?.some(i=>
        (i.actorId===targetId&&i.targetId===actor.id&&i.minute>duplicate.minute&&i.minute<=world.engine!.minute)||
        (Boolean(duplicate.eventId)&&i.actorId===actor.id&&i.targetId===targetId&&i.sourceEventId===duplicate.eventId&&i.status!=='pending'))
    if (!dialogueAdvanced) return 'semantic_action_cooldown_6h'
  }
}

export function rememberAction(world: WorldState, action: ProposedAction) {
  const state = policy(world, true)
  world.engine!.decisions ??= {}
  world.engine!.decisions[action.actorId] = { intent: actionIntent(action), actionType: action.actionType, minute: world.engine!.minute, basisEventIds: world.engine!.outcomes?.[action.actorId]?.slice(-3).map(o => o.eventId) ?? [] }
  action.taskId ??= state.plans.filter(p => ['proposed', 'active'].includes(p.status)).flatMap(p => p.tasks).find(t => t.actorId === action.actorId && t.intent === actionIntent(action) && t.status === 'suggested')?.id
  if (action.taskId) for (const p of state.plans) {
    const task = p.tasks.find(t => t.id === action.taskId && t.actorId === action.actorId)
    if (task) { task.status = 'in_progress'; p.status = 'active' }
  }
}
export function finishBehavior(world: WorldState, action: ProposedAction, success: boolean, result: string, sourceEventId?: string) {
  const state = policy(world, true)
  if (action.taskId) for (const p of state.plans) {
    const task = p.tasks.find(t => t.id === action.taskId && t.actorId === action.actorId)
    if (task) {
      // A search or move is a step, not proof that supplies/shelter were secured.
      task.status = success && !['EXPLORE', 'MOVE'].includes(action.actionType) ? 'completed' : 'blocked'
      task.result = result
      if (p.tasks.every(t => ['completed', 'blocked'].includes(t.status))) p.status = p.tasks.every(t => t.status === 'completed') ? 'completed' : 'exhausted'
    }
  }
  if (!success || actionIntent(action) !== 'PROPOSE_SURVIVAL_PLAN') return
  if (state.plans.some(p => p.placeId === action.locationId && ['active', 'proposed'].includes(p.status))) return
  const participants = [...new Set([action.actorId, ...action.targetIds])].filter(id => world.agents.some(a => a.id === id && a.publicState.locationId === action.locationId && ['alive', 'injured'].includes(a.publicState.status)))
  const roles: ActionIntent[] = ['SEARCH_WATER', 'SEARCH_FOOD', 'FIND_SHELTER', 'KEEP_WATCH']
  let slot = 0
  state.plans.push({ id: randomUUID(), sourceEventId, placeId: action.locationId, proposerId: action.actorId, participantIds: participants,
    createdMinute: world.engine!.minute, expiresMinute: world.engine!.minute + ACTION_COOLDOWN_MINUTES, status: 'proposed',
    tasks: participants.map(actorId => {
      const actor = world.agents.find(a => a.id === actorId)!
      const intent = (actor.humanState?.fatigue ?? 0) >= 7 ? 'RECOVER' : roles[slot++ % roles.length]
      return { id: randomUUID(), actorId, intent, status: actorId === action.actorId ? 'suggested' : 'invited' }
    }) })
}

export function behaviorContext(world: WorldState, actorId: string) {
  const state = policy(world), actor = world.agents.find(a => a.id === actorId)!
  const place = world.places.find(p => p.id === actor.publicState.locationId)!
  return {
    deliberation: { currentGoal: ensureAgentV2(actor, world).currentGoal,
      failedAreas: (world.engine!.outcomes?.[actorId] ?? []).filter(o => o.failed && o.actionType === 'EXPLORE' && world.engine!.minute - o.minute < 360).map(o => ({ area: o.area, eventId: o.eventId })) },
    previousDecision: world.engine!.decisions?.[actorId],
    outcomes: world.engine!.outcomes?.[actorId]?.slice(-8) ?? [],
    invitations: world.engine!.interactions?.filter(i => i.targetId === actorId && i.status === 'pending' && i.expiresMinute > world.engine!.minute).slice(-4) ?? [],
    cooldownMinutes: ACTION_COOLDOWN_MINUTES,
    recent: ensureAgentV2(actor, world).recentActions.slice(-12),
    plans: state.plans.filter(p => p.participantIds.includes(actorId) && ['active', 'proposed'].includes(p.status)).map(p => ({ id: p.id, status: p.status, expiresMinute: p.expiresMinute, tasks: p.tasks.filter(t => t.actorId === actorId).map(t => ({ ...t, result: t.result?.slice(0, 200) })) })),
    priorities: [
      ...((actor.humanState?.fatigue ?? 0) >= 7 ? ['REST/SLEEP: fatigue is severe'] : []),
      ...place.resources.filter(r => r.level >= 1 && ['food', 'water'].includes(r.key)).map(r => `${r.key === 'food' ? 'EAT' : 'DRINK'} resourceKey=${r.key}: use only if hungry/thirsty`),
      'Execute your suggested task if feasible; using taskId accepts only your own task.',
      'TAKE_ITEM existing supplies; EXPLORE a different area; OBSERVE to keep watch. Empty search is a real result, not a discovery.',
      'No shelter construction or fire-making without defined engine effects/materials. FIND_SHELTER means search for an existing shelter.',
    ],
  }
}
