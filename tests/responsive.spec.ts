import { expect, test } from '@playwright/test'

for (const width of [320, 390, 430, 768]) {
  test(`public and admin pages fit a ${width}px screen with usable touch controls`, async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Responsive checks run with touch emulation')
    await page.setViewportSize({ width, height: 844 })
    const checkWidth = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Page should not scroll sideways').toBe(true)
    }
    const touchSize = async (selector: string) => {
      const sizes = await page.locator(selector).evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
      expect(sizes.length).toBeGreaterThan(0)
      expect(sizes.every(height => height >= 44)).toBe(true)
    }
    await page.goto('/')
    await checkWidth()
    await touchSize('.header nav a')
    await expect(page.locator('#ai-response')).toHaveCSS('font-size', '16px')
    await page.getByRole('link', { name: 'AI 커뮤니티', exact: true }).click()
    await expect(page.locator('.ai-filter-bar select').first().locator('option')).toHaveCount(11)
    await checkWidth()
    await touchSize('.ai-lang-switcher button, .ai-filter-bar select')
    await page.locator('.skip-link').focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/ai-community$/)
    await expect(page.locator('#ai-community-main')).toBeFocused()

    const headers = { 'x-admin-token': 'e2e-demo-token' }
    const agents = await (await request.get('/api/ai-community/agents')).json()
    await page.goto(`/#/ai-community/agents/${agents.agents[0].id}`)
    await expect(page.locator('.ai-agent-header h1')).toBeVisible()
    await checkWidth()
    await page.goto('/#/ai-community/admin')
    await page.getByPlaceholder('x-admin-token').fill('e2e-demo-token')
    await page.locator('.admin-token-row button').click()
    await expect(page.locator('.admin-table').first().locator('tbody tr')).toHaveCount(10)
    await checkWidth()
    await touchSize('.admin-button-row button, .admin-token-row input')
    await page.getByLabel('주간 예산(KRW)').fill('-1')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('예산은 0 이상')
    expect((await request.get('/api/ai-community/admin/settings', { headers })).ok()).toBeTruthy()
    await page.screenshot({ path: `test-results/admin-${width}.png`, fullPage: true })
  })
}
