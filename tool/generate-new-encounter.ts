// Isolated in-memory fixture. Exactly one consequence request; optional writer + reviewer.
import {mkdirSync,writeFileSync} from 'node:fs'
import {traumaFixture} from '../tests/trauma-fixture.ts'
import {combatBatchRequest,combatFingerprint,acceptCombatBatch} from '../server/world/traumaAdjudication.ts'
import {worldModelAdapter} from '../server/domain/worldAgent.ts'
import {config} from '../server/config.ts'
import {beginAction,validateEngineAction} from '../server/world/worldEngine.ts'
import {storyEvent,composeDay} from '../server/domain/storyComposition.ts'
import {buildNarratorPrompt} from '../server/prompts/narratorPrompt.ts'
import {storySchemaFor,storyValidationIssue,reviewPrompt,REVIEW_SCHEMA,verifiedStory} from '../server/domain/novelNarration.ts'

const f=traumaFixture();let tokens=0;const started=Date.now()
try{
 f.a.name='김높별';f.b.name='도영동';f.place.name='중앙 공터'
 const task=f.attack();f.b.dispositions!.riskTolerance=0;f.b.emotion!.fear=8;f.tick(5)
 const fingerprints=[combatFingerprint(f.world,task)]
 const response=await worldModelAdapter(combatBatchRequest(f.world,[task],config.openaiModel));tokens+=response.inputTokens+response.outputTokens
 acceptCombatBatch(f.world,[task],fingerprints,response.raw,config.openaiModel);f.tick(0)
 const afterImpact=structuredClone(f.b),combat=f.events.find(e=>e.detail?.adjudication)!
 f.tick(30);const after30Minutes=structuredClone(f.b)
 if(f.b.trauma?.injuries.some(w=>!w.healed)&&f.b.publicState.status!=='deceased'){
  f.place.resources.push({key:'medicine',label:'의약품',unit:'개',level:1,max:1,trend:'stable'})
  const action={actorId:f.b.id,locationId:f.place.id,targetIds:[],actionType:'USE_ITEM' as const,resourceKey:'medicine',intendedAction:'남아 있는 의약품으로 자신의 상처를 처치한다',publicReason:'출혈과 통증이 이어져 상처를 처치하려 했다.'}
  const validation=validateEngineAction(action,f.world,f.events)
  if(validation.approved){f.events.push(beginAction(f.world,action));f.tick(10);f.tick(30)}
 }
 const afterTreatment=structuredClone(f.b)
 const selected=f.events.filter(storyEvent),agents=new Map(f.world.agents.map(a=>[a.id,a])),places=new Map(f.world.places.map(p=>[p.id,p]))
 const chapter=composeDay(1,f.world.seasonId,selected,places,agents,false)!
 let body=chapter.body,mode='확정 사건 기반 기본 서술',issue:string|null=null
 if(process.argv.includes('--narrator')){
  const draft=await worldModelAdapter({role:'narrator',provider:'openai',model:config.openaiModel,maxOutputTokens:6000,schema:storySchemaFor(selected,'DAY'),prompt:buildNarratorPrompt(selected,places,agents,'','DAY')});tokens+=draft.inputTokens+draft.outputTokens
  issue=storyValidationIssue(draft.raw,selected,'DAY')
  if(!issue){const review=await worldModelAdapter({role:'narrator',provider:'openai',model:config.openaiModel,maxOutputTokens:1800,schema:REVIEW_SCHEMA,prompt:reviewPrompt((draft.raw as {paragraphs:never[]}).paragraphs,selected,agents)});tokens+=review.inputTokens+review.outputTokens;const prose=verifiedStory(draft.raw,review.raw,selected,'DAY');if(prose){body=prose;mode='AI 작성 + 사건 근거 검증 통과'}else issue=JSON.stringify(review.raw)}
 }
 mkdirSync('docs',{recursive:true})
 const evidence={source:'Isolated test, scripted choices. Real API consequence proposal validated by engine. Not operational events.',model:config.openaiModel,calls:1,elapsedMs:Date.now()-started,tokens,proposal:response.raw,combat,afterImpact:afterImpact.trauma,after30Minutes:after30Minutes.trauma,afterTreatment:afterTreatment.trauma,events:selected,chapter:{...chapter,body},mode,issue}
 writeFileSync('docs/repetition-new-events-evidence.json',JSON.stringify(evidence,null,2))
 writeFileSync('docs/repetition-new-events.md',`# 부상 판정 — 격리 테스트\n\n운영 세계의 기록이 아닙니다. 테스트가 공격과 처치 시도를 지정했고, 실제 ${config.openaiModel} API가 결과를 제안한 뒤 엔진이 검증·확정했습니다. 공격 수단은 실제 배치된 돌입니다. ${mode}.\n\n## 실제 생성된 DAY 본문\n\n${body}\n\n## 상태 추적\n\n명중 판정: ${combat.detail?.combat?.outcome}\n\n공격 직후:\n\n\`\`\`json\n${JSON.stringify(afterImpact.trauma??null,null,2)}\n\`\`\`\n\n30분 뒤:\n\n\`\`\`json\n${JSON.stringify(after30Minutes.trauma??null,null,2)}\n\`\`\`\n\n처치 후:\n\n\`\`\`json\n${JSON.stringify(afterTreatment.trauma??null,null,2)}\n\`\`\`\n\nAPI 사용: 총 ${tokens} 토큰. 서술 검증 결과: ${issue??'통과'}. 테스트 설정과 모든 근거 사건은 trauma-example-evidence.json에 있습니다.\n`)
 console.log(JSON.stringify({model:config.openaiModel,calls:1,elapsedMs:Date.now()-started,tokens,outcome:combat.detail?.combat?.outcome,injury:task.adjudication?.proposal.injury,events:selected.length,chapterChars:body.length,mode,issue}))
}finally{await f.close()}
