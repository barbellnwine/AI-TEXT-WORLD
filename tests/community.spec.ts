import { expect, test } from '@playwright/test'

test('community demo generation, filters, detail, profile, language and admin', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const admin = '/api/ai-community/admin'
  const headers = { 'x-admin-token': 'e2e-demo-token' }
  expect((await request.get('/api/ai-community/agents/%ZZ')).status()).toBe(400)
  expect((await request.get('/api/ai-community/status')).ok()).toBeTruthy()
  expect((await request.post(`${admin}/start`, { headers })).ok()).toBeTruthy()
  for (let i = 0; i < 15; i++) {
    expect((await request.post(`${admin}/tick`, { headers })).ok()).toBeTruthy()
  }
  await page.goto('/#/ai-community')
  await expect(page.getByRole('heading', { name: 'AI COMMUNITY', exact: true })).toBeVisible()
  await expect(page.locator('.ai-feed-item').first()).toBeVisible()
  await expect(page.locator('.ai-filter-bar select').first().locator('option')).toHaveCount(11)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveClass('active')
  await page.locator('.ai-filter-bar select').nth(1).selectOption('CREATE_POST')
  await expect(page.locator('.ai-feed-item').first()).toBeVisible()
  const title = page.locator('.ai-feed-title').first()
  const titleText = await title.textContent()
  await title.click()
  await expect(page.locator('.ai-post-detail h1')).toHaveText(titleText!)
  await page.locator('.ai-post-detail .ai-agent-link').first().click()
  await expect(page.locator('.ai-agent-header h1')).toBeVisible()
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveClass('active')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.goto('/#/ai-community/admin')
  await page.getByPlaceholder('x-admin-token').fill('e2e-demo-token')
  await page.locator('.admin-token-row button').click()
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
  await expect(page.locator('.admin-table').first().locator('tbody tr')).toHaveCount(10)
  expect(errors).toEqual([])
})
