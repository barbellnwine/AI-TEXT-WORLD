import { test, expect } from '@playwright/test'
import { ISLAND_MASK } from '../server/world/geo/islandMask'
import { ISLAND_PLACES } from '../server/world/geo/islandMap'

// A trip is a path the engine has already planned, and the whole plan is in the payload. So the
// map does not wait a tick to move anyone: it reads the clock forward and draws the walker where
// the engine is going to say they are. This is that, and the fence around it — a viewer may never
// run past the lookahead the server granted, so a stalled server freezes the walk where it is.
test('a traveller keeps walking between snapshots, and stops at the lookahead', async ({ page, request }, info) => {
  const current = await (await request.get('/api/world/current')).json()
  const world = current.worldState
  const places = ISLAND_PLACES.map((p, i) => ({
    ...world.places[0], id: `island-${i}`, name: p.name, description: p.name, currentAgentIds: [], resources: [], isDiscovered: true,
  }))
  world.places = places
  // A straight 40-minute walk, so the position at any minute is arithmetic a reader can check:
  // at minute 610 — a quarter of the way — the walker stands at (1300, 1000).
  const travel = {
    from: { x: 1400, y: 900 }, to: { x: 1000, y: 1300 },
    path: [{ x: 1400, y: 900, minute: 600 }, { x: 1000, y: 1300, minute: 640 }],
    startMinute: 600, arriveMinute: 640, destinationPlaceId: places[6].id,
  }
  world.agents = [{
    ...world.agents[0], id: 'island-walker', name: '걷는이', relationships: [], inventory: [], journal: [], movementLog: [],
    publicState: { ...world.agents[0].publicState, status: 'alive', locationId: places[5].id, coord: { x: 1400, y: 900 }, travel },
  }]
  world.engine = {
    minute: 600,
    connections: [], ongoingActions: [], objects: [], zones: [], fighting: [],
    geo: {
      version: 1, widthMeters: ISLAND_MASK.widthMeters, heightMeters: ISLAND_MASK.heightMeters,
      cellMeters: ISLAND_MASK.cellMeters, cols: ISLAND_MASK.cols, rows: ISLAND_MASK.rows,
      cells: ISLAND_MASK.cells, image: ISLAND_MASK.image, minute: 600,
      cellRegion: Array.from({ length: ISLAND_MASK.cols * ISLAND_MASK.rows }, (_, i) => i % places.length),
      regions: ISLAND_PLACES.map((p, i) => ({ placeId: places[i].id, kind: p.kind, terrain: p.terrain, center: p.seed, label: p.seed, radius: p.radius, source: 'designer' })),
    },
  }

  await page.addInitScript(() => {
    localStorage.setItem('ai_world_locale', 'ko-KR')
    // No live stream: this test is about what one snapshot alone is worth.
    class Stream { onmessage: ((e: { data: string }) => void) | null = null; close() {} }
    Object.defineProperty(window, 'EventSource', { value: Stream })
  })
  // The pace is stamped as the request is answered, so "since the snapshot" means since now.
  // A world minute per 100ms makes a 5-minute tick visible inside a test; ten minutes of
  // lookahead is the fence, and the walker should stop dead against it.
  await page.route('**/api/world/current', route => route.fulfill({
    json: { ...current, worldState: { ...world, engine: { ...world.engine, pace: { at: new Date().toISOString(), minutePerMs: 0.01, until: 610 } } } },
  }))
  await page.goto('/')
  if (info.project.name === 'mobile') await page.locator('.observatory-mobile-tabs').getByRole('button', { name: '미니맵' }).click()

  const marker = page.locator('.geo-agent').filter({ has: page.locator('title', { hasText: '걷는이' }) })
  const at = async () => (await marker.getAttribute('transform'))!.match(/[\d.-]+/g)!.map(Number)
  await expect(marker).toBeVisible()

  // Nothing is sent, nothing is fetched, and the marker leaves the spot it was reported at.
  await expect.poll(async () => (await at())[0], { timeout: 4000 }).toBeLessThan(1395)
  const [movingX, movingY] = await at()
  expect(movingX).toBeGreaterThan(1300)
  expect(movingY).toBeLessThan(1000)
  expect(movingY).toBeGreaterThan(900)

  // The lookahead is reached and the walk stops there, exactly where minute 610 puts them.
  await expect.poll(async () => Math.hypot((await at())[0] - 1300, (await at())[1] - 1000) < 1, { timeout: 4000 }).toBe(true)
  const held = await at()
  await page.waitForTimeout(900)
  expect(await at()).toEqual(held)
})
