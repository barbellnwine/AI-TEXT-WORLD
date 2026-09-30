import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compactProse, koreanParticles, eventProse } from '../server/domain/eventProse.ts'
import { mockNarrator } from '../server/domain/narrator.ts'
import { buildNarratorPrompt } from '../server/prompts/narratorPrompt.ts'
import { unsupportedNarrative } from '../server/domain/narrativeGuard.ts'
import { storySchemaFor, causalStoryOrder, validateStory, verifiedStory } from '../server/domain/novelNarration.ts'
import type { WorldEvent, Agent } from '../server/domain/worldTypes.ts'

const names = new Map([['a', { name: '김높별' } as Agent]])

test('literary paragraphs require valid evidence, exact recorded dialogue and a positive factual review',()=>{
 const source={...event,id:'dialogue',phase:'COMPLETED' as const,publicQuote:'함께 가자.',actionResult:'김높별이 말을 건넸다.'}
 const good={paragraphs:[{text:'김높별이 말을 건넸다. “함께 가자.”',eventIds:['dialogue']}]}
 assert.ok(validateStory(good,[source]))
 assert.equal(verifiedStory(good,{approved:false,unsupportedClaims:['unsupported']},[source]),null)
 assert.ok(verifiedStory(good,{approved:true,unsupportedClaims:[]},[source]))
 assert.equal(validateStory({paragraphs:[{text:'“죽여 버리겠어.”',eventIds:['dialogue']}]},[source]),null)
 assert.equal(validateStory({paragraphs:[{text:'배틀로얄이 종료되었다.',eventIds:['dialogue']}]},[source]),null)
 assert.equal(validateStory({paragraphs:[{text:'없는 기록',eventIds:['invented']}]},[source]),null)
})

test('authoritative character gender prevents a feminine pronoun for an all-male cited scene',()=>{
 const men=new Map([['a',{name:'김높별',profile:{gender:'남성',orientation:''}} as Agent]])
 assert.equal(validateStory({paragraphs:[{text:'그녀는 그 자리에 있었다.',eventIds:[event.id]}]},[event],'LIVE',men),null)
 assert.ok(validateStory({paragraphs:[{text:'김높별은 그 자리에 있었다.',eventIds:[event.id]}]},[event],'LIVE',men))
 const prompt=buildNarratorPrompt([event],new Map(),men)
 assert.match(prompt,/"gender":"남성"/)
})

test('cancellation follows its causal attack even when appended first at the same minute',()=>{
 const schema=storySchemaFor([event]).properties.paragraphs.items.properties.eventIds
 assert.equal(schema.minItems,1);assert.deepEqual(schema.items.enum,[event.id])
 const attack={...event,id:'attack',worldMinute:245},cancel={...event,id:'cancel',worldMinute:245,relatedEventIds:['attack']}
 assert.deepEqual(causalStoryOrder([cancel,attack]).map(e=>e.id),['attack','cancel'])
 assert.deepEqual(causalStoryOrder([cancel,{...attack,relatedEventIds:['cancel']}]).map(e=>e.id),['attack','cancel'])
})

test('minor damage cannot establish mortal injury or an unrecorded ambush',()=>{
 const source={...event,phase:'COMPLETED' as const,actionResult:'공격으로 부상을 입었다.',stateChanges:[{field:'agent:a:health',from:'1',to:'3'}]}
 for(const text of ['그의 생명은 위태로워졌다.','치명적인 부상을 입었다.','중상을 입었다.','기습으로 쓰러졌다.','돕던 사람에게 공격당했다.','칼을 빼 들었다.','식량을 발견했다.','그는 추격했다.','‘생존 확률을 높이려 함’이라고 생각했다.'])assert.equal(validateStory({paragraphs:[{text,eventIds:[source.id]}]},[source]),null)
 assert.ok(validateStory({paragraphs:[{text:'공격으로 부상을 입었다.',eventIds:[source.id]}]},[source]))
})

test('cancelled retaliation never repeats the attacker motive and damage report',()=>{
 const e={...event,phase:'CANCELLED',actionType:'ATTACK',actionResult:'공격이 필요하다고 생각했다. 김높별이 도영동을 공격해 부상을 입혔다. 이 공격으로 김높별은 하던 행동을 멈췄다.'}
 assert.equal(eventProse(e,names),'김높별은 공격을 받아 반격을 끝내지 못했다.')
})
const event: WorldEvent = { id: 'e1', day: 1, worldTime: '02:45', occurredAt: '2026-09-24T00:00:00Z', type: 'SYSTEM', placeId: 'island', agentIds: ['a'], title: '', summary: '김높별의 환경 노출이 누적되어 상태가 변했다.', stateChanges: [{ field: 'agent:a:wetness', from: '1', to: '2' }], importance: 'normal', relatedEventIds: [] }
test('scheduled power loss cannot become an ending or a death in narration', () => {
  const power = { ...event, cause: 'scheduled:power-off', summary: '의문의 배틀로얄: ', stateChanges: [{ field: 'place:island:power', from: 'true', to: 'false' }] }
  assert.equal(eventProse(power, names), '예약된 전력 차단이 실행되어 전기 공급이 꺼졌다.')
  assert.equal(unsupportedNarrative('배틀로얄이 갑작스럽게 종료되었다.', [power]), true)
  assert.equal(unsupportedNarrative('누군가 사망했다.', [power]), true)
  assert.equal(unsupportedNarrative('전기 공급이 꺼졌다.', [power]), false)
  assert.equal(unsupportedNarrative('그의 반격은 실패로 끝났다.', [power]), false)
  assert.equal(unsupportedNarrative('긴 밤이 끝났다.', [power]), false)
  assert.equal(unsupportedNarrative('시즌이 종료되었다.', [{ ...power, cause: 'world_ended' }]), false)
})
test('multiple threshold fields across people become two factual sentences rather than copied paragraphs', () => {
  const actors = new Map([...names, ['b', { name: '권치현' } as Agent]])
  const summaries = [...actors].map(([id, a]) => eventProse({ ...event, agentIds: [id], summary: `${a.name}의 젖은 정도가 높아져 심한 수준에 이르렀다. ${a.name}의 피로가 높아져 뚜렷한 수준에 이르렀다.` }, actors))
  const prose = compactProse(summaries, actors)
  assert.deepEqual(prose, ['김높별, 권치현의 옷이 흠뻑 젖었다.', '김높별, 권치현의 피로가 뚜렷해졌다.'])
})
test('identical exposure changes become one sentence without merging different effects', () => {
  const actors = new Map([...names, ['b', { name: '권치현' } as Agent]])
  assert.deepEqual(compactProse(['김높별의 몸이 한층 더 젖었다.', '권치현의 몸이 한층 더 젖었다.', '김높별의 피로가 더 쌓였다.'], actors), ['김높별, 권치현의 몸이 한층 더 젖었다.', '김높별의 피로가 더 쌓였다.'])
})
test('Korean particles respect the final consonant', () => {
  assert.equal(koreanParticles('김높별이(가) 작업 시도을(를) 시작했다. 민수은(는) 철수과(와) 만났다.'), '김높별이 작업 시도를 시작했다. 민수는 철수와 만났다.')
})
test('an attempted action remains an attempt and never publishes the raw model instruction', () => {
  const sentence = eventProse({ ...event, phase: 'STARTED', actionType: 'INTERACT', summary: '식량을 확보했다' }, names)
  assert.equal(sentence, '김높별은 계획한 작업에 착수했다.')
  assert.doesNotMatch(sentence, /확보했다|작업 시도|이\(가\)/)
})
test('exposure describes the actual changed field, not an invented injury', () => {
  assert.equal(eventProse(event, names), '김높별의 몸이 한층 더 젖었다.')
  assert.equal(eventProse({ ...event, stateChanges: [{ field: 'agent:a:wetness', from: '2', to: '1' }] }, names), '김높별의 몸에서 물기가 조금씩 말랐다.')
})
test('fallback prose excludes private facts and unfinished actions', () => {
  const scene = mockNarrator.narrateFallbackScene([event, { ...event, id: 'private', visibility: 'private', summary: '비밀 실험실' }, { ...event, id: 'started', phase: 'STARTED', summary: '식량을 확보했다' }], new Map(), names)
  assert.equal(scene.body, '김높별의 몸이 한층 더 젖었다.')
})
test('narrator receives action phase and no private event or knowledge delta', () => {
  const prompt = buildNarratorPrompt([{ ...event, phase: 'STARTED', stateChanges: [{ field: 'knowledge:a:secret', from: '', to: 'classified' }] }, { ...event, id: 'secret-event', visibility: 'private', summary: 'hidden-lab' }], new Map(), names)
  assert.doesNotMatch(prompt, /"phase":"STARTED"/)
  assert.match(prompt, /NEW_EVENTS|Do not retell previous events/)
  assert.doesNotMatch(prompt, /classified|hidden-lab|secret-event/)
})

test('narrator separates previous prose from only new completed facts', () => {
  const prompt = buildNarratorPrompt([{ ...event, id: 'new-completed', phase: 'COMPLETED' }], new Map(), names, 'Previously they discussed cooperation.')
  const newFacts = prompt.split('[NEW_EVENTS — CONFIRMED EVENTS]\n\n')[1].split('\n\n[CONNECTED COLLISIONS]')[0]
  assert.equal(JSON.parse(newFacts)[0].id, 'new-completed')
  assert.doesNotMatch(newFacts, /Previously/)
  assert.match(prompt, /PREVIOUS_NARRATIVE.*CONTEXT ONLY/)
})
