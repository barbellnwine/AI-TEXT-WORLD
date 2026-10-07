import { test, expect } from '@playwright/test'

// Every person in the list wears their own face, and picking one opens a window with it.
test('characters show the portrait of their trade, and the picked one opens a window', async ({ page, request }, info) => {
  const current = await (await request.get('/api/world/current')).json()
  const world = current.worldState
  const person = (id: string, name: string, shortBio: string, status = 'alive') => ({
    ...world.agents[0], id, name, shortBio, avatarId: 'default', age: 34, profile: { gender: '남성', orientation: '이성애' },
    relationships: [], inventory: [], journal: [], movementLog: [],
    publicState: { ...world.agents[0].publicState, status, locationId: world.places[0].id, lastAction: '물가로 내려갔다', travel: null },
  })
  // The five trades the shipped portraits stand for, plus one they cannot.
  world.agents = [
    person('p-medic', '간호사', '응급실 간호사 · 침착·계산적이다.'),
    person('p-gang', '조폭', '조직폭력배 · 공격적·충동적이다.'),
    person('p-soldier', '군인', '직업군인 · 냉정·규율적이다.'),
    person('p-hunter', '사냥꾼', '사냥 및 야외활동 가이드 · 독립적이다.'),
    person('p-sales', '영업', '영업사원 · 사교적이다.'),
    person('p-none', '우주인', '우주비행사 · 침착하다.'),
  ]
  await page.addInitScript(() => localStorage.setItem('ai_world_locale', 'ko-KR'))
  await page.route('**/api/world/current', route => route.fulfill({ json: current }))
  await page.goto('/')
  if (info.project.name === 'mobile') await page.locator('.observatory-mobile-tabs').getByRole('button', { name: '등장인물' }).click()

  const row = (name: string) => page.locator('.observatory-people').getByRole('button', { name: new RegExp(name) })
  const expected: Array<[string, string]> = [
    ['간호사', 'medic'], ['조폭', 'gangster'], ['군인', 'soldier'], ['사냥꾼', 'hunter'], ['영업', 'salesman'],
  ]
  for (const [name, portrait] of expected) {
    await expect(row(name).locator('.observatory-avatar img')).toHaveAttribute('src', `/characters/${portrait}.webp`)
  }
  // A trade with no picture keeps the lettered tile it always had.
  await expect(row('우주인').locator('.observatory-avatar img')).toHaveCount(0)
  await expect(row('우주인').locator('.observatory-avatar')).toHaveText('우')

  // Every portrait actually decodes: a broken or missing file would leave a zero-width image. They
  // are lazily loaded, so this waits for them rather than catching them mid-flight.
  await expect.poll(async () => page.locator('.observatory-avatar img').evaluateAll(
    els => els.length > 0 && els.every(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0),
  ), { timeout: 15000 }).toBe(true)

  // Picking someone opens the window: their face, their trade, their status and where they are.
  await row('조폭').click()
  const window = page.locator('.character-window')
  await expect(window).toBeVisible()
  await expect(window.locator('.character-window-portrait')).toHaveAttribute('src', '/characters/gangster.webp')
  await expect(window.locator('.character-window-portrait')).toHaveAttribute('alt', '조폭 초상')
  await expect(window.locator('.character-window-trade')).toContainText('조직폭력배')
  await expect(window.locator('.character-window-trade')).toContainText('34세')
  await expect(window.locator('.observatory-person-status')).toContainText(world.places[0].name)
  await page.locator('.observatory-characters').screenshot({ path: `data/logs/character-window-${info.project.name}.png` })

  // Picking another swaps the whole window over, portrait and all.
  await row('간호사').click()
  await expect(window.locator('.character-window-portrait')).toHaveAttribute('src', '/characters/medic.webp')
  await expect(window.locator('.character-window-trade')).toContainText('응급실 간호사')

  // Someone with no portrait still opens a window, just without a picture in it.
  await row('우주인').click()
  await expect(window).toBeVisible()
  await expect(window.locator('.character-window-portrait')).toHaveCount(0)
  await expect(window.locator('.character-window-trade')).toContainText('우주비행사')
})
