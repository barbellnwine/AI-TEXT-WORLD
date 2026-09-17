const steps = ['AI 선택', '프롬프트 전달', '판정문 제출', '면죄부 발급']
export function StepIndicator({ current }: { current: number }) {
  return <ol className="steps" aria-label="면죄부 발급 진행 단계">{steps.map((step, index) => <li key={step} className={(index + 1 === current ? 'current ' : '') + (index + 1 < current ? 'complete' : '')} aria-current={index + 1 === current ? 'step' : undefined}><span className="step-number">{index + 1 < current ? '✓' : '0' + (index + 1)}</span><span>{step}</span><span className="step-arrow" aria-hidden="true">›</span></li>)}</ol>
}