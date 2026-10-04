// v4 prompts. Characters and the GM receive the situation as a story, not a state dump.
// Handles (P1, I1, R1, L1) let the GM refer to exact people/things without inventing IDs.
import type { Agent, Place, Resource, WorldState } from '../../domain/worldTypes.ts'
import type { WorldObject } from '../engineTypes.ts'
import type { WorldExecution } from '../../domain/worldAgent.ts'
import type { CharacterIntent, V4State } from './sceneTypes.ts'
import { environmentHints } from './environment.ts'
import { closedPlaceIds, isLastSurvivorWorld } from './director.ts'
import type { GeoPoint, Terrain } from '../geo/geoTypes.ts'
import { dist, terrainAt } from '../geo/geoBuild.ts'
import { direction, perceive } from '../geo/perception.ts'
import { routeBetween, travelMinutes } from '../geo/movement.ts'

export interface SceneCast { handle: string; agent: Agent; sinceMinute: number; terrain: Terrain }
export interface SceneItem { handle: string; object: WorldObject; holder: string | null }
export interface SceneResource { handle: string; resource: Resource }
// A destination anywhere on the map, with its real distance and walking time from the scene.
export interface SceneNeighbor { handle: string; place: Place; travelMinutes: number; distance: number; direction: string; danger: 'closed' | 'warned' | null }
// An unresolved conflict among this cast: scenes is how many scenes it has already run,
// mustResolve means it has run long enough that this scene has to settle it.
export interface SceneStandoff { ids: string[]; scenes: number; mustResolve: boolean; note: string }
export interface SceneContext {
  minute: number
  place: Place
  cast: SceneCast[]
  items: SceneItem[]
  resources: SceneResource[]
  neighbors: SceneNeighbor[]
  hints: string[]
  placeDanger: 'closed' | 'warned' | null
  terrain: Terrain
  standoff: SceneStandoff | null
  // Living people who are NOT in this scene. The GM may not put them on the page.
  absentNames: string[]
  // The scene's own spot on the map, and the two things everyone's GPS shows.
  origin: GeoPoint
  supplies: Array<{ name: string; coord: GeoPoint; distance: number; direction: string }>
  closures: Array<{ placeId: string; name: string; minutesUntil: number; closed: boolean }>
  world: { widthMeters: number; heightMeters: number }
}

// How close you have to be to pick something up off the ground.
export const REACH_METERS = 25

export function hoursAndMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes))
  return whole >= 60 ? `${Math.floor(whole / 60)}시간 ${whole % 60}분` : `${whole}분`
}

export const TERRAIN_NAMES: Record<Terrain, string> = { GRASS: '풀밭', FOREST: '숲', BEACH: '모래사장', ROCK: '바위 지대', CANYON: '협곡', CLIFF: '절벽', WATER: '물', RIVER: '강', RUINS: '폐허', URBAN: '건물 지대' }
const TERRAIN_HINTS: Partial<Record<Terrain, string[]>> = { FOREST: ['나무', '곧은 가지', '덩굴'], BEACH: ['모래', '조개', '떠밀려 온 나무'], ROCK: ['돌', '날카로운 돌조각'], CANYON: ['무너진 바위', '좁은 바닥', '마른 흙'], RIVER: ['민물', '매끈한 돌'], GRASS: ['마른 풀'] }

export function clockLabel(minute: number): string {
  const within = ((minute % 1440) + 1440) % 1440
  return `DAY ${Math.floor(minute / 1440) + 1} ${String(Math.floor(within / 60)).padStart(2, '0')}:${String(within % 60).padStart(2, '0')}`
}

// The GM tends to write "새벽" for any early hour; name the part of the day explicitly.
export function dayPart(minute: number): string {
  const hour = Math.floor((((minute % 1440) + 1440) % 1440) / 60)
  return hour < 5 ? '깊은 밤' : hour < 7 ? '새벽' : hour < 10 ? '아침' : hour < 12 ? '오전' : hour < 14 ? '한낮' : hour < 18 ? '오후' : hour < 20 ? '저녁' : '밤'
}

// The spotlight group inherits the standoff only when at least two of its parties are here.
export function standoffFor(v4: V4State, minute: number, agentIds: string[]): SceneStandoff | null {
  const s = v4.standoff
  if (!s || s.ids.filter(id => agentIds.includes(id)).length < 2) return null
  return { ids: s.ids, scenes: s.scenes, note: s.note, mustResolve: s.scenes >= 4 || minute - s.startedMinute >= 300 }
}

export function buildSceneContext(world: WorldState, v4: V4State, place: Place, agents: Agent[]): SceneContext {
  const engine = world.engine!, minute = engine.minute, geo = engine.geo!
  const cast = agents.map((agent, i) => ({ handle: `P${i + 1}`, agent, sinceMinute: v4.lastSceneMinute[agent.id] ?? minute - 60, terrain: terrainAt(geo, agent.publicState.coord!) }))
  const castIds = new Set(agents.map(a => a.id))
  // Things within arm's reach of somebody in the scene. A supply crate has a real coordinate, so
  // it counts only when someone is standing at it — not because they share a region name.
  const labels = new Set(agents.map(a => a.publicState.locationId))
  const usable = (o: WorldObject) => o.quantity > 0 && o.condition !== 'destroyed'
  const reachable = (o: WorldObject) => o.coord
    ? agents.some(a => dist(a.publicState.coord!, o.coord!) <= REACH_METERS)
    : labels.has(o.location.id)
  const objects = engine.objects.filter(o => usable(o) && (o.location.kind === 'agent' && castIds.has(o.location.id) || o.location.kind === 'place' && reachable(o) && !o.concealedBy))
  const items = objects.map((object, i) => ({ handle: `I${i + 1}`, object, holder: object.location.kind === 'agent' ? cast.find(c => c.agent.id === object.location.id)!.handle : null }))
  const resources = place.resources.filter(r => r.level >= 1).map((resource, i) => ({ handle: `R${i + 1}`, resource }))
  const closed = closedPlaceIds(v4, minute), warned = new Set(v4.director.closures.map(c => c.placeId))
  const danger = (id: string) => closed.has(id) ? 'closed' as const : warned.has(id) ? 'warned' as const : null
  const origin = { x: agents.reduce((n, a) => n + a.publicState.coord!.x, 0) / agents.length, y: agents.reduce((n, a) => n + a.publicState.coord!.y, 0) / agents.length }
  // Anywhere on the map is reachable on foot (water is routed around); nearest first.
  const neighbors = geo.regions.filter(r => r.placeId !== place.id)
    .map(r => ({ region: r, place: world.places.find(p => p.id === r.placeId)!, distance: Math.round(dist(origin, r.center)) }))
    .filter(n => n.place).sort((a, b) => a.distance - b.distance).slice(0, 8)
    .map((n, i) => ({ handle: `L${i + 1}`, place: n.place, distance: n.distance, direction: direction(origin, n.region.center),
      travelMinutes: Math.max(1, Math.round(travelMinutes(geo, routeBetween(geo, origin, n.region.center)).at(-1)!)), danger: danger(n.place.id) }))
  const terrain = terrainAt(geo, origin)
  const absentNames = world.agents.filter(a => a.publicState.status !== 'deceased' && !castIds.has(a.id)).map(a => a.name)
  // Everything the island broadcast already told everyone: where the crates fell and which ground
  // is about to turn lethal. Both are map facts, so both carry a bearing and a distance.
  const supplies = engine.objects.filter(o => usable(o) && o.location.kind === 'place' && o.coord && !o.concealedBy)
    .map(o => ({ name: o.name, coord: o.coord!, distance: Math.round(dist(origin, o.coord!)), direction: direction(origin, o.coord!) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 6)
  const closures = v4.director.closures.map(c => ({
    placeId: c.placeId,
    name: world.places.find(p => p.id === c.placeId)?.name ?? c.placeId,
    minutesUntil: c.effectiveMinute - minute,
    closed: c.effectiveMinute <= minute,
  })).sort((a, b) => a.minutesUntil - b.minutesUntil)
  return { minute, place, cast, items, resources, neighbors, hints: [...new Set([...environmentHints(place), ...(TERRAIN_HINTS[terrain] ?? [])])], placeDanger: danger(place.id), terrain,
    standoff: standoffFor(v4, minute, [...castIds]), absentNames, origin, supplies, closures,
    world: { widthMeters: geo.widthMeters, heightMeters: geo.heightMeters } }
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
  '인물을 보호하려고 결과를 흐리지 마라. 방심한 사람은 당하고, 약한 사람은 빼앗기고, 급소를 맞은 사람은 죽는다. 누군가 죽어야 할 상황에서 살려두지 마라.',
  '달아나는 것은 싸움의 끝이 아니다. 한쪽이 도망치면 상대는 그 자리에서 쫓을지 포기할지 정한다. 쫓기로 하면 chasing에 그 사람을 넣어라. 도주 성공 여부는 세계가 좌표와 거리, 달리는 속도, 부상, 피로, 지형, 시야로 판정한다. prose에는 달아나기 시작하는 모습까지만 쓰고 "무사히 벗어났다", "놓쳤다"처럼 결과를 단정하지 마라.',
  '위협이나 공격 의도가 있으면 이 장면 안에서 실제 공방을 주고받는다: 공격과 반격, 맞고 피하고 붙잡는 과정을 여러 차례 거친다. "곧 피의 밤이 올 것이다" 같은 예고로 미루지 않는다.',
  '한 번 시작된 싸움은 실제 결판이 날 때까지 계속된다. 결판은 넷 중 하나다: 한쪽이 도망친다, 굴복하고 무언가를 내준다, 제압당한다, 죽는다. 아직 어느 것도 아니라면 conflict.active=true로 두고 다음 장면에서 이어 싸운다.',
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

// The handset everyone was given: your own dot on the island, the shape of the island, what the
// broadcast said about closures and crates. It never shows another person — that is what makes
// walking into someone a surprise.
function gpsLines(world: WorldState, ctx: SceneContext, agent: Agent): string {
  const geo = world.engine!.geo!, here = agent.publicState.coord!
  const region = ctx.neighbors.find(n => n.place.id === agent.publicState.locationId)?.place.name ?? ctx.place.name
  return [
    `내 위치: 동쪽으로 ${Math.round(here.x)}m, 남쪽으로 ${Math.round(here.y)}m 지점 — ${region}, 발밑은 ${TERRAIN_NAMES[terrainAt(geo, here)]}`,
    `섬 크기: 가로 ${ctx.world.widthMeters}m, 세로 ${ctx.world.heightMeters}m. 섬 바깥은 바다이고 절벽은 올라갈 수 없다.`,
    `지도에 표시된 지역: ${ctx.neighbors.map(n => `${n.place.name}(${n.direction}쪽 ${n.distance}m)`).join(', ') || '없음'}`,
    ctx.closures.length
      ? `폐쇄 안내: ${ctx.closures.map(c => c.closed ? `${c.name} — 이미 폐쇄됨(머물면 몸이 상한다)` : `${c.name} — ${hoursAndMinutes(c.minutesUntil)} 뒤 폐쇄`).join(' / ')}`
      : '폐쇄 안내: 아직 없음',
    ctx.supplies.length
      ? `보급 투하 지점: ${ctx.supplies.map(s => `${s.name}(${s.direction}쪽 ${s.distance}m)`).join(', ')} — 그 자리까지 직접 가야 주울 수 있다.`
      : '보급 투하 지점: 표시된 것 없음',
    'GPS에 다른 참가자의 위치는 표시되지 않는다. 누가 어디 있는지는 직접 보거나 들어야 안다.',
  ].join('\n')
}

function placeLines(ctx: SceneContext): string {
  const dangerText = (d: SceneNeighbor['danger']) => d === 'closed' ? ' [위험 구역]' : d === 'warned' ? ' [곧 위험 구역]' : ''
  return [
    `${ctx.place.name} 부근, 발밑은 ${TERRAIN_NAMES[ctx.terrain]}${dangerText(ctx.placeDanger)}: ${ctx.place.description}`,
    `이곳에서 자연스럽게 구할 수 있을 법한 것: ${ctx.hints.length ? ctx.hints.join(', ') : '장소 설명에서 판단'}`,
    `이곳에 놓인 물건: ${ctx.items.filter(i => !i.holder).map(i => i.object.name).join(', ') || '없음'}`,
    `이곳의 자원: ${ctx.resources.map(r => `${r.resource.label} ${r.resource.level}${r.resource.unit ?? ''}`).join(', ') || '없음'}`,
    `갈 수 있는 곳(걸어서): ${ctx.neighbors.map(n => `${n.place.name}(${n.direction}쪽 ${n.distance}m, 약 ${n.travelMinutes}분)${dangerText(n.danger)}`).join(', ') || '없음'}`,
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
    '[내 GPS]', gpsLines(world, ctx, agent),
    '[지금 있는 곳]', placeLines(ctx),
    '[내 이동]', agent.publicState.travel ? `${world.places.find(p => p.id === agent.publicState.travel!.destinationPlaceId)?.name ?? '목적지'}(으)로 가는 중, 약 ${Math.max(0, agent.publicState.travel.arriveMinute - ctx.minute)}분 남음` : '멈춰 있다',
    // Only people this character actually perceives, by real distance — not everyone nearby.
    '[보이거나 들리는 사람]', (() => {
      const geo = world.engine!.geo!
      const noticed = others.flatMap(o => { const sense = perceive(world, geo, agent, o.agent); return sense ? [{ o, sense }] : [] })
      return noticed.length ? noticed.map(({ o, sense }) => {
        const d = Math.round(dist(agent.publicState.coord!, o.agent.publicState.coord!)), dir = direction(agent.publicState.coord!, o.agent.publicState.coord!)
        return sense === 'sight'
          ? `${relationLine(agent, o.agent)} — ${dir}쪽 ${d}m, 눈에 보인다 (${bodyText(o.agent).split(', ').pop()}, 들고 있는 것: ${ctx.items.filter(i => i.holder === o.handle).map(i => i.object.name).join(', ') || '보이지 않음'})`
          : `${dir}쪽 ${d}m쯤에서 누군가의 인기척이 들린다 (누구인지는 보이지 않는다)`
      }).join('\n') : '아무도 보이지 않는다. 혼자다.'
    })(),
    '[최근 방송]', v4.director.announcements.slice(-3).map(a => `- ${clockLabel(a.minute)} ${a.text}`).join('\n') || '- 없음',
    '[남은 사람]', pressure(world),
    '[내 기억]', journalText(agent, 20),
    '[직전에 겪은 장면]', lastScene.slice(-1200) || '(없음)',
    '[지금]', `${clockLabel(ctx.minute)} (${dayPart(ctx.minute)}), 날씨 ${world.clock.weather}, ${world.clock.temperatureC}℃. 마지막 장면 이후 ${Math.max(0, ctx.minute - member.sinceMinute)}분이 지났다.`,
    isMature(world, execution) ? CHARACTER_MATURE : '',
    ctx.standoff && ctx.standoff.ids.includes(agent.id)
      ? '[이미 시작된 충돌] 이 싸움은 여러 장면째 이어지고 있다. 노려보며 재는 것은 이미 충분히 했다. 지금은 실제로 공격하든, 달아나든, 내놓고 빌든, 무엇이든 결판이 나는 쪽으로 움직여라.'
      : '',
    [
      '지시:',
      '- 설정과 장소에 자연스럽게 있을 법한 것(나무, 돌, 물, 물고기 등)은 활용할 수 있다. 소지품에 없는 특별한 물건은 없다. 칼, 총, 밧줄, 라이터처럼 소지품에 없는 물건을 가진 것처럼 행동하지 마라.',
      '- 결과를 단정하지 말고 무엇을 어떻게 시도하는지 구체적으로 말하라. 성공 여부는 세계가 정한다.',
      '- 목표와 성격, 몸 상태, 기억에 따라 판단하라. 방금 한 일을 되풀이하지 말고 상황을 한 걸음 진전시켜라.',
      '- 달아나려면 다친 몸과 쌓인 피로가 발목을 잡는다는 것을 알고 있다. 성한 상대에게서 맨땅으로 도망치는 것은 거의 성공하지 못하고, 숲이나 폐허처럼 몸을 숨길 곳이 있거나 상대가 더 다쳐 있을 때 승산이 있다.',
      '- 상대가 달아나면 쫓을지 포기할지는 당신의 선택이다. 쫓겠다면 action에 분명히 써라.',
      '- GPS의 폐쇄 안내를 계획에 반영하라. 지금 있는 곳이 폐쇄 예정이면 남은 시간과 이동 시간을 비교해 떠날지 버틸지 정하고, 이미 폐쇄된 곳에서는 무엇보다 먼저 빠져나가라.',
      '- 보급 투하 지점이 GPS에 찍혔다면 거기 무엇이 있을지, 누가 먼저 도착할지 계산하고 갈지 말지 정하라.',
      '- thought는 속마음, action은 지금부터 할 행동, speech는 실제로 입 밖에 낼 말(없으면 null), targetName은 상대 이름(없으면 null), moveTo는 「갈 수 있는 곳」 중 한 곳으로 떠날 때 그 이름(아니면 null). 멀리 있는 사람에게 말을 걸거나 공격하려면 먼저 다가가야 한다.',
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
    beats: handleArray({ who: str, did: str }),
    conflict: { type: 'object', additionalProperties: false,
      properties: { active: { type: 'boolean' }, resolution: { type: 'string', enum: ['none', 'fled', 'yielded', 'subdued', 'killed', 'separated', 'settled'] },
        fleeing: nullableStr, chasing: { type: 'array', items: str } },
      required: ['active', 'resolution', 'fleeing', 'chasing'] },
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
  required: ['title', 'prose', 'durationMinutes', 'beats', 'conflict', 'outcomes'],
}

export function buildGmPrompt(world: WorldState, execution: WorldExecution, v4: V4State, ctx: SceneContext, intents: CharacterIntent[], previousScene: string, corrections = ''): string {
  const cast = ctx.cast.map(c => {
    const design = execution.draft.characters.find(d => d.id === c.agent.id)
    const intent = intents.find(i => i.agentId === c.agent.id)
    return { handle: c.handle, 이름: c.agent.name, 나이: design?.age, 성별: design?.gender, 성격: design?.personality, 목표: design?.goal,
      몸: bodyText(c.agent),
      // The GM cannot aim a killing blow without knowing how much the body has already taken.
      누적부상: `${c.agent.body?.health ?? 0}/10${(c.agent.body?.health ?? 0) >= 6 ? ' — 제대로 한 번 더 맞으면 죽는다' : (c.agent.body?.health ?? 0) >= 3 ? ' — 성한 몸이 아니다' : ''}`,
      지친정도: `피로 ${Math.round(c.agent.humanState?.fatigue ?? 0)}/10, 갈증 ${Math.round(c.agent.vitals?.thirst ?? 0)}/10`, 소지품: ctx.items.filter(i => i.holder === c.handle).map(i => `${i.handle} ${i.object.name}`),
      관계: ctx.cast.filter(o => o.agent.id !== c.agent.id).map(o => relationLine(c.agent, o.agent)),
      지난장면이후: `${Math.max(0, ctx.minute - c.sinceMinute)}분`,
      발밑: TERRAIN_NAMES[c.terrain],
      // The map is the truth: this is exactly where the minimap marker stands.
      좌표: { x: Math.round(c.agent.publicState.coord!.x), y: Math.round(c.agent.publicState.coord!.y) },
      지역: world.places.find(p => p.id === c.agent.publicState.locationId)?.name ?? ctx.place.name,
      // Real distances and who notices whom: the scene must respect these, not a shared place name.
      다른인물: ctx.cast.filter(o => o.agent.id !== c.agent.id).map(o => {
        const sense = perceive(world, world.engine!.geo!, c.agent, o.agent)
        return `${o.handle}까지 ${Math.round(dist(c.agent.publicState.coord!, o.agent.publicState.coord!))}m (${sense === 'sight' ? '보임' : sense === 'hearing' ? '소리만 들림' : '알아채지 못함'})`
      }),
      이동중: c.agent.publicState.travel ? `${world.places.find(p => p.id === c.agent.publicState.travel!.destinationPlaceId)?.name ?? '목적지'}행, ${Math.max(0, c.agent.publicState.travel.arriveMinute - ctx.minute)}분 남음` : null,
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
    '[공간 상태 — 지도와 어긋나게 쓰지 말 것]', JSON.stringify({
      장면위치: { x: Math.round(ctx.origin.x), y: Math.round(ctx.origin.y), 지형: TERRAIN_NAMES[ctx.terrain], 지역: ctx.place.name },
      섬크기: `${ctx.world.widthMeters}m x ${ctx.world.heightMeters}m`,
      주변지역: ctx.neighbors.slice(0, 5).map(n => `${n.place.name} ${n.direction}쪽 ${n.distance}m(걸어서 ${n.travelMinutes}분)`),
      폐쇄: ctx.closures.map(c => c.closed ? `${c.name} 폐쇄됨` : `${c.name} ${hoursAndMinutes(c.minutesUntil)} 뒤 폐쇄`),
      보급: ctx.supplies.map(s => `${s.name} ${s.direction}쪽 ${s.distance}m`),
      손닿는물건: ctx.items.filter(i => !i.holder).map(i => i.object.name),
    }),
    ctx.standoff ? ['[진행 중인 충돌 — 아직 끝나지 않았다]',
      `이 사람들의 충돌은 이미 ${ctx.standoff.scenes}개 장면 동안 이어졌다. 경위: ${ctx.standoff.note || '서로 적대 중'}.`,
      ctx.standoff.mustResolve
        ? '이번 장면에서 반드시 끝낸다. 도주, 굴복, 제압, 사망 중 하나로 결판을 내고 conflict.active=false와 그 resolution을 쓴다. 또 대치만 반복하면 그 판정은 버려진다.'
        : '대치를 처음부터 다시 설명하지 말고 곧바로 다음 공방으로 들어간다. 이번 장면에서도 끝나지 않으면 conflict.active=true로 둔다.'].join('\n') : '',
    '[이 장면에 없는 사람 — 등장시키지 말 것]', ctx.absentNames.join(', ') || '없음',
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
      '5. 사망을 미루지 마라. 급소에 제대로 들어간 공격(severity 5), 누적부상이 6 이상인 사람이 다시 제대로 맞는 경우, 목을 조르거나 물에 빠뜨리거나 높은 곳에서 떨어뜨린 경우는 죽음이다. 누적부상과 severity의 합이 10이면 그 사람은 죽는다 — 그때는 반드시 deaths에 넣고 prose에도 분명히 쓴다. 죽을 상황을 가벼운 상처로 바꾸지 마라.',
      '6. prose는 3인칭 소설체. 분량은 벌어진 일의 수에 맞춘다: 사건 하나당 250자 안팎, 전체 250~1200자. 감각과 긴장은 살리되 묘사·심리·분위기로 분량을 채우지 마라. 길게 쓰는 대신 실제로 일어나는 일을 더 많이 만들어라. 수치, 게임 용어, 보고서 문체는 쓰지 않는다. 직전 장면을 되풀이하지 않는다.',
      '7. 혼자 있는 인물은 지난 장면 이후 흐른 시간 동안 무엇을 했는지 자연스럽게 이어서 쓴다.',
      '7-1. 인물 사이의 실제 거리와 인지 여부(다른인물)를 지킨다. "보임"은 서로 눈에 들어온 상태, "소리만 들림"은 누군가 있다는 것만 아는 상태, "알아채지 못함"은 그 사람이 있다는 것을 모르는 상태다. 말을 섞거나 물건을 건네거나 공격하려면 몇 m 안으로 다가가야 하고, 다가가는 동안 상대가 피하거나 숨을 수 있다. 같은 이름의 장소에 있다는 것만으로 마주쳤다고 쓰지 않는다.',
      '8. outcomes는 prose와 정확히 일치해야 한다. prose에 쓴 이동, 부상, 획득, 건넴, 소비, 사망은 모두 outcomes에 넣고, prose에 없는 결과는 넣지 않는다. moves는 목적지로 출발하는 것이다: 도착은 표시된 이동 시간이 지난 뒤 세계가 처리하므로 prose에는 출발과 길을 나서는 모습까지만 쓴다. 함께 떠나는 사람도 한 명씩 모두 moves에 넣는다.',
      '9. outcomes의 참조에는 handle을 쓴다. who/by/from/to/holder는 P 번호, item은 I 번호, 장소 자원을 먹거나 마시면 consumed에 R 번호, 자원을 챙겨 가면 transfers에 R 번호와 받는 P 번호, 이동 to는 L 번호. 떨어뜨리거나 내려놓으면 transfers.to=null. 단 created.name에는 handle이 아니라 실제 물건 이름을 쓴다.',
      '10. severity는 1(긁힘)~5(치명상). needs는 이 장면에서 먹고(ate), 마시고(drank), 쉰(rested) 만큼의 회복량 0~10이다(조개 몇 개=2, 충분한 한 끼=5, 물을 실컷=6, 한 시간 휴식=2). 먹거나 쉬지 않았으면 0. relations.trust는 -3~3.',
      '11. memories에는 인물마다 이 장면을 그 인물이 알 수 있는 것만으로 한 문장씩 적는다.',
      '12. durationMinutes는 이 장면이 다루는 세계 시간(10~240분). title은 장면을 드러내는 짧은 제목.',
      '13. created에는 실제 물건만 넣는다. 들고 다닐 수 있으면 holder=그 인물, 모닥불·은신처·덫처럼 설치한 것은 holder=null(그 장소에 남음). 불꽃, 신호, 소리 같은 현상은 물건이 아니다.',
      '14. 모든 장면은 무언가가 달라진 채 끝난다(위치, 소지품, 몸, 관계 중 하나 이상). 긴장만 쌓고 아무 일도 일어나지 않는 장면이나 "싸움은 이제부터 시작이었다" 같은 예고성 마무리를 쓰지 않는다.',
      '15. beats에는 이 장면에서 실제로 벌어진 일을 순서대로 적는다. 한 beat는 "누가 무엇을 해서 어떻게 됐다"까지 쓴 한 문장이다. 생각, 분위기, 결심, 예고, 결과 없는 시도는 beat가 아니다. 인물이 둘 이상이면 2개 이상, 충돌 장면이면 3개 이상. prose에는 beats에 적은 일만 담고, beats에 있는 일은 모두 prose에 쓴다.',
      '16. conflict: 이 장면이 끝난 뒤에도 같은 상대와 싸움·협박·추격이 이어지면 active=true, resolution="none". 끝났으면 active=false와 실제 결말(fled 도주, yielded 굴복, subdued 제압, killed 사망, separated 서로 놓침, settled 합의). 싸움이나 위협이 없었으면 active=false, resolution="none". active=true로 두려면 이 장면에서 실제로 공방이 오가고 그 결과가 beats와 outcomes에 있어야 한다.',
      '16-1. 누군가 달아나면 fleeing에 그 사람(P 번호)을 넣고, 상대가 쫓기로 했으면 chasing에 쫓는 사람들을 넣는다. 포기했으면 chasing은 빈 배열로 두고 포기하는 이유를 prose에 쓴다. 쫓는 쪽은 성격과 목표에 따라 정하되, 상대가 크게 다쳤거나 빼앗을 것이 있으면 보통 쫓는다. 추격의 결과(따라잡았는지, 놓쳤는지)는 세계가 판정해 장면 끝에 붙이므로 prose에 쓰지 마라. moves에는 달아나는 사람을 넣지 않는다.',
      '17. 창작 금지: 세계가 준 것 외에는 아무것도 존재하지 않는다. prose에 쓸 수 있는 물건은 [handle 목록]의 물건과 자원, 각 인물의 소지품, 그리고 이 장면에서 created에 넣은 것뿐이다. 칼, 총, 밧줄, 붕대, 라이터, 손전등, 휴대폰처럼 받지 않은 물건을 등장시키지 마라. 필요하면 created로 만들되 만드는 과정과 재료가 prose에 있어야 한다.',
      '18. 등장인물은 [인물과 의도]에 있는 사람뿐이다. 없는 사람을 등장시키거나, 인물이 알 수 없는 사실(다른 곳에서 벌어진 일, 상대의 속마음)을 아는 것처럼 쓰지 마라. 기록되지 않은 과거(전에 도와줬던 일, 예전 약속)를 만들어 붙이지 마라.',
      '18-1. 공간을 지어내지 마라. 인물의 위치, 거리, 방향, 지형, 지역은 [공간 상태]와 [인물과 의도]의 좌표가 전부다. 지도에 없는 길, 다리, 건물, 동굴, 강을 만들지 마라. 같은 지역에 있어도 수백 m 떨어져 있으면 마주친 것이 아니고, 지역이 달라도 몇 m 거리에서 서로 보이면 마주친 것이다.',
      '18-2. 이동은 출발지와 도착지만 쓰지 말고 실제로 지나는 지형을 써라(예: 샘터 북쪽 숲을 빠져나와 협곡 동쪽 능선을 따라). 거리는 숫자를 나열하지 말고 공간감으로 바꿔 써라 — 좌표나 "18m"같은 수치를 소설 문장에 그대로 적지 마라. 다만 거리가 좁혀지고 벌어지는 변화는 장면에서 분명히 느껴져야 한다.',
      '19. prose에 쓴 모든 결과는 outcomes에 있어야 하고, outcomes에 없는 결과는 prose에 쓰지 않는다. 다쳤다면 injuries, 죽었다면 deaths, 얻거나 만들었다면 created나 transfers, 먹거나 마셨다면 needs와 consumed에 넣는다. 도착은 쓰지 않는다(moves는 출발까지만).',
    ].join('\n'),
    corrections ? `[이전 판정 오류 — 고쳐서 다시 작성]\n${corrections}` : '',
  ].filter(Boolean).join('\n\n')
}
