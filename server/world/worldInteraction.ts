import { randomUUID } from 'node:crypto'
import type { ProposedAction } from './actionSchema.ts'
import type { WorldState, StateChange } from '../domain/worldTypes.ts'
import type { WorldObject } from './engineTypes.ts'
import { accessibleObject } from './physicalActions.ts'

const matter = (o: WorldObject) => [...new Set(o.materials?.length ? o.materials : o.physical?.material ? [o.physical.material] : [])]

export function validateWorldInteraction(world: WorldState, action: ProposedAction): string | undefined {
  const request = action.interaction
  if (!request) return
  if (action.actionType !== 'INTERACT' || action.resourceKey || action.targetIds.length) return 'interaction_requires_object_work'
  if (!['separate', 'alter', 'combine'].includes(request.operation) || !request.resultName?.trim() || !request.resultForm?.trim() ||
      request.resultName.length > 100 || request.resultForm.length > 100 || !Number.isInteger(request.quantity) || request.quantity < 1 || request.quantity > 8) return 'invalid_transformation'
  const ids = request.sourceObjectIds
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length) return 'invalid_sources'
  if (request.operation === 'combine' ? ids.length < 2 || request.quantity !== 1 : ids.length !== 1 || request.quantity !== (request.operation === 'separate' ? 2 : 1)) return 'invalid_transformation_shape'
  const actor = world.agents.find(a => a.id === action.actorId)
  if (!actor) return 'actor_not_found'
  const sources = ids.map(id => world.engine?.objects.find(o => o.id === id))
  if (sources.some(o => !o || !accessibleObject(world, actor, o))) return 'source_unavailable'
  if (sources.some(o => o!.physical?.[request.operation === 'separate' ? 'separable' : request.operation === 'combine' ? 'combinable' : 'modifiable'] === false)) return 'source_not_modifiable'
  if ((actor.body?.injury ?? 0) >= 8 || (actor.humanState?.fatigue ?? 0) >= 9) return 'insufficient_capability'
  const available = new Set(sources.flatMap(o => matter(o!)))
  if (!available.size || !Array.isArray(request.materials) || !request.materials.length ||
      request.materials.length > 8 || request.materials.some(m => typeof m !== 'string' || !m.trim() || m.length > 60 || !available.has(m)) ||
      available.size !== new Set(request.materials).size) return 'invalid_material_conversion'
  const hardness = Math.max(...sources.map(o => o!.physical?.hardness ?? 0))
  const tools = world.engine?.objects.filter(o => o.location.kind === 'agent' && o.location.id === actor.id && o.id !== ids[0]) ?? []
  if (hardness > 0 && !tools.some(o => (o.physical?.attackPower ?? 0) >= hardness)) return 'missing_tool'
  if (world.engine?.ongoingActions.some(t => t.proposal.actorId !== actor.id && t.proposal.interaction?.sourceObjectIds.some(id => ids.includes(id)))) return 'source_reserved'
}

// Called only after the authoritative completion-time validation succeeds.
export function completeWorldInteraction(world: WorldState, action: ProposedAction, actionId: string, changes: StateChange[]): WorldObject[] {
  const request = action.interaction!
  const sources = request.sourceObjectIds.map(id => world.engine!.objects.find(o => o.id === id)!)
  const mass = sources.reduce((sum, o) => sum + (o.mass ?? 1), 0) / request.quantity
  for (const source of sources) {
    const before = source.quantity
    source.quantity--
    changes.push({ field: `object:${source.id}:quantity`, from: String(before), to: String(source.quantity) })
    if (!source.quantity) {
      source.condition = 'destroyed'
      if (source.location.kind === 'agent') world.agents.find(a => a.id === source.location.id)!.inventory = world.agents.find(a => a.id === source.location.id)!.inventory.filter(id => id !== source.id)
      changes.push({ field: `object:${source.id}:condition`, from: 'intact', to: 'destroyed' })
    }
  }
  const prototype = sources[0]
  const portable = sources.every(o => o.physical?.portable !== false) || request.operation === 'separate' && mass <= 1
  const outputs = Array.from({ length: request.quantity }, (): WorldObject => ({
    id: randomUUID(), name: request.resultName, form: request.resultForm, materials: [...new Set(request.materials)], mass,
    kind: 'item', quantity: 1, condition: 'intact',
    physical: { material: request.materials[0], portable, attackPower: Math.max(...sources.map(o => o.physical?.attackPower ?? 0)), cover: Math.max(...sources.map(o => o.physical?.cover ?? 0)), hardness: Math.max(...sources.map(o => o.physical?.hardness ?? 0)) },
    location: portable ? { kind: 'agent', id: action.actorId } : { kind: 'place', id: action.locationId },
    localArea: portable ? undefined : prototype.localArea,
    position: portable ? undefined : prototype.position,
    provenance: { sourceObjectIds: [...request.sourceObjectIds], transformation: request.operation, sourceActionId: actionId },
  }))
  for (const object of outputs) {
    world.engine!.objects.push(object)
    if (portable) world.agents.find(a => a.id === action.actorId)!.inventory.push(object.id)
    changes.push({ field: `object:${object.id}:created`, from: 'absent', to: `${object.location.kind}:${object.location.id}` })
  }
  return outputs
}
