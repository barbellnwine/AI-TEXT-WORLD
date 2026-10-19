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
  description: section('01'), protocol: section('10'), art: 'observed',
  phenomenon: '공간·존재 변칙형 · 관찰 의존 · 존재 분기', discovered: '2026년 5월 / 대한민국 경기도', region: '경기도 신축 공동주택 · 구 공장 부지', recordStatus: '조사 진행 중 / 격리 불완전',
  published: true, archived: false, membersOnly: false, sections,
  // The two passages the record itself marks INCIDENT.
  episodes: [
    { title: 'INCIDENT TA-059-00 · 사라진 604호', body: incident('03'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
    { title: 'INCIDENT TA-059-03 · 이상 인원 귀환', body: incident('08'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
  ],
  // No photograph was supplied with this record; the listing shows the stamp on its own.
  evidence: [],
  mission: null,
}
writeFileSync('content/TA-059.json', JSON.stringify(record,null,2))
console.log(`TA-059 prepared: all ${sections.length} original sections, ${record.episodes.length} incident records, no image supplied.`)
