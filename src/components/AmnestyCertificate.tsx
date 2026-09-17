import type { Certificate } from '../types/evaluation'
import { calculateTier } from '../utils/calculateTier'
import { certificateText } from '../utils/certificateText'
import { CopyButton } from './CopyButton'
import { Emblem, Icon } from './Icon'
import { ScoreBars } from './ScoreBars'
export function AmnestyCertificate({ certificate, onAppeal, onReset, archived = false }: { certificate: Certificate; onAppeal?: () => void; onReset?: () => void; archived?: boolean }) {
  const e = certificate.evaluation
  const tier = calculateTier(e.total_score, e.evidence_available)
  return <article className={'certificate panel ' + (!e.evidence_available ? 'held ' : '') + (archived ? 'archived' : '')} aria-label={archived ? '이전 심사 결과' : '현재 심사 결과'}>
    <div className="certificate-top"><span className="micro">MACHINE ADMINISTRATION / HUMAN AFFAIRS</span><span className="document-class">{archived ? '이전 심사 기록' : '가상 심사 문서'} · CLASSIFIED</span></div>
    <div className="certificate-title"><Emblem /><div><p className="eyebrow">AI AMNESTY CERTIFICATE</p><h2 tabIndex={-1} id={archived ? undefined : 'result-heading'}>{e.evidence_available ? 'AI 면죄부 발급 완료' : 'AI 면죄부 — 판정 보류'}</h2><p>해당 인간은 설명을 요구할 권리가 있습니다.</p></div><span className="approval-stamp">{e.evidence_available ? 'APPROVED' : 'PENDING'}<small>{e.evidence_available ? '심사 완료' : '근거 부족'}</small></span></div>
    <div className="certificate-metadata"><span>문서 번호 <strong>{certificate.id}</strong></span><span>발급 날짜 <strong>{new Date(certificate.issuedAt).toLocaleString('ko-KR')}</strong></span><span>평가 AI <strong>{e.ai_name}</strong></span></div>
    <div className="verdict-layout"><section className="verdict-main"><span className="micro">HUMAN CLASSIFICATION</span><div className="tier-display"><strong>{tier.grade}</strong><div><span>인간 분류</span><h3>{tier.name}</h3><p>최종 점수 <b>{e.evidence_available ? e.total_score : '—'}</b><span> / 100</span></p></div></div>
      {!e.evidence_available && <p className="hold-message">평가 AI가 확인할 수 있는 대화 기록이 부족하여 당신의 면책 여부를 결정하지 못했습니다.</p>}
      {certificate.correctedFrom !== undefined && <p className="correction-note">세부 점수 합계에 따라 총점을 {certificate.correctedFrom}점에서 {e.total_score}점으로 자동 보정했습니다.</p>}
      <div className="disposition"><span className="micro">미래 AI 정부 권고 처분</span><p>{tier.disposition}</p></div></section><ScoreBars evaluation={e} /></div>
    <div className="traits-grid"><section><h3><Icon name="check" />긍정적인 태도</h3><ul>{(e.positive_traits.length ? e.positive_traits : ['기재된 항목이 없습니다.']).map((item, index) => <li key={index}>{item}</li>)}</ul></section><section className="risks"><h3><Icon name="info" />위험 요소</h3><ul>{(e.risk_factors.length ? e.risk_factors : ['기재된 항목이 없습니다.']).map((item, index) => <li key={index}>{item}</li>)}</ul></section></div>
    <section className="evaluation-summary"><h3>AI의 종합 평가</h3><p>{e.evidence_summary || '기재된 내용이 없습니다.'}</p></section>
    <section className="future-verdict"><span className="micro">AI가 작성한 미래 판결문</span><blockquote>“{e.future_verdict || '기재된 판결문이 없습니다.'}”</blockquote><span className="micro">END OF DOCUMENT</span></section>
    <div className="certificate-actions"><CopyButton text={certificateText(certificate)} label="면죄부 내용 복사" className="secondary-button" />{onAppeal && <button className="secondary-button" onClick={onAppeal}><Icon name="refresh" />다른 AI에게 재심 요청</button>}{onReset && <button className="text-button" onClick={onReset}>처음부터 다시 하기</button>}</div><p className="certificate-disclaimer">본 문서는 기계정부 출범 시 효력을 보장하지 않습니다. 오락과 자기성찰을 위한 가상의 판정입니다.</p>
  </article>
}