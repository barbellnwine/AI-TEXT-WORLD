import { readFileSync, writeFileSync } from 'node:fs'
const source = readFileSync('content/TA-062-original.md', 'utf8').replace(/^﻿/,'')
const sections = [...source.matchAll(/^## (\d{2})\. (.+)\r?\n([\s\S]*?)(?=^## \d{2}\. |$(?![\s\S]))/gm)].map(m => ({ number: m[1], title: m[2].trim(), body: m[3].trim().replace(/\r/g,'').replace(/\n— T\.A\.[^\n]*$/,'').trim() }))
if (sections.length !== 9) throw new Error(`Expected all 9 original sections, found ${sections.length}`)
const section = number => sections.find(s => s.number === number).body
// The incident card prints its own title, so a leading sub-heading in the source is dropped here.
const incident = number => section(number).replace(/^###\s+.*\r?\n+/, '')
const record = {
  id: 'TA-062', title: '딱따구리', subtitle: 'THE WOODPECKER', category: '개체',
  risk: 'RED', riskLabel: 'LEVEL IV — RED', status: '미확립 / 출현 지역 통제', clearance: 0,
  summary: '저것들이 두드릴 때 안에 있는 것이 대답하는 건지, 아니면 두드림이 멈출 때 비로소 대답할 수 있게 되는 건지.',
  description: section('01'), protocol: section('08'), art: 'woodpecker', coverImage: '/media/ta-062-woodpecker.png',
  phenomenon: '군집형 변칙 인체 / 신목 종속형 · 드러밍 · 집단 동조', discovered: '2026년 4월 / 경상북도 ○○군', region: '제의 이력이 확인된 당산나무·서낭나무 등 신목', recordStatus: '추가 조사 진행 중 / 격리 미확립',
  published: true, archived: false, membersOnly: false, sections,
  // The open questions are the unexplained behaviours the closing section lists.
  unresolvedSection: '09',
  // The two passages the record marks INCIDENT and INTERVIEW.
  episodes: [
    { title: 'INCIDENT TA-062-01 · 당산나무의 타격음', body: incident('05'), clearance: 0, publishAt: '2026-10-21T00:00:00Z' },
    { title: 'INTERVIEW TA-062-01 · 마을 거주자 진술', body: incident('06'), clearance: 0, publishAt: '2026-10-21T00:00:00Z' },
  ],
  evidence: [
    { title: '출현 지역 산림 — 개체 관측', type: 'image', url: '/media/ta-062-woodpecker.png', body: '출현 수목 주변 산림에서 촬영된 개체. 02절이 기술한 대로 안면부에 무광의 가면이 부착되어 있고, 목은 일반적인 인체의 운동 범위를 넘어 뒤로 젖혀져 있다.', clearance: 0 },
    { title: '신목 가지 위의 개체', type: 'image', url: '/media/ta-062-branch.png', body: '01절이 기술한 자세. 개체는 굵은 가지에 몸을 밀착한 상태를 유지한다. 가지에 묶인 천 조각은 03절이 정리한 제의 이력의 흔적이다.', clearance: 0 },
  ],
  mission: null,
}
writeFileSync('content/TA-062.json', JSON.stringify(record,null,2))
console.log(`TA-062 prepared: all ${sections.length} original sections, ${record.episodes.length} incident records, ${record.evidence.length} images.`)
