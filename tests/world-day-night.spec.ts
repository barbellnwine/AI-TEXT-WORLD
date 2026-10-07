import { test, expect } from '@playwright/test'
import { ISLAND_MASK } from '../server/world/geo/islandMask'
import { ISLAND_PLACES } from '../server/world/geo/islandMap'

// The island is painted twice, day and night, and the clock decides which one the reader sees.
test('the map turns to the night painting on the engine clock, and hands its labels over', async ({ page, request }, info) => {
  const current = await (await request.get('/api/world/current')).json()
  const world = current.worldState
  const places = ISLAND_PLACES.map((p, i) => ({
    ...world.places[0], id: `island-${i}`, name: p.name, description: p.name, currentAgentIds: [], resources: [], isDiscovered: true,
  }))
  world.places = places
  world.agents = [{
    ...world.agents[0], id: 'night-a', name: '밤사람', relationships: [], inventory: [], journal: [], movementLog: [],
    publicState: { ...world.agents[0].publicState, status: 'alive', locationId: places[0].id, coord: { x: 1000, y: 1000 }, travel: null },
  }]
  const geo = {
    version: 1, widthMeters: ISLAND_MASK.widthMeters, heightMeters: ISLAND_MASK.heightMeters,
    cellMeters: ISLAND_MASK.cellMeters, cols: ISLAND_MASK.cols, rows: ISLAND_MASK.rows,
    cells: ISLAND_MASK.cells, image: ISLAND_MASK.image, nightImage: ISLAND_MASK.nightImage, minute: 0,
    cellRegion: Array.from({ length: ISLAND_MASK.cols * ISLAND_MASK.rows }, (_, i) => i % places.length),
    regions: ISLAND_PLACES.map((p, i) => ({ placeId: places[i].id, kind: p.kind, terrain: p.terrain, center: p.seed, label: p.seed, radius: p.radius, source: 'designer' })),
  }
  const clockAt = (hour: number, min = 0) => ({
    ...world.clock, day: 1, time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    timeOfDay: hour < 5 ? 'lateNight' : hour < 7 ? 'dawn' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 20 ? 'evening' : 'night',
  })
  world.engine = { minute: 9 * 60, connections: [], ongoingActions: [], objects: [], zones: [], fighting: [], geo: { ...geo, minute: 9 * 60 } }
  world.clock = clockAt(9)

  await page.addInitScript(() => {
    localStorage.setItem('ai_world_locale', 'ko-KR')
    class Stream {
      onmessage: ((e: { data: string }) => void) | null = null
      listener = (e: Event) => this.onmessage?.({ data: JSON.stringify((e as CustomEvent).detail) })
      constructor() { window.addEventListener('test-frame', this.listener) }
      close() { window.removeEventListener('test-frame', this.listener) }
    }
    Object.defineProperty(window, 'EventSource', { value: Stream })
  })
  await page.route('**/api/world/current', route => route.fulfill({ json: current }))
  await page.goto('/')
  if (info.project.name === 'mobile') await page.locator('.observatory-mobile-tabs').getByRole('button', { name: '미니맵' }).click()

  const night = page.locator('.geo-night')
  const labels = page.locator('.geo-region-label')
  const caption = page.locator('.observatory-map .map-caption').first()
  const nightOpacity = async () => night.count().then(n => n ? night.evaluate(el => Number(el.getAttribute('opacity'))) : null)
  const setClock = async (hour: number, min = 0) => {
    world.engine.minute = hour * 60 + min
    world.engine.geo.minute = world.engine.minute
    world.clock = clockAt(hour, min)
    await page.evaluate(payload => window.dispatchEvent(new CustomEvent('test-frame', { detail: { type: 'worldState', payload } })), world)
  }

  // Mid morning: the day painting alone, the app drawing the place names, and the hour in words.
  await expect(page.locator('.geo-map svg image').first()).toHaveAttribute('href', ISLAND_MASK.image)
  await expect(night).toHaveCount(0)
  expect(await labels.count()).toBeGreaterThanOrEqual(5)
  await expect(caption).toContainText('09:00')
  await expect(caption).toContainText('아침')

  // Mid afternoon: still full daylight, but the night picture is already mounted and loading. The
  // whole point of mounting it early is that it is on screen by the time dusk fades it in, so the
  // test waits for it here exactly as a reader's browser would have it in hand before dark.
  const arrival = page.waitForResponse(r => r.url().includes('island-map-night') && r.status() === 200)
  await setClock(15, 30)
  await expect(night).toHaveCount(1)
  await arrival
  await expect(night).toHaveAttribute('href', ISLAND_MASK.nightImage!)
  expect(await nightOpacity()).toBe(0)
  expect(await labels.count()).toBeGreaterThanOrEqual(5)

  // Dusk: halfway through the engine's evening, the night is halfway in and the labels halfway out.
  await setClock(18, 30)
  expect(await nightOpacity()).toBeCloseTo(0.5, 5)
  await expect(caption).toContainText('저녁')
  expect(await page.locator('.geo-map svg g[opacity]').first().getAttribute('opacity')).toBe('0.5')

  // Night: the painting is wholly the night one and the app's labels have handed over to its own.
  await setClock(21)
  expect(await nightOpacity()).toBe(1)
  await expect(labels).toHaveCount(0)
  await expect(caption).toContainText('밤')
  await page.locator('.observatory-map').screenshot({ path: `data/logs/map-night-${info.project.name}.png` })

  // The marker is as readable at night as by day, and still exactly on its coordinate.
  await expect(page.locator('.geo-agent')).toHaveCount(1)
  await expect(page.locator('.geo-agent')).toHaveAttribute('transform', 'translate(1000 1000)')

  // Dawn lifts it again, and by morning the night picture is gone entirely.
  await setClock(6)
  expect(await nightOpacity()).toBeCloseTo(0.5, 5)
  await setClock(8)
  await expect(night).toHaveCount(0)
  expect(await labels.count()).toBeGreaterThanOrEqual(5)
  await page.locator('.observatory-map').screenshot({ path: `data/logs/map-day-${info.project.name}.png` })
})
