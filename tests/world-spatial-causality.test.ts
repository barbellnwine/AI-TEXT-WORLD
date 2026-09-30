import {test} from 'node:test'
import assert from 'node:assert/strict'
import {traumaFixture} from './trauma-fixture.ts'
import {beginAction,validateEngineAction} from '../server/world/worldEngine.ts'
import {buildAgentKnowledgeView} from '../server/world/knowledgeFilter.ts'
import {decisionPerception} from '../server/world/decisionPerception.ts'
import {informationUtility,isWorldInformation} from '../server/world/informationUtility.ts'
import {ensureAgentV2} from '../server/world/agentV2State.ts'
import {canHear,canSee} from '../server/world/spatialWorld.ts'
import {inContact} from '../server/world/interactions.ts'
import {storyValidationIssue} from '../server/domain/novelNarration.ts'
import {deliberation} from '../server/world/motivations.ts'
import type {WorldEvent} from '../server/domain/worldTypes.ts'

test('distance separates contact, sight and hearing without disclosing a remote person',async()=>{
 const f=traumaFixture();try{
  f.a.publicState.position={x:.1,y:.5};f.b.publicState.position={x:.5,y:.5}
  assert.equal(inContact(f.world,f.a.id,f.b.id),false)
  assert.equal(canSee(f.world,f.a.id,f.b.id),false)
  assert.equal(canHear(f.world,f.a.id,f.b.id),true)
  assert.equal(buildAgentKnowledgeView(f.a.id,f.world,[])!.othersPresent.length,0)
  const start=beginAction(f.world,{actorId:f.b.id,actionType:'EXPLORE',targetIds:[],locationId:f.place.id,areaHint:'CENTER',searchPoint:{x:.5,y:.5},intendedAction:'주변을 탐색'});f.events.push(start);f.tick(30)
  const completed=f.events.find(e=>e.actionId===start.actionId&&e.phase==='COMPLETED')!
  assert.equal(completed.perceptions?.find(p=>p.agentId===f.a.id)?.sense,'hearing')
  const heard=buildAgentKnowledgeView(f.a.id,f.world,f.events)!.observedEvents.find(e=>e.id===completed.id)!
  assert.deepEqual(heard.agentIds,[])
  assert.equal(heard.publicQuote,undefined)
 }finally{await f.close()}
})

test('a visible person beyond contact creates an approach candidate, not remote speech',async()=>{
 const f=traumaFixture();try{
  f.a.publicState.position={x:.4,y:.5};f.b.publicState.position={x:.6,y:.5}
  assert.equal(canSee(f.world,f.a.id,f.b.id),true)
  assert.equal(inContact(f.world,f.a.id,f.b.id),false)
  const view=buildAgentKnowledgeView(f.a.id,f.world,[])!
  assert.equal(view.othersPresent.find(a=>a.id===f.b.id)?.canContact,false)
  const choices=deliberation(f.world,f.a.id,[]).choices
  assert.ok(choices.some(c=>c.goal==='APPROACH_CONTACT'&&c.action.actionType==='EXPLORE'&&c.action.searchPoint?.x===.6))
  assert.equal(choices.some(c=>c.action.actionType==='SPEAK'&&c.action.targetIds.includes(f.b.id)),false)
 }finally{await f.close()}
})

test('exploration reveals only objects and truths on its actual path and records failed search',async()=>{
 const f=traumaFixture();try{
  f.world.engine!.objects=[{id:'far-tool',name:'먼 도구',kind:'tool',quantity:1,condition:'intact',location:{kind:'place',id:f.place.id},localArea:'CENTER',position:{x:.9,y:.9}}]
  f.world.engine!.truths=[{id:'far-fact',summary:'먼 장소의 사실',placeId:f.place.id,localArea:'CENTER',position:{x:.9,y:.9},discoveredBy:[]}]
  const first=beginAction(f.world,{actorId:f.a.id,actionType:'EXPLORE',targetIds:[],locationId:f.place.id,areaHint:'CENTER',searchPoint:{x:.1,y:.1},intendedAction:'가까운 곳을 탐색'});f.events.push(first);f.tick(30)
  assert.equal(f.world.engine!.truths[0].discoveredBy.includes(f.a.id),false)
  assert.equal(f.a.observedObjects?.some(o=>o.id==='far-tool')??false,false)
  assert.equal(f.a.v2?.plan?.failures,1)
  assert.equal(f.a.v2?.plan?.nextStep,'다른 좌표 또는 다른 획득 방법 평가')
  const second=beginAction(f.world,{actorId:f.a.id,actionType:'EXPLORE',targetIds:[],locationId:f.place.id,areaHint:'CENTER',searchPoint:{x:.9,y:.9},intendedAction:'먼 곳을 탐색'});f.events.push(second);f.tick(30)
  assert.equal(f.world.engine!.truths[0].discoveredBy.includes(f.a.id),true)
  assert.ok(f.a.observedObjects?.some(o=>o.id==='far-tool'))
  assert.equal(f.a.publicState.position?.x,.9)
  const take={actorId:f.a.id,actionType:'TAKE_ITEM' as const,targetIds:[],locationId:f.place.id,usedItemIds:['far-tool'],intendedAction:'발견한 도구를 챙긴다'}
  assert.equal(validateEngineAction(take,f.world,f.events).approved,true)
  const pickup=beginAction(f.world,take);f.events.push(pickup);f.tick(8)
  assert.equal(f.world.engine!.objects.find(o=>o.id==='far-tool')?.location.id,f.a.id)
  assert.ok(f.a.inventory.includes('far-tool'))
 }finally{await f.close()}
})

test('world information loses utility after delivery; self-state is a separate speech category',async()=>{
 const f=traumaFixture();try{
  const fact={id:'location-fact',summary:'동쪽에 물이 있다',placeId:f.place.id,verified:true,learnedAt:new Date().toISOString()}
  const self={id:'self-fact',summary:'나의 피로가 심하다',placeId:f.place.id,verified:true,learnedAt:new Date().toISOString()}
  f.a.knowledge.push(fact,self)
  assert.equal(isWorldInformation(f.a,self),false)
  assert.ok(informationUtility(f.world,f.a,f.b.id,fact)>0)
  ensureAgentV2(f.a,f.world).recentActions.push({key:'',actionType:'SHARE_INFO',intent:'SOCIAL',targetId:f.b.id,locationId:f.place.id,minute:f.world.engine!.minute,factId:fact.id,result:'completed'})
  assert.ok(informationUtility(f.world,f.a,f.b.id,fact)<0)
 }finally{await f.close()}
})

test('self-state disclosure records an uncertain report without becoming a world fact',async()=>{
 const f=traumaFixture();try{
  f.a.vitals!.hunger=8
  const action={actorId:f.a.id,actionType:'SPEAK' as const,intent:'SELF_STATE_DISCLOSURE' as const,targetIds:[f.b.id],locationId:f.place.id,intendedAction:'허기를 알린다',spokenText:'허기가 심해.'}
  const start=beginAction(f.world,action);f.events.push(start);f.tick(4)
  const report=f.b.knowledge.find(k=>k.kind==='self_state'&&k.sourceAgentId===f.a.id)!
  assert.ok(report?.sourceEventId)
  assert.equal(report.verified,false)
  assert.equal(isWorldInformation(f.b,report),false)
 }finally{await f.close()}
})

test('narrative refuses invented causality and unsupported visual witness claims',()=>{
 const make=(id:string):WorldEvent=>({id,type:'DIALOGUE',occurredAt:new Date().toISOString(),day:1,worldMinute:id==='one'?1:2,worldTime:'00:01',placeId:'p',agentIds:['a','b'],title:id,summary:id,stateChanges:[],importance:'normal',relatedEventIds:[],phase:'COMPLETED',outcome:'CONFIRMED',perceptions:[{agentId:'a',sense:'participant',area:'CENTER',position:{x:.1,y:.1}},{agentId:'c',sense:'hearing',area:'CENTER',position:{x:.5,y:.1}}]})
 const one=make('one'),two=make('two')
 assert.match(storyValidationIssue({paragraphs:[{text:'한 사람이 제안했다. 이에 다른 사람이 공격했다.',eventIds:['one','two']}]},[one,two])??'',/causal transition/)
 assert.match(storyValidationIssue({paragraphs:[{text:'그는 눈앞에서 충돌을 목격했다.',eventIds:['one']}]},[one])??'',/visual witness/)
 two.relatedEventIds=['one']
 assert.equal(storyValidationIssue({paragraphs:[{text:'한 사람이 제안했다. 이에 다른 사람이 대답했다.',eventIds:['one','two']}]},[one,two]),null)
})

test('objective projection exposes elapsed time, remaining time and competitor gap',async()=>{
 const f=traumaFixture();try{
  f.world.engine!.studio!.config.endings=[{id:'clock',type:'day',value:2,ref:''},{id:'winner',type:'survivors',value:1,ref:''}]
  f.world.engine!.minute=1440
  const objective=decisionPerception(f.world,f.a.id,f.events).engine!.objectiveStatus!
  assert.equal(objective.elapsedMinute,1440)
  assert.equal(objective.remainingMinutes,1440)
  assert.equal(objective.remainingCompetitors,f.world.agents.length)
  assert.ok(objective.targets.some(t=>t.type==='survivors'&&t.gap===f.world.agents.length-1))
 }finally{await f.close()}
})
