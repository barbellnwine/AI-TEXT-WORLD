import { test, after } from 'node:test'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { once } from 'node:events'
import { migrate } from '../server/db/connection.ts'
import * as store from '../server/domain/worldStore.ts'
import { createDraft, getDraft, updateBasicInfo, updateRuleSelection, replacePlacesAndConnections, createCharacter, DEFAULT_HUMAN_STATE, DEFAULT_EMOTION } from '../server/domain/worldDrafts.ts'
import { createRulePreset, setPresetRules, seedDefaultRulePreset, getRulePreset } from '../server/domain/rulePresets.ts'
import { startWorldFromDraft } from '../server/domain/worldLaunch.ts'
import { beginAction, advanceEngine, selectDecisionAgents, validateEngineAction, recordExperience } from '../server/world/worldEngine.ts'
import { buildAgentKnowledgeView } from '../server/world/knowledgeFilter.ts'
import { validateDraftForStart } from '../server/world/builderValidation.ts'
import { applyStateChange } from '../server/world/stateTransition.ts'
import type { ProposedAction } from '../server/world/actionSchema.ts'
import { generateCharacters } from '../server/domain/characterGen.ts'
import { config } from '../server/config.ts'
import { parseProposedAction, worldModelAdapter, ACTION_SCHEMA, agentRequest, judgeRequest, worldRequestBody, type WorldModelAdapter } from '../server/domain/worldAgent.ts'
import { MAX_PROVIDER_REQUEST_BYTES } from '../server/providers/requestBody.ts'
import { toPublicWorld } from '../server/world/publicView.ts'
import { behaviorContext } from '../server/world/behaviorPolicy.ts'
import { eventProse } from '../server/domain/eventProse.ts'
import { meaningfulChanges } from '../server/world/stateThresholds.ts'
import { composeDay, storyEvent, validateEditorialPlan } from '../server/domain/storyComposition.ts'
import { prepareDecision } from '../server/world/decisionController.ts'
import { Router } from '../server/http.ts'
import { registerAuthRoutes } from '../server/api/authRoutes.ts'
import { registerWorldAdminRoutes } from '../server/api/worldAdminRoutes.ts'
import { registerWorldBuilderRoutes } from '../server/api/worldBuilderRoutes.ts'
import { registerWorldRoutes } from '../server/api/worldRoutes.ts'
import { createUser } from '../server/auth/users.ts'
import { hashPassword } from '../server/auth/password.ts'
import { getMonthlyLedger, setSetting } from '../server/domain/budget.ts'

after(() => store.stopSimulationTimerForTests())

test('same-instant living counterattack resolves instead of being cancelled by array order',async()=>{
 const ctx=setup(undefined,false)
 try{
  const world=store.getWorldState(),[a,b]=world.agents
  for(const p of [a,b]){p.body={health:1,injury:1};p.humanState!.fatigue=1;p.publicState.localArea='CENTER'}
  for(const [actor,target] of [[a,b],[b,a]])beginAction(world,{actorId:actor.id,locationId:actor.publicState.locationId,actionType:'ATTACK',targetIds:[target.id],intendedAction:'counterstrike'})
  const events=advanceEngine(world,5)
  assert.equal(events.filter(e=>e.actionType==='ATTACK'&&e.phase==='COMPLETED').length,2)
  assert.equal(events.filter(e=>e.phase==='CANCELLED').length,0)
  assert.ok(a.body!.injury>1&&b.body!.injury>1)
 }finally{await ctx.close()}
})

test('an already-selected eating target gets an independent reaction slot and cannot ignore the visible threat',async()=>{
 let agentCalls=0
 const ctx=setup(async request=>{
  if(request.role==='judge')return{raw:{approved:true,reason:'fixture',ended:false},inputTokens:1,outputTokens:1}
  agentCalls++;const [a,b]=store.getWorldState().agents
  const actor=agentCalls===2?b:a
  const chosen=prepareDecision(store.getWorldState(),actor.id,[]).choices.find(c=>c.action.actionType===(agentCalls===2?'ATTACK':agentCalls===1?'EAT':'OBSERVE'))!
  assert.ok(chosen,`missing V2 candidate for call ${agentCalls}`)
  return{raw:{...chosen.action,targetIds:chosen.action.targetIds,usedItemIds:chosen.action.usedItemIds??[],candidateId:chosen.id,publicAction:chosen.action.intendedAction},inputTokens:1,outputTokens:1}
 })
 try{
  const world=store.getWorldState(),[a,b]=world.agents;store.setMaxActiveAgents(2)
  world.places[0].resources.push({key:'food',label:'food',level:5,max:5,trend:'stable'})
  b.relationships.push({agentId:b.id,otherAgentId:a.id,stance:'hostile',hostility:8})
  a.humanState!.survival_need=8;a.nextDecisionAt=b.nextDecisionAt=0
  await store.runWorldTick()
  assert.equal(agentCalls,3)
  const response=world.engine!.ongoingActions.find(t=>t.proposal.actorId===a.id)!
  assert.ok(response);assert.ok(!['EAT','DRINK','SLEEP','REST'].includes(response.proposal.actionType))
  const interruption=store.listEvents({offset:0,limit:100}).items.find(e=>e.cause==='visible_attack_interrupt')!
  assert.ok(interruption);assert.doesNotMatch(interruption.actionResult!,/공격해 부상/)
 }finally{await ctx.close()}
})
test('same tick collects both agent intents before either start mutates WORLD STATE',async()=>{
 let agentCalls=0
 const observedOngoing:number[]=[]
 const ctx=setup(async request=>{
   if(request.role==='judge')return {raw:{approved:true,reason:'fixture',ended:false},inputTokens:1,outputTokens:1}
   const world=store.getWorldState(), actor=selectDecisionAgents(world,2)[agentCalls++]
   observedOngoing.push(world.engine!.ongoingActions.length)
   const chosen=prepareDecision(world,actor.id,[]).choices.find(c=>c.action.actionType==='WAIT')!
   return {raw:{...chosen.action,targetIds:[],usedItemIds:[],candidateId:chosen.id,publicAction:chosen.action.intendedAction},inputTokens:1,outputTokens:1}
 })
 try{
   store.setMaxActiveAgents(2)
   for(const actor of store.getWorldState().agents)actor.nextDecisionAt=0
   await store.runWorldTick()
   assert.deepEqual(observedOngoing,[0,0])
   assert.equal(store.getWorldState().engine!.ongoingActions.length,2)
 }finally{await ctx.close()}
})

test('same-tick competition for one water unit starts only one claim and preserves stock until completion',async()=>{
 let calls=0
 const ctx=setup(async request=>{
   if(request.role==='judge')return {raw:{approved:true,reason:'fixture',ended:false},inputTokens:1,outputTokens:1}
   const world=store.getWorldState(),actor=selectDecisionAgents(world,2)[calls++]
   const chosen=prepareDecision(world,actor.id,[]).choices.find(c=>c.action.actionType==='DRINK')!
   assert.ok(chosen)
   return {raw:{...chosen.action,targetIds:[],usedItemIds:[],candidateId:chosen.id,publicAction:chosen.action.intendedAction},inputTokens:1,outputTokens:1}
 })
 try{
   const world=store.getWorldState();store.setMaxActiveAgents(2)
   world.places[0].resources.push({key:'water',label:'water',level:1,max:1,trend:'stable'})
   for(const actor of world.agents){actor.nextDecisionAt=0;actor.humanState!.survival_need=8}
   await store.runWorldTick()
   assert.equal(calls,2)
   assert.equal(world.engine!.ongoingActions.filter(t=>t.proposal.actionType==='DRINK').length,1)
   assert.equal(world.places[0].resources.find(r=>r.key==='water')!.level,1)
   assert.equal(store.diagnosticSnapshot().events.filter(e=>e.actionType==='DRINK'&&e.outcome==='REJECTED').length,1)
 }finally{await ctx.close()}
})

test('two attacks selected from one snapshot are simultaneous, not fabricated counterattacks',async()=>{
 let calls=0
 const ctx=setup(async request=>{
   if(request.role==='judge')return {raw:{approved:true,reason:'fixture',ended:false},inputTokens:1,outputTokens:1}
   const world=store.getWorldState(),actor=selectDecisionAgents(world,2)[calls++]
   const chosen=prepareDecision(world,actor.id,[]).choices.find(c=>c.action.actionType==='ATTACK')!
   assert.ok(chosen)
   return {raw:{...chosen.action,targetIds:chosen.action.targetIds,usedItemIds:chosen.action.usedItemIds??[],candidateId:chosen.id,publicAction:chosen.action.intendedAction},inputTokens:1,outputTokens:1}
 })
 try{
   const world=store.getWorldState(),[a,b]=world.agents
   for(const [actor,target] of [[a,b],[b,a]]){
     actor.relationships.push({agentId:actor.id,otherAgentId:target.id,stance:'hostile',hostility:8})
     actor.nextDecisionAt=0
   }
   store.setMaxActiveAgents(2)
   await store.runWorldTick()
   assert.equal(calls,2)
   const attacks=world.engine!.ongoingActions.filter(t=>t.proposal.actionType==='ATTACK')
   assert.equal(attacks.length,2)
   assert.ok(attacks.every(t=>!t.responseToActionId))
 }finally{await ctx.close()}
})

test('editorial DAY correction preserves the previous text and all simulation facts',async()=>{
 const ctx=setup(undefined,false)
 try{
  const world=store.getWorldState(),[a,b]=world.agents
  beginAction(world,{actorId:a.id,locationId:a.publicState.locationId,actionType:'SPEAK',targetIds:[b.id],spokenText:'The recorded notice arrived.',intendedAction:'speak'})
  store.advanceWorldTick(3)
  const events=store.listEvents({offset:0,limit:100}).items.filter(storyEvent),raw={paragraphs:[{text:'The recorded notice arrived.',eventIds:events.map(e=>e.id)}]},id=store.getSeason().id
  assert.throws(()=>store.correctDayNarration(1,id,raw,'test review'),/pause_world/)
  store.pauseSeason()
  const before=JSON.stringify(store.getWorldState()),prior=store.listDayStories()[0].body
  assert.throws(()=>store.correctDayNarration(1,'old-season',raw,'test review'),/season_changed/)
  store.correctDayNarration(1,id,raw,'Source checked')
  assert.equal(JSON.stringify(store.getWorldState()),before)
  assert.ok(store.listDayStories()[0].corrections?.some(c=>c.previousBody===prior&&c.reason.includes('Source checked')))
 }finally{await ctx.close()}
})

test('reviewed literary DAY prose is cached without changing engine facts or inventing dialogue',async()=>{
 let reviews=0
 const ctx=setup(async request=>{
  if(request.prompt.startsWith('Check every factual assertion')){reviews++;return{raw:{approved:true,unsupportedClaims:[]},inputTokens:1,outputTokens:1}}
  const sources=JSON.parse(request.prompt.split('[NEW_EVENTS — CONFIRMED EVENTS]')[1].trimStart().split('\n')[0])
  return{raw:{paragraphs:sources.map(e=>({text:e.result+(e.publicQuote??''),eventIds:[e.id]}))},inputTokens:1,outputTokens:1}
 },true,false,'',true)
 try{
  const world=store.getWorldState(),[a,b]=world.agents
  for(let i=0;i<3;i++){
   beginAction(world,{actorId:a.id,locationId:a.publicState.locationId,actionType:'SPEAK',targetIds:[b.id],spokenText:`recorded ${i}`,intendedAction:'speak'})
   store.advanceWorldTick(3)
  }
  const before=JSON.stringify(world),calls=store.getAdminRuntime().callsUsed
  await store.refreshDayNarration(world.clock.day,true)
  assert.equal(reviews,1);assert.equal(JSON.stringify(world),before)
  const chapter=store.listDayStories()[0];assert.ok(chapter.body.includes('말을 건넸다'))
  assert.equal(store.getAdminRuntime().callsUsed,calls)
  await store.shutdownWorldRuntime();store.initializeWorldRuntime(ctx.db)
  assert.equal(store.listDayStories()[0].body,chapter.body)
 }finally{await ctx.close()}
})

test('rejected DAY drafts get one evidence correction attempt and never publish rejected text',async()=>{
 let writers=0,reviews=0
 const ctx=setup(async request=>{
  if(request.prompt.startsWith('Check every factual assertion')){reviews++;return{raw:{approved:false,unsupportedClaims:['unsupported outcome']},inputTokens:1,outputTokens:1}}
  writers++
  if(writers===2)assert.match(request.prompt,/FACTUAL CORRECTIONS REQUIRED[\s\S]*unsupported outcome/)
  const sources=JSON.parse(request.prompt.split('[NEW_EVENTS — CONFIRMED EVENTS]')[1].trimStart().split('\n')[0])
  return{raw:{paragraphs:sources.map(e=>({text:e.result+' REJECTED_DRAFT',eventIds:[e.id]}))},inputTokens:1,outputTokens:1}
 },true,false,'',true)
 try{
  const world=store.getWorldState(),[a,b]=world.agents
  for(const [actor,target,i] of [[a,b,0],[b,a,1]] as const){beginAction(world,{actorId:actor.id,locationId:actor.publicState.locationId,actionType:'SPEAK',targetIds:[target.id],spokenText:`Recorded notice ${i}`,intendedAction:'speak'});store.advanceWorldTick(3)}
  beginAction(world,{actorId:a.id,locationId:a.publicState.locationId,actionType:'MOVE',targetIds:[],destinationId:ctx.places[1].id,intendedAction:'move'});store.advanceWorldTick(60)
  await store.refreshDayNarration(1,true)
  await store.shutdownWorldRuntime()
  assert.ok(writers>=2);assert.ok(reviews>=1)
  assert.ok(store.listDayStories().every(day=>!day.body.includes('REJECTED_DRAFT')))
 }finally{await ctx.close()}
})

test('administrative notices remain auditable but never become a DAY chapter',async()=>{
 let writers=0
 const ctx=setup(async request=>{
  assert.ok(Buffer.byteLength(worldRequestBody(request))<=20000)
  if(request.prompt.startsWith('Check every factual assertion'))return{raw:{approved:true,unsupportedClaims:[]},inputTokens:1,outputTokens:1}
  writers++
  const sources=JSON.parse(request.prompt.split('[NEW_EVENTS — CONFIRMED EVENTS]')[1].trimStart().split('\n')[0])
  return{raw:{paragraphs:sources.map(e=>({text:e.result,eventIds:[e.id]}))},inputTokens:1,outputTokens:1}
 },true,false,'',true)
 try{
  for(let i=0;i<12;i++)store.addOperatorEvent({type:'SYSTEM',placeId:ctx.places[0].id,agentIds:[],title:`Recorded notice ${i}`,summary:`${i}: `+'실제 기록으로 제공된 공지 내용이다. '.repeat(65),addedBy:'test'})
  await store.refreshDayNarration(1,true)
  assert.equal(writers,0)
  assert.equal(store.listDayStories().length,0)
 }finally{await ctx.close()}
})

test('an ungrounded Planner source is rejected without calling the judge', async()=>{
  const ctx=setup(async request=>{
    const actor=store.getWorldState().agents[0]
    if(request.role==='agent')return {raw:{goal:'reshape material',purpose:'prepare',method:'alter a visible object',targetId:null,placeId:actor.publicState.locationId,objectIds:['absent'],desiredOutcome:'usable object',longerTermPlan:null},inputTokens:1,outputTokens:1}
    assert.equal(request.role,'planner','invalid source must not spend a judge call')
    return {raw:{steps:[{actorId:actor.id,locationId:actor.publicState.locationId,targetIds:[],usedItemIds:[],actionType:'INTERACT',intendedAction:'reshape',interaction:{operation:'alter',sourceObjectIds:['absent'],resultName:'result',resultForm:'new form',materials:['wood'],quantity:1}}]},inputTokens:1,outputTokens:1}
  })
  try{
    await store.runWorldTick()
    assert.equal(store.getAdminRuntime().status,'RUNNING')
    assert.equal(store.getAdminRuntime().decisionsPaused,false)
    assert.equal(store.getWorldState().engine!.ongoingActions.length,0)
    assert.ok(store.listActionAudit().some(e=>e.outcome==='REJECTED'&&e.engineVerdict?.includes('object:not_perceived')))
    assert.equal(store.getAdminRuntime().pipeline?.groundingFailures,1)
  }finally{await ctx.close()}
})

test('runtime executes a Planner step and persists its Brain goal through completion', async () => {
  const ctx = setup(async request => {
    if (request.role === 'judge') return { raw: { approved: true, reason: 'fixture rule approval', ended: false }, inputTokens: 1, outputTokens: 1 }
    const actor=store.getWorldState().agents[0]
    if(request.role==='agent')return {raw:{goal:'WAIT_FOR_CHANGE',purpose:'watch for change',method:'wait briefly',targetId:null,placeId:actor.publicState.locationId,objectIds:[],desiredOutcome:'time passes',longerTermPlan:null},inputTokens:1,outputTokens:1}
    return {raw:{steps:[{actorId:actor.id,locationId:actor.publicState.locationId,targetIds:[],usedItemIds:[],actionType:'WAIT',intendedAction:'wait briefly'}]},inputTokens:1,outputTokens:1}
  })
  try {
    const world = store.getWorldState(), actor = world.agents[0]
    await store.runWorldTick()
    const chosen = world.engine!.ongoingActions.find(a => a.proposal.actorId === actor.id)!
    assert.equal(chosen.proposal.actionType, 'WAIT')
    assert.equal(chosen.proposal.goalKey, 'WAIT_FOR_CHANGE')
    assert.ok(world.engine!.decisions![actor.id].evaluation!.length)
    assert.equal(actor.v2?.freePlan?.brain.goal,'WAIT_FOR_CHANGE')
    store.advanceWorldTick(20)
    assert.equal(actor.v2?.currentAction?.status, 'completed')
    assert.ok(actor.v2?.goalStartedAt !== null)
    assert.ok(actor.motivations!.goals.some(g => g.goal === 'WAIT_FOR_CHANGE' && g.evidenceEventIds.length))
    store.initializeWorldRuntime(ctx.db)
    assert.deepEqual(store.getWorldState().agents[0].motivations, JSON.parse(JSON.stringify(actor.motivations)))
    assert.equal(store.getWorldState().agents[0].v2?.currentAction?.status, 'completed')
  } finally { await ctx.close() }
})

test('visible attack gives the target one independent bounded response before time advances',async()=>{
 let calls=0
 const ctx=setup(async request=>{
   calls++
   if(request.role==='judge')return{raw:{approved:true,reason:'test permits',ended:false},inputTokens:1,outputTokens:1}
   const world=store.getWorldState(),[a,b]=world.agents
   const defense=request.prompt.includes('visible_attack_attempt')
   const actor=defense?b:a
   if(defense){const minute=world.engine!.minute;store.advanceWorldTick(30);assert.equal(world.engine!.minute,minute);assert.match(request.prompt,/threats/)}
   const chosen=prepareDecision(world,actor.id,[]).choices.find(c=>c.action.actionType===(defense?'OBSERVE':'ATTACK'))!
   assert.ok(chosen)
   return{raw:{...chosen.action,targetIds:chosen.action.targetIds,usedItemIds:chosen.action.usedItemIds??[],candidateId:chosen.id,publicAction:chosen.action.intendedAction},inputTokens:1,outputTokens:1}
 })
 try{
   const world=store.getWorldState(),[a,b]=world.agents
   a.relationships.push({agentId:a.id,otherAgentId:b.id,stance:'hostile',hostility:8})
   a.nextDecisionAt=0;b.nextDecisionAt=1000
   await store.runWorldTick()
   assert.equal(calls,4);assert.equal(world.engine!.ongoingActions.length,2)
   assert.ok(world.engine!.ongoingActions.some(t=>t.proposal.actorId===b.id&&t.proposal.actionType==='OBSERVE'))
 }finally{await ctx.close()}
})

test('accepted exchange cancels if an offered item disappears before completion',async()=>{
 const ctx=setup(undefined,false)
 try{
   const world=store.getWorldState(),[a,b]=world.agents
   beginAction(world,{actorId:a.id,actionType:'SPEAK',locationId:a.publicState.locationId,targetIds:[b.id],intendedAction:'offer',spokenText:'take it?',offerItemId:'key'});advanceEngine(world,3)
   const reply:ProposedAction={actorId:b.id,actionType:'SPEAK',locationId:b.publicState.locationId,targetIds:[a.id],intendedAction:'accept',spokenText:'yes',replyTo:world.engine!.interactions![0].id,response:'ACCEPT'}
   assert.ok(validateEngineAction(reply,world,[]).approved);beginAction(world,reply)
   world.engine!.objects[0].quantity=0;world.engine!.objects[0].condition='destroyed'
   const events=advanceEngine(world,3)
   assert.equal(events[0].phase,'FAILED');assert.ok(!b.inventory.includes('key'));assert.equal(world.engine!.interactions![0].status,'pending')
 }finally{await ctx.close()}
})

test('independent contact replies, refusal and consent-based exchange recheck actual ownership', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [a,b] = world.agents
    a.humanState!.fatigue = b.humanState!.fatigue = 9
    const proposal: ProposedAction = { actorId: a.id, locationId: a.publicState.locationId, actionType: 'SPEAK', intent: 'NEGOTIATE', targetIds: [b.id], intendedAction: 'offer key', spokenText: '열쇠가 필요해?', offerItemId: 'key' }
    assert.equal(validateEngineAction(proposal, world, []).approved, true, 'fatigue must not ban conversation')
    b.publicState.localArea = 'FOREST'
    assert.equal(validateEngineAction(proposal, world, []).approved, false)
    b.publicState.localArea = 'CENTER'
    beginAction(world, proposal)
    advanceEngine(world, 3, [], e => recordExperience(world,e))
    const offer = world.engine!.interactions![0]
    assert.equal(offer.status, 'pending'); assert.ok(a.inventory.includes('key')); assert.ok(!b.inventory.includes('key'))
    const reply: ProposedAction = { actorId: b.id, locationId: b.publicState.locationId, actionType: 'SPEAK', targetIds: [a.id], intendedAction: 'refuse', spokenText: '지금은 필요 없어.', replyTo: offer.id, response: 'REFUSE' }
    assert.equal(validateEngineAction({ ...reply, actorId:a.id, targetIds:[b.id] },world,[]).approved,false)
    assert.equal(validateEngineAction(reply,world,[]).approved,true)
    beginAction(world,reply); const refusal = advanceEngine(world,3,[],e=>recordExperience(world,e))[0]
    assert.equal(offer.status,'refused'); assert.ok(a.inventory.includes('key')); assert.ok(refusal.relatedEventIds.includes(offer.sourceEventId!))
    assert.ok(b.memories?.some(m=>m.sourceEventIds.includes(refusal.id)))
    // A distinct gift offer may be accepted by the recipient, never by the proposer.
    beginAction(world,{...proposal,intent:'REQUEST_HELP'}); advanceEngine(world,3)
    const next = world.engine!.interactions!.at(-1)!
    const accept = {...reply,replyTo:next.id,response:'ACCEPT' as const,spokenText:'받을게.'}
    beginAction(world,accept); advanceEngine(world,3)
    assert.ok(b.inventory.includes('key')); assert.ok(!a.inventory.includes('key'))
    assert.equal(validateEngineAction(accept,world,[]).approved,false,'same consent cannot execute twice')
    assert.equal(toPublicWorld(world).engine!.interactions,undefined)
    assert.equal(toPublicWorld(world).engine!.outcomes,undefined)
  } finally { await ctx.close() }
})

test('failures persist as actor-specific outcomes; scarcity offers different priorities and known contacts', async () => {
  const ctx = setup(undefined,false)
  try {
    const world = store.getWorldState(), [a,b] = world.agents
    a.humanState!.fatigue=9; a.humanState!.survival_need=1; a.emotion!.fear=0
    b.humanState!.fatigue=1; b.humanState!.survival_need=9; b.emotion!.fear=1
    assert.notEqual(prepareDecision(world,a.id,[]).choices[0].goal,prepareDecision(world,b.id,[]).choices[0].goal)
    assert.ok(prepareDecision(world,b.id,[]).choices.some(c=>c.action.targetIds.includes(a.id)))
    beginAction(world,{actorId:b.id,locationId:b.publicState.locationId,actionType:'EXPLORE',intent:'SEARCH_FOOD',areaHint:'FOREST',targetIds:[],intendedAction:'look for food'})
    const events=advanceEngine(world,30,[],e=>recordExperience(world,e))
    assert.ok(world.engine!.outcomes![b.id].some(o=>o.failed && o.area==='FOREST'))
    const restored=JSON.parse(JSON.stringify(world))
    assert.ok(behaviorContext(restored,b.id).deliberation.failedAreas.some(o=>o.area==='FOREST'))
    assert.ok(b.memories?.some(m=>events.some(e=>m.sourceEventIds.includes(e.id))))
    assert.equal(buildAgentKnowledgeView(b.id,world,events)!.othersPresent.length,0)
    assert.ok(!JSON.stringify(behaviorContext(world,a.id).outcomes).includes(events[0].id))
  } finally { await ctx.close() }
})

test('DAY composition filters state-only ticks and connects real invitation, refusal and choices', async () => {
  const ctx=setup(undefined,false)
  try {
    const world=store.getWorldState(), [a,b]=world.agents
    a.name='도영동'; b.name='김기업'
    const places=new Map(world.places.map(p=>[p.id,p])), agents=new Map(world.agents.map(a=>[a.id,a]))
    const quiet=Array.from({length:10},(_,i)=>({ id:`wet-${i}`,type:'SYSTEM' as const,day:1,occurredAt:new Date().toISOString(),placeId:world.places[0].id,agentIds:[a.id],title:'wet',summary:'wet',stateChanges:[{field:`agent:${i}:wetness`,from:'5',to:'7'}],importance:'low' as const,relatedEventIds:[],phase:'STATE_UPDATE' as const }))
    assert.ok(quiet.every(e=>!storyEvent(e)))
    assert.equal(composeDay(1,world.seasonId,quiet,places,agents,false),null)
    const events: import('../server/domain/worldTypes.ts').WorldEvent[]=[]
    const act=(action:ProposedAction,minutes=3)=>{assert.equal(validateEngineAction(action,world,events).approved,true);beginAction(world,action);advanceEngine(world,minutes,events,e=>{events.push(e);recordExperience(world,e)})}
    act({actorId:a.id,locationId:a.publicState.locationId,actionType:'SPEAK',intent:'REQUEST_HELP',targetIds:[b.id],spokenText:'열쇠를 줄 테니 받아 줄래?',offerItemId:'key',intendedAction:'offer',publicAction:'도영동은 김기업에게 열쇠를 내밀었다.',publicReason:'혼자 들고 있기보다 필요한 사람에게 건네고 싶었다.'})
    act({actorId:b.id,locationId:b.publicState.locationId,actionType:'SPEAK',targetIds:[a.id],spokenText:'지금은 필요 없어.',replyTo:world.engine!.interactions![0].id,response:'REFUSE',intendedAction:'refuse',publicAction:'김기업은 제안을 거절하려 했다.',publicReason:'지금은 열쇠를 사용할 계획이 없었다.'})
    const short=composeDay(1,world.seasonId,events,places,agents,false)!
    act({actorId:a.id,locationId:a.publicState.locationId,actionType:'EXPLORE',intent:'SEARCH_FOOD',areaHint:'FOREST',targetIds:[],intendedAction:'search',publicAction:'도영동은 숲을 살펴보려 했다.',publicReason:'주변에서 이용할 수 있는 식량을 직접 확인하고 싶었다.'},30)
    const day=composeDay(1,world.seasonId,[...quiet,...events],places,agents,true)!
    assert.ok(day.body.length>short.body.length); assert.match(day.body,/지금은 필요 없어/)
    assert.ok(day.sourceEventIds.every(id=>events.some(e=>e.id===id))); assert.ok(!day.body.includes('wet'))
    const sources=events.filter(storyEvent)
    assert.ok(validateEditorialPlan({paragraphs:sources.map(e=>[e.id])},sources))
    assert.equal(validateEditorialPlan({title:'승리',body:'모두 죽었다',sourceEventIds:sources.map(e=>e.id)},sources),null)
    assert.equal(validateEditorialPlan({paragraphs:[['invented']]},sources),null)
    assert.equal(validateEditorialPlan({paragraphs:[[sources[0].id,sources[0].id]]},sources),null)
    if (process.env.WORLD_EXPORT_EXAMPLE === '1') writeFileSync('docs/world-story-test-example.md', `# 오프라인 엔진 테스트에서 생성한 예시\n\n운영 세계의 사건이 아닙니다. 테스트가 열쇠를 가진 도영동과 김기업을 생성하고, 제안 → 독립적인 거절 → 숲 탐색을 엔진에 실행시킨 결과입니다. 발견·싸움·사망을 추가하지 않았습니다.\n\n## 짧은 LIVE의 근거\n\n${sources.slice(0,2).map(e => `${eventProse(e,agents)}\n\n${e.publicQuote ? `“${e.publicQuote}”` : ''}`).join('\n\n')}\n\n## DAY 구성 결과\n\n${day.body}\n\n## 원본 테스트 사건\n\n\`\`\`json\n${JSON.stringify(sources.map(e => ({ id:e.id, relatedEventIds:e.relatedEventIds, time:e.worldTime, type:e.type, summary:e.summary, quote:e.publicQuote, changes:e.stateChanges })),null,2)}\n\`\`\`\n`, 'utf8')
  } finally { await ctx.close() }
})

test('an offered item may be stolen only under engine-checked contact and opportunity',async()=>{
  const ctx=setup(undefined,false)
  try {
    const world=store.getWorldState(),[a,b]=world.agents
    const steal:ProposedAction={actorId:b.id,actionType:'STEAL',targetIds:[a.id],locationId:b.publicState.locationId,intendedAction:'steal key',usedItemIds:['key']}
    assert.equal(validateEngineAction(steal,world,[]).approved,false,'hidden inventory cannot be targeted')
    beginAction(world,{actorId:a.id,actionType:'SPEAK',targetIds:[b.id],locationId:a.publicState.locationId,intendedAction:'offer',spokenText:'key?',offerItemId:'key'});advanceEngine(world,3)
    beginAction(world,{actorId:a.id,actionType:'OBSERVE',targetIds:[],locationId:a.publicState.locationId,intendedAction:'guard'})
    assert.equal(validateEngineAction(steal,world,[]).approved,true)
    beginAction(world,steal);advanceEngine(world,5)
    assert.ok(a.inventory.includes('key'));assert.ok(!b.inventory.includes('key'))
    world.engine!.ongoingActions=[]
    beginAction(world,{actorId:a.id,actionType:'SLEEP',targetIds:[],locationId:a.publicState.locationId,intendedAction:'sleep'})
    b.humanState!.fatigue=0
    beginAction(world,steal);const stolen=advanceEngine(world,5,[],e=>recordExperience(world,e))
    assert.ok(b.inventory.includes('key'))
    assert.ok(!buildAgentKnowledgeView(a.id,world,stolen)!.observedEvents.some(e=>e.actionType==='STEAL'),'sleeping victim must not know the thief identity')
  }finally{await ctx.close()}
})

function setup(adapter?: WorldModelAdapter, live = true, privateWorld = false, endCondition = '', enableNarrator = false) {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  store.initializeWorldRuntime(db, adapter, enableNarrator)
  config.worldDemoMode = !live
  const draft = createDraft(db, 'Runtime test')
  updateBasicInfo(db, draft.id, { name: 'Runtime test', intro: 'An island', genre: 'survival', background: 'KNOWN_BACKGROUND', seasonName: 'Test', maxDays: 2, simSpeedMs: 3600000, targetPopulation: 2, isPublic: true })
  const preset = createRulePreset(db, { name: 'Test rules' })
  setPresetRules(db, preset.id, [{ category: 'CUSTOM', title: 'ORIGINAL_RULE', description: 'No attacks.', enabled: true, priority: 1 }])
  updateRuleSelection(db, draft.id, preset.id)
  const places = replacePlacesAndConnections(db, draft.id, ['A', 'B'].map(id => ({ tempId: id, name: id, description: '', type: 'GENERIC', x: 0, y: 0, isPublic: true, isDiscovered: true, capacity: 3, resources: [], items: [], facilityStatus: '' })), [{ fromPlaceRef: 'A', toPlaceRef: 'B', travelTime: 15, connectionType: 'PATH', blocked: false, requirements: '' }])!.places
  for (const name of ['Alice', 'Bob']) createCharacter(db, draft.id, {
    name, age: 30, gender: '', appearance: '', background: '', occupation: 'engineer', personality: `${name}_PERSONALITY`, goal: 'Explore', strengths: [], weaknesses: [], provider: 'openai', model: '',
    humanState: DEFAULT_HUMAN_STATE, emotion: DEFAULT_EMOTION, knowledge: [], privateInfo: `${name}_PRIVATE_SECRET`, inventory: name === 'Alice' ? ['key'] : [], initialPlaceId: places[0].id,
  }, 'MANUAL')
  const design = getDraft(db, draft.id)!
  design.hiddenWorldTruth = 'HIDDEN_WORLD_SECRET'
  design.isPublic = !privateWorld
  design.endCondition = endCondition
  assert.equal(startWorldFromDraft(db, design).ok, true)
  store.setMaxActiveAgents(1)
  store.setCallBudget(20)
  store.stopSimulationTimerForTests()
  return { db, design, places, preset, async close() { await store.shutdownWorldRuntime(); db.close() } }
}

function moveAction() {
  const world = store.getWorldState(), actor = world.agents[0]
  return { actorId: actor.id, locationId: actor.publicState.locationId, actionType: 'MOVE', targetIds: [], usedItemIds: [], destinationId: world.places.find(p => p.id !== actor.publicState.locationId)!.id, intendedAction: 'move', spokenText: null, claimedKnowledgeId: null }
}

test('semantic cooldown survives serialization, ignores wording and expires at six world hours', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [a, b] = world.agents
    a.humanState!.survival_need = 1; a.humanState!.fatigue = 1
    const action: ProposedAction = { actorId: a.id, actionType: 'SPEAK', intent: 'SOCIAL', targetIds: [b.id], locationId: a.publicState.locationId, intendedAction: 'first wording', spokenText: 'hello' }
    assert.equal(validateEngineAction(action, world, []).approved, true)
    beginAction(world, action); advanceEngine(world, 3)
    const restored = JSON.parse(JSON.stringify(world))
    const changed = { ...action, intendedAction: 'entirely different wording' }
    assert.ok(validateEngineAction(changed, restored, []).notes.includes('semantic_action_cooldown_6h'))
    assert.equal(validateEngineAction({ ...changed, intent: 'OTHER' }, restored, []).approved, true, 'a genuinely different intent has a different semantic key')
    restored.engine.minute = world.agents[0].v2!.recentActions[0].minute + 359
    assert.equal(validateEngineAction(changed, restored, []).approved, false)
    restored.engine.minute++
    assert.equal(validateEngineAction(changed, restored, []).approved, true)
    assert.equal(toPublicWorld(world).engine!.behavior, undefined)
  } finally { await ctx.close() }
})

test('cooperation creates proposed tasks, blocks concurrent proposals and executes real supplies without forced consent', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [a, b] = world.agents
    for (const actor of world.agents) { actor.humanState!.survival_need = 1; actor.humanState!.fatigue = 1 }
    const action: ProposedAction = { actorId: a.id, actionType: 'SPEAK', intent: 'PROPOSE_SURVIVAL_PLAN', targetIds: [b.id], locationId: a.publicState.locationId, intendedAction: 'make a plan', spokenText: 'let us cooperate' }
    beginAction(world, action)
    assert.ok(validateEngineAction({ ...action, actorId: b.id, targetIds: [a.id] }, world, []).notes.includes('survival_plan_already_active'))
    advanceEngine(world, 3)
    const plan = world.engine!.behavior!.plans[0]
    assert.equal(plan.status, 'proposed'); assert.equal(plan.tasks.length, 2)
    assert.equal(plan.tasks.find(t => t.actorId === a.id)!.status, 'suggested')
    assert.equal(plan.tasks.find(t => t.actorId === b.id)!.status, 'invited')
    assert.equal(behaviorContext(world, b.id).plans[0].tasks.length, 1)
    assert.ok(validateEngineAction(action, world, []).notes.includes('survival_plan_already_active'))
    const invitation = world.engine!.interactions!.find(i => i.actorId === a.id && i.targetId === b.id)!
    const acceptance: ProposedAction = { actorId: b.id, actionType: 'SPEAK', targetIds: [a.id], locationId: b.publicState.locationId,
      intendedAction: 'accept plan', spokenText: 'I agree', replyTo: invitation.id, response: 'ACCEPT' }
    const validAcceptance = validateEngineAction(acceptance, world, [])
    assert.ok(validAcceptance.approved, validAcceptance.notes.join(','))
    beginAction(world, acceptance)
    advanceEngine(world, 3)
    assert.equal(world.engine!.behavior!.plans[0].tasks.find(t => t.actorId === b.id)!.status, 'suggested')
    world.places[0].resources.push({ key: 'water', label: 'water', level: 2, max: 2, trend: 'stable' })
    a.humanState!.survival_need = 8
    const drink = prepareDecision(world,a.id,[]).choices.find(c => c.action.actionType === 'DRINK')!.action
    assert.equal(validateEngineAction(drink, world, []).approved, true)
    beginAction(world, drink); assert.ok(drink.taskId); advanceEngine(world, 5)
    assert.equal(world.places[0].resources.find(r => r.key === 'water')!.level, 1)
    const updated = world.engine!.behavior!.plans[0]
    assert.equal(updated.tasks.find(t => t.actorId === a.id)!.status, 'completed')
    assert.equal(updated.tasks.find(t => t.actorId === b.id)!.status, 'suggested')
  } finally { await ctx.close() }
})

test('failed or empty searches resolve as blocked tasks, never fabricate food or fulfill group goals', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [a, b] = world.agents
    for (const actor of world.agents) { actor.humanState!.survival_need = 1; actor.humanState!.fatigue = 1 }
    beginAction(world, { actorId: a.id, locationId: a.publicState.locationId, actionType: 'SPEAK', intent: 'PROPOSE_SURVIVAL_PLAN', targetIds: [b.id], intendedAction: 'plan', spokenText: 'let us cooperate' })
    advanceEngine(world, 3)
    const invitation = world.engine!.interactions!.find(i => i.actorId === a.id && i.targetId === b.id)!
    beginAction(world, { actorId: b.id, locationId: b.publicState.locationId, actionType: 'SPEAK', targetIds: [a.id],
      intendedAction: 'accept plan', spokenText: 'I agree', replyTo: invitation.id, response: 'ACCEPT' })
    advanceEngine(world, 3)
    const task = world.engine!.behavior!.plans[0].tasks.find(t => t.actorId === b.id)!
    const foodBefore = JSON.stringify(world.places.map(p => p.resources))
    const search: ProposedAction = { actorId: b.id, locationId: b.publicState.locationId, actionType: 'EXPLORE', intent: task.intent, taskId: task.id, targetIds: [], intendedAction: 'search', areaHint: 'FOREST' }
    assert.equal(validateEngineAction(search, world, []).approved, true)
    beginAction(world, search); advanceEngine(world, 30)
    assert.equal(world.engine!.behavior!.plans[0].tasks.find(t => t.id === task.id)!.status, 'blocked')
    assert.equal(JSON.stringify(world.places.map(p => p.resources)), foodBefore)
    assert.notEqual(world.engine!.behavior!.plans[0].status, 'completed')
  } finally { await ctx.close() }
})

test('thresholds ignore tiny changes and saturation but expose crossing, injury and depletion', () => {
  const change = (field: string, from: number | string, to: number | string) => ({ field, from: String(from), to: String(to) })
  assert.equal(meaningfulChanges([change('agent:a:fatigue', 6.1, 6.3), change('agent:a:wetness', 10, 10), change('agent:a:weatherExposureDays', 2, 3), change('place:a:food', 3, 2.9)]).length, 0)
  for (const threshold of [3, 5, 7, 9]) assert.equal(meaningfulChanges([change('agent:a:fatigue', threshold - 0.1, threshold)]).length, 1)
  assert.equal(meaningfulChanges([change('agent:a:fatigue', 7, 6), change('agent:a:status', 'alive', 'injured'), change('place:a:food', 1, 0.9)]).length, 3)
})

test('rejected repetition never triggers an independent fallback decision', async () => {
  const ctx = setup(async request => {
    const world = store.getWorldState(), [actor, target] = world.agents
    return { raw: request.role === 'agent' ? { actorId: actor.id, actionType: 'SPEAK', intent: 'PROPOSE_SURVIVAL_PLAN', locationId: actor.publicState.locationId, targetIds: [target.id], usedItemIds: [], intendedAction: 'cooperate again', spokenText: 'let us cooperate' } : { approved: true, reason: '', ended: false }, inputTokens: 1, outputTokens: 1 }
  })
  try {
    const world = store.getWorldState(), a = world.agents[0]
    a.humanState!.survival_need = 8; a.humanState!.fatigue = 1
    beginAction(world, { actorId: a.id, actionType: 'SPEAK', intent: 'PROPOSE_SURVIVAL_PLAN', targetIds: [world.agents[1].id], locationId: a.publicState.locationId, intendedAction: 'plan', spokenText: 'plan' }); advanceEngine(world, 3)
    for(const other of world.agents.slice(1))other.nextDecisionAt=Number.MAX_SAFE_INTEGER
    world.places[0].resources.push({ key: 'water', label: 'water', level: 2, max: 2, trend: 'stable' })
    await store.runWorldTick()
    assert.equal(world.engine!.ongoingActions.length, 0)
    assert.equal(store.getAdminRuntime().callsUsed, 1)
    assert.ok(store.listActionAudit().some(e => e.outcome === 'REJECTED'))
    assert.ok(store.listEvents({ offset: 0, limit: 100 }).items.every(e => e.phase !== 'STARTED'))
    assert.equal(world.places[0].resources.find(r => r.key === 'water')!.level, 2)
  } finally { await ctx.close() }
})

test('live tick uses frozen design, updates location/occupancy/memory/scenes and restores a paused checkpoint', async () => {
  const prompts: string[] = []
  const ctx = setup(async request => { prompts.push(request.prompt); return { raw: request.role === 'agent' ? moveAction() : { approved: true, reason: '', ended: false }, inputTokens: 100, outputTokens: 30 } })
  try {
    setPresetRules(ctx.db, ctx.preset.id, [{ category: 'CUSTOM', title: 'LATER_RULE', description: 'Changed', enabled: true, priority: 0 }])
    const chunks: string[] = []
    const unsubscribe = store.subscribeStream({ write: (s: string) => { chunks.push(s); return true } } as unknown as ServerResponse)
    await store.runWorldTick()
    assert.equal(store.getWorldState().agents[0].publicState.locationId, ctx.places[0].id)
    assert.equal(store.listScenes({ limit: 10 }).items.length, 0)
    store.advanceWorldTick(15)
    store.advanceWorldTick(45)
    unsubscribe()
    const world = store.getWorldState(), actor = world.agents[0]
    assert.equal(actor.publicState.locationId, ctx.places[1].id)
    assert.ok(!world.places[0].currentAgentIds.includes(actor.id))
    assert.ok(world.places[1].currentAgentIds.includes(actor.id))
    assert.ok(actor.movementLog.length > 1)
    assert.equal(store.getAdminRuntime().callsUsed, 2)
    assert.equal(store.getAdminRuntime().providerUsage[0].estTokens, 260)
    assert.match(prompts[0], /ORIGINAL_RULE/)
    assert.doesNotMatch(prompts[0], /LATER_RULE|Bob_PRIVATE_SECRET|HIDDEN_WORLD_SECRET/)
    assert.match(prompts[0], /Alice_PERSONALITY|Alice_PRIVATE_SECRET/)
    assert.match(prompts[1], /HIDDEN_WORLD_SECRET/)
    assert.doesNotMatch(chunks.join(''), /PRIVATE_SECRET|HIDDEN_WORLD_SECRET|provenance/)
    store.advanceWorldTick(60)
    const scene = store.listScenes({ limit: 1 }).items[0]
    assert.equal(scene?.seasonId, ctx.design.id)
    assert.ok(scene?.sourceEventIds.length)
    const savedLocation = actor.publicState.locationId
    store.initializeWorldRuntime(ctx.db)
    assert.equal(store.getAdminRuntime().status, 'PAUSED')
    assert.equal(store.getWorldState().agents[0].publicState.locationId, savedLocation)
    assert.equal(store.getWorldState().agents[0].v2?.version, 2)
    assert.equal(store.getWorldState().agents[0].v2?.currentGoal, actor.v2?.currentGoal)
    assert.ok(store.getWorldState().agents[0].v2?.recentActions.length)
    assert.equal(store.getAdminRuntime().callsUsed, 2)
    assert.equal(getDraft(ctx.db, ctx.design.id)!.status, 'PAUSED')
  } finally { await ctx.close() }
})

test('concurrent ticks share one call and pause invalidates an in-flight response', async () => {
  let complete!: (value: Awaited<ReturnType<WorldModelAdapter>>) => void
  let calls = 0
  const ctx = setup(async () => { calls++; return new Promise(resolve => { complete = resolve }) })
  try {
    const location = store.getWorldState().agents[0].publicState.locationId
    const first = store.runWorldTick(), second = store.runWorldTick()
    assert.equal(first, second)
    assert.equal(calls, 1)
    assert.throws(() => startWorldFromDraft(ctx.db, ctx.design), /world_tick_in_progress/)
    store.pauseSeason()
    complete({ raw: moveAction(), inputTokens: 10, outputTokens: 10 })
    await first
    assert.equal(store.getWorldState().agents[0].publicState.locationId, location)
    assert.equal(store.listActionAudit().length, 0)
    assert.equal(store.getAdminRuntime().callsUsed, 1)
    assert.equal(store.getAdminRuntime().lockHolder, null)
  } finally { await ctx.close() }
})

test('call budget reserves Brain, Planner and judge before paid work; provider failure pauses', async () => {
  let calls = 0
  const ctx = setup(async () => { calls++; throw new Error('SECRET_API_ERROR') })
  try {
    store.setCallBudget(1)
    await store.runWorldTick()
    assert.equal(calls, 0)
    assert.equal(store.getAdminRuntime().status, 'PAUSED')
    assert.equal(store.getAdminRuntime().decisionsPaused, true)
    store.setCallBudget(3)
    store.resumeSeason()
    await store.runWorldTick()
    assert.equal(calls, 1)
    assert.equal(store.getAdminRuntime().callsUsed, 1)
    assert.equal(store.getAdminRuntime().status, 'PAUSED')
    assert.equal(store.getAdminRuntime().decisionsPaused, true)
    assert.doesNotMatch(JSON.stringify(store.getAdminRuntime()), /SECRET_API_ERROR/)
    assert.ok(getMonthlyLedger(ctx.db).settled_usd > 0, 'failed requests retain an estimated charge')
    assert.equal(store.listActionAudit().length, 0)
  } finally { await ctx.close() }
})

test('shared monthly ceiling blocks the world adapter before any paid request', async () => {
  let called = false
  const ctx = setup(async () => { called = true; throw new Error('not expected') })
  try {
    setSetting(ctx.db, 'monthly_budget_krw', '0')
    await store.runWorldTick()
    assert.equal(called, false)
    assert.equal(store.getAdminRuntime().callsUsed, 0)
    assert.equal(store.getAdminRuntime().recentErrors[0].message, 'BUDGET_LIMIT')
  } finally { await ctx.close() }
})

test('a configured timer triggers the same serialized simulation path', async t => {
  const ctx = setup(undefined, false)
  try {
    t.mock.timers.enable({ apis: ['setInterval'] })
    store.setTickInterval(5000)
    t.mock.timers.tick(5000)
    await store.runWorldTick()
    assert.equal(store.getWorldState().agents[0].publicState.locationId, ctx.places[0].id)
    assert.ok(store.getWorldState().engine!.ongoingActions.length > 0)
    store.advanceWorldTick(60)
    assert.ok(store.getWorldState().engine!.outcomes?.[store.getWorldState().agents[0].id]?.length)
    assert.equal(store.listActionAudit().length, 1)
  } finally { await ctx.close(); t.mock.timers.reset() }
})

test('judge rejection produces only an admin audit record and no public state change', async () => {
  const ctx = setup(async request => ({ raw: request.role === 'agent' ? moveAction() : { approved: false, reason: 'HIDDEN_WORLD_SECRET prohibits this', ended: false }, inputTokens: 1, outputTokens: 1 }))
  try {
    const before = store.listEvents({ limit: 100, offset: 0 }).total
    await store.runWorldTick()
    assert.equal(store.listEvents({ limit: 100, offset: 0 }).total, before)
    assert.equal(store.getWorldState().agents[0].publicState.locationId, ctx.places[0].id)
    assert.equal(store.listActionAudit()[0].outcome, 'REJECTED')
    assert.doesNotMatch(JSON.stringify(toPublicWorld(store.getWorldState())), /PRIVATE_SECRET/)
  } finally { await ctx.close() }
})

test('a judge cannot end a season without engine termination evidence', async () => {
  const ctx = setup(async request => ({ raw: request.role === 'agent' ? moveAction() : { approved: true, reason: 'End condition satisfied', ended: true }, inputTokens: 1, outputTokens: 1 }), true, false, 'End when both characters are in A')
  try {
    await store.runWorldTick()
    assert.equal(store.getAdminRuntime().status, 'RUNNING')
    assert.equal(store.getWorldState().agents[0].publicState.locationId, ctx.places[0].id)
    assert.equal(store.getAdminRuntime().callsUsed, 2)
    assert.equal(getDraft(ctx.db, ctx.design.id)!.status, 'RUNNING')
  } finally { await ctx.close() }
})

test('demo executes state transitions without calls; end day stops further ticks', async () => {
  const ctx = setup(async () => { throw new Error('must never call model') }, false)
  try {
    await store.runWorldTick()
    assert.equal(store.getAdminRuntime().callsUsed, 0)
    assert.ok(store.getWorldState().engine!.ongoingActions.length > 0)
    store.advanceWorldTick(60)
    assert.ok(store.getWorldState().engine!.outcomes?.[store.getWorldState().agents[0].id]?.length)
    const world = store.getWorldState()
    world.engine!.minute = (ctx.design.startDay + ctx.design.maxDays! - 1) * 1440 - 1
    world.engine!.lastVitalsMinute = world.engine!.minute
    await store.runWorldTick()
    assert.equal(store.getAdminRuntime().status, 'ENDED')
    const count = store.listEvents({ limit: 100, offset: 0 }).total
    await store.runWorldTick()
    assert.equal(store.listEvents({ limit: 100, offset: 0 }).total, count)
    assert.throws(() => store.resumeSeason(), /season_ended/)
  } finally { await ctx.close() }
})

test('areaHint moves a character within one place and clears once they change place', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState()
    const actor = world.agents[0]
    assert.throws(() => parseProposedAction({ ...moveAction(), actionType: 'EXPLORE', destinationId: null, areaHint: 'VOLCANO' }, actor.id), /invalid_action_area_hint/)
    const explore: ProposedAction = { actorId: actor.id, actionType: 'EXPLORE', targetIds: [], locationId: actor.publicState.locationId, intendedAction: '해안가를 살펴본다', areaHint: 'SHORE' }
    beginAction(world, explore)
    assert.equal(world.agents[0].publicState.localArea, undefined)
    advanceEngine(world, 10)
    assert.equal(world.agents[0].publicState.localArea, 'SHORE')
    const otherPlaceId = world.places.find(p => p.id !== actor.publicState.locationId)!.id
    applyStateChange(world, { field: `agent:${actor.id}:location`, from: actor.publicState.locationId, to: otherPlaceId })
    assert.equal(world.agents[0].publicState.locationId, otherPlaceId)
    assert.equal(world.agents[0].publicState.localArea, undefined)
  } finally { await ctx.close() }
})

test('combat checks reach and living targets, applies injury and hostility, and interrupts the victim', async () => {
  assert.ok(ACTION_SCHEMA.properties.actionType.enum.includes('ATTACK'))
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [actor, target] = world.agents
    const attack: ProposedAction = { actorId: actor.id, locationId: actor.publicState.locationId, actionType: 'ATTACK', targetIds: [target.id], intendedAction: '상대를 공격한다' }
    target.publicState.localArea = 'SHORE'
    assert.equal(validateEngineAction(attack, world, []).approved, false)
    target.publicState.localArea = undefined
    assert.equal(validateEngineAction({ ...attack, targetIds: [actor.id] }, world, []).approved, false)
    assert.equal(validateEngineAction(attack, world, []).approved, true)
    const health = target.body!.health
    beginAction(world, { actorId: target.id, locationId: target.publicState.locationId, actionType: 'SLEEP', targetIds: [], intendedAction: '잠든다' })
    beginAction(world, attack)
    const events = advanceEngine(world, 5)
    assert.ok(target.body!.health > health)
    assert.equal(target.publicState.status, 'injured')
    assert.equal(target.relationships.find(r => r.otherAgentId === actor.id)?.stance, 'hostile')
    assert.ok(events.some(e => e.type === 'CONFLICT' && e.phase === 'COMPLETED'))
    assert.ok(events.some(e => e.phase === 'CANCELLED' && e.agentIds.includes(target.id)))
    target.body!.health = 9
    beginAction(world, attack)
    advanceEngine(world, 5)
    assert.equal(target.publicState.status, 'deceased')
    assert.equal(validateEngineAction(attack, world, []).approved, false)
    assert.ok(!selectDecisionAgents(world, 10).some(a => a.id === target.id))
  } finally { await ctx.close() }
})

test('exhausted attackers can exploit a sleeping target, with recovery cost and alert protection', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [actor, target] = world.agents
    actor.humanState!.fatigue = 10; target.humanState!.fatigue = 1
    const attack: ProposedAction = { actorId: actor.id, locationId: actor.publicState.locationId, actionType: 'ATTACK', targetIds: [target.id], intendedAction: 'attack' }
    beginAction(world, { actorId: target.id, locationId: target.publicState.locationId, actionType: 'SLEEP', targetIds: [], intendedAction: 'sleep' })
    assert.match(buildAgentKnowledgeView(actor.id, world, [])!.othersPresent[0].combatCue!, /잠들어/)
    assert.equal(validateEngineAction(attack, world, []).approved, true)
    const health = target.body!.health, stress = actor.humanState!.stress
    beginAction(world, attack)
    assert.equal(world.engine!.ongoingActions.find(a => a.proposal.actorId === actor.id)!.completesMinute - world.engine!.minute, 10)
    const events = advanceEngine(world, 10)
    assert.equal(target.body!.health, health + 2)
    assert.ok(events.some(e => e.type === 'CONFLICT' && e.summary.includes('그 틈을 노렸다')))
    assert.ok(actor.humanState!.stress >= stress)
    assert.ok(actor.nextDecisionAt! >= world.engine!.minute + 20)
    assert.doesNotMatch(buildAgentKnowledgeView(actor.id, world, [])!.othersPresent[0].combatCue!, /\uacbd\uacc4/, 'private engine alert is not visible to another agent')
    assert.ok(!world.engine!.ongoingActions.some(a => a.proposal.actorId === target.id))
    actor.body!.injury = 8
    world.engine!.minute += 30
    assert.ok(validateEngineAction(attack, world, []).notes.includes('body_cannot_fight'))
  } finally { await ctx.close() }
})

test('fatigue is not a validation ban; guarding prevents an exhausted attack from inventing an injury', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [actor, target] = world.agents
    actor.humanState!.fatigue = 10; target.humanState!.fatigue = 10
    beginAction(world, { actorId: target.id, locationId: target.publicState.locationId, actionType: 'OBSERVE', targetIds: [], intendedAction: 'watch', durationMinutes: 30 })
    const attack: ProposedAction = { actorId: actor.id, locationId: actor.publicState.locationId, actionType: 'ATTACK', targetIds: [target.id], intendedAction: 'attack' }
    assert.equal(validateEngineAction(attack, world, []).approved, true)
    const body = structuredClone(target.body), status = target.publicState.status
    beginAction(world, attack)
    const events = advanceEngine(world, 10)
    assert.deepEqual(target.body, body); assert.equal(target.publicState.status, status)
    assert.ok(events.some(e => e.type === 'CONFLICT' && e.summary.includes('부상을 입히지 못했다')))
  } finally { await ctx.close() }
})

test('an opening is rechecked on completion and another area does not reveal combat cues', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [actor, target] = world.agents
    actor.humanState!.fatigue = 10; target.humanState!.fatigue = 1
    target.publicState.localArea = 'SHORE'
    assert.equal(buildAgentKnowledgeView(actor.id, world, [])!.othersPresent[0], undefined)
    target.publicState.localArea = actor.publicState.localArea
    beginAction(world, { actorId: target.id, locationId: target.publicState.locationId, actionType: 'REST', targetIds: [], intendedAction: 'rest', durationMinutes: 20 })
    advanceEngine(world, 15)
    const health = target.body!.health
    beginAction(world, { actorId: actor.id, locationId: actor.publicState.locationId, actionType: 'ATTACK', targetIds: [target.id], intendedAction: 'attack' })
    const events = advanceEngine(world, 10)
    assert.equal(target.body!.health, health)
    assert.ok(events.some(e => e.type === 'CONFLICT' && e.summary.includes('부상을 입히지 못했다')))
  } finally { await ctx.close() }
})

test('restart repairs an invented ending while retaining time, cast and real source events', async () => {
  const ctx = setup(undefined, false)
  try {
    await store.shutdownWorldRuntime()
    const row = ctx.db.prepare('SELECT payload FROM world_runtime_checkpoint WHERE id=1').get() as {payload:string}
    const saved=JSON.parse(row.payload)
    const source={...saved.events[0],id:'ambiguous-power',cause:'scheduled:power-off',phase:'STATE_UPDATE',summary:'의문의 배틀로얄: ',title:'의문의 배틀로얄',stateChanges:[{field:'place:test:power',from:'true',to:'false'}]}
    saved.events.unshift(source)
    saved.scenes.push({id:'bad-scene',title:'배틀로얄 종료',body:'배틀로얄이 갑작스럽게 종료되었다.',sourceEventIds:[source.id]})
    ctx.db.prepare('UPDATE world_runtime_checkpoint SET payload=? WHERE id=1').run(JSON.stringify(saved))
    store.initializeWorldRuntime(ctx.db);store.stopSimulationTimerForTests()
    const repaired=store.getScene('bad-scene')!
    assert.doesNotMatch(repaired.body+repaired.title,/종료/)
    assert.match(repaired.body,/전기 공급/)
    assert.deepEqual(repaired.sourceEventIds,[source.id])
    assert.equal(store.getWorldState().clock.time,saved.worldState.clock.time)
    assert.equal(store.getWorldState().agents.length,2)
    store.endSeason()
    assert.equal(store.getAdminRuntime().status, 'PAUSED')
    assert.ok(!store.listEvents({offset:0,limit:100}).items.some(e=>e.cause==='world_ended'))
    assert.ok(repaired.corrections?.length)
  } finally {await ctx.close()}
})

test('medicine requires real injury, names the patient and effect, and rechecks before consuming stock', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [actor, patient] = world.agents, place = world.places[0]
    place.resources.push({ key: 'medicine', label: '의약품', level: 3, max: 3, trend: 'stable', unit: '개' })
    const treatment: ProposedAction = { actorId: actor.id, actionType: 'USE_ITEM', locationId: place.id, targetIds: [patient.id], resourceKey: 'medicine', intendedAction: '다친 상대의 부상을 치료한다' }
    const untouched = structuredClone(world)
    assert.equal(validateEngineAction(treatment, world, []).approved, false)
    assert.deepEqual(world, untouched)
    assert.equal(validateEngineAction({ ...treatment, actionType: 'INTERACT' }, world, []).approved, false)
    patient.body!.injury = 4; patient.publicState.status = 'injured'
    assert.equal(validateEngineAction(treatment, world, []).approved, true)
    beginAction(world, treatment)
    const result = advanceEngine(world, 5).find(e => e.phase === 'COMPLETED')!
    assert.equal(patient.body!.injury, 2)
    assert.equal(place.resources.find(r => r.key === 'medicine')!.level, 2)
    assert.match(result.summary, /부상을 치료하기 위해 의약품을 썼다/)
    assert.ok(result.summary.includes(patient.name))
    assert.ok(result.stateChanges.some(c => c.field === `agent:${patient.id}:injury` && c.from === '4' && c.to === '2'))
    beginAction(world, treatment)
    patient.body!.injury = 0; patient.publicState.status = 'alive'
    const interrupted = advanceEngine(world, 5)
    assert.ok(interrupted.some(e => e.phase === 'FAILED'))
    assert.equal(place.resources.find(r => r.key === 'medicine')!.level, 2)
    world.engine!.objects.push({ id: 'medicine-item', name: '의약품', kind: 'medicine', quantity: 2, condition: 'intact', location: { kind: 'agent', id: actor.id } })
    actor.inventory.push('medicine-item')
    const owned = { ...treatment, resourceKey: undefined, usedItemIds: ['medicine-item'] }
    assert.equal(validateEngineAction(owned, world, []).approved, false)
    patient.body!.injury = 2; patient.publicState.status = 'injured'
    beginAction(world, owned); advanceEngine(world, 5)
    assert.equal(patient.body!.injury, 0)
    assert.equal(world.engine!.objects.find(o => o.id === 'medicine-item')!.quantity, 1)
    assert.equal(patient.publicState.status, 'alive')
  } finally { await ctx.close() }
})

test('every new action carries a public purpose through start and failure without exposing private intentions', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), actor = world.agents[0]
    const action: ProposedAction = { actorId: actor.id, actionType: 'INTERACT', locationId: actor.publicState.locationId, targetIds: [], resourceKey: 'medicine', intendedAction: 'PRIVATE_REASON_MUST_NOT_APPEAR', publicAction: 'Alice는 의약품을 작업에 사용하려 했다.', publicReason: '다친 동료를 도울 준비가 필요했다.' }
    const started = beginAction(world, action)
    assert.ok(started.summary.includes(action.publicAction!))
    assert.ok(started.summary.includes(action.publicReason!))
    const failed = advanceEngine(world, 10).find(e => e.phase === 'FAILED')!
    assert.ok(failed.summary.includes(action.publicAction!))
    assert.ok(failed.summary.includes(action.publicReason!))
    assert.match(failed.summary, /의약품을 일반 작업에 소비할 수는 없었다/)
    assert.doesNotMatch(failed.summary, /조건 변화|PRIVATE_REASON/)
    assert.ok(ACTION_SCHEMA.required.includes('publicReason'))
    assert.throws(() => parseProposedAction({ ...action, usedItemIds: [], publicReason: ' ' }, actor.id), /public_action_and_reason_required/)
  } finally { await ctx.close() }
})

test('GIVE_ITEM transfers ownership and schema rejects forged actors and malformed fields', async () => {
  const ctx = setup(async request => ({ raw: request.role === 'agent' ? { ...moveAction(), actionType: 'GIVE_ITEM', destinationId: null, targetIds: [store.getWorldState().agents[1].id], usedItemIds: ['key'] } : { approved: true, reason: '', ended: false }, inputTokens: 1, outputTokens: 1 }))
  try {
    assert.throws(() => parseProposedAction({ ...moveAction(), actorId: 'forged' }, store.getWorldState().agents[0].id))
    assert.throws(() => parseProposedAction({ ...moveAction(), targetIds: 'bad' }, store.getWorldState().agents[0].id))
    await store.runWorldTick()
    assert.deepEqual(store.getWorldState().agents[0].inventory, ['key'])
    store.advanceWorldTick(1)
    assert.deepEqual(store.getWorldState().agents[0].inventory, [])
    assert.deepEqual(store.getWorldState().agents[1].inventory, ['key'])
  } finally { await ctx.close() }
})

test('ADMIN sessions authorize world APIs, USER/anonymous/token-only and cross-origin mutations fail', async () => {
  const ctx = setup(undefined, false)
  const router = new Router()
  registerAuthRoutes(router, ctx.db); registerWorldAdminRoutes(router, ctx.db); registerWorldBuilderRoutes(router, ctx.db); registerWorldRoutes(router)
  const server = createServer((req, res) => { void router.handle(req, res) })
  try {
    createUser(ctx.db, { username: 'operator', nickname: 'Operator', provider: 'local', role: 'ADMIN', passwordHash: hashPassword('test-password') })
    createUser(ctx.db, { email: 'user@example.com', nickname: 'Reader', provider: 'local', passwordHash: hashPassword('test-password') })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    async function login(identifier: string) {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password: 'test-password' }) })
      assert.equal(response.status, 200)
      return response.headers.get('set-cookie')!.split(';')[0]
    }
    const adminCookie = await login('operator'), userCookie = await login('user@example.com')
    for (const path of ['runtime', 'drafts', 'rule-presets', 'cognition']) {
      assert.equal((await fetch(`${base}/api/admin/world/${path}`)).status, 401)
      assert.equal((await fetch(`${base}/api/admin/world/${path}`, { headers: { cookie: userCookie } })).status, 403)
      assert.equal((await fetch(`${base}/api/admin/world/${path}`, { headers: { cookie: adminCookie } })).status, 200)
    }
    assert.equal((await fetch(`${base}/api/admin/world/runtime`, { headers: { 'x-admin-token': config.adminToken } })).status, 401)
    assert.equal((await fetch(`${base}/api/admin/world/pause`, { method: 'POST', headers: { cookie: adminCookie } })).status, 403)
    assert.equal((await fetch(`${base}/api/admin/world/pause`, { method: 'POST', headers: { cookie: adminCookie, 'x-world-admin': '1', origin: 'https://evil.example' } })).status, 403)
    assert.equal((await fetch(`${base}/api/admin/world/pause`, { method: 'POST', headers: { cookie: adminCookie, 'x-world-admin': '1', origin: base } })).status, 200)
    const publicBody = await (await fetch(`${base}/api/world/current`)).text()
    assert.doesNotMatch(publicBody, /PRIVATE_SECRET|HIDDEN_WORLD_SECRET/)
    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: adminCookie } })
    assert.equal((await fetch(`${base}/api/admin/world/runtime`, { headers: { cookie: adminCookie } })).status, 401)
  } finally { server.close(); server.closeAllConnections(); await ctx.close() }
})

test('real adapter uses structured JSON output with bounded single-attempt transport (no live API)', async () => {
  const originalFetch = globalThis.fetch, originalKey = config.openaiApiKey
  config.openaiApiKey = 'test-key'
  let body: Record<string, unknown> = {}
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"approved":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }), { status: 200 }) }
  try {
    const result = await worldModelAdapter({ role: 'agent', provider: 'openai', model: config.openaiModel, prompt: 'test', schema: ACTION_SCHEMA })
    assert.equal(result.inputTokens, 12)
    assert.equal((body.response_format as { type: string }).type, 'json_schema')
  } finally { globalThis.fetch = originalFetch; config.openaiApiKey = originalKey }
})

test('private worlds reject all unauthenticated world reads including stream and full state', async () => {
  const ctx = setup(undefined, false, true)
  const router = new Router()
  registerWorldRoutes(router, ctx.db)
  const server = createServer((req, res) => { void router.handle(req, res) })
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    for (const path of ['current', 'agents', 'places', 'events', 'scenes', 'stream']) {
      const response = await fetch(`${base}/api/world/${path}`)
      assert.equal(response.status, 401)
      assert.doesNotMatch(await response.text(), /PRIVATE_SECRET|HIDDEN_WORLD_SECRET|Alice/)
    }
  } finally { server.close(); server.closeAllConnections(); await ctx.close() }
})


test('engine time and due actions continue while an AI response is pending', async () => {
  let resolve!: (v: Awaited<ReturnType<WorldModelAdapter>>) => void
  const ctx = setup(async () => new Promise(done => { resolve = done }))
  try {
    const world = store.getWorldState(), before = world.engine!.minute
    const tick = store.runWorldTick()
    store.advanceWorldTick(60)
    assert.equal(world.engine!.minute, before + 61)
    assert.equal(world.agents[0].humanState!.survival_need, DEFAULT_HUMAN_STATE.survival_need + 1)
    assert.equal(store.getAdminRuntime().callsUsed, 1)
    store.pauseSeason()
    resolve({ raw: moveAction(), inputTokens: 1, outputTokens: 1 })
    await tick
  } finally { await ctx.close() }
})

test('busy and sleeping characters are excluded; direct speech wakes only the addressed sleeper', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [a, b] = world.agents
    const sleep: ProposedAction = { actorId: b.id, locationId: b.publicState.locationId, targetIds: [], actionType: 'SLEEP', intendedAction: 'sleep', durationMinutes: 180 }
    beginAction(world, sleep)
    assert.ok(!selectDecisionAgents(world, 10).some(c => c.id === b.id))
    const speech = beginAction(world, { actorId: a.id, locationId: a.publicState.locationId, targetIds: [b.id], actionType: 'SPEAK', intendedAction: 'ask', spokenText: 'Can you hear me?' })
    assert.equal(speech.phase, 'STARTED')
    advanceEngine(world, 1, [], e => recordExperience(world, e))
    assert.equal(world.engine!.ongoingActions.length, 0)
    assert.equal(b.wakeReason, 'addressed_directly')
    assert.ok(selectDecisionAgents(world, 10).some(c => c.id === b.id))
    assert.ok(!selectDecisionAgents(world, 10).some(c => c.id === a.id))
    assert.equal(b.knowledge.at(-1)!.verified, false)
  } finally { await ctx.close() }
})

test('reserved food cannot be consumed twice and consumption has a logged physical source', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [a, b] = world.agents
    const place = world.places[0]
    place.resources.push({ key: 'food', label: 'Food', level: 1, max: 1, trend: 'stable' })
    const action: ProposedAction = { actorId: a.id, actionType: 'EAT', locationId: place.id, targetIds: [], intendedAction: 'eat', resourceKey: 'food' }
    assert.equal(validateEngineAction(action, world, []).approved, true)
    beginAction(world, action)
    assert.equal(place.resources[0].level, 1)
    assert.equal(validateEngineAction({ ...action, actorId: b.id }, world, []).approved, false)
    const before = a.humanState!.survival_need
    const events = advanceEngine(world, 5)
    assert.equal(place.resources[0].level, 0)
    assert.equal(a.humanState!.survival_need, before - 2)
    assert.ok(events[0].stateChanges.some(c => c.field === `place:${place.id}:food` && c.to === '0'))
    assert.equal(validateEngineAction(action, world, []).approved, false)
  } finally { await ctx.close() }
})

test('exploration reveals only registered local truths, sharing records report provenance', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), [a, b] = world.agents
    world.engine!.truths.push({ id: 'local-truth', summary: 'LOCAL_SECRET', placeId: a.publicState.locationId, discoveredBy: [] }, { id: 'remote-truth', summary: 'REMOTE_SECRET', placeId: world.places[1].id, discoveredBy: [] })
    assert.doesNotMatch(JSON.stringify(buildAgentKnowledgeView(a.id, world, [])), /LOCAL_SECRET|REMOTE_SECRET/)
    beginAction(world, { actorId: a.id, locationId: a.publicState.locationId, actionType: 'EXPLORE', targetIds: [], intendedAction: 'explore' })
    const discovered = advanceEngine(world, 10)
    assert.match(JSON.stringify(a.knowledge), /LOCAL_SECRET/)
    assert.doesNotMatch(JSON.stringify(a.knowledge), /REMOTE_SECRET/)
    assert.doesNotMatch(JSON.stringify(b.knowledge), /LOCAL_SECRET/)
    assert.doesNotMatch(JSON.stringify(toPublicWorld(world)), /LOCAL_SECRET|REMOTE_SECRET|HIDDEN_WORLD_SECRET/)
    const fact = a.knowledge.find(k => k.truthId === 'local-truth')!
    assert.equal(fact.sourceEventId, discovered[0].id)
    const share: ProposedAction = { actorId: a.id, locationId: a.publicState.locationId, actionType: 'SHARE_INFO', targetIds: [b.id], intendedAction: 'share', factId: fact.id }
    assert.equal(validateEngineAction({ ...share, factId: 'invented' }, world, []).approved, false)
    beginAction(world, share)
    const result = advanceEngine(world, 1)
    assert.equal(b.knowledge[0].acquisition, 'report')
    assert.equal(b.knowledge[0].verified, false)
    assert.equal(b.knowledge[0].sourceAgentId, a.id)
    assert.equal(b.knowledge[0].sourceEventId, result[0].id)
  } finally { await ctx.close() }
})

test('unknown destinations, blocked routes, severe fatigue and destroyed items fail closed', async () => {
  const ctx = setup(undefined, false)
  try {
    const world = store.getWorldState(), actor = world.agents[0]
    const move = moveAction() as ProposedAction
    actor.knownPlaceIds = [actor.publicState.locationId]
    assert.equal(validateEngineAction(move, world, []).approved, false)
    actor.knownPlaceIds.push(move.destinationId!)
    world.engine!.connections[0].blocked = true
    assert.equal(validateEngineAction(move, world, []).approved, false)
    world.engine!.connections[0].blocked = false
    actor.humanState!.fatigue = 10
    assert.equal(validateEngineAction(move, world, []).approved, false)
    world.engine!.objects[0].condition = 'destroyed'
    assert.equal(validateEngineAction({ ...move, actionType: 'GIVE_ITEM', usedItemIds: ['key'], targetIds: [world.agents[1].id] }, world, []).approved, false)
    actor.publicState.status = 'deceased'
    applyStateChange(world, { field: `agent:${actor.id}:status`, from: 'deceased', to: 'alive' })
    assert.equal(actor.publicState.status, 'deceased')
  } finally { await ctx.close() }
})

test('operator notices cannot rewrite reality and event history survives beyond the RAM window', async () => {
  const ctx = setup(undefined, false)
  try {
    const before = store.awaySummary('2000-01-01T00:00:00.000Z').eventCount
    const stateBefore = structuredClone(store.getWorldState().agents)
    let first = ''
    for (let i = 0; i < 505; i++) {
      const e = store.addOperatorEvent({ type: 'SYSTEM', placeId: ctx.places[0].id, agentIds: [], title: `Notice ${i}`, summary: 'An operator message', addedBy: 'test' }).event!
      if (!first) first = e.id
    }
    assert.deepEqual(store.getWorldState().agents, stateBefore)
    assert.equal(store.listEvents({ limit: 100, offset: 500 }).items.length, 0)
    assert.equal(store.awaySummary('2000-01-01T00:00:00.000Z').eventCount, before + 505)
    assert.equal(store.getEvent(first)?.cause, 'operator_announcement')
    store.initializeWorldRuntime(ctx.db)
    assert.equal(store.getEvent(first)?.cause, 'operator_announcement')
    assert.equal(store.listEvents({ limit: 1, offset: 0 }).total, 0)
  } finally { await ctx.close() }
})

test('configured character ceiling blocks launch and preserves the existing world', async () => {
  const ctx = setup(undefined, false)
  const prior = config.maxActiveCharacters
  try {
    config.maxActiveCharacters = 1
    assert.equal(validateDraftForStart(ctx.design).ok, false)
    assert.equal(startWorldFromDraft(ctx.db, ctx.design).ok, false)
    assert.equal(store.getWorldState().agents.length, 2)
    assert.throws(() => store.startSeason(), /max_active_characters/)
  } finally { config.maxActiveCharacters = prior; await ctx.close() }
})

test('quiet ticks do not force a public scene from unfinished or state-only actions', async () => {
  const ctx = setup(undefined, false)
  try {
    await store.runWorldTick()
    assert.equal(store.listChapters().length,0)
    assert.equal(store.listScenes({ limit: 10 }).items.length, 0)
    store.advanceWorldTick(59)
    assert.ok(store.listScenes({ limit: 10 }).items.every(scene => scene.sourceEventIds.every(id => store.getEvent(id)?.phase !== 'STARTED')))
    assert.equal(store.getAdminRuntime().callsUsed, 0)
  } finally { await ctx.close() }
})

test('narrator rejects fabricated prose without affecting decision call accounting', async () => {
  const ctx = setup(async request => {
    if (request.role === 'agent') return { raw: moveAction(), inputTokens: 1, outputTokens: 1 }
    if (request.role === 'judge') return { raw: { approved: true, reason: 'ok', ended: false }, inputTokens: 1, outputTokens: 1 }
    const events = JSON.parse(request.prompt.split('[NEW_EVENTS — CONFIRMED EVENTS]\n\n')[1].split('\n\n[PLACE NAMES]')[0]) as Array<{ id: string }>
    return { raw: { title: 'AI_TITLE', body: 'AI_BODY_TEXT', sourceEventIds: events.map(e => e.id) }, inputTokens: 1, outputTokens: 1 }
  }, true, false, '', true)
  try {
    await store.runWorldTick()
    store.advanceWorldTick(59)
    store.advanceWorldTick(60)
    const deterministic = store.listScenes({ limit: 10 }).items[0]
    assert.notEqual(deterministic.body, 'AI_BODY_TEXT')
    const callsBefore = store.getAdminRuntime().callsUsed
    await store.shutdownWorldRuntime()
    const enhanced = store.listScenes({ limit: 10 }).items[0]
    assert.equal(enhanced.id, deterministic.id)
    assert.notEqual(enhanced.title, 'AI_TITLE')
    assert.notEqual(enhanced.body, 'AI_BODY_TEXT')
    // A supplementary enrichment call, not a world decision — must never inflate callsUsed.
    assert.equal(store.getAdminRuntime().callsUsed, callsBefore)
  } finally { ctx.db.close() }
})

function launchSecondWorld(db: DatabaseSync, name: string) {
  const draft = createDraft(db, name)
  updateBasicInfo(db, draft.id, { name, intro: 'Second world', genre: 'survival', background: 'B', seasonName: 'Test2', maxDays: 2, simSpeedMs: 3600000, targetPopulation: 1, isPublic: true })
  const preset = createRulePreset(db, { name: `${name} rules` })
  setPresetRules(db, preset.id, [{ category: 'CUSTOM', title: 'RULE', description: 'No attacks.', enabled: true, priority: 1 }])
  updateRuleSelection(db, draft.id, preset.id)
  const places = replacePlacesAndConnections(db, draft.id, [{ tempId: 'X', name: 'X', description: '', type: 'GENERIC', x: 0, y: 0, isPublic: true, isDiscovered: true, capacity: 3, resources: [], items: [], facilityStatus: '' }], [])!.places
  createCharacter(db, draft.id, { name: 'Carol', age: 30, gender: '', appearance: '', background: '', occupation: 'engineer', personality: 'CAROL_PERSONALITY', goal: 'Survive', strengths: [], weaknesses: [], provider: 'openai', model: '', humanState: DEFAULT_HUMAN_STATE, emotion: DEFAULT_EMOTION, knowledge: [], privateInfo: '', inventory: [], initialPlaceId: places[0].id }, 'MANUAL')
  const design = getDraft(db, draft.id)!
  assert.equal(startWorldFromDraft(db, design).ok, true)
}

test('deleteArchivedSeason wipes an ended season\'s archive entry and event journal, but never the live season', async () => {
  const ctx = setup(undefined, false)
  const seasonAId = store.getSeason().id
  try {
    launchSecondWorld(ctx.db, 'World B')
    assert.notEqual(store.getSeason().id, seasonAId)
    assert.ok(store.listSeasons().some(s => s.id === seasonAId && s.status === 'ENDED'))
    const countRows = () => (ctx.db.prepare('SELECT COUNT(*) as c FROM world_event_journal WHERE season_id=?').get(seasonAId) as { c: number }).c
    assert.ok(countRows() > 0)

    const guarded = store.deleteArchivedSeason(ctx.db, store.getSeason().id)
    assert.deepEqual(guarded, { ok: false, error: 'cannot_delete_active_season' })
    assert.ok(store.listSeasons().some(s => s.id === seasonAId))

    const result = store.deleteArchivedSeason(ctx.db, seasonAId)
    assert.deepEqual(result, { ok: true })
    assert.ok(!store.listSeasons().some(s => s.id === seasonAId))
    assert.equal(countRows(), 0)

    assert.deepEqual(store.deleteArchivedSeason(ctx.db, 'no-such-season'), { ok: false, error: 'season_not_found' })
  } finally { await store.shutdownWorldRuntime(); ctx.db.close() }
})

test('default constitutional preset fits bounded agent and judge requests without a network call', async () => {
  const ctx = setup(undefined, false)
  try {
    seedDefaultRulePreset(ctx.db)
    const execution = { draft: ctx.design, rules: getRulePreset(ctx.db, 'preset-realistic-world')!.rules, mode: 'live' as const }
    const world = store.getWorldState()
    const actor = world.agents[0]
    for (let i = 2; i < 10; i++) world.agents.push({ ...structuredClone(actor), id: `character-${i}`, name: `Character ${i}` })
    world.engine!.behavior = { history: Array.from({ length: 12 }, () => ({ actorId: actor.id, minute: world.engine!.minute, type: 'SOCIAL', key: 'previous-key'.repeat(300) })), plans: [] }
    const request = agentRequest(execution, actor.id, world, [], prepareDecision(world, actor.id, []))
    assert.ok(Buffer.byteLength(worldRequestBody(request)) <= MAX_PROVIDER_REQUEST_BYTES)
    const judgment = judgeRequest(execution, moveAction() as ProposedAction, world, [])
    assert.ok(Buffer.byteLength(worldRequestBody(judgment)) <= MAX_PROVIDER_REQUEST_BYTES)
  } finally { await ctx.close() }
})


test('character generation obeys prepaid limits and charges failed requests without fake fallback', async () => {
  const db = new DatabaseSync(':memory:'); migrate(db)
  const original = { key: config.openaiApiKey, mode: config.worldDemoMode, prepaid: config.prepaidBudgetUsd, production: config.production, fetch: globalThis.fetch }
  let called = 0
  const ctx = { worldName: 'test', genre: '', background: '', seasonPremise: '', existingNames: [] }
  config.openaiApiKey = 'test-key'; config.worldDemoMode = false; config.prepaidBudgetUsd = 0; config.production = false
  globalThis.fetch = async () => { called++; return new Response('{}', { status: 429 }) }
  try {
    await assert.rejects(generateCharacters('openai', 1, ctx, db), /generation budget exhausted/)
    assert.equal(called, 0)
    config.prepaidBudgetUsd = 20
    const result = await generateCharacters('openai', 1, ctx, db)
    assert.equal(called, 1)
    assert.equal(result.usedDemo, false)
    assert.equal(result.characters.length, 0)
    assert.ok(result.errors.includes('OPENAI_HTTP_429'))
    assert.ok(getMonthlyLedger(db).settled_usd > 0)
    assert.equal(getMonthlyLedger(db).reserved_usd, 0)
  } finally {
    config.openaiApiKey = original.key; config.worldDemoMode = original.mode; config.prepaidBudgetUsd = original.prepaid; config.production = original.production; globalThis.fetch = original.fetch; db.close()
  }
})

test('large held inventory is compacted before any provider call without changing world state',async()=>{
 const ctx=setup(undefined,false)
 try{
  store.setMaxActiveAgents(2)
  const world=store.getWorldState()
  for(const actor of world.agents)actor.nextDecisionAt=0
  const selected=selectDecisionAgents(world,2)
  assert.equal(selected.length,2)
  const target=selected[1],template=world.engine!.objects[0]
  assert.ok(template)
  for(let i=0;i<90;i++){
   const id=`oversized-held-${i}`
   world.engine!.objects.push({...structuredClone(template),id,name:`Visible held item ${i} ${'detail'.repeat(40)}`,quantity:1,location:{kind:'agent',id:target.id}})
   target.inventory.push(id)
  }
  const execution={draft:ctx.design,rules:[],mode:'live' as const}
  const assessment=prepareDecision(world,target.id,[])
  const before=JSON.stringify(world)
  const request=agentRequest(execution,target.id,world,[],assessment)
  assert.ok(Buffer.byteLength(worldRequestBody(request))<=MAX_PROVIDER_REQUEST_BYTES)
  assert.match(request.prompt,/"total":9[01]/)
  assert.ok(!request.prompt.includes('oversized-held-89'))
  assert.equal(JSON.stringify(world),before)
 }finally{await ctx.close()}
})
