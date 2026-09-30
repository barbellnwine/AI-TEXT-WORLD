import test from 'node:test'
import assert from 'node:assert/strict'
import {traumaFixture} from './trauma-fixture.ts'
import {prepareDecision} from '../server/world/decisionController.ts'
import {ensureAgentV2} from '../server/world/agentV2State.ts'
import {beginAction} from '../server/world/worldEngine.ts'
import type {WorldEvent} from '../server/domain/worldTypes.ts'

test('an unresolved survivor objective creates purposeful scouting, and a witnessed location changes its target',async()=>{
 const f=traumaFixture()
 try{
  f.world.engine!.minute=120;f.world.clock.time='02:00'
  f.world.engine!.competition={endMinute:null,lastSurvivor:true}
  f.a.emotion!.fear=0;f.a.body!.injury=0
  const otherPlace=f.world.places[1]
  for(const other of f.world.agents.filter(a=>a.id!==f.a.id))other.publicState.locationId=otherPlace.id
  f.place.currentAgentIds=[f.a.id];otherPlace.currentAgentIds=f.world.agents.filter(a=>a.id!==f.a.id).map(a=>a.id)
  const first=prepareDecision(f.world,f.a.id,[]).choices
  assert.ok(first.some(c=>c.goal==='SCOUT_OBJECTIVE'&&c.action.actionType==='MOVE'))
  assert.ok(!first.some(c=>c.goal==='LEAVE_DANGER'))
  const seen:WorldEvent={id:'last-sighting',occurredAt:new Date().toISOString(),day:1,worldMinute:90,worldTime:'01:30',
   placeId:otherPlace.id,agentIds:[f.b.id],witnessIds:[f.a.id],visibility:'public',type:'OBSERVATION',phase:'COMPLETED',
   title:'목격',summary:'다른 참가자를 목격했다.',stateChanges:[],importance:'normal',relatedEventIds:[]}
  const known=prepareDecision(f.world,f.a.id,[seen]).choices.find(c=>c.goal==='LOCATE_COMPETITOR')
  assert.equal(known?.action.destinationId,otherPlace.id)
  assert.deepEqual(known?.evidenceEventIds,[seen.id])
  assert.ok(!prepareDecision(f.world,f.a.id,[{...seen,witnessIds:[],visibility:'private'}]).choices.some(c=>c.goal==='LOCATE_COMPETITOR'))
 }finally{await f.close()}
})

test('a weapon changes an available encounter without making distant opponents attackable',async()=>{
 const f=traumaFixture()
 try{
  f.world.engine!.competition={endMinute:null,lastSurvivor:true}
  const otherPlace=f.world.places[1]
  for(const other of f.world.agents.filter(a=>a.id!==f.a.id))other.publicState.locationId=otherPlace.id
  f.place.currentAgentIds=[f.a.id];otherPlace.currentAgentIds=f.world.agents.filter(a=>a.id!==f.a.id).map(a=>a.id)
  f.world.engine!.objects.push({id:'fixture-blade',name:'단검',kind:'tool',quantity:1,condition:'intact',location:{kind:'agent',id:f.a.id},physical:{material:'metal',edge:'sharp',portable:true,attackPower:3,cover:0}})
  f.a.inventory.push('fixture-blade')
  assert.ok(!prepareDecision(f.world,f.a.id,[]).choices.some(c=>c.action.actionType==='ATTACK'))
  f.b.publicState.locationId=f.place.id;f.b.publicState.position=f.a.publicState.position
  f.place.currentAgentIds.push(f.b.id)
  const attacks=prepareDecision(f.world,f.a.id,[]).choices.filter(c=>c.action.actionType==='ATTACK')
  assert.ok(attacks.some(c=>c.action.usedItemIds?.includes('fixture-blade')))
 }finally{await f.close()}
})

test('completed rest stops a satisfied recovery step from retaining plan priority',async()=>{
 const f=traumaFixture()
 try{
  f.a.humanState!.fatigue=1
  const action={actorId:f.a.id,locationId:f.place.id,targetIds:[],actionType:'REST' as const,intendedAction:'지친 몸을 회복한다.',durationMinutes:60,
   decisionV3:{transition:'MODIFY' as const,goal:'recover',purpose:'restore energy',method:'rest',nextSteps:['REST' as const],nextStepTargets:[null],expectedReward:5,expectedRisk:1}}
  const started=beginAction(f.world,action);f.events.push(started)
  f.tick(60)
  assert.equal(ensureAgentV2(f.a,f.world).decisionV3?.replanRequired,true)
  assert.equal(ensureAgentV2(f.a,f.world).decisionV3?.lastFailureReason,'recovery_goal_satisfied')
 }finally{await f.close()}
})
