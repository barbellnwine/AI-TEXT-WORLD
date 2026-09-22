// WORLD CONSTITUTION §§2–51. Deterministic engine: no network and no narrative-derived effects.
import { randomUUID } from 'node:crypto'
import type { Agent, StateChange, WorldEvent, WorldState } from '../domain/worldTypes.ts'
import type { DraftDTO } from '../domain/worldDrafts.ts'
import { DEFAULT_EMOTION, DEFAULT_HUMAN_STATE } from '../domain/worldDrafts.ts'
import type { ProposedAction, ActionValidationResult } from './actionSchema.ts'
import { reject } from './actionSchema.ts'
import { validateAction } from './worldValidator.ts'
import { applyStateChanges } from './stateTransition.ts'
import type { OngoingAction, WorldObject } from './engineTypes.ts'

const clamp = (n: number) => Math.max(1, Math.min(10, Math.round(n)))
export function clockMinute(world: WorldState): number {
  const [hour, minute] = world.clock.time.split(':').map(Number)
  return (world.clock.day - 1) * 1440 + hour * 60 + minute
}
function setClock(world: WorldState, minute: number): void {
  const withinDay = minute % 1440, hour = Math.floor(withinDay / 60)
  world.clock.day = Math.floor(minute / 1440) + 1
  world.clock.time = `${String(hour).padStart(2, '0')}:${String(withinDay % 60).padStart(2, '0')}`
  world.clock.timeOfDay = hour < 5 ? 'lateNight' : hour < 7 ? 'dawn' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 20 ? 'evening' : 'night'
  if (world.engine) world.engine.minute = minute
}

export function initializeEngine(world: WorldState, draft: DraftDTO): void {
  if (world.engine) return
  const minute = clockMinute(world)
  const objects = new Map<string, WorldObject>()
  for (const place of draft.places) {
    const runtimePlace = world.places.find(p => p.id === place.id)
    if (runtimePlace) Object.assign(runtimePlace, { x: place.x, y: place.y, isPublic: place.isPublic, isDiscovered: place.isDiscovered, capacity: place.capacity, facilityStatus: place.facilityStatus })
    for (const id of place.items) objects.set(id, { id, name: id, kind: 'item', quantity: 1, condition: 'intact', location: { kind: 'place', id: place.id } })
  }
  // Global starting supplies have an explicit physical location: the first starting place.
  const depot = world.places[0]
  for (const resource of draft.initialResources) if (depot && !depot.resources.some(r => r.key === resource.key)) depot.resources.push({ ...resource, trend: 'stable' })
  for (const [index, actor] of world.agents.entries()) {
    const design = draft.characters.find(c => c.id === actor.id)
    actor.humanState = { ...(design?.humanState ?? DEFAULT_HUMAN_STATE) }
    actor.emotion = { ...(design?.emotion ?? DEFAULT_EMOTION) }
    actor.body = { health: 1, injury: actor.publicState.status === 'injured' ? 4 : 1 }
    actor.nextDecisionAt = minute + index * 2
    actor.memories = []
    actor.knownPlaceIds = [...new Set([actor.publicState.locationId, ...world.places.filter(p => p.isPublic !== false && p.isDiscovered !== false).map(p => p.id)])]
    actor.knowledge = actor.knowledge.map(k => ({ ...k, acquisition: 'initial', verified: true }))
    actor.relationships = actor.relationships.map(r => {
      const designRel = draft.relationships.find(d => d.fromCharacterId === actor.id && d.toCharacterId === r.otherAgentId)
      return { ...r, trust: designRel?.trust ?? 5, affection: designRel?.affection ?? 5, attraction: designRel?.attraction ?? 1 }
    })
    for (const id of actor.inventory) objects.set(id, { id, name: id, kind: 'item', quantity: 1, condition: 'intact', location: { kind: 'agent', id: actor.id } })
  }
  world.engine = {
    version: 1, minute, lastVitalsMinute: minute,
    connections: draft.connections.map(c => ({ fromPlaceId: c.fromPlaceId, toPlaceId: c.toPlaceId, travelMinutes: Math.max(1, Math.ceil(c.travelTime)), blocked: c.blocked, requirements: c.requirements })),
    objects: [...objects.values()], ongoingActions: [],
    truths: [...(draft.hiddenWorldTruth.trim() ? [{ id: randomUUID(), summary: draft.hiddenWorldTruth, placeId: null, discoveredBy: [] }] : []),
      ...(draft.discoverableTruths ?? []).map(t => ({ ...t, discoveredBy: [] }))],
    environment: { powerStatus: draft.powerStatus, facilityStatus: draft.facilityStatus },
  }
}

export function nextDecisionDelay(actor: Agent, type: ProposedAction['actionType']): number {
  const variance = [...actor.id].reduce((n, char) => n + char.charCodeAt(0), 0) % 6
  if (type === 'SPEAK' || type === 'SHARE_INFO') return 1 + variance % 3
  if (type === 'REST' || type === 'WAIT' || type === 'OBSERVE') return 20 + variance * 5
  if (type === 'SLEEP') return 30 + variance * 5
  if (type === 'EXPLORE' || type === 'INTERACT') return 10 + variance * 3
  return 5 + variance * 2
}

export function selectDecisionAgents(world: WorldState, limit: number): Agent[] {
  const engine = world.engine
  if (!engine) return []
  const busy = new Set(engine.ongoingActions.map(a => a.proposal.actorId))
  return world.agents.filter(a => ['alive', 'injured'].includes(a.publicState.status) && !busy.has(a.id) && (a.nextDecisionAt ?? 0) <= engine.minute)
    .sort((a, b) => {
      const score = (c: Agent) => (c.wakeReason ? 100 : 0) + Math.max(c.humanState?.survival_need ?? 1, c.humanState?.fatigue ?? 1) * 2 + Math.min(50, engine.minute - (c.nextDecisionAt ?? 0))
      return score(b) - score(a) || (a.nextDecisionAt ?? 0) - (b.nextDecisionAt ?? 0) || a.id.localeCompare(b.id)
    }).slice(0, Math.max(1, limit))
}

export function validateEngineAction(action: ProposedAction, world: WorldState, events: WorldEvent[], recent: ProposedAction[] = [], completing = false): ActionValidationResult {
  const base = validateAction(action, { worldState: world, allEventIds: new Set(events.map(e => e.id)), recentActionsByActor: completing ? [] : recent }, events)
  if (!base.approved || !world.engine) return base
  const actor = world.agents.find(a => a.id === action.actorId)!
  const engine = world.engine
  const fail = (message: string) => reject(['RULE_VIOLATION'], [message])
  if (!completing && engine.ongoingActions.some(a => a.proposal.actorId === actor.id)) return fail('already_performing_action')
  if (!['alive', 'injured'].includes(actor.publicState.status)) return fail('actor_not_actionable')
  if (action.targetIds.some(id => engine.ongoingActions.some(a => a.proposal.actorId === id && a.proposal.actionType === 'MOVE'))) return fail('target_in_transit')
  if (['ATTACK', 'USE_ITEM'].includes(action.actionType)) return fail('undefined_effect_rejected')
  if (action.actionType === 'GIVE_ITEM') {
    const object = engine.objects.find(o => o.id === action.usedItemIds?.[0])
    if (!object || object.quantity < 1 || object.condition === 'destroyed' || object.location.kind !== 'agent' || object.location.id !== actor.id) return fail('object_not_owned')
  }
  if (action.actionType === 'MOVE') {
    const edge = engine.connections.find(c => (c.fromPlaceId === action.locationId && c.toPlaceId === action.destinationId) || (c.toPlaceId === action.locationId && c.fromPlaceId === action.destinationId))
    if (!edge || edge.blocked) return fail('no_open_path')
    if (!actor.knownPlaceIds?.includes(action.destinationId!)) return fail('destination_unknown')
    const destination = world.places.find(p => p.id === action.destinationId)!
    const reserved = engine.ongoingActions.filter(a => a.proposal.actionType === 'MOVE' && a.proposal.destinationId === destination.id && a.proposal.actorId !== actor.id).length
    if (destination.capacity != null && destination.currentAgentIds.length + reserved >= destination.capacity) return fail('destination_capacity_exceeded')
    if ((actor.body?.injury ?? 1) >= 8 || (actor.humanState?.fatigue ?? 1) >= 10) return fail('body_cannot_move')
    // Free-form requirements cannot be satisfied merely by an Agent claiming success.
    if (edge.requirements.trim()) return fail('path_requires_operator_clearance')
  }
  if (['EXPLORE', 'INTERACT', 'COOPERATE', 'TAKE_ITEM'].includes(action.actionType) && ((actor.body?.injury ?? 1) >= 8 || (actor.humanState?.fatigue ?? 1) >= 10)) return fail('body_cannot_work')
  if (action.actionType === 'TAKE_ITEM') {
    if (action.usedItemIds?.length !== 1) return fail('take_requires_one_existing_object')
    const object = engine.objects.find(o => o.id === action.usedItemIds![0])
    if (!object || object.quantity < 1 || object.condition === 'destroyed' || object.location.kind !== 'place' || object.location.id !== action.locationId) return fail('object_not_available_here')
    if (engine.ongoingActions.some(a => a.proposal.actorId !== actor.id && a.proposal.usedItemIds?.includes(object.id))) return fail('object_reserved')
  }
  if (action.actionType === 'EAT' || action.actionType === 'DRINK') {
    const accepted = action.actionType === 'EAT' ? ['food', '식량', '음식'] : ['water', '물', '식수']
    if (!action.resourceKey || !accepted.includes(action.resourceKey.toLowerCase())) return fail('food_or_water_resource_required')
    const resource = world.places.find(p => p.id === action.locationId)?.resources.find(r => r.key === action.resourceKey)
    const reserved = engine.ongoingActions.filter(a => a.proposal.actorId !== actor.id && a.proposal.locationId === action.locationId && a.proposal.resourceKey === action.resourceKey).length
    if (!resource || resource.level - reserved < 1) return fail('resource_unavailable')
  }
  if (action.actionType === 'SHARE_INFO') {
    if (action.targetIds.length !== 1 || !world.agents.some(a => a.id === action.targetIds[0])) return fail('share_requires_one_present_character')
    if (!action.factId || !actor.knowledge.some(k => k.id === action.factId)) return fail('cannot_share_unknown_information')
  }
  if (action.actionType === 'SPEAK' && action.targetIds.some(id => !world.agents.some(a => a.id === id))) return fail('speech_target_must_be_character')
  return base
}

function duration(action: ProposedAction, world: WorldState): number {
  if (action.actionType === 'MOVE') {
    const edge = world.engine!.connections.find(c => (c.fromPlaceId === action.locationId && c.toPlaceId === action.destinationId) || (c.toPlaceId === action.locationId && c.fromPlaceId === action.destinationId))!
    const actor = world.agents.find(a => a.id === action.actorId)!
    return Math.ceil(edge.travelMinutes * ((actor.body?.injury ?? 1) >= 5 ? 2 : 1))
  }
  const bounds: Partial<Record<ProposedAction['actionType'], [number, number]>> = {
    SPEAK: [1, 3], SHARE_INFO: [1, 3], GIVE_ITEM: [1, 3], TAKE_ITEM: [2, 5], EAT: [5, 15], DRINK: [2, 5],
    EXPLORE: [10, 30], INTERACT: [10, 30], COOPERATE: [10, 30], REST: [20, 60], OBSERVE: [20, 60], WAIT: [20, 60], SLEEP: [120, 480],
  }
  const [min, max] = bounds[action.actionType] ?? [5, 15]
  return Math.max(min, Math.min(max, Math.round(action.durationMinutes ?? min)))
}

function event(world: WorldState, action: ProposedAction | null, phase: WorldEvent['phase'], summary: string, changes: StateChange[] = [], type: WorldEvent['type'] = 'DECISION'): WorldEvent {
  const placeId = action?.locationId ?? world.places[0]?.id ?? ''
  return { id: randomUUID(), type, occurredAt: new Date().toISOString(), day: world.clock.day, worldTime: world.clock.time, worldMinute: world.engine!.minute,
    placeId, agentIds: action ? [action.actorId, ...action.targetIds] : [], summary, title: summary, stateChanges: changes,
    phase, actionType: action?.actionType, attemptedAction: action?.intendedAction, engineVerdict: phase,
    importance: 'normal', relatedEventIds: [], outcome: 'CONFIRMED', cause: action ? `action:${action.actionType}` : 'elapsed_world_time',
    witnessIds: world.agents.filter(a => a.publicState.locationId === placeId && a.publicState.status !== 'deceased' && !world.engine!.ongoingActions.some(task => task.proposal.actorId === a.id && task.proposal.actionType === 'MOVE')).map(a => a.id) }
}
const labels: Record<ProposedAction['actionType'], string> = { MOVE: '이동', SPEAK: '대화', GIVE_ITEM: '물건 전달', TAKE_ITEM: '물건 가져오기', EAT: '식사', DRINK: '수분 섭취', REST: '휴식', SLEEP: '수면', EXPLORE: '탐색', SHARE_INFO: '정보 전달', OBSERVE: '관찰', WAIT: '대기', INTERACT: '작업 시도', COOPERATE: '협력 시도', ATTACK: '공격 시도', USE_ITEM: '물건 사용 시도' }

export function beginAction(world: WorldState, action: ProposedAction): WorldEvent {
  const actor = world.agents.find(a => a.id === action.actorId)!
  const ongoing: OngoingAction = { id: randomUUID(), proposal: structuredClone(action), startedMinute: world.engine!.minute, completesMinute: world.engine!.minute + duration(action, world), startEventId: '' }
  const start = event(world, action, 'STARTED', `${actor.name}이(가) ${labels[action.actionType]}을(를) 시작했다.`)
  start.actionId = ongoing.id
  ongoing.startEventId = start.id
  world.engine!.ongoingActions.push(ongoing)
  actor.nextDecisionAt = ongoing.completesMinute
  actor.wakeReason = undefined
  actor.publicState.lastAction = start.summary
  return start
}

function relationshipEffect(world: WorldState, receiver: Agent, giverId: string, changes: StateChange[]) {
  let rel = receiver.relationships.find(r => r.otherAgentId === giverId)
  if (!rel) { rel = { agentId: receiver.id, otherAgentId: giverId, stance: 'neutral', trust: 5, affection: 5, attraction: 1 }; receiver.relationships.push(rel) }
  const from = rel.trust ?? 5
  rel.trust = clamp(from + 1)
  changes.push({ field: `relationship:${receiver.id}:${giverId}:trust`, from: String(from), to: String(rel.trust) })
  void world
}

function completeAction(world: WorldState, ongoing: OngoingAction, events: WorldEvent[]): WorldEvent {
  const action = ongoing.proposal, actor = world.agents.find(a => a.id === action.actorId)!
  const check = validateEngineAction(action, world, events, [], true)
  const changes: StateChange[] = []
  actor.nextDecisionAt = world.engine!.minute + nextDecisionDelay(actor, action.actionType)
  let summary = `${actor.name}이(가) ${labels[action.actionType]}을(를) 마쳤다.`
  let type: WorldEvent['type'] = 'OBSERVATION'
  if (!check.approved) {
    const failed = event(world, action, 'FAILED', `${actor.name}의 ${labels[action.actionType]}이(가) 조건 변화로 중단되었다.`)
    failed.engineVerdict = check.notes.join(', ')
    failed.actionId = ongoing.id; failed.relatedEventIds = [ongoing.startEventId]
    actor.nextDecisionAt = world.engine!.minute
    return failed
  }
  if (action.actionType === 'MOVE') {
    changes.push({ field: `agent:${actor.id}:location`, from: actor.publicState.locationId, to: action.destinationId! })
    type = 'MOVE'; summary = `${actor.name}이(가) ${world.places.find(p => p.id === action.destinationId)!.name}에 도착했다.`
  } else if (action.actionType === 'GIVE_ITEM' || action.actionType === 'TAKE_ITEM') {
    const object = world.engine!.objects.find(o => o.id === action.usedItemIds![0])
    if (object) {
      const source = object.location.kind === 'agent' ? object.location.id : `place:${object.location.id}`
      const receiver = action.actionType === 'GIVE_ITEM' ? world.agents.find(a => a.id === action.targetIds[0])! : actor
      if (object.location.kind === 'agent') {
        const holder = world.agents.find(a => a.id === object.location.id)!
        holder.inventory = holder.inventory.filter(id => id !== object.id)
      }
      object.location = { kind: 'agent', id: receiver.id }
      if (!receiver.inventory.includes(object.id)) receiver.inventory.push(object.id)
      changes.push({ field: `object:${object.id}:holder`, from: source, to: receiver.id })
      if (receiver.id !== actor.id) relationshipEffect(world, receiver, actor.id, changes)
      summary = `${actor.name}이(가) ${object.name}을(를) ${receiver.id === actor.id ? '가져왔다' : `${receiver.name}에게 건넸다`}.`
      type = 'COOPERATION'
    }
  } else if (action.actionType === 'EAT' || action.actionType === 'DRINK') {
    const resource = world.places.find(p => p.id === action.locationId)!.resources.find(r => r.key === action.resourceKey)!
    changes.push({ field: `place:${action.locationId}:${resource.key}`, from: String(resource.level), to: String(resource.level - 1) })
    const from = actor.humanState!.survival_need
    actor.humanState!.survival_need = clamp(from - 2)
    changes.push({ field: `agent:${actor.id}:survival_need`, from: String(from), to: String(actor.humanState!.survival_need) })
    summary = `${actor.name}이(가) ${resource.label} 1${resource.unit ?? '단위'}를 소비했다.`; type = 'RESOURCE_CHANGE'
  } else if (action.actionType === 'REST' || action.actionType === 'SLEEP') {
    const from = actor.humanState!.fatigue
    actor.humanState!.fatigue = clamp(from - Math.max(1, Math.floor((ongoing.completesMinute - ongoing.startedMinute) / (action.actionType === 'SLEEP' ? 60 : 30))))
    changes.push({ field: `agent:${actor.id}:fatigue`, from: String(from), to: String(actor.humanState!.fatigue) })
  } else if (action.actionType === 'SPEAK') {
    summary = `${actor.name}이(가) 말을 건넸다.`; type = 'DIALOGUE'
  } else if (action.actionType === 'EXPLORE') {
    type = 'DISCOVERY'
    const truths = world.engine!.truths.filter(t => t.placeId === action.locationId && !t.discoveredBy.includes(actor.id))
    for (const truth of truths) {
      truth.discoveredBy.push(actor.id)
      actor.knowledge.push({ id: randomUUID(), summary: truth.summary, truthId: truth.id, learnedAt: new Date().toISOString(), acquisition: 'discovery', verified: true, placeId: action.locationId })
      if (truth.revealedPlaceId && !actor.knownPlaceIds!.includes(truth.revealedPlaceId)) actor.knownPlaceIds!.push(truth.revealedPlaceId)
      changes.push({ field: `knowledge:${actor.id}:${truth.id}`, from: 'unknown', to: 'discovered' })
    }
    const adjacent = world.engine!.connections.filter(c => c.fromPlaceId === action.locationId || c.toPlaceId === action.locationId).map(c => c.fromPlaceId === action.locationId ? c.toPlaceId : c.fromPlaceId)
    const newPlaces = adjacent.filter(id => !actor.knownPlaceIds!.includes(id))
    for (const id of newPlaces) {
      actor.knownPlaceIds!.push(id)
      changes.push({ field: `knowledge:${actor.id}:place:${id}`, from: 'unknown', to: 'discovered' })
    }
    for (const id of [...newPlaces, ...truths.flatMap(t => t.revealedPlaceId ? [t.revealedPlaceId] : [])]) {
      const discovered = world.places.find(p => p.id === id)
      if (discovered) discovered.isDiscovered = true
    }
    summary = truths.length || newPlaces.length ? `${actor.name}이(가) 탐색을 통해 새로운 정보를 확인했다.` : `${actor.name}이(가) 탐색을 마쳤지만 새로운 발견은 없었다.`
  } else if (action.actionType === 'SHARE_INFO') {
    const fact = actor.knowledge.find(k => k.id === action.factId)!, recipient = world.agents.find(a => a.id === action.targetIds[0])!
    recipient.knowledge.push({ ...fact, id: randomUUID(), sourceEventId: undefined, learnedAt: new Date().toISOString(), acquisition: 'report', sourceAgentId: actor.id, verified: false })
    if (fact.placeId && actor.knownPlaceIds?.includes(fact.placeId) && !recipient.knownPlaceIds?.includes(fact.placeId)) recipient.knownPlaceIds!.push(fact.placeId)
    changes.push({ field: `knowledge:${recipient.id}`, from: 'not_received', to: 'report_received' })
    summary = `${actor.name}이(가) ${recipient.name}에게 알고 있는 정보를 전달했다.`; type = 'DIALOGUE'
  }
  // Only the effects derived above may change state; no model-supplied StateChange is accepted.
  applyStateChanges(world, changes.filter(c => c.field.startsWith('place:') || c.field.endsWith(':location')))
  const result = event(world, action, 'COMPLETED', summary, changes, type)
  if (action.actionType === 'MOVE') {
    result.placeId = action.destinationId!
    result.witnessIds = world.agents.filter(a => a.publicState.locationId === result.placeId && a.publicState.status !== 'deceased' && !world.engine!.ongoingActions.some(task => task.proposal.actorId === a.id && task.proposal.actionType === 'MOVE')).map(a => a.id)
  }
  result.actionId = ongoing.id; result.relatedEventIds = [ongoing.startEventId]
  if (action.actionType === 'SPEAK') result.publicQuote = action.spokenText
  for (const knowledge of actor.knowledge.filter(k => k.acquisition === 'discovery' && !k.sourceEventId)) knowledge.sourceEventId = result.id
  if (action.actionType === 'SHARE_INFO') {
    const recipient = world.agents.find(a => a.id === action.targetIds[0])!
    recipient.knowledge.at(-1)!.sourceEventId = result.id
    const fact = actor.knowledge.find(k => k.id === action.factId)!
    const revealed = world.engine!.truths.find(t => t.id === fact.truthId)?.revealedPlaceId
    if (revealed && actor.knownPlaceIds?.includes(revealed) && !recipient.knownPlaceIds!.includes(revealed)) recipient.knownPlaceIds!.push(revealed)
  }
  actor.publicState.lastAction = summary; actor.publicState.lastActiveAt = result.occurredAt
  return result
}

function vitals(world: WorldState): WorldEvent[] {
  const results: WorldEvent[] = [], engine = world.engine!
  for (const actor of world.agents.filter(a => a.publicState.status !== 'deceased')) {
    const hs = actor.humanState!, emotion = actor.emotion!, body = actor.body!, changes: StateChange[] = []
    const resting = engine.ongoingActions.some(a => a.proposal.actorId === actor.id && ['REST', 'SLEEP'].includes(a.proposal.actionType))
    const update = (field: string, from: number, to: number) => { if (from !== to) changes.push({ field: `agent:${actor.id}:${field}`, from: String(from), to: String(to) }) }
    const need = hs.survival_need; hs.survival_need = clamp(need + 1); update('survival_need', need, hs.survival_need)
    const fatigue = hs.fatigue; hs.fatigue = clamp(fatigue + (resting ? 0 : 1)); update('fatigue', fatigue, hs.fatigue)
    if (hs.survival_need >= 9) { const from = hs.stress; hs.stress = clamp(from + 1); update('stress', from, hs.stress) }
    else if (resting && world.dangerLevel === 'stable') { const from = hs.stress; hs.stress = clamp(from - 1); update('stress', from, hs.stress) }
    if (world.dangerLevel === 'critical') { const from = emotion.fear; emotion.fear = clamp(from + 1); update('fear', from, emotion.fear) }
    if (hs.survival_need === 10) { const from = body.health; body.health = clamp(from + 1); update('health', from, body.health) }
    if (body.health === 10) {
      changes.push({ field: `agent:${actor.id}:status`, from: actor.publicState.status, to: 'deceased' })
      actor.publicState.status = 'deceased'; actor.nextDecisionAt = Number.MAX_SAFE_INTEGER
      for (const ongoing of engine.ongoingActions.filter(a => a.proposal.actorId === actor.id)) {
        const cancelled = event(world, ongoing.proposal, 'CANCELLED', `${actor.name}의 행동이 사망으로 중단되었다.`)
        cancelled.actionId = ongoing.id; cancelled.relatedEventIds = [ongoing.startEventId]; cancelled.cause = 'actor_deceased'
        results.push(cancelled)
      }
      engine.ongoingActions = engine.ongoingActions.filter(a => a.proposal.actorId !== actor.id)
    }
    if (changes.length) {
      const e = event(world, null, 'STATE_UPDATE', actor.publicState.status === 'deceased' ? `${actor.name}이(가) 지속된 생존 자원 부족으로 사망했다.` : `${actor.name}의 상태가 시간 경과와 활동·휴식에 따라 변했다.`, changes, actor.publicState.status === 'deceased' ? 'INJURY' : 'SYSTEM')
      e.placeId = actor.publicState.locationId; e.agentIds = [actor.id]; e.cause = 'elapsed_60_world_minutes'
      e.witnessIds = world.agents.filter(a => a.publicState.locationId === e.placeId).map(a => a.id)
      e.visibility = actor.publicState.status === 'deceased' ? 'public' : 'private'
      e.importance = actor.publicState.status === 'deceased' ? 'critical' : 'low'
      results.push(e)
    }
  }
  return results
}

export function advanceEngine(world: WorldState, minutes: number, priorEvents: WorldEvent[] = [], onEvent?: (e: WorldEvent) => void): WorldEvent[] {
  const engine = world.engine
  if (!engine || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return []
  const end = engine.minute + minutes, events: WorldEvent[] = []
  const emit = (e: WorldEvent) => { events.push(e); onEvent?.(e) }
  while (engine.minute < end) {
    const nextCompletion = Math.min(...engine.ongoingActions.map(a => a.completesMinute), Infinity)
    const next = Math.min(end, Math.max(engine.minute, nextCompletion), engine.lastVitalsMinute + 60)
    setClock(world, next)
    for (const ongoing of [...engine.ongoingActions].filter(a => a.completesMinute <= next)) {
      if (!engine.ongoingActions.some(a => a.id === ongoing.id)) continue
      engine.ongoingActions = engine.ongoingActions.filter(a => a.id !== ongoing.id)
      emit(completeAction(world, ongoing, [...priorEvents, ...events]))
    }
    if (next >= engine.lastVitalsMinute + 60) { engine.lastVitalsMinute = next; for (const e of vitals(world)) emit(e) }
  }
  world.updatedAt = new Date().toISOString()
  return events
}

export function recordExperience(world: WorldState, e: WorldEvent): WorldEvent[] {
  if (!world.engine || e.outcome === 'REJECTED') return []
  const wakeEvents: WorldEvent[] = []
  const witnesses = new Set(e.witnessIds ?? e.agentIds)
  for (const actor of world.agents) {
    const involved = e.agentIds.includes(actor.id), witnessed = witnesses.has(actor.id)
    if (!involved && !witnessed) continue
    if (e.phase !== 'STARTED' && e.visibility !== 'private' && (e.importance === 'high' || e.importance === 'critical' || e.type === 'DISCOVERY' || e.type === 'DIALOGUE' || e.type === 'COOPERATION' || e.type === 'CONFLICT')) {
      const summary = e.publicQuote ? `${e.summary} 발언: ${e.publicQuote}` : e.summary
      actor.knowledge.push({ id: randomUUID(), summary, sourceEventId: e.id, learnedAt: e.occurredAt, acquisition: e.type === 'DIALOGUE' ? 'report' : involved ? 'experience' : 'witness', verified: e.type !== 'DIALOGUE' })
      actor.memories ??= []
      actor.memories.push({ id: randomUUID(), summary, sourceEventIds: [e.id], importance: e.importance === 'high' || e.importance === 'critical' ? 'high' : 'normal', atMinute: e.worldMinute ?? world.engine.minute })
      actor.memories = actor.memories.sort((a, b) => (a.importance === 'high' ? 1 : 0) - (b.importance === 'high' ? 1 : 0) || a.atMinute - b.atMinute).slice(-30)
      actor.keyEventIds = [...new Set([e.id, ...actor.keyEventIds])].slice(0, 50)
    }
    const directSpeech = e.phase === 'COMPLETED' && e.type === 'DIALOGUE' && e.agentIds.slice(1).includes(actor.id)
    const localDanger = e.importance === 'critical' && witnessed
    if ((!directSpeech && !localDanger && !(e.phase === 'FAILED' && involved)) || actor.publicState.status === 'deceased') continue
    actor.nextDecisionAt = Math.min(actor.nextDecisionAt ?? Infinity, world.engine.minute)
    actor.wakeReason = localDanger ? 'local_danger' : directSpeech ? 'addressed_directly' : 'action_interrupted'
    const ongoing = world.engine.ongoingActions.find(a => a.proposal.actorId === actor.id)
    if (ongoing && (localDanger || ['SLEEP', 'REST', 'WAIT', 'OBSERVE'].includes(ongoing.proposal.actionType))) {
      world.engine.ongoingActions = world.engine.ongoingActions.filter(a => a.id !== ongoing.id)
      const cancelled = event(world, ongoing.proposal, 'CANCELLED', `${actor.name}의 ${labels[ongoing.proposal.actionType]}이(가) 주변 사건으로 중단되었다.`)
      cancelled.relatedEventIds = [ongoing.startEventId, e.id]; cancelled.actionId = ongoing.id; cancelled.cause = `event:${e.id}`
      wakeEvents.push(cancelled)
    }
  }
  return wakeEvents
}
