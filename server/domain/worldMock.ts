// Initial seed data for the "PROJECT EDEN" demo season.
// This is the mock service required until a real simulation engine exists: every field here
// conforms to the same shapes worldTypes.ts declares, so swapping this module for a real
// simulation/DB-backed builder later does not require touching the API or frontend at all.
//
// Two layers of mock data live here:
//   - WorldEvent: the system's raw, individual record of an action/judgement (unchanged shape).
//   - ChronicleEntry ("scene"): a NARRATOR-produced passage that folds several WorldEvents into
//     one readable scene. Until a real NARRATOR is wired up (see server/domain/narrator.ts), these
//     are hand-written here, but every sentence is checked against the WorldEvents it cites.
import type { Agent, Chapter, ChronicleEntry, Faction, Place, Season, WorldEvent, WorldState } from './worldTypes.ts'

const DAY_ANCHOR_MINUTES = 4255 // minutes from Day1 00:00 to the "current" baseline moment (Day3 22:55)
const ANCHOR_MINUTES_AGO = 5 // the baseline moment is treated as "5 minutes before server boot"
const BOOT_TIME = Date.now()

function isoAt(dayMinutes: number): string {
  const minutesAgo = ANCHOR_MINUTES_AGO + (DAY_ANCHOR_MINUTES - dayMinutes)
  return new Date(BOOT_TIME - minutesAgo * 60_000).toISOString()
}

const PLACES: Place[] = [
  {
    id: 'control-room',
    name: '중앙 통제실',
    description: '시설의 통신·전력 상태를 총괄하는 공간. 본토와의 정기 통신은 3일째 두절 상태다.',
    connectedPlaceIds: ['living-quarters', 'generator-room'],
    currentAgentIds: ['han-doyun', 'oh-sein'],
    resources: [{ key: 'comms', label: '외부 통신', level: 0, max: 100, trend: 'stable', unit: '%' }],
    locked: false,
    recentEventIds: ['evt-01', 'evt-02'],
  },
  {
    id: 'living-quarters',
    name: '생활 구역',
    description: '연구원과 승무원이 머무는 숙소 겸 공용 공간. 최근 탈출 여부를 둘러싼 언쟁이 있었다.',
    connectedPlaceIds: ['control-room', 'medical-bay', 'sector-b'],
    currentAgentIds: ['na-yunjae', 'kang-taeo', 'yu-rian'],
    resources: [
      { key: 'food', label: '식량', level: 68, max: 100, trend: 'down', unit: '%' },
      { key: 'water', label: '식수', level: 74, max: 100, trend: 'stable', unit: '%' },
    ],
    locked: false,
    recentEventIds: ['evt-05', 'evt-08'],
  },
  {
    id: 'generator-room',
    name: '발전실',
    description: '시설 예비 전력을 관리하는 구역. 예비 발전기 가동률이 계속 떨어지고 있다.',
    connectedPlaceIds: ['control-room', 'sector-b'],
    currentAgentIds: ['seo-jungyeong'],
    resources: [{ key: 'power', label: '예비 전력', level: 55, max: 100, trend: 'down', unit: '%' }],
    locked: false,
    recentEventIds: ['evt-06', 'evt-10', 'evt-10b'],
  },
  {
    id: 'medical-bay',
    name: '의료실',
    description: '부상자 치료와 물자 관리를 겸하는 구역. 발견된 무전기가 잠시 이곳을 거쳐 갔다.',
    connectedPlaceIds: ['living-quarters'],
    currentAgentIds: ['im-haneul', 'jeong-haram'],
    resources: [{ key: 'medical', label: '의료 물자', level: 80, max: 100, trend: 'stable', unit: '%' }],
    locked: false,
    recentEventIds: ['evt-08', 'evt-13', 'evt-14', 'evt-15'],
  },
  {
    id: 'sector-b',
    name: '폐쇄 구역 B',
    description: '오염 우려로 봉쇄되었던 구역. 오늘 비상 해제 코드로 봉쇄가 풀렸다.',
    connectedPlaceIds: ['living-quarters', 'generator-room'],
    currentAgentIds: ['baek-seungri', 'moon-gaon'],
    resources: [{ key: 'contamination', label: '오염도', level: 22, max: 100, trend: 'stable', unit: '%' }],
    locked: false,
    accessCondition: '비상 해제 코드 필요 (Day 3부로 해제됨)',
    recentEventIds: ['evt-11', 'evt-12'],
  },
]

const FACTIONS: Faction[] = [
  {
    id: 'recovery-team',
    name: '복구팀',
    description: '통신·전력 복구와 시설 운영 유지를 최우선으로 두는 그룹.',
    memberAgentIds: ['han-doyun', 'oh-sein', 'baek-seungri', 'im-haneul', 'seo-jungyeong', 'jeong-haram'],
    foundedDay: 1,
  },
  {
    id: 'departure-faction',
    name: '이탈 준비파',
    description: '외부 연락이 끊긴 상황을 위험 신호로 보고 자체 탈출 수단을 준비하는 그룹.',
    memberAgentIds: ['na-yunjae', 'kang-taeo'],
    foundedDay: 2,
  },
]

function agent(a: Agent): Agent {
  return a
}

const AGENTS: Agent[] = [
  agent({
    id: 'han-doyun',
    name: '한도윤',
    codeNumber: 'DIR-01',
    avatarId: 'director',
    shortBio: '오로라 해상연구시설 시설장. 원칙적이고 신중한 편.',
    factionIds: ['recovery-team'],
    publicState: { locationId: 'medical-bay', status: 'alive', visibleGoal: '본토와의 통신 복구', lastAction: '무전기 사용 방식을 둘러싼 논쟁을 중재', lastActiveAt: isoAt(4255) },
    relationships: [
      { agentId: 'han-doyun', otherAgentId: 'na-yunjae', stance: 'wary', note: '무전기 사용 방식을 두고 재차 충돌', lastChangedEventId: 'evt-15', lastChangedAt: isoAt(4255) },
      { agentId: 'han-doyun', otherAgentId: 'oh-sein', stance: 'ally' },
    ],
    inventory: ['시설 마스터키', '무전 로그북'],
    knowledge: [{ id: 'k-han-1', summary: '폐쇄 구역 B의 비상 해제 코드를 알고 있다.', learnedAt: isoAt(360) }],
    movementLog: [
      { placeId: 'control-room', arrivedAt: isoAt(360) },
      { placeId: 'medical-bay', arrivedAt: isoAt(4255) },
    ],
    keyEventIds: ['evt-02', 'evt-05', 'evt-15', 'evt-16'],
  }),
  agent({
    id: 'oh-sein',
    name: '오세인',
    codeNumber: 'COM-02',
    avatarId: 'technician',
    shortBio: '통신 기술자. 두절된 회선을 매일 점검한다.',
    factionIds: ['recovery-team'],
    publicState: { locationId: 'control-room', status: 'alive', visibleGoal: '통신 장비 원인 진단', lastAction: '폐쇄 구역 B 방향 잡음 신호 보고', lastActiveAt: isoAt(2385) },
    relationships: [{ agentId: 'oh-sein', otherAgentId: 'han-doyun', stance: 'ally' }],
    inventory: ['휴대용 주파수 분석기'],
    knowledge: [{ id: 'k-oh-1', summary: '이틀 전 폐쇄 구역 B 방향에서 짧은 잡음 신호를 감지했다.', sourceEventId: 'evt-07', learnedAt: isoAt(2385) }],
    movementLog: [{ placeId: 'control-room', arrivedAt: isoAt(360) }],
    keyEventIds: ['evt-01', 'evt-07'],
  }),
  agent({
    id: 'baek-seungri',
    name: '백승리',
    codeNumber: 'SEC-01',
    avatarId: 'security',
    shortBio: '보안팀장. 결단이 빠르고 현장 대응을 선호한다.',
    factionIds: ['recovery-team'],
    publicState: { locationId: 'sector-b', status: 'alive', visibleGoal: '문가온 수색', lastAction: '발견한 무전기를 임하늘에게 전달한 뒤 수색 재개', lastActiveAt: isoAt(4244) },
    relationships: [{ agentId: 'baek-seungri', otherAgentId: 'moon-gaon', stance: 'friendly', note: '수색 대상' }],
    inventory: ['비상 해제 코드 카드', '손전등'],
    knowledge: [
      { id: 'k-baek-1', summary: '폐쇄 구역 B는 비상 해제 코드로만 진입 가능하다.', learnedAt: isoAt(3360) },
      { id: 'k-baek-2', summary: '통신 장비함 안에서 사라졌던 무전기를 직접 발견했다.', sourceEventId: 'evt-12', learnedAt: isoAt(4241) },
    ],
    movementLog: [
      { placeId: 'living-quarters', arrivedAt: isoAt(360) },
      { placeId: 'sector-b', arrivedAt: isoAt(3675) },
      { placeId: 'medical-bay', arrivedAt: isoAt(4244) },
      { placeId: 'sector-b', arrivedAt: isoAt(4248) },
    ],
    keyEventIds: ['evt-11', 'evt-12', 'evt-13'],
  }),
  agent({
    id: 'im-haneul',
    name: '임하늘',
    codeNumber: 'MED-01',
    avatarId: 'medic',
    shortBio: '의료연구원. 조용하지만 상황 판단이 냉정하다.',
    factionIds: ['recovery-team'],
    publicState: { locationId: 'medical-bay', status: 'alive', visibleGoal: '부상자 치료 및 물자 관리', lastAction: '발견된 무전기의 배터리 상태를 확인함', lastActiveAt: isoAt(4248) },
    relationships: [{ agentId: 'im-haneul', otherAgentId: 'jeong-haram', stance: 'friendly', note: '치료 중' }],
    inventory: ['구급 키트', '무전기(배터리 소량 남음)'],
    knowledge: [{ id: 'k-im-1', summary: '무전기는 배터리가 얼마 남지 않았지만 최소 한 번은 송신이 가능할 것으로 보인다.', sourceEventId: 'evt-14', learnedAt: isoAt(4248) }],
    movementLog: [{ placeId: 'medical-bay', arrivedAt: isoAt(360) }],
    keyEventIds: ['evt-08', 'evt-14'],
  }),
  agent({
    id: 'seo-jungyeong',
    name: '서준경',
    codeNumber: 'ENG-01',
    avatarId: 'engineer',
    shortBio: '기계공학자. 예비 발전기 담당.',
    factionIds: ['recovery-team'],
    publicState: { locationId: 'generator-room', status: 'alive', visibleGoal: '예비 전력 유지', lastAction: '예비 전력 소모율 점검', lastActiveAt: isoAt(3840) },
    relationships: [{ agentId: 'seo-jungyeong', otherAgentId: 'baek-seungri', stance: 'ally', note: '발전기 점검 협력' }],
    inventory: ['공구 세트'],
    knowledge: [{ id: 'k-seo-1', summary: '예비 전력이 안전 기준 아래로 떨어졌다.', sourceEventId: 'evt-10', learnedAt: isoAt(3840) }],
    movementLog: [{ placeId: 'generator-room', arrivedAt: isoAt(360) }],
    keyEventIds: ['evt-04', 'evt-06', 'evt-10', 'evt-10b'],
  }),
  agent({
    id: 'na-yunjae',
    name: '나윤재',
    codeNumber: 'PLT-01',
    avatarId: 'pilot',
    shortBio: '잠수정 조종사. 외부와의 연락 두절을 심각하게 받아들인다.',
    factionIds: ['departure-faction'],
    publicState: { locationId: 'medical-bay', status: 'alive', visibleGoal: '탈출 경로 확보', lastAction: '무전기를 구조 요청에 즉시 사용해야 한다고 주장', lastActiveAt: isoAt(4255) },
    relationships: [{ agentId: 'na-yunjae', otherAgentId: 'han-doyun', stance: 'wary' }, { agentId: 'na-yunjae', otherAgentId: 'kang-taeo', stance: 'ally' }],
    inventory: ['잠수정 예비 열쇠'],
    knowledge: [],
    movementLog: [
      { placeId: 'living-quarters', arrivedAt: isoAt(360) },
      { placeId: 'medical-bay', arrivedAt: isoAt(4255) },
    ],
    keyEventIds: ['evt-05', 'evt-15', 'evt-17'],
  }),
  agent({
    id: 'moon-gaon',
    name: '문가온',
    codeNumber: 'BIO-01',
    avatarId: 'biologist',
    shortBio: '해양생물학자. Day 1 아침 홀로 폐쇄 구역 B로 향한 뒤 연락이 끊겼다.',
    factionIds: [],
    publicState: { locationId: 'sector-b', status: 'missing', visibleGoal: null, lastAction: '해양 센서 점검을 위해 폐쇄 구역 B로 이동', lastActiveAt: isoAt(430) },
    relationships: [],
    inventory: [],
    knowledge: [],
    movementLog: [
      { placeId: 'living-quarters', arrivedAt: isoAt(0) },
      { placeId: 'sector-b', arrivedAt: isoAt(430) },
    ],
    keyEventIds: ['evt-03', 'evt-09'],
    hiddenNotes: 'HIDDEN WORLD TRUTH — never exposed via API: 문가온은 통신 장비함 근처에서 넘어져 발목 통신기가 파손되었고, 현재 구역 안쪽 환기구 뒤에서 이동 중이다. 공개 정보에는 이 사실이 존재하지 않는다.',
  }),
  agent({
    id: 'kang-taeo',
    name: '강태오',
    codeNumber: 'SUP-01',
    avatarId: 'supply',
    shortBio: '보급 담당. 실용적이고 목소리가 크다.',
    factionIds: ['departure-faction'],
    publicState: { locationId: 'medical-bay', status: 'alive', visibleGoal: '탈출용 물자 확보', lastAction: '이탈 준비파 입장에서 나윤재 주장에 동조', lastActiveAt: isoAt(4255) },
    relationships: [{ agentId: 'kang-taeo', otherAgentId: 'na-yunjae', stance: 'ally' }],
    inventory: ['물자 목록표'],
    knowledge: [],
    movementLog: [
      { placeId: 'living-quarters', arrivedAt: isoAt(360) },
      { placeId: 'medical-bay', arrivedAt: isoAt(4255) },
    ],
    keyEventIds: ['evt-05', 'evt-15'],
  }),
  agent({
    id: 'yu-rian',
    name: '유리안',
    codeNumber: 'RES-04',
    avatarId: 'researcher',
    shortBio: '신입 연구원. 상황을 조용히 관찰하며 기록한다.',
    factionIds: [],
    publicState: { locationId: 'living-quarters', status: 'alive', visibleGoal: '상황 기록', lastAction: '공용 공간에서 대화 관찰', lastActiveAt: isoAt(3675) },
    relationships: [],
    inventory: ['개인 기록 노트'],
    knowledge: [],
    movementLog: [{ placeId: 'living-quarters', arrivedAt: isoAt(360) }],
    keyEventIds: [],
  }),
  agent({
    id: 'jeong-haram',
    name: '정하람',
    codeNumber: 'SEC-03',
    avatarId: 'guard',
    shortBio: '시설 경비원. 순찰 중 부상으로 의료실에서 회복 중.',
    factionIds: ['recovery-team'],
    publicState: { locationId: 'medical-bay', status: 'injured', visibleGoal: '회복 후 순찰 복귀', lastAction: '계단에서 발목 부상', lastActiveAt: isoAt(2710) },
    relationships: [{ agentId: 'jeong-haram', otherAgentId: 'im-haneul', stance: 'friendly' }],
    inventory: [],
    knowledge: [],
    movementLog: [
      { placeId: 'living-quarters', arrivedAt: isoAt(360) },
      { placeId: 'medical-bay', arrivedAt: isoAt(2710) },
    ],
    keyEventIds: ['evt-08'],
  }),
]

export const BASELINE_EVENTS: WorldEvent[] = [
  {
    id: 'evt-01', type: 'SYSTEM', occurredAt: isoAt(360), day: 1, placeId: 'control-room', agentIds: ['oh-sein'],
    title: '본토와의 정기 통신이 두절되었습니다.', summary: '06:00 정기 통신 시도가 3회 연속 실패했다.',
    stateChanges: [{ field: 'place:control-room:comms', from: '100%', to: '0%' }], importance: 'high', relatedEventIds: [],
  },
  {
    id: 'evt-02', type: 'DECISION', occurredAt: isoAt(400), day: 1, placeId: 'control-room', agentIds: ['han-doyun'],
    title: '한도윤이 비상 프로토콜을 선언했습니다.', summary: '시설장이 각 구역 점검과 복구팀 결성을 지시했다.',
    stateChanges: [{ field: 'faction:recovery-team', from: '없음', to: '결성됨' }], importance: 'normal', relatedEventIds: ['evt-01'],
  },
  {
    id: 'evt-03', type: 'MOVE', occurredAt: isoAt(430), day: 1, placeId: 'sector-b', agentIds: ['moon-gaon'],
    title: '문가온이 폐쇄 구역 B로 이동했습니다.', summary: '해양 센서 점검을 위해 단독으로 이동했다.',
    stateChanges: [{ field: 'agent:moon-gaon:location', from: 'living-quarters', to: 'sector-b' }], importance: 'normal', relatedEventIds: [],
  },
  {
    id: 'evt-04', type: 'RESOURCE_CHANGE', occurredAt: isoAt(1140), day: 1, placeId: 'generator-room', agentIds: ['seo-jungyeong'],
    title: '야간 난방 가동으로 예비 전력이 소모되었습니다.', summary: '예비 전력이 92%에서 81%로 감소했다.',
    stateChanges: [{ field: 'place:generator-room:power', from: '92%', to: '81%' }], importance: 'low', relatedEventIds: [],
  },
  {
    id: 'evt-05', type: 'CONFLICT', occurredAt: isoAt(2000), day: 2, placeId: 'living-quarters', agentIds: ['na-yunjae', 'kang-taeo', 'han-doyun'],
    title: '조기 탈출 여부를 두고 언쟁이 벌어졌습니다.', summary: '나윤재와 강태오가 즉시 탈출을 주장했고, 한도윤은 통신 복구를 우선해야 한다고 반박했다. 이 자리에서 이탈 준비파가 결성되었다.',
    stateChanges: [
      { field: 'relationship:na-yunjae-han-doyun', from: 'neutral', to: 'wary' },
      { field: 'faction:departure-faction', from: '없음', to: '결성됨' },
    ],
    importance: 'high', relatedEventIds: ['evt-02'], publicQuote: '"언제 돌아올지도 모르는 신호를 기다리기만 할 순 없어요." — 나윤재',
  },
  {
    id: 'evt-06', type: 'COOPERATION', occurredAt: isoAt(2100), day: 2, placeId: 'generator-room', agentIds: ['seo-jungyeong', 'baek-seungri'],
    title: '예비 발전기 점검이 성공적으로 끝났습니다.', summary: '서준경과 백승리가 함께 예비 발전기를 정비해 가동 효율을 소폭 회복시켰다.',
    stateChanges: [{ field: 'relationship:seo-jungyeong-baek-seungri', from: 'neutral', to: 'ally' }], importance: 'normal', relatedEventIds: [],
  },
  {
    id: 'evt-07', type: 'OBSERVATION', occurredAt: isoAt(2385), day: 2, placeId: 'control-room', agentIds: ['oh-sein'],
    title: '폐쇄 구역 B 방향에서 짧은 잡음 신호가 감지되었습니다.', summary: '오세인이 수신 장비에서 1초 미만의 잡음을 포착했다. 발신원은 특정되지 않았다.',
    stateChanges: [], importance: 'high', relatedEventIds: ['evt-03'],
  },
  {
    id: 'evt-08', type: 'INJURY', occurredAt: isoAt(2710), day: 2, placeId: 'living-quarters', agentIds: ['jeong-haram', 'im-haneul'],
    title: '정하람이 순찰 중 발목을 다쳤습니다.', summary: '계단에서 미끄러져 발목을 접질렸다. 임하늘이 응급 처치를 진행했다.',
    stateChanges: [{ field: 'agent:jeong-haram:status', from: 'alive', to: 'injured' }], importance: 'normal', relatedEventIds: [],
  },
  {
    id: 'evt-09', type: 'SYSTEM', occurredAt: isoAt(2879), day: 2, placeId: 'sector-b', agentIds: ['moon-gaon'],
    title: '문가온과 40시간째 연락이 닿지 않고 있습니다.', summary: '정기 연락 주기를 넘겨 실종 판정 기준이 적용되었다.',
    stateChanges: [{ field: 'agent:moon-gaon:status', from: 'alive', to: 'missing' }], importance: 'high', relatedEventIds: ['evt-03', 'evt-07'],
  },
  {
    id: 'evt-10', type: 'RESOURCE_CHANGE', occurredAt: isoAt(3360), day: 3, placeId: 'generator-room', agentIds: ['seo-jungyeong'],
    title: '예비 전력이 안전 기준 아래로 떨어졌습니다.', summary: '전력이 81%에서 63%로 감소하며 시설 위험도가 상승했다.',
    stateChanges: [
      { field: 'place:generator-room:power', from: '81%', to: '63%' },
      { field: 'world:dangerLevel', from: 'stable', to: 'tense' },
    ], importance: 'high', relatedEventIds: ['evt-04'],
  },
  {
    id: 'evt-11', type: 'MOVE', occurredAt: isoAt(3675), day: 3, placeId: 'sector-b', agentIds: ['baek-seungri'],
    title: '백승리가 폐쇄 구역 B의 봉쇄를 해제했습니다.', summary: '문가온 수색을 위해 비상 해제 코드로 구역 진입을 승인받았다.',
    stateChanges: [
      { field: 'place:sector-b:locked', from: 'true', to: 'false' },
      { field: 'agent:baek-seungri:location', from: 'living-quarters', to: 'sector-b' },
    ], importance: 'normal', relatedEventIds: ['evt-09'],
  },
  {
    id: 'evt-10b', type: 'RESOURCE_CHANGE', occurredAt: isoAt(3840), day: 3, placeId: 'generator-room', agentIds: ['seo-jungyeong'],
    title: '예비 전력이 다시 한 단계 낮아졌습니다.', summary: '전력이 63%에서 55%로 감소했다. 위험도가 한 단계 더 상승했다.',
    stateChanges: [
      { field: 'place:generator-room:power', from: '63%', to: '55%' },
      { field: 'world:dangerLevel', from: 'tense', to: 'unstable' },
    ], importance: 'high', relatedEventIds: ['evt-10'],
  },
  {
    id: 'evt-12', type: 'DISCOVERY', occurredAt: isoAt(4241), day: 3, placeId: 'sector-b', agentIds: ['baek-seungri'],
    title: '폐쇄 구역 B에서 사라졌던 무전기가 발견되었습니다.', summary: '백승리가 먼지 쌓인 선반 아래 통신 장비함 안에서, 사고 이후 행방이 묘연했던 무전기를 발견했다. 문가온의 행방은 여전히 확인되지 않았다.',
    stateChanges: [{ field: 'agent:baek-seungri:inventory', from: '-', to: '+무전기' }],
    importance: 'critical', relatedEventIds: ['evt-03', 'evt-07', 'evt-09'],
    beforeStateSummary: '폐쇄 구역 B는 오염 우려로 봉쇄되어 있었고 문가온의 행방은 40시간째 확인되지 않은 상태였다.',
    attemptedAction: '백승리가 구역 내부를 수색하며 통신 장비함 개방을 시도함.',
    engineVerdict: '구역 접근 조건(비상 해제 코드) 충족 확인 — 수색 판정 허용. 통신 장비함 내부 오브젝트 존재 확인 — 무전기 발견으로 판정.',
    afterStateSummary: '무전기 확보. 전원은 꺼져 있으며 마지막 통신 로그는 미확인 상태. 문가온의 행방은 여전히 불명.',
  },
  {
    id: 'evt-13', type: 'COOPERATION', occurredAt: isoAt(4244), day: 3, placeId: 'medical-bay', agentIds: ['baek-seungri', 'im-haneul'],
    title: '백승리가 발견한 무전기를 임하늘에게 전달했습니다.', summary: '점검이 필요하다고 판단해 의료실의 임하늘에게 무전기를 곧장 가져갔다.',
    stateChanges: [
      { field: 'agent:baek-seungri:location', from: 'sector-b', to: 'medical-bay' },
      { field: 'object:radio:holder', from: 'baek-seungri', to: 'im-haneul' },
    ], importance: 'normal', relatedEventIds: ['evt-12'],
  },
  {
    id: 'evt-14', type: 'OBSERVATION', occurredAt: isoAt(4248), day: 3, placeId: 'medical-bay', agentIds: ['im-haneul'],
    title: '발견된 무전기의 배터리 잔량이 확인되었습니다.', summary: '임하늘이 전원 버튼을 길게 누르자 희미한 잡음과 함께 표시등이 깜빡였다. 외관은 심하게 손상되었지만 완전히 죽지는 않았다.',
    stateChanges: [{ field: 'object:radio:battery', from: '불명', to: '12%' }], importance: 'normal', relatedEventIds: ['evt-12', 'evt-13'],
    publicQuote: '"한 번 정도는 송신할 수 있을 것 같아요." — 임하늘',
  },
  {
    id: 'evt-15', type: 'CONFLICT', occurredAt: isoAt(4255), day: 3, placeId: 'medical-bay', agentIds: ['han-doyun', 'na-yunjae', 'kang-taeo', 'im-haneul'],
    title: '무전기 사용 방식을 두고 복구팀과 이탈 준비파가 충돌했습니다.', summary: '복구팀은 무전기를 발전실로 옮겨 신중하게 사용 시점을 정하자고 했고, 이탈 준비파는 남은 배터리를 지금 구조 요청에 써야 한다고 맞섰다. 결론은 나지 않았다.',
    stateChanges: [
      { field: 'object:radio:location', from: 'medical-bay', to: 'generator-room' },
      { field: 'relationship:na-yunjae-han-doyun', from: 'wary', to: 'wary' },
    ],
    importance: 'high', relatedEventIds: ['evt-14', 'evt-05'],
  },
]

export const QUEUED_EVENTS: WorldEvent[] = [
  {
    id: 'evt-16', type: 'DECISION', occurredAt: '', day: 3, placeId: 'generator-room', agentIds: ['han-doyun'],
    title: '한도윤이 무전기 전원을 켤지 복구팀에 물었습니다.', summary: '발전실로 옮겨진 무전기를 두고, 배터리가 얼마 남지 않아 신중한 판단이 필요하다는 의견이 나왔다. 아직 결론은 나지 않았다.',
    stateChanges: [], importance: 'normal', relatedEventIds: ['evt-14', 'evt-15'],
  },
  {
    id: 'evt-17', type: 'DIALOGUE', occurredAt: '', day: 3, placeId: 'generator-room', agentIds: ['na-yunjae', 'han-doyun'],
    title: '나윤재가 무전기 사용에 신중론을 제기했습니다.', summary: '지금 전원을 켜면 배터리가 완전히 방전될 수 있다는 우려를 전달했다.',
    stateChanges: [], importance: 'normal', relatedEventIds: ['evt-16'],
    publicQuote: '"지금 켜면 그걸로 끝이에요. 한 번뿐인 기회일 수 있어요." — 나윤재',
  },
  {
    id: 'evt-18', type: 'RESOURCE_CHANGE', occurredAt: '', day: 3, placeId: 'generator-room', agentIds: ['seo-jungyeong'],
    title: '예비 전력이 계속 감소하고 있습니다.', summary: '전력이 55%에서 51%로 소폭 감소했다.',
    stateChanges: [{ field: 'place:generator-room:power', from: '55%', to: '51%' }], importance: 'normal', relatedEventIds: ['evt-10b'],
  },
]

export const CHAPTERS: Chapter[] = [
  {
    id: 'chr-day1', day: 1, title: '통신이 끊긴 아침',
    summary: '본토와의 정기 통신이 두절되며 하루가 시작되었다. 시설장 한도윤은 비상 프로토콜을 선언하고 복구팀을 결성했다. 같은 날 아침, 해양생물학자 문가온은 센서 점검을 위해 홀로 폐쇄 구역 B로 향했다.',
    agentIds: ['han-doyun', 'moon-gaon', 'seo-jungyeong'], changes: ['본토 통신 두절', '복구팀 결성', '문가온 폐쇄 구역 B 진입'],
    eventIds: ['evt-01', 'evt-02', 'evt-03', 'evt-04'],
  },
  {
    id: 'chr-day2', day: 2, title: '두 개의 목소리로 갈라지다',
    summary: '조기 탈출을 주장하는 이들과 통신 복구를 우선하려는 이들 사이에 언쟁이 벌어지며 이탈 준비파가 결성되었다. 발전실에서는 협력으로 작은 성과가 있었지만, 순찰 중 부상자가 발생했다. 밤이 되자 문가온의 실종이 공식화되었다.',
    agentIds: ['na-yunjae', 'kang-taeo', 'han-doyun', 'seo-jungyeong', 'baek-seungri', 'jeong-haram', 'moon-gaon'],
    changes: ['이탈 준비파 결성', '예비 발전기 정비', '정하람 부상', '문가온 실종 판정'],
    eventIds: ['evt-05', 'evt-06', 'evt-07', 'evt-08', 'evt-09'],
  },
  {
    id: 'chr-day3', day: 3, title: '폐쇄 구역 B의 무전기',
    summary: '예비 전력이 잇따라 감소하며 시설 위험도가 두 단계 상승했다. 백승리는 문가온을 찾기 위해 폐쇄 구역 B의 봉쇄를 해제했고, 그 안에서 사고 이후 행방이 묘연했던 무전기를 발견했다. 무전기는 임하늘에게 전달되어 점검을 마쳤지만, 이를 어떻게 쓸 것인가를 두고 복구팀과 이탈 준비파가 충돌했다. 문가온의 행방은 여전히 밝혀지지 않았다.',
    agentIds: ['seo-jungyeong', 'baek-seungri', 'moon-gaon', 'im-haneul', 'han-doyun', 'na-yunjae', 'kang-taeo'],
    changes: ['예비 전력 위험 수준 진입', '폐쇄 구역 B 봉쇄 해제', '분실된 무전기 발견', '무전기 사용 방식을 둘러싼 갈등'],
    eventIds: ['evt-10', 'evt-11', 'evt-10b', 'evt-12', 'evt-13', 'evt-14', 'evt-15'],
  },
]

// Baseline scenes — already fully narrated because every source WorldEvent has already occurred.
export const SCENES: ChronicleEntry[] = [
  {
    id: 'scene-comm-failure', seasonId: 'season-01-eden', worldDay: 1, timeStart: '06:00', timeEnd: '06:40',
    title: '마흔 번째 통신 실패',
    body:
      '그날 아침 여섯 시, 오로라의 통신실은 평소와 다르지 않았다. 오세인은 늘 그랬듯 본토와의 정기 교신을 시도했고, 신호는 세 번 연속으로 아무 대답도 데려오지 못했다.\n\n' +
      '처음에는 누구도 크게 동요하지 않았다. 이런 일은 전에도 있었고, 회선은 대개 반나절 안에 스스로 돌아오곤 했다. 다만 이번에는 옅은 잡음조차 없었다는 점이 마음에 걸렸다.\n\n' +
      '시설장 한도윤은 오전 회의를 소집하는 대신 비상 프로토콜을 선언했다. 통신·전력·의료·거주 구역을 맡을 인원을 정해 불렀고, 그날부로 이들은 \'복구팀\'이라는 이름으로 불리기 시작했다.\n\n' +
      '그로부터 사흘이 다 되어가도록, 오세인은 매 정시마다 같은 시도를 반복했다. 이 기록이 쓰이는 지금까지 그의 수첩에 적힌 실패 횟수는 이미 마흔을 넘어서 있었다 — 정확히 몇 번째인지는 그 자신도 세는 것을 그만둔 뒤였다.',
    locationIds: ['control-room'], agentIds: ['oh-sein', 'han-doyun'],
    sourceEventIds: ['evt-01', 'evt-02'],
    stateChanges: [{ field: 'place:control-room:comms', from: '100%', to: '0%' }, { field: 'faction:recovery-team', from: '없음', to: '결성됨' }],
    importance: 'notable', createdAt: isoAt(400),
  },
  {
    id: 'scene-two-voices', seasonId: 'season-01-eden', worldDay: 2, timeStart: '09:20', timeEnd: '21:10',
    title: '두 개의 목소리',
    body:
      '통신이 끊긴 지 만 하루가 넘어가면서, 생활 구역의 공기는 눈에 띄게 달라졌다. 아침 식사 자리에서 나윤재가 먼저 입을 열었다. "언제 돌아올지도 모르는 신호를 기다리기만 할 순 없어요."\n\n' +
      '강태오가 그 말에 동의했다. 두 사람은 예비 잠수정을 이용한 자체 이탈을 준비하자고 제안했지만, 한도윤은 통신 복구가 먼저라며 선을 그었다. 언쟁은 결론 없이 끝났지만, 그 자리에서 나윤재와 강태오를 중심으로 한 무리가 스스로를 \'이탈 준비파\'라 부르기 시작했다. 시설 안에는 이제 두 개의 목소리가 분명하게 존재했다.\n\n' +
      '같은 날 오전, 발전실에서는 조용한 진전이 있었다. 서준경과 백승리가 함께 예비 발전기를 점검해 가동 효율을 소폭 끌어올렸다. 두 사람 사이에는 별다른 말 없이도 손발이 맞는 신뢰가 쌓이고 있었다.\n\n' +
      '밤이 깊어갈 무렵에는 작은 사고도 있었다. 순찰을 돌던 정하람이 계단에서 발을 헛디뎌 발목을 다쳤고, 임하늘이 서둘러 응급 처치를 했다. 심각한 부상은 아니었지만, 그날 밤 오로라의 사람들은 저마다 다른 이유로 잠을 설쳤다.',
    locationIds: ['living-quarters', 'generator-room'], agentIds: ['na-yunjae', 'kang-taeo', 'han-doyun', 'seo-jungyeong', 'baek-seungri', 'jeong-haram', 'im-haneul'],
    sourceEventIds: ['evt-05', 'evt-06', 'evt-08'],
    stateChanges: [{ field: 'faction:departure-faction', from: '없음', to: '결성됨' }, { field: 'agent:jeong-haram:status', from: 'alive', to: 'injured' }],
    importance: 'notable', createdAt: isoAt(2710),
  },
  {
    id: 'scene-fading-power', seasonId: 'season-01-eden', worldDay: 3, timeStart: '21:00', timeEnd: '16:00',
    title: '꺼져가는 예비 전력',
    body:
      '첫날 밤, 발전실의 계기판은 92퍼센트에서 81퍼센트로 조용히 떨어졌다. 난방을 가동한 대가였고, 서준경은 그 정도는 예상된 범위라고 여겼다.\n\n' +
      '문제는 셋째 날 아침에 드러났다. 예비 전력은 81퍼센트에서 63퍼센트로, 안전 기준으로 여겨지던 선 아래까지 내려가 있었다. 서준경은 발전기 앞에서 한참을 서 있다가, 결국 이 수치를 시설 전체의 위험 신호로 보고했다.\n\n' +
      '오후가 되자 수치는 다시 55퍼센트로 내려앉았다. 하루 사이에 두 단계나 낮아진 셈이었다. 발전실의 낡은 배전반은 예전보다 조금 더 크게 웅웅거렸고, 그 소리를 들을 때마다 사람들은 말없이 서로의 얼굴을 살폈다.\n\n' +
      '아직 시설이 완전히 어두워지기까지는 시간이 남아 있었다. 하지만 그 시간이 얼마나 남았는지는, 이제 누구도 자신 있게 말하지 못했다.',
    locationIds: ['generator-room'], agentIds: ['seo-jungyeong'],
    sourceEventIds: ['evt-04', 'evt-10', 'evt-10b'],
    stateChanges: [{ field: 'place:generator-room:power', from: '92%', to: '55%' }, { field: 'world:dangerLevel', from: 'stable', to: 'unstable' }],
    importance: 'notable', createdAt: isoAt(3840),
  },
  {
    id: 'scene-the-radio', seasonId: 'season-01-eden', worldDay: 3, timeStart: '07:10', timeEnd: '22:55',
    title: '폐쇄 구역의 무전기',
    body:
      '첫째 날 아침, 해양생물학자 문가온은 홀로 폐쇄 구역 B로 향했다. 오염 우려로 오래전 봉쇄된 곳이었지만, 정기 해양 센서 점검을 위해서는 잠깐의 진입 허가만으로 충분했다. 그것이 그녀를 마지막으로 본 순간이 될 줄은 아무도 몰랐다.\n\n' +
      '이튿날 오후, 통신 담당 오세인은 수신 장비에서 낯선 잡음을 포착했다. 폐쇄 구역 B 방향에서 온 것으로 보였지만, 1초도 채 되지 않는 짧은 신호였고 발신원은 특정할 수 없었다. 보고는 기록되었지만 당장 할 수 있는 일은 없었다.\n\n' +
      '정기 연락 주기를 훌쩍 넘긴 밤, 문가온의 실종은 마침내 공식적인 기준을 충족했다. 연락이 끊긴 지 마흔 시간째였다. 그녀의 이름 옆에는 \'실종\'이라는 짧은 표기가 더해졌다.\n\n' +
      '셋째 날, 보안팀장 백승리는 더는 기다릴 수 없다고 판단했다. 비상 해제 코드를 받아 폐쇄 구역 B의 문을 열었고, 먼지 쌓인 선반 사이를 하나씩 살피기 시작했다. 야간 점검을 시작한 지 스무 분 남짓 지났을 때, 그는 구석의 통신 장비함 안에서 낯익은 물건 하나를 발견했다 — 사고 이후 행방이 묘연했던 무전기였다.\n\n' +
      '백승리는 무전기를 곧장 의료실의 임하늘에게 가져갔다. 외관은 심하게 긁히고 찌그러져 있었지만, 완전히 죽은 것 같지는 않았다. 임하늘이 전원 버튼을 길게 누르자 희미한 잡음과 함께 표시등이 깜빡였다.\n\n' +
      '"한 번 정도는 송신할 수 있을 것 같아요." 임하늘이 말했다. 다만 남아 있는 배터리는 많지 않았다. 몇 번이고 켰다 끄기를 반복할 여유는 없어 보였다.\n\n' +
      '소식은 곧 시설 전체에 퍼졌다. 그날 밤, 한도윤을 비롯한 복구팀은 무전기를 발전실로 옮겨 신중하게 사용 시점을 정하자고 했다. 반면 나윤재와 강태오를 비롯한 이탈 준비파는 지금 당장, 남은 배터리를 구조 요청에 써야 한다고 맞섰다.\n\n' +
      '누구의 주장이 옳은지는 아직 아무도 확신하지 못했다. 다만 작은 무전기 하나가, 통신이 끊긴 뒤 간신히 버티고 있던 두 집단 사이의 신뢰를 다시 한번 시험대에 올려놓았다는 사실만은 분명했다.',
    locationIds: ['sector-b', 'medical-bay', 'generator-room'], agentIds: ['moon-gaon', 'oh-sein', 'baek-seungri', 'im-haneul', 'han-doyun', 'na-yunjae', 'kang-taeo'],
    sourceEventIds: ['evt-03', 'evt-07', 'evt-09', 'evt-11', 'evt-12', 'evt-13', 'evt-14', 'evt-15'],
    stateChanges: [
      { field: 'place:sector-b:locked', from: 'true', to: 'false' },
      { field: 'agent:moon-gaon:status', from: 'alive', to: 'missing' },
      { field: 'object:radio:location', from: 'medical-bay', to: 'generator-room' },
    ],
    importance: 'major', createdAt: isoAt(4255),
  },
]

// Not narrated yet — this scene is only emitted once every event in requiredEventIds has actually
// fired (see server/domain/worldStore.ts). Until then it does not exist for readers.
export interface QueuedSceneDefinition {
  scene: Omit<ChronicleEntry, 'timeStart' | 'timeEnd' | 'worldDay' | 'createdAt'>
  requiredEventIds: string[]
}

export const QUEUED_SCENES: QueuedSceneDefinition[] = [
  {
    requiredEventIds: ['evt-16', 'evt-17', 'evt-18'],
    scene: {
      id: 'scene-silence', seasonId: 'season-01-eden',
      title: '침묵 속의 결정',
      body:
        '무전기는 발전실 한쪽에 조용히 놓여 있었다. 전원은 꺼진 채였다. 한도윤은 복구팀을 불러 모아 지금 이것을 켤지, 아니면 상황이 조금 더 명확해질 때까지 기다릴지를 물었다.\n\n' +
        '누구도 선뜻 답하지 못했다. 배터리는 이미 넉넉하지 않았고, 실패하면 다시 기회가 오지 않을 수도 있었다.\n\n' +
        '나윤재가 침묵을 깼다. "지금 켜면 그걸로 끝이에요. 한 번뿐인 기회일 수 있어요." 그의 목소리에는 이탈 준비파 특유의 조급함과, 그만큼의 확신이 함께 담겨 있었다.\n\n' +
        '결정은 그날 밤에도 내려지지 않았다. 발전실의 계기판은 그사이 51퍼센트까지 내려앉았고, 시간은 어느 쪽 편도 들어주지 않은 채 그저 흘러가고 있었다.',
      locationIds: ['generator-room'], agentIds: ['han-doyun', 'na-yunjae', 'seo-jungyeong'],
      sourceEventIds: ['evt-16', 'evt-17', 'evt-18'],
      stateChanges: [{ field: 'place:generator-room:power', from: '55%', to: '51%' }],
      importance: 'notable',
    },
  },
]

export const ARCHIVED_SEASONS: Season[] = [
  {
    id: 'season-00-lantern', name: 'PROJECT LANTERN', premise: '정전된 지하 대피소에서 12명이 72시간을 보낸 첫 번째 시즌.',
    status: 'ENDED', startedAt: new Date(BOOT_TIME - 30 * 24 * 60 * 60 * 1000).toISOString(), endedAt: new Date(BOOT_TIME - 27 * 24 * 60 * 60 * 1000).toISOString(),
    currentDay: 3, agentCount: 12, survivorCount: 10,
    biggestEventTitle: '지하 3층 비상 발전기 가동 성공', finalStateSummary: '전력이 복구되며 대피소 전 구역이 재가동된 상태로 종료됨.',
    seasonSummary: '초기 정전으로 시작된 혼란 속에서 두 세력이 발전기 복구를 두고 경쟁하다, 마지막 날 예상 밖의 협력으로 복구에 성공한 시즌.',
  },
]

export function buildInitialSeason(): Season {
  return {
    id: 'season-01-eden', name: 'PROJECT EDEN', premise: '통신이 끊긴 해상 연구시설 오로라에서 눈을 뜬 10명의 이야기.',
    status: 'RUNNING', startedAt: isoAt(0), endedAt: null, currentDay: 3,
    agentCount: AGENTS.length, survivorCount: AGENTS.filter(a => a.publicState.status !== 'deceased').length,
    biggestEventTitle: '폐쇄 구역 B에서 사라졌던 무전기가 발견되었습니다.',
  }
}

export function buildInitialWorldState(): WorldState {
  return {
    seasonId: 'season-01-eden',
    clock: { day: 3, time: '22:55', timeOfDay: 'night', weather: 'fog', temperatureC: 14 },
    dangerLevel: 'unstable',
    places: structuredClone(PLACES),
    agents: structuredClone(AGENTS),
    factions: structuredClone(FACTIONS),
    activeEventIds: ['evt-15'],
    updatedAt: isoAt(DAY_ANCHOR_MINUTES),
  }
}

export function buildBaselineEvents(): WorldEvent[] {
  return structuredClone(BASELINE_EVENTS)
}

export function buildQueuedEvents(): WorldEvent[] {
  return structuredClone(QUEUED_EVENTS)
}

export function buildChapters(): Chapter[] {
  return structuredClone(CHAPTERS)
}

export function buildScenes(): ChronicleEntry[] {
  return structuredClone(SCENES)
}

export function buildQueuedScenes(): QueuedSceneDefinition[] {
  return structuredClone(QUEUED_SCENES)
}

export function buildArchivedSeasons(): Season[] {
  return structuredClone(ARCHIVED_SEASONS)
}
