import { test } from 'node:test'
import assert from 'node:assert/strict'
import { portraitFor, portraitNameFor } from '../src/world/portraits.ts'

// The five people actually running on the island, by the bios the engine wrote for them.
const SEASON = [
  ['응급실 간호사 · 침착·계산적·생존욕이 강하다.', 'medic'],
  ['조직폭력배 · 공격적·충동적·지배욕이 강하고 위협에 민감하다.', 'gangster'],
  ['직업군인 · 냉정·규율적·관찰력이 높다.', 'soldier'],
  ['사냥 및 야외활동 가이드 · 독립적·경계심·인내심이 높다.', 'hunter'],
  ['영업사원 · 사교적·기만에 능한 기회주의자.', 'salesman'],
] as const

test('every character of the running season is given the portrait of their trade', () => {
  for (const [shortBio, expected] of SEASON) assert.equal(portraitNameFor({ shortBio }), expected, shortBio)
})

test('an explicit avatarId outranks the guess from the bio', () => {
  assert.equal(portraitNameFor({ avatarId: 'gangster', shortBio: '응급실 간호사 · 침착하다.' }), 'gangster')
  // 'default' is what every character is launched with and names no picture, so the bio decides.
  assert.equal(portraitNameFor({ avatarId: 'default', shortBio: '응급실 간호사 · 침착하다.' }), 'medic')
  assert.equal(portraitNameFor({ avatarId: 'nobody', shortBio: '응급실 간호사 · 침착하다.' }), 'medic')
})

test('only the trade decides, not a word further into the sentence', () => {
  assert.equal(portraitNameFor({ shortBio: '영업사원 · 군인 출신 아버지를 두었다.' }), 'salesman')
  assert.equal(portraitNameFor({ shortBio: '직업군인 · 영업하듯 사람을 다룬다.' }), 'soldier')
})

test('a trade these pictures cannot stand in for gets none, and the letter avatar stays', () => {
  assert.equal(portraitNameFor({ shortBio: '우주비행사 · 침착하다.' }), null)
  assert.equal(portraitFor({ shortBio: '우주비행사 · 침착하다.' }), null)
  assert.equal(portraitNameFor({}), null)
  assert.equal(portraitNameFor({ shortBio: '' }), null)
})

test('a chosen portrait resolves to a file that is actually shipped', async () => {
  const { existsSync } = await import('node:fs')
  for (const [shortBio] of SEASON) {
    const url = portraitFor({ shortBio })!
    assert.ok(url.startsWith('/characters/'), url)
    assert.ok(existsSync(`public${url}`), `${url} is not in public/`)
  }
})
