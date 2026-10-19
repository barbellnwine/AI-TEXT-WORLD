import { readFileSync, writeFileSync } from 'node:fs'
const source = readFileSync('content/TA-060-original.md', 'utf8').replace(/^﻿/,'')
const sections = [...source.matchAll(/^## (\d{2})\. (.+)\r?\n([\s\S]*?)(?=^## \d{2}\. |$(?![\s\S]))/gm)].map(m => ({ number: m[1], title: m[2].trim(), body: m[3].trim().replace(/\r/g,'').replace(/\n— T\.A\.[^\n]*$/,'').trim() }))
if (sections.length !== 8) throw new Error(`Expected all 8 original sections, found ${sections.length}`)
const section = number => sections.find(s => s.number === number).body
// The incident card prints its own title, so a leading sub-heading in the source is dropped here.
const incident = number => section(number).replace(/^###\s+.*\r?\n+/, '')
const record = {
  id: 'TA-060', title: '남천유수풀장', subtitle: 'THE LAZY RIVER', category: '장소',
  risk: 'ORANGE', riskLabel: 'LEVEL III — ORANGE', status: 'ACTIVE / 접근 제한', clearance: 0,
  summary: '해당 시설에서는 물이 존재하지 않는다는 사실이 익사의 가능성을 부정하지 않는다.',
  description: section('01'), protocol: section('07'), art: 'lazyriver',
  phenomenon: '공간형 / 규칙 종속형 · 무수 익사 · 공간 변형', discovered: '2026년 / 부산광역시', region: '폐쇄된 남천유수풀장 및 시설 경계', recordStatus: '접근 제한 / 현상 미해결',
  published: true, archived: false, membersOnly: false, sections,
  // The open questions are the 우선 조사 대상 list inside the closing section.
  unresolvedSection: '08',
  // The three passages the record marks INCIDENT, OPERATION and INTERVIEW.
  episodes: [
    { title: 'INCIDENT TA-060-00 · 무수 익사 사건', body: incident('02'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
    { title: 'OPERATION TA-060-A · 최초 조사 작전', body: incident('03'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
    { title: 'INTERVIEW TA-060-01 · 생환 조사원 면담', body: incident('04'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
  ],
  // No photograph was supplied with this record.
  evidence: [],
  mission: null,
}
writeFileSync('content/TA-060.json', JSON.stringify(record,null,2))
console.log(`TA-060 prepared: all ${sections.length} original sections, ${record.episodes.length} incident records, no image supplied.`)
