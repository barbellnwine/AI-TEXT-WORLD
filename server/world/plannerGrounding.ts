import { ACTION_SCHEMA, parseProposedAction } from '../domain/worldAgent.ts'
import type { WorldState } from '../domain/worldTypes.ts'
import type { ProposedAction } from './actionSchema.ts'
import { buildAgentKnowledgeView } from './knowledgeFilter.ts'
import { agentPoint, distance, objectPoint } from './spatialWorld.ts'

export class GroundingFailure extends Error {
  readonly reason: string
  constructor(reason: string) { super(`grounding_failure:${reason}`); this.reason = reason }
}

type Ref = string | { kind?: string; reference: string }
const key = (s: string) => s.normalize('NFKC').trim().toLocaleLowerCase()
const reference = (value: unknown): string => {
  const text = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { reference?: unknown }).reference : undefined
  if (typeof text !== 'string' || !text.trim()) throw new GroundingFailure('invalid_reference')
  return text.trim()
}
function unique<T extends { id: string }>(matches: T[], reason: string): T {
  if (matches.length !== 1) throw new GroundingFailure(`${reason}:${matches.length ? 'ambiguous' : 'not_perceived'}`)
  return matches[0]
}

// Resolve only what this actor can currently perceive or owns. Remembered locations
// may inform a future plan, but cannot be treated as a currently accessible item.
export function groundPlannerSteps(raw: unknown, actorId: string, world: WorldState): ProposedAction[] {
  const actor = world.agents.find(a => a.id === actorId)
  const view = buildAgentKnowledgeView(actorId, world, [])
  if (!actor || !view || !world.engine) throw new GroundingFailure('actor_unavailable')
  const visibleObjectIds = new Set([...(view.visibleObjects ?? []).map(o => o.id), ...actor.inventory])
  const objects = world.engine.objects.filter(o => visibleObjectIds.has(o.id) && o.quantity > 0 && o.condition !== 'destroyed')
  const people = view.othersPresent.map(o => world.agents.find(a => a.id === o.id)!).filter(Boolean)
  const knownPlaces = world.places.filter(p => actor.knownPlaceIds?.includes(p.id) &&
    (p.id === actor.publicState.locationId || view.currentPlace.connectedPlaceIds.includes(p.id)))
  const object = (ref: unknown) => {
    const raw=key(reference(ref))
    const near=/^(가까운|가장 가까운|nearest|nearby)\s*/.test(raw)
    const held=/^(내가 가진|보유한|내|held|my)\s*/.test(raw)
    const name=raw.replace(/^(가장 가까운|가까운|nearest|nearby|내가 가진|보유한|내|held|my)\s*/,'').trim()
    const candidates=objects.filter(o => [o.id, o.name, o.kind, o.physical?.material, ...(o.materials ?? [])].some(v => v && key(v) === name) &&
      (!held || o.location.kind==='agent' && o.location.id===actorId))
    const exactId=candidates.find(o=>key(o.id)===name)
    if(exactId)return exactId
    if(!near)return unique(candidates,'object')
    const ranked=candidates.map(o=>({o,d:o.location.kind==='agent'?0:distance(agentPoint(actor),objectPoint(o))})).sort((a,b)=>a.d-b.d)
    if(!ranked.length)throw new GroundingFailure('object:not_perceived')
    if(ranked[1]&&Math.abs(ranked[0].d-ranked[1].d)<1e-6)throw new GroundingFailure('object:ambiguous')
    return ranked[0].o
  }
  const person = (ref: unknown) => {
    const name = key(reference(ref))
    const matches = people.filter(a => key(a.id) === name || key(a.name) === name)
    if (matches.length) return unique(matches, 'character')
    if (['저 사람', '그 사람', 'that person'].includes(name)) return unique(people, 'character')
    throw new GroundingFailure('character:not_perceived')
  }
  const place = (ref: unknown) => {
    const name = key(reference(ref))
    return unique(knownPlaces.filter(p => key(p.id) === name || key(p.name) === name), 'place')
  }
  const input = (raw as { steps?: unknown })?.steps
  if (!Array.isArray(input) || input.length < 1 || input.length > 4) throw new GroundingFailure('invalid_planner_steps')
  const grounded: ProposedAction[] = []
  for (const [index,value] of input.entries()) {
    try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GroundingFailure('invalid_planner_step')
    const r = value as Record<string, unknown>
    const actionType = r.actionType
    if (typeof actionType !== 'string') throw new GroundingFailure('invalid_action_type')
    const targets = (Array.isArray(r.targetRefs) ? r.targetRefs : Array.isArray(r.targetIds) ? r.targetIds : []) as Ref[]
    const sources = (Array.isArray(r.objectRefs) ? r.objectRefs : Array.isArray(r.usedItemIds) ? r.usedItemIds : []) as Ref[]
    if (targets.length > 10 || sources.length > 10) throw new GroundingFailure('too_many_references')
    const itemRefs = [...sources]
    const characterTargets: string[] = []
    let approachPerson: typeof people[number] | undefined
    let approachObject: typeof objects[number] | undefined
    for (const ref of targets) {
      const kind = typeof ref === 'object' ? ref.kind : undefined
      if (actionType === 'MOVE' && kind === 'character') approachPerson=person(ref)
      else if (actionType === 'MOVE' && kind === 'object') approachObject=object(ref)
      else if (actionType === 'TAKE_ITEM' || kind === 'object') itemRefs.push(ref)
      else if (actionType === 'MOVE' || kind === 'place') { /* destination below */ }
      else characterTargets.push(person(ref).id)
    }
    if (actionType === 'TAKE_ITEM' && r.pickupItemId != null) itemRefs.push(r.pickupItemId as Ref)
    const itemIds = [...new Set(itemRefs.map(ref => object(ref).id))]
    const destinationRef = r.destinationRef ?? r.destinationId ?? (actionType === 'MOVE' ? approachPerson||approachObject ? actor.publicState.locationId : targets[0] : undefined)
    const destinationId = actionType === 'MOVE' ? place(destinationRef).id : undefined
    const sameAreaMove = actionType === 'MOVE' && destinationId === actor.publicState.locationId
    const approachPoint=approachPerson?agentPoint(approachPerson):approachObject?objectPoint(approachObject):undefined
    const approachArea=approachPerson?.publicState.localArea??approachObject?.localArea
    const areaHint=sameAreaMove ? (approachArea??r.areaHint) : r.areaHint
    if (sameAreaMove && (!areaHint || areaHint === (actor.publicState.localArea ?? 'CENTER')) &&
      (!approachPoint || distance(agentPoint(actor),approachPoint)<.001))
      throw new GroundingFailure('move:same_area_without_spatial_destination')
    const interaction = r.interaction && typeof r.interaction === 'object' ? { ...(r.interaction as Record<string, unknown>) } : undefined
    if (interaction && Array.isArray(interaction.sourceObjectIds)) {
      interaction.sourceObjectIds = interaction.sourceObjectIds.map(ref => object(ref).id)
      // Materials are requested outcomes, never an authority to add matter.
      const available = new Set((interaction.sourceObjectIds as string[]).flatMap(id => {
        const source = objects.find(o => o.id === id)!
        return source.materials?.length ? source.materials : source.physical?.material ? [source.physical.material] : []
      }))
      if (!Array.isArray(interaction.materials) || interaction.materials.some(m => !available.has(m))) throw new GroundingFailure('invalid_material_conversion')
    }
    const normalized = {
      ...r, actionType: sameAreaMove ? 'EXPLORE' : actionType,
      actorId, locationId: actor.publicState.locationId, targetIds: sameAreaMove ? [] : characterTargets, usedItemIds: sameAreaMove ? [] : actionType === 'INTERACT' && interaction ? [] : itemIds,
      destinationId: sameAreaMove ? null : destinationId, pickupItemId: actionType === 'ATTACK' ? (r.pickupItemId == null ? null : object(r.pickupItemId).id) : null,
      areaHint, durationMinutes: null, searchPoint: sameAreaMove ? approachPoint ?? null : null, decisionV3: null, interaction: interaction ?? null,
    }
    let action: ProposedAction
    try { action = parseProposedAction(normalized, actorId) }
    catch (error) { throw new GroundingFailure(error instanceof Error ? error.message : 'invalid_action') }
    if (actionType === 'OBSERVE' && action.areaHint && action.areaHint !== (actor.publicState.localArea ?? 'CENTER')) {
      grounded.push({ ...action, actionType: 'EXPLORE', targetIds: [], usedItemIds: [], intendedAction: `Reach ${action.areaHint} to ${action.intendedAction}` })
    }
    grounded.push(action)
    } catch (error) {
      if (index === 0 || !(error instanceof GroundingFailure)) throw error
      const future = value as Record<string, unknown>
      if (!ACTION_SCHEMA.properties.actionType.enum.includes(String(future.actionType))) throw error
      // A future product has no current UUID. Keep its intention for the next Brain;
      // only the present step is executable and validated in this Tick.
      grounded.push({ actorId, locationId: actor.publicState.locationId, actionType: future.actionType as ProposedAction['actionType'],
        targetIds: [], usedItemIds: [], intendedAction: String(future.intendedAction ?? 'deferred step') })
    }
  }
  return grounded
}
