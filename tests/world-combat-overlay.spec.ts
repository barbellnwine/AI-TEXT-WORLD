import { test, expect } from '@playwright/test'
import { ISLAND_MASK } from '../server/world/geo/islandMask'
import { ISLAND_PLACES } from '../server/world/geo/islandMap'

// The map has to say where a fight happened while the scene telling it is the one being read:
// gunfire as a translucent report with a gun on it, a close-quarters fight as the blade alone.
test('the minimap marks this scene fight and drops it when the scene does', async ({ page, request }, info) => {
  const current = await (await request.get('/api/world/current')).json()
  const world = current.worldState
  const places = ISLAND_PLACES.map((p, i) => ({
    ...world.places[0], id: `island-${i}`, name: p.name, description: p.name, currentAgentIds: [], resources: [], isDiscovered: true,
  }))
  world.places = places
  const person = (id: string, name: string, coord: { x: number; y: number }, status = 'alive') => ({
    ...world.agents[0], id, name, relationships: [], inventory: [], journal: [], movementLog: [],
    publicState: { ...world.agents[0].publicState, status, locationId: places[0].id, coord, travel: null },
  })
  const shooter = person('fight-a', '쏜사람', { x: 900, y: 1000 })
  const shot = person('fight-b', '맞은사람', { x: 1100, y: 1000 })
  const away = person('fight-c', '멀리있는사람', { x: 1800, y: 200 })
  world.agents = [shooter, shot, away]
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
  const scene = (id: string, title: string, body: string, stateChanges: unknown[]) => ({
    id, kind: 'LIVE', seasonId: current.season.id, worldDay: 1, timeStart: '08:00', timeEnd: '08:30',
    title, body, locationIds: [places[0].id], agentIds: [shooter.id, shot.id], sourceEventIds: [],
    stateChanges, importance: 'notable', createdAt: new Date().toISOString(),
  })

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
  const send = (type: string, payload: unknown) => page.evaluate(([t, p]) => window.dispatchEvent(new CustomEvent('test-frame', { detail: { type: t, payload: p } })), [type, payload] as const)
  await tab('미니맵')

  const blast = page.locator('.geo-combat-blast')
  const gun = page.locator('.geo-combat-gunfire .geo-combat-icon')
  const blade = page.locator('.geo-combat-melee .geo-combat-icon')
  await expect(page.locator('.geo-combat')).toHaveCount(0)

  // 1 — a gunfight: the translucent report, and a gun at the middle of the two who fought.
  await send('scene', scene('scene-v4-gun', '총성', '그는 소총을 들어 방아쇠를 당겼다.', [{ field: 'agent:fight-b:health', from: '1', to: '6' }]))
  await expect(page.locator('.geo-combat-gunfire')).toHaveCount(1)
  await expect(blast).toHaveCount(1)
  await expect(gun).toHaveCount(1)
  await expect(page.locator('.geo-combat')).toHaveAttribute('transform', 'translate(1000 1000)')

  // 2 — more shots in the same scene do not stack a second gun on the same spot.
  await send('scene', scene('scene-v4-gun', '총성', '그는 소총을 들어 방아쇠를 당겼다. 다시 쐈다.', [
    { field: 'agent:fight-b:health', from: '1', to: '6' }, { field: 'agent:fight-b:health', from: '6', to: '8' }]))
  await expect(page.locator('.geo-combat')).toHaveCount(1)
  await expect(gun).toHaveCount(1)

  await page.locator('.observatory-map').screenshot({ path: `data/logs/combat-gunfire-${info.project.name}.png` })

  // 8 — zoom and the mark stays on its coordinate, drawn in the same metres as everything else.
  const svg = page.locator('.observatory-map .geo-map svg')
  const viewBefore = (await svg.getAttribute('viewBox'))!
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '확대' }).click()
  expect(await svg.getAttribute('viewBox')).not.toBe(viewBefore)
  await expect(page.locator('.geo-combat')).toHaveAttribute('transform', 'translate(1000 1000)')

  // 9 — a new fight does not drag the camera to it.
  const parked = (await svg.getAttribute('viewBox'))!
  await send('scene', scene('scene-v4-blade', '칼', '칼이 번뜩였다.', [{ field: 'agent:fight-b:health', from: '6', to: '7' }]))
  await expect(blade).toHaveCount(1)
  expect(await svg.getAttribute('viewBox')).toBe(parked)

  // 4 — a close-quarters fight is the blade alone: no report drawn around it.
  await expect(page.locator('.geo-combat-melee')).toHaveCount(1)
  await expect(blast).toHaveCount(0)

  await page.locator('.observatory-map').screenshot({ path: `data/logs/combat-melee-${info.project.name}.png` })

  // 3 — the scene after the fight carries no damage of its own, so the mark goes with it.
  await send('scene', scene('scene-v4-quiet', '숨 고르기', '그는 숨을 골랐다.', []))
  await expect(page.locator('.geo-combat')).toHaveCount(0)

  // 6 + 7 — a body and an open wound, in the list and on the map.
  world.agents = [{ ...shooter, publicState: { ...shooter.publicState, status: 'injured' } },
    { ...shot, publicState: { ...shot.publicState, status: 'deceased' } }, away]
  await send('worldState', world)
  await tab('등장인물')
  await expect(page.locator('.observatory-people').getByRole('button', { name: /쏜사람/ }).locator('.status-mark.is-blood')).toHaveCount(1)
  await expect(page.locator('.observatory-people').getByRole('button', { name: /맞은사람/ }).locator('.status-mark.is-skull')).toHaveCount(1)
  await expect(page.locator('.observatory-people').getByRole('button', { name: /멀리있는사람/ }).locator('.status-mark')).toHaveCount(0)

  // 10 — picking that person still brings the camera to them, as it did before.
  await page.locator('.observatory-people').getByRole('button', { name: /맞은사람/ }).click()
  await tab('미니맵')
  await expect.poll(async () => {
    const [x, y, w, h] = (await svg.getAttribute('viewBox'))!.split(' ').map(Number)
    return Math.hypot(x + w / 2 - 1100, y + h / 2 - 1000)
  }, { timeout: 3000 }).toBeLessThan(2)
  await expect(page.locator('.geo-agent.is-selected .geo-agent-status.is-skull')).toHaveCount(1)
  await expect(page.locator('.geo-agent-info .status-mark.is-skull')).toHaveCount(1)
  await page.locator('.observatory-map').screenshot({ path: `data/logs/combat-overlay-${info.project.name}.png` })
})
