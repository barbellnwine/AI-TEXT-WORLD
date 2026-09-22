import { expect, test } from '@playwright/test'

test('LIVE retains the reading position, counts new events and paginates older records', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ai_world_locale', 'ko-KR')
    const streams: Array<{ onmessage: ((event: { data: string }) => void) | null }> = []
    class FeedSource {
      onopen: (() => void) | null = null
      onerror = null
      onmessage: ((event: { data: string }) => void) | null = null
      constructor() { streams.push(this); setTimeout(() => this.onopen?.(), 0) }
      close() { const i = streams.indexOf(this); if (i >= 0) streams.splice(i, 1) }
    }
    Object.assign(window, { EventSource: FeedSource, emitWorld: (event: unknown) => streams.forEach(s => s.onmessage?.({ data: JSON.stringify({ type: 'event', payload: event }) })) })
  })
  const event = (index: number) => ({ id: `live-${index}`, type: 'OBSERVATION', occurredAt: new Date(2026, 0, 1, 0, index).toISOString(), day: 1, worldMinute: index,
    worldTime: `08:${String(index).padStart(2, '0')}`, placeId: 'test-place', agentIds: [], title: `Record ${index}`, summary: `Recorded action ${index}. This is an actual completed observation in the feed.`, stateChanges: [], relatedEventIds: [], importance: 'normal', phase: 'COMPLETED' })
  await page.route('**/api/world/events?*', route => {
    const older = new URL(route.request().url()).searchParams.has('before')
    return route.fulfill({ json: { items: older ? [event(0)] : Array.from({ length: 30 }, (_, i) => event(30 - i)), total: 31, hasMore: !older } })
  })
  await page.goto('/')
  const feed = page.locator('.world-live-viewport')
  await expect(page.locator('.world-live-list li')).toHaveCount(30)
  await feed.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
  await page.evaluate(e => (window as unknown as { emitWorld(e: unknown): void }).emitWorld(e), event(31))
  await expect(page.getByRole('button', { name: '새 기록 1개', exact: false })).toBeVisible()
  expect(await feed.evaluate(el => el.scrollTop)).toBe(0)
  await page.getByRole('button', { name: '과거 기록 더 보기' }).click()
  await expect(page.locator('[data-event-id="live-0"]')).toHaveCount(1)
  await page.getByRole('button', { name: '새 기록 1개', exact: false }).click()
  await expect(page.locator('[data-event-id="live-31"]')).toBeVisible()
  expect(await feed.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(5)
  await page.getByRole('button', { name: 'TEXT', exact: true }).click()
  await expect(page.locator('.reader-shell')).toBeVisible()
  await expect(feed).toHaveCount(0)
})
