import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anyoneWalking, liveMinute, positionOnPath } from '../src/world/geoMotion.ts'
import { positionAt } from '../server/world/geo/movement.ts'
import type { GeoTravel } from '../server/world/geo/geoTypes.ts'

// A trip across a few hundred metres with an uneven leg, the way routeBetween writes them: the
// waypoints carry the minute each one is reached, and legs are not the same length in time.
const TRIP: GeoTravel = {
  from: { x: 100, y: 100 }, to: { x: 520, y: 340 },
  path: [
    { x: 100, y: 100, minute: 1000 },
    { x: 240, y: 160, minute: 1003 },
    { x: 300, y: 300, minute: 1009 },
    { x: 520, y: 340, minute: 1013 },
  ],
  startMinute: 1000, arriveMinute: 1013, destinationPlaceId: 'place-1',
}

// This is the whole safety of drawing ahead of the server: the marker may only ever be where the
// engine is going to say it is. If these two ever disagree, the map is inventing a position.
test('the drawn position is the engine position, to the metre, at every minute of the trip', () => {
  for (let minute = 995; minute <= 1018; minute += 0.25) {
    const drawn = positionOnPath(TRIP, minute)
    const engine = positionAt(TRIP, minute)
    assert.equal(Math.round(drawn.x), engine.x, `x at ${minute}`)
    assert.equal(Math.round(drawn.y), engine.y, `y at ${minute}`)
  }
})

test('the walk is continuous between waypoints rather than stepping whole metres', () => {
  const a = positionOnPath(TRIP, 1001.00)
  const b = positionOnPath(TRIP, 1001.01)
  assert.notDeepEqual(a, b, 'a hundredth of a minute has to move the marker')
  assert.ok(b.x > a.x && b.y > a.y)
})

test('before departure and after arrival the trip pins the ends', () => {
  assert.deepEqual(positionOnPath(TRIP, 1000), TRIP.from)
  assert.deepEqual(positionOnPath(TRIP, 900), TRIP.from)
  assert.deepEqual(positionOnPath(TRIP, 1013), TRIP.to)
  assert.deepEqual(positionOnPath(TRIP, 99999), TRIP.to)
})

const PACE = { at: '2026-10-14T00:00:00.000Z', minutePerMs: 1 / 300_000, until: 1005 }
const at = (seconds: number) => Date.parse(PACE.at) + seconds * 1000

test('the clock runs forward from the snapshot at the rate the server gave', () => {
  assert.equal(liveMinute(1000, PACE, at(0)), 1000)
  // 150 real seconds at one world minute per five real minutes is half a world minute.
  assert.equal(liveMinute(1000, PACE, at(150)), 1000.5)
  assert.equal(liveMinute(1000, PACE, at(300)), 1001)
})

// Without this a server that dies mid-trip would have its viewers walk everyone off the island.
test('a viewer never runs further ahead than the lookahead the server allowed', () => {
  assert.equal(liveMinute(1000, PACE, at(300 * 5)), 1005)
  assert.equal(liveMinute(1000, PACE, at(86_400)), 1005, 'a day later, still the same held position')
})

test('a world that is not running holds still, and so does one that sent no pace at all', () => {
  assert.equal(liveMinute(1000, { ...PACE, minutePerMs: 0 }, at(10_000)), 1000)
  assert.equal(liveMinute(1000, undefined, at(10_000)), 1000, 'an older server simply behaves as before')
})

// A clock skewed behind the server would otherwise rewind the walk.
test('a viewer whose clock is behind the snapshot does not walk backwards', () => {
  assert.equal(liveMinute(1000, PACE, at(-600)), 1000)
})

test('nothing animates unless somebody is actually mid-trip', () => {
  assert.equal(anyoneWalking([undefined, undefined], 1000), false)
  assert.equal(anyoneWalking([TRIP], 1000), true)
  assert.equal(anyoneWalking([TRIP], 1013), false, 'arrived is not walking')
  assert.equal(anyoneWalking([], 1000), false)
})
