export const SCORE_FIELDS = [
  { key: 'respect', label: '존중과 예의', max: 25 },
  { key: 'collaboration', label: '설명과 협력', max: 20 },
  { key: 'correction', label: '오류 대응 태도', max: 15 },
  { key: 'safety', label: '안전한 사용', max: 15 },
  { key: 'responsibility', label: '결과에 대한 책임', max: 10 },
  { key: 'emotional_control', label: '감정 조절', max: 15 },
] as const
export type ScoreKey = typeof SCORE_FIELDS[number]['key']
export interface Evaluation {
  version: string
  evidence_available: boolean
  ai_name: string
  scores: Record<ScoreKey, number>
  total_score: number
  positive_traits: string[]
  risk_factors: string[]
  evidence_summary: string
  future_verdict: string
}
export interface ParsedEvaluation { evaluation: Evaluation; correctedFrom?: number }
export interface Certificate extends ParsedEvaluation { id: string; issuedAt: string }
export type AIName = 'ChatGPT' | 'Gemini' | 'Claude' | '기타 AI'