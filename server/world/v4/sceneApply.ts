// v4 GM result → world. Only HARD facts are checked: who is present and alive, what they hold,
// where they can walk, and whether a death is justified. Everything else is the GM's judgment.
import { randomUUID } from 'node:crypto'
import type { ChronicleEntry, RelationshipStance, StateChange, WorldEvent, WorldState } from '../../domain/worldTypes.ts'
import type { WorldObject } from '../engineTypes.ts'
import type { CharacterIntent, GmResult, V4State } from './sceneTypes.ts'
import { clockLabel, type SceneContext } from './scenePrompts.ts'
import { hurtAgent, killAgent, LETHAL_BURDEN } from './mortality.ts'
import { pointNear } from '../geo/geoBuild.ts'
import { planTravel } from '../geo/movement.ts'

const KINDS = new Set(['item', 'food', 'water', 'medicine', 'tool'])
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
  return {
    title: text(r.title, 80), prose: text(r.prose, 6000), durationMinutes: int(r.durationMinutes, 10, 240),
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
  if (result.prose.length < 80) issues.push('prose가 너무 짧다. 400자 이상의 장면을 써라.')
  if (/\b(?:P|I|R|L)\d+\b/.test(result.prose)) issues.push('prose에 handle(P1, I1 등)을 쓰지 말고 이름을 써라.')
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
    // Without a recorded death the prose says they survived: wounds stop one step short of lethal.
    const dies = o.deaths.some(d => d.who === i.who)
    const amount = dies ? i.severity : Math.min(i.severity, Math.max(0, LETHAL_BURDEN - 1 - (a.body?.health ?? 0)))
    if (amount > 0) hurtAgent(world, a, amount, changes)
  }
  for (const d of o.deaths) { const a = person(d.who); if (a) killAgent(world, a, changes) }
  for (const c of o.created.slice(0, 4)) {
    if (!c.name) continue
    const holder = person(c.holder)
    const obj: WorldObject = { id: `made-${randomUUID()}`, name: c.name, kind: (KINDS.has(c.kind) ? c.kind : 'item') as WorldObject['kind'], quantity: 1, condition: 'intact',
      form: c.description || undefined, location: holder && holder.publicState.status !== 'deceased' ? { kind: 'agent', id: holder.id } : { kind: 'place', id: ctx.place.id } }
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
      const obj: WorldObject = { id: `found-${randomUUID()}`, name: t.item, kind: 'item', quantity: 1, condition: 'intact',
        location: receiver && receiver.publicState.status !== 'deceased' ? { kind: 'agent', id: receiver.id } : { kind: 'place', id: ctx.place.id } }
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
  const synopsis = result.prose.replace(/\s+/g, ' ').slice(0, 180)
  const event: WorldEvent = { id: randomUUID(), type, occurredAt: nowIso, day: world.clock.day, worldTime: world.clock.time, worldMinute: minute,
    phase: 'COMPLETED', cause: 'v4_scene', outcome: 'CONFIRMED', placeId: ctx.place.id, agentIds, title, summary: synopsis,
    stateChanges: changes, importance, relatedEventIds: [] }
  const startMinute = Math.max(Math.min(...ctx.cast.map(c => c.sinceMinute)), minute - result.durationMinutes)
  const scene: ChronicleEntry = { id: `scene-v4-${event.id}`, kind: 'LIVE', seasonId, worldDay: world.clock.day,
    timeStart: clockLabel(startMinute).slice(-5), timeEnd: world.clock.time, title, body: result.prose,
    locationIds: [...new Set([ctx.place.id, ...o.moves.flatMap(m => ctx.neighbors.filter(n => n.handle === m.to).map(n => n.place.id))])],
    agentIds, sourceEventIds: [event.id], stateChanges: changes, importance: o.deaths.length ? 'major' : o.injuries.length ? 'notable' : 'ordinary', createdAt: nowIso }
  return { event, scene }
}
