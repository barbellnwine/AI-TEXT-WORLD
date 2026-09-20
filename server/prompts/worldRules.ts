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
]

export const WORLD_RULES_TEXT = ['[WORLD RULES]', ...WORLD_RULES.map((rule, i) => `${i + 1}. ${rule}`)].join('\n')
