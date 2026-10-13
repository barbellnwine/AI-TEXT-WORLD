import { expect, test } from '@playwright/test'

// The sidebar window answers "who is that"; the popup answers "what shape are they in". The
// seeded demo world carries the older string inventory and no readings at all, which is half of
// what the sheet has to survive — so the body/mind readings and a wound are added to the one
// person this test opens, and the rest of the payload is left exactly as the server sent it.
const CONDITION = {
  // The season is shared with every other spec and one of them may relaunch it, so the gear is
  // given here too rather than borrowed from whichever world happens to be seeded.
  inventory: ['시설 마스터키', '무전 로그북'],
  vitals: { health: 6, energy: 4, hunger: 7, thirst: 3, loneliness: 5 },
  emotion: { mood: 3, anger: 8, fear: 6 },
  humanState: { survival_need: 8, fatigue: 6, stress: 7, sexual_desire: 0, greed: 2, ambition: 4 },
  trauma: {
    version: 1, lastMinute: 120, bloodLoss: 0.06, pain: 3.5,
    functions: { vision: 0.3, mobility: 0, dexterity: 0, attention: 0.1 },
    injuries: [{ id: 'w1', sourceEventId: 'e1', onset: 100, treatedAt: null, healed: false, part: 'HEAD',
      type: 'laceration', site: 'face', severity: 2, bleeding: 1, pain: 3, healingHours: 48,
      effects: [{ function: 'vision', degree: 0.3, mechanism: 'blood_obstruction' }] }],
  },
}

test('the character window opens a full sheet over the story', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('ai_world_locale', 'ko-KR'))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  // A live push replaces the whole world state, injected readings and all, and the season is
  // shared with specs that make the world tick. The sheet is about one fetched snapshot.
  await page.route('**/api/world/stream', route => route.abort())
  await page.route('**/api/world/current', async route => {
    const response = await route.fetch()
    const body = await response.json()
    const first = body.worldState?.agents?.[0]
    if (first) Object.assign(first, CONDITION)
    await route.fulfill({ response, json: body })
  })
  await page.goto('/')
  await expect(page.locator('.world-vitals')).toBeVisible()
  if (info.project.name === 'mobile') await page.locator('.observatory-mobile-tabs').getByRole('button', { name: '등장인물' }).click()

  await page.locator('.observatory-person').first().click()
  await expect(page.locator('.observatory-character-detail')).toBeVisible()
  await page.getByRole('button', { name: /인물 자세히 보기/ }).click()

  const sheet = page.locator('dialog.character-sheet')
  await expect(sheet).toBeVisible()
  expect((await sheet.locator('#character-sheet-title').textContent())?.trim().length).toBeGreaterThan(0)

  // The picture is the reason the popup exists, so it has to arrive far bigger than the thumbnail
  // in the sidebar list — whether this world's trades have portraits or only lettered avatars.
  const sheetBox = await sheet.locator('.character-sheet-portrait').boundingBox()
  const thumb = await page.locator('.observatory-person').first().locator('.observatory-avatar').boundingBox()
  expect(sheetBox!.width).toBeGreaterThan((thumb?.width ?? 36) * 2)

  // Gear here is the demo world's own string inventory: a season from before the object engine
  // still has to fill this shelf.
  await expect(sheet.getByRole('heading', { name: '가진 장비' })).toBeVisible()
  await expect(sheet.locator('.character-sheet-gear .character-sheet-items li').first()).toBeVisible()

  await expect(sheet.getByRole('heading', { name: '신체' })).toBeVisible()
  await expect(sheet.getByRole('heading', { name: '정신' })).toBeVisible()
  await expect(sheet.locator('.character-sheet-gauges li.tone-bad').first()).toBeVisible()
  await expect(sheet.locator('.character-sheet-wounds')).toContainText('머리 얼굴 자상')
  await expect(sheet.locator('.character-sheet-wounds')).toContainText('처치 안 됨')
  await expect(sheet.getByRole('link', { name: /전체 기록 보기/ })).toBeVisible()

  await sheet.screenshot({ path: `test-results/character-sheet-${info.project.name}.png` })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await sheet.getByRole('button', { name: '닫기' }).click()
  await expect(sheet).toBeHidden()
  expect(errors).toEqual([])
})
