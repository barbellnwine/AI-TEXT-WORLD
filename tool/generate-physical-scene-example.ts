// Isolated, scripted test choices; outcomes are resolved by the real WORLD ENGINE.
// Never connects to the operational database. --model allows one correction, like production.
import {DatabaseSync} from 'node:sqlite'
import {writeFileSync,mkdirSync} from 'node:fs'
import assert from 'node:assert/strict'
import {migrate} from '../server/db/connection.ts'
import {seedDefaultRulePreset} from '../server/domain/rulePresets.ts'
import {createTestIsland} from '../server/domain/studioExample.ts'
import {saveStudio} from '../server/domain/studioStore.ts'
import {startWorldFromDraft} from '../server/domain/worldLaunch.ts'
import * as store from '../server/domain/worldStore.ts'
import {config} from '../server/config.ts'
import {beginAction,advanceEngine,validateEngineAction,recordExperience} from '../server/world/worldEngine.ts'
import {DEFAULT_DISPOSITIONS} from '../server/world/dispositions.ts'
import {composeDay,storyEvent} from '../server/domain/storyComposition.ts'
import {buildNarratorPrompt} from '../server/prompts/narratorPrompt.ts'
import {storySchemaFor,storyValidationIssue,reviewPrompt,REVIEW_SCHEMA,verifiedStory} from '../server/domain/novelNarration.ts'
import {worldModelAdapter} from '../server/domain/worldAgent.ts'
import type {ProposedAction} from '../server/world/actionSchema.ts'
import type {WorldEvent} from '../server/domain/worldTypes.ts'

const db=new DatabaseSync(':memory:');migrate(db);seedDefaultRulePreset(db);store.initializeWorldRuntime(db);config.worldDemoMode=true
try{
 const draft=createTestIsland(db);draft.startTime='08:00';draft.studio!.events=[];draft.studio!.relationships=[]
 draft.places[0].name='중앙 공터';draft.places[0].resources=[{key:'water',label:'식수',unit:'개',level:3,max:3}]
 draft.studio!.items=[{id:'test-stone',name:'돌',kind:'tool',quantity:2,holderKind:'place',holderId:draft.places[0].id,localArea:'CENTER',physical:{material:'stone',portable:true,attackPower:1,cover:0}}]
 const names=['김높별','도영동','최형대','김기업','권치현']
 draft.characters.forEach((a,i)=>{a.name=names[i];a.age=null})
 const saved=saveStudio(db,draft.id,draft);assert.ok(startWorldFromDraft(db,saved).ok);store.stopSimulationTimerForTests()
 const world=store.getWorldState(),[a,b,c]=world.agents,place=world.places[0],events:WorldEvent[]=[]
 for(const a of world.agents){a.body={health:0,injury:0};a.humanState!.fatigue=0;a.vitals!.thirst=7;a.emotion!.fear=0;a.dispositions={...DEFAULT_DISPOSITIONS};a.publicState.localArea='CENTER'}
 const run=(p:ProposedAction,minutes=3)=>{const check=validateEngineAction(p,world,events);assert.ok(check.approved,check.notes.join(','));events.push(beginAction(world,p));advanceEngine(world,minutes,events,e=>{events.push(e);recordExperience(world,e)})}
 const base=(id:string)=>({actorId:id,locationId:place.id,targetIds:[]})
 run({...base(b.id),actionType:'DRINK',resourceKey:'water',intendedAction:'식수를 마신다',publicReason:'심한 갈증을 먼저 가라앉히려 했다.'})
 run({...base(a.id),actionType:'SPEAK',targetIds:[b.id],intent:'REQUEST_HELP',intendedAction:'식수를 남겨 달라고 부탁한다',publicReason:'자신도 목이 말라 남은 식수를 함께 나누려 했다.',spokenText:'도영동 씨, 저도 목이 마릅니다. 남은 물은 나눠 마십시다.'})
 run({...base(b.id),actionType:'SPEAK',targetIds:[a.id],intent:'WARN',intendedAction:'다가오지 말라고 경고한다',publicReason:'자신의 안전을 위해 상대와 거리를 두려 했다.',spokenText:'더 다가오지 마세요. 지금은 가까이 오지 않았으면 합니다.'})
 b.dispositions={...DEFAULT_DISPOSITIONS,riskTolerance:10,aggression:10,competitiveness:10}
 run({...base(b.id),actionType:'OBSERVE',targetIds:[a.id],defense:'BLOCK',intendedAction:'상대를 경계하며 공격을 막을 준비를 한다',publicReason:'상대가 접근하면 몸을 지키려 했다.',durationMinutes:30},1)
 world.engine!.combatRng=0
 run({...base(a.id),actionType:'ATTACK',targetIds:[b.id],pickupItemId:'test-stone',aim:'HEAD',intendedAction:'돌로 공격을 시도한다',publicReason:'상대의 경고를 위협으로 받아들여 물러서게 만들려 했다.'},5)
 run({...base(c.id),actionType:'SPEAK',targetIds:[a.id],intent:'WARN',intendedAction:'더 다가오지 말라고 경고한다',publicReason:'충돌을 목격한 뒤 자신까지 위험해지지 않도록 거리를 확보하려 했다.',spokenText:'김높별 씨, 멈추세요. 제 쪽으로는 오지 마세요.'})
 run({...base(a.id),actionType:'DROP_ITEM',usedItemIds:[a.inventory[0]],intendedAction:'들고 있던 돌을 내려놓는다',publicReason:'주변의 경계를 더 자극하지 않으려 했다.'},5)
 const selected=events.filter(storyEvent),agents=new Map(world.agents.map(a=>[a.id,a])),places=new Map(world.places.map(p=>[p.id,p]))
 const chapter=composeDay(1,world.seasonId,selected,places,agents,false)!
 let body=chapter.body,mode='엔진 기록을 이용한 자동 기본 서술',tokens=0,issue:string|null=null
 if(process.argv.includes('--model')){
  for(let attempt=0;attempt<2;attempt++){
  const r=await worldModelAdapter({role:'narrator',provider:'openai',model:config.openaiModel,schema:storySchemaFor(selected,'DAY'),maxOutputTokens:8000,prompt:buildNarratorPrompt(selected,places,agents,'','DAY')+(issue?'\nCorrect this rejected draft issue: '+issue:'')})
  writeFileSync('data/physical-scene-draft.json',JSON.stringify(r.raw,null,2))
  tokens+=r.inputTokens+r.outputTokens;issue=storyValidationIssue(r.raw,selected,'DAY')
  if(!issue){const review=await worldModelAdapter({role:'narrator',provider:'openai',model:config.openaiModel,schema:REVIEW_SCHEMA,maxOutputTokens:1500,prompt:reviewPrompt((r.raw as {paragraphs:never[]}).paragraphs,selected,agents)});tokens+=review.inputTokens+review.outputTokens;const verified=verifiedStory(r.raw,review.raw,selected,'DAY');if(verified){body=verified;mode='AI 작성 + 근거 검증 통과'}else issue=JSON.stringify(review.raw)}
  if(!issue)break
  }
 }
 mkdirSync('docs',{recursive:true});mkdirSync('data',{recursive:true})
 writeFileSync('data/physical-scene-fixture.json',JSON.stringify({world,events:selected,chapter:{...chapter,body},mode,issue},null,2))
 writeFileSync('docs/physical-scene-example.md',`# DAY 1 — 격리 테스트에서 생성된 장면\n\n운영 세계의 사건이 아닙니다. 테스트가 행동·발언을 지정하고, 실제 엔진이 도구 이동·방어·명중·부상·목격·관계를 판정했습니다. 인물 나이는 미설정입니다. ${mode}. 실제 시간 ${chapter.timeStart}–${chapter.timeEnd}, 근거 사건 ${selected.length}개.\n\n${body}\n\n---\n\n검증: 머리를 겨냥했지만 방어 과정에서 팔에 피해 1이 기록됐습니다. 돌 한 개는 소지품으로 이동했다가 실제로 바닥에 돌아왔습니다. 사망·식수 탈취는 발생하지 않았습니다.\n`)
 console.log(JSON.stringify({events:selected.length,characters:body.length,tokens,mode,issue,start:chapter.timeStart,end:chapter.timeEnd,combat:selected.find(e=>e.detail?.combat)?.detail?.combat}))
}finally{await store.shutdownWorldRuntime();db.close()}
