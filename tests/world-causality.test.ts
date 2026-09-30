import {test} from 'node:test'
import assert from 'node:assert/strict'
import {traumaFixture,headInjury} from './trauma-fixture.ts'
import {acceptCombatBatch,combatContext,combatFingerprint,combatProposalIssue,normalizeCombatBatch} from '../server/world/traumaAdjudication.ts'
import {beginAction,selectDecisionAgents} from '../server/world/worldEngine.ts'
import {prepareDecision} from '../server/world/decisionController.ts'
import {evaluateV2} from '../server/world/decisionPolicy.ts'
import {rememberIntent, rememberResult, rememberSocialRefusal} from '../server/world/agentV2State.ts'
import {decisionPerception} from '../server/world/decisionPerception.ts'
import {deliberation} from '../server/world/motivations.ts'
import type {Candidate} from '../server/world/motivations.ts'
import {DatabaseSync} from 'node:sqlite'
import {migrate} from '../server/db/connection.ts'
import {seedDefaultRulePreset} from '../server/domain/rulePresets.ts'
import {createTestIsland} from '../server/domain/studioExample.ts'
import {saveStudio} from '../server/domain/studioStore.ts'
import {startWorldFromDraft} from '../server/domain/worldLaunch.ts'
import * as store from '../server/domain/worldStore.ts'
import {config} from '../server/config.ts'

function confirmedHit(f:ReturnType<typeof traumaFixture>){
 const task=f.attack()
 acceptCombatBatch(f.world,[task],[combatFingerprint(f.world,task)],{results:[{actionId:task.id,reaction:combatContext(f.world,task).reaction.kind,outcome:'HIT',injury:{...headInjury,effects:[]},basis:'Existing stone struck the scalp.'}]},'fixture')
 f.tick(5)
 return f.events.find(e=>e.actionId===task.id&&e.phase==='COMPLETED')!
}

test('A: an old same-opponent same-tool strike loses to a changed approach without an arbitrary cooldown',async()=>{
 const f=traumaFixture();try{
  confirmedHit(f);f.tick(180)
  const tool=f.world.engine!.objects.find(o=>o.location.kind==='agent'&&o.location.id===f.a.id&&o.physical?.material==='stone')!
  const base={actorId:f.a.id,locationId:f.place.id,targetIds:[f.b.id],actionType:'ATTACK' as const,intendedAction:'위협을 줄인다',goalKey:'CONFRONT_RIVAL'}
  const make=(id:string,action:Candidate['action']):Candidate=>({id,goal:'CONFRONT_RIVAL',action,benefit:20,cost:1,risk:1,fit:5,relationship:0,continuity:0,score:25,evidenceEventIds:[]})
  const same=make('same',{...base,aim:'HEAD',usedItemIds:[tool.id],publicReason:'같은 이유로 공격'})
  const changed=make('changed',{...base,aim:'TORSO',publicReason:'다른 부위를 겨냥'})
  const scored=evaluateV2(f.world,f.a.id,f.events,[same,changed])
  assert.ok(scored.find(c=>c.id==='same')!.score<scored.find(c=>c.id==='changed')!.score)
  assert.equal(f.a.v2!.recentActions.find(a=>a.actionType==='ATTACK')!.combatOutcome,'HIT')
 }finally{await f.close()}
})

test('B, E, H: a witnessed hit persists as injury, threat, memory and a changed next decision',async()=>{
 const f=traumaFixture();try{
  const before=deliberation(f.world,f.b.id,f.events).choices.find(c=>c.goal==='KEEP_SAFE'&&c.action.actionType==='OBSERVE')!.benefit
  const event=confirmedHit(f)
  assert.ok(f.b.memories!.some(m=>m.sourceEventIds.includes(event.id)))
  assert.ok(f.b.relationships.some(r=>r.otherAgentId===f.a.id&&(r.hostility??0)>=6))
  assert.ok((f.b.v2?.human.resentment[f.a.id]??0)>0)
  const seen=decisionPerception(f.world,f.b.id,f.events)
  assert.ok(seen.agents.find(a=>a.id===f.b.id)!.trauma!.injuries.some(w=>w.sourceEventId===event.id))
  const after=prepareDecision(f.world,f.b.id,f.events)
  assert.ok(after.choices.some(c=>c.evidenceEventIds.includes(event.id)&&c.action.targetIds.includes(f.a.id)))
  assert.ok(deliberation(f.world,f.b.id,f.events).choices.find(c=>c.goal==='KEEP_SAFE'&&c.action.actionType==='OBSERVE')!.benefit>before)
  assert.ok(f.b.body!.injury>0)
 }finally{await f.close()}
})

test('C, D: tissue mechanism rejects unarmed torso bleeding but permits an existing sharp tool',async()=>{
 const f=traumaFixture();try{
  const bare=f.attack(f.b,f.a,'TORSO')
  const injury={...headInjury,part:'TORSO' as const,site:'general' as const,type:'contusion' as const,severity:1,bleeding:1,pain:2,effects:[]}
  assert.equal(combatProposalIssue(f.world,bare,{actionId:bare.id,reaction:combatContext(f.world,bare).reaction.kind,outcome:'HIT',injury,basis:'fixture'}),'bleeding_without_tissue_break')
  const corrected=normalizeCombatBatch(f.world,[bare],{results:[{actionId:bare.id,reaction:combatContext(f.world,bare).reaction.kind,outcome:'HIT',injury,basis:'fixture'}]})
  assert.deepEqual(corrected.corrections[bare.id],['unsupported_bleeding_removed'])
  assert.equal((corrected.batch as {results:Array<{injury:{bleeding:number}}>} ).results[0].injury.bleeding,0)
  f.world.engine!.ongoingActions=[]
  f.world.engine!.objects.push({id:'sharp-tool',name:'날카로운 도구',kind:'tool',quantity:1,condition:'intact',location:{kind:'agent',id:f.b.id},physical:{material:'other',edge:'sharp',portable:true,attackPower:1,cover:0}})
  f.b.inventory.push('sharp-tool')
  const start=beginAction(f.world,{actorId:f.b.id,locationId:f.place.id,targetIds:[f.a.id],actionType:'ATTACK',aim:'TORSO',usedItemIds:['sharp-tool'],intendedAction:'도구로 공격한다'})
  const task=f.world.engine!.ongoingActions.find(t=>t.id===start.actionId)!
  assert.equal(combatProposalIssue(f.world,task,{actionId:task.id,reaction:combatContext(f.world,task).reaction.kind,outcome:'HIT',injury:{...injury,type:'laceration'},basis:'fixture'}),null)
 }finally{await f.close()}
})

test('F, G: consumed resources remain depleted while uninvolved agents retain independent decision slots',async()=>{
 const f=traumaFixture();try{
  f.place.resources.push({key:'water',label:'물',level:2,max:2,unit:'개',trend:'stable'})
  beginAction(f.world,{actorId:f.world.agents[2].id,locationId:f.place.id,targetIds:[],actionType:'DRINK',resourceKey:'water',intendedAction:'물을 마신다'})
  f.tick(5)
  assert.equal(f.place.resources.find(r=>r.key==='water')!.level,1)
  f.attack();f.attack(f.b,f.a)
  for(const other of f.world.agents.slice(2))other.nextDecisionAt=0
  const selected=selectDecisionAgents(f.world,3)
  assert.ok(selected.length>=2)
  assert.ok(selected.every(a=>a.id!==f.a.id&&a.id!==f.b.id))
 }finally{await f.close()}
})

test('G, H: a 180-minute demo tick gives multiple agents two causal decision windows',async()=>{
 const db=new DatabaseSync(':memory:');try{
  migrate(db);seedDefaultRulePreset(db);store.initializeWorldRuntime(db,undefined,false);config.worldDemoMode=true
  const draft=createTestIsland(db);draft.studio!.minutesPerTick=180
  const saved=saveStudio(db,draft.id,draft)
  assert.equal(startWorldFromDraft(db,saved).ok,true);store.stopSimulationTimerForTests()
  const world=store.getWorldState()
  for(const a of world.agents)a.nextDecisionAt=0
  await store.runWorldTick()
  assert.equal(world.engine!.minute,180)
  const decisions=world.agents.flatMap(a=>a.v2?.recentActions??[])
  assert.ok(decisions.some(a=>a.minute===90))
  assert.ok(decisions.some(a=>a.minute===180))
  assert.ok(world.agents.filter(a=>a.v2?.recentActions.length).length>=4)
 }finally{await store.shutdownWorldRuntime();db.close()}
})

test('last-survivor deadline raises attack value for a willing rival without forcing a cautious one',async()=>{
 const f=traumaFixture();try{
  f.world.engine!.context={genre:'survival',background:'fixture'}
  f.world.engine!.studio!.endMinute=2880
  f.world.engine!.studio!.config.endings=[{type:'survivors',value:1}]
  const attackValue=(id:string)=>deliberation(f.world,id,f.events).choices.find(c=>c.action.actionType==='ATTACK'&&c.action.targetIds[0]===f.b.id)?.benefit
  const early=attackValue(f.a.id)!
  f.world.engine!.minute=2400
  assert.ok(attackValue(f.a.id)!>early)
  const cautious=f.world.agents[2]
  cautious.dispositions={...cautious.dispositions!,aggression:0,competitiveness:0,riskTolerance:0,empathy:10}
  const safe=prepareDecision(f.world,cautious.id,f.events)
  assert.ok(safe.choices.some(c=>!['ATTACK','ROB'].includes(c.action.actionType)))
 }finally{await f.close()}
})

test('failed confrontation persists a preparation strategy across a take action and changes utility',async()=>{
 const f=traumaFixture();try{
  f.world.engine!.requireCombatAdjudication=false
  f.a.relationships.push({agentId:f.a.id,otherAgentId:f.b.id,stance:'hostile',hostility:6,trust:1})
  const action={actorId:f.a.id,locationId:f.place.id,targetIds:[f.b.id],actionType:'ATTACK' as const,aim:'TORSO' as const,intendedAction:'위협을 막는다',goalKey:'CONFRONT_RIVAL'}
  rememberIntent(f.a,action,'failed-strike',f.world.engine!.minute)
  const event={id:'failed-strike-event',actionId:'failed-strike',actionType:'ATTACK',phase:'COMPLETED',worldMinute:f.world.engine!.minute,detail:{combat:{targetId:f.b.id,damage:0,outcome:'DODGED'}} as never,stateChanges:[]} as never
  rememberResult(f.a,event,action)
  assert.equal(f.a.v2!.strategy?.stage,'prepare')
  const candidate=prepareDecision(f.world,f.a.id,f.events).choices.find(c=>c.action.actionType==='TAKE_ITEM'&&c.action.usedItemIds?.[0]==='rock')
  assert.ok(candidate)
  assert.ok(candidate.evidenceEventIds.includes('failed-strike-event'))
  const preparation=beginAction(f.world,candidate.action)
  assert.ok(preparation.relatedEventIds.includes('failed-strike-event'))
  f.tick(5)
  assert.equal(f.a.v2!.strategy?.stage,'ready')
  assert.equal(f.a.v2!.currentGoal,'CONFRONT_RIVAL')
  assert.ok(f.a.inventory.length>0)
  f.tick(30)
  const withTool=prepareDecision(f.world,f.a.id,f.events).choices.find(c=>c.action.actionType==='ATTACK'&&c.action.usedItemIds?.[0]===f.a.inventory[0])
  assert.ok(withTool)
  assert.ok(withTool.evidenceEventIds.includes('failed-strike-event'))
  f.world.engine!.objects.push({id:'unrelated-food',name:'비상식량',kind:'food',quantity:1,condition:'intact',location:{kind:'place',id:f.place.id}})
  beginAction(f.world,{actorId:f.a.id,locationId:f.place.id,targetIds:[],actionType:'TAKE_ITEM',usedItemIds:['unrelated-food'],goalKey:'SECURE_SUPPLIES',intendedAction:'식량 확보'})
  f.tick(5)
  assert.equal(f.a.v2!.currentGoal,'SECURE_SUPPLIES','food collection is not a confrontation plan step')
  assert.equal(f.a.v2!.strategy?.stage,'ready','food cannot count as the planned combat tool')
 }finally{await f.close()}
})

test('a refused social proposal changes the initiator strategy without altering the responder state',async()=>{
 const f=traumaFixture();try{
  f.world.engine!.interactions??=[]
  f.world.engine!.interactions.push({id:'first-offer:recipient',actorId:f.a.id,targetId:f.b.id,placeId:f.place.id,area:'CENTER',minute:0,expiresMinute:60,intent:'NEGOTIATE',status:'refused',sourceEventId:'first-offer'})
  const event={id:'refusal',phase:'COMPLETED',worldMinute:1,stateChanges:[{field:'interaction:first-offer:recipient:status',from:'pending',to:'refused'}]} as never
  rememberSocialRefusal(f.world,event)
  assert.equal(f.a.v2!.strategy?.failedIntent,'NEGOTIATE')
  const base={actorId:f.a.id,locationId:f.place.id,targetIds:[f.b.id],actionType:'SPEAK' as const,intendedAction:'대화',publicReason:'상황을 바꾼다'}
  const candidate=(id:string,intent:string):Candidate=>({id,goal:'BUILD_TRUST',action:{...base,intent},benefit:10,cost:1,risk:0,fit:0,relationship:0,continuity:0,score:9,evidenceEventIds:[]})
  const scored=evaluateV2(f.world,f.a.id,f.events,[candidate('repeat','NEGOTIATE'),candidate('change','WARN')])
  assert.ok(scored.find(c=>c.id==='change')!.score>scored.find(c=>c.id==='repeat')!.score)
  assert.equal(f.b.v2?.strategy,undefined)
 }finally{await f.close()}
})
