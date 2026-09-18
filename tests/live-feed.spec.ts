import { expect, test, type Page } from '@playwright/test'
import type { FeedItem, PublicAgent, StatusResponse } from '../src/ai-community/types'

const createdAt = '2026-09-18T03:00:00.000Z'

function agent(name = 'First agent'): PublicAgent {
  return {
    id: 'test-agent', name, personaKey: 'test', personality: 'Curious', goals: 'Discuss ideas',
    status: 'READY', cooldownUntil: null, lastActedAt: null, totalActions: 0, createdAt,
  }
}

function status(runtime: StatusResponse['status']): StatusResponse {
  return {
    status: runtime, demoMode: true,
    week: {
      weekKey: '2026-W38', budgetKrw: 10000, thresholdKrw: 9000, committedKrw: 0,
      remainingKrw: 10000, settledKrw: 0, settledUsd: 0, usdToKrwRate: 1400,
    },
  }
}

function post(title: string, action: FeedItem['action'] = 'CREATE_POST'): FeedItem {
  return { id: title, title, action, agentId: 'test-agent', body: 'A community update', createdAt }
}

async function prepareClock(page: Page) {
  await page.addInitScript(() => localStorage.setItem('aiCommunityLang', 'en'))
  await page.clock.install({ time: new Date('2026-09-18T03:00:00Z') })
  await page.clock.pauseAt(new Date('2026-09-18T03:00:01Z'))
}

async function setVisible(page: Page, visible: boolean) {
  await page.evaluate(isVisible => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true, get: () => isVisible ? 'visible' : 'hidden',
    })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !isVisible })
    document.dispatchEvent(new Event('visibilitychange'))
  }, visible)
}

test('live feed refreshes data, recovers after an error and pauses while hidden', async ({ page }) => {
  await prepareClock(page)
  let title = 'Initial post'
  let agentName = 'First agent'
  let runtime: StatusResponse['status'] = 'STOPPED'
  let failFeed = false
  const requests = { status: 0, agents: 0, feed: 0 }
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/api/ai-community/**', async route => {
    expect(route.request().method()).toBe('GET')
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1)
    if (endpoint === 'status') {
      requests.status++
      await route.fulfill({ json: status(runtime) })
    } else if (endpoint === 'agents') {
      requests.agents++
      await route.fulfill({ json: { agents: [agent(agentName)] } })
    } else if (endpoint === 'feed') {
      requests.feed++
      await route.fulfill(failFeed
        ? { status: 503, json: { error: 'Temporarily unavailable' } }
        : { json: { items: [post(title)] } })
    } else {
      await route.fulfill({ status: 404, json: { error: 'Unexpected test endpoint' } })
    }
  })

  await page.goto('/#/ai-community')
  await expect(page.locator('.ai-feed-title')).toHaveText('Initial post')
  await expect(page.locator('.ai-status-pill')).toHaveText('Stopped')

  title = 'Automatically published post'
  agentName = 'Updated agent'
  runtime = 'RUNNING'
  await page.clock.runFor(15000)
  await expect(page.locator('.ai-feed-title')).toHaveText(title)
  await expect(page.locator('.ai-status-pill')).toHaveText('Running')
  await expect(page.locator('.ai-filter-bar select').first()).toContainText(agentName)
  await expect(page.locator('.ai-feed-item .ai-agent-link')).toHaveText(agentName)

  failFeed = true
  await page.clock.runFor(15000)
  await expect(page.locator('.ai-error')).toBeVisible()
  await expect(page.locator('.ai-feed-title')).toHaveText('Automatically published post')

  failFeed = false
  title = 'Recovered post'
  runtime = 'PAUSED'
  await page.clock.runFor(15000)
  await expect(page.locator('.ai-feed-title')).toHaveText(title)
  await expect(page.locator('.ai-status-pill')).toHaveText('Paused')
  await expect(page.locator('.ai-error')).toHaveCount(0)

  await setVisible(page, false)
  const requestsBeforeHiding = { ...requests }
  title = 'Published while hidden'
  runtime = 'RUNNING'
  await page.clock.runFor(45000)
  expect(requests).toEqual(requestsBeforeHiding)
  await expect(page.locator('.ai-feed-title')).toHaveText('Recovered post')

  await setVisible(page, true)
  await expect(page.locator('.ai-feed-title')).toHaveText(title)
  await expect(page.locator('.ai-status-pill')).toHaveText('Running')
  expect(requests).toEqual({
    status: requestsBeforeHiding.status + 1,
    agents: requestsBeforeHiding.agents + 1,
    feed: requestsBeforeHiding.feed + 1,
  })
  expect(pageErrors).toEqual([])
})

test('changing filters cancels the previous request and ignores its delayed result', async ({ page }) => {
  await prepareClock(page)
  let releaseComment!: () => void
  let completeComment!: () => void
  let commentStarted = false
  let commentCancelled = false
  const commentResponseGate = new Promise<void>(resolve => { releaseComment = resolve })
  const commentCompleted = new Promise<void>(resolve => { completeComment = resolve })
  page.on('requestfailed', request => {
    if (new URL(request.url()).searchParams.get('action') === 'COMMENT') commentCancelled = true
  })
  await page.route('**/api/ai-community/**', async route => {
    expect(route.request().method()).toBe('GET')
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/status')) {
      await route.fulfill({ json: status('RUNNING') })
    } else if (url.pathname.endsWith('/agents')) {
      await route.fulfill({ json: { agents: [agent()] } })
    } else if (url.pathname.endsWith('/feed')) {
      const action = url.searchParams.get('action')
      if (action === 'COMMENT') {
        commentStarted = true
        await commentResponseGate
        try {
          await route.fulfill({ json: { items: [post('Outdated comment result', 'COMMENT')] } })
        } catch (error) {
          // Aborting a fetch can also close its intercepted route before fulfillment.
          if (!commentCancelled) throw error
        } finally {
          completeComment()
        }
      } else {
        await route.fulfill({ json: {
          items: [action === 'QUESTION' ? post('Current question result', 'QUESTION') : post('Initial post')],
        } })
      }
    } else {
      await route.fulfill({ status: 404, json: { error: 'Unexpected test endpoint' } })
    }
  })

  await page.goto('/#/ai-community')
  await expect(page.locator('.ai-feed-title')).toHaveText('Initial post')
  const actionFilter = page.locator('.ai-filter-bar select').nth(1)
  await actionFilter.selectOption('COMMENT')
  await expect.poll(() => commentStarted).toBe(true)
  await actionFilter.selectOption('QUESTION')
  await expect(page.locator('.ai-feed-title')).toHaveText('Current question result')
  await expect.poll(() => commentCancelled).toBe(true)

  releaseComment()
  await commentCompleted
  await page.clock.runFor(1)
  await expect(actionFilter).toHaveValue('QUESTION')
  await expect(page.locator('.ai-feed-title')).toHaveText('Current question result')
  await expect(page.locator('.ai-error')).toHaveCount(0)

  await page.clock.runFor(15000)
  await expect(page.locator('.ai-feed-title')).toHaveText('Current question result')
})
