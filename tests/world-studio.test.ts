import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
process.env.AI_WORLD_DEMO_MODE='true'
const {migrate}=await import('../server/db/connection.ts')
const {seedDefaultRulePreset}=await import('../server/domain/rulePresets.ts')
const {createTestIsland}=await import('../server/domain/studioExample.ts')
const {saveStudio}=await import('../server/domain/studioStore.ts')
const {getDraft}=await import('../server/domain/worldDrafts.ts')
const {startWorldFromDraft}=await import('../server/domain/worldLaunch.ts')
const {advanceEngine,beginAction,validateEngineAction,selectDecisionAgents}=await import('../server/world/worldEngine.ts')
const {evolveRelationship,processStudio}=await import('../server/world/studioEngine.ts')
const {toPublicWorld}=await import('../server/world/publicView.ts')
const {buildAgentKnowledgeView}=await import('../server/world/knowledgeFilter.ts')
const store=await import('../server/domain/worldStore.ts')
after(()=>store.stopSimulationTimerForTests())
function fixture(){const db=new DatabaseSync(':memory:');migrate(db);seedDefaultRulePreset(db);const draft=createTestIsland(db);assert.equal(startWorldFromDraft(db,draft).ok,true);store.stopSimulationTimerForTests();return{db,draft,world:store.getWorldState()}}

test('studio saves references atomically, keeps existing drafts and separates population from active count',()=>{
 const db=new DatabaseSync(':memory:');migrate(db);seedDefaultRulePreset(db)
 try{const draft=createTestIsland(db),before=getDraft(db,draft.id)!;assert.equal(before.characters.length,5);assert.equal(before.studio!.activeLimit,3);assert.equal(before.studio!.items[0].holderId,before.characters[0].id)
 draft.name='수정';draft.studio!.activeLimit=2;const saved=saveStudio(db,draft.id,draft);assert.equal(saved.name,'수정');assert.equal(saved.characters[0].id,before.characters[0].id)
 const bad=structuredClone(saved);bad.name='저장되면 안 됨';bad.studio!.items[0].holderId='missing';assert.throws(()=>saveStudio(db,draft.id,bad));assert.equal(getDraft(db,draft.id)!.name,'수정');migrate(db);assert.equal(getDraft(db,draft.id)!.name,'수정')
 }finally{db.close()}
})
test('test island initializes real generator state, inventory, private truth and three active characters',()=>{
 const {db,draft,world}=fixture();try{
 assert.equal(world.places.find(p=>p.name==='발전실')!.power,false)
 assert.equal(world.engine!.objects.find(o=>o.name==='손전등')!.location.id,draft.characters[0].id)
 assert.ok(world.agents[0].inventory.includes('island-flashlight'))
 assert.equal(world.agents[0].relationships[0].label,'friend')
 assert.equal(world.agents[0].knowledge.some(k=>k.summary.includes('숨겨진 연구실')),false)
 assert.equal(JSON.stringify(toPublicWorld(world)).includes('숨겨진 연구실'),false)
 for(const a of world.agents)a.nextDecisionAt=0
 assert.equal(selectDecisionAgents(world,3).length,3)
 const actor=world.agents[0],base={actorId:actor.id,locationId:actor.publicState.locationId,targetIds:[],intendedAction:'test'}
 assert.equal(validateEngineAction({...base,actionType:'MOVE',destinationId:'nonexistent'},world,[]).approved,false)
 assert.equal(validateEngineAction({...base,actionType:'USE_ITEM',usedItemIds:['invented']},world,[]).approved,false)
 }finally{db.close()}
})
test('daily rainy weather persists, outdoor exposure accumulates while shelter recovers; state events precede prose',()=>{
 const {db,world}=fixture();try{
 world.engine!.studio!.config.persistence=100
 const actor=world.agents[0],outside=world.places.find(p=>p.name==='외부')!
 actor.publicState.locationId=outside.id
 const events=[] as ReturnType<typeof advanceEngine>
 for(let hour=0;hour<96;hour++){
   // Isolate environmental exposure from starvation: simulate regular feeding/rest.
   actor.vitals!.hunger=0;actor.vitals!.thirst=0;actor.humanState!.fatigue=0
   events.push(...advanceEngine(world,60))
 }
 assert.equal(world.clock.day,5);assert.equal(world.engine!.weather!.weatherDuration,5);assert.equal(world.engine!.weather!.previousWeather,'rain')
 assert.ok(actor.exposure!.wetness>=9);assert.ok(actor.exposure!.weatherExposureDays>=4);assert.ok(actor.exposure!.skinCondition<10)
 assert.ok(events.some(e=>e.cause==='environment_exposure'&&e.stateChanges.some(c=>c.field.endsWith(':skinCondition'))))
 actor.publicState.locationId=world.places[0].id;const wet=actor.exposure!.wetness;advanceEngine(world,60);assert.ok(actor.exposure!.wetness<wet)
 assert.ok(buildAgentKnowledgeView(actor.id,world,events)!.self.exposure)
 }finally{db.close()}
})
test('consumption, information discovery and directional relationship evolution change real state',()=>{
 const {db,world}=fixture();try{
 const a=world.agents[0],b=world.agents[1],warehouse=world.places.find(p=>p.name==='창고')!
 a.publicState.locationId=warehouse.id;warehouse.currentAgentIds.push(a.id)
 const base={actorId:a.id,locationId:warehouse.id,targetIds:[],intendedAction:'test'}
 for(const [actionType,resourceKey] of [['EAT','food'],['DRINK','water']] as const){const before=warehouse.resources.find(r=>r.key===resourceKey)!.level;const action={...base,actionType,resourceKey};assert.ok(validateEngineAction(action,world,[]).approved);beginAction(world,action);advanceEngine(world,15);assert.equal(warehouse.resources.find(r=>r.key===resourceKey)!.level,before-1)}
 const gen=world.places.find(p=>p.name==='발전실')!;a.publicState.locationId=gen.id
 beginAction(world,{...base,locationId:gen.id,actionType:'EXPLORE'});advanceEngine(world,30);assert.ok(a.knowledge.some(k=>k.summary.includes('숨겨진 연구실')))
 assert.equal(b.knowledge.some(k=>k.summary.includes('숨겨진 연구실')),false)
 const changes:import('../server/domain/worldTypes.ts').StateChange[]=[]
 for(let i=0;i<5;i++)evolveRelationship(world,b,a,-2,changes)
 assert.equal(b.relationships.find(r=>r.otherAgentId===a.id)!.label,'hostile');assert.equal(a.relationships.find(r=>r.otherAgentId===b.id)!.label,'friend')
 }finally{db.close()}
})
test('AND/OR endings use engine facts, stop at exact scheduled boundaries and survive serialization',()=>{
 const {db,world}=fixture();try{
 const s=world.engine!.studio!;s.config.endings=[{id:'end',type:'day',value:2,ref:''}]
 advanceEngine(world,1440);assert.equal(world.engine!.studio!.ended,true);assert.equal(world.clock.time,'00:00')
 const restored=JSON.parse(JSON.stringify(world));assert.equal(restored.engine.weather.day,2);assert.ok(restored.engine.studio.firedEvents.includes('generator-stop'))
 s.ended=false;s.config.endMode='AND';s.config.endings.push({id:'goal',type:'goal',ref:'escape',value:0});processStudio(world);assert.equal(s.ended,false);s.goals.push('escape');processStudio(world);assert.equal(s.ended,true)
 }finally{db.close()}
})
