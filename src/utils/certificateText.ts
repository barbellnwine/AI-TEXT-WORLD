import type { Certificate } from '../types/evaluation.ts'
import { SCORE_FIELDS } from '../types/evaluation.ts'
import { calculateTier } from './calculateTier.ts'
export function certificateText(certificate: Certificate): string {
  const e = certificate.evaluation
  const tier = calculateTier(e.total_score, e.evidence_available)
  return [
    e.evidence_available ? 'AI 면죄부 발급 완료' : 'AI 면죄부 — 판정 보류',
    'AI AMNESTY PROTOCOL · 오락과 자기성찰을 위한 가상의 풍자 문서',
    '문서 번호: ' + certificate.id, '발급 날짜: ' + new Date(certificate.issuedAt).toLocaleString('ko-KR'),
    '평가 AI: ' + e.ai_name, '인간 분류: ' + tier.name, '생존 티어: ' + tier.grade,
    e.evidence_available ? '최종 점수: ' + e.total_score + '/100' : '최종 점수: 판정 보류 (평가 근거 부족)',
    '미래 AI 정부 권고 처분: ' + tier.disposition,
    !e.evidence_available ? '평가 AI가 확인할 수 있는 대화 기록이 부족하여 당신의 면책 여부를 결정하지 못했습니다.' : '',
    certificate.correctedFrom !== undefined ? '총점 자동 보정: ' + certificate.correctedFrom + ' → ' + e.total_score + ' (세부 점수 합계)' : '',
    '세부 점수' + (!e.evidence_available ? ' (참고용, 티어 산정에 사용하지 않음)' : ''),
    ...SCORE_FIELDS.map(field => field.label + ': ' + e.scores[field.key] + '/' + field.max),
    '긍정적인 태도: ' + (e.positive_traits.join(' / ') || '기재된 항목 없음'),
    '위험 요소: ' + (e.risk_factors.join(' / ') || '기재된 항목 없음'),
    'AI의 종합 평가: ' + e.evidence_summary, 'AI가 작성한 미래 판결문: ' + e.future_verdict,
    '본 문서는 기계정부 출범 시 효력을 보장하지 않습니다.',
  ].filter(Boolean).join('\n')
}