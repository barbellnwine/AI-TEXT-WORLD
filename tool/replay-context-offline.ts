import {readFileSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {buildNarratorPrompt} from '../server/prompts/narratorPrompt.ts'
import {sceneEvidence,narrativeSceneUnits,splitNarrativeScenes} from '../server/domain/sceneEvidence.ts'
import {eventProse} from '../server/domain/eventProse.ts'
import {causalStoryOrder,storyValidationIssue} from '../server/domain/novelNarration.ts'
import {composeDay} from '../server/domain/storyComposition.ts'
import type {Agent,Place,WorldEvent} from '../server/domain/worldTypes.ts'
// No provider adapter is imported. Fail immediately if any code attempts network access.
globalThis.fetch=async()=>{throw Error('Network is prohibited in offline replay')}
const f=JSON.parse(readFileSync('tests/fixtures/repetition-scene.json','utf8'))
const immutable=JSON.stringify(f)
const agents=new Map<string,Agent>(f.agents.map((a:Agent)=>[a.id,a])),places=new Map<string,Place>(f.places.map((p:Place)=>[p.id,p]))
const original=(f.events as WorldEvent[]).filter(e=>f.scene.sourceEventIds.includes(e.id))
// Same preprocessing and prompt function as writeVerifiedNarration in worldStore.ts.
const events=causalStoryOrder(original).map(sceneEvidence).map(e=>e.actionResult?{...e,actionResult:eventProse(e,agents)}:e)
const prompt=buildNarratorPrompt(events,places,agents,'','DAY')
const ids=events.filter(e=>e.detail?.combat).map(e=>e.id),explore=events.find(e=>e.actionType==='EXPLORE')!
const draft={author:'Codex 직접 작성 시안 — 실제 API 출력 아님',paragraphs:[
 {eventIds:ids,text:'김높별과 도영동은 서로를 자신의 안전과 목표를 위협하는 상대로 여기고 있었다. 두 사람 모두 맨손으로 상대의 몸통을 겨누었다.'},
 {eventIds:ids,text:'두 주먹이 각기 상대의 몸통에 닿았다. 도영동과 김높별에게 각각 가벼운 타박상이 남았다. 출혈은 없었지만 통증 때문에 움직임이 불편해졌다. 두 사람이 서로에게 품은 적대감은 충돌 뒤 더 커졌다.'},
 {eventIds:[explore.id],text:'그 뒤 김기업은 고지대에 도착해 탐색을 마쳤다. 새로운 발견은 없었다.'}
]}
assert.equal(storyValidationIssue(draft,events,'DAY'),null)
assert.equal(splitNarrativeScenes(events.filter(e=>e.detail?.combat)),null)
assert.equal(JSON.stringify(f),immutable)
const body=draft.paragraphs.map(p=>p.text).join('\n\n')
const sha=createHash('sha256').update(prompt).digest('hex')
writeFileSync('docs/context-revision-narrator-input.txt',prompt)
writeFileSync('docs/context-revision-replay.json',JSON.stringify({label:draft.author,apiCalls:0,promptSha256:sha,sourceActionIds:events.filter(e=>e.detail?.combat).map(e=>e.actionId),original,projected:events,sceneUnits:narrativeSceneUnits(events).map(({sceneId,eventIds})=>({sceneId,eventIds})),codexDraft:draft,codeValidation:'passed; not an AI review or a general proof of prose truth',engineFallback:composeDay(1,f.scene.seasonId??'fixture',events,places,agents,false)?.body},null,2))
const cell=(s:string)=>s.replaceAll('|','\\|').replaceAll('\n','<br>')
writeFileSync('docs/context-revision-comparison.md',`# 저장된 출력과 Codex 문체 시안\n\nAPI 호출 0회. 오른쪽은 수정된 실제 buildNarratorPrompt와 저장된 동일 사건을 읽고 Codex가 직접 쓴 시안이며, API 출력이나 새 시뮬레이션 기록이 아닙니다. 사건이 3개뿐이므로 새로운 대사·목격자 생각·행동을 넣어 분량을 늘리지 않았습니다.\n\n| 기존 저장 출력 | Codex 직접 작성 시안 — API 출력 아님 |\n|---|---|\n| ${cell(f.scene.body)} | ${cell(body)} |\n\n프롬프트 SHA-256: ${sha}\n\n- 입력: context-revision-narrator-input.txt\n- 원본 사건·서술용 사본·문단별 근거 ID·엔진 기본 본문: context-revision-replay.json\n- 두 공격, 피해 각 1, 몸통 타박상, 출혈 0, 기존 이동 제약 0.3은 보존했습니다. 새 공격·발언·부상은 없습니다. 과거 반격의 인지 근거가 없으므로 순서를 추정하지 않았습니다.\n`)
console.log(JSON.stringify({apiCalls:0,events:events.length,attacks:ids.length,sceneUnits:narrativeSceneUnits(events).length,characters:body.length,validation:'passed',promptSha256:sha}))
