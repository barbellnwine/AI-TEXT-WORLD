import { test, expect } from '@playwright/test'
import { ISLAND_MASK } from '../server/world/geo/islandMask'

// The minimap draws the painted island and nothing else: markers sit at simulation coordinates,
// and when the engine reports a new coordinate the marker walks there.
test('the island minimap draws the painted map and keeps markers on simulation coordinates', async ({ page, request }, info) => {
  const current = await (await request.get('/api/world/current')).json()
  const world = current.worldState
  const places = ['동쪽 해변', '깊은 숲', '샘터'].map((name, i) => ({
    ...world.places[0], id: `island-${i}`, name, description: name, currentAgentIds: [], resources: [], isDiscovered: true,
  }))
  world.places = places
  world.agents = world.agents.slice(0, 2)
  const [walker, other] = world.agents
  walker.publicState.locationId = places[1].id
  other.publicState.locationId = places[0].id
  walker.publicState.coord = { x: 1400, y: 900 }
  other.publicState.coord = { x: 1800, y: 900 }
  // The same geography the server builds: the generated mask, the painted picture, real regions.
  world.engine = {
    minute: 600,
    connections: [],
    ongoingActions: [],
    geo: {
      version: 1, widthMeters: ISLAND_MASK.widthMeters, heightMeters: ISLAND_MASK.heightMeters,
      cellMeters: ISLAND_MASK.cellMeters, cols: ISLAND_MASK.cols, rows: ISLAND_MASK.rows,
      cells: ISLAND_MASK.cells, image: ISLAND_MASK.image, minute: 600,
      cellRegion: Array.from({ length: ISLAND_MASK.cols * ISLAND_MASK.rows }, (_, i) => i % 3),
      regions: [
        { placeId: places[0].id, kind: 'TERRAIN', terrain: 'BEACH', center: { x: 1831, y: 904 }, radius: 320, source: 'designer' },
        { placeId: places[1].id, kind: 'TERRAIN', terrain: 'FOREST', center: { x: 1435, y: 871 }, radius: 460, source: 'designer' },
        { placeId: places[2].id, kind: 'POI', terrain: 'GRASS', center: { x: 1047, y: 928 }, radius: 90, source: 'designer' },
      ],
    },
    objects: [{ id: 'drop-1', name: '반자동 소총', kind: 'tool', quantity: 1, condition: 'intact', location: { kind: 'place', id: places[0].id }, coord: { x: 1700, y: 1000 } }],
    zones: [{ placeId: places[0].id, effectiveMinute: 1320, closed: false }],
    fighting: [],
  }
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

  // The painted island is the background, and the old per-cell terrain painting is gone.
  const picture = page.locator('.geo-map svg image')
  await expect(picture).toHaveAttribute('href', '/world/island-map.png')
  await expect(picture).toHaveAttribute('width', String(ISLAND_MASK.widthMeters))
  await expect(page.locator('.geo-map .geo-t')).toHaveCount(0)

  // A marker is drawn at the simulation coordinate, in metres, with no map-only transform.
  const marker = page.locator('.geo-agent').filter({ has: page.locator('title', { hasText: walker.name }) })
  await expect(marker).toHaveAttribute('transform', 'translate(1400 900)')
  await expect(page.locator('.geo-supply')).toHaveCount(1)
  await expect(page.locator('.geo-zone.is-closing')).toHaveCount(1)
  await expect(page.locator('.map-caption').first()).toContainText('폐쇄')

  // The engine moves the person; the marker walks to the new coordinate rather than jumping.
  walker.publicState.coord = { x: 1200, y: 1100 }
  world.engine.minute = 640
  await page.evaluate(payload => window.dispatchEvent(new CustomEvent('test-frame', { detail: { type: 'worldState', payload } })), world)
  await expect.poll(async () => {
    const [x, y] = (await marker.getAttribute('transform'))!.match(/[\d.-]+/g)!.map(Number)
    return Math.hypot(x - 1200, y - 1100) < 2
  }, { timeout: 4000 }).toBe(true)
  // It really passed through the middle: a trail of where it has been is drawn behind it.
  await expect(page.locator('.geo-trail')).toHaveCount(1)

  // Engagement shows on the map as soon as the engine reports it.
  world.engine.fighting = [walker.id, other.id]
  await page.evaluate(payload => window.dispatchEvent(new CustomEvent('test-frame', { detail: { type: 'worldState', payload } })), world)
  await expect(page.locator('.geo-agent.is-fighting')).toHaveCount(2)
  await page.locator('.geo-map').screenshot({ path: `data/logs/island-minimap-${info.project.name}.png` })
})
