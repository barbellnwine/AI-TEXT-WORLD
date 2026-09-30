import test from 'node:test'
import assert from 'node:assert/strict'
import {traumaFixture} from './trauma-fixture.ts'
import {productionDay1} from './fixtures/production-day1-regression.ts'
import {ensureAgentV2,rememberIntent} from '../server/world/agentV2State.ts'
import {behaviorRejection} from '../server/world/behaviorPolicy.ts'
import {groundPlannerSteps,GroundingFailure} from '../server/world/plannerGrounding.ts'
import {brainRequest,judgeRequest} from '../server/domain/worldAgent.ts'
import {buildNarratorPrompt} from '../server/prompts/narratorPrompt.ts'
import {storyValidationIssue} from '../server/domain/novelNarration.ts'
import {eventProse} from '../server/domain/eventProse.ts'
import {groupNarrativeScenes} from '../server/domain/sceneEvidence.ts'
import {beginAction,validateEngineAction} from '../server/world/worldEngine.ts'
import type {ProposedAction} from '../server/world/actionSchema.ts'
import type {WorldEvent} from '../server/domain/worldTypes.ts'

test('DAY 1 cooldown evidence: repeat meaning is blocked while a new conversation and changed observations remain possible',async()=>{
 const f=traumaFixture()
 try{
  assert.match(productionDay1.speak[0],/semantic_action_cooldown_6h/)
  const action=(type:ProposedAction['actionType'],purpose:string,targetIds:string[]=[],areaHint?:ProposedAction['areaHint']):ProposedAction=>({
   actorId:f.a.id,locationId:f.place.id,targetIds,actionType:type,intendedAction:purpose,
   intent:type==='SPEAK'?'SOCIAL':type==='OBSERVE'?'KEEP_WATCH':'SEARCH_FOOD',areaHint,
   decisionV3:{transition:'MODIFY',goal:'survive',purpose,method:type,nextSteps:[],expectedReward:5,expectedRisk:2},
  })
  const first=action('SPEAK','협력하자',[f.b.id]);rememberIntent(f.a,first,'talk-1',0)
  f.world.engine!.minute=60
  assert.equal(behaviorRejection(f.world,action('SPEAK','협력하자',[f.b.id])),'semantic_action_cooldown_6h')
  assert.equal(behaviorRejection(f.world,action('SPEAK','그럼 식량을 어떻게 나눌까',[f.b.id])),undefined)
  const followup={...action('SPEAK','협력하자',[f.b.id]),spokenText:'그럼 식량은 어떻게 나눌까?'}
  assert.equal(behaviorRejection(f.world,followup),'semantic_action_cooldown_6h')
  f.world.engine!.interactions ??=[]
  f.world.engine!.interactions.push({id:'reply',actorId:f.b.id,targetId:f.a.id,placeId:f.place.id,area:'CENTER',
   minute:61,expiresMinute:421,intent:'SOCIAL',status:'pending'})
  f.world.engine!.minute=62
  assert.equal(behaviorRejection(f.world,followup),undefined)
  const watch=action('OBSERVE','주변 위협 관찰');rememberIntent(f.a,watch,'watch-1',60)
  assert.equal(behaviorRejection(f.world,action('OBSERVE','주변 위협 관찰')),'semantic_action_cooldown_6h')
  assert.equal(behaviorRejection(f.world,action('OBSERVE','새로 나타난 사람 관찰',[f.b.id])),undefined)
  const search=action('EXPLORE','식량 탐색',[],'CENTER');rememberIntent(f.a,search,'search-1',60)
  assert.equal(behaviorRejection(f.world,action('EXPLORE','식량 탐색',[],'CENTER')),'semantic_action_cooldown_6h')
  assert.equal(behaviorRejection(f.world,action('EXPLORE','식수 탐색',[],'SHORE')),undefined)
 }finally{await f.close()}
})

test('DAY 1 grounding: same-area travel stays spatial; unknown resource is searchable but not acquirable',async()=>{
 const f=traumaFixture()
 try{
  assert.match(productionDay1.sameAreaMove,/not connected to/)
  const base={targetRefs:[],objectRefs:[],intendedAction:'다른 위치로 가서 살핀다'}
  assert.throws(()=>groundPlannerSteps({steps:[{...base,actionType:'MOVE',destinationRef:f.place.name}]},f.a.id,f.world),
   (e:unknown)=>e instanceof GroundingFailure&&e.reason==='move:same_area_without_spatial_destination')
  const local=groundPlannerSteps({steps:[{...base,actionType:'MOVE',destinationRef:f.place.name,areaHint:'SHORE'}]},f.a.id,f.world)
  assert.equal(local[0].actionType,'EXPLORE');assert.equal(local[0].destinationId,undefined)
  f.b.publicState.position={x:.58,y:.58}
  const approach=groundPlannerSteps({steps:[{...base,actionType:'MOVE',targetRefs:[{kind:'character',reference:f.b.name}]}]},f.a.id,f.world)
  assert.equal(approach[0].actionType,'EXPLORE')
  assert.deepEqual(approach[0].searchPoint,{x:.58,y:.58})
  f.world.engine!.objects.push({id:'hidden-water',name:'식수',kind:'water',quantity:1,condition:'intact',
   location:{kind:'place',id:f.place.id},localArea:'SHORE',position:{x:.9,y:.9}})
  const search=groundPlannerSteps({steps:[{...base,actionType:'EXPLORE',areaHint:'SHORE'}]},f.a.id,f.world)[0]
  assert.equal(search.actionType,'EXPLORE')
  assert.throws(()=>groundPlannerSteps({steps:[{...base,actionType:'TAKE_ITEM',objectRefs:[{kind:'object',reference:'hidden-water'}]}]},f.a.id,f.world),
   (e:unknown)=>e instanceof GroundingFailure&&e.reason==='object:not_perceived')
  assert.equal(validateEngineAction(search,f.world,[]).approved,true)
  beginAction(f.world,search);f.tick(90)
  assert.ok(f.world.engine!.objects.some(o=>o.id==='hidden-water'))
  assert.ok(!f.a.inventory.includes('hidden-water'),'search cannot acquire an item automatically')
  const judge=judgeRequest({draft:f.draft,rules:[],mode:'live'},
   {actorId:f.a.id,locationId:f.place.id,actionType:'EXPLORE',targetIds:[],intendedAction:productionDay1.resourceSearch},f.world,[])
  assert.match(judge.prompt,/탐색 시도 자체를 그 이유로 거절하지 않는다/)
 }finally{await f.close()}
})

test('a grounded prerequisite keeps the Brain goal instead of becoming an unrelated intent',async()=>{
 const f=traumaFixture()
 try{
  const destination=f.world.places.find(p=>p.id!==f.place.id)!
  const move:ProposedAction={actorId:f.a.id,locationId:f.place.id,actionType:'MOVE',destinationId:destination.id,
   targetIds:[],intendedAction:'상대를 만나 질문하기 위해 이동한다',intent:'QUESTION',goalKey:'상대의 계획을 알아낸다',
   decisionV3:{transition:'CONTINUE',goal:'상대의 계획을 알아낸다',purpose:'상대를 만나 질문한다',method:'접근 후 질문',nextSteps:['SPEAK'],expectedReward:5,expectedRisk:2}}
  assert.equal(behaviorRejection(f.world,move),undefined)
  assert.equal(behaviorRejection(f.world,{...move,decisionV3:undefined}),'intent_action_mismatch')
 }finally{await f.close()}
})

test('DAY 1 failure evidence reaches the next Brain with a repeated-failure replan signal',async()=>{
 const f=traumaFixture()
 try{
  const v=ensureAgentV2(f.a,f.world)
  v.recentFailures=[0,1].map(minute=>({key:'',actionType:'GROUNDING',intent:'take water',locationId:f.place.id,
   minute,result:'failed' as const,goal:'식수를 확보한다',method:'보이지 않는 식수를 가져간다',
   targetReference:'샘터의 식수',failureStage:'grounding',reason:'object:not_perceived'}))
  const prompt=brainRequest({draft:f.draft,rules:[],mode:'live'},f.a.id,f.world,[]).prompt
  assert.match(prompt,/\[RECENT FAILED ATTEMPTS\]/)
  assert.match(prompt,/object:not_perceived/)
  assert.match(prompt,/"repeatedSameFailure":2/)
  assert.match(prompt,/"reevaluatePlan":true/)
  assert.match(prompt,/샘터의 식수/)
  assert.match(productionDay1.placeFailure,/place:not_perceived/)
  assert.match(productionDay1.mismatch,/intent_action_mismatch/)
 }finally{await f.close()}
})

test('the production Brain/Planner path retains a grounded failure for the next decision without an API call',async()=>{
 let f:ReturnType<typeof traumaFixture>
 const adapter=async(request:{role:string})=>{
  if(request.role==='agent')return {raw:{goal:'식수를 확보한다',purpose:'물을 찾는다',method:'보이지 않는 식수를 가져간다',
   targetId:null,placeId:f.place.id,objectIds:['없는 식수'],desiredOutcome:'식수 확보',longerTermPlan:null},inputTokens:1,outputTokens:1}
  if(request.role==='planner')return {raw:{steps:[{actionType:'TAKE_ITEM',targetRefs:[],objectRefs:[{kind:'object',reference:'없는 식수'}],
   destinationRef:null,intendedAction:'식수를 가져간다'}]},inputTokens:1,outputTokens:1}
  throw Error('the grounded failure must not reach a paid judge')
 }
 f=traumaFixture(adapter)
 try{
  f.a.nextDecisionAt=0
  for(const other of f.world.agents.filter(a=>a.id!==f.a.id))other.nextDecisionAt=100000
  await (await import('../server/domain/worldStore.ts')).runWorldTick()
  const failure=ensureAgentV2(f.a,f.world).recentFailures.at(-1)
  assert.equal(failure?.failureStage,'grounding')
  assert.equal(failure?.goal,'식수를 확보한다')
  assert.equal(failure?.targetReference,'없는 식수')
  assert.match(brainRequest({draft:f.draft,rules:[],mode:'live'},f.a.id,f.world,[]).prompt,/없는 식수/)
 }finally{await f.close()}
})

test('DAY 1 narrative evidence keeps movement origin and rejects leaked internal wording',()=>{
 assert.match(productionDay1.movement,/뇌의 의도/)
 const move:WorldEvent={id:'move-day1',occurredAt:'2026-09-30T02:20:00.000Z',day:1,worldTime:'02:20',worldMinute:140,
  type:'MOVE',phase:'COMPLETED',actionType:'MOVE',placeId:'beach',agentIds:['yoon'],title:'윤재호 이동',
  summary:'윤재호가 동쪽 해변에 도착했다.',actionResult:productionDay1.movement,
  stateChanges:[{field:'agent:yoon:location',from:'forest',to:'beach'}],importance:'normal',relatedEventIds:[],outcome:'CONFIRMED'}
 const names=new Map([['yoon',{name:'윤재호'}]])
 const places=new Map([['forest',{name:'깊은 숲'}],['beach',{name:'동쪽 해변'}]])
 const prompt=buildNarratorPrompt([move],places as never,names as never)
 assert.match(prompt,/"fromPlaceId":"forest"/)
 assert.match(prompt,/"toPlaceId":"beach"/)
 assert.match(prompt,/"forest":"깊은 숲"/)
 assert.match(prompt,/"beach":"동쪽 해변"/)
 assert.equal(storyValidationIssue({paragraphs:[{text:productionDay1.movement,eventIds:[move.id]}]},[move]),'Reader prose contains internal simulation terminology.')
 assert.doesNotMatch(eventProse(move,names),/뇌의 의도/)
 assert.match(productionDay1.dialogue.join(' '),/한서진.*이준석|강민혁.*윤재호/)
 assert.match(productionDay1.simultaneous,/샘터/)
 assert.match(productionDay1.repeatedSearch,/탐색/)
  const talkA:WorldEvent={...move,id:'talk-a',worldMinute:300,worldTime:'05:00',type:'DIALOGUE',actionType:'SPEAK',
   agentIds:['han','lee'],placeId:'beach',summary:productionDay1.dialogue[0],actionResult:productionDay1.dialogue[0],
   publicQuote:productionDay1.quotes[0],stateChanges:[]}
  const talkB:WorldEvent={...talkA,id:'talk-b',worldMinute:301,worldTime:'05:01',agentIds:['lee','han'],
   summary:productionDay1.dialogue[1],actionResult:productionDay1.dialogue[1],publicQuote:productionDay1.quotes[1],relatedEventIds:['talk-a']}
  const remote:WorldEvent={...talkA,id:'remote',placeId:'spring',agentIds:['park'],summary:productionDay1.simultaneous,
   actionResult:productionDay1.simultaneous}
  const scenes=groupNarrativeScenes([talkA,remote,talkB])
  assert.ok(scenes.some(group=>group.some(e=>e.id==='talk-a')&&group.some(e=>e.id==='talk-b')))
  assert.ok(scenes.every(group=>!(group.some(e=>e.id==='remote')&&group.some(e=>e.id==='talk-a'))))
  const dialoguePrompt=buildNarratorPrompt([talkA,remote,talkB],new Map([...places,['spring',{name:'샘터'}]]) as never,
   new Map([...names,['han',{name:'한서진'}],['lee',{name:'이준석'}],['park',{name:'박태건'}]]) as never)
  assert.match(dialoguePrompt,/"eventIds":\["talk-a","talk-b"\]/)
  assert.ok(dialoguePrompt.includes(productionDay1.quotes[0]))
  assert.ok(dialoguePrompt.includes(productionDay1.quotes[1]))
  assert.match(dialoguePrompt,/Brief interpretive thoughts/)
})
