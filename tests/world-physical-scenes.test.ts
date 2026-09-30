import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {migrate} from '../server/db/connection.ts'
import {seedDefaultRulePreset} from '../server/domain/rulePresets.ts'
import {createTestIsland} from '../server/domain/studioExample.ts'
import {saveStudio} from '../server/domain/studioStore.ts'
import {getDraft} from '../server/domain/worldDrafts.ts'
import {startWorldFromDraft} from '../server/domain/worldLaunch.ts'
import * as store from '../server/domain/worldStore.ts'
import {config} from '../server/config.ts'
import {beginAction,advanceEngine,validateEngineAction,recordExperience} from '../server/world/worldEngine.ts'
import {DEFAULT_DISPOSITIONS} from '../server/world/dispositions.ts'
import {contextualSpeech,speechContext} from '../server/world/socialVoice.ts'
import {buildAgentKnowledgeView} from '../server/world/knowledgeFilter.ts'
import {storyValidationIssue} from '../server/domain/novelNarration.ts'
import {composeDay} from '../server/domain/storyComposition.ts'
import {judgeRequest} from '../server/domain/worldAgent.ts'
import type {ProposedAction} from '../server/world/actionSchema.ts'
import type {WorldEvent} from '../server/domain/worldTypes.ts'

after(()=>store.stopSimulationTimerForTests())
function fixture(){
 const db=new DatabaseSync(':memory:');migrate(db);seedDefaultRulePreset(db);store.initializeWorldRuntime(db);config.worldDemoMode=true
 const draft=createTestIsland(db),placeId=draft.places[0].id
 draft.studio!.events=[];draft.studio!.items=[{id:'rock',name:'돌',kind:'tool',quantity:2,holderKind:'place',holderId:placeId,localArea:'CENTER',physical:{material:'stone',portable:true,attackPower:1,cover:0}}]
 saveStudio(db,draft.id,draft)
 assert.deepEqual(getDraft(db,draft.id)!.studio!.items[0].physical,draft.studio!.items[0].physical)
 assert.equal(startWorldFromDraft(db,getDraft(db,draft.id)!).ok,true);store.stopSimulationTimerForTests()
 const world=store.getWorldState(),place=world.places.find(p=>p.id===placeId)!
 for(const a of world.agents){a.publicState.locationId=place.id;a.publicState.localArea='CENTER';a.publicState.status='alive';a.body={health:0,injury:0};a.humanState!.fatigue=0;a.emotion!.fear=0;a.relationships=[];a.inventory=[];a.dispositions={...DEFAULT_DISPOSITIONS};a.nextDecisionAt=100}
 world.engine!.combatRng=0
 const events:WorldEvent[]=[]
 const begin=(p:ProposedAction)=>{const check=validateEngineAction(p,world,events);assert.ok(check.approved,check.notes.join(','));events.push(beginAction(world,p))}
 const tick=(n:number)=>advanceEngine(world,n,events,e=>{events.push(e);recordExperience(world,e)})
 const [a,b]=world.agents
 const attack:ProposedAction={actorId:a.id,locationId:place.id,actionType:'ATTACK',targetIds:[b.id],intendedAction:'상대를 공격한다',publicReason:'상대를 물러서게 해 자신의 안전을 확보하려 했다.',pickupItemId:'rock',aim:'HEAD'}
 return {db,draft,world,place,a,b,events,begin,tick,attack,async close(){await store.shutdownWorldRuntime();db.close()}}
}

test('configured ground stone is picked once, used at its actual place and retained with injuries, witnesses and memory',async()=>{
 const f=fixture();try{
  assert.equal(f.world.engine!.objects.filter(o=>o.physical?.material==='stone').length,1)
  const judge=judgeRequest({draft:f.draft,rules:[],mode:'live'},f.attack,f.world,[])
  assert.match(judge.prompt,/"physicalObjects":\[\{"id":"rock"/)
  assert.match(judge.prompt,/"material":"stone"/)
  f.b.dispositions={...DEFAULT_DISPOSITIONS,riskTolerance:10,aggression:10,competitiveness:10}
  f.begin(f.attack);assert.equal(f.world.engine!.objects.find(o=>o.id==='rock')!.quantity,1)
  const held=f.world.engine!.objects.find(o=>o.location.kind==='agent'&&o.location.id===f.a.id)!
  assert.ok(f.a.inventory.includes(held.id));assert.equal(held.quantity,1)
  f.tick(5)
  const e=f.events.find(e=>e.detail?.combat)!,c=e.detail!.combat!
  assert.equal(c.tool.id,held.id);assert.equal(c.tool.source,'ground');assert.equal(c.tool.sourceId,'rock');assert.equal(c.aimedPart,'HEAD')
  assert.equal(c.method,'CONTACT');assert.equal(c.toolAfter!.id,f.a.id)
  assert.ok(storyValidationIssue({paragraphs:[{text:'돌을 던졌다.',eventIds:[e.id]}]},[e]))
  assert.equal(c.reaction.kind,'BLOCK');assert.equal(c.injuredPart,'ARM');assert.equal(c.damage,1)
  assert.equal(f.b.body!.injury,1);assert.equal(f.b.wounds![0].eventId,e.id)
  assert.ok(f.b.relationships.some(r=>r.otherAgentId===f.a.id&&r.stance==='hostile'))
  assert.ok(f.b.memories!.some(m=>m.sourceEventIds.includes(e.id)))
  assert.equal(e.detail!.witnesses!.length,3)
  assert.ok(f.world.agents[2].memories!.some(m=>m.sourceEventIds.includes(e.id)))
  const snapshot=JSON.parse(JSON.stringify(f.world));assert.deepEqual(snapshot.agents[1].wounds,f.b.wounds)
  assert.equal(snapshot.engine.objects.find((o:{id:string})=>o.id===held.id).location.id,f.a.id)
  f.begin({actorId:f.a.id,locationId:f.place.id,actionType:'DROP_ITEM',targetIds:[],usedItemIds:[held.id],intendedAction:'돌을 내려놓는다'});f.tick(5)
  assert.equal(held.location.kind,'place');assert.equal(held.localArea,'CENTER');assert.ok(!f.a.inventory.includes(held.id))
 }finally{await f.close()}
})

test('rich DAY requires recorded dialogue while quiet evidence has no artificial length floor',async()=>{
 const f=fixture();try{
  f.begin(f.attack);f.tick(5)
  const attack=f.events.find(e=>e.detail?.combat)!
  const speech={...attack,id:'speech',detail:undefined,actionType:'SPEAK' as const,publicQuote:'더 다가오지 마세요.',actionResult:'말을 건넸다.'}
  const events=[attack,speech,{...speech,id:'speech2',publicQuote:undefined},{...speech,id:'speech3',publicQuote:undefined}]
  assert.match(storyValidationIssue({paragraphs:[{text:'공격 이후 경고를 건넸다.',eventIds:events.map(e=>e.id)}]},events,'DAY')!,/recorded dialogue/)
  assert.equal(storyValidationIssue({paragraphs:[{text:'“더 다가오지 마세요.”',eventIds:[speech.id]}]},[speech],'DAY'),null)
 }finally{await f.close()}
})

test('absent, remote and immovable objects cannot become attack equipment or possessions',async()=>{
 const f=fixture();try{
  const rock=f.world.engine!.objects[0];rock.localArea='SHORE'
  assert.equal(validateEngineAction(f.attack,f.world,[]).approved,false)
  assert.ok(!buildAgentKnowledgeView(f.a.id,f.world,[])!.visibleObjects!.some(o=>o.id==='rock'))
  rock.localArea='CENTER';rock.physical!.portable=false
  assert.equal(validateEngineAction(f.attack,f.world,[]).approved,false)
  assert.equal(validateEngineAction({...f.attack,actionType:'TAKE_ITEM',pickupItemId:undefined,aim:undefined,targetIds:[],usedItemIds:['rock']},f.world,[]).approved,false)
  f.world.engine!.objects=[];assert.equal(validateEngineAction(f.attack,f.world,[]).approved,false)
  f.begin({...f.attack,pickupItemId:undefined});f.tick(5)
  const e=f.events.find(e=>e.detail?.combat)!
  assert.equal(e.detail!.combat!.tool.name,'맨손')
  assert.ok(storyValidationIssue({paragraphs:[{text:'돌로 머리를 공격했다.',eventIds:[e.id]}]},[e]))
 }finally{await f.close()}
})

test('chosen dodge and blocking cover prevent invented injury; guard checks aim versus actual injury',async()=>{
 for(const kind of ['DODGE','BLOCK'] as const){const f=fixture();try{
  f.begin({actorId:f.b.id,locationId:f.place.id,actionType:'OBSERVE',targetIds:[f.a.id],intendedAction:'공격을 경계한다',publicReason:'다치지 않고 거리를 확보하려 했다.',defense:kind,durationMinutes:30})
  if(kind==='DODGE')f.world.engine!.combatRng=1500
  else f.world.engine!.objects.push({id:'cover',name:'바위턱',kind:'item',quantity:1,condition:'intact',localArea:'CENTER',location:{kind:'place',id:f.place.id},physical:{material:'terrain',portable:false,attackPower:0,cover:2}})
  f.begin(f.attack);f.tick(5)
  const e=f.events.find(e=>e.detail?.combat)!,c=e.detail!.combat!
  assert.equal(c.reaction.source,'chosen_action');assert.equal(c.outcome,kind==='DODGE'?'DODGED':'BLOCKED');assert.equal(c.damage,0);assert.equal(c.injuredPart,null);assert.equal(f.b.body!.injury,0)
  assert.ok(storyValidationIssue({paragraphs:[{text:'공격으로 부상을 입었다.',eventIds:[e.id]}]},[e]))
  assert.equal(storyValidationIssue({paragraphs:[{text:'공격을 피하거나 막아 새 부상은 없었다.',eventIds:[e.id]}]},[e]),null)
 }finally{await f.close()}}
})

test('known age, relationship and anger produce distinct recorded voices without assigning missing ages',async()=>{
 const f=fixture();try{
  f.a.age=20;f.b.age=50
  const older=contextualSpeech(f.world,f.a.id,f.b.id,'물을 나눠 줄 수 있어?');assert.match(older,/주실 수 있나요/)
  f.a.relationships=[{agentId:f.a.id,otherAgentId:f.b.id,stance:'friendly',trust:9,label:'friend'}]
  const familiar=contextualSpeech(f.world,f.a.id,f.b.id,'물을 나눠 줄 수 있어?');assert.notEqual(familiar,older)
  f.a.relationships[0].stance='hostile';f.a.emotion!.anger=8
  assert.match(contextualSpeech(f.world,f.a.id,f.b.id,'다가오지 마.'),/내 말 들어/)
  f.a.age=null;f.b.age=undefined;assert.equal(speechContext(f.a,f.b).speakerAge,null);assert.equal(speechContext(f.a,f.b).listenerAge,null)
  f.begin({actorId:f.a.id,locationId:f.place.id,actionType:'SPEAK',targetIds:[f.b.id],spokenText:familiar,intendedAction:'물을 부탁한다',intent:'REQUEST_HELP'});f.tick(3)
  const e=f.events.find(e=>e.phase==='COMPLETED'&&e.actionType==='SPEAK')!;assert.equal(e.publicQuote,familiar);assert.equal(e.detail!.speech!.speakerAge,null)
 }finally{await f.close()}
})

test('DAY uses engine process without extra elapsed time, and never converts aimed head into injured head',async()=>{
 const f=fixture();try{
  f.b.dispositions={...DEFAULT_DISPOSITIONS,riskTolerance:10,aggression:10,competitiveness:10}
  const start=f.world.engine!.minute;f.begin(f.attack);f.tick(5)
  const e=f.events.find(e=>e.detail?.combat)!
  const chapter=composeDay(1,f.world.seasonId,[e],new Map(f.world.places.map(p=>[p.id,p])),new Map(f.world.agents.map(a=>[a.id,a])),false)!
  assert.ok(chapter);assert.match(JSON.stringify(chapter),/집어 들었다/);assert.match(JSON.stringify(chapter),/막으려 했다/)
  assert.equal(f.world.engine!.minute,start+5)
  assert.ok(storyValidationIssue({paragraphs:[{text:'머리에 부상을 입었다.',eventIds:[e.id]}]},[e]))
 }finally{await f.close()}
})
