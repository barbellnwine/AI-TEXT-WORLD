import type { ProposedAction, ActionValidationResult } from './actionSchema.ts'
import type { WorldState } from '../domain/worldTypes.ts'
import { koreanParticles } from '../domain/eventProse.ts'

export function actionContext(action: ProposedAction, world: WorldState): string {
  if (action.publicAction && action.publicReason) return koreanParticles(`${action.publicReason.trim()} ${action.publicAction.trim()}`)
  const actor = world.agents.find(a => a.id === action.actorId)?.name ?? '인물'
  const target = action.targetIds.map(id => world.agents.find(a => a.id === id)?.name).filter(Boolean).join(', ')
  const object = world.engine?.objects.find(o => o.id === action.usedItemIds?.[0])?.name
    ?? world.places.find(p => p.id === action.locationId)?.resources.find(r => r.key === action.resourceKey)?.label
  const place = world.places.find(p => p.id === action.destinationId)?.name
  const descriptions: Record<string, string> = {
    ROB: `${target || '상대'}에게서 ${object ?? '관찰한 물건'}을(를) 힘으로 빼앗으려 했다`, HIDE: `${object ?? '소지품'}을(를) 감추려 했다`,
    STEAL: `${target || '상대'}에게서 ${object ?? '관찰한 물건'}을(를) 몰래 가져오려 했다`,
    MOVE: `${place ?? '다른 장소'}로 이동하려 했다`, SPEAK: `${target || '주변 사람'}에게 말을 건네려 했다`,
    GIVE_ITEM: `${target || '상대'}에게 ${object ?? '소지품'}을(를) 건네려 했다`, TAKE_ITEM: `${object ?? '물건'}을(를) 챙기려 했다`,
    USE_ITEM: `${target ? `${target}에게 ` : ''}${object ?? '소지품'}을(를) 사용하려 했다`, DROP_ITEM: `${object ?? '소지품'}을(를) 내려놓으려 했다`,
    INTERACT: `${object ? `${object}을(를) 사용하는 ` : ''}작업을 시도하려 했다`,
    ATTACK: `${target || '상대'}를 공격하려 했다`, COOPERATE: `${target || '주변 사람'}와 협력하려 했다`,
    EXPLORE: '주변을 탐색하려 했다', OBSERVE: '주변 상황을 살피려 했다', SHARE_INFO: `${target || '상대'}에게 알고 있는 사실을 전하려 했다`,
    EAT: `${object ?? '음식'}을(를) 먹으려 했다`, DRINK: `${object ?? '물'}을(를) 마시려 했다`, REST: '휴식을 취하려 했다', SLEEP: '잠을 청하려 했다', WAIT: '잠시 기다리려 했다',
  }
  return koreanParticles(`${actor}은(는) ${descriptions[action.actionType] ?? '행동에 나서려 했다'}. 당시 그 행동을 선택한 구체적인 이유는 기록되지 않았다.`)
}

const reasons: Record<string, string> = {
  respond_to_visible_threat_first: '눈앞에서 자신을 향한 공격이 시작되어 먼저 대응을 결정해야 했다',
  target_outside_contact: '상대가 접촉 가능한 거리 밖에 있어 말을 걸거나 손을 뻗을 수 없었다',
  target_in_another_place: '상대가 다른 장소에 있어 접촉할 수 없었다',
  target_in_another_area: '상대가 현재 구역 밖에 있어 접촉할 수 없었다',
  invitation_not_available: '제안이 만료되었거나 이미 답한 제안이었다',
  exchange_items_no_longer_available: '합의하려던 물건을 더 이상 가지고 있지 않아 교환할 수 없었다',
  requested_item_not_observed: '상대가 그 물건을 가지고 있다는 사실을 확인하지 못했다',
  steal_requires_existing_owned_item: '상대에게서 가져오려던 물건이 없거나 사용할 수 없었다',
  semantic_action_cooldown_6h: '세계 시간 6시간 안에 같은 목적의 행동을 이미 시도했다',
  survival_plan_already_active: '이미 생존 계획과 후속 과업이 있어 같은 제안을 반복할 수 없었다',
  survival_action_before_more_planning: '허기·갈증 또는 피로가 심해 계획을 다시 논의하기보다 생존 행동이 먼저 필요했다',
  intent_action_mismatch: '정한 목적과 실제 행동이 서로 맞지 않았다', task_not_available: '자신이 수행할 수 있는 대기 중 과업이 아니었다',
  generic_resource_consumption_has_no_defined_effect: '그 자원을 소비해 얻을 수 있는 작업 효과가 정해져 있지 않았다',
  medicine_requires_treatment_action: '의약품을 일반 작업에 소비할 수는 없었다. 부상자를 치료하는 행동이 필요했다',
  no_treatable_injury: '치료 대상에게 의약품으로 완화할 부상이 없었다',
  medicine_unavailable: '사용할 의약품이 부족하거나 다른 치료에 먼저 배정되어 있었다',
  resource_unavailable: '필요한 자원이 부족하거나 다른 행동에 먼저 배정되어 있었다',
  resource_has_no_defined_use_effect: '그 자원의 사용 효과가 정해져 있지 않았다',
  item_has_no_defined_effect: '그 물건으로 수행할 수 있는 효과가 정해져 있지 않았다',
  object_not_owned: '필요한 물건을 가지고 있지 않거나 이미 소진·파손되어 사용할 수 없었다',
  object_not_available_here: '필요한 물건이 이곳에 없거나 이미 사용할 수 없는 상태였다',
  object_reserved: '그 물건은 다른 사람이 먼저 사용하려고 확보한 상태였다',
  target_in_transit: '상대가 이동 중이어서 행동을 이어갈 수 없었다', patient_in_transit: '치료 대상이 이동 중이었다',
  patient_in_another_area: '치료 대상이 다른 구역에 있었다', opponent_in_another_area: '상대가 다른 구역에 있었다',
  approach_before_attack: '상대를 공격하기 전에 같은 구역으로 접근해야 했다',
  explore_to_area_before_acting: '그 행동을 하려면 먼저 해당 구역으로 이동해야 했다',
  body_cannot_fight: '부상이 심해 싸울 수 없었다', body_cannot_work: '부상이나 피로가 심해 작업을 할 수 없었다', body_cannot_move: '부상이나 피로가 심해 이동할 수 없었다',
  no_open_path: '목적지로 이어지는 열린 길이 없었다', destination_unknown: '목적지로 가는 길을 알지 못했다',
  destination_blocked_by_environment: '목적지가 침수되었거나 출입할 수 없는 상태였다', destination_capacity_exceeded: '목적지에 더 들어갈 공간이 없었다', path_requires_operator_clearance: '길의 통과 조건이 아직 충족되지 않았다',
  cannot_share_unknown_information: '전달하려던 정보를 실제로 알고 있지 않았다',
  treatment_requires_living_patient: '치료할 수 있는 살아 있는 대상 한 명이 필요했다', attack_requires_one_living_opponent: '공격할 수 있는 살아 있는 상대 한 명이 필요했다',
  cooperation_requires_present_partner: '함께 작업할 상대가 현장에 없었다', share_requires_one_present_character: '정보를 전달할 상대 한 명이 현장에 있어야 했다', speech_target_must_be_character: '말을 건넬 대상이 사람이 아니었다',
  already_performing_action: '이미 다른 행동을 수행하고 있었다', actor_not_actionable: '현재 상태로는 행동할 수 없었다',
  weapon_effect_not_defined: '그 물건을 무기로 사용하는 효과가 정해져 있지 않았다', choose_one_medicine_source: '치료에 사용할 의약품 출처를 하나로 정해야 했다', treatment_purpose_required: '누구를 왜 치료할지 정해지지 않았다', take_requires_one_existing_object: '가져올 실제 물건 하나를 지정해야 했다', food_or_water_resource_required: '실제로 먹거나 마실 자원을 지정해야 했다',
  TARGET_UNREACHABLE: '상대가 같은 장소에 있지 않았다', TARGET_NOT_FOUND: '행동 대상이 존재하지 않았다', LOCATION_MISMATCH: '계획한 장소와 현재 위치가 달라졌다', NO_PATH: '목적지로 이어지는 길이 없었다', ITEM_NOT_OWNED: '필요한 물건을 소지하고 있지 않았다', RESOURCE_UNAVAILABLE: '필요한 자원을 사용할 수 없었다', UNKNOWN_INFORMATION: '행동의 근거가 되는 정보를 알지 못했다', ACTOR_NOT_ACTIONABLE: '현재 상태로는 행동할 수 없었다', REPETITION_LIMIT: '같은 시도를 거듭해 반복 제한에 걸렸다', RULE_VIOLATION: '행동이 세계의 규칙을 충족하지 못했다',
}
export function actionFailure(check: ActionValidationResult): string {
  return [...new Set([...check.notes.map(n => reasons[n]).filter(Boolean), ...(!check.notes.some(n => reasons[n]) ? check.reasons.map(r => reasons[r]).filter(Boolean) : [])])].join('. ') || '이 행동을 계속할 조건을 충족하지 못했다'
}
