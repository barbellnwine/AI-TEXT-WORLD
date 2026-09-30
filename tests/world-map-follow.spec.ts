import { test, expect } from '@playwright/test'

test('GPS follows confirmed travel; idle markers do not wander or move when others leave', async ({ page, request }, info) => {
  const current = await (await request.get('/api/world/current')).json()
  const world = current.worldState
  world.places = [world.places[0]]
  world.agents = world.agents.slice(0, 2)
  for (const a of world.agents) { a.publicState.locationId = world.places[0].id; a.publicState.localArea = 'CENTER' }
  world.engine = { minute: 0, connections: [], ongoingActions: [] }
  const actor = world.agents[0]
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
  await page.getByLabel('추적할 캐릭터').selectOption(actor.id)
  const marker = page.locator('.map-character').filter({ has: page.locator('title', { hasText: actor.name }) })
  const svg = page.locator('.observatory-map .world-minimap > svg')
  await expect(marker).toBeVisible()
  await expect(page.locator('animateTransform')).toHaveCount(0)
  const initial = await marker.getAttribute('transform')
  world.agents = [actor]
  await page.evaluate(payload => window.dispatchEvent(new CustomEvent('test-frame', { detail: { type: 'worldState', payload } })), world)
  await expect(marker).toHaveAttribute('transform', initial!)
  world.engine.ongoingActions = [{ id: 'travel', startedMinute: 0, completesMinute: 10, proposal: { actorId: actor.id, actionType: 'EXPLORE', locationId: world.places[0].id, areaHint: 'SHORE' } }]
  world.engine.minute = 5
  await page.evaluate(payload => window.dispatchEvent(new CustomEvent('test-frame', { detail: { type: 'worldState', payload } })), world)
  await expect(marker).not.toHaveAttribute('transform', initial!)
  await expect.poll(async () => {
    const coords = (await marker.getAttribute('transform'))!.match(/[\d.-]+/g)!.map(Number)
    const view = (await svg.getAttribute('viewBox'))!.split(' ').map(Number)
    return Math.abs(view[0] + view[2] / 2 - coords[0])
  }).toBeLessThan(.1)
  expect(Number((await svg.getAttribute('viewBox'))!.split(' ')[2])).toBe(115)
  await page.getByRole('button', { name: '전체 지도', exact: true }).click()
  await expect.poll(async () => Number((await svg.getAttribute('viewBox'))!.split(' ')[2])).toBe(410)
  await page.getByRole('button', { name: 'GPS 추적', exact: true }).click()
  await expect.poll(async () => Number((await svg.getAttribute('viewBox'))!.split(' ')[2])).toBe(115)
  await page.locator('.observatory-map').screenshot({ path: `data/logs/gps-map-${info.project.name}.png` })
})
