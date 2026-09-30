import test from 'node:test'
import assert from 'node:assert/strict'
import { traumaFixture } from './trauma-fixture.ts'
import * as store from '../server/domain/worldStore.ts'
import { config } from '../server/config.ts'
import type { WorldModelRequest } from '../server/domain/worldAgent.ts'
import type { WorldObject } from '../server/world/engineTypes.ts'
import { buildAgentKnowledgeView } from '../server/world/knowledgeFilter.ts'

function section<T>(prompt:string,label:string):T {
 const marker=prompt.split('\n').find(line=>line.startsWith(`[${label}`))
 const value=marker?prompt.slice(prompt.indexOf(marker)+marker.length).trimStart().split('\n')[0]:undefined
 if(!value)throw new Error(`missing ${label}`)
 return JSON.parse(value) as T
}
const ref=(kind:'object'|'character'|'place',reference:string)=>({kind,reference})

test('five-agent mini-season keeps one shared world across many Brain/Planner cycles',async()=>{
 let f:ReturnType<typeof traumaFixture>
 const priorCooldown=config.worldDecisionCooldownMs
 const brainByActor=new Map<string,{goal:string;method:string}>()
 const opportunities=new Map<string,number>()
 const seenPeople=new Set<string>()
 const observedPlan=new Map<string,string[]>()
 const transitions=new Set<string>()
 const postInjuryBrain=new Set<string>()
 const calls:string[]=[]
 const adapter=async(request:WorldModelRequest)=>{
  calls.push(request.role)
  if(request.role==='judge'&&Object.hasOwn(request.schema.properties??{},'results')){
   const tasks=f.world.engine!.ongoingActions.filter(t=>['ATTACK','ROB'].includes(t.proposal.actionType)&&t.completesMinute<=f.world.engine!.minute&&!t.adjudication)
   return {raw:{results:tasks.map(t=>({actionId:t.id,outcome:'HIT',injury:{part:t.proposal.aim??'TORSO',site:'general',type:'contusion',severity:1,bleeding:0,pain:1,healingHours:12,effects:[]},basis:'Mock consequence grounded in the existing attack and target.'}))},inputTokens:1,outputTokens:1}
  }
  if(request.role==='judge')return {raw:{approved:true,reason:'mock valid action',ended:false},inputTokens:1,outputTokens:1}
  const self=section<{id:string;inventory:string[];locationId:string;localArea:string;body:{injury:number};wakeReason?:string}>(request.prompt,'YOUR STATE')
  const people=section<Array<{id:string;name:string}>>(request.prompt,'VISIBLE PEOPLE')
  if(people.length)seenPeople.add(self.id)
  const planText=request.prompt.split('[CURRENT GOAL AND PLAN]')[1]?.split('[CLOCK]')[0]??''
  if(planText.includes('freePlan'))observedPlan.set(self.id,[...(observedPlan.get(self.id)??[]),planText])
  const context=section<{lastResult?:{result:string};recentFailures?:Array<{actionType:string}>}>(request.prompt,'CURRENT GOAL AND PLAN')
  const index=f.world.agents.findIndex(a=>a.id===self.id)
  const agent=f.world.agents[index]
  if(request.role==='agent'){
   if(self.body.injury>0)postInjuryBrain.add(self.id)
   opportunities.set(self.id,(opportunities.get(self.id)??0)+1)
   const goals=['secure scarce food','secure water after competition','make useful object from existing matter','understand another survivor','survive contact with rivals']
   const goal=self.wakeReason==='visible_attack_attempt'?'protect myself':
    index===1&&agent.v2?.recentActions.some(a=>a.actionType==='DRINK'&&a.result==='completed')?'monitor survivors':
    index===2&&agent.inventory.some(id=>f.world.engine!.objects.some(o=>o.id===id&&o.provenance?.transformation==='combine'&&o.concealedBy===agent.id))?'remain safe':
    index===4&&agent.v2?.recentActions.some(a=>a.actionType==='ATTACK'&&a.result==='completed')?'reassess the rival':goals[index]
   const method=self.wakeReason==='visible_attack_attempt'?'block the incoming attack':`adapt to current state with method ${index}`
   brainByActor.set(self.id,{goal,method})
   return {raw:{goal,purpose:'respond to current evidence',method,targetId:null,placeId:null,objectIds:[],desiredOutcome:'observable world change',longerTermPlan:'reassess after consequence'},inputTokens:1,outputTokens:1}
  }
  assert.equal(request.role,'planner')
  assert.ok(brainByActor.has(self.id))
  const here=section<Array<{id:string;name:string;physical?:{material?:string}}>>(request.prompt,'EXISTING OBJECTS HERE')
  const owned=self.inventory.map(id=>f.world.engine!.objects.find(o=>o.id===id)).filter((o):o is WorldObject=>Boolean(o))
  let step:Record<string,unknown>={actionType:'OBSERVE',intendedAction:'observe current situation',targetRefs:[],objectRefs:[],destinationRef:null}
  if(self.wakeReason==='visible_attack_attempt')step={...step,actionType:'OBSERVE',defense:'BLOCK',targetRefs:people.length?[ref('character',people[0].name)]:[]}
  else if(index===0){
   if(owned.some(o=>o.kind==='food'))step={...step,actionType:'USE_ITEM',objectRefs:[ref('object',owned.find(o=>o.kind==='food')!.name)]}
   else if(here.some(o=>o.name==='식량'))step={...step,actionType:'TAKE_ITEM',objectRefs:[ref('object','food')]}
   else step={...step,actionType:'REST'}
  }else if(index===1){
   if(owned.some(o=>o.kind==='food'))step={...step,actionType:'USE_ITEM',objectRefs:[ref('object',owned.find(o=>o.kind==='food')!.name)]}
   else if(here.some(o=>o.name==='식량'))step={...step,actionType:'TAKE_ITEM',targetRefs:[ref('object','식량')]}
   else if(self.locationId===f.place.id)step={...step,actionType:'MOVE',destinationRef:'샘터',durationMinutes:10}
   else if(f.world.places.find(p=>p.id===self.locationId)?.resources.some(r=>r.key==='water'&&r.level>0))step={...step,actionType:'DRINK',resourceKey:'water'}
   else step={...step,actionType:'REST'}
  }else if(index===2){
   const piece=owned.find(o=>o.provenance?.transformation==='separate')
   const altered=owned.find(o=>o.provenance?.transformation==='alter')
   const combined=owned.find(o=>o.provenance?.transformation==='combine')
   if(piece&&!f.world.engine!.objects.some(o=>o.provenance?.transformation==='separate'&&o.location.kind==='place'))step={...step,actionType:'DROP_ITEM',objectRefs:[ref('object',piece.id)]}
   else if(piece)step={...step,actionType:'OBSERVE'}
   else if(altered)step={...step,actionType:'INTERACT',interaction:{operation:'separate',sourceObjectIds:[altered.name],resultName:'조각',resultForm:'pieces',materials:['wood','stone'],quantity:2}}
   else if(combined)step={...step,actionType:'INTERACT',interaction:{operation:'alter',sourceObjectIds:[combined.name],resultName:'변형 물체',resultForm:'reshaped',materials:['wood','stone'],quantity:1}}
   else if(owned.some(o=>o.name==='나무')&&owned.some(o=>o.name==='돌'))step={...step,actionType:'INTERACT',interaction:{operation:'combine',sourceObjectIds:['나무','내 돌'],resultName:'결합 물체',resultForm:'joined',materials:['wood','stone'],quantity:1}}
   else if(here.some(o=>o.name==='나무')&&!owned.some(o=>o.name==='나무'))step={...step,actionType:'TAKE_ITEM',objectRefs:[ref('object','나무')]}
   else if(here.some(o=>o.name==='돌'))step={...step,actionType:'TAKE_ITEM',objectRefs:[ref('object',context.recentFailures?.some(f=>f.actionType==='GROUNDING')?'가까운 돌':'돌')]}
   else step={...step,actionType:'OBSERVE'}
  }else if(index===3){
   if(f.world.agents[1].publicState.locationId!==self.locationId&&!context.recentFailures?.some(f=>f.actionType==='GROUNDING'))step={...step,actionType:'SPEAK',targetRefs:[ref('character',f.world.agents[1].name)],spokenText:'이동한 사람에게 다시 묻는다.'}
   else if(self.body.injury>0)step={...step,actionType:'REST'}
   else if(people.length&&!agent.v2?.recentActions.some(a=>a.actionType==='SPEAK'))step={...step,actionType:'SPEAK',targetRefs:[ref('character',people[0].name)],spokenText:'지금 상황을 확인하자.'}
   else step={...step,actionType:'REST'}
  }else if(index===4){
   const weapon=owned.find(o=>(o.physical?.attackPower??0)>0)
   if(!weapon&&here.some(o=>o.name==='무기용 돌'))step={...step,actionType:'TAKE_ITEM',objectRefs:[ref('object','무기용 돌')]}
   else if(people.length&&weapon&&!agent.v2?.recentActions.some(a=>a.actionType==='ATTACK'&&a.minute>=f.world.engine!.minute-30))step={...step,actionType:'ATTACK',targetRefs:[ref('character',people[0].name)],objectRefs:[ref('object',weapon.name)],aim:'TORSO'}
   else step={...step,actionType:'REST'}
  }
  const steps=[step]
  if(index===2&&step.actionType==='INTERACT'&&(step.interaction as {operation?:string})?.operation==='combine')steps.push({actionType:'INTERACT',intendedAction:'reshape the product after creation',interaction:{operation:'alter',sourceObjectIds:['결합 물체'],resultName:'변형 물체',resultForm:'reshaped',materials:['wood','stone'],quantity:1}})
  return {raw:{steps},inputTokens:1,outputTokens:1}
 }
 f=traumaFixture(adapter)
 try{
  config.worldDecisionCooldownMs=-1
  store.setMaxActiveAgents(5)
  const place=f.place,other=f.world.places.find(p=>p.id!==place.id&&place.connectedPlaceIds.includes(p.id))!
  other.name='샘터'
  for(const edge of f.world.engine!.connections)if([edge.fromPlaceId,edge.toPlaceId].includes(place.id)&&[edge.fromPlaceId,edge.toPlaceId].includes(other.id))edge.travelMinutes=18
  const make=(id:string,name:string,kind:WorldObject['kind'],material:string,quantity=1,power=0):WorldObject=>({id,name,kind,quantity,condition:'intact',location:{kind:'place',id:place.id},localArea:'CENTER',position:{x:.5,y:.5},physical:{material,portable:true,attackPower:power,cover:0}})
  f.world.engine!.objects.push(make('scarce-food','식량','food','organic'),make('raw-wood','나무','tool','wood'),make('raw-stone','돌','tool','stone',1,1),make('extra-stone','돌','tool','stone',1,1),make('weapon-stone','무기용 돌','tool','stone',1,2))
  f.world.engine!.objects.find(o=>o.id==='extra-stone')!.position={x:.55,y:.5}
  other.resources.push({key:'water',label:'식수',unit:'회',level:1,max:1,trend:'stable'})
  for(const actor of f.world.agents)actor.nextDecisionAt=0
  let ticks=0
  for(let tick=0;tick<22;tick++){
   if(store.getAdminRuntime().status!=='RUNNING')break
   await store.runWorldTick()
   ticks++
   for(const actor of f.world.agents)if(actor.v2?.decisionV3?.transition)transitions.add(actor.v2.decisionV3.transition)
   const completed=f.world.agents.flatMap(a=>a.v2?.recentActions??[]).filter(a=>a.result==='completed')
   if(ticks>=12&&store.getAdminRuntime().pipeline!.groundingFailures>=2&&f.world.engine!.objects.some(o=>o.provenance?.transformation==='separate'&&o.location.kind==='place')&&
     f.world.agents.some(a=>(a.body?.injury??0)>0)&&other.resources.find(r=>r.key==='water')?.level===0&&
     completed.some(a=>a.actionType==='MOVE')&&completed.some(a=>a.actionType==='SPEAK'))break
  }
  const stats=store.getAdminRuntime().pipeline!
  const objects=f.world.engine!.objects
  const completed=f.world.agents.flatMap(a=>a.v2?.recentActions??[]).filter(a=>a.result==='completed')
  const audits=store.listActionAudit()
  const derived=objects.filter(o=>o.provenance)
  const summary={ticks,opportunities:f.world.agents.map((a,index)=>({agent:index+1,decisions:opportunities.get(a.id)??0})),stats,transitions:[...transitions],postInjuryBrain:postInjuryBrain.size,derived:derived.map(o=>o.provenance?.transformation),rejected:audits.filter(e=>e.outcome==='REJECTED').map(e=>e.engineVerdict)}
  console.log('MINI_SEASON',JSON.stringify(summary))
  assert.equal(store.getAdminRuntime().status,'RUNNING')
  assert.equal(opportunities.size,5)
  assert.ok([...opportunities.values()].every(n=>n>=2))
  assert.ok(stats.groundingSuccesses>0)
  assert.ok(stats.completedActions>0)
  assert.ok(seenPeople.size>=3)
  assert.ok(completed.some(a=>a.actionType==='MOVE'))
  assert.ok(completed.some(a=>a.actionType==='SPEAK'))
  assert.ok(completed.some(a=>a.actionType==='ATTACK'))
  assert.ok(completed.some(a=>a.actionType==='INTERACT'))
  assert.ok(['combine','alter','separate'].every(kind=>derived.some(o=>o.provenance?.transformation===kind)))
  assert.ok(derived.some(o=>o.provenance?.transformation==='separate'&&o.location.kind==='place'))
  assert.equal(objects.find(o=>o.id==='raw-wood')?.quantity,0)
  assert.equal(objects.find(o=>o.id==='raw-stone')?.quantity,0)
  assert.ok(derived.filter(o=>o.provenance?.transformation==='separate').every(o=>o.provenance!.sourceObjectIds.every(id=>objects.some(source=>source.id===id))))
  const dropped=derived.find(o=>o.provenance?.transformation==='separate'&&o.location.kind==='place')!
  assert.ok(buildAgentKnowledgeView(f.world.agents[3].id,f.world,store.listEvents({offset:0,limit:100}).items)?.visibleObjects?.some(o=>o.id===dropped.id))
  assert.equal(objects.find(o=>o.id==='scarce-food')?.quantity,0)
  assert.equal(other.resources.find(r=>r.key==='water')?.level,0)
  assert.ok(f.world.agents.some(a=>(a.body?.injury??0)>0))
  assert.ok([...postInjuryBrain].some(id=>(f.world.agents.find(a=>a.id===id)?.body?.injury??0)>0))
  assert.ok(transitions.has('CONTINUE'))
  assert.ok(transitions.has('ABANDON'))
  assert.ok(f.world.agents.every(a=>a.memories.length>0))
  assert.ok(f.world.agents.some(a=>a.relationships.some(r=>(r.hostility??0)>0||r.stance==='hostile')))
  assert.ok(f.world.agents[2].v2!.recentActions.filter(a=>a.actionType==='TAKE_ITEM'&&a.result==='completed').length>=2)
  assert.ok(audits.some(e=>e.engineVerdict?.includes('object_reserved')))
  assert.ok(audits.some(e=>e.engineVerdict?.includes('character:not_perceived')))
  assert.ok(audits.some(e=>e.engineVerdict?.includes('object:ambiguous')))
  assert.ok(stats.groundingFailures>=2)
  assert.ok(stats.validationAccepted>=stats.completedActions)
  assert.ok(stats.acceptedActions>=stats.completedActions)
  assert.ok(stats.brainCalls>=opportunities.size)
  assert.ok(stats.plannerCalls>=stats.groundingSuccesses)
  assert.ok([...observedPlan.values()].some(entries=>entries.some(entry=>entry.includes('futureSteps'))))
 }finally{config.worldDecisionCooldownMs=priorCooldown;await f.close()}
})
