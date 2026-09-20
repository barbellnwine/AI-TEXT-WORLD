import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInitialWorldState } from '../server/domain/worldMock.ts'
import { validateAction, validateGmEvent } from '../server/world/worldValidator.ts'
import { resolveAction } from '../server/world/actionResolver.ts'
import { buildAgentKnowledgeView, agentKnowsFact } from '../server/world/knowledgeFilter.ts'
import type { ProposedAction } from '../server/world/actionSchema.ts'

function freshWorld() {
  return buildInitialWorldState()
}

test('a valid MOVE to a connected place is approved', () => {
  const worldState = freshWorld()
  const action: ProposedAction = {
    actorId: 'seo-jungyeong', actionType: 'MOVE', targetIds: [], locationId: 'generator-room',
    destinationId: 'control-room', intendedAction: '통제실로 이동',
  }
  const result = validateAction(action, { worldState, allEventIds: new Set() })
  assert.equal(result.approved, true)
})

test('MOVE to a place with no connection is rejected with NO_PATH', () => {
  const worldState = freshWorld()
  const action: ProposedAction = {
    actorId: 'seo-jungyeong', actionType: 'MOVE', targetIds: [], locationId: 'generator-room',
    destinationId: 'medical-bay', intendedAction: '의료실로 이동',
  }
  const result = validateAction(action, { worldState, allEventIds: new Set() })
  assert.equal(result.approved, false)
  assert.ok(result.reasons.includes('NO_PATH'))
})

test('an action from the wrong stated location is rejected with LOCATION_MISMATCH', () => {
  const worldState = freshWorld()
  const action: ProposedAction = {
    actorId: 'seo-jungyeong', actionType: 'OBSERVE', targetIds: [], locationId: 'medical-bay',
    intendedAction: '주변을 살핀다',
  }
  const result = validateAction(action, { worldState, allEventIds: new Set() })
  assert.equal(result.approved, false)
  assert.ok(result.reasons.includes('LOCATION_MISMATCH'))
})

test('a nonexistent actor is rejected', () => {
  const worldState = freshWorld()
  const action: ProposedAction = {
    actorId: 'ghost', actionType: 'WAIT', targetIds: [], locationId: 'control-room', intendedAction: '대기',
  }
  const result = validateAction(action, { worldState, allEventIds: new Set() })
  assert.equal(result.approved, false)
  assert.ok(result.reasons.includes('ACTOR_NOT_ACTIONABLE'))
})

test('using an item the actor does not own is rejected with ITEM_NOT_OWNED', () => {
  const worldState = freshWorld()
  const action: ProposedAction = {
    actorId: 'yu-rian', actionType: 'USE_ITEM', targetIds: [], locationId: 'living-quarters',
    intendedAction: '무전기를 사용한다', usedItemIds: ['radio'],
  }
  const result = validateAction(action, { worldState, allEventIds: new Set() })
  assert.equal(result.approved, false)
  assert.ok(result.reasons.includes('ITEM_NOT_OWNED'))
})

test('the same action repeated past the limit is rejected with REPETITION_LIMIT', () => {
  const worldState = freshWorld()
  const action: ProposedAction = {
    actorId: 'yu-rian', actionType: 'OBSERVE', targetIds: [], locationId: 'living-quarters', intendedAction: '조용히 지켜본다',
  }
  const recentActionsByActor = [action, action, action]
  const result = validateAction(action, { worldState, allEventIds: new Set(), recentActionsByActor })
  assert.equal(result.approved, false)
  assert.ok(result.reasons.includes('REPETITION_LIMIT'))
})

test('resolveAction records CONFIRMED for an approved action and REJECTED for a rejected one', () => {
  const worldState = freshWorld()
  const approved = resolveAction(
    { actorId: 'seo-jungyeong', actionType: 'MOVE', targetIds: [], locationId: 'generator-room', destinationId: 'control-room', intendedAction: '통제실로 이동' },
    { approved: true, reasons: [], notes: [] },
    worldState,
    { id: 'evt-test-1', occurredAt: new Date().toISOString(), day: 3, title: '이동', summary: '서준경이 통제실로 이동했다.' }
  )
  assert.equal(approved.outcome, 'CONFIRMED')
  assert.equal(approved.stateChanges.length, 1)

  const rejected = resolveAction(
    { actorId: 'seo-jungyeong', actionType: 'MOVE', targetIds: [], locationId: 'generator-room', destinationId: 'medical-bay', intendedAction: '의료실로 이동' },
    { approved: false, reasons: ['NO_PATH'], notes: [] },
    worldState,
    { id: 'evt-test-2', occurredAt: new Date().toISOString(), day: 3, title: '이동 시도', summary: '경로가 없어 실패했다.' }
  )
  assert.equal(rejected.outcome, 'REJECTED')
  assert.equal(rejected.stateChanges.length, 0)
})

test('a GM/operator event referencing a nonexistent place is rejected', () => {
  const worldState = freshWorld()
  const result = validateGmEvent({ placeId: 'orbital-station', agentIds: [] }, worldState)
  assert.equal(result.approved, false)
})

test('a GM/operator event referencing only real places and agents is approved', () => {
  const worldState = freshWorld()
  const result = validateGmEvent({ placeId: 'medical-bay', agentIds: ['im-haneul'] }, worldState)
  assert.equal(result.approved, true)
})

test('an agent knowledge view never includes another agent private knowledge or hiddenNotes', () => {
  const worldState = freshWorld()
  const view = buildAgentKnowledgeView('han-doyun', worldState, [])
  assert.ok(view)
  assert.equal((view as unknown as { hiddenNotes?: unknown }).hiddenNotes, undefined)
  const serialized = JSON.stringify(view)
  assert.ok(!serialized.includes('HIDDEN WORLD TRUTH'))
  // moon-gaon's hiddenNotes text must never leak into another agent's view either.
  assert.ok(!serialized.includes('환기구'))
})

test('agentKnowsFact is true only for the agent\'s own recorded knowledge or events they were part of', () => {
  const worldState = freshWorld()
  assert.equal(agentKnowsFact('baek-seungri', 'evt-12', worldState, []), true)
  assert.equal(agentKnowsFact('yu-rian', 'evt-12', worldState, []), false)
})
