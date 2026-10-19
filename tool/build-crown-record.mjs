import { readFileSync, writeFileSync } from 'node:fs'
const source = readFileSync('content/TA-001-original.md', 'utf8').replace(/^﻿/,'')
const sections = [...source.matchAll(/^## (\d{2})\. (.+)\r?\n([\s\S]*?)(?=^## \d{2}\. |$(?![\s\S]))/gm)].map(m => ({ number: m[1], title: m[2].trim(), body: m[3].trim().replace(/\r/g,'').replace(/\nEND OF RECORD[^\n]*$/,'').trim() }))
if (sections.length !== 10) throw new Error(`Expected all 10 original sections, found ${sections.length}`)
const section = number => sections.find(s => s.number === number).body
// The incident card prints its own title, so the section's leading sub-heading is dropped here only.
const incident = number => section(number).replace(/^###\s+.*\r?\n+/, '')
// The still carries a burned-in T.A.-071 overlay. Rather than hide it, the archive reads it as
// the provisional observation number the footage was logged under before TA-001 was registered.
// The date in the overlay is the real one, so it no longer needs explaining away.
const provisional = '잠수 #047 / 2019-03-17 기록. 영상 상단의 T.A.-071은 최초 등록 이전 임시 관측번호이며, 현재 식별번호는 TA-001이다.'
const record = {
  id: 'TA-001', title: '수압의 왕관', subtitle: 'THE CROWN', category: '개체',
  risk: 'BLACK', riskLabel: 'BLACK — 통제 불가', status: 'ACTIVE / 미격리', clearance: 0,
  summary: '2019년, 인류는 바다의 최심부에서 기존의 과학으로 설명할 수 없는 생명체를 발견했다.',
  description: section('01'), protocol: section('07'), art: 'crown', coverImage: '/media/ta-001-crown.png',
  phenomenon: '해양 생물형 / 공간 변칙형 · 심도 지배', discovered: '2019년 / 태평양 마리아나 해구 심부', region: '마리아나 해구 심부 · 접근 제한 해역', recordStatus: '미격리 / 비접근 통제',
  published: true, archived: false, membersOnly: false, sections,
  // The one passage the record itself marks INCIDENT.
  episodes: [
    { title: 'INCIDENT TA-001-00 · 최초 발견 기록', body: incident('03'), clearance: 0, publishAt: '2026-10-19T00:00:00Z' },
  ],
  evidence: [
    { title: '전신 관측 영상', type: 'image', url: '/media/ta-001-crown.png', body: '개체의 머리에서 꼬리지느러미까지가 한 화면에 담긴 유일한 자료. 좌측 하단의 ROV와 비교하면 02-1절이 기술한 규모를 가늠할 수 있다.', clearance: 0 },
    { title: '잠수 #047 — 두부 및 안구 (CAM 02)', type: 'image', url: '/media/ta-001-dive047-eye.png', body: `ROV K-HSDV-3 우현 카메라. 수심 4213.6 m, 수온 1.4 °C, 외부 압력 424.7 bar. 우측 2 m 축척과 대조되는 안구 두 개가 02-2절이 기술한 좌우 각 두 개 배치의 한쪽이다. ${provisional}`, clearance: 0 },
  ],
  mission: null,
}
writeFileSync('content/TA-001.json', JSON.stringify(record,null,2))
console.log(`TA-001 prepared: all ${sections.length} original sections, ${record.episodes.length} incident record, ${record.evidence.length} images.`)
