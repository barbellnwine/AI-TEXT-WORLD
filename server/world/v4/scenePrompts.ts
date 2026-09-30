// v4 prompts. Characters and the GM receive the situation as a story, not a state dump.
// Handles (P1, I1, R1, L1) let the GM refer to exact people/things without inventing IDs.
import type { Agent, Place, Resource, WorldState } from '../../domain/worldTypes.ts'
import type { WorldObject } from '../engineTypes.ts'
import type { WorldExecution } from '../../domain/worldAgent.ts'
import type { CharacterIntent, V4State } from './sceneTypes.ts'
import { environmentHints } from './environment.ts'
import { closedPlaceIds, isLastSurvivorWorld } from './director.ts'

export interface SceneCast { handle: string; agent: Agent; sinceMinute: number }
export interface SceneItem { handle: string; object: WorldObject; holder: string | null }
export interface SceneResource { handle: string; resource: Resource }
export interface SceneNeighbor { handle: string; place: Place; travelMinutes: number; danger: 'closed' | 'warned' | null }
export interface SceneContext {
  minute: number
  place: Place
  cast: SceneCast[]
  items: SceneItem[]
  resources: SceneResource[]
  neighbors: SceneNeighbor[]
  hints: string[]
  placeDanger: 'closed' | 'warned' | null
}

export function clockLabel(minute: number): string {
  const within = ((minute % 1440) + 1440) % 1440
  return `DAY ${Math.floor(minute / 1440) + 1} ${String(Math.floor(within / 60)).padStart(2, '0')}:${String(within % 60).padStart(2, '0')}`
}

// The GM tends to write "새벽" for any early hour; name the part of the day explicitly.
export function dayPart(minute: number): string {
  const hour = Math.floor((((minute % 1440) + 1440) % 1440) / 60)
  return hour < 5 ? '깊은 밤' : hour < 7 ? '새벽' : hour < 10 ? '아침' : hour < 12 ? '오전' : hour < 14 ? '한낮' : hour < 18 ? '오후' : hour < 20 ? '저녁' : '밤'
}

export function buildSceneContext(world: WorldState, v4: V4State, place: Place, agents: Agent[]): SceneContext {
  const engine = world.engine!, minute = engine.minute
  const cast = agents.map((agent, i) => ({ handle: `P${i + 1}`, agent, sinceMinute: v4.lastSceneMinute[agent.id] ?? minute - 60 }))
  const castIds = new Set(agents.map(a => a.id))
  const usable = (o: WorldObject) => o.quantity > 0 && o.condition !== 'destroyed'
  const objects = engine.objects.filter(o => usable(o) && (o.location.kind === 'agent' && castIds.has(o.location.id) || o.location.kind === 'place' && o.location.id === place.id && !o.concealedBy))
  const items = objects.map((object, i) => ({ handle: `I${i + 1}`, object, holder: object.location.kind === 'agent' ? cast.find(c => c.agent.id === object.location.id)!.handle : null }))
  const resources = place.resources.filter(r => r.level >= 1).map((resource, i) => ({ handle: `R${i + 1}`, resource }))
  const closed = closedPlaceIds(v4, minute), warned = new Set(v4.director.closures.map(c => c.placeId))
  const danger = (id: string) => closed.has(id) ? 'closed' as const : warned.has(id) ? 'warned' as const : null
  const neighbors = engine.connections.filter(c => !c.blocked && (c.fromPlaceId === place.id || c.toPlaceId === place.id))
    .map(c => ({ id: c.fromPlaceId === place.id ? c.toPlaceId : c.fromPlaceId, travelMinutes: c.travelMinutes }))
    .filter((c, i, all) => all.findIndex(x => x.id === c.id) === i)
    .map((c, i) => ({ handle: `L${i + 1}`, place: world.places.find(p => p.id === c.id)!, travelMinutes: c.travelMinutes, danger: danger(c.id) }))
    .filter(n => n.place)
  return { minute, place, cast, items, resources, neighbors, hints: environmentHints(place), placeDanger: danger(place.id) }
}

function level(value: number | undefined, words: [string, string, string, string]): string {
  const v = value ?? 0
  return v < 3 ? words[0] : v < 6 ? words[1] : v < 8 ? words[2] : words[3]
}

export function bodyText(agent: Agent): string {
  const damage = agent.body?.health ?? 0
  return [
    level(agent.vitals?.hunger, ['배는 고프지 않다', '배가 고프다', '몹시 배가 고프다', '굶주려 기운이 빠졌다']),
    level(agent.vitals?.thirst, ['목은 마르지 않다', '목이 마르다', '목이 타들어 간다', '탈수로 머리가 어지럽다']),
    level(agent.humanState?.fatigue, ['몸은 버틸 만하다', '피로가 쌓였다', '몹시 지쳤다', '쓰러지기 직전으로 지쳤다']),
    damage <= 1 ? '다친 곳은 없다' : damage <= 3 ? '가벼운 상처가 있다' : damage <= 6 ? '부상 때문에 움직임이 둔하다' : '크게 다쳐 위태롭다',
  ].join(', ')
}

export function isMature(world: WorldState, execution: WorldExecution): boolean {
  const chosen = execution.draft.studio?.maturity
  if (chosen) return chosen === 'mature'
  return isLastSurvivorWorld(world, execution) || /성인|19금|다크|잔혹|스릴러|호러|서바이벌|느와르|noir|horror|thriller/i.test(`${execution.draft.genre} ${execution.draft.intro} ${execution.draft.background}`)
}

// Sexual content is excluded at every intensity; violence is what the mature setting unlocks.
const CHARACTER_MATURE = [
  '[수위] 성인 다크 서바이벌 스릴러다. 살아남기 위해 거짓말, 배신, 협박, 약탈, 기습, 살인까지 무엇이든 선택할 수 있다.',
  '성격과 목표에 충실하라. 잔인한 인물은 잔인하게, 겁 많은 인물은 비겁하게 행동한다. 망설임도 성격대로다.',
  '최후의 한 명만 살아남는 규칙이라면 모든 동맹은 결국 끝난다. 언제 누구를 이용하고 버릴지 계산하라.',
].join('\n')
const GM_MATURE = [
  '[수위] 성인 다크 서바이벌 스릴러다. 폭력과 죽음을 피하거나 순화하지 말고 사실적으로 판정하고 묘사한다. 피, 고통, 공포, 절박함을 숨기지 않되 고어를 나열하지는 않는다.',
  '공격 의도는 실제 공격으로 판정한다. 기습, 약탈, 협박, 배신은 성공할 수 있다. 무기로 급소를 노린 공격이 성공하면 치명상(severity 4~5)이나 즉사가 될 수 있다.',
  '인물을 보호하려고 결과를 흐리지 마라. 방심한 사람은 당하고, 약한 사람은 빼앗긴다.',
  '위협이나 공격 의도가 있으면 이 장면 안에서 결판을 낸다: 실제로 공격이 오가거나, 한쪽이 도망치거나, 굴복하고 무언가를 내준다. "곧 피의 밤이 올 것이다" 같은 예고로 미루지 않는다.',
  '직전 장면이 대치로 끝났다면 이번 장면은 행동으로 시작한다. 이미 크게 다친 사람(누적 부상 7 이상)이 다시 공격받으면 죽을 수 있다.',
  '성적 행위와 성폭력은 어떤 형태로도 묘사하거나 암시하지 않는다.',
].join('\n')
const GM_STANDARD = '[수위] 폭력은 필요한 만큼만 절제해서 묘사한다. 성적 행위와 성폭력은 묘사하거나 암시하지 않는다.'

function pressure(world: WorldState): string {
  const alive = world.agents.filter(a => a.publicState.status !== 'deceased')
  const dead = world.agents.filter(a => a.publicState.status === 'deceased').map(a => a.name)
  return `생존자 ${alive.length}명${dead.length ? `, 사망: ${dead.join(', ')}` : ''}`
}

function premise(execution: WorldExecution): string {
  const d = execution.draft
  return JSON.stringify({ 장르: d.genre, 배경: d.background, 도입: d.intro, 상황: d.backgroundSituation, 종료조건: d.endCondition,
    규칙: execution.rules.filter(r => r.enabled).sort((a, b) => b.priority - a.priority).map(r => `${r.title}: ${r.description}`).slice(0, 12) })
}

function relationLine(agent: Agent, other: Agent): string {
  const r = agent.relationships.find(x => x.otherAgentId === other.id)
  if (!r) return `${other.name}: 잘 모르는 사람`
  const stance = { ally: '동맹', friendly: '호의적', neutral: '중립', wary: '경계', hostile: '적대' }[r.stance]
  return `${other.name}: ${stance}, 신뢰 ${r.trust ?? 5}/10${r.note ? `, ${r.note.slice(0, 120)}` : ''}`
}

function journalText(agent: Agent, limit: number): string {
  const entries = (agent.journal ?? []).slice(-limit)
  return entries.length ? entries.map(e => `- ${clockLabel(e.minute)} ${e.text}`).join('\n') : '- (아직 기억할 만한 일이 없다)'
}

function placeLines(ctx: SceneContext): string {
  const dangerText = (d: SceneNeighbor['danger']) => d === 'closed' ? ' [위험 구역]' : d === 'warned' ? ' [곧 위험 구역]' : ''
  return [
    `${ctx.place.name}${dangerText(ctx.placeDanger)}: ${ctx.place.description}`,
    `이곳에서 자연스럽게 구할 수 있을 법한 것: ${ctx.hints.length ? ctx.hints.join(', ') : '장소 설명에서 판단'}`,
    `이곳에 놓인 물건: ${ctx.items.filter(i => !i.holder).map(i => i.object.name).join(', ') || '없음'}`,
    `이곳의 자원: ${ctx.resources.map(r => `${r.resource.label} ${r.resource.level}${r.resource.unit ?? ''}`).join(', ') || '없음'}`,
    `이어진 장소: ${ctx.neighbors.map(n => `${n.place.name}(${n.travelMinutes}분)${dangerText(n.danger)}`).join(', ') || '없음'}`,
  ].join('\n')
}

export const CHARACTER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    thought: { type: 'string' }, action: { type: 'string' },
    speech: { type: ['string', 'null'] }, targetName: { type: ['string', 'null'] }, moveTo: { type: ['string', 'null'] },
  },
  required: ['thought', 'action', 'speech', 'targetName', 'moveTo'],
}

export function buildCharacterPrompt(world: WorldState, execution: WorldExecution, v4: V4State, ctx: SceneContext, member: SceneCast, lastScene: string): string {
  const agent = member.agent, design = execution.draft.characters.find(c => c.id === agent.id)
  const others = ctx.cast.filter(c => c.agent.id !== agent.id)
  const mine = ctx.items.filter(i => i.holder === member.handle).map(i => i.object.name)
  return [
    `당신은 ${agent.name}이다. 이 세계 속 실제 인물로서 생각하고, 지금 이 순간 무엇을 할지 정하라.`,
    '[세계]', premise(execution),
    '[나]', JSON.stringify({ 이름: agent.name, 나이: design?.age, 성별: design?.gender, 직업: design?.occupation, 성격: design?.personality,
      배경: design?.background?.slice(0, 400), 목표: design?.goal, 강점: design?.strengths, 약점: design?.weaknesses, 남에게_말하지_않은_사실: design?.privateInfo?.slice(0, 300) }),
    '[몸 상태]', bodyText(agent),
    '[소지품]', mine.join(', ') || '빈손',
    '[지금 있는 곳]', placeLines(ctx),
    '[같은 곳에 있는 사람]', others.length ? others.map(o => `${relationLine(agent, o.agent)} (${bodyText(o.agent).split(', ').pop()}, 들고 있는 것: ${ctx.items.filter(i => i.holder === o.handle).map(i => i.object.name).join(', ') || '보이지 않음'})`).join('\n') : '아무도 없다. 혼자다.',
    '[최근 방송]', v4.director.announcements.slice(-3).map(a => `- ${clockLabel(a.minute)} ${a.text}`).join('\n') || '- 없음',
    '[남은 사람]', pressure(world),
    '[내 기억]', journalText(agent, 20),
    '[직전에 겪은 장면]', lastScene.slice(-1200) || '(없음)',
    '[지금]', `${clockLabel(ctx.minute)} (${dayPart(ctx.minute)}), 날씨 ${world.clock.weather}, ${world.clock.temperatureC}℃. 마지막 장면 이후 ${Math.max(0, ctx.minute - member.sinceMinute)}분이 지났다.`,
    isMature(world, execution) ? CHARACTER_MATURE : '',
    [
      '지시:',
      '- 설정과 장소에 자연스럽게 있을 법한 것(나무, 돌, 물, 물고기 등)은 활용할 수 있다. 소지품에 없는 특별한 물건은 없다.',
      '- 결과를 단정하지 말고 무엇을 어떻게 시도하는지 구체적으로 말하라. 성공 여부는 세계가 정한다.',
      '- 목표와 성격, 몸 상태, 기억에 따라 판단하라. 방금 한 일을 되풀이하지 말고 상황을 한 걸음 진전시켜라.',
      '- thought는 속마음, action은 지금부터 할 행동, speech는 실제로 입 밖에 낼 말(없으면 null), targetName은 상대 이름(없으면 null), moveTo는 이어진 장소로 떠날 때 그 이름(아니면 null).',
      '- 모든 값은 한국어로 쓴다.',
    ].join('\n'),
  ].filter(Boolean).join('\n\n')
}

const handleArray = (props: Record<string, unknown>) => ({ type: 'array', items: { type: 'object', additionalProperties: false, properties: props, required: Object.keys(props) } })
const str = { type: 'string' }, nullableStr = { type: ['string', 'null'] }, int = { type: 'integer' }
export const GM_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: str, prose: str, durationMinutes: int,
    outcomes: {
      type: 'object', additionalProperties: false,
      properties: {
        moves: handleArray({ who: str, to: str }),
        injuries: handleArray({ who: str, severity: int, description: str, by: nullableStr }),
        deaths: handleArray({ who: str, cause: str, by: nullableStr }),
        created: handleArray({ name: str, kind: { type: 'string', enum: ['item', 'food', 'water', 'medicine', 'tool'] }, holder: nullableStr, description: str }),
        transfers: handleArray({ item: str, to: nullableStr }),
        consumed: handleArray({ item: str }),
        needs: handleArray({ who: str, ate: int, drank: int, rested: int }),
        relations: handleArray({ from: str, to: str, trust: int, note: str }),
        memories: handleArray({ who: str, text: str }),
      },
      required: ['moves', 'injuries', 'deaths', 'created', 'transfers', 'consumed', 'needs', 'relations', 'memories'],
    },
  },
  required: ['title', 'prose', 'durationMinutes', 'outcomes'],
}

export function buildGmPrompt(world: WorldState, execution: WorldExecution, v4: V4State, ctx: SceneContext, intents: CharacterIntent[], previousScene: string, corrections = ''): string {
  const cast = ctx.cast.map(c => {
    const design = execution.draft.characters.find(d => d.id === c.agent.id)
    const intent = intents.find(i => i.agentId === c.agent.id)
    return { handle: c.handle, 이름: c.agent.name, 나이: design?.age, 성별: design?.gender, 성격: design?.personality, 목표: design?.goal,
      몸: bodyText(c.agent), 소지품: ctx.items.filter(i => i.holder === c.handle).map(i => `${i.handle} ${i.object.name}`),
      관계: ctx.cast.filter(o => o.agent.id !== c.agent.id).map(o => relationLine(c.agent, o.agent)),
      지난장면이후: `${Math.max(0, ctx.minute - c.sinceMinute)}분`,
      의도: intent ? { 속마음: intent.thought, 행동: intent.action, 대사: intent.speech, 대상: intent.targetName, 이동: intent.moveTo } : '정하지 못함' }
  })
  return [
    '당신은 이 세계의 게임 마스터이자 소설가다. 아래 인물들의 의도를 동시에 판정하고, 벌어진 일을 한국어 소설 장면으로 써라.',
    '[세계]', premise(execution),
    '[지금]', `${clockLabel(ctx.minute)} (${dayPart(ctx.minute)}), 날씨 ${world.clock.weather}, ${world.clock.temperatureC}℃. 장면의 시간대 묘사는 이 시각에 맞춘다.`,
    '[장소]', placeLines(ctx),
    '[handle 목록]', JSON.stringify({
      장소: ctx.neighbors.map(n => `${n.handle}=${n.place.name}`),
      물건: ctx.items.map(i => `${i.handle}=${i.object.name}${i.holder ? `(${i.holder} 소지)` : '(바닥)'}`),
      자원: ctx.resources.map(r => `${r.handle}=${r.resource.label}`),
    }),
    '[인물과 의도]', JSON.stringify(cast),
    '[남은 사람]', pressure(world),
    isMature(world, execution) ? GM_MATURE : GM_STANDARD,
    '[최근 방송]', v4.director.announcements.slice(-3).map(a => `- ${clockLabel(a.minute)} ${a.text}`).join('\n') || '- 없음',
    '[직전 장면 — 반복하지 말 것]', previousScene.slice(-1500) || '(없음)',
    [
      '판정 원칙:',
      '1. 현실적으로 판정한다. 장소와 설정에 자연스러운 것(숲의 나무, 해변의 모래와 조개, 바다의 물고기, 샘의 물)은 존재한다. 설정에 없는 문명 물건(총, 휴대폰 등)은 생기지 않는다.',
      '2. 만들기, 사냥, 채집에는 시간과 도구가 들고 실패할 수 있다. 맨손으로 나무를 깎을 수는 없다. 새로 얻거나 만든 물건은 created에 넣는다.',
      '3. 의도가 서로 부딪히면 성격, 몸 상태, 소지품, 기습 여부로 공정하게 정한다. 누구의 바람도 그대로 들어주지 마라.',
      '4. 인물의 대사는 살리되 자연스럽게 다듬어도 된다. 상대의 반응과 대답도 그 인물의 성격과 의도에 맞게 쓸 수 있다.',
      '5. 사망은 치명적인 공격이나 극단적인 상황에서만 일어난다. 사망하면 deaths에 넣고 prose에도 분명히 쓴다.',
      '6. prose는 3인칭 소설체로 400~1500자. 감각, 표정, 속마음, 긴장을 살린다. 수치, 게임 용어, 보고서 문체는 쓰지 않는다. 직전 장면을 되풀이하지 않는다.',
      '7. 혼자 있는 인물은 지난 장면 이후 흐른 시간 동안 무엇을 했는지 자연스럽게 이어서 쓴다.',
      '8. outcomes는 prose와 정확히 일치해야 한다. prose에 쓴 이동, 부상, 획득, 건넴, 소비, 사망은 모두 outcomes에 넣고, prose에 없는 결과는 넣지 않는다. 함께 이동한 사람도 한 명씩 모두 moves에 넣는다. 장면이 끝날 때 도착하지 않았다면 이동시키지 말고 출발만 묘사한다.',
      '9. outcomes의 참조에는 handle을 쓴다. who/by/from/to/holder는 P 번호, item은 I 번호, 장소 자원을 먹거나 마시면 consumed에 R 번호, 자원을 챙겨 가면 transfers에 R 번호와 받는 P 번호, 이동 to는 L 번호. 떨어뜨리거나 내려놓으면 transfers.to=null. 단 created.name에는 handle이 아니라 실제 물건 이름을 쓴다.',
      '10. severity는 1(긁힘)~5(치명상). needs는 이 장면에서 먹고(ate), 마시고(drank), 쉰(rested) 만큼의 회복량 0~10이다(조개 몇 개=2, 충분한 한 끼=5, 물을 실컷=6, 한 시간 휴식=2). 먹거나 쉬지 않았으면 0. relations.trust는 -3~3.',
      '11. memories에는 인물마다 이 장면을 그 인물이 알 수 있는 것만으로 한 문장씩 적는다.',
      '12. durationMinutes는 이 장면이 다루는 세계 시간(10~240분). title은 장면을 드러내는 짧은 제목.',
      '13. created에는 실제 물건만 넣는다. 들고 다닐 수 있으면 holder=그 인물, 모닥불·은신처·덫처럼 설치한 것은 holder=null(그 장소에 남음). 불꽃, 신호, 소리 같은 현상은 물건이 아니다.',
      '14. 모든 장면은 무언가가 달라진 채 끝난다(위치, 소지품, 몸, 관계 중 하나 이상). 긴장만 쌓고 아무 일도 일어나지 않는 장면이나 "싸움은 이제부터 시작이었다" 같은 예고성 마무리를 쓰지 않는다.',
    ].join('\n'),
    corrections ? `[이전 판정 오류 — 고쳐서 다시 작성]\n${corrections}` : '',
  ].filter(Boolean).join('\n\n')
}
