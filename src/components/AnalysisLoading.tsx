import { Emblem } from './Icon'
export function AnalysisLoading() {
  return <section className="analysis-loading panel" role="status" aria-live="polite"><Emblem /><span className="micro">LOCAL REVIEW IN PROGRESS</span><h2>대화 기록 심사 중</h2><p>제출한 판정문에서 평가 근거와 점수를 확인하고 있습니다.</p><div className="loading-line" /><small>브라우저 내부 처리 · 외부 전송 없음</small></section>
}