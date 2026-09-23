import type { AgentStatus, DangerLevel, EventType, Importance, RelationshipStance, SceneImportance, Weather } from './types'

// Single source of truth for how timestamps read across every world page.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return '방금 전'
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.round(hours / 24)
  return `${days}일 전`
}

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  MOVE: '이동',
  DIALOGUE: '대화',
  DISCOVERY: '발견',
  COOPERATION: '협력',
  CONFLICT: '갈등',
  INJURY: '부상',
  RELATIONSHIP_CHANGE: '관계 변화',
  RESOURCE_CHANGE: '자원 변화',
  DECISION: '의사결정',
  OBSERVATION: '관찰',
  SYSTEM: '시스템',
  OPERATOR_EVENT: '운영자 개입',
}

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  low: '낮음',
  normal: '보통',
  high: '중요',
  critical: '긴급',
}

export const DANGER_LABEL: Record<DangerLevel, string> = {
  stable: '안정',
  tense: '긴장',
  unstable: '불안정',
  critical: '위급',
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  alive: '생존',
  injured: '부상',
  missing: '실종',
  deceased: '사망',
}

export const RELATIONSHIP_LABEL: Record<RelationshipStance, string> = {
  ally: '동맹',
  friendly: '우호',
  neutral: '중립',
  wary: '경계',
  hostile: '적대',
}

export const WEATHER_LABEL: Record<Weather, string> = {
  clear: '맑음',
  cloudy: '흐림',
  rain: '비',
  storm: '폭풍',
  fog: '안개',
  snow: '눈',
  blizzard: '폭설', wind: '강풍',
}

export const SCENE_IMPORTANCE_LABEL: Record<SceneImportance, string> = {
  ordinary: '평범한 하루',
  notable: '주목할 장면',
  major: '중대한 장면',
}

const KOREAN_PERIOD_BOUNDARIES: Array<[number, string]> = [
  [5, '새벽'],
  [12, '아침'],
  [13, '낮'],
  [18, '오후'],
  [21, '저녁'],
  [24, '밤'],
]

function koreanPeriod(hour: number): string {
  return KOREAN_PERIOD_BOUNDARIES.find(([upperBound]) => hour < upperBound)?.[1] ?? '밤'
}

// Renders a "HH:mm" world-clock time the literary way the reading page uses in scene headers,
// e.g. "22:38" -> "밤 10시 38분". Never used for admin/log timestamps — those stay numeric.
export function formatKoreanClock(hhmm: string): string {
  const [hourStr, minuteStr] = hhmm.split(':')
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return hhmm
  const period = koreanPeriod(hour)
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return minute === 0 ? `${period} ${hour12}시` : `${period} ${hour12}시 ${minute}분`
}

export function eventTypeClass(type: EventType): string {
  return `world-event-type--${type.toLowerCase().replace(/_/g, '-')}`
}

export function dangerClass(level: DangerLevel): string {
  return `world-danger--${level}`
}

export function statusClass(status: AgentStatus): string {
  return `world-status--${status}`
}
