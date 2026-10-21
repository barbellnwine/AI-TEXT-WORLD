import { readFileSync, writeFileSync } from 'node:fs'
const source = readFileSync('content/TA-061-original.md', 'utf8').replace(/^﻿/,'')
const sections = [...source.matchAll(/^## (\d{2})\. (.+)\r?\n([\s\S]*?)(?=^## \d{2}\. |$(?![\s\S]))/gm)].map(m => ({ number: m[1], title: m[2].trim(), body: m[3].trim().replace(/\r/g,'').replace(/\n— T\.A\.[^\n]*$/,'').trim() }))
if (sections.length !== 10) throw new Error(`Expected all 10 original sections, found ${sections.length}`)
const section = number => sections.find(s => s.number === number).body
// The incident card prints its own title, so a leading sub-heading in the source is dropped here.
const incident = number => section(number).replace(/^###\s+.*\r?\n+/, '')
const record = {
  id: 'TA-061', title: '대신 우는 자', subtitle: 'THE WEEPER', category: '개체',
  risk: 'BLACK', riskLabel: 'LEVEL V — BLACK', status: '미확립 / 노출자 보호 관찰', clearance: 0,
  summary: '피해자는 누군가의 죽음을 슬퍼하지 않게 되는 대신, 살아 있는 자신을 애도하는 사람들 사이에 남겨진다.',
  description: section('01'), protocol: section('09'), art: 'weeper', coverImage: '/media/ta-061-weeper.png',
  phenomenon: '인식·기억 변조형 / 대리 애도 · 사회적 사망', discovered: '2026년 6월 / 강원특별자치도 ○○군', region: '강원특별자치도 산림지대 및 노출자의 생활권', recordStatus: '고위험 지속 관찰 / 격리 미확립',
  published: true, archived: false, membersOnly: false, sections,
  // The open questions are the hypotheses the record closes on, not a numbered list.
  unresolvedSection: '10',
  // The three passages the record marks INCIDENT and INTERVIEW.
  episodes: [
    { title: 'INCIDENT TA-061-01 · 산책로의 울음', body: incident('05'), clearance: 0, publishAt: '2026-10-21T00:00:00Z' },
    { title: 'INTERVIEW TA-061-01 · 최초 신고자 면담', body: incident('06'), clearance: 0, publishAt: '2026-10-21T00:00:00Z' },
    { title: 'INTERVIEW TA-061-B · 피해자 부친 독립 면담', body: incident('07'), clearance: 0, publishAt: '2026-10-21T00:00:00Z' },
  ],
  evidence: [
    { title: '최초 발견 지점 인근 산림', type: 'image', url: '/media/ta-061-weeper.png', body: '최초 발견 지점 인근 산림에서 촬영된 자료. 검은 긴 머리카락이 가면의 측면과 어깨를 따라 늘어진 02절의 기술이 확인된다.', clearance: 0 },
  ],
  mission: null,
}
writeFileSync('content/TA-061.json', JSON.stringify(record,null,2))
console.log(`TA-061 prepared: all ${sections.length} original sections, ${record.episodes.length} incident records, ${record.evidence.length} image.`)
