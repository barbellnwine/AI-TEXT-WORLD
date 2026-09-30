import type { WorldEvent, WorldState } from '../domain/worldTypes.ts'
import { buildAgentKnowledgeView } from './knowledgeFilter.ts'
import { accessibleObject } from './physicalActions.ts'

// A decision may inspect only this actor's own state and directly observable surroundings.
// Validation and resolution continue to receive the authoritative WorldState separately.
export function decisionPerception(world: WorldState, actorId: string, events: WorldEvent[]): WorldState {
  const view = buildAgentKnowledgeView(actorId, world, events)
  if (!view) throw new Error('agent_has_no_location')
  const actor = world.agents.find(a => a.id === actorId)!
  const visible = new Set(view.othersPresent.map(a => a.id))
  const copy = structuredClone(world)
  copy.activeEventIds = []
  copy.factions = copy.factions.filter(f => actor.factionIds.includes(f.id))
    .map(f => ({ ...f, memberAgentIds: f.memberAgentIds.filter(id => id === actorId || visible.has(id)) }))
  copy.agents = copy.agents.filter(a => a.id === actorId || visible.has(a.id)).map(a => {
    if (a.id === actorId) return a
    a.publicState.lastAction = null
    a.inventory = []
    a.knowledge = []
    a.memories = []
    a.relationships = []
    a.dispositions = undefined
    a.motivations = undefined
    a.v2 = undefined
    a.humanState = undefined
    a.emotion = undefined
    a.vitals = undefined
    a.body = undefined
    a.trauma = undefined
    a.hiddenNotes = undefined
    a.observedPossessions = undefined
    a.observedObjects = undefined
    a.knownPlaceIds = undefined
    a.movementLog = []
    a.keyEventIds = []
    a.wakeReason = undefined
    a.nextDecisionAt = undefined
    a.exposure = undefined
    return a
  })
  copy.places = copy.places.filter(p => p.id === actor.publicState.locationId || actor.knownPlaceIds?.includes(p.id))
  for (const place of copy.places) {
    place.connectedPlaceIds = place.id === actor.publicState.locationId ? [...view.currentPlace.connectedPlaceIds] : []
    place.recentEventIds = []
    if (place.id === actor.publicState.locationId) continue
    place.resources = []
    place.currentAgentIds = []
    place.description = ''
    place.power = undefined
    place.flooded = undefined
    place.accessible = undefined
    place.temperature = undefined
    place.facilityStatus = undefined
    place.accessCondition = undefined
    place.locked = false
  }
  const currentPlace = copy.places.find(p => p.id === actor.publicState.locationId)
  if (currentPlace) currentPlace.currentAgentIds = currentPlace.currentAgentIds.filter(id => id === actorId || visible.has(id))
  if (copy.engine) {
    copy.engine.objects = copy.engine.objects.filter(o =>
      o.location.kind === 'agent' ? o.location.id === actorId : accessibleObject(world, actor, o))
    copy.engine.outcomes = { [actorId]: copy.engine.outcomes?.[actorId] ?? [] }
    copy.engine.decisions = { [actorId]: copy.engine.decisions?.[actorId] ?? { intent: '', actionType: '', minute: 0, basisEventIds: [] } }
    copy.engine.interactions = copy.engine.interactions?.filter(i => i.actorId === actorId || i.targetId === actorId)
    copy.engine.ongoingActions = copy.engine.ongoingActions.filter(t => t.proposal.actorId === actorId ||
      visible.has(t.proposal.actorId) && t.proposal.actionType !== 'HIDE')
      .map(t => t.proposal.actorId === actorId ? t : { ...t, detail: undefined, adjudication: undefined,
        proposal: { actorId: t.proposal.actorId, actionType: t.proposal.actionType, locationId: t.proposal.locationId,
          targetIds: t.proposal.targetIds, intendedAction: '', areaHint: t.proposal.areaHint } })
    copy.engine.combatAlerts = {}
    copy.engine.noticedThreats = copy.engine.noticedThreats?.[actorId] ? { [actorId]: copy.engine.noticedThreats[actorId] } : {}
    copy.engine.defenses = copy.engine.defenses?.[actorId] ? { [actorId]: copy.engine.defenses[actorId] } : {}
    copy.engine.combatRng = undefined
    copy.engine.termination = undefined
    copy.engine.connections = copy.engine.connections.filter(c =>
      c.fromPlaceId === actor.publicState.locationId && view.currentPlace.connectedPlaceIds.includes(c.toPlaceId) ||
      c.toPlaceId === actor.publicState.locationId && view.currentPlace.connectedPlaceIds.includes(c.fromPlaceId))
    copy.engine.behavior = { history: [], plans: [] }
    copy.engine.environment = { powerStatus: '', facilityStatus: '' }
    copy.engine.competition = world.engine?.competition ?? (world.engine?.studio ? {endMinute:world.engine.studio.endMinute,lastSurvivor:world.engine.studio.config.endings.some(e=>e.type==='survivors'&&e.value===1)} : undefined)
    const rules=world.engine?.studio?.config.endings??[]
    const deadlines=rules.filter(r=>r.type==='day').map(r=>r.value*1440)
    const endMinute=deadlines.length?Math.min(...deadlines):world.engine?.competition?.endMinute??null
    const alive=world.agents.filter(a=>['alive','injured'].includes(a.publicState.status)).length
    const minute=copy.engine.minute
    const targets:NonNullable<typeof copy.engine.objectiveStatus>['targets']=[]
    for(const rule of rules){
      if(rule.type==='day')targets.push({type:'time',target:rule.value*1440,current:minute,gap:Math.max(0,rule.value*1440-minute)})
      if(rule.type==='survivors')targets.push({type:'survivors',target:rule.value,current:alive,gap:Math.max(0,alive-rule.value)})
      if(rule.type==='place'&&actor.knownPlaceIds?.includes(rule.ref))targets.push({type:'place',target:rule.ref,current:actor.publicState.locationId,gap:actor.publicState.locationId===rule.ref?0:1})
    }
    if(!targets.some(t=>t.type==='survivors')&&copy.engine.competition?.lastSurvivor)
      targets.push({type:'survivors',target:1,current:alive,gap:Math.max(0,alive-1)})
    copy.engine.objectiveStatus={elapsedMinute:minute,remainingMinutes:endMinute===null?null:Math.max(0,endMinute-minute),remainingCompetitors:targets.some(t=>t.type==='survivors')?alive:null,targets}
    copy.engine.studio = undefined
    copy.engine.truths = []
  }
  return copy
}
