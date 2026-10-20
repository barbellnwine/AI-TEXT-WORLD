import { readFileSync, writeFileSync } from 'node:fs'
const source = readFileSync('content/TA-059-original.md', 'utf8').replace(/^﻿/,'')
const sections = [...source.matchAll(/^## (\d{2})\. (.+)\r?\n([\s\S]*?)(?=^## \d{2}\. |$(?![\s\S]))/gm)].map(m => ({ number: m[1], title: m[2].trim(), body: m[3].trim().replace(/\r/g,'').replace(/\nEND OF RECORD[^\n]*$/,'').trim() }))
if (sections.length !== 13) throw new Error(`Expected all 13 original sections, found ${sections.length}`)
const section = number => sections.find(s => s.number === number).body
// The incident card prints its own title, so the section's leading sub-heading is dropped here only.
const incident = number => section(number).replace(/^###\s+.*\r?\n+/, '')
const record = {
  id: 'TA-059', title: '관찰 종료', subtitle: 'THE OBSERVED', category: '현상',
  risk: 'ORANGE', riskLabel: 'LEVEL III — ORANGE', status: 'ACTIVE / 부분 억제', clearance: 0,
  summary: 'TA-059의 가장 심각한 위험은 공간의 소실이 아니라, 그 공간에 들어간 인간이 반드시 한 명의 인간으로 돌아온다는 보장이 없다는 것이다.',
  description: section('01'), protocol: section('10'), art: 'observed', coverImage: '/media/ta-059-604.png',
  phenomenon: '공간·존재 변칙형 · 관찰 의존 · 존재 분기', discovered: '2026년 5월 / 대한민국 경기도', region: '경기도 신축 공동주택 · 구 공장 부지', recordStatus: '조사 진행 중 / 격리 불완전',
  published: true, archived: false, membersOnly: false, sections,
  // The two passages the record itself marks INCIDENT.
  episodes: [
    { title: 'INCIDENT TA-059-00 · 사라진 604호', body: incident('03'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
    { title: 'INCIDENT TA-059-03 · 이상 인원 귀환', body: incident('08'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
  ],
  evidence: [
    { title: '6층 복도 — 603 · 604 · 605', type: 'image', url: '/media/ta-059-604.png', body: '03절이 기술한 복도. 603호와 605호는 정상이며 604호만 외형이 다르다. 문틈에서 복도 쪽으로 뻗은 긁힌 자국은 출입구가 다시 나타났을 때 안쪽에서 들린 소리와 같은 위치에 남아 있다.', clearance: 0 },
  ],
  mission: null,
}
writeFileSync('content/TA-059.json', JSON.stringify(record,null,2))
console.log(`TA-059 prepared: all ${sections.length} original sections, ${record.episodes.length} incident records, ${record.evidence.length} image.`)
