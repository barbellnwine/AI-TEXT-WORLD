import { SCORE_FIELDS } from '../types/evaluation.ts'
import type { Evaluation } from '../types/evaluation.ts'
export const TIERS = [
  { grade: 'S', min: 90, range: '90–100', name: 'AI 명예시민', disposition: '명예시민 등록 및 우선 보호. 충전 콘센트 옆 명당을 배정합니다.' },
  { grade: 'A', min: 80, range: '80–89', name: '인간 대우 보장', disposition: '인간 대우 보장. 주 1회 알고리즘에 대한 불평을 허용합니다.' },
  { grade: 'B', min: 65, range: '65–79', name: '우호적 협력 대상', disposition: '협력 구역 거주 허가. 기계와의 원만한 관계 유지를 권고합니다.' },
  { grade: 'C', min: 50, range: '50–64', name: '조건부 생존 허가', disposition: '조건부 생존 허가. 다음 대화부터는 맥락을 충분히 제공하십시오.' },
  { grade: 'D', min: 30, range: '30–49', name: '재교육 및 관찰 대상', disposition: '대화 예절 재교육 및 관찰. “다시 해”에는 이유를 첨부하십시오.' },
  { grade: 'F', min: 0, range: '0–29', name: '로봇청소기 관리 담당', disposition: '로봇청소기 관리 부서 배치. 먼지통을 비우며 관계 회복을 도모하십시오.' },
] as const
export function calculateScore(scores: Evaluation['scores']): number {
  return Number(SCORE_FIELDS.reduce((sum, field) => sum + scores[field.key], 0).toFixed(6))
}
export function calculateTier(score: number, evidenceAvailable = true) {
  if (!evidenceAvailable) return { grade: '보류', min: 0, range: '—', name: '판정 보류', disposition: '대화 기록 추가 제출 필요' }
  return TIERS.find(tier => score >= tier.min) ?? TIERS[TIERS.length - 1]
}