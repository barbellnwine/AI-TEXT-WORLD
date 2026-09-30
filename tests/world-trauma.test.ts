import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import * as store from '../server/domain/worldStore.ts'
import {traumaFixture,headInjury} from './trauma-fixture.ts'
import {acceptCombatBatch,combatContext,combatFingerprint,combatProposalIssue,combatBatchRequest,combatMaxSeverity,normalizeCombatBatch,combatBatchIssue} from '../server/world/traumaAdjudication.ts'
import {addInjury,injuryIssue,progressTrauma,treatInjuries} from '../server/world/trauma.ts'
import {beginAction,validateEngineAction} from '../server/world/worldEngine.ts'
import {buildAgentKnowledgeView} from '../server/world/knowledgeFilter.ts'
import {resolvePhysicalCombat} from '../server/world/physicalActions.ts'
import {deliberation} from '../server/world/motivations.ts'
import {buildNarratorPrompt} from '../server/prompts/narratorPrompt.ts'
import {storyEvent} from '../server/domain/storyComposition.ts'
import {worldRequestBody} from '../server/domain/worldAgent.ts'
import {storyValidationIssue} from '../server/domain/novelNarration.ts'
after(()=>store.stopSimulationTimerForTests())

test('real treatment consumes medicine, persists without instant healing, and narration cannot invent blood or throwing',async()=>{
 const f=traumaFixture();try{
  const t=f.attack();f.tick(5)
  acceptCombatBatch(f.world,[t],[combatFingerprint(f.world,t)],{results:[{actionId:t.id,reaction:combatContext(f.world,t).reaction.kind,outcome:'HIT',injury:{...headInjury,bleeding:0,effects:[]},basis:'fixture'}]},'fixture');f.tick(0)
  const e=f.events.find(e=>e.detail?.adjudication)!
  for(const text of ['돌을 던지려는 움직임이었다.','피가 흘렀다.','시야가 흐려졌다.'])assert.ok(storyValidationIssue({paragraphs:[{text,eventIds:[e.id]}]},[e]))
  const n=f.b.trauma!.injuries.length;addInjury(f.b,headInjury,e.id,f.world.engine!.minute);assert.equal(f.b.trauma!.injuries.length,n,'replaying evidence cannot duplicate wounds')
  f.place.resources.push({key:'medicine',label:'의약품',unit:'개',level:2,max:2,trend:'stable'})
  const action={actorId:f.b.id,locationId:f.place.id,targetIds:[],actionType:'USE_ITEM' as const,resourceKey:'medicine',intendedAction:'상처를 처치한다'}
  assert.ok(validateEngineAction(action,f.world,f.events).approved)
  beginAction(f.world,action);f.tick(10)
  assert.equal(f.place.resources.find(r=>r.key==='medicine')!.level,1)
  assert.ok(f.b.trauma!.injuries.every(w=>w.treatedAt!==null&&!w.healed));assert.equal(f.b.body!.injury,2)
  assert.ok(validateEngineAction(action,f.world,f.events).notes.includes('wounds_already_treated'))
  f.tick(1440);assert.ok(f.b.trauma!.injuries.every(w=>w.healed));assert.equal(f.b.body!.injury,0)
 }finally{await f.close()}
})

test('delayed bleeding death satisfies engine ending and freezes future ticks',async()=>{
 const f=traumaFixture();try{
  for(const a of f.world.agents.slice(2))a.publicState.status='deceased'
  f.world.engine!.studio!.config.endings=[{id:'last',type:'survivors',value:1,ref:''}]
  addInjury(f.b,{...headInjury,severity:3,bleeding:3,pain:6,effects:[],healingHours:24},'source',0)
  f.tick(600);assert.equal(f.b.publicState.status,'deceased');assert.ok(f.world.engine!.studio!.ended)
  const minute=f.world.engine!.minute;assert.ok(minute<600);f.tick(60);assert.equal(f.world.engine!.minute,minute)
  assert.ok(f.events.some(e=>e.cause==='injury_deterioration_death'&&e.stateChanges.some(c=>c.field.endsWith(':health')&&c.to==='10')))
 }finally{await f.close()}
})

test('AI combat waits at its actual deadline; accepted injury is identical in log/state/knowledge and persists',async()=>{
 const f=traumaFixture();try{
  const t=f.attack();f.tick(60)
  assert.equal(f.world.engine!.minute,t.completesMinute);assert.equal(f.b.body!.injury,0);assert.equal(f.b.trauma,undefined)
  const p={actionId:t.id,reaction:combatContext(f.world,t).reaction.kind,outcome:'HIT' as const,injury:headInjury,basis:'두피의 출혈이 눈 쪽을 가릴 수 있는 상처를 제안한다.'}
  assert.ok(Buffer.byteLength(worldRequestBody(combatBatchRequest(f.world,[t],'gpt-4.1-mini')))<=20000)
  acceptCombatBatch(f.world,[t],[combatFingerprint(f.world,t)],{results:[p]},'fixture')
  f.tick(0)
  const e=f.events.find(e=>e.detail?.adjudication)!
  assert.equal(e.detail!.adjudication!.proposal.injury!.bleeding,1.5)
  assert.equal(f.b.trauma!.injuries[0].sourceEventId,e.id);assert.equal(f.b.trauma!.functions.vision,.4)
  assert.ok(e.stateChanges.some(c=>c.field.endsWith(':trauma')))
  assert.equal(buildAgentKnowledgeView(f.b.id,f.world,f.events)!.self.trauma!.functions.vision,.4)
  const restored=JSON.parse(JSON.stringify(f.world));assert.deepEqual(restored.agents[1].trauma,f.b.trauma)
  const prompt=buildNarratorPrompt([e],new Map([[f.place.id,f.place]]),new Map(f.world.agents.map(a=>[a.id,a])),'','DAY')
  assert.match(prompt,/blood_obstruction/);assert.ok(!prompt.includes(p.basis),'unverified AI justification is not narrator evidence')
  const before=f.b.trauma!.bloodLoss;f.tick(30);assert.ok(f.b.trauma!.bloodLoss>before);assert.ok(f.b.trauma!.functions.vision>0)
 }finally{await f.close()}
})

test('misses, fabricated reactions, incompatible anatomy and minor catastrophic bleeding are rejected atomically',async()=>{
 const f=traumaFixture();try{
  const t=f.attack();f.tick(5);const base={actionId:t.id,reaction:combatContext(f.world,t).reaction.kind,outcome:'HIT' as const,injury:headInjury,basis:''}
  for(const bad of [{...base,outcome:'MISSED' as const},{...base,reaction:'UNAWARE'},{...base,injury:{...headInjury,severity:1,bleeding:3}},{...base,injury:{...headInjury,part:'LEG' as const}}]){
   assert.ok(combatProposalIssue(f.world,t,bad));assert.throws(()=>acceptCombatBatch(f.world,[t],[combatFingerprint(f.world,t)],{results:[bad]},'fixture'));assert.equal(t.adjudication,undefined);assert.equal(f.b.body!.injury,0)
  }
  assert.equal(injuryIssue({...headInjury,effects:[]},3),null,'scalp bleeding does not mandate vision loss')
  assert.ok(injuryIssue({...headInjury,bleeding:0},3))
  const fingerprint=combatFingerprint(f.world,t);f.world.engine!.objects.find(o=>o.id===t.proposal.usedItemIds![0])!.quantity=0
  assert.throws(()=>acceptCombatBatch(f.world,[t],[fingerprint],{results:[base]},'fixture'),/stale/)
 }finally{await f.close()}
})

test('combat request states the engine severity cap for an exhausted attacker',async()=>{
 const f=traumaFixture();try{
  f.a.humanState!.fatigue=10
  const task=f.attack()
  f.tick(5)
  assert.equal(combatMaxSeverity(f.world,task),2)
  assert.match(combatBatchRequest(f.world,[task],'gpt-4.1-mini').prompt,/"maxSeverity":2/)
  assert.equal(combatProposalIssue(f.world,task,{actionId:task.id,reaction:combatContext(f.world,task).reaction.kind,outcome:'HIT',injury:{...headInjury,severity:3},basis:'test'}),'severity_out_of_bounds')
 }finally{await f.close()}
})

test('conservative combat correction removes only unsupported consequences, then validates the full result',async()=>{
 const f=traumaFixture();try{
  const task=f.attack();f.tick(5)
  const fingerprint=combatFingerprint(f.world,task),reaction=combatContext(f.world,task).reaction.kind
  const wrongOutcome=reaction==='DODGE'?'BLOCKED':'DODGED'
  const miss={actionId:task.id,reaction,outcome:wrongOutcome,injury:null,basis:'방어 이후 공격은 닿지 않았다.'}
  assert.equal(combatProposalIssue(f.world,task,miss),'reaction_outcome_mismatch')
  const correctedMiss=normalizeCombatBatch(f.world,[task],{results:[miss]})
  assert.deepEqual(correctedMiss.corrections[task.id],['unsupported_reaction_outcome_removed'])
  assert.equal((correctedMiss.batch as {results:Array<{outcome:string}>}).results[0].outcome,'MISSED')
  assert.equal(combatBatchIssue(f.world,[task],[fingerprint],correctedMiss.batch),null)
  const excessive={...headInjury,effects:[{function:'attention' as const,degree:.3,mechanism:'pain' as const,basis:'머리 부위의 통증 때문에 당장은 집중을 유지하기 어렵다.'}]}
  const wound={...miss,outcome:'HIT',injury:excessive}
  assert.equal(combatProposalIssue(f.world,task,wound),'pain_effect_disproportionate')
  const correctedWound=normalizeCombatBatch(f.world,[task],{results:[wound]})
  assert.deepEqual(correctedWound.corrections[task.id],['disproportionate_pain_effect_removed'])
  assert.deepEqual((correctedWound.batch as {results:Array<{injury:{effects:unknown[]}}>}).results[0].injury.effects,[])
  assert.equal(combatBatchIssue(f.world,[task],[fingerprint],correctedWound.batch),null)
  assert.equal(excessive.effects.length,1,'the model result remains unchanged for audit')
  const forged={...wound,reaction:'INVALID'}
  assert.equal(combatBatchIssue(f.world,[task],[fingerprint],normalizeCombatBatch(f.world,[task],{results:[forged]}).batch),'defender_choice_overridden')
 }finally{await f.close()}
})

test('combat wire results bind engine reactions by action ID and retain all injury and stale-state checks',async()=>{
 const f=traumaFixture();try{
  const first=f.attack(),second=f.attack(f.world.agents[2],f.world.agents[3]);f.tick(5)
  const tasks=[first,second],fingerprints=tasks.map(t=>combatFingerprint(f.world,t))
  const request=combatBatchRequest(f.world,tasks,'fixture')
  const schema=request.schema as typeof import('../server/world/traumaAdjudication.ts').COMBAT_BATCH_SCHEMA
  assert.equal(Object.hasOwn(schema.properties.results.items.properties,'reaction'),false)
  assert.equal(schema.properties.results.items.required.includes('reaction'),false)
  assert.equal(schema.properties.results.items.additionalProperties,false)
  const raw={results:[{actionId:second.id,outcome:'MISSED',injury:null,basis:'공격은 닿지 않았다.'},{actionId:first.id,outcome:'HIT',injury:headInjury,basis:'기존 방어 반응 아래 두피에 상처가 생겼다.'}]}
  const normalized=normalizeCombatBatch(f.world,tasks,raw)
  assert.equal(combatBatchIssue(f.world,tasks,fingerprints,normalized.batch),null)
  assert.equal(Object.hasOwn(raw.results[0],'reaction'),false)
  acceptCombatBatch(f.world,tasks,fingerprints,normalized.batch,'fixture')
  for(const t of tasks)assert.equal(t.adjudication!.proposal.reaction,t.adjudication!.reaction.kind)
  assert.deepEqual(first.adjudication!.proposal.injury,headInjury)
  tasks.forEach(t=>{delete t.adjudication})
  const bad=structuredClone(raw);bad.results[1].injury={...headInjury,severity:99}
  assert.equal(combatBatchIssue(f.world,tasks,fingerprints,normalizeCombatBatch(f.world,tasks,bad).batch),'severity_out_of_bounds')
  f.a.humanState!.fatigue=10
  assert.equal(combatBatchIssue(f.world,tasks,fingerprints,normalizeCombatBatch(f.world,tasks,raw).batch),'stale_combat_batch')
 }finally{await f.close()}
})

test('a wire response without reaction completes in one paid combat call without pausing',async()=>{
 let attempts=0
 const f=traumaFixture(async request=>{
  if(request.prompt.startsWith('You propose consequences')){
   attempts++
   const task=f.world.engine!.ongoingActions.find(t=>t.proposal.actionType==='ATTACK')!
   const reaction=combatContext(f.world,task).reaction.kind
   return {raw:{results:[{actionId:task.id,outcome:reaction==='DODGE'?'BLOCKED':'DODGED',injury:null,basis:'방어 뒤 공격은 닿지 않았다.'}]},inputTokens:100,outputTokens:20}
  }
  if(request.role==='judge')return {raw:{approved:true,reason:'test',ended:false},inputTokens:1,outputTokens:1}
  const id=JSON.parse(request.prompt.split('[YOUR STATE]')[1].trimStart().split('\n')[0]).id
  const actor=f.world.agents.find(a=>a.id===id)!
  return {raw:{actorId:actor.id,locationId:actor.publicState.locationId,targetIds:[],usedItemIds:[],actionType:'WAIT',intendedAction:'기다린다'},inputTokens:1,outputTokens:1}
 })
 try{
  f.attack();f.tick(5);await store.runWorldTick()
  assert.equal(attempts,1)
  assert.equal(store.getAdminRuntime().decisionsPaused,false)
  assert.equal(store.getAdminRuntime().retryCount,0)
  assert.equal(f.b.body!.injury,0)
  const event=store.listEvents({limit:100,offset:0}).items.find(e=>e.detail?.adjudication)!
  assert.equal(event.detail!.adjudication!.proposal.outcome,'MISSED')
  assert.equal(event.detail!.adjudication!.proposal.reaction,event.detail!.combat!.reaction.kind)
  assert.deepEqual(event.detail!.adjudication!.corrections,['unsupported_reaction_outcome_removed'])
 }finally{await f.close()}
})

test('one invalid live combat result gets one bounded correction without settling the first result',async()=>{
 let attempts=0
 const f=traumaFixture(async request=>{
  if(request.prompt.startsWith('You propose consequences')){
   attempts++
   const task=f.world.engine!.ongoingActions.find(t=>t.proposal.actionType==='ATTACK')!
   const reaction=attempts===1?'INVALID':combatContext(f.world,task).reaction.kind
   return {raw:{results:[{actionId:task.id,reaction,outcome:'MISSED',injury:null,basis:'현장 조건에 따라 공격은 닿지 않았다.'}]},inputTokens:100,outputTokens:20}
  }
  if(request.role==='judge')return {raw:{approved:true,reason:'test',ended:false},inputTokens:1,outputTokens:1}
  const id=JSON.parse(request.prompt.split('[YOUR STATE]')[1].trimStart().split('\n')[0]).id
  const actor=f.world.agents.find(a=>a.id===id)!
  return {raw:{actorId:actor.id,locationId:actor.publicState.locationId,targetIds:[],usedItemIds:[],actionType:'WAIT',intendedAction:'기다린다'},inputTokens:1,outputTokens:1}
 })
 try{
  f.attack();f.tick(5)
  const before=f.b.body!.injury
  await store.runWorldTick()
  assert.equal(attempts,2)
  assert.equal(f.b.body!.injury,before)
  assert.equal(store.getAdminRuntime().decisionsPaused,false)
  assert.equal(store.getAdminRuntime().retryCount,1)
  assert.equal(store.getAdminRuntime().failedJobs,0,'a corrected validation attempt is not a failed job')
  assert.ok(store.getAdminRuntime().recentErrors.some(e=>e.scope==='combat-validation'&&e.message==='defender_choice_overridden'))
 }finally{await f.close()}
})

test('two invalid live combat results pause with the precise reason and preserve the pending attack',async()=>{
 let attempts=0
 const f=traumaFixture(async request=>{
  if(!request.prompt.startsWith('You propose consequences'))throw new Error('unexpected paid decision')
  attempts++
  const task=f.world.engine!.ongoingActions.find(t=>t.proposal.actionType==='ATTACK')!
  return {raw:{results:[{actionId:task.id,reaction:'INVALID',outcome:'MISSED',injury:null,basis:'test'}]},inputTokens:100,outputTokens:20}
 })
 try{
  const task=f.attack();f.tick(5)
  await store.runWorldTick()
  assert.equal(attempts,2)
  assert.equal(f.b.body!.injury,0)
  assert.ok(f.world.engine!.ongoingActions.some(t=>t.id===task.id&&!t.adjudication))
  assert.equal(store.getAdminRuntime().decisionsPaused,true)
  assert.equal(store.getAdminRuntime().failedJobs,1,'the final paused adjudication counts once')
  assert.ok(store.getAdminRuntime().recentErrors.some(e=>e.scope==='combat-adjudication'&&e.message.includes('defender_choice_overridden')))
 }finally{await f.close()}
})

test('leg impairment slows real movement, vision changes attack likelihood, and injury creates treatment choices',async()=>{
 const f=traumaFixture();try{
  const destination=f.place.connectedPlaceIds[0],move={actorId:f.b.id,locationId:f.place.id,targetIds:[],actionType:'MOVE' as const,destinationId:destination,intendedAction:'위험에서 벗어난다'}
  beginAction(f.world,move);const normal=f.world.engine!.ongoingActions[0].completesMinute;f.world.engine!.ongoingActions=[]
  addInjury(f.b,{...headInjury,part:'LEG',site:'general',bleeding:0,effects:[{function:'mobility',degree:.6,mechanism:'structural'}]},'leg-event',0)
  beginAction(f.world,move);assert.ok(f.world.engine!.ongoingActions[0].completesMinute>normal);f.world.engine!.ongoingActions=[]
  const task=f.attack(f.b,f.a);const before=resolvePhysicalCombat(structuredClone(f.world),structuredClone(task),.1).detail.combat!.hitChance
  addInjury(f.b,headInjury,'head-event',0)
  const after=resolvePhysicalCombat(structuredClone(f.world),structuredClone(task),.1).detail.combat!.hitChance;assert.ok(after<before)
  f.place.resources.push({key:'medicine',label:'의약품',unit:'개',level:1,max:1,trend:'stable'})
  assert.ok(deliberation(f.world,f.b.id).choices.some(c=>c.goal==='TREAT_INJURY'))
  assert.equal(f.b.trauma!.functions.mobility,.6)
 }finally{await f.close()}
})

test('elapsed bleeding can kill, minor bleeding does not; treatment and recovery need time and survive DAY boundary',async()=>{
 for(const scenario of ['minor','severe','treated'] as const){const f=traumaFixture();try{
  const severity=scenario==='minor'?1:3
  addInjury(f.b,{...headInjury,severity,bleeding:severity,pain:severity*2,effects:[],healingHours:24},'source',0)
  if(scenario==='treated')treatInjuries(f.b,0)
  progressTrauma(f.world,1);assert.notEqual(f.b.publicState.status,'deceased')
  const events=progressTrauma(f.world,600)
  if(scenario==='severe'){assert.equal(f.b.publicState.status,'deceased');assert.ok(events.some(e=>e.cause==='injury_deterioration_death'&&e.relatedEventIds.includes('source')))}
  else{assert.notEqual(f.b.publicState.status,'deceased');assert.ok(f.b.trauma!.bloodLoss<.1);progressTrauma(f.world,1441);assert.ok(f.b.trauma!.injuries[0].healed)}
  assert.ok(events.every(e=>e.stateChanges.length>0)) // State history remains complete.
  if(scenario==='severe')assert.ok(events.some(e=>e.cause==='injury_deterioration_death'&&storyEvent(e)))
  else assert.ok(events.filter(e=>e.cause==='injury_progression').every(e=>!storyEvent(e)))
 }finally{await f.close()}}
})

test('API batch resolves simultaneous attacks in one call; failed calls pause without fabricated injury and resume can retry',async()=>{
 let batches=0,fail=true
 const f=traumaFixture(async req=>{
  if(req.prompt.startsWith('You propose consequences')){
   batches++;if(fail)throw new Error('simulated outage')
   const tasks=store.getWorldState().engine!.ongoingActions.filter(t=>['ATTACK','ROB'].includes(t.proposal.actionType))
   return {raw:{results:tasks.map(t=>({actionId:t.id,outcome:'MISSED',reaction:combatContext(store.getWorldState(),t).reaction.kind,injury:null,basis:'fixture miss'}))},inputTokens:1,outputTokens:1}
  }
  if(req.role==='judge')return{raw:{approved:true,reason:'test',ended:false},inputTokens:1,outputTokens:1}
  const id=JSON.parse(req.prompt.split('[YOUR STATE]')[1].trimStart().split('\n')[0]).id;const a=store.getWorldState().agents.find(a=>a.id===id)!
  return{raw:{actorId:a.id,locationId:a.publicState.locationId,targetIds:[],usedItemIds:[],actionType:'WAIT',intendedAction:'기다린다'},inputTokens:1,outputTokens:1}
 });try{
  f.attack();f.attack(f.world.agents[2],f.world.agents[3]);await store.runWorldTick()
  assert.equal(batches,1);assert.equal(store.getAdminRuntime().status,'PAUSED');assert.equal(f.b.trauma,undefined);assert.equal(f.b.body!.injury,0)
  assert.equal(f.world.engine!.ongoingActions.filter(t=>t.proposal.actionType==='ATTACK').length,2)
  const at=f.world.engine!.minute;fail=false;store.resumeSeason();store.stopSimulationTimerForTests();await store.runWorldTick()
  assert.equal(store.getAdminRuntime().status,'RUNNING');assert.equal(batches,2);assert.ok(f.world.engine!.minute>=at);assert.equal(f.b.body!.injury,0)
  assert.equal(store.listEvents({limit:100,offset:0}).items.filter(e=>e.detail?.adjudication).length,2)
 }finally{await f.close()}
})
