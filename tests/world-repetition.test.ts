import {storyEvent,consequentialInjuryProgress} from '../server/domain/storyComposition.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {traumaFixture,headInjury} from './trauma-fixture.ts'
import {prepareThreatResponse,beginAction} from '../server/world/worldEngine.ts'
import {resolvePhysicalCombat} from '../server/world/physicalActions.ts'
import {sceneEvidence,collisionGroups} from '../server/domain/sceneEvidence.ts'
import {storyValidationIssue,verifiedStory} from '../server/domain/novelNarration.ts'
import {suggestEnvironmentItems} from '../server/domain/environmentItems.ts'
import {prepareDecision} from '../server/world/decisionController.ts'
import {agentRequest,worldRequestBody} from '../server/domain/worldAgent.ts'
import {getRulePreset} from '../server/domain/rulePresets.ts'
import {combatContext,combatProposalIssue} from '../server/world/traumaAdjudication.ts'
import {initializeModelTrace,traceModel,traceOutcome,listModelTraces} from '../server/domain/modelTrace.ts'
import {deliberation} from '../server/world/motivations.ts'
import type {WorldEvent} from '../server/domain/worldTypes.ts'

test('A: replay retains both original IDs, exact damage and contusions while removing unproven counter and witness prose',()=>{
 const fixture=JSON.parse(readFileSync('tests/fixtures/repetition-scene.json','utf8'))
 const original=fixture.events.filter((e:WorldEvent)=>e.detail?.combat) as WorldEvent[],before=JSON.stringify(original)
 assert.deepEqual(original.map(e=>e.actionId).sort(),['0e62b37f-c2ee-4aa7-9958-2cffe661fd87','51b8c40f-d8a6-4df7-9964-34edc2324715'].sort())
 const projected=original.map(sceneEvidence)
 assert.equal(collisionGroups(projected).length,1)
 for(const e of projected){assert.equal(e.detail!.combat!.damage,1);assert.equal(e.detail!.adjudication!.proposal.injury!.type,'contusion');assert.ok(!e.detail!.steps.some(s=>s.kind==='WITNESS'));assert.doesNotMatch(e.actionResult!,/반격/)}
 assert.equal(JSON.stringify(original),before)
 const raw={paragraphs:[{text:'가벼운 찰과상을 입었다.',eventIds:projected.map(e=>e.id)}]}
 assert.match(storyValidationIssue(raw,projected)!,/injury type/)
 assert.equal(verifiedStory(raw,{approved:true,unsupportedClaims:[]},projected),null)
})

test('B: actual noticed attack links only the responder; simultaneous intentions stay independent',async()=>{
 const f=traumaFixture();try{
  const first=f.attack();prepareThreatResponse(f.world,f.b.id,first.startEventId)
  const reply=f.attack(f.b,f.a)
  assert.equal(reply.responseToActionId,first.id)
  const c1=resolvePhysicalCombat(structuredClone(f.world),structuredClone(first)).detail
  const c2=resolvePhysicalCombat(structuredClone(f.world),structuredClone(reply)).detail
  assert.equal(c1.combat!.reaction.kind,'COUNTER');assert.equal(c2.combat!.reaction.kind,'CONTINUE_ATTACK')
  assert.equal(sceneEvidence({detail:c1} as WorldEvent).detail!.combat!.reaction.kind,'COUNTER');
  assert.equal(c1.exchange!.role,'initiator');assert.equal(c2.exchange!.role,'response');assert.equal(c1.exchange!.id,c2.exchange!.id)
  assert.equal(f.world.agents[2].body!.injury,0)
  f.world.engine!.ongoingActions=[];f.world.engine!.noticedThreats={}
  const a=f.attack();const b=f.attack(f.b,f.a)
  assert.equal(resolvePhysicalCombat(structuredClone(f.world),structuredClone(a)).detail.combat!.reaction.kind,'SIMULTANEOUS')
  assert.equal(b.responseToActionId,undefined)
 }finally{await f.close()}
})

test('B: place-specific environment proposals are explicit, deduplicated, and respect indoor/unknown settings',()=>{
 const places=[{id:'forest',name:'숲',type:'자연',description:'나무가 많다'},{id:'shore',name:'자갈 해안',type:'실외',description:'모래와 바위'},{id:'room',name:'바위 그림 방',type:'실내',description:''},{id:'island',name:'무인도',type:'자연',description:'경쟁자들이 모였다'}]
 const items=suggestEnvironmentItems(places,[])
 assert.equal(items.length,3);assert.ok(items.every(i=>['forest','shore'].includes(i.holderId)));assert.equal(suggestEnvironmentItems(places,items).length,0)
})

test('B: defense and voluntary negotiations remain options; aim has tactical basis and missing objects stay absent',async()=>{
 const f=traumaFixture();try{
  const first=f.attack();prepareThreatResponse(f.world,f.b.id,first.startEventId)
  const choices=deliberation(f.world,f.b.id).choices
  assert.ok(choices.some(c=>c.action.actionType==='SPEAK'&&c.action.intent==='NEGOTIATE'))
  assert.ok(choices.some(c=>c.action.defense==='DODGE'))
  assert.ok(choices.some(c=>c.goal==='DEFEND_SELF'&&c.action.actionType==='ATTACK'&&c.action.aim==='ARM'))
  assert.ok(choices.filter(c=>c.action.pickupItemId).every(c=>f.world.engine!.objects.some(o=>o.id===c.action.pickupItemId)))
  f.world.agents[2].wakeReason='witnessed_conflict';assert.ok(deliberation(f.world,f.world.agents[2].id).choices.some(c=>c.action.actionType==='SPEAK'))
  const p={actionId:first.id,outcome:'HIT' as const,reaction:combatContext(f.world,first).reaction.kind,basis:'test',injury:{...headInjury,severity:1,bleeding:0,pain:2,effects:[{function:'attention' as const,mechanism:'pain' as const,degree:.3,basis:'아픈 부위 때문에 집중하기 어렵다고 판단했다.'}]}}
  assert.equal(combatProposalIssue(f.world,first,p),'pain_effect_disproportionate')
  assert.ok(combatProposalIssue(f.world,first,{...p,injury:{...p.injury,effects:[{...p.injury.effects[0],degree:.1,basis:''}]}}))
 }finally{await f.close()}
})

test('bounded context preserves active wounds and threat, while verbose past logs do not overflow',async()=>{
 const f=traumaFixture();try{
  const attack=f.attack();prepareThreatResponse(f.world,f.b.id,attack.startEventId)
  f.b.memories=Array.from({length:80},(_,i)=>({id:'m'+i,atMinute:i,importance:'high' as const,sourceEventIds:['old'+i],summary:'오래된 사건 기록 '.repeat(100)}))
  const assessment=prepareDecision(f.world,f.b.id,f.events)
  const original=JSON.stringify(f.b)
  const req=agentRequest({draft:f.draft,rules:[],mode:'live'},f.b.id,f.world,f.events,assessment)
  assert.ok(Buffer.byteLength(worldRequestBody(req))<=20000);assert.match(req.prompt,/VISIBLE THREATS/);assert.ok(req.prompt.includes(f.a.id))
  assert.equal(JSON.stringify(f.b),original)
 }finally{await f.close()}
})

test('crowded season keeps its rules and newest event while old history fits without a model call',async()=>{
 const f=traumaFixture();try{
  const first=f.attack();f.tick(5)
  for(let i=0;i<5;i++){
   const extra=structuredClone(f.world.agents[i]);extra.id=`crowd-${i}`;extra.name=`Crowd ${i}`
   f.world.agents.push(extra);f.place.currentAgentIds.push(extra.id)
  }
  const source=f.events.find(e=>e.id===first.startEventId)!
  const history=Array.from({length:30},(_,i)=>({...source,id:`history-${i}`,phase:'COMPLETED' as const,worldMinute:i,actionResult:i===29?'LATEST_WITNESSED_EVENT':'오래된 사건 기록 '.repeat(35),summary:i===29?'LATEST_WITNESSED_EVENT':'오래된 사건 기록 '.repeat(35),agentIds:[f.a.id],witnessIds:[f.a.id]}))
  const rules=getRulePreset(f.db,'preset-realistic-world')!.rules
  const assessment=prepareDecision(f.world,f.a.id,history)
  const before=JSON.stringify({world:f.world,history})
  const request=agentRequest({draft:f.draft,rules,mode:'live'},f.a.id,f.world,history,assessment)
  assert.ok(Buffer.byteLength(worldRequestBody(request))<=18_000)
  assert.match(request.prompt,/\[SEASON RULES\]/)
  assert.match(request.prompt,/LATEST_WITNESSED_EVENT/)
  assert.doesNotMatch(request.prompt,/history-0\b/)
  assert.equal(JSON.stringify({world:f.world,history}),before)
 }finally{await f.close()}
})

test('an unavoidably oversized rule set fails before a paid call without changing the rule text',async()=>{
 const f=traumaFixture();try{
  const base=getRulePreset(f.db,'preset-realistic-world')!.rules
  const rules=[...base,{...base[0],id:'large-fixture-rule',description:'규칙 본문을 보존한다. '.repeat(2500)}]
  const before=JSON.stringify(rules)
  const assessment=prepareDecision(f.world,f.a.id,[])
  assert.throws(()=>agentRequest({draft:f.draft,rules,mode:'live'},f.a.id,f.world,[],assessment),{code:'WORLD_CONTEXT_TOO_LARGE'})
  assert.equal(JSON.stringify(rules),before)
 }finally{await f.close()}
})

test('traces are bounded and redact secrets while retaining raw response/final output in explicit development capture',async()=>{
 const f=traumaFixture();const previous=process.env.AI_WORLD_CAPTURE_TRACE;process.env.AI_WORLD_CAPTURE_TRACE='true'
 try{initializeModelTrace(f.db)
  const request={role:'narrator',provider:'fixture',model:'fixture',prompt:'sk-proj-secret "privateInfo":"private-secret"',schema:{}}
  for(let i=0;i<205;i++)await traceModel(request,async()=>({raw:{ok:true},inputTokens:1,outputTokens:2}))
  traceOutcome(request,'final',false);const traces=listModelTraces();assert.equal(traces.length,200)
  assert.doesNotMatch(JSON.stringify(traces),/sk-proj-secret|private-secret/);assert.ok(traces.some(t=>t.finalOutput==='final'))
 }finally{if(previous===undefined)delete process.env.AI_WORLD_CAPTURE_TRACE;else process.env.AI_WORLD_CAPTURE_TRACE=previous;await f.close()}
})
import {buildAgentKnowledgeView} from '../server/world/knowledgeFilter.ts'
import {selectDecisionContext} from '../server/world/contextSelection.ts'
import {narrativeSceneUnits} from '../server/domain/sceneEvidence.ts'
import {buildNarratorPrompt} from '../server/prompts/narratorPrompt.ts'
import {mockNarrator} from '../server/domain/narrator.ts'
import type {Agent,Place} from '../server/domain/worldTypes.ts'

function replayFor(f:ReturnType<typeof traumaFixture>){
 const fixture=JSON.parse(readFileSync('tests/fixtures/repetition-scene.json','utf8'))
 let json=JSON.stringify(fixture.events.filter((e:WorldEvent)=>e.detail?.combat))
 json=json.replaceAll('a504e099-defc-4429-b628-439fb90dc8f0',f.a.id).replaceAll('fd1b97dc-a690-4364-bbe7-a998156c4108',f.b.id)
 const events=JSON.parse(json) as WorldEvent[]
 for(const e of events)e.placeId=f.place.id
 f.world.engine!.minute=250
 return events
}

test('recent evidence is order independent, retains wound/failure/response through transport trimming, and excludes private facts',async()=>{
 const f=traumaFixture();try{
  const combat=replayFor(f),injury=combat.find(e=>e.detail!.combat!.targetId===f.a.id)!
  const failure:WorldEvent={...combat[0],id:'latest-failure',detail:undefined,worldMinute:247,agentIds:[f.a.id],phase:'FAILED',actionType:'EXPLORE',summary:'다른 구역 탐색 실패',stateChanges:[]}
  const reply:WorldEvent={...failure,id:'actual-refusal',worldMinute:249,phase:'COMPLETED',actionType:'SPEAK',agentIds:[f.b.id,f.a.id],publicQuote:'그 제안은 거절하겠어.',stateChanges:[{field:'interaction:offer:status',from:'pending',to:'refused'}]}
  const secret:WorldEvent={...reply,id:'private-other',worldMinute:250,visibility:'private',agentIds:[f.b.id],publicQuote:'SECRET_OTHER_QUOTE',stateChanges:[]}
  const old=Array.from({length:12},(_,i)=>({...combat[0],id:'old-'+i,worldMinute:i}))
  const events=[...old,...combat,failure,reply,secret]
  f.b.hiddenNotes='SECRET_OTHER_NOTES';f.b.memories=[{id:'private-memory',atMinute:250,importance:'high',summary:'SECRET_OTHER_MEMORY',sourceEventIds:[]}]
  f.world.engine!.outcomes={[f.a.id]:[{eventId:failure.id,minute:247,actionType:'EXPLORE',area:'CENTER',summary:failure.summary,failed:true}]}
  const view=selectDecisionContext(buildAgentKnowledgeView(f.a.id,f.world,events)!)
  const reversed=selectDecisionContext(buildAgentKnowledgeView(f.a.id,f.world,[...events].reverse())!)
  assert.deepEqual(view.observedEvents.map(e=>e.id),reversed.observedEvents.map(e=>e.id))
  for(const id of [injury.id,failure.id,reply.id])assert.ok(view.decisionEvidence!.some(e=>e.eventId===id))
  assert.ok(view.observedEvents.find(e=>e.id===injury.id)!.stateChanges.some(c=>c.field===`agent:${f.a.id}:trauma`))
  assert.ok(view.decisionEvidence!.some(e=>e.quote===reply.publicQuote))
  assert.doesNotMatch(JSON.stringify(view),/SECRET_OTHER/)
  assert.ok(!view.observedEvents.some(e=>e.id==='old-0'))
  const req=agentRequest({draft:f.draft,rules:[],mode:'live'},f.a.id,f.world,events,prepareDecision(f.world,f.a.id,events))
  const protectedText=req.prompt.split('[PROTECTED RECENT OUTCOMES — retain for next choice]')[1].split('[CLOCK]')[0]
  for(const id of [injury.id,failure.id,reply.id])assert.ok(protectedText.includes(id))
  assert.ok(Buffer.byteLength(worldRequestBody(req))<=20000)
  assert.doesNotMatch(req.prompt,/SECRET_OTHER/)
 }finally{await f.close()}
})

test('stored collision outcomes change costs and motives; aggression can continue, caution negotiates, wounds favor treatment',async()=>{
 const f=traumaFixture();try{
  const events=replayFor(f),before=JSON.stringify(events)
  f.world.engine!.context={genre:'배틀로얄',background:''};f.a.relationships=[{agentId:f.a.id,otherAgentId:f.b.id,stance:'hostile',hostility:5,trust:0}]
  f.a.dispositions={selfInterest:8,empathy:0,trust:0,competitiveness:10,riskTolerance:10,aggression:10,negotiation:0,impulsivity:8}
  f.a.body!.injury=2
  const source=events.find(e=>e.detail!.combat!.targetId===f.a.id)!.stateChanges.find(c=>c.field.endsWith(':trauma'))!
  f.a.trauma=JSON.parse(source.to)
  const noHistory=deliberation(f.world,f.a.id),after=deliberation(f.world,f.a.id,events)
  const score=(d:ReturnType<typeof deliberation>,type:string)=>Math.max(...d.choices.filter(c=>c.action.actionType===type).map(c=>c.score))
  assert.ok(score(after,'ATTACK')<score(noHistory,'ATTACK'))
  assert.ok(score(after,'OBSERVE')>score(noHistory,'OBSERVE'))
  assert.ok(['ATTACK','TAKE_ITEM'].includes(after.choices[0].action.actionType),'a willing rival may continue or prepare with a visible tool')
  assert.ok(after.choices.find(c=>c.action.actionType==='ATTACK')!.evidenceEventIds.length)
  assert.notEqual(after.choices.find(c=>c.action.actionType==='ATTACK')!.action.publicReason,noHistory.choices.find(c=>c.action.actionType==='ATTACK')!.action.publicReason)
  const misses=structuredClone(events)
  for(const e of misses)if(e.detail!.combat!.attackerId===f.a.id){e.detail!.combat!.outcome='DODGED';e.detail!.combat!.damage=0}
  assert.ok(score(deliberation(f.world,f.a.id,misses),'ATTACK')<score(after,'ATTACK'))
  f.a.dispositions={...f.a.dispositions,aggression:0,riskTolerance:0,empathy:10,negotiation:10,impulsivity:0,competitiveness:0}
  const cautious=deliberation(f.world,f.a.id,events)
  assert.equal(cautious.choices[0].goal,'DEESCALATE')
  f.place.resources.push({key:'medicine',label:'의약품',level:2,max:2,unit:'개',trend:'stable'})
  f.a.trauma!.pain=6
  assert.equal(deliberation(f.world,f.a.id,events).choices[0].goal,'TREAT_INJURY')
  assert.equal(JSON.stringify(events),before)
 }finally{await f.close()}
})

test('DAY scene units keep both saved strikes together and reject split actor retellings without new facts',()=>{
 const f=JSON.parse(readFileSync('tests/fixtures/repetition-scene.json','utf8'))
 const events=(f.events as WorldEvent[]).filter(e=>e.detail?.combat).map(sceneEvidence),before=JSON.stringify(f.events)
 const units=narrativeSceneUnits([...events].reverse());assert.equal(units.length,1);assert.equal(units[0].eventIds.length,2)
 const split={paragraphs:events.map(e=>({eventIds:[e.id],text:'몸통에 타박상을 입었다.'}))}
 assert.match(storyValidationIssue(split,events,'DAY')!,/Split collision/)
 const grouped={paragraphs:[{eventIds:events.map(e=>e.id),text:'두 사람은 각자 주먹을 뻗었다. 서로의 몸통에 타박상을 남겼다. 출혈은 없었다.'}]}
 assert.equal(storyValidationIssue(grouped,events,'DAY'),null)
 const agents=new Map<string,Agent>(f.agents.map((a:Agent)=>[a.id,a])),places=new Map<string,Place>(f.places.map((p:Place)=>[p.id,p]))
 const prompt=buildNarratorPrompt(events,places,agents,'','DAY')
 assert.match(prompt,/SCENE UNITS/);assert.match(prompt,/Do not restart the encounter/)
 const prose=mockNarrator.narrateFallbackScene(events,places,agents).body
 assert.doesNotMatch(prose,/반격|찰과상|안전에 위협/)
 assert.equal((prose.match(/각자 주먹을 한 번씩/g)??[]).length,1)
 assert.equal(JSON.stringify(f.events),before)
})
import {splitNarrativeScenes} from '../server/domain/sceneEvidence.ts'
import {composeDay,validateEditorialPlan} from '../server/domain/storyComposition.ts'
test('DAY size/section boundaries never divide a linked encounter or reclassify separate later combat',()=>{
 const f=JSON.parse(readFileSync('tests/fixtures/repetition-scene.json','utf8'))
 const events=(f.events as WorldEvent[]).filter(e=>e.detail?.combat).map(sceneEvidence)
 events[0].detail!.exchange={id:'shared-exchange',role:'initiator'}
 events[1].detail!.exchange={id:'shared-exchange',role:'response',responseToActionId:events[0].actionId,noticedEventId:'notice'}
 events[1].worldMinute=246
 assert.equal(splitNarrativeScenes(events),null)
 assert.equal(validateEditorialPlan({paragraphs:events.map(e=>[e.id])},events),null)
 const before=Array.from({length:7},(_,i)=>({...events[0],id:'lead-'+i,detail:undefined,worldMinute:230+i,actionType:'SPEAK',summary:'기록된 행동',actionResult:'기록된 행동',stateChanges:[]}))
 const split=splitNarrativeScenes([...before,...events])!
 assert.ok(split.some(part=>events.every(e=>part.some(p=>p.id===e.id))))
 const agents=new Map<string,Agent>(f.agents.map((a:Agent)=>[a.id,a])),places=new Map<string,Place>(f.places.map((p:Place)=>[p.id,p]))
 const chapter=composeDay(1,'offline',[...before,...events],places,agents,false)!
 // Distinct timestamps must not become a falsely simultaneous strike.
 assert.doesNotMatch(chapter.body,/같은 시각/)
 assert.ok(chapter.sourceEventIds.includes(events[0].id)&&chapter.sourceEventIds.includes(events[1].id))
 const unrelated={...structuredClone(events[0]),id:'later',worldMinute:900,detail:{...events[0].detail!,exchange:undefined}}
 assert.equal(narrativeSceneUnits([...events,unrelated]).length,2)
})

test('minor injury progression stays in the ledger but does not become a LIVE or DAY scene',()=>{
 const raw=JSON.parse(readFileSync('tests/fixtures/repetition-scene.json','utf8')).events.find((e:WorldEvent)=>e.detail?.combat) as WorldEvent
 const before={bloodLoss:0,pain:2,functions:{mobility:.3}},after={bloodLoss:0,pain:2.1,functions:{mobility:.31}}
 const make=(a:object,b:object)=>({...raw,id:'progression',cause:'injury_progression',phase:'STATE_UPDATE' as const,detail:undefined,stateChanges:[{field:`agent:${raw.agentIds[0]}:trauma`,from:JSON.stringify(a),to:JSON.stringify(b)}]})
 const minor=make(before,after);assert.equal(storyEvent(minor),false)
 assert.equal(minor.stateChanges.length,1) // Original state record remains intact.
 const serious=make(before,{...after,functions:{mobility:.6}});assert.equal(consequentialInjuryProgress(serious),true)
 assert.equal(storyEvent({...minor,cause:'injury_deterioration_death'}),true)
})

test('intro cannot erase explicitly recorded prior relationships',()=>{
 const intro=(JSON.parse(readFileSync('tests/fixtures/repetition-scene.json','utf8')).events as WorldEvent[]).find(e=>e.worldMinute===0)!
 assert.match(intro.summary,/\uAE30\uC874 \uAD00\uACC4\uB97C \uAC00\uC9C4/)
 assert.match(storyValidationIssue({paragraphs:[{eventIds:[intro.id],text:'\uAE30\uC874\uC758 \uAD00\uACC4\uAC00 \uD615\uC131\uB418\uC5B4 \uC788\uC9C0 \uC54A\uC558\uB2E4.'}]},[intro])!,/prior relationships/)
})

test('DAY rejects an attack described before an earlier recorded warning',()=>{
 const fixture=JSON.parse(readFileSync('tests/fixtures/repetition-scene.json','utf8'))
 const attack=(fixture.events as WorldEvent[]).find(e=>e.detail?.combat)!
 const warning={...attack,id:'warning-earlier',detail:undefined,worldMinute:attack.worldMinute!-4,actionType:'SPEAK',publicQuote:undefined,stateChanges:[],summary:'warning'}
 const wrong={paragraphs:[{eventIds:[attack.id],text:'????.'},{eventIds:[warning.id],text:'????.'}]}
 assert.match(storyValidationIssue(wrong,[warning,attack],'DAY')!,/scene order/)
})
