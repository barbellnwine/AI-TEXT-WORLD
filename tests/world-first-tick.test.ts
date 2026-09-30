import test from 'node:test'
import assert from 'node:assert/strict'
import { traumaFixture } from './trauma-fixture.ts'
import * as store from '../server/domain/worldStore.ts'
import { prepareDecision } from '../server/world/decisionController.ts'
import { copyWorldDesign } from '../server/domain/studioStore.ts'
import { startWorldFromDraft } from '../server/domain/worldLaunch.ts'
import type { WorldModelRequest } from '../server/domain/worldAgent.ts'

function mockWorld(){
 let fixture:ReturnType<typeof traumaFixture>
 const brainActors:string[]=[]
 const adapter=async(request:WorldModelRequest)=>{
  if(request.role==='judge')return {raw:{approved:true,reason:'mock approval',ended:false},inputTokens:1,outputTokens:1}
  assert.equal(request.role,'agent')
  const line=request.prompt.split('[YOUR STATE]')[1]?.trimStart().split('\n')[0]
  assert.ok(line)
  const actorId=(JSON.parse(line) as {id:string}).id
  brainActors.push(actorId)
  const choice=prepareDecision(store.getWorldState(),actorId,[]).choices[0]
  assert.ok(choice)
  return {raw:{...choice.action,candidateId:choice.id,targetIds:choice.action.targetIds,usedItemIds:choice.action.usedItemIds??[],publicAction:choice.action.intendedAction,publicReason:'mock first-tick decision'},inputTokens:1,outputTokens:1}
 }
 fixture=traumaFixture(adapter)
 for(const agent of fixture.world.agents)agent.nextDecisionAt=0
 store.setMaxActiveAgents(5);store.setCallBudget(500)
 return {fixture,brainActors}
}

async function drain(){await new Promise<void>(resolve=>setImmediate(resolve))}

test('the registered 60-second scheduler starts exactly one first tick and re-arms its deadline',async t=>{
 const {fixture,brainActors}=mockWorld()
 try{
  store.pauseSeason()
  t.mock.timers.enable({apis:['Date','setInterval'],now:new Date('2026-01-01T00:00:00Z')})
  store.setTickInterval(60_000)
  store.startSeason()
  const before=store.getAdminRuntime()
  assert.equal(before.status,'RUNNING');assert.equal(before.schedulerRegistered,true)
  assert.equal(before.lastTickAt,null);assert.equal(before.nextTickAt,'2026-01-01T00:01:00.000Z')
  t.mock.timers.tick(59_999);await drain()
  assert.equal(brainActors.length,0);assert.equal(store.getAdminRuntime().lastTickAt,null)
  t.mock.timers.tick(1);await drain()
  const after=store.getAdminRuntime()
  assert.ok(after.lastTickAttemptAt);assert.ok(after.lastTickAt)
  assert.equal(after.lastTickResult,'completed')
  assert.ok(brainActors.length>0&&brainActors.length<=5)
  assert.ok(after.pipeline!.brainCalls>0)
  assert.equal(after.nextTickAt,'2026-01-01T00:02:00.000Z')
  assert.equal(after.schedulerRegistered,true)
  store.stopSimulationTimerForTests()
  const unregistered=store.getAdminRuntime()
  assert.equal(unregistered.nextTickAt,'2026-01-01T00:02:00.000Z')
  assert.equal(unregistered.schedulerRegistered,false)
  assert.equal(unregistered.tickSkipReason,'scheduler_not_registered')
 }finally{await fixture.close();t.mock.timers.reset()}
})

test('copy-and-restart removes the old timer, then runs the new season at its own first due time',async t=>{
 const {fixture,brainActors}=mockWorld()
 try{
  store.pauseSeason()
  t.mock.timers.enable({apis:['Date','setInterval'],now:new Date('2026-01-01T00:00:00Z')})
  store.setTickInterval(60_000);store.startSeason()
  const previousId=store.getSeason().id
  t.mock.timers.tick(30_000)
  store.pauseSeason()
  const copy=copyWorldDesign(fixture.db,previousId)
  assert.equal(startWorldFromDraft(fixture.db,copy).ok,true)
  store.setTickInterval(60_000)
  for(const agent of store.getWorldState().agents)agent.nextDecisionAt=0
  const restarted=store.getAdminRuntime()
  assert.notEqual(store.getSeason().id,previousId)
  assert.equal(restarted.status,'RUNNING');assert.equal(restarted.paused,false)
  assert.equal(restarted.schedulerRegistered,true)
  assert.equal(restarted.nextTickAt,'2026-01-01T00:01:30.000Z')
  t.mock.timers.tick(30_000);await drain()
  assert.equal(store.getAdminRuntime().lastTickAt,null,'the previous world timer must not fire')
  assert.equal(brainActors.length,0)
  t.mock.timers.tick(30_000);await drain()
  const after=store.getAdminRuntime()
  assert.ok(after.lastTickAt);assert.ok(after.pipeline!.brainCalls>0)
  assert.equal(after.nextTickAt,'2026-01-01T00:02:30.000Z')
 }finally{await fixture.close();t.mock.timers.reset()}
})
