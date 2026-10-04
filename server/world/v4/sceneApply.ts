// v4 GM result → world. Only HARD facts are checked: who is present and alive, what they hold,
// where they can walk, and whether a death is justified. Everything else is the GM's judgment.
import { randomUUID } from 'node:crypto'
import type { Agent, ChronicleEntry, RelationshipStance, StateChange, WorldEvent, WorldState } from '../../domain/worldTypes.ts'
import type { WorldObject } from '../engineTypes.ts'
import type { CharacterIntent, ConflictResolution, GmResult, V4State } from './sceneTypes.ts'
import { clockLabel, type SceneContext } from './scenePrompts.ts'
import { hurtAgent, killAgent, LETHAL_BURDEN } from './mortality.ts'
import { resolveChase } from './pursuit.ts'
import { pointNear } from '../geo/geoBuild.ts'
import { planTravel } from '../geo/movement.ts'

const KINDS = new Set(['item', 'food', 'water', 'medicine', 'tool'])
const RESOLUTIONS = new Set<ConflictResolution>(['none', 'fled', 'yielded', 'subdued', 'killed', 'separated', 'settled'])
// Things nobody on an island can simply have: they exist only if the engine put them in the scene.
const MANUFACTURED = ['총', '권총', '소총', '엽총', '산탄', '총알', '탄창', '라이터', '성냥', '손전등', '무전기', '휴대폰', '휴대전화', '열쇠',
  '수갑', '통조림', '생수', '비상식량', '구급', '방독면', '폭탄', '수류탄', '자동차', '트럭', '오토바이', '자전거', '보트', '진통제', '항생제', '소독약']
// Things a scene may introduce, but only through created/transfers — never as prose scenery.
const EQUIPMENT = ['칼', '단검', '나이프', '도끼', '망치', '쇠파이프', '철근', '밧줄', '로프', '붕대', '그물', '낚싯대', '사슬']
const DEATH_WORDS = /숨을 거두|숨이 끊|죽었|죽고 말았|목숨을 잃|시신|주검|절명|싸늘하게 식/
const WOUND_WORDS = /피가 (?:흐|터|솟|번|배)|피를 흘|찔렸|베였|부러졌|뼈가|상처를 입|부상을 입/
// Padding that promises a scene instead of playing one.
const FORECAST = /이제부터 시작|시작일 뿐|시작에 불과|곧 [^.!?]{0,14}(?:올|닥칠|벌어질|터질) 것|머지않아|조만간|서막|전조에 불과/
// A name may surface as something a character remembers; it may not walk onto the page.
const RECALL = /기억|떠올|생각|말했던|들었던|전에|예전|지난|이름|소식|방송|죽은|시체|시신/
const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const int = (v: unknown, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)))
const list = (v: unknown): Array<Record<string, unknown>> => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Array<Record<string, unknown>> : []

const HANDLE = /^[PIRL]\d+$/i
// "Move" to where they already are (the GM sometimes calls the current place L0) is no move.
const staysHere = (ctx: SceneContext, to: string) => to.toUpperCase() === 'L0' || to === ctx.place.name
// The GM sometimes writes "I1=단검" or "L1=좁은 협곡"; the handle is what counts.
const ref = (v: unknown) => { const t = typeof v === 'string' ? v.trim() : ''; const m = /^([PIRL]\d+)\s*=/i.exec(t); return (m ? m[1] : t).slice(0, 40) }
const nullableRef = (v: unknown) => ref(v) || null
// A created name must be a real name: "I3=나무창" keeps "나무창".
const itemName = (v: unknown) => text(typeof v === 'string' ? v.replace(/^[PIRL]\d+\s*=\s*/i, '') : v, 40)

export function parseGmResult(raw: unknown): GmResult {
  const r = raw as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || typeof r.prose !== 'string' || !r.outcomes || typeof r.outcomes !== 'object') throw new Error('invalid_gm_result')
  const o = r.outcomes as Record<string, unknown>
  const conflict = (r.conflict ?? {}) as Record<string, unknown>
  const resolution = text(conflict.resolution, 16) as ConflictResolution
  return {
    title: text(r.title, 80), prose: text(r.prose, 6000), durationMinutes: int(r.durationMinutes, 10, 240),
    beats: list(r.beats).map(b => ({ who: ref(b.who), did: text(b.did, 200) })).filter(b => b.did),
    conflict: { active: conflict.active === true, resolution: RESOLUTIONS.has(resolution) ? resolution : 'none',
      fleeing: nullableRef(conflict.fleeing), chasing: (Array.isArray(conflict.chasing) ? conflict.chasing : []).map(ref).filter(Boolean) },
    outcomes: {
      moves: list(o.moves).map(m => ({ who: ref(m.who), to: ref(m.to) })),
      injuries: list(o.injuries).map(m => ({ who: ref(m.who), severity: int(m.severity, 1, 5), description: text(m.description, 200), by: nullableRef(m.by) })),
      deaths: list(o.deaths).map(m => ({ who: ref(m.who), cause: text(m.cause, 200), by: nullableRef(m.by) })),
      created: list(o.created).map(m => ({ name: itemName(m.name), kind: text(m.kind, 12), holder: nullableRef(m.holder), description: text(m.description, 200) })),
      transfers: list(o.transfers).map(m => ({ item: ref(m.item), to: nullableRef(m.to) })),
      consumed: list(o.consumed).map(m => ({ item: ref(m.item) })),
      needs: list(o.needs).map(m => ({ who: ref(m.who), ate: int(m.ate, 0, 10), drank: int(m.drank, 0, 10), rested: int(m.rested, 0, 10) })),
      relations: list(o.relations).map(m => ({ from: ref(m.from), to: ref(m.to), trust: int(m.trust, -3, 3), note: text(m.note, 160) })),
      memories: list(o.memories).map(m => ({ who: ref(m.who), text: text(m.text, 240) })),
    },
  }
}

// Returns problems that make the prose untrustworthy (the GM must rewrite), or [] if applicable.
// Only an unjustified death or an unreadable scene is fatal; a bad reference in any other outcome
// (unknown person, item or place) is simply skipped by applyGmResult.
export function gmIssues(ctx: SceneContext, result: GmResult): string[] {
  const issues: string[] = []
  const person = (h: string | null) => ctx.cast.find(c => c.handle === h)
  const living = (h: string) => { const c = person(h); return c && c.agent.publicState.status !== 'deceased' ? c : undefined }
  if (result.prose.length < 80) issues.push('prose가 너무 짧다. 250자 이상의 장면을 써라.')
  if (/\b(?:P|I|R|L)\d+\b/.test(result.prose)) issues.push('prose에 handle(P1, I1 등)을 쓰지 말고 이름을 써라.')
  const prose = result.prose, NEWLINE = String.fromCharCode(10)
  const sentences = prose.split(NEWLINE).flatMap(line => line.split(/[.!?"”]/)).filter(s => s.trim())
  const beats = result.beats.filter(b => b.did.length >= 4)
  const o = result.outcomes
  // 1 — DENSITY: a scene is worth its length in things that happened, not in atmosphere.
  if (!beats.length) issues.push('beats가 비어 있다. 이 장면에서 실제로 벌어진 일을 "누가 무엇을 해서 어떻게 됐다"로 적어라.')
  if (ctx.cast.length > 1 && beats.length < 2) issues.push('사람이 둘 이상 있는 장면이다. 실제로 벌어진 일을 2개 이상 만들고 beats에 적어라.')
  if (ctx.standoff && beats.length < 3) issues.push('이어지는 충돌 장면이다. 공방과 그 결과를 3개 이상 만들고 beats에 적어라.')
  if (beats.length && prose.length > 400 * beats.length) issues.push(`prose가 사건 수에 비해 너무 길다(사건 ${beats.length}개, ${prose.length}자). 묘사로 분량을 채우지 말고 실제 사건을 더 만들거나 문장을 줄여라.`)
  if (prose.length > 1400) issues.push('prose가 너무 길다. 분위기 묘사를 줄이고 실제로 벌어진 일만 써라.')
  if (result.durationMinutes > 90 && beats.length < 3) issues.push(`${result.durationMinutes}분을 다루면서 벌어진 일이 ${beats.length}개뿐이다. 사건을 더 만들거나 durationMinutes를 줄여라.`)
  if (FORECAST.test(prose.slice(-300))) issues.push('예고로 장면을 끝내지 마라. 예고할 일을 이 장면에서 실제로 일으켜라.')
  // The GM is given burden and fatigue as numbers so it can aim; the reader never sees them.
  if (/[0-9]+ ?\/ ?10|누적부상|severity|durationMinutes/.test(prose))
    issues.push('prose에 수치나 판정 용어를 쓰지 마라. 몸 상태는 움직임과 감각으로만 보여라.')
  // Map coordinates are for adjudication. The reader gets distance as space, not as data.
  if (/좌표|\([0-9]{2,4} ?, ?[0-9]{2,4}\)|[XY] ?[0-9]{3,}/.test(prose))
    issues.push('prose에 좌표를 그대로 쓰지 마라. 거리와 방향은 보이는 것, 들리는 것, 걸리는 시간으로 표현해라.')
  // 2 — NO INVENTION: every object named in the prose was supplied to the scene or created in it.
  const supplied = [ctx.place.name, ctx.place.description, ...ctx.hints, ...ctx.items.map(i => `${i.object.name} ${i.object.form ?? ''}`),
    ...ctx.resources.map(r => r.resource.label), ...ctx.neighbors.map(n => n.place.name)].join(' ')
  const createdText = o.created.map(c => `${c.name} ${c.description}`).join(' ')
  for (const word of [...MANUFACTURED, ...EQUIPMENT])
    if (prose.includes(word) && !supplied.includes(word) && !createdText.includes(word))
      issues.push(`prose의 "${word}"은(는) 이 장면에 없는 물건이다. 소지품과 이곳에 있는 것만 쓰거나, 만들었다면 created에 넣고 만드는 과정을 써라.`)
  for (const c of o.created) for (const word of MANUFACTURED)
    if (c.name.includes(word)) issues.push(`created의 "${c.name}"은(는) 이 세계에서 만들어낼 수 없는 물건이다.`)
  for (const c of o.created) {
    const tokens = [...c.name].map((_, i) => c.name.slice(i, i + 2)).filter(t => t.length === 2 && t.trim().length === 2)
    if (tokens.length && !tokens.some(t => prose.includes(t))) issues.push(`created의 "${c.name}"이 prose에 없다. 얻거나 만든 과정을 장면에 써라.`)
  }
  // 3 — NO INVENTED CAST: whoever is not in this scene cannot act in it.
  for (const name of ctx.absentNames) {
    if (!prose.includes(name) || ctx.cast.some(c => c.agent.name.includes(name))) continue
    if (sentences.filter(s => s.includes(name)).every(s => RECALL.test(s))) continue
    issues.push(`prose의 ${name}은(는) 이 장면에 없는 사람이다. 지금 이 자리에 있는 사람만 등장시켜라.`)
  }
  // 4 — THE PROSE AND THE OUTCOMES MUST SAY THE SAME THING.
  if (DEATH_WORDS.test(prose) && !o.deaths.length) issues.push('prose는 사람이 죽었다고 쓰면서 deaths가 비어 있다. 죽음을 지우거나 deaths에 넣어라.')
  if (o.deaths.length && !DEATH_WORDS.test(prose)) issues.push('deaths에 사망이 있는데 prose에 죽음이 분명히 쓰여 있지 않다.')
  const alreadyHurt = ctx.cast.some(c => (c.agent.body?.health ?? 0) >= 3)
  if (WOUND_WORDS.test(prose) && !o.injuries.length && !o.deaths.length && !alreadyHurt)
    issues.push('prose는 다쳤다고 쓰면서 injuries가 비어 있다. 부상을 지우거나 injuries에 넣어라.')
  for (const m of o.moves) {
    const dest = ctx.neighbors.find(n => n.handle === m.to)
    if (!dest) continue
    const at = prose.indexOf(dest.place.name)
    if (at >= 0 && /(?:에 도착|에 닿|에 들어섰|에 들어갔|에 이르)/.test(prose.slice(at, at + 40)))
      issues.push(`${dest.place.name}까지는 약 ${dest.travelMinutes}분 걸린다. 이 장면에는 출발까지만 쓰고 도착은 쓰지 마라.`)
  }
  const peopleRefs = [...o.moves.map(m => m.who), ...o.injuries.flatMap(i => [i.who, i.by]), ...o.deaths.flatMap(d => [d.who, d.by]),
    ...o.created.map(c => c.holder), ...o.transfers.map(t => t.to), ...o.needs.map(n => n.who),
    ...o.relations.flatMap(r => [r.from, r.to]), ...o.memories.map(m => m.who), ...beats.map(b => b.who),
    result.conflict.fleeing, ...result.conflict.chasing]
  for (const handle of new Set(peopleRefs.filter((h): h is string => Boolean(h))))
    if (!person(handle)) issues.push(`outcomes의 "${handle}"은(는) 이 장면에 없는 사람이다. 사람은 [인물과 의도]의 P 번호로만 가리켜라.`)
  // 5 — LETHALITY IS ARITHMETIC: a wound that reaches the lethal burden kills, and the prose
  // has to say so. Without this the GM quietly writes survivable scratches forever.
  for (const c of ctx.cast) {
    const burden = (c.agent.body?.health ?? 0) + o.injuries.filter(i => i.who === c.handle).reduce((n, i) => n + i.severity, 0)
    if (burden >= LETHAL_BURDEN && !o.deaths.some(d => d.who === c.handle))
      issues.push(`${c.agent.name}은(는) 이 부상으로 죽는다(누적 ${burden}/${LETHAL_BURDEN}). deaths에 넣고 prose에도 죽음을 쓰거나, severity를 실제 공격에 맞게 낮춰라.`)
  }
  // 6 — RUNNING AWAY IS NOT AN ENDING. The world resolves the chase, so the prose may not.
  if (result.conflict.resolution === 'fled' && !result.conflict.fleeing)
    issues.push('도주로 끝났다면 fleeing에 달아난 사람(P 번호)을 넣고, 쫓는 사람은 chasing에 넣어라.')
  if (result.conflict.fleeing && /완전히 벗어났|시야에서 사라졌|놓치고 말았|따라잡았|붙잡았|추격을 포기하고 돌아/.test(prose))
    issues.push('추격의 결과는 세계가 좌표와 속도로 판정한다. prose에는 달아나기 시작하는 모습까지만 써라.')
  if (result.conflict.fleeing && o.moves.some(m => m.who === result.conflict.fleeing))
    issues.push('달아나는 사람은 moves에 넣지 않는다. fleeing으로만 표시하고 추격 판정은 세계에 맡겨라.')
  // 7 — A FIGHT RUNS UNTIL IT ENDS, AND THEN IT ENDS.
  if (ctx.standoff?.mustResolve && result.conflict.active)
    issues.push('이 충돌은 이미 여러 장면째다. 이번 장면에서 도주·굴복·제압·사망 중 하나로 끝내고 conflict.active=false와 resolution을 적어라.')
  if (ctx.standoff && result.conflict.active && !o.injuries.length && !o.deaths.length && !o.moves.length && !o.transfers.length)
    issues.push('이어지는 충돌인데 아무것도 달라지지 않았다. 실제 공방의 결과(부상, 도주, 빼앗김)를 내라.')
  if (!result.conflict.active && result.conflict.resolution === 'killed' && !o.deaths.length)
    issues.push('resolution이 killed인데 deaths가 비어 있다.')
  for (const m of result.outcomes.deaths) {
    const victim = living(m.who)
    if (!victim) continue // already dead or not in this scene: nothing to apply
    const burden = (victim.agent.body?.health ?? 0) + result.outcomes.injuries.filter(i => i.who === m.who).reduce((n, i) => n + i.severity, 0)
    const killer = m.by && m.by !== m.who && person(m.by)
    if (!killer && burden < 7 && ctx.placeDanger !== 'closed') issues.push(`deaths: ${victim.agent.name}의 죽음에 근거가 없다. 치명적인 공격자(by)나 치명상(injuries severity)이 함께 있어야 한다.`)
  }
  for (const c of result.outcomes.created) if (HANDLE.test(c.name)) issues.push(`created: name에 handle(${c.name})이 아니라 실제 물건 이름(예: 조잡한 나무창)을 써라.`)
  return issues
}

function stanceFor(trust: number): RelationshipStance {
  return trust >= 8 ? 'ally' : trust >= 6 ? 'friendly' : trust >= 4 ? 'neutral' : trust >= 2 ? 'wary' : 'hostile'
}

function removeFromInventories(world: WorldState, objectId: string) {
  for (const a of world.agents) a.inventory = a.inventory.filter(id => id !== objectId)
}

export interface AppliedScene { event: WorldEvent; scene: ChronicleEntry }

export function applyGmResult(world: WorldState, v4: V4State, seasonId: string, ctx: SceneContext, result: GmResult, intents: CharacterIntent[]): AppliedScene {
  const engine = world.engine!, minute = engine.minute, changes: StateChange[] = []
  const person = (h: string | null) => ctx.cast.find(c => c.handle === h)?.agent
  const o = result.outcomes
  for (const i of o.injuries) {
    const a = person(i.who)
    if (!a || a.publicState.status === 'deceased') continue
    // Full severity, every time. gmIssues already refuses a scene whose wounds reach the lethal
    // burden without a recorded death, so a killing blow is allowed to kill here.
    hurtAgent(world, a, i.severity, changes)
  }
  for (const d of o.deaths) { const a = person(d.who); if (a) killAgent(world, a, changes) }
  for (const c of o.created.slice(0, 4)) {
    if (!c.name) continue
    const holder = person(c.holder)
    const onTheGround = !holder || holder.publicState.status === 'deceased'
    const obj: WorldObject = { id: `made-${randomUUID()}`, name: c.name, kind: (KINDS.has(c.kind) ? c.kind : 'item') as WorldObject['kind'], quantity: 1, condition: 'intact',
      form: c.description || undefined, location: onTheGround ? { kind: 'place', id: ctx.place.id } : { kind: 'agent', id: holder!.id },
      ...(onTheGround ? { coord: { ...ctx.origin } } : {}) }
    engine.objects.push(obj)
    if (obj.location.kind === 'agent') holder!.inventory.push(obj.id)
    changes.push({ field: `object:${obj.id}:holder`, from: 'none', to: obj.location.kind === 'agent' ? obj.location.id : `place:${ctx.place.id}` })
  }
  for (const t of o.transfers) {
    const found = ctx.items.find(i => i.handle === t.item)
    const receiver = person(t.to)
    if (t.to !== null && (!receiver || receiver.publicState.status === 'deceased')) continue // unknown recipient: skip
    if (!found && !HANDLE.test(t.item) && t.item) {
      // A named natural material picked up from the surroundings (e.g. 천 조각) becomes a real object.
      const carried = receiver && receiver.publicState.status !== 'deceased'
      const obj: WorldObject = { id: `found-${randomUUID()}`, name: t.item, kind: 'item', quantity: 1, condition: 'intact',
        location: carried ? { kind: 'agent', id: receiver.id } : { kind: 'place', id: ctx.place.id }, ...(carried ? {} : { coord: { ...ctx.origin } }) }
      engine.objects.push(obj)
      if (obj.location.kind === 'agent') receiver!.inventory.push(obj.id)
      changes.push({ field: `object:${obj.id}:holder`, from: 'none', to: obj.location.kind === 'agent' ? obj.location.id : `place:${ctx.place.id}` })
      continue
    }
    const res = found ? undefined : ctx.resources.find(r => r.handle === t.item)?.resource
    if (res && res.level >= 1 && receiver && receiver.publicState.status !== 'deceased') {
      // Taking a portion of a place resource turns it into a carried object.
      changes.push({ field: `place:${ctx.place.id}:resource:${res.key}`, from: String(res.level), to: String(res.level - 1) }); res.level -= 1; res.trend = 'down'
      const kind = (['food', 'water', 'medicine'].includes(res.key) ? res.key : 'item') as WorldObject['kind']
      const obj: WorldObject = { id: `taken-${randomUUID()}`, name: `${res.label} 1${res.unit ?? ''}`, kind, quantity: 1, condition: 'intact', location: { kind: 'agent', id: receiver.id } }
      engine.objects.push(obj); receiver.inventory.push(obj.id)
      changes.push({ field: `object:${obj.id}:holder`, from: `place:${ctx.place.id}`, to: receiver.id })
      continue
    }
    if (!found || found.object.quantity <= 0) continue
    const from = found.object.location.kind === 'agent' ? found.object.location.id : `place:${found.object.location.id}`
    removeFromInventories(world, found.object.id)
    found.object.location = receiver && receiver.publicState.status !== 'deceased' ? { kind: 'agent', id: receiver.id } : { kind: 'place', id: ctx.place.id }
    // Picked up: it travels with its carrier. Put down: it lies where this scene is happening.
    found.object.coord = found.object.location.kind === 'agent' ? undefined : { ...ctx.origin }
    if (found.object.location.kind === 'agent') receiver!.inventory.push(found.object.id)
    changes.push({ field: `object:${found.object.id}:holder`, from, to: found.object.location.kind === 'agent' ? found.object.location.id : `place:${ctx.place.id}` })
  }
  for (const c of o.consumed) {
    const found = ctx.items.find(i => i.handle === c.item)
    if (found && found.object.quantity > 0) {
      found.object.quantity -= 1
      if (found.object.quantity <= 0) { found.object.condition = 'destroyed'; removeFromInventories(world, found.object.id) }
      changes.push({ field: `object:${found.object.id}:quantity`, from: String(found.object.quantity + 1), to: String(found.object.quantity) })
      continue
    }
    const res = ctx.resources.find(r => r.handle === c.item)?.resource
    if (res && res.level >= 1) { changes.push({ field: `place:${ctx.place.id}:resource:${res.key}`, from: String(res.level), to: String(res.level - 1) }); res.level -= 1; res.trend = 'down' }
  }
  const clamp = (v: number) => Math.min(10, Math.max(0, Math.round(v * 10) / 10))
  for (const n of o.needs) {
    const a = person(n.who)
    if (!a || a.publicState.status === 'deceased') continue
    a.vitals ??= { health: 10, energy: 8, hunger: 2, thirst: 2, loneliness: 2 }
    a.humanState ??= { survival_need: 2, fatigue: 2, stress: 3, sexual_desire: 1, greed: 3, ambition: 3 }
    if (n.ate) { changes.push({ field: `agent:${a.id}:hunger`, from: String(a.vitals.hunger), to: String(clamp(a.vitals.hunger - n.ate)) }); a.vitals.hunger = clamp(a.vitals.hunger - n.ate) }
    if (n.drank) { changes.push({ field: `agent:${a.id}:thirst`, from: String(a.vitals.thirst), to: String(clamp(a.vitals.thirst - n.drank)) }); a.vitals.thirst = clamp(a.vitals.thirst - n.drank) }
    if (n.rested) a.humanState.fatigue = clamp(a.humanState.fatigue - n.rested)
    a.humanState.survival_need = Math.max(a.vitals.hunger, a.vitals.thirst)
  }
  for (const r of o.relations) {
    const from = person(r.from), to = person(r.to)
    if (!from || !to || from.id === to.id) continue
    let rel = from.relationships.find(x => x.otherAgentId === to.id)
    if (!rel) { rel = { agentId: from.id, otherAgentId: to.id, stance: 'neutral', trust: 5, affection: 5 }; from.relationships.push(rel) }
    const before = rel.trust ?? 5
    rel.trust = Math.min(10, Math.max(0, before + r.trust))
    rel.stance = stanceFor(rel.trust)
    if (r.note) rel.note = r.note
    rel.lastChangedAt = new Date().toISOString()
    if (rel.trust !== before) changes.push({ field: `relationship:${from.id}:${to.id}:trust`, from: String(before), to: String(rel.trust) })
  }
  for (const m of o.moves.filter(m => !staysHere(ctx, m.to))) {
    const a = person(m.who), dest = ctx.neighbors.find(n => n.handle === m.to)?.place
    if (!a || !dest || a.publicState.status === 'deceased' || !a.publicState.coord) continue
    // A departure, not a teleport: the trip is a timed path the world advances tick by tick.
    const geo = engine.geo!
    a.publicState.travel = planTravel(geo, a.publicState.coord, pointNear(geo, dest.id, `${a.id}:${minute}`, 60), minute, dest.id)
    changes.push({ field: `agent:${a.id}:travel`, from: `${a.publicState.coord.x},${a.publicState.coord.y}`, to: `${dest.id}@${a.publicState.travel.arriveMinute}` })
  }
  // Running away is settled on the ground, not in the prose: whoever was chased is caught, still
  // being run down, or genuinely gone — and only the last of those ends the encounter.
  const fleer = person(result.conflict.fleeing)
  const chase = fleer && fleer.publicState.status !== 'deceased'
    ? resolveChase(world, engine.geo!, fleer, result.conflict.chasing.map(h => person(h)).filter((a): a is Agent => Boolean(a)), changes)
    : null
  const fightContinues = result.conflict.active || chase?.status === 'caught' || chase?.status === 'chasing'
  // An unfinished fight stays on the books: the spotlight returns to these people next scene,
  // and the GM is told how long it has been running until it actually ends.
  const livingCast = ctx.cast.filter(c => c.agent.publicState.status !== 'deceased')
  const inStandoff = v4.standoff && v4.standoff.ids.some(id => ctx.cast.some(c => c.agent.id === id))
  if (fightContinues && livingCast.length >= 2) {
    const continuing = v4.standoff && v4.standoff.ids.filter(id => livingCast.some(c => c.agent.id === id)).length >= 2
    const last = result.beats.at(-1)
    const note = chase ? chase.text : last ? `${person(last.who)?.name ?? ''} ${last.did}`.trim() : result.title
    v4.standoff = { ids: livingCast.map(c => c.agent.id), startedMinute: continuing ? v4.standoff!.startedMinute : minute,
      scenes: (continuing ? v4.standoff!.scenes : 0) + 1, note: note.slice(0, 160) }
  } else if (inStandoff) delete v4.standoff
  // Encounters this scene narrated are no longer pending.
  const castIds = new Set(ctx.cast.map(c => c.agent.id))
  v4.encounters = (v4.encounters ?? []).filter(e => !e.ids.every(id => castIds.has(id)))
  const nowIso = new Date().toISOString()
  for (const c of ctx.cast) {
    const memory = o.memories.find(m => m.who === c.handle)?.text || intents.find(i => i.agentId === c.agent.id)?.action
    if (memory) c.agent.journal = [...(c.agent.journal ?? []), { minute, text: memory.slice(0, 240) }].slice(-60)
    c.agent.publicState.lastAction = result.title || null
    c.agent.publicState.lastActiveAt = nowIso
    v4.lastSceneMinute[c.agent.id] = minute
  }
  v4.sceneCount++
  const agentIds = ctx.cast.map(c => c.agent.id)
  const importance: WorldEvent['importance'] = o.deaths.length ? 'critical' : o.injuries.length ? 'high' : 'normal'
  const type: WorldEvent['type'] = o.deaths.length || o.injuries.length ? 'CONFLICT' : intents.some(i => i.speech) && ctx.cast.length > 1 ? 'DIALOGUE' : o.created.length ? 'DISCOVERY' : o.moves.length ? 'MOVE' : 'OBSERVATION'
  const title = result.title || `${ctx.place.name}의 ${clockLabel(minute).slice(-5)}`
  const beatLine = [...result.beats.map(b => `${person(b.who)?.name ?? ''} ${b.did}`.trim()), chase?.text ?? ''].filter(Boolean).join(' / ')
  const synopsis = (beatLine || result.prose.replace(/\s+/g, ' ')).slice(0, 240)
  const event: WorldEvent = { id: randomUUID(), type, occurredAt: nowIso, day: world.clock.day, worldTime: world.clock.time, worldMinute: minute,
    phase: 'COMPLETED', cause: 'v4_scene', outcome: 'CONFIRMED', placeId: ctx.place.id, agentIds, title, summary: synopsis,
    stateChanges: changes, importance, relatedEventIds: [] }
  const startMinute = Math.max(Math.min(...ctx.cast.map(c => c.sinceMinute)), minute - result.durationMinutes)
  const scene: ChronicleEntry = { id: `scene-v4-${event.id}`, kind: 'LIVE', seasonId, worldDay: world.clock.day,
    timeStart: clockLabel(startMinute).slice(-5), timeEnd: world.clock.time, title,
    // The chase verdict is engine fact; the reader gets it in the same scene, not a sequel.
    body: chase ? result.prose + String.fromCharCode(10, 10) + chase.text : result.prose,
    locationIds: [...new Set([ctx.place.id, ...o.moves.flatMap(m => ctx.neighbors.filter(n => n.handle === m.to).map(n => n.place.id))])],
    agentIds, sourceEventIds: [event.id], stateChanges: changes, importance: o.deaths.length ? 'major' : o.injuries.length ? 'notable' : 'ordinary', createdAt: nowIso }
  return { event, scene }
}
