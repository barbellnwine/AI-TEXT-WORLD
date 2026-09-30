import { test } from 'node:test'
import assert from 'node:assert/strict'
import { traumaFixture } from './trauma-fixture.ts'
import { beginAction, validateEngineAction } from '../server/world/worldEngine.ts'
import { ensureAgentV2, rememberIntent, rememberResult, rememberSocialRefusal } from '../server/world/agentV2State.ts'
import { prepareDecision, bindCandidate } from '../server/world/decisionController.ts'
import { agentRequest, parseProposedAction, worldRequestBody } from '../server/domain/worldAgent.ts'
import { getRulePreset } from '../server/domain/rulePresets.ts'
import * as store from '../server/domain/worldStore.ts'
import { deliberation } from '../server/world/motivations.ts'
import { DEFAULT_DISPOSITIONS } from '../server/world/dispositions.ts'
import type { ProposedAction } from '../server/world/actionSchema.ts'

test('one model response carries a bounded plan while candidate binding keeps the executable action fixed', async () => {
  const f = traumaFixture()
  try {
    const choices = prepareDecision(f.world, f.a.id, f.events).choices
    const selected = choices.find(c => c.action.actionType === 'OBSERVE')!
    assert.ok(selected)
    const raw = { ...selected.action, candidateId: selected.id, targetIds: ['invented'], usedItemIds: [], publicAction: '상대를 살핀다', publicReason: '위험을 판단하려 했다',
      decisionV3: { transition: 'MODIFY', goal: 'observe then negotiate', purpose: 'assess a visible person', method: 'watch first',
        nextSteps: ['SPEAK'], nextStepTargets: [f.b.id], expectedReward: 6, expectedRisk: 2 } }
    const parsed = parseProposedAction(raw, f.a.id)
    const bound = bindCandidate(parsed, choices)
    assert.deepEqual(bound.targetIds, selected.action.targetIds)
    assert.equal(bound.decisionV3?.nextSteps[0], 'SPEAK')
    const start = beginAction(f.world, bound); f.events.push(start)
    assert.equal(f.a.v2!.decisionV3!.goalDescription, raw.decisionV3.goal)
    assert.equal(f.a.v2!.decisionV3!.steps[0], bound.actionType)
    assert.throws(() => parseProposedAction({ ...raw, decisionV3: { ...raw.decisionV3, nextSteps: ['INVENT_ITEM'] } }, f.a.id), /invalid_decision_plan/)
  } finally { await f.close() }
})

test('a goal survives observation and speech as separate steps; dialogue has a real addressed reaction opportunity', async () => {
  const f = traumaFixture()
  try {
    const base = { actorId: f.a.id, locationId: f.place.id, targetIds: [f.b.id] }
    const observe: ProposedAction = { ...base, actionType: 'OBSERVE', intendedAction: '상대의 태도를 살핀다', goalKey: 'BUILD_TRUST',
      decisionV3: { transition: 'MODIFY', goal: 'build a working relationship', purpose: 'learn whether dialogue is safe', method: 'watch then speak', nextSteps: ['SPEAK'], nextStepTargets: [f.b.id], expectedReward: 6, expectedRisk: 2 } }
    assert.equal(validateEngineAction(observe, f.world, f.events).approved, true)
    const start = beginAction(f.world, observe); f.events.push(start)
    const goalId = f.a.motivations!.currentId
    const created = ensureAgentV2(f.a, f.world).decisionV3!.createdMinute
    f.tick(65)
    const plan = ensureAgentV2(f.a, f.world).decisionV3!
    assert.equal(plan.goal, 'BUILD_TRUST')
    assert.equal(plan.steps[plan.stepIndex], 'SPEAK')
    const speak: ProposedAction = { ...base, actionType: 'SPEAK', intent: 'NEGOTIATE', intendedAction: '협력 조건을 묻는다',
      spokenText: '서로 도울 수 있는 조건이 있을까?', goalKey: 'NEGOTIATE',
      decisionV3: { transition: 'CONTINUE', goal: 'build a working relationship', purpose: 'test a proposal', method: 'ask directly', nextSteps: ['COOPERATE'], nextStepTargets: [f.b.id], expectedReward: 6, expectedRisk: 3 } }
    assert.equal(validateEngineAction(speak, f.world, f.events).approved, true)
    const speech = beginAction(f.world, speak); f.events.push(speech)
    assert.equal(f.a.motivations!.currentId, goalId)
    assert.equal(f.a.v2!.decisionV3!.createdMinute, created)
    f.tick(5)
    assert.ok(f.events.some(e => e.actionId === speech.actionId && e.phase === 'COMPLETED' && e.publicQuote === speak.spokenText))
    assert.equal(f.b.wakeReason, 'addressed_directly')
    assert.ok(f.b.nextDecisionAt! <= f.world.engine!.minute)
  } finally { await f.close() }
})

test('a cooperation proposal carries its words and wakes the recipient for an independent reply', async () => {
  const f = traumaFixture()
  try {
    const proposal: ProposedAction = { actorId: f.a.id, locationId: f.place.id, targetIds: [f.b.id],
      actionType: 'COOPERATE', intent: 'PROPOSE_SURVIVAL_PLAN', intendedAction: '함께 물자를 찾자고 제안한다',
      spokenText: '함께 물을 찾고 나누자.' }
    assert.equal(validateEngineAction(proposal, f.world, f.events).approved, true)
    const start = beginAction(f.world, proposal); f.events.push(start)
    f.tick(35)
    const result = f.events.find(e => e.actionId === start.actionId && e.phase === 'COMPLETED')!
    assert.ok(result)
    assert.equal(result.publicQuote, proposal.spokenText)
    assert.equal(f.b.wakeReason, 'addressed_directly')
    assert.ok(f.b.nextDecisionAt! <= f.world.engine!.minute)
    assert.ok(f.world.engine!.interactions?.some(i => i.actorId === f.a.id && i.targetId === f.b.id && i.status === 'pending'))
  } finally { await f.close() }
})

test('failed exploration records evidence and requests a different next method without inventing a resource', async () => {
  const f = traumaFixture()
  try {
    f.world.engine!.objects = []
    const action: ProposedAction = { actorId: f.a.id, locationId: f.place.id, targetIds: [], actionType: 'EXPLORE', areaHint: 'CENTER',
      searchPoint: { x: .1, y: .1 }, intendedAction: '빈 구역을 탐색한다', goalKey: 'SEEK_KNOWN_ITEM',
      decisionV3: { transition: 'MODIFY', goal: 'find a usable resource', purpose: 'improve survival options', method: 'search nearby', nextSteps: ['TAKE_ITEM'], nextStepTargets: [null], expectedReward: 7, expectedRisk: 2 } }
    const start = beginAction(f.world, action); f.events.push(start)
    f.tick(35)
    const plan = ensureAgentV2(f.a, f.world).decisionV3!
    assert.equal(plan.lastResult, 'failed')
    assert.equal(plan.replanRequired, true)
    assert.equal(plan.failureCount, 1)
    assert.ok(plan.sourceEventIds.some(id => f.events.some(e => e.id === id && e.actionId === start.actionId)))
    assert.equal(f.world.engine!.objects.length, 0)
    const next = prepareDecision(f.world, f.a.id, f.events)
    assert.ok(next.choices.every(c => c.action.searchPoint?.x !== .1 || c.action.searchPoint?.y !== .1))
  } finally { await f.close() }
})

test('a planned social step can recruit a different person without losing the primary rival goal', async () => {
  const f = traumaFixture()
  try {
    const helper = f.world.agents[2]
    const first: ProposedAction = { actorId: f.a.id, locationId: f.place.id, targetIds: [f.b.id], actionType: 'OBSERVE',
      intendedAction: '경쟁자를 살핀다', goalKey: 'CONFRONT_RIVAL',
      decisionV3: { transition: 'MODIFY', goal: 'reduce the rival threat', purpose: 'find assistance', method: 'watch then recruit',
        nextSteps: ['SPEAK'], nextStepTargets: [helper.id], expectedReward: 7, expectedRisk: 4 } }
    rememberIntent(f.a, first, 'watch', 0)
    f.a.v2!.decisionV3!.stepIndex = 1
    const prepared = prepareDecision(f.world, f.a.id, f.events)
    const speak = prepared.choices.find(c => c.action.actionType === 'SPEAK' && c.action.targetIds.includes(helper.id))
    assert.ok(speak)
    assert.equal(prepared.choices[0].id, speak.id)
    const follow: ProposedAction = { ...speak.action, decisionV3: { transition: 'CONTINUE', goal: 'reduce the rival threat',
      purpose: 'recruit help', method: 'ask a third person', nextSteps: ['COOPERATE'], nextStepTargets: [helper.id], expectedReward: 7, expectedRisk: 4 } }
    rememberIntent(f.a, follow, 'recruit', 1)
    assert.equal(f.a.v2!.currentGoal, 'CONFRONT_RIVAL')
    assert.equal(f.a.v2!.decisionV3!.targetId, f.b.id)
    assert.equal(f.a.v2!.decisionV3!.createdMinute, 0)
  } finally { await f.close() }
})

test('a missed attack and a refused proposal each feed a specific replanning signal', async () => {
  const f = traumaFixture()
  try {
    const action: ProposedAction = { actorId: f.a.id, locationId: f.place.id, targetIds: [f.b.id], actionType: 'ATTACK',
      intendedAction: '위협을 줄이려 한다', goalKey: 'DEFEND_SELF',
      decisionV3: { transition: 'MODIFY', goal: 'remain safe', purpose: 'interrupt a threat', method: 'strike', nextSteps: ['OBSERVE'], nextStepTargets: [f.b.id], expectedReward: 6, expectedRisk: 6 } }
    rememberIntent(f.a, action, 'strike', 0)
    rememberResult(f.a, { id: 'miss', actionId: 'strike', actionType: 'ATTACK', phase: 'COMPLETED', worldMinute: 1,
      detail: { combat: { targetId: f.b.id, damage: 0, outcome: 'DODGED' } }, stateChanges: [] } as never, action)
    assert.equal(f.a.v2!.decisionV3!.lastResult, 'failed')
    assert.equal(f.a.v2!.decisionV3!.replanRequired, true)
    assert.equal(f.a.v2!.decisionV3!.failureCount, 1)
    f.world.engine!.interactions ??= []
    f.world.engine!.interactions.push({ id: 'offer', actorId: f.a.id, targetId: f.b.id, placeId: f.place.id,
      area: 'CENTER', minute: 1, expiresMinute: 60, intent: 'NEGOTIATE', status: 'refused', sourceEventId: 'offer-source' })
    rememberSocialRefusal(f.world, { id: 'refusal', phase: 'COMPLETED', worldMinute: 2,
      stateChanges: [{ field: 'interaction:offer:status', from: 'pending', to: 'refused' }] } as never)
    assert.equal(f.a.v2!.decisionV3!.lastResult, 'refused')
    assert.equal(f.a.v2!.decisionV3!.lastFailureReason, 'proposal_refused')
    assert.ok(f.a.v2!.decisionV3!.sourceEventIds.includes('refusal'))
  } finally { await f.close() }
})

test('five agents facing two food portions and a deadline see a broad, personality-weighted conflict space', async () => {
  const f = traumaFixture()
  try {
    f.world.engine!.competition = { endMinute: 2880, lastSurvivor: true }
    f.place.resources = [{ key: 'food', level: 2 }] as typeof f.place.resources
    for (const actor of f.world.agents) {
      actor.publicState.position = { x: .5, y: .5 }
      actor.vitals!.hunger = 7; actor.humanState!.survival_need = 7
    }
    const willing = f.world.agents[0], cautious = f.world.agents[1]
    willing.dispositions = { ...DEFAULT_DISPOSITIONS, aggression: 9, competitiveness: 9, riskTolerance: 9, selfInterest: 9, empathy: 1 }
    cautious.dispositions = { ...DEFAULT_DISPOSITIONS, aggression: 0, competitiveness: 0, riskTolerance: 0, empathy: 9 }
    const views = f.world.agents.map(actor => deliberation(f.world, actor.id, f.events))
    assert.equal(views.length, 5)
    assert.ok(views.every(view => view.scarce))
    assert.ok(views[0].choices.some(c => c.action.actionType === 'SPEAK' && c.action.intent === 'REQUEST_HELP'))
    assert.ok(views[0].choices.some(c => c.action.actionType === 'COOPERATE'))
    assert.ok(views[0].choices.some(c => c.action.actionType === 'ATTACK'))
    const initial = views[0].choices.find(c => c.action.actionType === 'ATTACK' && c.action.targetIds[0] === cautious.id)!.benefit
    f.world.engine!.minute = 2400
    const urgent = deliberation(f.world, willing.id, f.events).choices.find(c => c.action.actionType === 'ATTACK' && c.action.targetIds[0] === cautious.id)!.benefit
    assert.ok(urgent > initial)
    assert.ok(prepareDecision(f.world, cautious.id, f.events).choices.some(c => !['ATTACK', 'ROB'].includes(c.action.actionType)))
  } finally { await f.close() }
})

test('a trusted attacker remains a remembered threat after several later decision windows', async () => {
  const f = traumaFixture()
  try {
    f.world.engine!.requireCombatAdjudication = false
    f.a.publicState.position = f.b.publicState.position = { x: .5, y: .5 }
    f.a.relationships.push({ agentId: f.a.id, otherAgentId: f.b.id, stance: 'friendly', trust: 9, affection: 8 })
    f.b.relationships.push({ agentId: f.b.id, otherAgentId: f.a.id, stance: 'friendly', trust: 9, affection: 8 })
    const strike = beginAction(f.world, { actorId: f.b.id, locationId: f.place.id, targetIds: [f.a.id], actionType: 'ATTACK',
      aim: 'TORSO', intendedAction: '신뢰하던 상대를 공격한다' })
    f.events.push(strike)
    f.tick(5)
    const incident = f.events.find(e => e.actionId === strike.actionId && e.phase === 'COMPLETED')!
    assert.ok(incident)
    assert.ok(f.a.memories?.some(m => m.sourceEventIds.includes(incident.id)))
    const resentment = f.a.v2!.human.resentment[f.b.id]
    assert.ok(resentment > 0)
    f.tick(180); f.tick(180); f.tick(180)
    assert.ok(f.a.memories?.some(m => m.sourceEventIds.includes(incident.id)))
    assert.ok(f.a.v2!.human.resentment[f.b.id] >= resentment)
    assert.ok(deliberation(f.world, f.a.id, f.events).choices.some(c => c.action.targetIds.includes(f.b.id) &&
      ['PRESS_RIVAL', 'CONFRONT_RIVAL', 'DEESCALATE'].includes(c.goal)))
  } finally { await f.close() }
})

test('a persisted multi-step plan remains inside the paid request limit without mutating its saved form', async () => {
  const f = traumaFixture()
  try {
    rememberIntent(f.a, { actorId: f.a.id, locationId: f.place.id, targetIds: [f.b.id], actionType: 'OBSERVE',
      intendedAction: '위험을 관찰한다', goalKey: 'KEEP_SAFE', decisionV3: { transition: 'MODIFY',
        goal: 'G'.repeat(120), purpose: 'P'.repeat(160), method: 'M'.repeat(160),
        nextSteps: ['EXPLORE', 'SPEAK', 'COOPERATE', 'MOVE'], nextStepTargets: [null, f.b.id, f.b.id, null],
        expectedReward: 8, expectedRisk: 3 } }, 'long-plan', 0)
    const saved = JSON.stringify(f.a.v2!.decisionV3)
    const rules = getRulePreset(f.db, f.draft.rulePresetId!)!.rules
    const request = agentRequest({ draft: f.draft, rules, mode: 'live' }, f.a.id, f.world, f.events,
      prepareDecision(f.world, f.a.id, f.events))
    assert.ok(Buffer.byteLength(worldRequestBody(request)) <= 20_000)
    assert.equal(JSON.stringify(f.a.v2!.decisionV3), saved)
  } finally { await f.close() }
})

test('V3 intent survives a season checkpoint while a legacy V2 actor remains loadable', async () => {
  const f = traumaFixture()
  try {
    const action: ProposedAction = { actorId: f.a.id, locationId: f.place.id, targetIds: [f.b.id], actionType: 'OBSERVE',
      intendedAction: '관찰 후 접근한다', goalKey: 'KEEP_SAFE', decisionV3: { transition: 'MODIFY', goal: 'establish contact',
        purpose: 'understand risk', method: 'observe then talk', nextSteps: ['SPEAK'], nextStepTargets: [f.b.id], expectedReward: 5, expectedRisk: 3 } }
    const started = beginAction(f.world, action); f.events.push(started)
    const saved = structuredClone(f.a.v2!.decisionV3)
    delete ensureAgentV2(f.b, f.world).decisionV3
    await store.shutdownWorldRuntime()
    store.initializeWorldRuntime(f.db)
    store.stopSimulationTimerForTests()
    const restored = store.getWorldState()
    assert.deepEqual(restored.agents.find(a => a.id === f.a.id)!.v2!.decisionV3, JSON.parse(JSON.stringify(saved)))
    assert.equal(ensureAgentV2(restored.agents.find(a => a.id === f.b.id)!, restored).version, 2)
  } finally { await f.close() }
})
