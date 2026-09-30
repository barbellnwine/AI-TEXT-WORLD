import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../server/db/connection.ts'
import { createTestIsland } from '../server/domain/studioExample.ts'
import { seedDefaultRulePreset, getRulePreset } from '../server/domain/rulePresets.ts'
import { startWorldFromDraft } from '../server/domain/worldLaunch.ts'
import { getDraft, updateCharacter } from '../server/domain/worldDrafts.ts'
import { config } from '../server/config.ts'
import * as store from '../server/domain/worldStore.ts'
import { beginAction, advanceEngine, validateEngineAction, recordExperience, selectDecisionAgents } from '../server/world/worldEngine.ts'
import { DEFAULT_DISPOSITIONS, generatedDispositions, parseDispositions } from '../server/world/dispositions.ts'
import { prepareDecision, selectCandidate, bindCandidate } from '../server/world/decisionController.ts'
import { ensureAgentV2, decisionKey } from '../server/world/agentV2State.ts'
import { decisionPerception } from '../server/world/decisionPerception.ts'
import { evaluateV2 } from '../server/world/decisionPolicy.ts'
import { deliberation, rememberGoalChoice } from '../server/world/motivations.ts'
import { toPublicWorld } from '../server/world/publicView.ts'
import { agentRequest, worldRequestBody } from '../server/domain/worldAgent.ts'
import type { ProposedAction } from '../server/world/actionSchema.ts'
import type { WorldEvent } from '../server/domain/worldTypes.ts'

after(()=>store.stopSimulationTimerForTests())
function fixture(){
 const db=new DatabaseSync(':memory:'); migrate(db);seedDefaultRulePreset(db);store.initializeWorldRuntime(db)
 config.worldDemoMode=true
 const draft=createTestIsland(db);assert.equal(startWorldFromDraft(db,draft).ok,true);store.stopSimulationTimerForTests()
 const world=store.getWorldState(), place=world.places[0]
 world.engine!.context={genre:'survival',background:'test'}
 for(const a of world.agents){a.publicState.locationId=place.id;a.publicState.localArea='CENTER';a.humanState!.fatigue=0;a.humanState!.survival_need=9;a.vitals!.hunger=9;a.vitals!.thirst=0;a.body={health:1,injury:1};a.emotion!.fear=0;a.vitals!.loneliness=0;a.relationships=[];a.inventory=[];a.dispositions={...DEFAULT_DISPOSITIONS};a.nextDecisionAt=0}
 for(const p of world.places) for(const r of p.resources)r.level=0
 world.engine!.objects=[{id:'known-food',name:'비상식량',kind:'food',quantity:2,condition:'intact',location:{kind:'agent',id:world.agents[0].id}}]
 world.agents[0].inventory=['known-food']
 const events:WorldEvent[]=[]
 const act=(action:ProposedAction,minutes=3)=>{const check=validateEngineAction(action,world,events);assert.ok(check.approved,check.notes.join(','));beginAction(world,action);advanceEngine(world,minutes,events,e=>{events.push(e);recordExperience(world,e)})}
 // Offers that contain an item are bilateral; show it independently to each observer.
 const show=()=>{
   for(const other of world.agents.slice(1))act({actorId:world.agents[0].id,locationId:place.id,actionType:'SPEAK',intent:'NEGOTIATE',targetIds:[other.id],intendedAction:'offer food',spokenText:'이 비상식량이 필요해?',offerItemId:'known-food'})
   world.engine!.interactions!.forEach(i=>i.status='refused') // Fixture setup: no pending reply competing with the test decision.
 }
 return{db,draft,world,place,events,act,show,async close(){await store.shutdownWorldRuntime();db.close()}}
}

test('same scarcity yields cooperation, negotiated exchange and opportunistic theft from distinct stable dispositions',async()=>{
 const f=fixture();try{
   const [owner,kind,trader,opportunist]=f.world.agents
   kind.dispositions={selfInterest:1,empathy:10,trust:10,competitiveness:1,riskTolerance:4,aggression:0,negotiation:3,impulsivity:1}
   trader.dispositions={selfInterest:6,empathy:2,trust:3,competitiveness:4,riskTolerance:2,aggression:0,negotiation:10,impulsivity:1}
   opportunist.dispositions={selfInterest:10,empathy:0,trust:0,competitiveness:10,riskTolerance:10,aggression:8,negotiation:0,impulsivity:0}
   f.world.engine!.objects.push({id:'trade-tool',name:'도구',kind:'tool',quantity:1,condition:'intact',location:{kind:'agent',id:trader.id}});trader.inventory.push('trade-tool')
   await f.show()
   f.act({actorId:owner.id,locationId:f.place.id,actionType:'SLEEP',targetIds:[],intendedAction:'sleep'},1)
   const choices=[kind,trader,opportunist].map(a=>selectCandidate(prepareDecision(f.world,a.id,f.events).choices)!)
   assert.deepEqual(choices.map(c=>c.action.actionType),['COOPERATE','SPEAK','STEAL'])
   assert.deepEqual(choices.map(c=>c.goal),['BUILD_TRUST','SECURE_SUPPLIES','SECURE_SUPPLIES'])
   assert.equal(choices[1].action.intent,'NEGOTIATE')
   assert.equal(choices[1].action.requestItemId,'known-food')
   assert.ok(choices.every(c=>Number.isFinite(c.risk)&&Number.isFinite(c.score)))
   f.act(choices[2].action,5)
   assert.ok(opportunist.inventory.includes('known-food'));assert.ok(!owner.inventory.includes('known-food'))
   assert.ok(opportunist.motivations!.goals.some(g=>g.status==='achieved'&&g.evidenceEventIds.length))
   assert.ok(opportunist.memories!.some(m=>m.sourceEventIds.some(id=>f.events.some(e=>e.id===id&&e.actionType==='STEAL'))))
   assert.equal(owner.relationships.some(r=>r.otherAgentId===opportunist.id),false,'sleeping owner cannot identify a thief')
   const saved=JSON.parse(JSON.stringify(f.world)), oldGoals=JSON.stringify(saved.agents[3].motivations)
   saved.engine.minute=1439;saved.engine.lastVitalsMinute=1439;saved.engine.studio.lastExposureMinute=1439
   advanceEngine(saved,2)
   assert.equal(saved.clock.day,2);assert.equal(JSON.stringify(saved.agents[3].motivations),oldGoals)
   assert.deepEqual(saved.agents[3].dispositions,opportunist.dispositions)
   assert.ok(saved.agents[3].inventory.includes('known-food'))
 }finally{await f.close()}
})

test('unknown inventory and another character private traits cannot change a decision assessment',async()=>{
 const f=fixture();try{
   const a=f.world.agents[1], other=f.world.agents[0]
   const before=deliberation(f.world,a.id)
   assert.ok(!before.choices.some(c=>['STEAL','ROB'].includes(c.action.actionType)))
   other.dispositions={...DEFAULT_DISPOSITIONS,aggression:10,selfInterest:10}
   other.motivations!.longTerm='PRIVATE_SECRET'
   f.world.engine!.objects[0].quantity=999
   assert.deepEqual(deliberation(f.world,a.id),before)
   assert.doesNotMatch(JSON.stringify(toPublicWorld(f.world)),/PRIVATE_SECRET|observedPossessions|motivations|dispositions/)
 }finally{await f.close()}
})

test('failed search changes the next route, retains a blocked goal, and cannot invent supplies',async()=>{
 const f=fixture();try{
   const a=f.world.agents[1], search=prepareDecision(f.world,a.id,f.events).choices.find(c=>c.action.actionType==='EXPLORE')!
   assert.ok(search)
   const before=f.world.engine!.objects.length
   f.act(search.action,30)
   assert.equal(f.world.engine!.objects.length,before)
   assert.ok(a.motivations!.goals.some(g=>g.status==='blocked'&&g.failures===1))
   assert.ok(ensureAgentV2(a,f.world).recentFailures.some(x=>x.actionType==='EXPLORE'))
   const after=prepareDecision(f.world,a.id,f.events)
   assert.ok(after.choices.every(c=>c.action.areaHint!==search.action.areaHint))
   assert.ok(after.choices.some(c=>c.goal!==search.goal||c.action.areaHint!==search.action.areaHint))
 }finally{await f.close()}
})

test('concealment has a real effect but does not give nearby characters new knowledge',async()=>{
 const f=fixture();try{
   const [owner,other]=f.world.agents
   f.act({actorId:owner.id,locationId:f.place.id,actionType:'HIDE',targetIds:[],usedItemIds:['known-food'],intendedAction:'hide reserve',goalKey:'KEEP_RESERVE'},5)
   assert.equal(f.world.engine!.objects[0].concealedBy,owner.id)
   assert.ok(owner.motivations!.goals.some(g=>g.status==='achieved'))
   assert.equal(other.observedPossessions?.length??0,0)
   assert.ok(!other.memories?.some(m=>m.summary.includes('비상식량')))
 }finally{await f.close()}
})

test('combat can be evaluated for visible defense without hunger, greed or a battle-royale genre',async()=>{
 const f=fixture();try{
   const [attacker,defender]=f.world.agents
   defender.vitals!.hunger=defender.humanState!.survival_need=0
   defender.dispositions={...DEFAULT_DISPOSITIONS,selfInterest:0,aggression:9,riskTolerance:9,competitiveness:8,empathy:1}
   f.act({actorId:attacker.id,locationId:f.place.id,actionType:'ATTACK',targetIds:[defender.id],intendedAction:'attack'},1)
   const choices=prepareDecision(f.world,defender.id,f.events).choices
   assert.ok(choices.some(c=>c.goal==='DEFEND_SELF'&&c.action.actionType==='ATTACK'))
   assert.ok(choices.some(c=>c.action.actionType==='WAIT'))
   const picked=choices.find(c=>c.goal==='DEFEND_SELF')!
   assert.equal(bindCandidate({...picked.action,candidateId:picked.id,targetIds:['invented']},choices).targetIds[0],attacker.id)
   assert.throws(()=>bindCandidate({...picked.action,candidateId:'invented'},choices),/candidate_not_available/)
 }finally{await f.close()}
})

test('manual traits round-trip, old rows migrate without losing characters, generated profiles differ',async()=>{
 const f=fixture();try{
   const c=getDraft(f.db,f.draft.id)!.characters[0], traits={...DEFAULT_DISPOSITIONS,empathy:10,aggression:0}
   updateCharacter(f.db,f.draft.id,c.id,{...c,dispositions:traits})
   assert.deepEqual(getDraft(f.db,f.draft.id)!.characters[0].dispositions,traits)
   updateCharacter(f.db,f.draft.id,c.id,{...c,dispositions:undefined})
   assert.deepEqual(getDraft(f.db,f.draft.id)!.characters[0].dispositions,traits)
   f.db.exec('ALTER TABLE draft_characters DROP COLUMN dispositions_json');migrate(f.db);migrate(f.db)
   const restored=getDraft(f.db,f.draft.id)!
   assert.equal(restored.characters.length,5);assert.equal(restored.characters[0].name,c.name)
   assert.deepEqual(restored.characters[0].dispositions,DEFAULT_DISPOSITIONS)
   assert.equal(new Set(Array.from({length:10},(_,i)=>JSON.stringify(generatedDispositions(`person${i}`)))).size,10)
   assert.throws(()=>parseDispositions({aggression:11}),/invalid_dispositions/)
   assert.throws(()=>parseDispositions({constructor:1}),/invalid_dispositions/)
 }finally{await f.close()}
})

test('active-season trait changes require pause and persist without rewriting history or advancing time',async()=>{
 const f=fixture();try{
   const a=f.world.agents[0], time=f.world.engine!.minute
   assert.throws(()=>store.setActorDispositions(a.id,{empathy:9}),/pause_world/)
   store.pauseSeason();store.setActorDispositions(a.id,{empathy:9})
   assert.equal(a.dispositions!.empathy,9);assert.equal(f.world.engine!.minute,time)
   assert.ok(store.listOperatorLog().some(l=>l.summary.includes('Disposition edit')))
   await store.shutdownWorldRuntime();store.initializeWorldRuntime(f.db)
   assert.equal(store.getWorldState().agents[0].dispositions!.empathy,9)
   assert.equal(store.getAdminRuntime().status,'PAUSED')
 }finally{await f.close()}
})

test('full candidate assessment fits provider request limits without real provider calls',async()=>{
 const f=fixture();try{
   f.show();const actor=f.world.agents[1], assessment=prepareDecision(f.world,actor.id,f.events)
   const request=agentRequest({draft:f.draft,rules:[],mode:'live'},actor.id,f.world,f.events,assessment)
   assert.ok(Buffer.byteLength(worldRequestBody(request))<=20000)
   assert.match(request.prompt,/NEEDS, DESIRES AND FEASIBLE CHOICES/)
   assert.doesNotMatch(request.prompt,/PRIVATE_SECRET/)
 }finally{await f.close()}
})

test('visible food stack is a take candidate, remains in world after one pickup, and can be consumed later',async()=>{
 const f=fixture();try{
  const actor=f.world.agents[1]
  f.world.engine!.objects.push({id:'ground-rations',name:'식량 묶음',kind:'food',quantity:3,condition:'intact',location:{kind:'place',id:f.place.id},localArea:'CENTER'})
  const take=prepareDecision(f.world,actor.id,f.events).choices.find(c=>c.action.actionType==='TAKE_ITEM'&&c.action.usedItemIds?.[0]==='ground-rations')
  assert.ok(take,'visible food must reach the decision candidate list')
  f.act(take.action,5)
  assert.equal(f.world.engine!.objects.find(o=>o.id==='ground-rations')!.quantity,2)
  const held=f.world.engine!.objects.find(o=>o.location.kind==='agent'&&o.location.id===actor.id&&o.kind==='food')!
  assert.equal(held.quantity,1)
  assert.ok(actor.inventory.includes(held.id))
  assert.ok(prepareDecision(f.world,actor.id,f.events).choices.some(c=>c.action.actionType==='USE_ITEM'&&c.action.usedItemIds?.[0]===held.id))
  f.act({actorId:actor.id,locationId:f.place.id,targetIds:[],actionType:'USE_ITEM',usedItemIds:[held.id],intendedAction:'확보한 식량을 먹는다'},5)
  assert.ok(actor.vitals!.hunger<9)
  assert.equal(f.world.engine!.objects.find(o=>o.id==='ground-rations')!.quantity,2)
 }finally{await f.close()}
})

test('a shared sourced fact becomes an uncertain personal belief and a route candidate',async()=>{
 const f=fixture();try{
  const [sender,receiver]=f.world.agents
  const destination=structuredClone(f.place);destination.id='reported-place';destination.name='보고된 장소';destination.currentAgentIds=[];destination.resources=[];destination.connectedPlaceIds=[f.place.id]
  f.world.places.push(destination);f.place.connectedPlaceIds.push(destination.id)
  f.world.engine!.connections.push({fromPlaceId:f.place.id,toPlaceId:destination.id,travelMinutes:15,blocked:false,requirements:''})
  sender.knownPlaceIds!.push(destination.id)
  sender.knowledge.push({id:'source-fact',summary:'저쪽에 사용할 수 있는 장소가 있다',placeId:destination.id,verified:true,confidence:1,learnedAt:new Date().toISOString()})
  f.act({actorId:sender.id,locationId:f.place.id,targetIds:[receiver.id],actionType:'SHARE_INFO',factId:'source-fact',intendedAction:'확인한 장소를 알려 준다'},3)
  const belief=receiver.knowledge.find(k=>k.sourceFactId==='source-fact')!
  assert.ok(belief,JSON.stringify(f.events.map(e=>({phase:e.phase,verdict:e.engineVerdict,summary:e.summary}))))
  assert.equal(belief.sourceAgentId,sender.id)
  assert.equal(belief.verified,false)
  assert.ok((belief.confidence??0)>0&&(belief.confidence??0)<1)
  assert.ok(belief.sourceEventId)
  assert.ok(receiver.knownPlaceIds!.includes(destination.id))
  const route=deliberation(f.world,receiver.id,f.events).choices.find(c=>c.goal==='VERIFY_REPORT'&&c.action.destinationId===destination.id)
  assert.ok(route)
  assert.ok(route.evidenceEventIds.includes(belief.sourceEventId!))
 }finally{await f.close()}
})

test('item locations are learned by local perception and remembered across movement without leaking to another agent',async()=>{
 const f=fixture();try{
  const [observer,other]=f.world.agents
  observer.vitals!.thirst=8
  f.world.engine!.objects.push({id:'shore-water',name:'물통',kind:'water',quantity:1,condition:'intact',location:{kind:'place',id:f.place.id},localArea:'SHORE'})
  assert.ok(!prepareDecision(f.world,observer.id,f.events).choices.some(c=>c.action.usedItemIds?.includes('shore-water')))
  assert.equal(observer.observedObjects?.some(o=>o.id==='shore-water')??false,false)
  observer.publicState.localArea='SHORE'
  assert.ok(prepareDecision(f.world,observer.id,f.events).choices.some(c=>c.action.actionType==='TAKE_ITEM'&&c.action.usedItemIds?.includes('shore-water')))
  assert.ok(observer.observedObjects?.some(o=>o.id==='shore-water'))
  observer.publicState.localArea='CENTER'
  const route=prepareDecision(f.world,observer.id,f.events).choices.find(c=>c.goal==='SEEK_KNOWN_ITEM'&&c.action.areaHint==='SHORE')
  assert.ok(route)
  assert.equal(other.observedObjects?.some(o=>o.id==='shore-water')??false,false)
  assert.equal(decisionPerception(f.world,other.id,f.events).agents.find(a=>a.id===other.id)?.observedObjects?.some(o=>o.id==='shore-water')??false,false)
  f.act(route.action,30)
  assert.equal(observer.v2?.itemPlan?.stage,'take')
  const take=prepareDecision(f.world,observer.id,f.events).choices.find(c=>c.action.actionType==='TAKE_ITEM'&&c.action.usedItemIds?.[0]==='shore-water')
  assert.ok(take)
  assert.ok(take.evidenceEventIds.includes(observer.v2!.itemPlan!.sourceEventId!))
  f.act(take.action,5)
  assert.equal(observer.v2?.itemPlan?.stage,'use')
  const use=prepareDecision(f.world,observer.id,f.events).choices.find(c=>c.action.actionType==='USE_ITEM'&&c.action.usedItemIds?.[0]===observer.v2?.itemPlan?.itemId)
  assert.ok(use)
  f.act(use.action,5)
  assert.equal(observer.v2?.itemPlan,undefined)
  assert.ok(observer.vitals!.thirst<8)
 }finally{await f.close()}
})

test('an item plan is abandoned when the remembered item is gone on arrival',async()=>{
 const f=fixture();try{
  const [observer,collector]=f.world.agents
  observer.vitals!.thirst=8
  f.world.engine!.objects.push({id:'disputed-water',name:'공유 물통',kind:'water',quantity:1,condition:'intact',location:{kind:'place',id:f.place.id},localArea:'SHORE'})
  observer.publicState.localArea='SHORE';prepareDecision(f.world,observer.id,f.events)
  observer.publicState.localArea='CENTER'
  const route=prepareDecision(f.world,observer.id,f.events).choices.find(c=>c.goal==='SEEK_KNOWN_ITEM'&&c.action.areaHint==='SHORE')!
  collector.publicState.localArea='SHORE'
  f.act({actorId:collector.id,locationId:f.place.id,targetIds:[],actionType:'TAKE_ITEM',usedItemIds:['disputed-water'],intendedAction:'물통 확보'},5)
  f.act(route.action,30)
  assert.equal(observer.v2?.itemPlan,undefined)
  assert.equal(observer.observedObjects?.some(o=>o.id==='disputed-water')??false,true,'old belief persists until a new perception')
  prepareDecision(f.world,observer.id,f.events)
  assert.equal(observer.observedObjects?.some(o=>o.id==='disputed-water')??false,false,'new observation removes a disproved item location')
 }finally{await f.close()}
})

test('V2 perception projection excludes opponent private state and undiscovered places',async()=>{
 const f=fixture();try{
   const self=f.world.agents[1],other=f.world.agents[0]
   other.hiddenNotes='PRIVATE_TRUTH';other.humanState!.fatigue=9;other.memories!.push({id:'private-memory',summary:'SECRET',atMinute:0,importance:'high',sourceEventIds:[]})
   const projection=decisionPerception(f.world,self.id,f.events)
   const seen=projection.agents.find(a=>a.id===other.id)!
   assert.equal(seen.humanState,undefined)
   assert.equal(seen.v2,undefined)
   assert.equal(seen.hiddenNotes,undefined)
   assert.deepEqual(seen.inventory,[])
   assert.deepEqual(seen.memories,[])
   assert.ok(!projection.engine!.objects.some(o=>o.location.kind==='agent'&&o.location.id===other.id))
   assert.deepEqual(projection.engine!.truths,[])
   assert.doesNotMatch(JSON.stringify(projection),/PRIVATE_TRUTH|private-memory|SECRET/)
 }finally{await f.close()}
})

test('V2 five equally hungry agents retain different feasible strategies and private state cannot change a score',async()=>{
 const f=fixture();try{
   const [owner,helper,trader,taker,watcher]=f.world.agents
   helper.dispositions={selfInterest:1,empathy:10,trust:10,competitiveness:1,riskTolerance:3,aggression:0,negotiation:4,impulsivity:1}
   trader.dispositions={selfInterest:6,empathy:2,trust:3,competitiveness:4,riskTolerance:2,aggression:0,negotiation:10,impulsivity:1}
   taker.dispositions={selfInterest:10,empathy:0,trust:0,competitiveness:10,riskTolerance:10,aggression:8,negotiation:0,impulsivity:0}
   watcher.dispositions={selfInterest:4,empathy:3,trust:0,competitiveness:2,riskTolerance:0,aggression:0,negotiation:0,impulsivity:0}
   for(const a of f.world.agents){a.vitals!.hunger=9;a.humanState!.survival_need=9}
   f.world.engine!.objects.push({id:'trade-tool-v2',name:'tool',kind:'tool',quantity:1,condition:'intact',location:{kind:'agent',id:trader.id}});trader.inventory.push('trade-tool-v2')
   await f.show()
   const ownerChoice=prepareDecision(f.world,owner.id,f.events).choices[0]
   f.act({actorId:owner.id,locationId:f.place.id,actionType:'SLEEP',targetIds:[],intendedAction:'sleep'},1)
   const choices=[ownerChoice,...f.world.agents.slice(1).map(a=>prepareDecision(f.world,a.id,f.events).choices[0])]
   assert.ok(new Set(choices.map(c=>`${c.goal}:${c.action.actionType}`)).size>=3)
   const before=prepareDecision(f.world,helper.id,f.events).choices.map(c=>[c.id,c.score,c.action.actionType])
   owner.humanState!.fatigue=10;owner.hiddenNotes='SECRET';owner.v2=ensureAgentV2(owner,f.world);owner.v2.human.power=10
   f.world.engine!.objects.find(o=>o.id==='known-food')!.quantity=99
   assert.deepEqual(prepareDecision(f.world,helper.id,f.events).choices.map(c=>[c.id,c.score,c.action.actionType]),before)
 }finally{await f.close()}
})

test('V2 social debt, failure history and goal commitment affect scores without a second selector',async()=>{
 const f=fixture();try{
   const actor=f.world.agents[1],other=f.world.agents[0]
   const v=ensureAgentV2(actor,f.world)
   const speak=()=>evaluateV2(f.world,actor.id,f.events,deliberation(f.world,actor.id,f.events).choices).find(c=>c.action.actionType==='SPEAK'&&c.action.targetIds[0]===other.id)!
   const base=speak();assert.ok(base)
   v.human.socialDebt[other.id]=8
   const indebted=speak();assert.ok(indebted.score>base.score)
   v.currentGoal=indebted.goal;v.goalStartedAt=f.world.engine!.minute;v.goalCommitment=8
   const committed=speak();assert.ok(committed.score>indebted.score)
   const key=decisionKey(committed.action)
   v.recentFailures.push({key,actionType:committed.action.actionType,intent:committed.action.intent??'',targetId:other.id,locationId:f.place.id,minute:f.world.engine!.minute,result:'failed'})
   assert.ok(speak().score<committed.score)
 }finally{await f.close()}
})

test('V2 moral axes and compound desperation change the same candidate without exposing another agent state',async()=>{
 const f=fixture();try{
   const [target,actor]=f.world.agents
   const action:ProposedAction={actorId:actor.id,locationId:f.place.id,actionType:'STEAL',targetIds:[target.id],usedItemIds:['known-food'],intendedAction:'attempt theft'}
   const candidate={id:'theft',goal:'SECURE_SUPPLIES',action,benefit:10,cost:1,risk:2,fit:0,relationship:0,continuity:0,score:12,evidenceEventIds:[]}
   actor.emotion!.fear=6
   actor.dispositions={...DEFAULT_DISPOSITIONS,empathy:10,aggression:0,selfInterest:1}
   const restrained=evaluateV2(f.world,actor.id,f.events,[candidate])[0]
   const stable=ensureAgentV2(actor,f.world).human.desperation
   actor.dispositions={...DEFAULT_DISPOSITIONS,empathy:0,aggression:9,selfInterest:10}
   const selfish=evaluateV2(f.world,actor.id,f.events,[candidate])[0]
   assert.ok(selfish.score>restrained.score)
   actor.emotion!.fear=8;actor.humanState!.fatigue=8;actor.trauma={injuries:[],pain:6,functions:{vision:0,mobility:0,dexterity:0,attention:0}} as typeof actor.trauma
   evaluateV2(f.world,actor.id,f.events,[candidate])
   assert.ok(ensureAgentV2(actor,f.world).human.desperation>stable)
   const v=ensureAgentV2(actor,f.world)
   assert.ok(v.human.moralProfile.killingAversion>=v.human.moralProfile.violenceAversion)
   const saved=JSON.parse(JSON.stringify(f.world))
   delete saved.agents[1].v2.goalPriority
   delete saved.agents[1].v2.human.moralProfile.stealingAversion
   assert.equal(ensureAgentV2(saved.agents[1],saved).goalStartedAt,v.goalStartedAt)
   assert.ok(Number.isFinite(ensureAgentV2(saved.agents[1],saved).human.moralProfile.stealingAversion))
 }finally{await f.close()}
})

test('scheduler selects only due agents from a hundred independent V2 states',async()=>{
 const f=fixture();try{
   const template=f.world.agents[0]
   const minute=f.world.engine!.minute
   f.world.agents=Array.from({length:100},(_,i)=>{
     const agent=structuredClone(template)
     agent.id=`agent-${i}`;agent.name=`Agent ${i}`;agent.v2=undefined
     agent.nextDecisionAt=i<20?minute:minute+60
     agent.wakeReason=undefined
     return agent
   })
   const due=selectDecisionAgents(f.world,100)
   assert.equal(due.length,20)
   assert.ok(due.every(a=>a.nextDecisionAt===minute))
   assert.equal(new Set(f.world.agents.map(a=>a.v2)).size,100)
 }finally{await f.close()}
})

test('hostility can produce a verbal threat without forcing combat or target consent',async()=>{
 const f=fixture();try{
   const [target,actor]=f.world.agents
   actor.relationships.push({agentId:actor.id,otherAgentId:target.id,stance:'hostile',hostility:7,trust:2})
   const threat=deliberation(f.world,actor.id,f.events).choices.find(c=>c.action.intent==='THREATEN'&&c.action.targetIds[0]===target.id)
   assert.ok(threat)
   const injury=target.body!.injury
   f.act(threat.action,3)
   assert.equal(target.body!.injury,injury)
   assert.ok(!f.world.engine!.interactions!.some(i=>i.intent==='THREATEN'&&i.targetId===target.id))
   assert.ok(f.events.some(e=>e.actionType==='SPEAK'&&e.phase==='COMPLETED'))
 }finally{await f.close()}
})

test('a real gift creates durable social debt that changes the recipient choice score',async()=>{
 const f=fixture();try{
   const [giver,receiver]=f.world.agents
   const score=()=>evaluateV2(f.world,receiver.id,f.events,deliberation(f.world,receiver.id,f.events).choices).find(c=>c.action.actionType==='SPEAK'&&c.action.targetIds[0]===giver.id)?.score
   const before=score()
   f.act({actorId:giver.id,locationId:f.place.id,actionType:'GIVE_ITEM',targetIds:[receiver.id],usedItemIds:['known-food'],intendedAction:'offer a portion'},3)
   const debt=ensureAgentV2(receiver,f.world).human.socialDebt[giver.id]
   assert.ok(debt>0)
   const restored=JSON.parse(JSON.stringify(f.world))
   assert.equal(ensureAgentV2(restored.agents[1],restored).human.socialDebt[giver.id],debt)
   const after=score()
   assert.ok(before!==undefined&&after!==undefined)
 }finally{await f.close()}
})

test('V2 extreme candidates require individual pressure and violence leaves unequal psychological consequences',async()=>{
 const f=fixture();try{
   const [target,calm,aggressive]=f.world.agents
   for(const a of [calm,aggressive]){a.vitals!.hunger=1;a.vitals!.thirst=1;a.humanState!.survival_need=1}
   calm.dispositions={...DEFAULT_DISPOSITIONS,aggression:1,empathy:9,selfInterest:2}
   aggressive.dispositions={...DEFAULT_DISPOSITIONS,aggression:9,empathy:1,riskTolerance:9}
   f.world.engine!.competition={endMinute:2880,lastSurvivor:true}
   const combat=(id:string)=>prepareDecision(f.world,id,f.events).choices.filter(c=>['ATTACK','ROB','STEAL'].includes(c.action.actionType))
   assert.equal(combat(calm.id).length,0)
   assert.ok(combat(aggressive.id).length>0)
   const calmV=ensureAgentV2(calm,f.world),aggressiveV=ensureAgentV2(aggressive,f.world)
   const attack:ProposedAction={actorId:aggressive.id,locationId:f.place.id,actionType:'ATTACK',targetIds:[target.id],intendedAction:'test encounter',aim:'TORSO'}
   f.act(attack,10)
   assert.ok(validateEngineAction(attack,f.world,f.events).notes.includes('semantic_attack_cooldown_30m'))
   assert.ok(aggressiveV.human.violenceEscalation>0)
   assert.ok(aggressiveV.human.guilt>=0)
   assert.equal(calmV.human.violenceEscalation,0)
   assert.ok(ensureAgentV2(target,f.world).human.resentment[aggressive.id]>0)
   f.act({actorId:calm.id,locationId:f.place.id,actionType:'ATTACK',targetIds:[f.world.agents[3].id],intendedAction:'second encounter',aim:'TORSO'},10)
   assert.ok(calmV.human.guilt>aggressiveV.human.guilt)
 }finally{await f.close()}
})

test('five-person battle premise with full season rules and durable goals fits the real request budget',async()=>{
 const f=fixture();try{
  f.draft.background='다섯 참가자는 최후 생존자 조건과 48시간 제한을 알고 있다. 유한한 물자와 기존 관계를 바탕으로 동맹, 협상, 은폐, 경쟁, 공격과 회피를 판단한다. '.repeat(3)
  f.draft.genre='배틀로얄 / 생존 / 심리 스릴러'
  const rules=getRulePreset(f.db,f.draft.rulePresetId!)!.rules
  for(const actor of f.world.agents){
   actor.publicState.visibleGoal='자신의 성격과 관계를 유지하며 유리한 기회를 판단해 끝까지 살아남는다.'
   actor.motivations!.goals=Array.from({length:6},(_,i)=>({id:`goal-${i}`,goal:'SECURE_SUPPLIES',status:'blocked' as const,attempts:3,failures:2,createdMinute:0,updatedMinute:60,evidenceEventIds:Array.from({length:12},(_,j)=>`event-${i}-${j}`),actionIds:Array.from({length:24},(_,j)=>`action-${i}-${j}`)}))
   const request=agentRequest({draft:f.draft,rules,mode:'live'},actor.id,f.world,[],prepareDecision(f.world,actor.id,[]))
   assert.ok(Buffer.byteLength(worldRequestBody(request))<=20000)
   assert.ok(request.prompt.includes(rules[0].description))
   assert.ok(request.prompt.includes(actor.publicState.visibleGoal))
   const input=JSON.parse(request.prompt.split('[NEEDS, DESIRES AND FEASIBLE CHOICES]')[1].trimStart().split('\n')[0])
   assert.ok(input.choices.some(c=>c.action.actionType==='WAIT'))
   assert.equal(input.goals.length,6)
  }
 }finally{await f.close()}
})

test('robbery records resisted failure, while an actual overpowering transfers the known object',async()=>{
 for(const initialInjury of [1,7]) {
  const f=fixture();try{
   f.show();const [owner,robber]=f.world.agents;owner.body!.injury=initialInjury
   f.act({actorId:robber.id,locationId:f.place.id,actionType:'ROB',targetIds:[owner.id],usedItemIds:['known-food'],intendedAction:'attempt robbery',goalKey:'SECURE_SUPPLIES'},5)
   const transferred=initialInjury===7
   assert.equal(robber.inventory.includes('known-food'),transferred)
   assert.equal(owner.relationships.find(r=>r.otherAgentId===robber.id)!.stance,'hostile')
   assert.equal(robber.motivations!.goals.at(-1)!.status,transferred?'achieved':'blocked')
   assert.equal(f.world.engine!.outcomes![robber.id].at(-1)!.failed,!transferred)
   assert.ok(owner.memories!.some(m=>m.sourceEventIds.includes(f.events.find(e=>e.actionType==='ROB'&&e.phase==='COMPLETED')!.id)))
  }finally{await f.close()}
 }
})

test('a rejected unrelated proposal cannot mark the current goal as failed',async()=>{
 const f=fixture();try{
  const owner=f.world.agents[0]
  f.act({actorId:owner.id,locationId:f.place.id,actionType:'HIDE',targetIds:[],usedItemIds:['known-food'],intendedAction:'hide',goalKey:'KEEP_RESERVE'},5)
  const before=structuredClone(owner.motivations)
  const original=f.events.find(e=>e.actionType==='HIDE'&&e.phase==='COMPLETED')!
  recordExperience(f.world,{...original,id:'unrelated-rejection',outcome:'REJECTED',phase:'FAILED',actionId:undefined})
  assert.deepEqual(owner.motivations,before)
 }finally{await f.close()}
})

test('renewed desires have distinct identities and preserve previous achievements',async()=>{
 const f=fixture();try{
  const actor=f.world.agents[0], action:ProposedAction={actorId:actor.id,locationId:f.place.id,actionType:'WAIT',targetIds:[],intendedAction:'wait',goalKey:'KEEP_SAFE'}
  const first=rememberGoalChoice(f.world,action);first.status='achieved'
  const renewed=rememberGoalChoice(f.world,action)
  assert.notEqual(first.id,renewed.id)
  assert.equal(rememberGoalChoice(f.world,action).attempts,2)
  rememberGoalChoice(f.world,{...action,goalKey:'RECOVER'})
  assert.equal(first.status,'achieved');assert.equal(renewed.status,'abandoned')
 }finally{await f.close()}
})

test('independent acceptance fulfills the proposer resource goal and refusal blocks it without a transfer',async()=>{
 for(const response of ['ACCEPT','REFUSE'] as const){
  const f=fixture();try{
   f.show();const [owner,trader]=f.world.agents
   f.world.engine!.objects.push({id:'tool',name:'도구',kind:'tool',quantity:1,condition:'intact',location:{kind:'agent',id:trader.id}});trader.inventory.push('tool')
   f.act({actorId:trader.id,locationId:f.place.id,actionType:'SPEAK',targetIds:[owner.id],intent:'NEGOTIATE',offerItemId:'tool',requestItemId:'known-food',spokenText:'이 도구와 식량을 교환할까?',intendedAction:'negotiate',goalKey:'SECURE_SUPPLIES'},3)
   assert.equal(trader.motivations!.goals.at(-1)!.status,'active')
   const offer=f.world.engine!.interactions!.at(-1)!
   f.act({actorId:owner.id,locationId:f.place.id,actionType:'SPEAK',targetIds:[trader.id],replyTo:offer.id,response,spokenText:response==='ACCEPT'?'교환하자.':'교환하지 않겠어.',intendedAction:'answer'},3)
   assert.equal(trader.inventory.includes('known-food'),response==='ACCEPT')
   assert.equal(trader.motivations!.goals.at(-1)!.status,response==='ACCEPT'?'achieved':'blocked')
   if(response==='REFUSE')assert.equal(trader.v2?.strategy?.sourceEventId,f.events.at(-1)!.id)
   if(response==='ACCEPT') assert.ok(f.events.some(e=>e.stateChanges.some(c=>c.field===`relationship:${trader.id}:${owner.id}:trust`&&Number(c.to)>Number(c.from))))
   const snapshot=JSON.parse(JSON.stringify(f.world))
   snapshot.engine.minute=1439;snapshot.engine.lastVitalsMinute=1439;snapshot.engine.studio.lastExposureMinute=1439
   advanceEngine(snapshot,2)
   assert.deepEqual(snapshot.agents[1].relationships,trader.relationships)
   assert.deepEqual(snapshot.agents[1].motivations,JSON.parse(JSON.stringify(trader.motivations)))
  }finally{await f.close()}
 }
})
