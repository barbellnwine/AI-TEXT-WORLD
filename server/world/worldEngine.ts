import { ensureMotivations, rememberGoalChoice, rememberGoalResult, observePossessions } from './motivations.ts'
import { ensureAgentV2, rememberIntent, rememberResult, rememberSocialRefusal, updateHumanAfterEvent } from './agentV2State.ts'
import { inContact, interactionRejection, resolveInteraction } from './interactions.ts'
// WORLD CONSTITUTION §§2–51. Deterministic engine: no network and no narrative-derived effects.
import { randomUUID } from 'node:crypto'
import { eventProse, koreanParticles } from '../domain/eventProse.ts'
import { actionContext, actionFailure } from './actionNarrative.ts'
import type { Agent, StateChange, WorldEvent, WorldState } from '../domain/worldTypes.ts'
import type { DraftDTO } from '../domain/worldDrafts.ts'
import { DEFAULT_EMOTION, DEFAULT_HUMAN_STATE } from '../domain/worldDrafts.ts'
import type { ProposedAction, ActionValidationResult } from './actionSchema.ts'
import { validateWorldInteraction, completeWorldInteraction } from './worldInteraction.ts'
import { reject } from './actionSchema.ts'
import { actionIntent, behaviorRejection, rememberAction, finishBehavior } from './behaviorPolicy.ts'
import { meaningfulChanges, conditionSummary } from './stateThresholds.ts'
import { combatOpportunity } from './combatOpportunity.ts'
import {accessibleObject,combatEquipmentError,preparePhysicalAction,resolvePhysicalCombat,captureWitnesses} from './physicalActions.ts'
import {speechContext} from './socialVoice.ts'
import {addInjury,progressTrauma,treatInjuries} from './trauma.ts'
import { validateAction } from './worldValidator.ts'
import { applyStateChanges } from './stateTransition.ts'
import type { OngoingAction, WorldObject } from './engineTypes.ts'
import { initializeStudio, processStudio, studioBoundary, evolveRelationship } from './studioEngine.ts'
import {agentPoint,canHear,canSee,nearSearchPath,objectPoint,searchDestination,truthPoint,validPoint} from './spatialWorld.ts'
import {informationUtility,isWorldInformation} from './informationUtility.ts'

const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n)))
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
    actor.age=design?.age??null
    actor.dispositions = design?.dispositions
    ensureMotivations(actor, minute, design?.goal)
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
    version: 1, minute, lastVitalsMinute: minute, context: { genre: draft.genre, background: draft.background },
    connections: draft.connections.map(c => ({ fromPlaceId: c.fromPlaceId, toPlaceId: c.toPlaceId, travelMinutes: Math.max(1, Math.ceil(c.travelTime)), blocked: c.blocked, requirements: c.requirements })),
    objects: [...objects.values()], ongoingActions: [],
    truths: [...(draft.hiddenWorldTruth.trim() ? [{ id: randomUUID(), summary: draft.hiddenWorldTruth, placeId: null, discoveredBy: [] }] : []),
      ...(draft.discoverableTruths ?? []).map(t => ({ ...t, discoveredBy: [] }))],
    environment: { powerStatus: draft.powerStatus, facilityStatus: draft.facilityStatus },
  }
  initializeStudio(world, draft)
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
  return world.agents.filter(a => {
    const v = ensureAgentV2(a, world)
    v.nextDecisionAt = a.nextDecisionAt ?? v.nextDecisionAt
    if (busy.has(a.id) || ['active', 'ongoing', 'paused'].includes(v.currentAction?.status ?? '') &&
      engine.ongoingActions.some(t => t.id === v.currentAction?.id)) return false
    return ['alive', 'injured'].includes(a.publicState.status) && (a.wakeReason ? true : v.nextDecisionAt <= engine.minute)
  })
    .sort((a, b) => {
      const score = (c: Agent) => {
        const v=ensureAgentV2(c,world)
        const last=v.recentActions.at(-1)?.minute
        const waitingTurn=last===undefined?20:Math.min(20,Math.max(0,(engine.minute-last)/30))
        return (c.wakeReason ? 100 : 0) + waitingTurn + Math.max(c.humanState?.survival_need ?? 1, c.humanState?.fatigue ?? 1) * 2 + Math.min(50, engine.minute - (c.nextDecisionAt ?? 0)) + (world.places.find(p=>p.id===c.publicState.locationId)?.flooded?20:0) + (c.exposure?.coldExposure??0) + c.relationships.filter(r=>r.stance==='hostile'&&world.agents.some(a=>a.id===r.otherAgentId&&a.publicState.locationId===c.publicState.locationId)).length*3
      }
      return score(b) - score(a) || (a.nextDecisionAt ?? 0) - (b.nextDecisionAt ?? 0) || a.id.localeCompare(b.id)
    }).slice(0, Math.max(1, limit))
}

const medicineResource = (key: string) => ['medicine', 'medical', '의약품', '약품', '치료제'].includes(key.toLowerCase())
function treatmentPatient(action: ProposedAction, world: WorldState) {
  return world.agents.find(a => a.id === (action.targetIds[0] ?? action.actorId))
}
function isTreatment(action: ProposedAction, world: WorldState) {
  return action.actionType === 'USE_ITEM' && (Boolean(action.resourceKey && medicineResource(action.resourceKey)) || world.engine?.objects.find(o => o.id === action.usedItemIds?.[0])?.kind === 'medicine')
}

export function validateEngineAction(action: ProposedAction, world: WorldState, events: WorldEvent[], _recent: ProposedAction[] = [], completing = false): ActionValidationResult {
  const base = validateAction(action, { worldState: world, allEventIds: new Set(events.map(e => e.id)) }, events)
  if (!base.approved || !world.engine) return base
  const actor = world.agents.find(a => a.id === action.actorId)!
  const engine = world.engine
  const fail = (message: string) => reject(['RULE_VIOLATION'], [message])
  const worldInteractionError = validateWorldInteraction(world, action)
  if (worldInteractionError) return fail(worldInteractionError)
  if(action.searchPoint && (action.actionType!=='EXPLORE'||!validPoint(action.searchPoint)))return fail('invalid_search_point')
  if(['MOVE','EXPLORE'].includes(action.actionType)&&(actor.trauma?.functions.mobility??0)>=.9)return fail('injury_prevents_movement')
  if(['ATTACK','ROB','STEAL'].includes(action.actionType)&&(actor.trauma?.functions.vision??0)>=.9)return fail('injury_prevents_targeting')
  const equipmentError=combatEquipmentError(world,action)
  if(equipmentError)return fail(equipmentError)
  const interactionError = interactionRejection(world, action)
  if (interactionError) return fail(interactionError)
  if (!completing) { const blocked = behaviorRejection(world, action); if (blocked) return reject(['REPETITION_LIMIT'], [blocked]) }
  if (!completing && engine.ongoingActions.some(a => a.proposal.actorId === actor.id)) return fail('already_performing_action')
  if (!['alive', 'injured'].includes(actor.publicState.status)) return fail('actor_not_actionable')
  if (action.areaHint && action.areaHint !== (actor.publicState.localArea ?? 'CENTER') && !['MOVE', 'EXPLORE'].includes(action.actionType)) return fail('explore_to_area_before_acting')
  if (action.targetIds.some(id => engine.ongoingActions.some(a => a.proposal.actorId === id && a.proposal.actionType === 'MOVE'))) return fail('target_in_transit')
  if (['STEAL','ROB'].includes(action.actionType)) {
    const id = action.usedItemIds?.[0], target = action.targetIds[0]
    if (action.targetIds.length !== 1 || action.usedItemIds?.length !== 1 || target === actor.id || !engine.objects.some(o => o.id === id && o.location.kind === 'agent' && o.location.id === target && o.quantity > 0 && o.condition !== 'destroyed')) return fail('steal_requires_existing_owned_item')
    if (!actor.observedPossessions?.some(o => o.id === id && o.ownerId === target) && !engine.interactions?.some(i => i.actorId === target && i.targetId === actor.id && i.offerItemId === id)) return fail('requested_item_not_observed')
    if ((actor.body?.injury ?? 0) >= 8) return fail('body_cannot_work')
  }
  if (action.actionType === 'HIDE') {
    if (action.targetIds.length || action.usedItemIds?.length !== 1 || !engine.objects.some(o => o.id === action.usedItemIds?.[0] && o.location.kind === 'agent' && o.location.id === actor.id && o.quantity > 0 && !o.concealedBy)) return fail('object_not_owned_or_already_hidden')
  }
  if (['ATTACK','ROB'].includes(action.actionType)) {
    const target = world.agents.find(a => a.id === action.targetIds[0])
    if (action.targetIds.length !== 1 || !target || target.id === actor.id || !['alive', 'injured'].includes(target.publicState.status)) return fail('attack_requires_one_living_opponent')
    if ((actor.publicState.localArea ?? 'CENTER') !== (target.publicState.localArea ?? 'CENTER')) return fail('opponent_in_another_area')
    if (action.areaHint && action.areaHint !== (actor.publicState.localArea ?? 'CENTER')) return fail('approach_before_attack')
    if ((actor.body?.injury ?? 0) >= 8) return fail('body_cannot_fight')
    if (engine.ongoingActions.some(a => a.proposal.actorId === target.id && a.proposal.actionType === 'EXPLORE' && a.proposal.areaHint && a.proposal.areaHint !== (target.publicState.localArea ?? 'CENTER'))) return fail('target_in_transit')
  }
  if (action.actionType === 'USE_ITEM' || action.actionType === 'DROP_ITEM') {
    const stockMedicine = action.actionType === 'USE_ITEM' && Boolean(action.resourceKey && medicineResource(action.resourceKey))
    if (action.actionType === 'USE_ITEM' && action.resourceKey && !stockMedicine) return fail('resource_has_no_defined_use_effect')
    if (stockMedicine) {
      if (action.usedItemIds?.length) return fail('choose_one_medicine_source')
      const stock = world.places.find(p => p.id === action.locationId)?.resources.find(r => r.key === action.resourceKey)
      const reserved = engine.ongoingActions.filter(a => a.proposal.actorId !== actor.id && a.proposal.locationId === action.locationId && a.proposal.resourceKey === action.resourceKey).length
      if (!stock || stock.level - reserved < 1) return fail('medicine_unavailable')
    } else {
    const object = engine.objects.find(o => o.id === action.usedItemIds?.[0])
    if (action.usedItemIds?.length !== 1 || !object || object.quantity < 1 || object.condition === 'destroyed' || object.location.kind !== 'agent' || object.location.id !== actor.id) return fail('object_not_owned')
    if (action.actionType === 'USE_ITEM' && !['food','water','medicine','fuel','tool'].includes(object.kind)) return fail('item_has_no_defined_effect')
    }
    if (isTreatment(action, world)) {
      const patient = treatmentPatient(action, world)
      if (action.targetIds.length > 1 || !patient || !['alive','injured'].includes(patient.publicState.status)) return fail('treatment_requires_living_patient')
      if(patient.trauma?.injuries.some(w=>!w.healed)&&patient.trauma.injuries.filter(w=>!w.healed).every(w=>w.treatedAt!==null))return fail('wounds_already_treated')
      if ((patient.publicState.localArea ?? 'CENTER') !== (actor.publicState.localArea ?? 'CENTER')) return fail('patient_in_another_area')
      if (engine.ongoingActions.some(a => a.proposal.actorId === patient.id && a.proposal.actionType === 'EXPLORE' && a.proposal.areaHint && a.proposal.areaHint !== (patient.publicState.localArea ?? 'CENTER'))) return fail('patient_in_transit')
      const injury = patient.body?.injury ?? 0
      // Legacy healthy worlds started at injury=1; that baseline alone is not an indication.
      if (injury <= 0 || injury <= 1 && patient.publicState.status !== 'injured') return fail('no_treatable_injury')
      if (!action.intendedAction.trim()) return fail('treatment_purpose_required')
    }
  }
  if (action.actionType === 'GIVE_ITEM') {
    const object = engine.objects.find(o => o.id === action.usedItemIds?.[0])
    if (!object || object.quantity < 1 || object.condition === 'destroyed' || object.location.kind !== 'agent' || object.location.id !== actor.id) return fail('object_not_owned')
  }
  if (action.actionType === 'MOVE') {
    const edge = engine.connections.find(c => (c.fromPlaceId === action.locationId && c.toPlaceId === action.destinationId) || (c.toPlaceId === action.locationId && c.fromPlaceId === action.destinationId))
    if (!edge || edge.blocked) return fail('no_open_path')
    if (!actor.knownPlaceIds?.includes(action.destinationId!)) return fail('destination_unknown')
    const destination = world.places.find(p => p.id === action.destinationId)!
    if (destination.accessible === false || destination.flooded) return fail('destination_blocked_by_environment')
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
    if (!object || !accessibleObject(world,actor,object) || object.physical?.portable===false || object.location.kind !== 'place') return fail('object_not_available_here')
    if (engine.ongoingActions.some(a => a.proposal.actorId !== actor.id && a.proposal.usedItemIds?.includes(object.id))) return fail('object_reserved')
  }
  if (action.actionType === 'EAT' || action.actionType === 'DRINK') {
    const accepted = action.actionType === 'EAT' ? ['food', '식량', '음식'] : ['water', '물', '식수']
    if (!action.resourceKey || !accepted.includes(action.resourceKey.toLowerCase())) return fail('food_or_water_resource_required')
    const resource = world.places.find(p => p.id === action.locationId)?.resources.find(r => r.key === action.resourceKey)
    const reserved = engine.ongoingActions.filter(a => a.proposal.actorId !== actor.id && a.proposal.locationId === action.locationId && a.proposal.resourceKey === action.resourceKey).length
    if (!resource || resource.level - reserved < 1) return fail('resource_unavailable')
  }
  if (action.actionType === 'INTERACT' && action.resourceKey) {
    return fail(medicineResource(action.resourceKey) ? 'medicine_requires_treatment_action' : 'generic_resource_consumption_has_no_defined_effect')
  }
  if (action.actionType === 'INTERACT' && !action.interaction) return fail('interaction_has_no_defined_effect')
  if (action.actionType === 'SHARE_INFO') {
    if (action.targetIds.length !== 1 || !world.agents.some(a => a.id === action.targetIds[0])) return fail('share_requires_one_present_character')
    if (!action.factId || !actor.knowledge.some(k => k.id === action.factId)) return fail('cannot_share_unknown_information')
    const fact=actor.knowledge.find(k=>k.id===action.factId)!
    if(!isWorldInformation(actor,fact))return fail('self_state_is_not_world_information')
    if(informationUtility(world,actor,action.targetIds[0],fact)<=0)return fail('information_has_no_new_utility')
  }
  if(action.actionType==='SPEAK'&&action.intent==='SELF_STATE_DISCLOSURE'&&Math.max(actor.vitals?.hunger??0,actor.vitals?.thirst??0,actor.humanState?.fatigue??0,actor.body?.injury??0)<7)return fail('self_state_disclosure_not_supported')
  if (actor.wakeReason === 'visible_attack_attempt' && ['EAT','DRINK','REST','SLEEP'].includes(action.actionType) && engine.ongoingActions.some(t => ['ATTACK','ROB'].includes(t.proposal.actionType) && t.proposal.targetIds.includes(actor.id) && inContact(world,actor.id,t.proposal.actorId))) return fail('respond_to_visible_threat_first')
  if (action.actionType === 'COOPERATE' && engine.studio && (action.targetIds.length !== 1 || !world.agents.some(a=>a.id===action.targetIds[0]&&a.id!==actor.id&&a.publicState.locationId===actor.publicState.locationId&&a.publicState.status!=='deceased'))) return fail('cooperation_requires_present_partner')
  if (action.actionType === 'SPEAK' && action.targetIds.some(id => !world.agents.some(a => a.id === id))) return fail('speech_target_must_be_character')
  return base
}

function duration(action: ProposedAction, world: WorldState): number {
  if (['ATTACK','ROB'].includes(action.actionType) && (world.agents.find(a => a.id === action.actorId)?.humanState?.fatigue ?? 0) >= 9) return 10
  if (action.actionType === 'MOVE') {
    const edge = world.engine!.connections.find(c => (c.fromPlaceId === action.locationId && c.toPlaceId === action.destinationId) || (c.toPlaceId === action.locationId && c.fromPlaceId === action.destinationId))!
    const actor = world.agents.find(a => a.id === action.actorId)!
    const exposed = world.places.find(p => p.id === action.locationId)?.outdoor || world.places.find(p => p.id === action.destinationId)?.outdoor
    return Math.ceil(edge.travelMinutes * ((actor.body?.injury ?? 1) >= 5 ? 2 : 1) * (exposed && (world.engine?.weather?.rainfall ?? 0) > 0 ? 1.5 : 1)/(1-(actor.trauma?.functions.mobility??0)))
  }
  const bounds: Partial<Record<ProposedAction['actionType'], [number, number]>> = {
    SPEAK: [1, 3], SHARE_INFO: [1, 3], GIVE_ITEM: [1, 3], TAKE_ITEM: [2, 5], EAT: [5, 15], DRINK: [2, 5],
    EXPLORE: [10, 30], INTERACT: [10, 30], COOPERATE: [10, 30], REST: [20, 60], OBSERVE: [20, 60], WAIT: [20, 60], SLEEP: [120, 480],
  }
  const [min, max] = bounds[action.actionType] ?? [5, 15]
  const actor=world.agents.find(a=>a.id===action.actorId)!
  const impairment=action.actionType==='EXPLORE'?(actor.trauma?.functions.mobility??0):['ATTACK','ROB','USE_ITEM'].includes(action.actionType)?(actor.trauma?.functions.dexterity??0):0
  return Math.ceil(Math.max(min, Math.min(max, Math.round(action.durationMinutes ?? min)))/(1-impairment))
}

function event(world: WorldState, action: ProposedAction | null, phase: WorldEvent['phase'], summary: string, changes: StateChange[] = [], type: WorldEvent['type'] = 'DECISION'): WorldEvent {
  const actionResult = action ? koreanParticles(summary) : undefined
  const context = action ? actionContext(action, world) : undefined
  summary = koreanParticles(`${context ? `${context} ` : ''}${summary}`)
  if (action && phase === 'CANCELLED') finishBehavior(world, action, false, summary)
  const placeId = action?.locationId ?? world.places[0]?.id ?? ''
  const source=action&&world.agents.find(a=>a.id===action.actorId)
  const perceptions=source?world.agents.filter(a=>a.publicState.status!=='deceased'&&a.publicState.locationId===placeId).flatMap(a=>{
    const sense: 'participant'|'sight'|'hearing'|null=a.id===source.id||action!.targetIds.includes(a.id)?'participant':canSee(world,a.id,source.id)?'sight':canHear(world,a.id,source.id)?'hearing':null
    return sense?[{agentId:a.id,sense,area:a.publicState.localArea??'CENTER',position:{...agentPoint(a)}}]:[]
  }):[]
  return { id: randomUUID(), type, occurredAt: new Date().toISOString(), day: world.clock.day, worldTime: world.clock.time, worldMinute: world.engine!.minute,
    placeId, agentIds: action ? [action.actorId, ...action.targetIds] : [], summary, title: summary, stateChanges: changes,
    phase, actionResult, actionMotive: action?.publicReason, actionContext: context, actionType: action?.actionType, attemptedAction: action?.intendedAction, engineVerdict: phase,
    importance: 'normal', relatedEventIds: [], outcome: 'CONFIRMED', cause: action ? `action:${action.actionType}` : 'elapsed_world_time',
    perceptions, witnessIds: perceptions.filter(p=>p.sense==='participant'||p.sense==='sight').map(p=>p.agentId) }
}
const labels: Record<ProposedAction['actionType'], string> = { ROB: '강탈 시도', HIDE: '물건 감추기', STEAL: '절도 시도', MOVE: '이동', SPEAK: '대화', GIVE_ITEM: '물건 전달', TAKE_ITEM: '물건 가져오기', EAT: '식사', DRINK: '수분 섭취', REST: '휴식', SLEEP: '수면', EXPLORE: '탐색', SHARE_INFO: '정보 전달', OBSERVE: '관찰', WAIT: '대기', INTERACT: '작업 시도', COOPERATE: '협력 시도', ATTACK: '공격 시도', USE_ITEM: '물건 사용', DROP_ITEM: '물건 내려놓기' }

export function beginAction(world: WorldState, action: ProposedAction): WorldEvent {
  const goal = rememberGoalChoice(world, action)
  rememberAction(world, action)
  const actor = world.agents.find(a => a.id === action.actorId)!
  const ongoing: OngoingAction = { id: randomUUID(), proposal: structuredClone(action), startedMinute: world.engine!.minute, completesMinute: world.engine!.minute + duration(action, world), startEventId: '' }
  const noticed=world.engine!.noticedThreats?.[actor.id]
  if(noticed&&world.engine!.ongoingActions.some(t=>t.id===noticed.actionId&&t.proposal.actorId===action.targetIds[0])){ongoing.responseToActionId=noticed.actionId;ongoing.noticedEventId=noticed.eventId}
  goal.actionIds = [...(goal.actionIds ?? []), ongoing.id].slice(-24)
  const areaNames: Record<string, string> = { SHORE: '해안', FOREST: '숲', HIGH_GROUND: '고지대', CAVE: '동굴', WATER: '물가', CAMP: '야영지', CENTER: '중심부' }
  const summary = action.actionType === 'EXPLORE' && action.areaHint && action.areaHint !== (actor.publicState.localArea ?? 'CENTER')
    ? koreanParticles(`${actor.name}은(는) ${areaNames[action.areaHint]} 쪽으로 향했다.`)
    : eventProse({ summary: '', phase: 'STARTED', actionType: action.actionType, agentIds: [actor.id], stateChanges: [] }, new Map([[actor.id, actor]]))
  const start = event(world, action, 'STARTED', summary)
  const strategy = actor.v2?.strategy
  if (strategy && world.engine!.minute - strategy.updatedMinute < 720 &&
    (action.targetIds.includes(strategy.targetId) || strategy.failedActionType === 'ATTACK' && action.goalKey === 'PREPARE_PROTECTION' && ['TAKE_ITEM','EXPLORE'].includes(action.actionType))) {
    start.relatedEventIds = [...new Set([...start.relatedEventIds, strategy.sourceEventId])]
    start.cause = `event:${strategy.sourceEventId}`
  }
  const itemPlan=actor.v2?.itemPlan
  if(itemPlan?.sourceEventId&&[action.usedItemIds?.[0],action.pickupItemId].includes(itemPlan.itemId)) {
    start.relatedEventIds=[...new Set([...start.relatedEventIds,itemPlan.sourceEventId])]
    start.cause=`event:${itemPlan.sourceEventId}`
  }
  ongoing.detail=preparePhysicalAction(world,ongoing,start.stateChanges)
  start.detail=structuredClone(ongoing.detail)
  if (isTreatment(action, world)) {
    const patient = treatmentPatient(action, world)!
    start.title = start.summary = koreanParticles(`${start.actionContext} ${actor.name}은(는) ${patient.id === actor.id ? '자신의' : `${patient.name}의`} 부상을 치료하려 의약품을 준비했다.`)
  }
  start.actionId = ongoing.id
  ongoing.startEventId = start.id
  ongoing.causalEventIds = [...start.relatedEventIds]
  world.engine!.ongoingActions.push(ongoing)
  actor.nextDecisionAt = ongoing.completesMinute
  rememberIntent(actor, action, ongoing.id, world.engine!.minute)
  actor.wakeReason = undefined
  actor.publicState.lastAction = start.summary
  // Sticky: an action that doesn't name a sub-area (areaHint null) leaves the actor where they
  // last were, rather than snapping back to a default.
  // Keep the origin until completion. The public ongoing action carries the destination
  // so the map can interpolate the same journey that the engine will commit.
  return start
}

export function prepareThreatResponse(world: WorldState, targetId: string, threatId: string): WorldEvent[] {
  const target = world.agents.find(a => a.id === targetId)
  if (!target || !['alive', 'injured'].includes(target.publicState.status)) return []
  const task = world.engine!.ongoingActions.find(a => a.proposal.actorId === targetId)
  if (task && ['ATTACK','ROB','MOVE','SLEEP'].includes(task.proposal.actionType)) return []
  const threat=world.engine!.ongoingActions.find(t=>t.startEventId===threatId)
  if(threat){world.engine!.noticedThreats??={};world.engine!.noticedThreats[targetId]={actionId:threat.id,eventId:threatId,minute:world.engine!.minute}}
  target.wakeReason = 'visible_attack_attempt'; target.nextDecisionAt = world.engine!.minute
  if (!task) return []
  world.engine!.ongoingActions = world.engine!.ongoingActions.filter(a => a.id !== task.id)
  const interrupted = event(world, task.proposal, 'CANCELLED', `${target.name}은(는) 자신을 향한 공격을 알아차리고 ${labels[task.proposal.actionType]}을(를) 중단했다.`)
  interrupted.actionId = task.id; interrupted.relatedEventIds = [task.startEventId, threatId]; interrupted.cause = 'visible_attack_interrupt'
  return [interrupted]
}

function relationshipEffect(world: WorldState, receiver: Agent, giverId: string, changes: StateChange[]) {
  if (world.engine?.studio) { evolveRelationship(world, receiver, world.agents.find(a => a.id === giverId)!, 1, changes); return }
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
  let detail=ongoing.detail
  if (!check.approved) {
    const failed = event(world, action, 'FAILED', `${actionFailure(check)}. ${actor.name}은(는) 그 시도를 중단했다.`)
    failed.engineVerdict = check.notes.join(', ')
    failed.detail=ongoing.detail
    if(failed.detail)failed.detail.steps.push({minute:world.engine!.minute,actorId:actor.id,kind:'RESULT',text:failed.actionResult??failed.summary})
    failed.actionId = ongoing.id; failed.relatedEventIds = [ongoing.startEventId]
    actor.nextDecisionAt = world.engine!.minute
    finishBehavior(world, action, false, failed.summary)
    return failed
  }
  if (isTreatment(action, world)) {
    const patient = treatmentPatient(action, world)!
    if (action.resourceKey) {
      const stock = world.places.find(p => p.id === action.locationId)!.resources.find(r => r.key === action.resourceKey)!
      changes.push({ field: `place:${action.locationId}:${stock.key}`, from: String(stock.level), to: String(stock.level - 1) })
    } else {
      const item = world.engine!.objects.find(o => o.id === action.usedItemIds![0])!
      const quantity = item.quantity; item.quantity--
      changes.push({ field: `object:${item.id}:quantity`, from: String(quantity), to: String(item.quantity) })
      if (!item.quantity) { item.condition = 'destroyed'; actor.inventory = actor.inventory.filter(id => id !== item.id) }
    }
    const before = patient.body!.injury,traumaBefore=JSON.stringify(patient.trauma??null)
    const treated=treatInjuries(patient,world.engine!.minute)
    patient.body!.injury = treated?before:Math.max(0, before - 2)
    changes.push({ field: `agent:${patient.id}:injury`, from: String(before), to: String(patient.body!.injury) })
    if (!patient.body!.injury && patient.publicState.status === 'injured' && patient.body!.health < 8) {
      changes.push({ field: `agent:${patient.id}:status`, from: 'injured', to: 'alive' }); patient.publicState.status = 'alive'
    }
    summary = koreanParticles(`${actor.name}은(는) ${patient.id === actor.id ? '자신의' : `${patient.name}의`} 부상을 치료하기 위해 의약품을 썼다. 치료 후 ${patient.name}의 부상은 ${patient.body!.injury === 0 ? '회복되었다' : '조금 나아졌다'}.`)
    if(treated){summary=koreanParticles(`${actor.name}은(는) ${patient.name}의 상처를 처치했다. 출혈과 기능 저하는 경과를 지켜봐야 한다.`);changes.push({field:`agent:${patient.id}:trauma`,from:traumaBefore,to:JSON.stringify(patient.trauma)})}
    type = 'RESOURCE_CHANGE'
  } else if (['ATTACK','ROB'].includes(action.actionType)) {
    const target = world.agents.find(a => a.id === action.targetIds[0])!
    const resolved=resolvePhysicalCombat(world,ongoing)
    detail=resolved.detail
    const damage=resolved.damage
    const exhausted=actor.humanState!.fatigue>=9
    for (const key of ['health', 'injury'] as const) {
      const from = target.body![key]; target.body![key] = clamp(from + damage)
      changes.push({ field: `agent:${target.id}:${key}`, from: String(from), to: String(target.body![key]) })
    }
    const priorStatus = target.publicState.status
    target.publicState.status = target.body!.health >= 10 ? 'deceased' : damage > 0 ? 'injured' : priorStatus
    changes.push({ field: `agent:${target.id}:status`, from: priorStatus, to: target.publicState.status })
    if (target.vitals) target.vitals.health = Math.max(0, 10 - target.body!.health)
    const fatigue = actor.humanState!.fatigue; actor.humanState!.fatigue = clamp(fatigue + 1)
    changes.push({ field: `agent:${actor.id}:fatigue`, from: String(fatigue), to: String(actor.humanState!.fatigue) })
    if (exhausted) {
      const stress = actor.humanState!.stress
      actor.humanState!.stress = clamp(stress + 1)
      changes.push({ field: `agent:${actor.id}:stress`, from: String(stress), to: String(actor.humanState!.stress) })
      actor.nextDecisionAt = Math.max(actor.nextDecisionAt ?? 0, world.engine!.minute + 20)
    }
    world.engine!.combatAlerts ??= {}
    world.engine!.combatAlerts[target.id] = world.engine!.minute + 15
    let relationship = target.relationships.find(r => r.otherAgentId === actor.id)
    if (!relationship) { relationship = { agentId: target.id, otherAgentId: actor.id, stance: 'neutral', trust: 5 }; target.relationships.push(relationship) }
    changes.push({ field: `relationship:${target.id}:${actor.id}:stance`, from: relationship.stance, to: 'hostile' })
    const trust = relationship.trust ?? 5
    const hostility = relationship.hostility ?? 0
    relationship.stance = 'hostile'; relationship.label = 'hostile'; relationship.trust = Math.max(0, trust - 3); relationship.hostility = Math.min(10, hostility + 6)
    changes.push({ field: `relationship:${target.id}:${actor.id}:trust`, from: String(trust), to: String(relationship.trust) }, { field: `relationship:${target.id}:${actor.id}:hostility`, from: String(hostility), to: String(relationship.hostility) })
    target.wakeReason = 'attacked'; target.nextDecisionAt = world.engine!.minute
    if (target.publicState.status === 'deceased') target.nextDecisionAt = Number.MAX_SAFE_INTEGER
    summary=resolved.summary
    if(target.publicState.status==='deceased'){
      const death=koreanParticles(`${target.name}은(는) 누적된 손상으로 사망했다.`)
      summary+=` ${death}`;detail.steps.push({minute:world.engine!.minute,actorId:target.id,kind:'RESULT',text:death})
    }
    if (action.actionType === 'ROB' && (target.body!.injury >= 8 || target.publicState.status === 'deceased')) {
      const object = world.engine!.objects.find(o => o.id === action.usedItemIds![0])!
      target.inventory = target.inventory.filter(id => id !== object.id); actor.inventory.push(object.id)
      object.location = { kind: 'agent', id: actor.id }; object.concealedBy = undefined
      changes.push({ field: `object:${object.id}:holder`, from: target.id, to: actor.id })
      const transfer=`${actor.name}은(는) 저항하기 어려워진 상대에게서 ${object.name}을(를) 가져갔다.`
      summary += ` ${transfer}`;detail.steps.push({minute:world.engine!.minute,actorId:actor.id,kind:'RESULT',objectId:object.id,text:koreanParticles(transfer)})
    } else if (action.actionType === 'ROB') {summary += ' 상대의 물건을 빼앗지는 못했다.';detail.steps.push({minute:world.engine!.minute,actorId:actor.id,kind:'RESULT',text:'상대의 물건을 빼앗지는 못했다.'})}
    type = 'CONFLICT'
  } else if (action.actionType === 'HIDE') {
    const object = world.engine!.objects.find(o => o.id === action.usedItemIds![0])!
    object.concealedBy = actor.id
    changes.push({ field: `object:${object.id}:concealed`, from: 'false', to: 'true' })
    summary = `${actor.name}은(는) 가지고 있던 ${object.name}을(를) 눈에 띄지 않게 감췄다.`
  } else if (action.actionType === 'STEAL') {
    const target = world.agents.find(a => a.id === action.targetIds[0])!
    const object = world.engine!.objects.find(o => o.id === action.usedItemIds![0])!
    const opening = combatOpportunity(world, target).opening
    const success = opening > 0 && actor.humanState!.fatigue < 9 && !object.concealedBy
    if (success) {
      target.inventory = target.inventory.filter(id => id !== object.id)
      actor.inventory.push(object.id); object.location = { kind: 'agent', id: actor.id }
      changes.push({ field: `object:${object.id}:holder`, from: target.id, to: actor.id })
    }
    // An awake victim witnesses the attempt and forms their own response next decision.
    const asleep = world.engine!.ongoingActions.some(a => a.proposal.actorId === target.id && a.proposal.actionType === 'SLEEP')
    if (!asleep) {
      target.wakeReason = 'theft_attempt'; target.nextDecisionAt = world.engine!.minute
      evolveRelationship(world, target, actor, -2, changes)
    }
    summary = success ? `${actor.name}은(는) ${target.name}의 ${object.name}을(를) 몰래 가져갔다.` : `${actor.name}은(는) ${target.name}의 ${object.name}에 손을 뻗었지만 가져오지 못했다.`
    type = 'CONFLICT'
  } else if (action.actionType === 'USE_ITEM' || action.actionType === 'DROP_ITEM') {
    const object = world.engine!.objects.find(o => o.id === action.usedItemIds![0])!
    if (action.actionType === 'DROP_ITEM') {
      object.concealedBy = undefined; object.location = {kind:'place',id:action.locationId};object.localArea=actor.publicState.localArea??'CENTER';actor.inventory=actor.inventory.filter(id=>id!==object.id)
      changes.push({field:`object:${object.id}:holder`,from:actor.id,to:`place:${action.locationId}`})
      summary=`${actor.name}이(가) ${object.name}을(를) 내려놓았다.`
    } else {
      if(object.kind!=='tool'){const from=object.quantity;object.quantity--;changes.push({field:`object:${object.id}:quantity`,from:String(from),to:String(object.quantity)});if(!object.quantity){object.condition='destroyed';actor.inventory=actor.inventory.filter(id=>id!==object.id)}}
      if(object.kind==='food'||object.kind==='water'){actor.humanState!.survival_need=clamp(actor.humanState!.survival_need-2);if(actor.vitals){const k=object.kind==='food'?'hunger':'thirst';actor.vitals[k]=clamp(actor.vitals[k]-2)}}
      if(object.kind==='medicine'){const from=actor.body!.injury;actor.body!.injury=clamp(from-2);changes.push({field:`agent:${actor.id}:injury`,from:String(from),to:String(actor.body!.injury)})}
      if(object.kind==='fuel'){const p=world.places.find(p=>p.id===action.locationId)!;changes.push({field:`place:${p.id}:power`,from:String(p.power),to:'true'});p.power=true}
      summary=`${actor.name}이(가) ${object.name}을(를) 사용했다.`
      if(['food','water'].includes(object.kind)&&detail){
        detail.resource={key:object.id,quantity:1,sourcePlaceId:action.locationId,discovererId:null}
        detail.steps.push({minute:world.engine!.minute,actorId:actor.id,kind:'CONSUME',objectId:object.id,text:koreanParticles(`${actor.name}은(는) 소지하고 있던 ${object.name}을(를) ${object.kind==='water'?'마셨다':'먹었다'}.`)})
      }
    }
    type='RESOURCE_CHANGE'
  } else if (action.actionType === 'MOVE') {
    changes.push({ field: `agent:${actor.id}:location`, from: actor.publicState.locationId, to: action.destinationId! })
    type = 'MOVE'; summary = `${actor.name}이(가) ${world.places.find(p => p.id === action.destinationId)!.name}에 도착했다.`
  } else if (action.actionType === 'GIVE_ITEM' || action.actionType === 'TAKE_ITEM') {
    let object = world.engine!.objects.find(o => o.id === action.usedItemIds![0])
    if (object) {
      const source = object.location.kind === 'agent' ? object.location.id : `place:${object.location.id}`
      const receiver = action.actionType === 'GIVE_ITEM' ? world.agents.find(a => a.id === action.targetIds[0])! : actor
      if (action.actionType === 'TAKE_ITEM' && object.quantity > 1) {
        const stock = object
        const count = stock.quantity
        stock.quantity -= 1
        changes.push({ field: `object:${stock.id}:quantity`, from: String(count), to: String(stock.quantity) })
        object = { ...stock, id: randomUUID(), quantity: 1 }
        world.engine!.objects.push(object)
      }
      const heldObject = object
      if (heldObject.location.kind === 'agent') {
        const holder = world.agents.find(a => a.id === heldObject.location.id)!
        holder.inventory = holder.inventory.filter(id => id !== heldObject.id)
      }
      object.location = { kind: 'agent', id: receiver.id }; object.localArea = undefined; object.concealedBy = undefined
      if (!receiver.inventory.includes(object.id)) receiver.inventory.push(object.id)
      changes.push({ field: `object:${object.id}:holder`, from: source, to: receiver.id })
      if (receiver.id !== actor.id) relationshipEffect(world, receiver, actor.id, changes)
      if (world.engine!.studio && action.actionType === 'TAKE_ITEM' && ['food','water'].includes(object.kind) && object.quantity >= 3) {
        for (const witness of world.agents.filter(a=>a.id!==actor.id&&a.publicState.locationId===action.locationId&&a.publicState.status!=='deceased')) evolveRelationship(world,witness,actor,-1,changes)
      }
      summary = `${actor.name}이(가) ${object.name}을(를) ${receiver.id === actor.id ? '가져왔다' : `${receiver.name}에게 건넸다`}.`
      type = 'COOPERATION'
    }
  } else if (action.actionType === 'EAT' || action.actionType === 'DRINK') {
    const resource = world.places.find(p => p.id === action.locationId)!.resources.find(r => r.key === action.resourceKey)!
    changes.push({ field: `place:${action.locationId}:${resource.key}`, from: String(resource.level), to: String(resource.level - 1) })
    const from = actor.humanState!.survival_need
    actor.humanState!.survival_need = clamp(from - 2)
    if (actor.vitals) { const key=action.actionType==='EAT'?'hunger':'thirst',before=actor.vitals[key]; actor.vitals[key]=clamp(before-2);changes.push({field:`agent:${actor.id}:${key}`,from:String(before),to:String(actor.vitals[key])}) }
    changes.push({ field: `agent:${actor.id}:survival_need`, from: String(from), to: String(actor.humanState!.survival_need) })
    summary = `${actor.name}이(가) ${resource.label} 1${resource.unit ?? '단위'}를 소비했다.`; type = 'RESOURCE_CHANGE'
  } else if (action.actionType === 'REST' || action.actionType === 'SLEEP') {
    const from = actor.humanState!.fatigue
    actor.humanState!.fatigue = clamp(from - Math.max(1, Math.floor((ongoing.completesMinute - ongoing.startedMinute) / (action.actionType === 'SLEEP' ? 60 : 30))))
    changes.push({ field: `agent:${actor.id}:fatigue`, from: String(from), to: String(actor.humanState!.fatigue) })
  } else if (action.actionType === 'INTERACT' && action.interaction) {
    const outputs = completeWorldInteraction(world, action, ongoing.id, changes)
    summary = `${actor.name}이(가) 기존 물질을 ${action.interaction.operation}해 ${outputs.map(o => o.name).join(', ')}을(를) 만들었다.`
    type = 'RESOURCE_CHANGE'
  } else if (action.actionType === 'INTERACT' && action.resourceKey) {
    const resource=world.places.find(p=>p.id===action.locationId)!.resources.find(r=>r.key===action.resourceKey)!
    changes.push({field:`place:${action.locationId}:${resource.key}`,from:String(resource.level),to:String(resource.level-1)})
    summary=`${actor.name}이(가) 작업에 ${resource.label} 1${resource.unit??'단위'}를 사용했다.`;type='RESOURCE_CHANGE'
  } else if (actionIntent(action) === 'PROPOSE_SURVIVAL_PLAN') {
    summary = `${actor.name}은(는) 생존을 위한 역할 분담을 제안했다. 아직 다른 사람들의 수락은 확인되지 않았다.`; type = 'DIALOGUE'
  } else if (action.actionType === 'COOPERATE' && world.engine!.studio) {
    type = 'DIALOGUE'
  } else if (action.actionType === 'SPEAK') {
    summary = `${actor.name}이(가) 말을 건넸다.`; type = 'DIALOGUE'
    if(action.intent==='SELF_STATE_DISCLOSURE'&&action.targetIds[0]){
      const receiver=world.agents.find(a=>a.id===action.targetIds[0])!
      receiver.knowledge.push({id:randomUUID(),kind:'self_state',summary:`${actor.name}이(가) 자신의 상태를 말했다: ${action.spokenText??'도움이 필요하다고 말했다.'}`,learnedAt:new Date().toISOString(),acquisition:'report',sourceAgentId:actor.id,confidence:.5,verified:false})
      changes.push({field:`knowledge:${receiver.id}:self_state`,from:'unknown',to:'reported'})
    }
  } else if (action.actionType === 'EXPLORE') {
    type = 'DISCOVERY'
    const destination=searchDestination(world,actor,action)
    const searchArea=action.areaHint??actor.publicState.localArea??'CENTER'
    const origin=searchArea===(actor.publicState.localArea??'CENTER')?agentPoint(actor):{x:.5,y:.5}
    const encountered=world.engine!.objects.filter(o=>o.location.kind==='place'&&o.location.id===action.locationId&&(o.localArea??'CENTER')===searchArea&&o.quantity>0&&o.condition!=='destroyed'&&!o.concealedBy&&nearSearchPath(origin,destination,objectPoint(o)))
    const newObjects=encountered.filter(o=>!(actor.observedObjects??[]).some(known=>known.id===o.id))
    actor.observedObjects??=[]
    for(const o of encountered){actor.observedObjects=actor.observedObjects.filter(known=>known.id!==o.id);actor.observedObjects.push({id:o.id,name:o.name,kind:o.kind,placeId:action.locationId,localArea:searchArea,position:o.position,atMinute:world.engine!.minute})}
    actor.observedObjects=actor.observedObjects.slice(-30)
    for(const o of newObjects)changes.push({field:`knowledge:${actor.id}:object:${o.id}`,from:'unknown',to:'observed'})
    const truths = world.engine!.truths.filter(t => t.placeId === action.locationId && (t.localArea??world.engine!.objects.find(o=>o.id===t.itemId)?.localArea??'CENTER')===searchArea && nearSearchPath(origin,destination,truthPoint(t,world)) && !t.discoveredBy.includes(actor.id) && (!t.itemId || actor.inventory.includes(t.itemId) || world.engine!.objects.some(o => o.id === t.itemId && o.location.kind === 'place' && o.location.id === action.locationId && o.quantity > 0)) && (!t.eventId || world.engine!.studio?.firedEvents.includes(t.eventId)))
    for (const truth of truths) {
      truth.discoveredBy.push(actor.id)
      actor.knowledge.push({ id: randomUUID(), summary: truth.summary, truthId: truth.id, learnedAt: new Date().toISOString(), acquisition: 'discovery', verified: true, placeId: action.locationId })
      if (truth.revealedPlaceId && !actor.knownPlaceIds!.includes(truth.revealedPlaceId)) actor.knownPlaceIds!.push(truth.revealedPlaceId)
      changes.push({ field: `knowledge:${actor.id}:${truth.id}`, from: 'unknown', to: 'discovered' })
    }
    const adjacent = searchArea==='CENTER'&&nearSearchPath(origin,destination,{x:.5,y:.5})?world.engine!.connections.filter(c => c.fromPlaceId === action.locationId || c.toPlaceId === action.locationId).map(c => c.fromPlaceId === action.locationId ? c.toPlaceId : c.fromPlaceId):[]
    const newPlaces = adjacent.filter(id => !actor.knownPlaceIds!.includes(id))
    for (const id of newPlaces) {
      actor.knownPlaceIds!.push(id)
      changes.push({ field: `knowledge:${actor.id}:place:${id}`, from: 'unknown', to: 'discovered' })
    }
    for (const id of [...newPlaces, ...truths.flatMap(t => t.revealedPlaceId ? [t.revealedPlaceId] : [])]) {
      const discovered = world.places.find(p => p.id === id)
      if (discovered) discovered.isDiscovered = true
    }
    summary = newObjects.length ? `${actor.name}이(가) 이동 경로 주변에서 ${newObjects.map(o=>o.name).join(', ')}을(를) 발견했다.${truths.length||newPlaces.length?' 새로운 정보도 확인했다.':''}` : truths.length || newPlaces.length ? `${actor.name}이(가) 이동 경로 주변에서 새로운 정보를 확인했다.` : `${actor.name}이(가) 탐색을 마쳤지만 이동 경로 주변에서 새로운 발견은 없었다.`
    const prior=actor.publicState.position??{x:.5,y:.5}
    actor.publicState.position=destination
    changes.push({field:`agent:${actor.id}:position`,from:JSON.stringify(prior),to:JSON.stringify(destination)})
  } else if (action.actionType === 'SHARE_INFO') {
    const fact = actor.knowledge.find(k => k.id === action.factId)!, recipient = world.agents.find(a => a.id === action.targetIds[0])!
    recipient.knowledge.push({ ...fact, id: randomUUID(), sourceFactId: fact.id, sourceEventId: undefined, learnedAt: new Date().toISOString(), acquisition: 'report', sourceAgentId: actor.id, confidence: Math.min(.8, Math.max(.2, (fact.confidence ?? (fact.verified ? 1 : .5)) * .7)), verified: false })
    if (fact.placeId && actor.knownPlaceIds?.includes(fact.placeId) && !recipient.knownPlaceIds?.includes(fact.placeId)) recipient.knownPlaceIds!.push(fact.placeId)
    changes.push({ field: `knowledge:${recipient.id}`, from: 'not_received', to: 'report_received' })
    summary = `${actor.name}이(가) ${recipient.name}에게 ${fact.summary.slice(0,180)}에 관해 자신이 아는 바를 전달했다.`; type = 'DIALOGUE'
  }
  // Only the effects derived above may change state; no model-supplied StateChange is accepted.
  if (action.areaHint && action.actionType === 'EXPLORE' && action.areaHint !== (actor.publicState.localArea ?? 'CENTER')) {
    changes.push({ field: `agent:${actor.id}:localArea`, from: actor.publicState.localArea ?? 'CENTER', to: action.areaHint })
    actor.publicState.localArea = action.areaHint
    const areaNames: Record<string, string> = { SHORE: '해안', FOREST: '숲', HIGH_GROUND: '고지대', CAVE: '동굴', WATER: '물가', CAMP: '야영지', CENTER: '중심부' }
    summary = `${actor.name}은(는) ${areaNames[action.areaHint] ?? action.areaHint}에 도착했다. ${summary}`
  }
  applyStateChanges(world, changes.filter(c => c.field.startsWith('place:') || c.field.endsWith(':location')))
  if(['EAT','DRINK'].includes(action.actionType)) {
    detail??={version:1,startedMinute:ongoing.startedMinute,endedMinute:ongoing.completesMinute,intent:action.publicReason??action.intendedAction,steps:[]}
    detail.resource={key:action.resourceKey!,quantity:1,sourcePlaceId:action.locationId,discovererId:null}
    detail.steps.push({minute:world.engine!.minute,actorId:actor.id,kind:'CONSUME',text:koreanParticles(summary)})
  }
  if(detail?.combat||detail?.resource)captureWitnesses(world,actor,action.targetIds[0],detail)
  if(action.actionType==='SPEAK'&&action.targetIds[0]&&detail)detail.speech=speechContext(actor,world.agents.find(a=>a.id===action.targetIds[0])!)
  const result = event(world, action, 'COMPLETED', summary, changes, type)
  if (action.actionType === 'SHARE_INFO') {
    const recipient = world.agents.find(a => a.id === action.targetIds[0])
    const report = [...(recipient?.knowledge ?? [])].reverse().find(k => k.acquisition === 'report' && k.sourceAgentId === actor.id && k.sourceFactId === action.factId && !k.sourceEventId)
    if (report) report.sourceEventId = result.id
  }
  if(action.actionType==='SPEAK'&&action.intent==='SELF_STATE_DISCLOSURE'&&action.targetIds[0]){
    const receiver=world.agents.find(a=>a.id===action.targetIds[0])!
    const report=[...receiver.knowledge].reverse().find(k=>k.kind==='self_state'&&k.sourceAgentId===actor.id&&!k.sourceEventId)
    if(report)report.sourceEventId=result.id
  }
  result.detail=detail
  if(detail?.witnesses)result.witnessIds=[...new Set([actor.id,...action.targetIds,...detail.witnesses.map(w=>w.actorId)])]
  if(detail?.combat?.damage){
    const target=world.agents.find(a=>a.id===detail!.combat!.targetId)!
    target.wounds??=[];target.wounds.push({eventId:result.id,part:detail.combat.injuredPart!,damage:detail.combat.damage,minute:world.engine!.minute})
    if(ongoing.adjudication?.proposal.injury){
      const before=JSON.stringify(target.trauma??null)
      addInjury(target,ongoing.adjudication.proposal.injury,result.id,world.engine!.minute)
      changes.push({field:`agent:${target.id}:trauma`,from:before,to:JSON.stringify(target.trauma)})
      const w=ongoing.adjudication.proposal.injury
      const limitations=w.effects.filter(e=>e.degree>=.2).map(e=>({vision:'시야',mobility:'움직임',dexterity:'손 사용',attention:'집중'}[e.function]))
      if(limitations.length){
        const text=`${target.name}은(는) 부상 때문에 ${limitations.join('과 ')}에 어려움을 겪었다.`
        detail.steps.push({minute:world.engine!.minute,actorId:target.id,kind:'RESULT',text})
      }
    }
  }
  if (action.actionType === 'HIDE') { result.witnessIds = [actor.id];result.perceptions=result.perceptions?.filter(p=>p.agentId===actor.id) }
  if (action.actionType === 'STEAL') {
    const asleep = new Set(world.engine!.ongoingActions.filter(t => t.proposal.actionType === 'SLEEP').map(t => t.proposal.actorId))
    result.witnessIds = result.witnessIds?.filter(id => !asleep.has(id))
    result.perceptions=result.perceptions?.filter(p=>!asleep.has(p.agentId))
    result.agentIds = result.agentIds.filter(id => !asleep.has(id))
  }
  if (action.actionType === 'WAIT' && !changes.length) result.visibility = 'private'
  if (['ATTACK','ROB'].includes(action.actionType)) result.importance = world.agents.find(a => a.id === action.targetIds[0])?.publicState.status === 'deceased' ? 'critical' : 'high'
  if (action.actionType === 'MOVE') {
    result.placeId = action.destinationId!
    result.witnessIds = world.agents.filter(a => inContact(world, actor.id, a.id) && a.publicState.locationId === result.placeId && a.publicState.status !== 'deceased' && !world.engine!.ongoingActions.some(task => task.proposal.actorId === a.id && task.proposal.actionType === 'MOVE')).map(a => a.id)
    result.perceptions=world.agents.filter(a=>a.publicState.locationId===result.placeId&&a.publicState.status!=='deceased').flatMap(a=>{
      const sense:'participant'|'sight'|'hearing'|null=a.id===actor.id?'participant':canSee(world,a.id,actor.id)?'sight':canHear(world,a.id,actor.id)?'hearing':null
      return sense?[{agentId:a.id,sense,area:a.publicState.localArea??'CENTER',position:{...agentPoint(a)}}]:[]
    })
    result.witnessIds=result.perceptions.filter(p=>p.sense==='participant'||p.sense==='sight').map(p=>p.agentId)
  }
  const reply = resolveInteraction(world, action, result.id, changes)
  if (reply) { result.actionResult = koreanParticles(reply); result.summary = result.title = koreanParticles(`${actionContext(action, world)} ${reply}`) }
  if(detail&&!detail.steps.length)detail.steps.push({minute:world.engine!.minute,actorId:actor.id,kind:'RESULT',text:koreanParticles(result.actionResult??summary)})
  result.actionId = ongoing.id; result.relatedEventIds = [...new Set([ongoing.startEventId,...(ongoing.causalEventIds??[]),...(ongoing.noticedEventId?[ongoing.noticedEventId]:[]),...(action.replyTo ? [world.engine!.interactions!.find(i => i.id === action.replyTo)!.sourceEventId!] : [])])]
  if (['SPEAK','COOPERATE','GIVE_ITEM','ROB'].includes(action.actionType)) result.publicQuote = action.spokenText
  for (const knowledge of actor.knowledge.filter(k => k.acquisition === 'discovery' && !k.sourceEventId)) knowledge.sourceEventId = result.id
  if (action.actionType === 'SHARE_INFO') {
    const recipient = world.agents.find(a => a.id === action.targetIds[0])!
    recipient.knowledge.at(-1)!.sourceEventId = result.id
    const fact = actor.knowledge.find(k => k.id === action.factId)!
    const revealed = world.engine!.truths.find(t => t.id === fact.truthId)?.revealedPlaceId
    if (revealed && actor.knownPlaceIds?.includes(revealed) && !recipient.knownPlaceIds!.includes(revealed)) recipient.knownPlaceIds!.push(revealed)
  }
  actor.publicState.lastAction = result.summary; actor.publicState.lastActiveAt = result.occurredAt
  finishBehavior(world, action, true, result.summary, result.id)
  return result
}

function vitals(world: WorldState): WorldEvent[] {
  const results: WorldEvent[] = [], engine = world.engine!
  for (const actor of world.agents.filter(a => a.publicState.status !== 'deceased')) {
    const hs = actor.humanState!, emotion = actor.emotion!, body = actor.body!, changes: StateChange[] = []
    const resting = engine.ongoingActions.some(a => a.proposal.actorId === actor.id && ['REST', 'SLEEP'].includes(a.proposal.actionType))
    const update = (field: string, from: number, to: number) => { if (from !== to) changes.push({ field: `agent:${actor.id}:${field}`, from: String(from), to: String(to) }) }
    const need = hs.survival_need; hs.survival_need = engine.studio ? Math.min(10, Math.max(actor.vitals!.hunger,actor.vitals!.thirst)) : clamp(need + 1); update('survival_need', need, hs.survival_need)
    const fatigue = hs.fatigue; hs.fatigue = engine.studio ? Math.min(10,fatigue+(resting?0:0.15)) : clamp(fatigue + (resting ? 0 : 1)); update('fatigue', fatigue, hs.fatigue)
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
      const significant = meaningfulChanges(changes)
      e.visibility = actor.publicState.status === 'deceased' || significant.length ? 'public' : 'private'
      if (actor.publicState.status !== 'deceased' && significant.length) e.summary = e.title = conditionSummary(actor.name, significant)
      e.importance = actor.publicState.status === 'deceased' ? 'critical' : 'low'
      results.push(e)
    }
  }
  return results
}

export function advanceEngine(world: WorldState, minutes: number, priorEvents: WorldEvent[] = [], onEvent?: (e: WorldEvent) => void): WorldEvent[] {
  const engine = world.engine
  if (!engine || engine.termination || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return []
  const end = engine.minute + minutes, events: WorldEvent[] = []
  const emit = (e: WorldEvent) => { events.push(e); onEvent?.(e) }
  for (const e of processStudio(world)) emit(e)
  while (engine.minute < end||engine.ongoingActions.some(a=>a.completesMinute<=engine.minute)) {
    if (engine.studio?.ended) break
    const nextCompletion = Math.min(...engine.ongoingActions.map(a => a.completesMinute), Infinity)
    const clinicalBoundary=world.agents.some(a=>a.publicState.status!=='deceased'&&a.trauma?.injuries.some(w=>!w.healed))?engine.minute+1:Infinity
    const next = studioBoundary(world, Math.min(end, Math.max(engine.minute, nextCompletion), engine.lastVitalsMinute + 60,clinicalBoundary))
    setClock(world, next)
    for(const e of progressTrauma(world,next)){
      emit(e)
      if(e.cause==='injury_deterioration_death'){
        for(const t of engine.ongoingActions.filter(t=>e.agentIds.includes(t.proposal.actorId))){
          const cancelled=event(world,t.proposal,'CANCELLED','지속된 출혈로 사망하여 진행 중인 행동을 완료하지 못했다.')
          cancelled.actionId=t.id;cancelled.relatedEventIds=[t.startEventId,e.id];cancelled.cause='actor_deceased';emit(cancelled)
        }
        engine.ongoingActions=engine.ongoingActions.filter(t=>!e.agentIds.includes(t.proposal.actorId))
      }
    }
    if(engine.requireCombatAdjudication&&engine.ongoingActions.some(a=>a.completesMinute<=next&&['ATTACK','ROB'].includes(a.proposal.actionType)&&!a.adjudication&&validateEngineAction(a.proposal,world,priorEvents,[],true).approved))break
    for (const ongoing of [...engine.ongoingActions].filter(a => a.completesMinute <= next)) {
      if (!engine.ongoingActions.some(a => a.id === ongoing.id)) continue
      engine.ongoingActions = engine.ongoingActions.filter(a => a.id !== ongoing.id)
      const result = completeAction(world, ongoing, [...priorEvents, ...events])
      emit(result)
      if (result.phase === 'COMPLETED' && ['ATTACK','ROB'].includes(ongoing.proposal.actionType) && (result.detail?.combat?.damage??1)>0) {
        for (const interrupted of [...engine.ongoingActions].filter(a => ongoing.proposal.targetIds.includes(a.proposal.actorId))) {
          // A living opponent's already committed counterstrike at this same instant
          // must not disappear merely because the attacker appears first in the array.
          if (['ATTACK','ROB'].includes(interrupted.proposal.actionType) && interrupted.completesMinute <= next && world.agents.find(a => a.id === interrupted.proposal.actorId)?.publicState.status !== 'deceased') continue
          engine.ongoingActions = engine.ongoingActions.filter(a => a.id !== interrupted.id)
          const target = world.agents.find(a => a.id === interrupted.proposal.actorId)!
          const cancelled = event(world, interrupted.proposal, 'CANCELLED', `${target.name}은(는) 공격을 받아 ${labels[interrupted.proposal.actionType]}을(를) 끝내지 못했다.`)
          cancelled.actionId = interrupted.id; cancelled.relatedEventIds = [interrupted.startEventId, result.id]
          emit(cancelled)
        }
      }
    }
    if (next >= engine.lastVitalsMinute + 60) { engine.lastVitalsMinute = next; for (const e of vitals(world)) emit(e) }
    for (const e of processStudio(world)) emit(e)
  }
  world.updatedAt = new Date().toISOString()
  return events
}

export function recordExperience(world: WorldState, e: WorldEvent): WorldEvent[] {
  if (!world.engine) return []
  observePossessions(world, e)
  rememberGoalResult(world, e)
  rememberSocialRefusal(world, e)
  if (e.agentIds[0]) {
    const decidingActor = world.agents.find(a => a.id === e.agentIds[0])
    if (decidingActor) rememberResult(decidingActor, e, world.engine.ongoingActions.find(t => t.id === e.actionId)?.proposal, world)
  }
  if (e.actionType && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(e.phase ?? '') && e.agentIds[0]) {
    const id = e.agentIds[0], actor = world.agents.find(a => a.id === id)
    world.engine.outcomes ??= {}
    const history = world.engine.outcomes[id] ?? []
    if (!history.some(h => h.eventId === e.id)) history.push({ eventId: e.id, minute: world.engine.minute, actionType: e.actionType, area: actor?.publicState.localArea ?? 'CENTER', summary: e.outcome === 'REJECTED' ? (e.engineVerdict ?? e.summary) : e.summary, failed: e.phase !== 'COMPLETED' || (e.actionType === 'EXPLORE' && !e.stateChanges.some(c => c.field.startsWith('knowledge:'))) || (['STEAL', 'ROB'].includes(e.actionType) && !e.stateChanges.some(c => c.field.endsWith(':holder') && c.to === id)) })
    world.engine.outcomes[id] = history.slice(-24)
  }
  if (e.outcome === 'REJECTED') return []
  updateHumanAfterEvent(world, e)
  const wakeEvents: WorldEvent[] = []
  const witnesses = new Set(e.witnessIds ?? e.agentIds)
  for (const actor of world.agents) {
    if (e.actionType === 'STEAL' && e.agentIds[0] !== actor.id && world.engine.ongoingActions.some(t => t.proposal.actorId === actor.id && t.proposal.actionType === 'SLEEP')) continue
    const involved = e.agentIds.includes(actor.id), witnessed = witnesses.has(actor.id)
    if (!involved && !witnessed) continue
    if (e.phase !== 'STARTED' && e.visibility !== 'private' && (involved || e.importance === 'high' || e.importance === 'critical' || e.type === 'DISCOVERY' || e.type === 'DIALOGUE' || e.type === 'COOPERATION' || e.type === 'CONFLICT')) {
      const summary = e.publicQuote ? `${e.summary} 발언: ${e.publicQuote}` : e.summary
      actor.knowledge.push({ id: randomUUID(), summary, sourceEventId: e.id, learnedAt: e.occurredAt, acquisition: e.type === 'DIALOGUE' ? 'report' : involved ? 'experience' : 'witness', verified: e.type !== 'DIALOGUE' })
      actor.memories ??= []
      actor.memories.push({ id: randomUUID(), summary, sourceEventIds: [e.id], importance: e.importance === 'high' || e.importance === 'critical' ? 'high' : 'normal', atMinute: e.worldMinute ?? world.engine.minute })
      actor.memories = actor.memories.sort((a, b) => (a.importance === 'high' ? 1 : 0) - (b.importance === 'high' ? 1 : 0) || a.atMinute - b.atMinute).slice(-30)
      actor.keyEventIds = [...new Set([e.id, ...actor.keyEventIds])].slice(0, 50)
    }
    const directSpeech = e.phase === 'COMPLETED' && e.agentIds.slice(1).includes(actor.id) &&
      (e.type === 'DIALOGUE' || ['COOPERATE','GIVE_ITEM','SHARE_INFO','ROB'].includes(e.actionType ?? ''))
    const localDanger = e.importance === 'critical' && witnessed
    if ((!directSpeech && !localDanger && !(e.phase === 'FAILED' && involved)) || actor.publicState.status === 'deceased') continue
    actor.nextDecisionAt = Math.min(actor.nextDecisionAt ?? Infinity, world.engine.minute)
    actor.wakeReason = localDanger ? 'local_danger' : directSpeech ? 'addressed_directly' : 'action_interrupted'
    const ongoing = world.engine.ongoingActions.find(a => a.proposal.actorId === actor.id)
    if (ongoing && (localDanger || ['SLEEP', 'REST', 'WAIT', 'OBSERVE'].includes(ongoing.proposal.actionType))) {
      world.engine.ongoingActions = world.engine.ongoingActions.filter(a => a.id !== ongoing.id)
      const cancelled = event(world, ongoing.proposal, 'CANCELLED', `${actor.name}은(는) ${directSpeech ? '자신에게 말을 건 상대에게 주의를 돌리며' : '눈앞의 위험 때문에'} ${labels[ongoing.proposal.actionType]}을(를) 중단했다.`)
      cancelled.relatedEventIds = [ongoing.startEventId, e.id]; cancelled.actionId = ongoing.id; cancelled.cause = `event:${e.id}`
      wakeEvents.push(cancelled)
    }
  }
  return wakeEvents
}
