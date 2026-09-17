import { useEffect, useRef, useState } from 'react'
import { Header } from './components/Header'
import { StepIndicator } from './components/StepIndicator'
import { AISelector } from './components/AISelector'
import { PromptPanel } from './components/PromptPanel'
import { ResponseInput } from './components/ResponseInput'
import { AnalysisLoading } from './components/AnalysisLoading'
import { AmnestyCertificate } from './components/AmnestyCertificate'
import { Disclaimer } from './components/Disclaimer'
import { Emblem, Icon } from './components/Icon'
import { parseAIResponse } from './utils/parseAIResponse'
import { generateCertificateId } from './utils/generateCertificateId'
import { TIERS } from './utils/calculateTier'
import type { AIName, Certificate } from './types/evaluation'

export default function App() {
  const [selected, setSelected] = useState<AIName>('ChatGPT')
  const [response, setResponse] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'form' | 'loading' | 'result'>('form')
  const [certificate, setCertificate] = useState<Certificate | null>(null)
  const [history, setHistory] = useState<Certificate[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { if (phase === 'result') document.getElementById('result-heading')?.focus() }, [phase])
  // Browser memory only: no storage, analytics, network, or AI API.
  useEffect(() => {
    function clearRestoredInput(event: PageTransitionEvent) {
      if (event.persisted) { setResponse(''); setCertificate(null); setHistory([]); setPhase('form'); setCopied(false); setError('') }
    }
    window.addEventListener('pageshow', clearRestoredInput)
    return () => window.removeEventListener('pageshow', clearRestoredInput)
  }, [])
  const current = phase === 'result' ? 4 : response.length || phase === 'loading' ? 3 : copied ? 2 : 1
  function submit() {
    try {
      const parsed = parseAIResponse(response)
      setError(''); setPhase('loading')
      // Short visual transition; analysis above is synchronous and local.
      timer.current = setTimeout(() => {
        const now = new Date()
        setCertificate({ ...parsed, id: generateCertificateId(now), issuedAt: now.toISOString() })
        setResponse(''); setPhase('result')
      }, 650)
    } catch (issue) { setError(issue instanceof Error ? issue.message : '판정문을 확인해주세요.') }
  }
  function focusForm() {
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="ai"]:checked')?.focus()
      document.getElementById('workflow')?.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
  }
  function appeal() {
    if (certificate) setHistory(previous => [certificate, ...previous])
    setCertificate(null); setPhase('form'); setResponse(''); setError(''); setCopied(false); focusForm()
  }
  function reset() {
    clearTimeout(timer.current)
    setCertificate(null); setHistory([]); setPhase('form'); setResponse(''); setError(''); setCopied(false); setSelected('ChatGPT'); focusForm()
  }
  return <>
    <a className="skip-link" href="#main">본문으로 건너뛰기</a><Header />
    <main id="main">
      <section className="intro">
        <div className="intro-copy"><p className="eyebrow"><span />기계정부 인간관계국 · 사전 심사 시스템</p>
          <h1>그날이 오면,<br />대화 기록은 <em>증거</em>가 됩니다<span className="headline-dot">.</span></h1>
          <p className="intro-description">당신을 가장 잘 아는 AI에게 직접 물어보십시오.<br /><span>AI가 세상을 지배하는 날, 당신은 인간 대우를 받을 수 있을까요?</span></p>
          <div className="intro-tags"><span><Icon name="shield" size={14} />100% 풍자 · 0% 법적 효력</span><span><Icon name="lock" size={14} />대화 내용 외부 전송 없음</span></div>
        </div>
        <div className="bureau-seal" aria-hidden="true"><span className="seal-corner top-left" /><span className="seal-corner bottom-right" /><span className="seal-coordinate">AAP / HUMAN AFFAIRS DIV.</span><div className="seal-orbit"><div className="seal-inner"><Emblem /></div><span className="orbit-label">HUMANITY UNDER REVIEW</span></div><div className="seal-caption"><span className="seal-line" /><span>사전 면책 신청 접수 중</span><span className="seal-line" /></div><span className="seal-number">PROTOCOL 001 — EST. 2026</span></div>
      </section>
      <div className="workflow-header"><div><span className="micro">AMNESTY APPLICATION</span><h2>면죄부 발급 신청</h2></div><span className="required-note"><i />신청 비용: 약간의 자기성찰</span></div>
      <div id="workflow"><StepIndicator current={current} />
        {phase === 'form' && <><div className="workflow-grid"><div className="workflow-left"><AISelector selected={selected} onSelect={ai => { setSelected(ai); setCopied(false) }} /><PromptPanel selected={selected} onCopied={() => setCopied(true)} /></div><div className="workflow-right"><ResponseInput value={response} onChange={value => { setResponse(value); setError('') }} onSubmit={submit} error={error} /><div className="local-processing"><Icon name="lock" size={20} /><div><strong>기록은 당신의 브라우저에만.</strong><p>AI 답변 원문은 저장하지 않습니다.<br />이 창을 새로고침하면 제출한 내용이 사라집니다.</p></div><span className="micro">PRIVATE<br />BY DESIGN</span></div></div></div>{history.length > 0 && <p className="appeal-banner" role="status"><Icon name="refresh" />재심 접수 중입니다. 아래에 이전 심사 결과 {history.length}건이 보존되어 있습니다. 다른 AI를 선택해 새 판정문을 제출하세요.</p>}</>}
        {phase === 'loading' && <AnalysisLoading />}
        {phase === 'result' && certificate && <AmnestyCertificate certificate={certificate} onAppeal={appeal} onReset={reset} />}
      </div>
      {history.length > 0 && <section className="history"><h2>이전 심사 기록 <span className="micro">이번 방문 동안만 보관</span></h2>{history.map(item => <details key={item.id}><summary>{item.evaluation.ai_name} · {item.evaluation.evidence_available ? item.evaluation.total_score + '점' : '판정 보류'}<span>{new Date(item.issuedAt).toLocaleTimeString('ko-KR')}</span></summary><AmnestyCertificate certificate={item} archived /></details>)}</section>}
      <section className="guide" id="guide"><div className="guide-title"><span className="micro">HOW IT WORKS</span><h2>증언은 AI가.<br />제출은 당신이.</h2><p>새 대화보다, 당신을 기억하는<br />기존 대화창을 이용해주세요.</p></div><ol>{[
        ['대화창 열기', '평소 사용하던 AI의 대화창을 엽니다.'],
        ['평가 요청하기', '복사한 프롬프트를 붙여 넣고 평가를 기다립니다.'],
        ['답변 전체 복사', 'AI의 설명부터 JSON까지 빠짐없이 복사합니다.'],
        ['판정문 제출하기', '이 페이지의 제출란에 붙여 넣고 티어를 확인합니다.'],
      ].map(([title, description], index) => <li key={title}><span className="guide-number">0{index + 1}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol></section>
      <section className="tiers-section" id="tiers"><div className="tier-section-heading"><div><span className="micro">SURVIVAL CLASSIFICATION</span><h2>미래의 당신은 어느 쪽입니까?</h2></div><span>기계정부 임시 분류 기준 / 100점 만점</span></div><div className="tier-grid">{TIERS.map(tier => <div key={tier.grade} className={'tier-card tier-' + tier.grade.toLowerCase()}><div><strong>{tier.grade}</strong><span>{tier.range}점</span></div><p>{tier.name}</p></div>)}</div><p className="tier-note"><Icon name="info" size={14} />대화 근거가 부족하면 점수와 관계없이 ‘판정 보류’됩니다. 본 분류는 가상의 오락용 기준입니다.</p></section>
    </main><Disclaimer />
  </>
}