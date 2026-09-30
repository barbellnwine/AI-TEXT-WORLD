import { test, expect } from '@playwright/test'

test('TEXT uses a DAY chapter and exposes correction history without hourly LIVE duplication', async ({page})=>{
  await page.addInitScript(()=>localStorage.setItem('ai_world_locale','ko-KR'))
  await page.route('**/api/world/stream',route=>route.abort())
  const chapter={id:'day-fixture',kind:'DAY',completed:false,seasonId:'fixture',worldDay:1,timeStart:'00:00',timeEnd:'02:00',title:'DAY 1 · 진행 중인 하루',body:'검증용 하루 장면.\n\n기록된 제안과 거절.',sourceEventIds:[],locationIds:[],agentIds:[],stateChanges:[],importance:'notable',createdAt:'2026-09-24T00:00:00Z',corrections:[{at:'2026-09-24',reason:'테스트 정정 사유',previousTitle:'이전 제목',previousBody:'이전 원문'}]}
  await page.route('**/api/world/days',route=>route.fulfill({json:{items:[chapter],hasMore:false}}))
  await page.goto('/')
  await page.getByRole('tab',{name:'TEXT',exact:true}).click()
  await expect(page.locator('.reader-scene')).toHaveCount(1)
  await expect(page.locator('.reader-scene')).toContainText('진행 중인 하루')
  await page.getByText('기록 정정 · 원문과 사유 보기').click()
  await expect(page.getByText('이전 원문',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})

test('state-only exposure produces no LIVE story on mobile and desktop', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ai_world_locale', 'ko-KR'))
  const names = ['김높별', '도영동', '최형대', '김기업', '권치현']
  await page.route('**/api/world/current', async route => {
    const response = await route.fetch(); const data = await response.json()
    const template = data.worldState.agents[0]
    data.worldState.agents = names.map((name, i) => ({ ...template, id: `person-${i}`, name }))
    await route.fulfill({ json: data })
  })
  await page.route('**/api/world/stream', route => route.abort())
  await page.route('**/api/world/scenes?*', route => route.fulfill({ json: { items: [], hasMore: false } }))
  await page.route('**/api/world/events?*', route => route.fulfill({ json: { items: names.map((name, i) => ({ id: `wet-${i}`, day: 1, worldTime: '07:00', worldMinute: 420, occurredAt: '2026-09-24T00:00:00Z', type: 'SYSTEM', title: 'Exposure', phase: 'STATE_UPDATE', cause: 'environment_exposure', placeId: 'control-room', agentIds: [`person-${i}`], summary: `${name}의 젖은 정도가 높아져 심한 수준에 이르렀다.`, stateChanges: [], relatedEventIds: [], importance: 'normal' })), total: 5, hasMore: false } }))
  await page.goto('/')
  const story = page.locator('.world-live-story')
  await expect(story.locator('article')).toHaveCount(0)
  await expect(story).not.toContainText('옷이 흠뻑 젖었다.')
})

test('LIVE reads as paragraphs and replaces fallback prose when narration arrives', async ({ page }, testInfo) => {
  const event = { id: 'prose-event', day: 1, worldTime: '02:45', worldMinute: 165, occurredAt: '2026-09-24T00:00:00Z', type: 'SYSTEM', placeId: 'control-room', agentIds: [], title: '원본 로그', summary: '원본 로그', stateChanges: [], relatedEventIds: [], importance: 'normal' }
  const scene = { id: 'prose-scene', seasonId: 'season-01-eden', worldDay: 1, timeStart: '02:45', timeEnd: '02:45', title: '비가 내리는 밤', body: '사람들이 연구시설 앞에 모였다.\n\n문은 아직 닫혀 있었다.', locationIds: ['control-room'], agentIds: [], sourceEventIds: [event.id], stateChanges: [], importance: 'ordinary', createdAt: event.occurredAt }
  await page.addInitScript(() => {
    localStorage.setItem('ai_world_locale', 'ko-KR')
    class Stream {
      onmessage: ((e: { data: string }) => void) | null = null
      onopen = null
      onerror = null
      listener = (e: Event) => this.onmessage?.({ data: JSON.stringify((e as CustomEvent).detail) })
      constructor() { window.addEventListener('test-world-frame', this.listener) }
      close() { window.removeEventListener('test-world-frame', this.listener) }
    }
    Object.defineProperty(window, 'EventSource', { value: Stream })
  })
  await page.route('**/api/world/events?*', route => route.fulfill({ json: { items: [event], total: 1, hasMore: false } }))
  await page.route('**/api/world/scenes?*', route => route.fulfill({ json: { items: [scene], hasMore: false } }))
  await page.goto('/')
  const story = page.locator('.world-live-story')
  await expect(story.getByText('사람들이 연구시설 앞에 모였다.')).toBeVisible()
  await expect(story.locator('article')).toHaveCount(1)
  await expect(story).not.toContainText('원본 로그')
  const updated = { ...scene, body: '사람들이 연구시설 앞에 모였다.\n\n문을 열자는 말에, 한 사람이 앞으로 나섰다.' }
  await page.evaluate(payload => window.dispatchEvent(new CustomEvent('test-world-frame', { detail: { type: 'sceneUpdated', payload } })), updated)
  await expect(story).toContainText('문을 열자는 말에, 한 사람이 앞으로 나섰다.')
  await expect(story.locator('article')).toHaveCount(1)
  await expect(story).not.toContainText('문은 아직 닫혀 있었다.')
  const started = { ...event, id: 'started', actionId: 'same-action', phase: 'STARTED', summary: '같은 발언을 시작했다.', worldTime: '03:15', worldMinute: 195 }
  await page.evaluate(payload => window.dispatchEvent(new CustomEvent('test-world-frame', { detail: { type: 'event', payload } })), started)
  await expect(story).not.toContainText('같은 발언을 시작했다.')
  // The scene can arrive before its completion event (or while that event is queued).
  const completeScene = { ...updated, resolvedActionIds: ['same-action'], sourceEventIds: [event.id, 'completion-not-loaded'], timeEnd: '03:16' }
  await page.evaluate(payload => window.dispatchEvent(new CustomEvent('test-world-frame', { detail: { type: 'sceneUpdated', payload } })), completeScene)
  await expect(story).not.toContainText('같은 발언을 시작했다.')
  await expect(story.locator('article')).toHaveCount(1)
  await expect(story).toContainText('02:45–03:16')
  // A genuinely new completed action remains visible even with similar wording.
  await page.evaluate(payload => window.dispatchEvent(new CustomEvent('test-world-frame', { detail: { type: 'event', payload } })), { ...started, id: 'another-completion', actionId: 'different-action', phase: 'COMPLETED' })
  await expect(story).toContainText('같은 발언을 시작했다.')
  await expect(story.locator('article')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `data/logs/live-prose-${testInfo.project.name}.png`, fullPage: true })
})
