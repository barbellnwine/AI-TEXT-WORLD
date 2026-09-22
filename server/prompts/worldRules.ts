// WORLD RULES — the absolute rules every AGENT, GM, and NARRATOR prompt must be given verbatim.
// These are instructions to a model, not enforcement: the actual enforcement is
// server/world/worldValidator.ts. Treat this file as the text every other prompt file quotes,
// never as a substitute for code-level checks.
export const WORLD_RULES: string[] = [
  'WORLD STATE가 객관적인 현실의 유일한 기준이다.',
  '존재하지 않는 물건, 장소, 인물, 통로, 정보, 기술을 임의로 만들 수 없다.',
  '캐릭터는 현재 위치에서 물리적으로 가능한 행동만 시도할 수 있다.',
  '장소 간 이동은 정의된 연결 관계와 이동 시간을 따라야 한다.',
  '캐릭터는 자신의 소지품이나 접근 가능한 자원만 사용할 수 있다.',
  '캐릭터는 자신이 직접 관찰하거나 전달받은 정보만 사용할 수 있다.',
  '다른 캐릭터의 생각, 의도, 기억을 자동으로 알 수 없다.',
  '다른 캐릭터의 행동과 대사를 대신 결정할 수 없다.',
  '행동의 성공 여부와 결과를 캐릭터가 스스로 확정할 수 없다.',
  '부상, 사망, 피로, 배고픔, 감금 등의 상태를 무시할 수 없다.',
  '소비한 자원은 WORLD STATE에서 실제로 감소해야 한다.',
  '죽은 캐릭터는 부활할 수 없다.',
  '실패한 행동도 EVENT LOG에 남아야 한다.',
  '서사를 재미있게 만들기 위해 사실을 조작하면 안 된다.',
  '판단 우선순위: WORLD CONSTITUTION > WORLD RULES > WORLD STATE > WORLD TRUTH > CHARACTER KNOWLEDGE > 물리적 가능성 > 현재 상태 > 성격 > 관계 > 기억 > 목표 > 선택 > 판정 > EVENT LOG > Narrator.',
  'WORLD_CONSTITUTION.md §§0–58이 최상위 사양이며 하위 규칙·프롬프트는 이를 완화할 수 없다.',
  'HUMAN STATE(survival_need, fatigue, stress, sexual_desire, greed, ambition)는 1~10 정수이며 엔진만 변화시킨다.',
  'EMOTION은 mood, anger, fear만 수치로 관리하고 복잡한 감정은 근거 사건이 있는 기억으로 표현한다.',
  'RELATIONSHIP은 방향별 trust, affection, attraction이며 한 인물의 호감이 상대의 호감·동의가 되지 않는다.',
  '욕구는 행동을 강제하지 않는다. 성적 상호작용은 성인 사이의 자발적 상호 동의가 필수이며 상대방 동의를 대신 결정할 수 없다.',
  '이동·작업·수면에는 실제 시간이 필요하며 진행 중 행동을 즉시 완료하거나 매 tick 재판단하지 않는다.',
  '시간·수치 변화·행동 완료·LIVE 갱신은 LLM 호출 사유가 아니다. 의사결정이 필요한 관련 캐릭터만 활성화한다.',
  '정보는 경험·목격·전달·발견·추론의 경로를 보존한다. 보고받거나 추론한 내용을 확인된 진실로 승격하지 않는다.',
  'Narrator는 완료된 사건 묶음만 표현하며 진행 중 사건을 완료된 결과로 서술하지 않는다.',
  'LIVE는 사건, TEXT는 완료된 서사, WORLD STATE는 현실이다. 화면 접속 여부는 엔진 실행과 무관하다.',
]

export const WORLD_RULES_TEXT = ['[WORLD CONSTITUTION — mandatory execution rules]', ...WORLD_RULES.map((rule, i) => `${i + 1}. ${rule}`)].join('\n')
