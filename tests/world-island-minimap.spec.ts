import { test, expect } from '@playwright/test'
import { ISLAND_MASK } from '../server/world/geo/islandMask'
import { ISLAND_PLACES } from '../server/world/geo/islandMap'

// The minimap draws the painted island and nothing else: markers sit at simulation coordinates,
// and when the engine reports a new coordinate the marker walks there.
test('the island minimap draws the painted map and keeps markers on simulation coordinates', async ({ page, request }, info) => {
  const current = await (await request.get('/api/world/current')).json()
  const world = current.worldState
  // The island as it really is: every place the artwork labels, where the artwork labels it.
  const places = ISLAND_PLACES.map((p, i) => ({
    ...world.places[0], id: `island-${i}`, name: p.name, description: p.name, currentAgentIds: [], resources: [], isDiscovered: true,
  }))
  world.places = places
  // Two named people placed by hand: the running season's own cast can be relaunched by another
  // spec, and this test is about coordinates, not about who happens to be alive on the server.
  const person = (id: string, name: string, place: string, coord: { x: number; y: number }) => ({
    ...world.agents[0], id, name, relationships: [], inventory: [], journal: [], movementLog: [],
    publicState: { ...world.agents[0].publicState, status: 'alive', locationId: place, coord, travel: null },
  })
  const walker = person('island-walker', '걷는이', places[5].id, { x: 1400, y: 900 })
  const other = person('island-other', '다른이', places[6].id, { x: 1800, y: 900 })
  world.agents = [walker, other]
  // The same geography the server builds: the generated mask, the painted picture, real regions.
  world.engine = {
    minute: 600,
    connections: [],
    ongoingActions: [],
    geo: {
      version: 1, widthMeters: ISLAND_MASK.widthMeters, heightMeters: ISLAND_MASK.heightMeters,
      cellMeters: ISLAND_MASK.cellMeters, cols: ISLAND_MASK.cols, rows: ISLAND_MASK.rows,
      cells: ISLAND_MASK.cells, image: ISLAND_MASK.image, minute: 600,
      cellRegion: Array.from({ length: ISLAND_MASK.cols * ISLAND_MASK.rows }, (_, i) => i % places.length),
      regions: ISLAND_PLACES.map((p, i) => ({ placeId: places[i].id, kind: p.kind, terrain: p.terrain, center: p.seed, label: p.seed, radius: p.radius, source: 'designer' })),
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

  // Zoomed out, the island reads as a map: place names on, no scrim, no character name tags.
  await expect(page.locator('.geo-scrim')).toHaveCount(0)
  await expect(page.locator('.geo-agent-name')).toHaveCount(0)
  await expect(page.locator('.geo-region-label').first()).toBeVisible()
  expect(await page.locator('.geo-region-label').count()).toBeGreaterThanOrEqual(5)
  await expect(page.locator('.geo-region-label').first()).toBeVisible()
  await page.locator('.geo-map').screenshot({ path: `data/logs/island-minimap-wide-${info.project.name}.png` })
  const dotAt = async () => Number(await page.locator('.geo-agent .geo-agent-dot').first().getAttribute('r'))
  const viewWidth = async () => Number((await page.locator('.geo-map svg').getAttribute('viewBox'))!.split(' ')[2])
  const wide = await viewWidth(), wideDot = await dotAt()

  // Zooming in: the painted map (and the place names painted into it) steps back, and every
  // person on screen gets a readable name tag and a bigger marker.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '확대' }).click()
  await expect.poll(viewWidth).toBeLessThan(wide * 0.62)
  await expect(page.locator('.geo-scrim')).toHaveCount(1)
  await expect(page.locator('.geo-agent-name')).toHaveCount(2)
  // The place names step aside entirely — they are drawn by the app, not baked into the picture.
  await expect(page.locator('.geo-region-label')).toHaveCount(0)
  // Marker size is measured in map metres, so a bigger number at a smaller view means a bigger
  // marker on screen relative to the map — the whole point of the zoom.
  expect(await dotAt() / await viewWidth()).toBeGreaterThan(wideDot / wide * 1.4)

  // Engagement shows on the map as soon as the engine reports it.
  world.engine.fighting = [walker.id, other.id]
  await page.evaluate(payload => window.dispatchEvent(new CustomEvent('test-frame', { detail: { type: 'worldState', payload } })), world)
  await expect(page.locator('.geo-agent.is-fighting')).toHaveCount(2)
  // The person you are following is marked out from the rest: a ring, a louder tag, bigger type.
  await page.getByRole('button', { name: '전체', exact: true }).click()
  await marker.click()
  await expect(page.locator('.geo-agent.is-selected')).toHaveCount(1)
  await expect(page.locator('.geo-agent.is-selected .geo-agent-halo')).toHaveCount(1)
  await expect(page.locator('.geo-agent-name')).toHaveCount(1, { timeout: 2000 })
  const pickedDot = Number(await page.locator('.geo-agent.is-selected .geo-agent-dot').getAttribute('r'))
  const plainDot = Number(await page.locator('.geo-agent:not(.is-selected) .geo-agent-dot').first().getAttribute('r'))
  expect(pickedDot).toBeGreaterThan(plainDot)
  await expect(page.locator('.geo-agent-info')).toContainText(walker.name)
  await page.locator('.geo-map').screenshot({ path: `data/logs/island-minimap-${info.project.name}.png` })
})
