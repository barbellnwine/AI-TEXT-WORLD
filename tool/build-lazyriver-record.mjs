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
  description: section('01'), protocol: section('07'), art: 'lazyriver', coverImage: '/media/ta-060-overview.png',
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
  // The structures 02-1 lists, in the order a reader meets them: the whole site, then the
  // bridge the survivor was told not to speak under, then the slides rule 04 governs.
  evidence: [
    { title: '시설 전경 — 순환형 유수풀', type: 'image', url: '/media/ta-060-overview.png', body: '폐장 상태의 남천유수풀장 전경. 02-1절이 기술한 순환형 유수풀과 중앙 수영 구역, 미끄럼틀 탑이 한 화면에 들어온다. 수로에는 물이 없다.', clearance: 0 },
    { title: '유수풀 상부 보행교', type: 'image', url: '/media/ta-060-bridge.png', body: '이용수칙 03항이 적용되는 구조물. 생환 조사원은 이 다리를 지나며 아래쪽에 사람이 있는 것처럼 보였다고 진술했고, 안내문에 따라 말을 걸지 않았다.', clearance: 0 },
    { title: '다중 레일 미끄럼틀', type: 'image', url: '/media/ta-060-slides.png', body: '이용수칙 04항이 적용되는 구조물. 최초 조사 작전 당시 폐쇄된 이 레일에서 이용객의 비명과 웃음소리가 들렸으나 실제 이용객은 확인되지 않았다.', clearance: 0 },
  ],
  mission: null,
}
writeFileSync('content/TA-060.json', JSON.stringify(record,null,2))
console.log(`TA-060 prepared: all ${sections.length} original sections, ${record.episodes.length} incident records, ${record.evidence.length} images.`)
