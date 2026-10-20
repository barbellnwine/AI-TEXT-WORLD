import { existsSync, readFileSync, writeFileSync } from 'node:fs'
const source = readFileSync('content/TA-013-original.md', 'utf8').replace(/^﻿/,'')
const sections = [...source.matchAll(/^## (\d{2})\. (.+)\r?\n([\s\S]*?)(?=^## \d{2}\. |$(?![\s\S]))/gm)].map(m => ({ number: m[1], title: m[2].trim(), body: m[3].trim().replace(/\r/g,'').replace(/\n---\s*$/,'').trim() }))
if (sections.length !== 8) throw new Error(`Expected all 8 original sections, found ${sections.length}`)
const section = number => sections.find(s => s.number === number).body
const incident = number => section(number).replace(/^###\s+.*\r?\n+/, '')
// The photograph is the first frame and the reel is what follows it, so the footage is filed as
// evidence of the same record rather than parked in a tab of its own. It is attached only once
// the file is in place: a player pointed at a missing file reads as a broken record, so until
// the reel is delivered the record stands on its photograph alone.
const reel = ['mp4','webm'].map(ext => 'media/ta-013-inverse-clap.' + ext).find(f => existsSync('public/' + f))
const evidence = [{ title: '식사 중 박수 동작', type: 'image', url: '/media/ta-013-inverse.png', body: 'TA-013 기록에 첨부된 원본 이미지. 최초 조사 사건의 진술에 해당하는 장면입니다.', clearance: 0 }]
if (reel) evidence.push({ title: '손등 박수 동작 / 회수 영상', type: 'video', url: '/' + reel, body: 'TA-013 기록에 첨부된 원본 영상. 최초 조사 사건의 진술에 해당하는 박수 동작이 기록되어 있습니다.', clearance: 0 })
const record = {
  id: 'TA-013', title: '반대로 익힌 사람', subtitle: 'THE INVERSE', category: '개체',
  risk: 'ORANGE', riskLabel: 'LEVEL III — ORANGE', status: 'ACTIVE / 활동 중', clearance: 0,
  summary: '그 사람은 잘못된 행동을 하는 것이 아니다. 그 행동이 잘못되었다는 사실을 모른다.',
  description: section('01'), protocol: section('08'), art: 'inverse', coverImage: '/media/ta-013-inverse.png',
  phenomenon: '인간형 · 행동 모방 이상 · 행동 동화', discovered: '2025년 11월 / 대한민국 경기도', region: '국내 공동주택 · 장기 접촉 가구', recordStatus: '초안 / 최초 조사 자료',
  published: true, archived: false, membersOnly: false, sections,
  // The record reads as a serial: each investigation step overturns the previous one.
  // The incident card already prints its own title, so a leading sub-heading in the source
  // section would show twice; it stays in the 개체 기록서 and is dropped only here.
  episodes: [
    { title: 'INCIDENT TA-013-01 · 오래된 습관', body: incident('03'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
    { title: 'INCIDENT TA-013-02 · 다섯 번째 생일', body: incident('04'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
    { title: 'INCIDENT TA-013-03 · 아버지의 진술', body: incident('05'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
    { title: 'INCIDENT TA-013-04 · 생후 8개월', body: incident('06'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
  ],
  evidence,
  mission: null,
}
writeFileSync('content/TA-013.json', JSON.stringify(record,null,2))
console.log('TA-013 prepared: all 8 original sections, 4 incident records, 1 original image, ' + (reel ? 'reel ' + reel : 'no reel on file yet') + '.')
