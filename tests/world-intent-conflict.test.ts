import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderConflictingIntents } from '../server/world/intentConflict.ts'
import type { ProposedAction } from '../server/world/actionSchema.ts'

function entry(actorId: string, action: ProposedAction, score: number) {
  return { actorId, action, score, snapshotMinute: 15, value: actorId }
}
function consume(actorId: string, key: string): ProposedAction {
  return { actorId, actionType: 'DRINK', targetIds: [], locationId: 'shore', resourceKey: key, intendedAction: 'drink' }
}

test('same-tick scarce resource contest uses evaluated priority regardless of collection order', () => {
  const low = entry('low', consume('low', 'water'), 3)
  const high = entry('high', consume('high', 'water'), 9)
  const unrelated = entry('other', consume('other', 'food'), 1)
  assert.deepEqual(orderConflictingIntents([low, unrelated, high]), ['high', 'low', 'other'])
  assert.deepEqual(orderConflictingIntents([high, unrelated, low]), ['high', 'low', 'other'])
  assert.deepEqual(orderConflictingIntents([low, unrelated]), ['low', 'other'])
})

test('same-tick object claims use a stable tie break rather than first arrival', () => {
  const claim = (actorId: string) => entry(actorId, { actorId, actionType: 'TAKE_ITEM', targetIds: [],
    locationId: 'shore', usedItemIds: ['only-tool'], intendedAction: 'take tool' }, 5)
  const first = orderConflictingIntents([claim('a'), claim('b')])
  assert.deepEqual(orderConflictingIntents([claim('b'), claim('a')]), first)
  assert.deepEqual(new Set(first), new Set(['a', 'b']))
})
