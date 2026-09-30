import test from 'node:test'
import assert from 'node:assert/strict'
import type {Agent,Place,WorldEvent} from '../server/domain/worldTypes.ts'
import {actionTrace,groupNarrativeScenes,scenePeople,splitNarrativeScenes} from '../server/domain/sceneEvidence.ts'
import {buildNarratorPrompt} from '../server/prompts/narratorPrompt.ts'
import {mockNarrator} from '../server/domain/narrator.ts'
import {storyEvent} from '../server/domain/storyComposition.ts'

const places=new Map<string,Place>([['beach',{id:'beach',name:'해변',description:'모래 해변'} as Place],['forest',{id:'forest',name:'숲',description:'나무가 있는 숲'} as Place]])
const agent=(id:string,name:string):Agent=>({id,name,shortBio:'말수가 적고 조심스럽다',inventory:[],memories:[],relationships:[],publicState:{locationId:'forest',status:'alive',visibleGoal:'자원 찾기'}} as Agent)
const a=agent('a','가람'),b=agent('b','보람'),c=agent('c','다온')
const agents=new Map([[a.id,a],[b.id,b],[c.id,c]])
const event=(id:string,minute:number,actorIds:string[],type:string,placeId='forest'):WorldEvent=>({id,day:1,worldMinute:minute,worldTime:'01:00',occurredAt:'2026-01-01T01:00:00Z',type:type==='SPEAK'?'DIALOGUE':'RESOURCE_CHANGE',phase:'COMPLETED',actionType:type,placeId,agentIds:actorIds,title:id,summary:`${id} 결과`,actionResult:`${id} 결과`,actionMotive:'식수를 찾기 위해',stateChanges:[],importance:'normal',relatedEventIds:[],outcome:'CONFIRMED',detail:{version:1,startedMinute:minute-60,endedMinute:minute,intent:type,steps:[]}})

test('long MOVE and EXPLORE expose bounded action traces and fallback has a beginning and outcome',()=>{
 const move=event('move',60,['a'],'MOVE');move.stateChanges=[{field:'agent:a:location',from:'beach',to:'forest'}]
 const explore=event('search',130,['a'],'EXPLORE');explore.actionResult='가람은 숲을 살폈지만 발견하지 못했다.'
 const before=structuredClone([move,explore])
 const trace=actionTrace(move,places)
 assert.equal(trace.durationMinutes,60);assert.equal(trace.fromPlaceId,'beach');assert.equal(trace.toPlaceId,'forest');assert.equal(trace.routeRecorded,false)
 const prompt=buildNarratorPrompt([move,explore],places,agents)
 assert.match(prompt,/"durationMinutes":60/);assert.match(prompt,/나무가 있는 숲/);assert.match(prompt,/발견하지 못했다/)
 const scene=mockNarrator.narrateFallbackScene([move,explore],places,agents)
 assert.match(scene.body,/해변/);assert.match(scene.body,/숲/);assert.match(scene.body,/60분/);assert.match(scene.body,/발견하지 못했다/)
 assert.doesNotMatch(scene.body,/Brain|Planner|Grounding|WorldEvent|WORLD STATE|뇌의 의도/)
 assert.deepEqual([move,explore],before)
})

test('prior dialogue memory and relationship reach only involved people; unrelated inventory stays out',()=>{
 a.memories=[{id:'prior',summary:'보람과 식수 분배를 논의했으나 답을 듣지 못했다.',sourceEventIds:['old'],importance:'high',atMinute:10},{id:'other',summary:'다온에게 물었다.',sourceEventIds:['else'],importance:'normal',atMinute:15}]
 a.relationships=[{agentId:'a',otherAgentId:'b',stance:'wary',trust:2,note:'분배 조건 미합의'}]
 a.inventory=['knife','food'];const talk=event('talk',80,['a','b'],'SPEAK');talk.publicQuote='물은 어떻게 나눌까요?'
 const people=scenePeople([talk],agents,[{id:'knife',name:'단검'},{id:'food',name:'식량'}])
 assert.match(JSON.stringify(people),/식수 분배/);assert.doesNotMatch(JSON.stringify(people),/다온에게/)
 assert.match(JSON.stringify(people),/분배 조건 미합의/);assert.deepEqual(people[0].relevantInventory,[])
 talk.stateChanges=[{field:'object:knife:holder',from:'a',to:'b'}]
 assert.deepEqual(scenePeople([talk],agents,[{id:'knife',name:'단검'}])[0].relevantInventory,[{id:'knife',name:'단검'}])
 const prompt=buildNarratorPrompt([talk],places,agents)
 assert.match(prompt,/식수 분배/);assert.doesNotMatch(prompt,/다온에게 물었다/)
})

test('linked encounter remains one unit across context splitting',()=>{
 const first=event('hit',20,['a','b'],'ATTACK'),second=event('response',21,['b','a'],'ATTACK');second.relatedEventIds=['hit']
 const remote=event('remote',22,['c'],'EXPLORE','beach')
 assert.deepEqual(groupNarrativeScenes([first,second,remote]).map(g=>g.map(e=>e.id)),[['hit','response'],['remote']])
 assert.deepEqual(splitNarrativeScenes([first,second,remote])?.map(g=>g.map(e=>e.id)),[['hit','response'],['remote']])
})

test('a completed long observation remains eligible for a scene without changing its result',()=>{
 const observe=event('watch',60,['a'],'OBSERVE');observe.actionResult='가람은 주변을 관찰했지만 아무도 발견하지 못했다.'
 const before=structuredClone(observe)
 assert.equal(storyEvent(observe),true)
 assert.match(buildNarratorPrompt([observe],places,agents),/"durationMinutes":60/)
 assert.deepEqual(observe,before)
})
