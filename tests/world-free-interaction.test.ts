import test from 'node:test'
import assert from 'node:assert/strict'
import { traumaFixture } from './trauma-fixture.ts'
import { beginAction, selectDecisionAgents, validateEngineAction } from '../server/world/worldEngine.ts'
import { buildAgentKnowledgeView } from '../server/world/knowledgeFilter.ts'
import { brainRequest, parseBrainIntent, parsePlannerSteps, plannerRequest, worldRequestBody } from '../server/domain/worldAgent.ts'
import * as store from '../server/domain/worldStore.ts'
import type { ProposedAction } from '../server/world/actionSchema.ts'
import type { WorldObject } from '../server/world/engineTypes.ts'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../server/db/connection.ts'
import { seedDefaultRulePreset } from '../server/domain/rulePresets.ts'
import { createTestIsland } from '../server/domain/studioExample.ts'
import { saveStudio } from '../server/domain/studioStore.ts'
import { startWorldFromDraft } from '../server/domain/worldLaunch.ts'
import { config } from '../server/config.ts'
import { groundPlannerSteps, GroundingFailure } from '../server/world/plannerGrounding.ts'

const object=(id:string,material:string,placeId:string,quantity=1):WorldObject=>({id,name:id,kind:'item',quantity,condition:'intact',location:{kind:'place',id:placeId},localArea:'CENTER',position:{x:.5,y:.5},physical:{material,portable:true,attackPower:0,cover:0}})
function work(actorId:string,placeId:string,operation:'alter'|'separate'|'combine',ids:string[],materials:string[],quantity:number):ProposedAction{
 return {actorId,locationId:placeId,targetIds:[],usedItemIds:[],actionType:'INTERACT',intendedAction:'existing materials change',interaction:{operation,sourceObjectIds:ids,resultName:'derived form',resultForm:'reshaped',materials,quantity}}
}

test('Brain has no candidate selection; Planner preserves a free intent and emits staged primitives',async()=>{
 const f=traumaFixture()
 try{
  const execution={draft:f.draft,rules:[],mode:'live' as const}
  const brain=brainRequest(execution,f.a.id,f.world,[])
  assert.equal(brain.role,'agent')
  assert.ok(!brain.prompt.includes('Choose exactly one listed candidateId'))
  assert.ok(!Object.hasOwn(brain.schema,'candidateId'))
  const intent=parseBrainIntent({goal:'make use of materials',purpose:'prepare shelter',method:'change existing objects',targetId:null,placeId:f.place.id,objectIds:['rock'],desiredOutcome:'usable material',longerTermPlan:'use it later'})
  const planner=plannerRequest(execution,f.a.id,f.world,[],intent)
  assert.equal(planner.role,'planner')
  assert.ok(!planner.prompt.includes('Choose exactly one listed candidateId'))
  assert.ok(!Object.hasOwn(((planner.schema as {properties:{steps:{items:{properties:object}}}}).properties.steps.items.properties),'candidateId'))
  assert.ok(worldRequestBody(brain).length>0&&worldRequestBody(planner).length>0)
  const steps=parsePlannerSteps({steps:[{actorId:f.a.id,locationId:f.place.id,targetIds:[],actionType:'TAKE_ITEM',usedItemIds:['rock'],intendedAction:'take material'},
   {...work(f.a.id,f.place.id,'alter',['rock'],['stone'],1),usedItemIds:[]}]},f.a.id)
  assert.deepEqual(steps.map(s=>s.actionType),['TAKE_ITEM','INTERACT'])
 }finally{await f.close()}
})

test('separation conserves matter and rejects missing sources or invented material',async()=>{
 const f=traumaFixture()
 try{
  f.world.engine!.objects.push(object('cloth','fabric',f.place.id,2))
  const action=work(f.a.id,f.place.id,'separate',['cloth'],['fabric'],2)
  assert.equal(validateEngineAction(action,f.world,[]).approved,true)
  assert.equal(validateEngineAction({...action,interaction:{...action.interaction!,materials:['steel']}},f.world,[]).notes[0],'invalid_material_conversion')
  assert.equal(validateEngineAction(work(f.a.id,f.place.id,'alter',['missing'],['fabric'],1),f.world,[]).notes[0],'source_unavailable')
  f.events.push(beginAction(f.world,action));f.tick(30)
  assert.equal(f.world.engine!.objects.find(o=>o.id==='cloth')!.quantity,1)
  const derived=f.world.engine!.objects.filter(o=>o.provenance?.sourceObjectIds.includes('cloth'))
  assert.equal(derived.length,2)
  assert.equal(derived.reduce((n,o)=>n+(o.mass??0),0),1)
  assert.ok(derived.every(o=>o.materials?.[0]==='fabric'&&o.provenance?.transformation==='separate'))
  assert.equal(validateEngineAction(action,f.world,[]).approved,false,'source is no longer available at its former location')
 }finally{await f.close()}
})

test('combination requires all present components and derived place objects are shared',async()=>{
 const f=traumaFixture()
 try{
  const a=object('source-a','wood',f.place.id),b=object('source-b','stone',f.place.id)
  a.physical!.portable=false;b.physical!.portable=false
  f.world.engine!.objects.push(a,b)
  const action=work(f.a.id,f.place.id,'combine',[a.id,b.id],['wood','stone'],1)
  assert.equal(validateEngineAction(action,f.world,[]).approved,true)
  f.events.push(beginAction(f.world,action))
  assert.equal(validateEngineAction(work(f.b.id,f.place.id,'alter',[a.id],['wood'],1),f.world,[]).notes[0],'source_reserved')
  f.tick(30)
  assert.equal(a.quantity,0);assert.equal(b.quantity,0)
  const result=f.world.engine!.objects.find(o=>o.provenance?.transformation==='combine')!
  assert.deepEqual(result.provenance?.sourceObjectIds,[a.id,b.id])
  assert.deepEqual(result.materials,['wood','stone'])
  assert.equal(result.location.kind,'place')
  assert.ok(buildAgentKnowledgeView(f.b.id,f.world,f.events)?.visibleObjects?.some(o=>o.id===result.id))
 }finally{await f.close()}
})

test('live decision uses one Brain and one Planner call before the existing judge and engine',async()=>{
 const roles:string[]=[]
 let f:ReturnType<typeof traumaFixture>
 const adapter=async(request:{role:string})=>{
  roles.push(request.role)
  if(request.role==='agent')return {raw:{goal:'reshape known material',purpose:'prepare equipment',method:'alter a real local object',targetId:null,placeId:f.place.id,objectIds:['work-source'],desiredOutcome:'changed form',longerTermPlan:'use later'},inputTokens:1,outputTokens:1}
  if(request.role==='planner')return {raw:{steps:[work(f.a.id,f.place.id,'alter',['work-source'],['fabric'],1)]},inputTokens:1,outputTokens:1}
  return {raw:{approved:true,reason:'valid',ended:false},inputTokens:1,outputTokens:1}
 }
 f=traumaFixture(adapter)
 try{
  f.world.engine!.objects.push(object('work-source','fabric',f.place.id))
  f.a.nextDecisionAt=0
  for(const other of f.world.agents.filter(a=>a.id!==f.a.id))other.nextDecisionAt=100000
  await store.runWorldTick()
  assert.deepEqual(roles.slice(0,3),['agent','planner','judge'])
  assert.equal(f.world.engine!.ongoingActions.find(t=>t.proposal.actorId===f.a.id)?.proposal.interaction?.operation,'alter')
  assert.equal(f.world.agents.find(a=>a.id===f.a.id)?.v2?.freePlan?.brain.goal,'reshape known material')
 }finally{await f.close()}
})

test('environment material is fixed at new WORLD launch and shared in the object store',async()=>{
 const db=new DatabaseSync(':memory:')
 try{
  migrate(db);seedDefaultRulePreset(db);store.initializeWorldRuntime(db,undefined,false);config.worldDemoMode=true
  const draft=createTestIsland(db)
  draft.places[0].type='자연';draft.places[0].description='숲과 나무가 있는 장소'
  draft.studio!.items=[]
  const saved=saveStudio(db,draft.id,draft)
  assert.equal(startWorldFromDraft(db,saved).ok,true)
  store.stopSimulationTimerForTests()
  const world=store.getWorldState()
  const source=world.engine!.objects.find(o=>o.id===`environment-${draft.places[0].id}-wood`)
  assert.ok(source)
  assert.equal(source.physical?.material,'wood')
  assert.equal(source.location.id,draft.places[0].id)
  assert.equal(world.engine!.objects.filter(o=>o.id===source.id).length,1)
 }finally{await store.shutdownWorldRuntime();db.close()}
})

test('only the first planned step runs; the next Brain sees the changed world and retained plan',async()=>{
 let f:ReturnType<typeof traumaFixture>
 const adapter=async(request:{role:string})=>{
  if(request.role==='agent')return {raw:{goal:'reshape existing material',purpose:'prepare',method:'take then alter',targetId:null,placeId:f.place.id,objectIds:['stage-source'],desiredOutcome:'new form',longerTermPlan:'continue after pickup'},inputTokens:1,outputTokens:1}
  if(request.role==='planner')return {raw:{steps:[{actorId:f.a.id,locationId:f.place.id,targetIds:[],usedItemIds:['stage-source'],actionType:'TAKE_ITEM',intendedAction:'take source'},work(f.a.id,f.place.id,'alter',['stage-source'],['fabric'],1)]},inputTokens:1,outputTokens:1}
  return {raw:{approved:true,reason:'valid',ended:false},inputTokens:1,outputTokens:1}
 }
 f=traumaFixture(adapter)
 try{
  f.world.engine!.objects.push(object('stage-source','fabric',f.place.id))
  f.a.nextDecisionAt=0
  for(const other of f.world.agents.filter(a=>a.id!==f.a.id))other.nextDecisionAt=100000
  await store.runWorldTick()
  assert.equal(f.world.engine!.ongoingActions.find(t=>t.proposal.actorId===f.a.id)?.proposal.actionType,'TAKE_ITEM')
  assert.equal(f.a.v2?.freePlan?.steps.length,2)
  assert.equal(f.world.engine!.objects.filter(o=>o.provenance?.sourceObjectIds.includes('stage-source')).length,0)
  f.tick(5)
  assert.ok(f.a.inventory.includes('stage-source'))
  const next=brainRequest({draft:f.draft,rules:[],mode:'live'},f.a.id,f.world,f.events)
  assert.ok(next.prompt.includes('reshape existing material'))
  assert.ok(next.prompt.includes('stage-source'))
 }finally{await f.close()}
})

test('five Brain/Planner decisions reach engine accounting without candidate binding loss',async()=>{
 const calls:{role:string;actorId:string}[]=[]
 const planned=['WAIT','REST','OBSERVE','EXPLORE','MOVE'] as const
 const cursor:{[role:string]:number}={agent:0,planner:0,judge:0}
 let actorOrder:string[]=[]
 let f:ReturnType<typeof traumaFixture>
 const adapter=async(request:{role:string})=>{
  const actorId=actorOrder[cursor[request.role]++]
  assert.ok(actorId,`actor ID missing in ${request.role} request`)
  calls.push({role:request.role,actorId})
  const index=f.world.agents.findIndex(a=>a.id===actorId)
  assert.ok(index>=0)
  if(request.role==='agent')return {raw:{goal:`individual goal ${index}`,purpose:'act in the present world',method:`method ${index}`,targetId:null,placeId:f.place.id,objectIds:[],desiredOutcome:'observable action',longerTermPlan:null},inputTokens:1,outputTokens:1}
  if(request.role==='planner')return {raw:{steps:[{actorId,locationId:f.place.id,targetIds:[],usedItemIds:[],actionType:planned[index],intendedAction:`individual action ${index}`,
   ...(planned[index]==='MOVE'?{destinationId:f.world.places.find(p=>p.id!==f.place.id&&f.place.connectedPlaceIds.includes(p.id))!.id}:{}),
   ...(planned[index]==='EXPLORE'?{areaHint:'FOREST'}:{})}]},inputTokens:1,outputTokens:1}
  return {raw:{approved:index!==4,reason:index===4?'fixture rejection':'valid',ended:false},inputTokens:1,outputTokens:1}
 }
 f=traumaFixture(adapter)
 try{
  store.setMaxActiveAgents(5)
  for(const actor of f.world.agents)actor.nextDecisionAt=0
  actorOrder=selectDecisionAgents(f.world,5).map(a=>a.id)
  await store.runWorldTick()
  const audit=store.listActionAudit().filter(e=>f.world.agents.some(a=>a.id===e.agentIds[0]))
  assert.equal(calls.filter(c=>c.role==='agent').length,5)
  assert.equal(calls.filter(c=>c.role==='planner').length,5)
  assert.equal(audit.length,5,'every completed Brain/Planner pair needs an accepted or rejected action')
  assert.equal(audit.filter(e=>e.outcome==='REJECTED').length,1)
  assert.equal(audit.filter(e=>e.outcome!=='REJECTED').length,4)
  assert.equal(calls.filter(c=>c.role==='judge').length,5)
  assert.ok(audit.every(e=>!e.engineVerdict?.includes('candidate_not_available')))
  assert.equal(store.getAdminRuntime().callsUsed,15,'10 decision calls and 5 result judgments must be accounted for')
 }finally{await f.close()}
})

test('real incident references bind semantically before validation, with engine timing and prerequisites',async()=>{
 const f=traumaFixture()
 try{
  const food=object('real-food','organic',f.place.id);food.name='식량';food.kind='food'
  const hidden=object('test-dagger-camp','metal',f.world.places[1].id);hidden.name='단검'
  const fixed=object('environment-boulder','stone',f.place.id);fixed.physical!.portable=false
  f.world.engine!.objects.push(food,hidden,fixed)
  const step=(actionType:string,extra:Record<string,unknown>={})=>({steps:[{actionType,intendedAction:'world-grounded action',...extra}]})
  const foodByKind=groundPlannerSteps(step('TAKE_ITEM',{targetIds:['food'],pickupItemId:null}),f.a.id,f.world)[0]
  const foodByName=groundPlannerSteps(step('TAKE_ITEM',{targetRefs:[{kind:'object',reference:'식량'}]}),f.a.id,f.world)[0]
  assert.deepEqual(foodByKind.usedItemIds,['real-food']);assert.deepEqual(foodByName.usedItemIds,['real-food'])
  assert.deepEqual(foodByKind.targetIds,[])
  assert.equal(validateEngineAction(foodByKind,f.world,[]).approved,true)
  assert.throws(()=>groundPlannerSteps(step('TAKE_ITEM',{targetIds:['test-dagger-camp']}),f.a.id,f.world),
   (e:unknown)=>e instanceof GroundingFailure&&e.reason==='object:not_perceived')
  const destination=f.world.places.find(p=>p.id!==f.place.id&&f.place.connectedPlaceIds.includes(p.id))!
  destination.name='샘터'
  f.world.engine!.connections.find(c=>c.fromPlaceId===f.place.id&&c.toPlaceId===destination.id||c.toPlaceId===f.place.id&&c.fromPlaceId===destination.id)!.travelMinutes=18
  const move=groundPlannerSteps(step('MOVE',{destinationRef:'샘터',durationMinutes:10}),f.a.id,f.world)[0]
  assert.equal(move.destinationId,destination.id);assert.equal(move.durationMinutes,undefined)
  assert.equal(validateEngineAction(move,f.world,[]).approved,true)
  beginAction(f.world,move)
  assert.equal(f.world.engine!.ongoingActions.find(t=>t.proposal.actorId===f.a.id)!.completesMinute-f.world.engine!.minute,18)
  const observation=groundPlannerSteps(step('OBSERVE',{areaHint:'FOREST'}),f.b.id,f.world)
  assert.deepEqual(observation.map(a=>a.actionType),['EXPLORE','OBSERVE'])
  assert.equal(validateEngineAction(observation[0],f.world,[]).approved,true)
  const oldPickup=groundPlannerSteps(step('TAKE_ITEM',{pickupItemId:'real-food'}),f.b.id,f.world)[0]
  assert.deepEqual(oldPickup.usedItemIds,['real-food']);assert.equal(oldPickup.pickupItemId,undefined)
  assert.equal(validateEngineAction(oldPickup,f.world,[]).approved,true)
  const stationary=groundPlannerSteps(step('TAKE_ITEM',{objectRefs:[{kind:'object',reference:'environment-boulder'}]}),f.b.id,f.world)[0]
  assert.equal(validateEngineAction(stationary,f.world,[]).notes[0],'object_not_available_here')
  const transform=groundPlannerSteps(step('INTERACT',{objectRefs:[{kind:'object',reference:'식량'}],interaction:{operation:'alter',sourceObjectIds:['식량'],resultName:'changed food',resultForm:'piece',materials:['organic'],quantity:1}}),f.b.id,f.world)[0]
  assert.deepEqual(transform.interaction?.sourceObjectIds,['real-food'])
  assert.deepEqual(transform.usedItemIds,[])
  assert.equal(validateEngineAction(transform,f.world,[]).approved,true)
 }finally{await f.close()}
})

test('five semantic decisions expose every survival stage and avoid judging grounded failures',async()=>{
 const calls:{role:string;actorId:string}[]=[]
 const cursor:{[role:string]:number}={agent:0,planner:0,judge:0}
 let actorOrder:string[]=[]
 let f:ReturnType<typeof traumaFixture>
 const adapter=async(request:{role:string})=>{
  const actorId=actorOrder[cursor[request.role]++]
  calls.push({role:request.role,actorId})
  if(request.role==='agent')return {raw:{goal:'act on current evidence',purpose:'survive',method:'use perceived world',targetId:null,placeId:null,objectIds:[],desiredOutcome:'state change',longerTermPlan:null},inputTokens:1,outputTokens:1}
  if(request.role==='judge')return {raw:{approved:true,reason:'grounded',ended:false},inputTokens:1,outputTokens:1}
  const index=actorOrder.indexOf(actorId)
  const proposals=[
   {actionType:'TAKE_ITEM',objectRefs:[{kind:'object',reference:'food'}]},
   {actionType:'MOVE',destinationRef:'샘터',durationMinutes:10},
   {actionType:'OBSERVE',areaHint:'FOREST'},
   {actionType:'TAKE_ITEM',targetIds:['test-dagger-camp']},
   {actionType:'TAKE_ITEM',objectRefs:[{kind:'object',reference:'environment-boulder'}]},
  ]
  return {raw:{steps:[{intendedAction:`semantic step ${index}`,...proposals[index]}]},inputTokens:1,outputTokens:1}
 }
 f=traumaFixture(adapter)
 try{
  const food=object('real-food','organic',f.place.id);food.name='식량';food.kind='food'
  const hidden=object('test-dagger-camp','metal',f.world.places[1].id)
  const fixed=object('environment-boulder','stone',f.place.id);fixed.physical!.portable=false
  f.world.engine!.objects.push(food,hidden,fixed)
  const destination=f.world.places.find(p=>p.id!==f.place.id&&f.place.connectedPlaceIds.includes(p.id))!
  destination.name='샘터'
  f.world.engine!.connections.find(c=>c.fromPlaceId===f.place.id&&c.toPlaceId===destination.id||c.toPlaceId===f.place.id&&c.fromPlaceId===destination.id)!.travelMinutes=18
  store.setMaxActiveAgents(5)
  for(const actor of f.world.agents)actor.nextDecisionAt=0
  actorOrder=selectDecisionAgents(f.world,5).map(a=>a.id)
  await store.runWorldTick()
  const stats=store.getAdminRuntime().pipeline!
  assert.equal(stats.brainCalls,5);assert.equal(stats.plannerCalls,5)
  assert.equal(stats.groundingSuccesses,4);assert.equal(stats.groundingFailures,1)
  assert.equal(stats.validationAccepted,3);assert.equal(stats.validationRejected,1)
  assert.equal(stats.resultJudgmentCalls,3);assert.equal(stats.acceptedActions,3)
  assert.equal(stats.providerFailures,0)
  assert.equal(store.getAdminRuntime().callsUsed,13)
  assert.equal(store.listActionAudit().length,5,'all five decisions have a terminal audit entry')
  assert.equal(f.world.engine!.ongoingActions.length,3)
  assert.ok(store.listActionAudit().some(e=>e.engineVerdict?.includes('object:not_perceived')))
  const priorEvents=stats.worldEvents
  store.advanceWorldTick(30)
  assert.equal(store.getAdminRuntime().pipeline?.completedActions,3)
  assert.ok(store.getAdminRuntime().pipeline!.worldEvents>priorEvents)
 }finally{await f.close()}
})
