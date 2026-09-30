import type { Agent, WorldState } from '../domain/worldTypes.ts'

// Observable circumstances, not an invented mental state or an instruction to attack.
export function combatOpportunity(world: WorldState, target: Agent, includeEngineAlert = true) {
  const engine = world.engine!
  const ongoing = engine.ongoingActions.find(a => a.proposal.actorId === target.id && a.completesMinute > engine.minute)
  const activity = ongoing?.proposal.actionType
  const alert = (includeEngineAlert && (engine.combatAlerts?.[target.id] ?? -1) > engine.minute) || activity === 'OBSERVE' || activity === 'ATTACK' || activity === 'ROB'
  if (alert) return { opening: 0, cue: '상대가 주변을 경계하거나 전투에 대응하고 있다.' }
  if (activity === 'SLEEP') return { opening: 2, cue: '상대가 잠들어 있다.' }
  if (activity === 'REST') return { opening: 1, cue: '상대가 휴식 중이다.' }
  if (activity && ['INTERACT', 'TAKE_ITEM', 'USE_ITEM', 'EAT', 'DRINK'].includes(activity)) return { opening: 1, cue: '상대가 다른 행동을 수행 중이다.' }
  return { opening: 0, cue: '확인된 공격 기회가 없다.' }
}
