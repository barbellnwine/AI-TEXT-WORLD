import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nightImageNeeded, nightLevelAt } from '../src/world/dayNight.ts'

const at = (hour: number, minute = 0) => nightLevelAt(hour * 60 + minute)

// These are the hours server/world/worldEngine.ts sets clock.timeOfDay by. If that line moves, the
// map would go dark at a different time from the one the characters go blind at, and these fail.
test('the map is fully dark exactly through lateNight and night', () => {
  for (const hour of [0, 2, 4]) assert.equal(at(hour), 1, `${hour}:00 is lateNight`)
  for (const hour of [20, 22, 23]) assert.equal(at(hour), 1, `${hour}:00 is night`)
  assert.equal(at(4, 59), 1)
  assert.equal(at(23, 59), 1)
})

test('the map is fully lit exactly through morning and afternoon', () => {
  for (const hour of [7, 9, 12, 14, 16]) assert.equal(at(hour), 0, `${hour}:00 is daylight`)
  assert.equal(at(16, 59), 0)
})

test('dawn lifts the dark over its two hours and dusk lays it back over its three', () => {
  assert.equal(at(5), 1)
  assert.equal(at(6), 0.5)
  assert.equal(at(7), 0)
  assert.equal(at(17), 0)
  assert.equal(at(18, 30), 0.5)
  assert.equal(at(20), 1)
  // Monotonic in both directions: no stretch of dusk ever gets lighter.
  for (let m = 17 * 60; m < 20 * 60; m++) assert.ok(nightLevelAt(m + 1) >= nightLevelAt(m))
  for (let m = 5 * 60; m < 7 * 60; m++) assert.ok(nightLevelAt(m + 1) <= nightLevelAt(m))
})

test('the clock wraps, so day two is lit like day one', () => {
  assert.equal(nightLevelAt(1440 + 9 * 60), at(9))
  assert.equal(nightLevelAt(5 * 1440 + 22 * 60), at(22))
  assert.equal(nightLevelAt(-60), at(23))
})

test('the night picture is mounted before dusk needs it, and dropped in the morning', () => {
  assert.equal(nightImageNeeded(14 * 60), false)
  assert.equal(nightImageNeeded(15 * 60), true, 'mounted while still fully light, so it is loaded')
  assert.equal(nightImageNeeded(18 * 60), true)
  assert.equal(nightImageNeeded(3 * 60), true)
  assert.equal(nightImageNeeded(6 * 60), true)
  assert.equal(nightImageNeeded(8 * 60), false)
})

// A world saved before the island had a night painting must still get one, because the season
// stores the geography it was built with and the production island was laid out long before.
test('reading a world fills in the island night painting it was saved without', async () => {
  const { withIslandNight } = await import('../server/world/geo/islandMap.ts')
  const { ISLAND_MASK } = await import('../server/world/geo/islandMask.ts')
  const saved = { image: ISLAND_MASK.image, cols: 40 }
  assert.equal(withIslandNight(saved).nightImage, ISLAND_MASK.nightImage)
  // Another world's map is left exactly as it is, and an explicit choice is never overwritten.
  assert.equal(withIslandNight({ image: '/world/other.png' }).nightImage, undefined)
  assert.equal(withIslandNight({ image: ISLAND_MASK.image, nightImage: '/world/custom.png' }).nightImage, '/world/custom.png')
  assert.equal(withIslandNight({}).nightImage, undefined)
})
