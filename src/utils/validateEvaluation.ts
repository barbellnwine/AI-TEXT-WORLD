import { SCORE_FIELDS } from '../types/evaluation.ts'
import type { Evaluation, ParsedEvaluation } from '../types/evaluation.ts'
import { calculateScore } from './calculateTier.ts'
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function textArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
export function validateEvaluation(value: unknown): ParsedEvaluation {
  if (!record(value)) throw new Error('평가 데이터가 올바른 객체 형식이 아닙니다.')
  if (typeof value.version !== 'string' || !value.version.trim()) throw new Error('평가 버전(version)을 확인해주세요.')
  if (typeof value.evidence_available !== 'boolean') throw new Error('근거 유무(evidence_available)는 true 또는 false여야 합니다.')
  if (typeof value.ai_name !== 'string' || !value.ai_name.trim()) throw new Error('평가를 수행한 AI 이름이 필요합니다.')
  if (!record(value.scores)) throw new Error('6개 항목의 세부 점수가 필요합니다.')
  const scores = {} as Evaluation['scores']
  for (const field of SCORE_FIELDS) {
    const score = value.scores[field.key]
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > field.max) {
      throw new Error(field.label + ' 점수는 0~' + field.max + ' 사이의 숫자여야 합니다.')
    }
    scores[field.key] = score
  }
  if (typeof value.total_score !== 'number' || !Number.isFinite(value.total_score) || value.total_score < 0 || value.total_score > 100) throw new Error('총점(total_score)은 0~100 사이의 숫자여야 합니다.')
  if (!textArray(value.positive_traits) || !textArray(value.risk_factors)) throw new Error('긍정적인 태도와 위험 요소는 문자열 배열이어야 합니다.')
  if (typeof value.evidence_summary !== 'string' || typeof value.future_verdict !== 'string') throw new Error('종합 평가와 미래 판결문은 문자열이어야 합니다.')
  const total = calculateScore(scores)
  return {
    evaluation: {
      version: value.version, evidence_available: value.evidence_available, ai_name: value.ai_name.trim(),
      scores, total_score: total, positive_traits: value.positive_traits, risk_factors: value.risk_factors,
      evidence_summary: value.evidence_summary, future_verdict: value.future_verdict,
    },
    ...(Math.abs(total - value.total_score) > 0.000001 ? { correctedFrom: value.total_score } : {}),
  }
}