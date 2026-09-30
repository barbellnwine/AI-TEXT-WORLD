import type { ProposedAction } from './actionSchema.ts'
import type { StateChange, WorldState } from '../domain/worldTypes.ts'
import { evolveRelationship } from './studioEngine.ts'
import { agentPoint, canSee, CONTACT_RADIUS, distance } from './spatialWorld.ts'

export function inContact(world: WorldState, actorId: string, targetId: string): boolean {
  const a = world.agents.find(a => a.id === actorId), b = world.agents.find(a => a.id === targetId)
  return !!a && !!b && a.publicState.locationId === b.publicState.locationId &&
    (a.publicState.localArea ?? 'CENTER') === (b.publicState.localArea ?? 'CENTER') &&
    canSee(world,actorId,targetId) && distance(agentPoint(a),agentPoint(b)) <= CONTACT_RADIUS &&
    !world.engine?.ongoingActions.some(t => [actorId, targetId].includes(t.proposal.actorId) && ['MOVE', 'EXPLORE'].includes(t.proposal.actionType)) &&
    ['alive', 'injured'].includes(b.publicState.status)
}
function owns(world: WorldState, actorId: string, id: string) {
  return world.engine!.objects.some(o => o.id === id && o.location.kind === 'agent' && o.location.id === actorId && o.quantity > 0 && o.condition !== 'destroyed')
}
export function interactionRejection(world: WorldState, a: ProposedAction): string | undefined {
  for (const id of a.targetIds) {
    const target=world.agents.find(p=>p.id===id),actor=world.agents.find(p=>p.id===a.actorId)
    if(!target||!actor||inContact(world,a.actorId,id))continue
    if(target.publicState.locationId!==actor.publicState.locationId)return 'target_in_another_place'
    if((target.publicState.localArea??'CENTER')!==(actor.publicState.localArea??'CENTER'))return 'target_in_another_area'
    if(world.engine?.ongoingActions.some(t=>t.proposal.actorId===id&&['MOVE','EXPLORE'].includes(t.proposal.actionType)))return 'target_in_transit'
    return 'target_outside_contact'
  }
  if ((a.replyTo || a.response || a.offerItemId || a.requestItemId) && a.actionType !== 'SPEAK') return 'interaction_requires_speech'
  if (a.response && !a.replyTo) return 'response_requires_invitation'
  if (a.replyTo) {
    const offer = world.engine!.interactions?.find(i => i.id === a.replyTo)
    if (!offer || offer.status !== 'pending' || offer.targetId !== a.actorId || a.targetIds.length !== 1 || a.targetIds[0] !== offer.actorId || offer.expiresMinute <= world.engine!.minute) return 'invitation_not_available'
    if (!a.response || a.offerItemId || a.requestItemId) return 'reply_must_accept_or_refuse_original_terms'
    if (a.response === 'ACCEPT' && ((offer.offerItemId && !owns(world, offer.actorId, offer.offerItemId)) || (offer.requestItemId && !owns(world, a.actorId, offer.requestItemId)))) return 'exchange_items_no_longer_available'
  } else if (a.offerItemId || a.requestItemId) {
    if (a.targetIds.length !== 1) return 'exchange_requires_one_partner'
    if (a.offerItemId && !owns(world, a.actorId, a.offerItemId)) return 'offered_item_not_owned'
    // An item held by another person is known only after they explicitly offered it.
    if (a.requestItemId && (!owns(world, a.targetIds[0], a.requestItemId) || !world.agents.find(p => p.id === a.actorId)?.observedPossessions?.some(o => o.id === a.requestItemId && o.ownerId === a.targetIds[0]) && !world.engine!.interactions?.some(i => i.actorId === a.targetIds[0] && i.targetId === a.actorId && i.offerItemId === a.requestItemId))) return 'requested_item_not_observed'
  }
}
export function resolveInteraction(world: WorldState, a: ProposedAction, eventId: string, changes: StateChange[]): string | undefined {
  if (a.actionType !== 'SPEAK' && a.actionType !== 'COOPERATE') return
  const engine = world.engine!, actor = world.agents.find(p => p.id === a.actorId)!
  engine.interactions ??= []
  if (a.replyTo) {
    const offer = engine.interactions.find(i => i.id === a.replyTo)!
    offer.status = a.response === 'ACCEPT' ? 'accepted' : 'refused'
    changes.push({ field: `interaction:${offer.id}:status`, from: 'pending', to: offer.status })
    if (a.response === 'ACCEPT') {
      for (const plan of offer.intent === 'PROPOSE_SURVIVAL_PLAN' ? engine.behavior?.plans ?? [] : []) {
        if (plan.proposerId !== offer.actorId || (plan.sourceEventId ? plan.sourceEventId !== offer.sourceEventId : plan.placeId !== offer.placeId || Math.abs(plan.createdMinute - offer.minute) > 3) || !['proposed', 'active'].includes(plan.status)) continue
        for (const task of plan.tasks) if (task.actorId === actor.id && task.status === 'invited') task.status = 'suggested'
      }
      for (const [id, from, to] of [[offer.offerItemId, offer.actorId, actor.id], [offer.requestItemId, actor.id, offer.actorId]]) {
        if (!id) continue
        const object = engine.objects.find(o => o.id === id)!
        object.location = { kind: 'agent', id: to! }; object.concealedBy = undefined
        const giver = world.agents.find(p => p.id === from)!, receiver = world.agents.find(p => p.id === to)!
        giver.inventory = giver.inventory.filter(i => i !== id); receiver.inventory.push(id)
        changes.push({ field: `object:${id}:holder`, from: from!, to: to! })
      }
      if (changes.some(c => c.field.endsWith(':holder'))) {
        const proposer = world.agents.find(p => p.id === offer.actorId)!
        evolveRelationship(world, actor, proposer, 1, changes)
        evolveRelationship(world, proposer, actor, 1, changes)
      }
    } else {
      for (const plan of offer.intent === 'PROPOSE_SURVIVAL_PLAN' ? engine.behavior?.plans ?? [] : []) {
        if (plan.proposerId !== offer.actorId || (plan.sourceEventId ? plan.sourceEventId !== offer.sourceEventId : plan.placeId !== offer.placeId || Math.abs(plan.createdMinute - offer.minute) > 3)) continue
        for (const task of plan.tasks) if (task.actorId === actor.id && task.status === 'invited') { task.status = 'blocked'; task.result = '제안을 거절했다.' }
      }
    }
    return `${actor.name}은(는) 제안을 ${a.response === 'ACCEPT' ? '수락했다' : '거절했다'}.${changes.some(c => c.field.endsWith(':holder')) ? ' 합의한 물건을 건넸다.' : ''}`
  }
  if (a.intent === 'WARN' || a.intent === 'THREATEN') return undefined
  // A spoken invitation/question can be answered independently, including under urgent need.
  for (const targetId of a.targetIds) engine.interactions.push({ id: `${eventId}:${targetId}`, actorId: a.actorId, targetId, placeId: a.locationId, area: actor.publicState.localArea ?? 'CENTER', minute: engine.minute, expiresMinute: engine.minute + 360, intent: a.intent ?? 'SOCIAL', quote: a.spokenText, offerItemId: a.offerItemId, requestItemId: a.requestItemId, status: 'pending', sourceEventId: eventId })
  engine.interactions = engine.interactions.slice(-200)
  return undefined
}
