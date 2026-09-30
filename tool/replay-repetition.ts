import {readFileSync,writeFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import assert from 'node:assert/strict'
import {worldModelAdapter,worldRequestBody} from '../server/domain/worldAgent.ts'
import {config} from '../server/config.ts'
import {sceneEvidence,collisionGroups} from '../server/domain/sceneEvidence.ts'
import {buildNarratorPrompt} from '../server/prompts/narratorPrompt.ts'
import {storySchemaFor,storyValidationIssue,reviewPrompt,REVIEW_SCHEMA,verifiedStory} from '../server/domain/novelNarration.ts'
import {initializeModelTrace,traceModel,traceOutcome,listModelTraces} from '../server/domain/modelTrace.ts'
import {mockNarrator} from '../server/domain/narrator.ts'
import type {WorldEvent,Agent,Place} from '../server/domain/worldTypes.ts'

const fixture=JSON.parse(readFileSync('tests/fixtures/repetition-scene.json','utf8'))
const original=fixture.events.filter((e:WorldEvent)=>fixture.scene.sourceEventIds.includes(e.id)) as WorldEvent[]
const events=original.map(sceneEvidence).sort((a,b)=>(a.worldMinute??0)-(b.worldMinute??0))
const agents=new Map<string,Agent>(fixture.agents.map((a:Agent)=>[a.id,a])),places=new Map<string,Place>(fixture.places.map((p:Place)=>[p.id,p]))
const immutable=JSON.stringify(original),db=new DatabaseSync(':memory:');initializeModelTrace(db)
process.env.AI_WORLD_CAPTURE_TRACE='true'
const prompt=buildNarratorPrompt(events,places,agents,'','DAY'),attempts:unknown[]=[]
let body=mockNarrator.narrateFallbackScene(events,places,agents).body,issue:string|null=null,mode='확정 사건 기반 기본 서술',calls=0,tokens=0
const start=Date.now()
try{
 if(process.argv.includes('--model'))for(let attempt=0;attempt<2;attempt++){
  const request={role:'narrator' as const,provider:'openai',model:config.openaiModel,schema:storySchemaFor(events,'DAY'),maxOutputTokens:6000,prompt:prompt+(issue?'\nCorrect ONLY these rejected claims: '+issue:'')}
  const draft=await traceModel(request,()=>worldModelAdapter(request),Buffer.byteLength(worldRequestBody(request)));calls++;tokens+=draft.inputTokens+draft.outputTokens
  attempts.push({request,response:draft.raw});issue=storyValidationIssue(draft.raw,events,'DAY')
  if(!issue){const review={role:'narrator' as const,provider:'openai',model:config.openaiModel,schema:REVIEW_SCHEMA,maxOutputTokens:1400,prompt:reviewPrompt((draft.raw as {paragraphs:never[]}).paragraphs,events,agents)}
   const checked=await traceModel(review,()=>worldModelAdapter(review),Buffer.byteLength(worldRequestBody(review)));calls++;tokens+=checked.inputTokens+checked.outputTokens
   const prose=verifiedStory(draft.raw,checked.raw,events,'DAY');attempts.push({review:checked.raw})
   if(prose){body=prose;mode='AI 생성·코드 사실 검사·근거 검토 통과';traceOutcome(request,body,false);break}
   issue=JSON.stringify(checked.raw)
  }
  traceOutcome(request,body,true)
 }
 assert.equal(JSON.stringify(original),immutable)
 const evidence={case:'A: replay only, no simulation state changes or new attacks',sourceActionIds:events.filter(e=>e.detail?.combat).map(e=>e.actionId),before:{storedBody:fixture.scene.body,events:original,requestUnavailable:true},after:{events,groups:collisionGroups(events),prompt,body,mode,issue},calls,tokens,elapsedMs:Date.now()-start,traces:listModelTraces(),attempts}
 writeFileSync('docs/repetition-replay-evidence.json',JSON.stringify(evidence,null,2))
 writeFileSync('docs/repetition-replay.md',`# A. 기존 확정 사건 재생\n\n운영 세계를 진행시키지 않았습니다. 원본 공격 두 건·피해 각 1·타박상·기존 이동 제약 0.3을 보존했습니다. 과거에 기록하지 않은 대응 인지는 추정하지 않았습니다.\n\n## 수정 전 저장 본문\n\n${fixture.scene.body}\n\n## 수정 후 실제 생성 본문\n\n${body}\n\n${mode}. 호출 ${calls}회, ${tokens}토큰, ${Date.now()-start}ms. ${issue?'마지막 거부 사유: '+issue:''}\n\n입력·원본 응답·최종 출력: repetition-replay-evidence.json. 과거 API 원문은 없으므로 수정 전 입력은 저장된 사건이며 당시 요청이라고 주장하지 않습니다.\n`)
 console.log(JSON.stringify({calls,tokens,elapsedMs:Date.now()-start,characters:body.length,mode,issue}))
}finally{db.close()}
