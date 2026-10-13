import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carriedGear, conditionGroups, gaugeTone, looseInventory, sheetLabel, SHEET_LABEL_KEYS, woundReport, type EngineObject } from '../src/world/characterSheet.ts'
import type { Agent } from '../src/world/types.ts'

function person(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'a1', name: '한서진', codeNumber: 'C-01', avatarId: 'default', shortBio: '응급실 간호사 · 침착하다.',
    factionIds: [], publicState: { locationId: 'p1', status: 'alive', visibleGoal: null, lastAction: null, lastActiveAt: '2026-10-14T00:00:00.000Z' },
    relationships: [], inventory: [], knowledge: [], movementLog: [], keyEventIds: [], ...overrides,
  }
}

function thing(overrides: Partial<EngineObject> & { id: string }): EngineObject {
  return { name: '물건', kind: 'item', quantity: 1, condition: 'intact', location: { kind: 'place', id: 'p1' }, ...overrides }
}

// The whole point of the sheet is that a reader does not have to know which scales run which way.
test('a gauge is read against the direction that is bad news for it', () => {
  assert.equal(gaugeTone(10, 'low'), 'good', '건강 10')
  assert.equal(gaugeTone(10, 'high'), 'bad', '허기 10')
  assert.equal(gaugeTone(0, 'low'), 'bad', '건강 0')
  assert.equal(gaugeTone(0, 'high'), 'good', '허기 0')
  assert.equal(gaugeTone(5, 'high'), 'watch')
  assert.equal(gaugeTone(5, 'low'), 'watch')
})

test('the sheet draws the readings the payload carries, grouped, and says nothing about the rest', () => {
  const groups = conditionGroups(person({
    vitals: { health: 10, energy: 8, hunger: 2, thirst: 2, loneliness: 2 },
    emotion: { mood: 5, anger: 8, fear: 6 },
  }))
  assert.deepEqual(groups.map(g => g.key), ['body', 'mind'], 'no exposure block without exposure readings')
  assert.deepEqual(groups[0].gauges.map(g => g.key), ['health', 'energy', 'hunger', 'thirst'])
  // humanState is absent here, so 피로 and 스트레스 are simply not rows — only what we were told.
  assert.deepEqual(groups[1].gauges.map(g => g.key), ['mood', 'anger', 'fear', 'loneliness'])
  assert.equal(groups[1].gauges.find(g => g.key === 'anger')!.tone, 'bad')
  assert.equal(groups[0].gauges.find(g => g.key === 'health')!.tone, 'good')
})

// A season launched before vitals existed has none of these fields. The sheet has to open anyway.
test('a person the engine keeps no readings on gets no gauges rather than a wall of zeroes', () => {
  assert.deepEqual(conditionGroups(person()), [])
})

test('carried gear is what the engine says this person holds, weapons first', () => {
  const objects = [
    thing({ id: 'o1', name: '단검', kind: 'tool', location: { kind: 'agent', id: 'a1' }, physical: { material: 'other', edge: 'sharp', portable: true, attackPower: 2, cover: 0 } }),
    thing({ id: 'o2', name: '붕대', kind: 'medicine', location: { kind: 'agent', id: 'a1' }, quantity: 3 }),
    thing({ id: 'o3', name: '다른 사람의 돌', location: { kind: 'agent', id: 'a2' }, physical: { material: 'stone', edge: 'blunt', portable: true, attackPower: 1, cover: 0 } }),
    thing({ id: 'o4', name: '땅에 떨어진 나뭇가지', location: { kind: 'place', id: 'p1' } }),
  ]
  const gear = carriedGear('a1', objects)
  assert.deepEqual(gear.map(g => g.name), ['단검', '붕대'])
  assert.equal(gear[0].attackPower, 2)
  assert.equal(gear[0].edge, 'sharp')
  assert.equal(gear[1].quantity, 3)
  assert.equal(gear[1].attackPower, 0, 'a thing with no physical properties is not a weapon')
  assert.deepEqual(carriedGear('a1', []), [])
  assert.deepEqual(carriedGear('a1'), [], 'a world with no object engine still opens the sheet')
})

// The string list is what an older season has instead of objects, so it cannot just be dropped.
test('inventory strings no carried object accounts for are still shelved', () => {
  const objects = [thing({ id: 'o1', name: '단검', location: { kind: 'agent', id: 'a1' } })]
  const agent = person({ inventory: ['단검', '라이터'] })
  assert.deepEqual(looseInventory(agent, carriedGear('a1', objects)), ['라이터'])
  assert.deepEqual(looseInventory(person({ inventory: ['라이터'] }), []), ['라이터'])
})

const wound = { id: 'w1', sourceEventId: 'e1', onset: 10, treatedAt: null, healed: false,
  part: 'HEAD' as const, type: 'laceration' as const, site: 'face' as const, severity: 2, bleeding: 1, pain: 3,
  healingHours: 48, effects: [{ function: 'vision' as const, degree: 0.4, mechanism: 'blood_obstruction' as const }] }

test('the injuries block reports what is still open, worst first, and who still needs care', () => {
  const report = woundReport(person({
    trauma: { version: 1, lastMinute: 60, bloodLoss: 0.08, pain: 4.2,
      functions: { vision: 0.4, mobility: 0, dexterity: 0.1, attention: 0 },
      injuries: [wound, { ...wound, id: 'w2', severity: 4, treatedAt: 50 }, { ...wound, id: 'w3', severity: 5, healed: true }] },
  }))!
  assert.deepEqual(report.injuries.map(w => w.id), ['w2', 'w1'], 'healed wounds are past, not condition')
  assert.equal(report.untreated, 1)
  assert.equal(report.pain, 4.2)
  assert.deepEqual(report.functions, [{ key: 'vision', loss: 0.4 }, { key: 'dexterity', loss: 0.1 }])
})

test('a person who has mended does not get an injuries block', () => {
  assert.equal(woundReport(person()), null)
  assert.equal(woundReport(person({
    trauma: { version: 1, lastMinute: 60, bloodLoss: 0, pain: 0,
      functions: { vision: 0, mobility: 0, dexterity: 0, attention: 0 }, injuries: [{ ...wound, healed: true, treatedAt: 20 }] },
  })), null)
})

// Every value the panel can turn into a label, by the vocabulary the engine actually emits.
test('the sheet has a word in both languages for everything it can be handed', () => {
  const keys = [
    ...['body', 'mind', 'exposure'].map(k => `group:${k}`),
    ...['health', 'energy', 'hunger', 'thirst', 'loneliness', 'fatigue', 'stress', 'mood', 'anger', 'fear', 'wetness', 'cold', 'heat', 'skin', 'infection'].map(k => `gauge:${k}`),
    ...['item', 'food', 'water', 'medicine', 'tool', 'fuel'].map(k => `kind:${k}`),
    ...['intact', 'damaged', 'destroyed'].map(k => `condition:${k}`),
    ...['sharp', 'blunt'].map(k => `edge:${k}`),
    ...['HEAD', 'TORSO', 'ARM', 'LEG'].map(k => `part:${k}`),
    ...['abrasion', 'laceration', 'contusion', 'fracture'].map(k => `injury:${k}`),
    ...['scalp', 'face', 'eye'].map(k => `site:${k}`),
    ...['vision', 'mobility', 'dexterity', 'attention'].map(k => `function:${k}`),
    ...['ally', 'friendly', 'neutral', 'wary', 'hostile'].map(k => `stance:${k}`),
  ]
  for (const key of keys) {
    assert.ok(SHEET_LABEL_KEYS.includes(key), `${key} has no word in the sheet vocabulary`)
    for (const locale of ['ko-KR', 'en-US']) assert.ok(sheetLabel(key, locale).length > 0, `${key} reads as nothing in ${locale}`)
  }
  assert.equal(sheetLabel('gauge:infection', 'en-US'), 'Infection risk')
})

test('a kind this build has never heard of reads as itself instead of blanking the row', () => {
  assert.equal(sheetLabel('kind:lantern', 'ko-KR'), 'lantern')
})
