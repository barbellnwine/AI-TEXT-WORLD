import { test } from 'node:test'
import assert from 'node:assert/strict'
import { combatMark, sceneHasCombat, usedFirearm } from '../src/world/combatMarks.ts'
import type { Agent, ChronicleEntry } from '../src/world/types.ts'

const agent = (id: string, coord: { x: number; y: number } | undefined, status = 'alive') => ({
  id, name: id, publicState: { status, locationId: 'shore', coord },
} as unknown as Agent)

const scene = (over: Partial<ChronicleEntry> = {}) => ({
  id: 'scene-1', kind: 'LIVE', seasonId: 's', worldDay: 1, timeStart: '08:00', timeEnd: '08:30',
  title: '모래사장의 아침', body: '두 사람이 마주 섰다.', locationIds: ['shore'], agentIds: ['a', 'b'],
  sourceEventIds: [], stateChanges: [], importance: 'ordinary', createdAt: '', ...over,
} as unknown as ChronicleEntry)

const wounded = { field: 'agent:a:health', from: '1', to: '5' }
const killed = { field: 'agent:b:status', from: 'injured', to: 'deceased' }

test('a scene is a fight only when the engine recorded damage or a death', () => {
  assert.equal(sceneHasCombat(scene()), false)
  assert.equal(sceneHasCombat(scene({ stateChanges: [wounded] })), true)
  assert.equal(sceneHasCombat(scene({ stateChanges: [killed] })), true)
  // Healing, a move, and a status change that is not a death are not fights.
  assert.equal(sceneHasCombat(scene({ stateChanges: [{ field: 'agent:a:health', from: '5', to: '2' }] })), false)
  assert.equal(sceneHasCombat(scene({ stateChanges: [{ field: 'agent:a:travel', from: '1,1', to: 'ridge@90' }] })), false)
  assert.equal(sceneHasCombat(scene({ stateChanges: [{ field: 'agent:a:status', from: 'alive', to: 'injured' }] })), false)
})

test('the weapon is read from the scene\'s own words', () => {
  assert.equal(usedFirearm(scene({ body: '그는 소총을 들어 올렸다.' })), true)
  assert.equal(usedFirearm(scene({ title: '총성', body: '멀리서 소리가 났다.' })), true)
  assert.equal(usedFirearm(scene({ body: '그는 나무창을 찔러 넣었다.' })), false)
})

test('gunfire and close-quarters marks sit at the middle of the people who fought', () => {
  const agents = [agent('a', { x: 100, y: 200 }), agent('b', { x: 300, y: 400 }), agent('c', { x: 999, y: 999 })]
  const shot = combatMark(scene({ stateChanges: [wounded], body: '총구가 불을 뿜었다.' }), agents)
  assert.deepEqual(shot, { sceneId: 'scene-1', kind: 'gunfire', coord: { x: 200, y: 300 }, agentIds: ['a', 'b'] })
  // Someone who was not in the scene does not pull the mark towards them.
  const blade = combatMark(scene({ stateChanges: [killed], body: '칼이 어둠 속에서 번뜩였다.' }), agents)
  assert.equal(blade?.kind, 'melee')
  assert.deepEqual(blade?.coord, { x: 200, y: 300 })
})

test('a scene with no fight, and a fight with no coordinates, are not marked', () => {
  const agents = [agent('a', { x: 100, y: 200 })]
  assert.equal(combatMark(scene(), agents), null)
  assert.equal(combatMark(scene({ stateChanges: [wounded] }), [agent('a', undefined)]), null)
})

test('a fight whose cast has no coordinate falls back to the region the scene names', () => {
  const geo = { regions: [{ placeId: 'shore', center: { x: 50, y: 60 } }] } as never
  const found = combatMark(scene({ stateChanges: [wounded] }), [agent('a', undefined)], geo)
  assert.deepEqual(found?.coord, { x: 50, y: 60 })
})

test('the mark is tied to its scene, so the next scene replaces it', () => {
  const agents = [agent('a', { x: 10, y: 10 })]
  assert.equal(combatMark(scene({ id: 'scene-7', stateChanges: [wounded] }), agents)?.sceneId, 'scene-7')
  // The scene after a fight carries no state change of its own: nothing is marked.
  assert.equal(combatMark(scene({ id: 'scene-8' }), agents), null)
})
