import test from 'node:test'
import assert from 'node:assert/strict'
import {traumaFixture} from './trauma-fixture.ts'
import {recordOffscreenAssault,recordVictimDisclosure} from '../server/world/offscreenAssault.ts'
import {buildAgentKnowledgeView} from '../server/world/knowledgeFilter.ts'

test('confirmed offscreen adult assault changes state once and disclosure controls knowledge',async()=>{
 const f=traumaFixture()
 try{
  f.a.age=30;f.b.age=28
  const bystander=structuredClone(f.a);bystander.id='bystander';bystander.name='목격 가능 인물';bystander.knowledge=[];bystander.memories=[]
  f.world.agents.push(bystander);f.place.currentAgentIds.push(bystander.id)
  const priorStress=f.b.humanState!.stress,priorFear=f.b.emotion!.fear
  const incident=recordOffscreenAssault(f.world,f.events,{eventId:'incident-1',perpetratorId:f.a.id,victimId:f.b.id})
  assert.equal(incident.visibility,'private')
  assert.equal(f.b.humanState!.stress,Math.min(10,priorStress+3))
  assert.equal(f.b.emotion!.fear,Math.min(10,priorFear+3))
  assert.equal(f.b.relationships.find(r=>r.otherAgentId===f.a.id)?.stance,'hostile')
  assert.ok(f.b.memories?.some(m=>m.sourceEventIds.includes(incident.id)))
  assert.ok(!buildAgentKnowledgeView(bystander.id,f.world,f.events)!.observedEvents.some(e=>e.id===incident.id))
  assert.throws(()=>recordOffscreenAssault(f.world,f.events,{eventId:'incident-1',perpetratorId:f.a.id,victimId:f.b.id}),/already_recorded/)
  const disclosure=recordVictimDisclosure(f.world,f.events,{eventId:'disclosure-1',incidentId:incident.id,victimId:f.b.id,recipientId:bystander.id,victimAuthorized:true})
  assert.deepEqual(disclosure.relatedEventIds,[incident.id])
  assert.ok(bystander.knowledge.some(k=>k.sourceEventId===disclosure.id))
  assert.ok(!bystander.knowledge.some(k=>k.sourceEventId===incident.id))
  assert.ok(buildAgentKnowledgeView(bystander.id,f.world,f.events)!.observedEvents.some(e=>e.id===disclosure.id))
 }finally{await f.close()}
})

test('incident rejects underage, absent, and nonliving participants without changing state',async()=>{
 const f=traumaFixture()
 try{
  f.a.age=20;f.b.age=28
  const before=JSON.stringify(f.world)
  assert.throws(()=>recordOffscreenAssault(f.world,f.events,{eventId:'invalid',perpetratorId:f.a.id,victimId:f.b.id}),/adult_test_only/)
  assert.equal(JSON.stringify(f.world),before)
  f.a.age=30;f.b.publicState.status='deceased'
  assert.throws(()=>recordOffscreenAssault(f.world,f.events,{eventId:'invalid',perpetratorId:f.a.id,victimId:f.b.id}),/participant_not_actionable/)
  assert.equal(f.events.length,0)
 }finally{await f.close()}
})
