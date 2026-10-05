import { test, expect } from '@playwright/test'
import { ISLAND_MASK } from '../server/world/geo/islandMask'
import { ISLAND_PLACES } from '../server/world/geo/islandMap'

// Long enough that a pan would have finished if one had been started.
const PAN_SETTLE = 900

// Picking a character from the list must bring the camera to them. A zoomed-in map used to keep
// looking wherever it already was, so choosing someone off screen selected a person you could not
// see. The camera now travels to the engine coordinate — and nothing else about the view changes.
test('choosing a character pans the minimap to them at the zoom already set', async ({ page, request }, info) => {
  const current = await (await request.get('/api/world/current')).json()
  const world = current.worldState
  const places = ISLAND_PLACES.map((p, i) => ({
    ...world.places[0], id: `island-${i}`, name: p.name, description: p.name, currentAgentIds: [], resources: [], isDiscovered: true,
  }))
  world.places = places
  // The cast is built here rather than taken from however many people the running season happens
  // to have, so another spec relaunching the demo world cannot change what this one is testing.
  const person = (id: string, name: string, coord?: { x: number; y: number }, place = places[0].id) => ({
    ...world.agents[0], id, name, relationships: [], inventory: [], journal: [], movementLog: [],
    publicState: { ...world.agents[0].publicState, status: 'alive', locationId: place, coord, travel: null },
  })
  // Two people far apart, so one is certainly off screen once the map is zoomed in, plus someone
  // the engine has given no coordinate at all.
  const near = person('pan-near', '가까운이', { x: 700, y: 600 }, places[0].id)
  const far = person('pan-far', '먼곳이', { x: ISLAND_MASK.widthMeters - 120, y: ISLAND_MASK.heightMeters - 120 }, places[1].id)
  const nowhere = person('pan-nowhere', '좌표없음', undefined, places[2].id)
  world.agents = [near, far, nowhere]
  world.engine = {
    minute: 600, connections: [], ongoingActions: [], objects: [], zones: [], fighting: [],
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
  const mobile = info.project.name === 'mobile'
  const tab = (name: string) => mobile ? page.locator('.observatory-mobile-tabs').getByRole('button', { name }).click() : Promise.resolve()
  // The map keeps its state while a tab is merely hidden, so the narrow layout is the same journey.
  const svg = page.locator('.observatory-map .geo-map svg')
  const box = async () => (await svg.getAttribute('viewBox'))!.split(' ').map(Number)
  // Where the camera is pointed, in simulation metres.
  const centre = async () => { const [x, y, w, h] = await box(); return { x: x + w / 2, y: y + h / 2, w } }
  const pick = async (name: string) => {
    await tab('등장인물')
    await page.locator('.observatory-people').getByRole('button', { name: new RegExp(name) }).click()
    await tab('미니맵')
  }

  await tab('미니맵')
  await expect(svg).toHaveAttribute('viewBox', `0 0 ${ISLAND_MASK.widthMeters} ${ISLAND_MASK.widthMeters * ISLAND_MASK.heightMeters / ISLAND_MASK.widthMeters}`)
  // Zoom in on the middle of the island: now most of the island, and most people, are off screen.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '확대' }).click()
  const zoomed = await centre()
  expect(zoomed.w).toBeLessThan(ISLAND_MASK.widthMeters * 0.4)

  // 1 + 2 — the person picked from the list ends up in the middle of the view, wherever they were.
  await pick(near.name)
  await expect.poll(async () => { const c = await centre(); return Math.hypot(c.x - 700, c.y - 600) }, { timeout: 3000 }).toBeLessThan(2)
  // 3 — the zoom the viewer set is untouched by the move.
  expect((await centre()).w).toBeCloseTo(zoomed.w, 6)
  await expect(page.locator('.geo-agent.is-selected')).toHaveCount(1)
  await expect(page.locator('.geo-agent.is-selected .geo-agent-halo')).toHaveCount(1)

  // 4 + 5 — the next pick travels to that person, and the far corner never pushes the viewport off
  // the island: the camera stops at the edge rather than showing the sea beyond it.
  await pick(far.name)
  await expect.poll(async () => {
    const [x, y, w, h] = await box()
    return x >= -0.01 && y >= -0.01 && x + w <= ISLAND_MASK.widthMeters + 0.01 && y + h <= ISLAND_MASK.heightMeters + 0.01
      && x + w >= far.publicState.coord.x - 0.01 && y + h >= far.publicState.coord.y - 0.01
  }, { timeout: 3000 }).toBe(true)
  expect((await centre()).w).toBeCloseTo(zoomed.w, 6)
  // 7 — the marker the viewer is looking for really is drawn at the engine's coordinate.
  const marker = page.locator('.geo-agent.is-selected')
  await expect.poll(async () => {
    const [x, y] = (await marker.getAttribute('transform'))!.match(/[\d.-]+/g)!.map(Number)
    return Math.hypot(x - far.publicState.coord.x, y - far.publicState.coord.y)
  }, { timeout: 4000 }).toBeLessThan(2)

  // Exception — someone with no coordinate leaves the view exactly where it was.
  const before = await box()
  await pick(nowhere.name)
  await expect(page.locator('.geo-agent.is-selected')).toHaveCount(0)
  await page.waitForTimeout(PAN_SETTLE)
  expect(await box()).toEqual(before)

  // 6 — the viewer's own controls still work after an automatic move.
  await pick(near.name)
  await expect.poll(async () => Math.hypot((await centre()).x - 700, (await centre()).y - 600), { timeout: 3000 }).toBeLessThan(2)
  await page.getByRole('button', { name: '축소' }).click()
  await expect.poll(async () => (await centre()).w).toBeGreaterThan(zoomed.w)
  await page.getByRole('button', { name: '전체', exact: true }).click()
  await expect.poll(async () => (await centre()).w).toBe(ISLAND_MASK.widthMeters)
  await page.locator('.observatory-map').screenshot({ path: `data/logs/map-autopan-${info.project.name}.png` })
})
