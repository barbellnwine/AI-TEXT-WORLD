// Transcribed from the DAY 1 operator output supplied on 2026-09-30.
// These are observations, not a fabricated model response or mutable season data.
export const productionDay1 = {
  speak: ['한서진 · SPEAK · semantic_action_cooldown_6h', '이준석 · SPEAK · semantic_action_cooldown_6h'],
  observe: '강민혁 · OBSERVE · semantic_action_cooldown_6h',
  explore: '박태건 · EXPLORE · semantic_action_cooldown_6h',
  objectFailure: '박태건 · grounding failure · grounding_failure:object:not_perceived',
  placeFailure: '윤재호 · grounding failure · grounding_failure:place:not_perceived',
  sameAreaMove: "이준석 · MOVE · '939f2f30-f927-4f1b-bd9d-0909682fcb5f' is not connected to '939f2f30-f927-4f1b-bd9d-0909682fcb5f'",
  mismatch: '강민혁 · MOVE · intent_action_mismatch',
  resourceSearch: "야영지 주변과 내부를 세밀하게 수색하여 식량 1인분과 의약품 1개를 발견하고 자신의 소지품에 추가한다",
  dialogue: [
    '한서진은 이준석에게 말을 건넸다.',
    '이준석 역시 협력의 가능성을 탐색하는 차원에서 한서진의 의도를 이해하고자 대답하였다.',
    '강민혁은 윤재호에게 말을 건넸다.',
  ],
  quotes: [
    '이준석 씨, 지금 상황에 대해 이야기 나눠보고 싶어요. 서로 협력할 수 있을지 알아봅시다.',
    '한서진, 우리 서로 협력해서 살아남는 게 어때? 네 상황을 좀 듣고 싶어.',
    '지금 상황에 대해서 어떻게 생각하나? 너의 의도가 무엇인지 알고 싶다.',
  ],
  movement: '윤재호는 뇌의 의도에 따라 자원 탐색 범위를 확장하고자 깊은 숲을 떠나 동쪽 해변으로 이동했다.',
  simultaneous: '한편 샘터에서는 박태건이 식수를 확보하기 위해 샘터 내 식수 자원을 발견해야 한다는 목표 아래 탐색을 진행했다.',
  repeatedSearch: '이준석도 동쪽 해변에서 식량과 물을 찾아 탐색에 나섰다.',
} as const
