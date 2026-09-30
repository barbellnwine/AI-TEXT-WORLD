import test from 'node:test'
import assert from 'node:assert/strict'
import type { Agent, Place, WorldEvent } from '../server/domain/worldTypes.ts'
import { storyEvent } from '../server/domain/storyComposition.ts'
import { groupNarrativeScenes } from '../server/domain/sceneEvidence.ts'
import { mockNarrator } from '../server/domain/narrator.ts'
import { buildNarratorPrompt } from '../server/prompts/narratorPrompt.ts'
import { validateStory } from '../server/domain/novelNarration.ts'
import type { WorldObject } from '../server/world/engineTypes.ts'

const people=new Map([['a',{name:'A'} as Agent],['b',{name:'B'} as Agent],['c',{name:'C'} as Agent]])
const places=new Map([['beach',{name:'해변'} as Place],['forest',{name:'숲'} as Place]])
const event=(id:string,minute:number,placeId:string,agentIds:string[],actionType:string,summary:string):WorldEvent=>({
 id,day:1,worldMinute:minute,worldTime:`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`,
 occurredAt:new Date(Date.UTC(2026,0,1,0,minute)).toISOString(),type:actionType==='SPEAK'?'DIALOGUE':actionType==='ATTACK'?'CONFLICT':'RESOURCE_CHANGE',
 phase:'COMPLETED',actionType,placeId,agentIds,title:summary,summary,actionResult:summary,stateChanges:[],importance:'normal',relatedEventIds:[],outcome:'CONFIRMED',
})

test('reader scenes exclude administrative creation while the journal fact remains unchanged',()=>{
 const admin={...event('admin',0,'beach',[],'','관리자에 의한 세계 창조'),type:'SYSTEM' as const,cause:'administrator_created_world'}
 const notice={...admin,id:'notice',type:'OPERATOR_EVENT' as const,cause:'operator_announcement'}
 const move={...event('move',18,'forest',['a'],'MOVE','A가 숲에 도착했다.'),detail:{version:1 as const,startedMinute:0,endedMinute:18,intent:'move',steps:[]},stateChanges:[{field:'agent:a:locationId',from:'beach',to:'forest'}]}
 const before=structuredClone([admin,notice,move])
 assert.equal(storyEvent(admin),false);assert.equal(storyEvent(notice),false)
 const scene=mockNarrator.narrateFallbackScene([admin,notice,move],places,people)
 assert.deepEqual(scene.sourceEventIds,['move'])
 assert.match(scene.body,/해변.*숲/)
 assert.doesNotMatch(scene.body,/관리자|순간 이동|WORLD STATE/)
 assert.equal(scene.timeStart,'00:00');assert.equal(scene.timeEnd,'00:18')
 assert.deepEqual([admin,notice,move],before)
 const prompt=buildNarratorPrompt([admin,notice,move],places,people)
 assert.doesNotMatch(prompt,/관리자에 의한 세계 창조|"id":"admin"|"id":"notice"/)
})

test('scene boundaries respect place, time and shared participants rather than journal adjacency',()=>{
 const take=event('take',20,'forest',['a'],'TAKE_ITEM','A가 나무를 집었다.')
 const speak={...event('speak',23,'forest',['a','b'],'SPEAK','A가 B에게 말했다.'),publicQuote:'여기서 기다려.'}
 const alter={...event('alter',27,'forest',['a'],'INTERACT','A가 나무와 돌을 결합했다.'),relatedEventIds:['take']}
 const remote=event('remote',24,'beach',['c'],'OBSERVE','C가 해변을 살폈다.')
 const later=event('later',130,'forest',['a'],'REST','A가 쉬었다.')
 const groups=groupNarrativeScenes([later,remote,alter,speak,take])
  assert.deepEqual(groups.map(g=>g.map(e=>e.id)),[['take','speak','alter'],['remote'],['later']])
 const scene=mockNarrator.narrateFallbackScene([take,speak,alter],places,people)
 assert.match(scene.body,/여기서 기다려/)
 assert.deepEqual(scene.sourceEventIds,['take','speak','alter'])
})

test('unlinked events cannot acquire a causal transition or an invented death',()=>{
 const a=event('a',1,'beach',['a'],'MOVE','A가 이동했다.')
 const b=event('b',2,'forest',['b'],'REST','B가 쉬었다.')
 assert.equal(validateStory({paragraphs:[{text:'A의 행동 때문에 B는 쉬었다.',eventIds:['a','b']}]},[a,b]),null)
 assert.equal(validateStory({paragraphs:[{text:'B가 사망했다.',eventIds:['b']},{text:'A가 이동했다.',eventIds:['a']}]},[a,b]),null)
})

test('a named witness needs their own event-time sight record',()=>{
 const fight={...event('fight',30,'forest',['b'],'ATTACK','B가 공격했다.'),
  perceptions:[{agentId:'c',sense:'sight' as const,area:'CENTER',position:{x:.5,y:.5}}]}
 assert.equal(validateStory({paragraphs:[{text:'A가 눈앞에서 충돌을 목격했다.',eventIds:['fight']}]},[fight],'LIVE',people),null)
 assert.ok(validateStory({paragraphs:[{text:'C가 눈앞에서 충돌을 목격했다.',eventIds:['fight']}]},[fight],'LIVE',people))
})

test('the fact pack names only objects cited by the transformation and its provenance',()=>{
 const transform={...event('make',45,'forest',['a'],'INTERACT','A가 결합 물체를 만들었다.'),actionId:'make-action',
  stateChanges:[{field:'object:wood:quantity',from:'1',to:'0'},{field:'object:joined:created',from:'absent',to:'agent:a'}]}
 const object=(id:string,name:string):WorldObject=>({id,name,kind:'item',quantity:1,condition:'intact',location:{kind:'place',id:'forest'}})
 const wood=object('wood','나무'),unrelated=object('secret','숨겨진 물건')
 const joined={...object('joined','결합 물체'),provenance:{sourceObjectIds:['wood'],transformation:'combine' as const,sourceActionId:'make-action'}}
 const prompt=buildNarratorPrompt([transform],places,people,'','LIVE',[wood,joined,unrelated])
 assert.match(prompt,/"objectFacts"/)
 assert.match(prompt,/"name":"나무"/)
 assert.match(prompt,/"name":"결합 물체"/)
 assert.doesNotMatch(prompt,/숨겨진 물건/)
})

test('one combat scene carries the recorded injury without adding a death or a remote witness',()=>{
 const attack={...event('attack',60,'forest',['a','b'],'ATTACK','A가 B를 공격했다.'),type:'CONFLICT' as const}
 const injury={...event('injury',61,'forest',['b'],'ATTACK','B가 팔에 타박상을 입었다.'),type:'INJURY' as const,
  relatedEventIds:['attack'],stateChanges:[{field:'agent:b:injury',from:'0',to:'2'}]}
 const remote={...event('remote',60,'beach',['c'],'OBSERVE','C는 해변에 있었다.'),visibility:'private' as const}
 const scene=mockNarrator.narrateFallbackScene([remote,injury,attack],places,people)
 assert.deepEqual(scene.sourceEventIds,['attack','injury'])
 assert.equal(groupNarrativeScenes([attack,injury]).length,1)
 assert.match(scene.body,/공격|타박상/)
 assert.doesNotMatch(scene.body,/사망|C는|목격/)
})
