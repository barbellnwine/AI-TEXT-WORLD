import type { ProposedAction } from './actionSchema.ts'

export interface CollectedIntent<T> {
  actorId: string
  snapshotMinute: number
  action: ProposedAction | undefined
  score: number
  value: T
}

// Identify scarce claims before any intent is applied. The resolver still validates
// every claim against WORLD TRUTH and reserves/consumes the resource exactly once.
function claim(action?: ProposedAction): string | undefined {
  if (!action) return undefined
  if (['EAT', 'DRINK'].includes(action.actionType) && action.resourceKey)
    return `stock:${action.locationId}:${action.resourceKey}`
  if (action.actionType === 'USE_ITEM' && action.resourceKey)
    return `stock:${action.locationId}:${action.resourceKey}`
  if (action.actionType === 'MOVE' && action.destinationId)
    return `capacity:${action.destinationId}`
  if (['TAKE_ITEM', 'STEAL', 'ROB'].includes(action.actionType)) {
    const id = action.pickupItemId ?? action.usedItemIds?.[0]
    if (id) return `object:${id}`
  }
  return undefined
}

function tieRank(actorId: string, minute: number): number {
  let hash = 2166136261
  for (const char of `${minute}:${actorId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return hash
}

// Reorder only actual contests. Unrelated choices keep their collection order;
// equal claims have a reproducible tick-specific tie break, not first-caller wins.
export function orderConflictingIntents<T>(intents: CollectedIntent<T>[]): T[] {
  const groups = new Map<string, CollectedIntent<T>[]>()
  for (const intent of intents) {
    const key = claim(intent.action)
    if (key) groups.set(key, [...(groups.get(key) ?? []), intent])
  }
  const emitted = new Set<string>()
  const ordered: T[] = []
  for (const intent of intents) {
    const key = claim(intent.action)
    if (!key || (groups.get(key)?.length ?? 0) < 2) { ordered.push(intent.value); continue }
    if (emitted.has(key)) continue
    emitted.add(key)
    const contest = groups.get(key)!
    contest.sort((a, b) => b.score - a.score ||
      tieRank(a.actorId, a.snapshotMinute) - tieRank(b.actorId, b.snapshotMinute) || a.actorId.localeCompare(b.actorId))
    ordered.push(...contest.map(entry => entry.value))
  }
  return ordered
}
