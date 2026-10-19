import { readFileSync, writeFileSync } from 'node:fs'
const source = readFileSync('content/TA-021-original.md', 'utf8').replace(/^\uFEFF/,'')
const sections = [...source.matchAll(/^## (\d{2})\. (.+)\r?\n([\s\S]*?)(?=^## \d{2}\. |$(?![\s\S]))/gm)].map(m => ({ number: m[1], title: m[2].trim(), body: m[3].trim().replace(/\r/g,'').replace(/\n---\s*$/,'').trim() }))
if (sections.length !== 11) throw new Error(`Expected all 11 original sections, found ${sections.length}`)
const section = number => sections.find(s => s.number === number).body
const record = {
  id: 'TA-021', title: '새벽 3시 14분의 택배', subtitle: 'THE DELIVERY', category: '현상',
  risk: 'ORANGE', riskLabel: 'LEVEL III — ORANGE', status: 'ACTIVE / 활동 중', clearance: 0,
  summary: '이름 없는 택배가 도착한 집에는, 원래 없던 사람이 살기 시작한다.',
  description: section('01'), protocol: section('04'), art: 'delivery', coverImage: '/media/ta-021-delivery.png',
  phenomenon: '공간 침입 · 인지 교란 · 인원 대체', discovered: '2025년 겨울 / 대한민국 경기도', region: '국내 공동주택 및 다세대주택', recordStatus: '조사 진행 중',
  published: true, archived: false,
  // Pinned as the home hero, with the headline the 사건 띠 has always carried for this record.
  featured: true, membersOnly: false, incidentHeadline: '상자를 들인 뒤,\n자리가 하나 더 생겼다.',
  sections,
  episodes: [ { title: '최초 발견 기록', body: section('06'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' }, { title: 'INCIDENT TA-021-04 · 다섯 번째 자리', body: section('07'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' } ],
  evidence: [{ title: '현관 앞 택배 상자', type: 'image', url: '/media/ta-021-delivery.png', body: 'TA-021 기록에 첨부된 원본 이미지. 이미지 내 표기: 2026-11-03 03:14:27. 표기 시각은 이미지에 포함된 창작 설정입니다.', clearance: 0 }],
  mission: null,
}
writeFileSync('content/TA-021.json', JSON.stringify(record,null,2))
console.log('TA-021 prepared: all 11 original sections, 2 incident records, 1 original image.')
