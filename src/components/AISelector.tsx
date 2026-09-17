import type { AIName } from '../types/evaluation'
import { Icon } from './Icon'
export const AI_OPTIONS: { name: AIName; symbol: string; hint: string; url?: string; className: string }[] = [
  { name: 'ChatGPT', symbol: '✳', hint: '평소 사용하던 ChatGPT 대화창에서 실행하세요.', url: 'https://chatgpt.com/', className: 'chatgpt' },
  { name: 'Gemini', symbol: '✦', hint: '대화 기록이나 사용자 정보를 확인할 수 있는 Gemini 대화창에서 실행하세요.', url: 'https://gemini.google.com/', className: 'gemini' },
  { name: 'Claude', symbol: '✺', hint: '이전 대화 맥락이 남아 있는 Claude 대화창에서 실행하세요.', url: 'https://claude.ai/', className: 'claude' },
  { name: '기타 AI', symbol: '⌘', hint: '사용자와의 이전 대화를 확인할 수 있는 AI에서 실행하세요.', className: 'other' },
]
export function AISelector({ selected, onSelect }: { selected: AIName; onSelect: (ai: AIName) => void }) {
  const option = AI_OPTIONS.find(ai => ai.name === selected)!
  return <section className="panel selector-panel" aria-labelledby="ai-heading"><div className="section-heading"><span className="section-no">01</span><h2 id="ai-heading">당신의 AI를 선택하세요</h2><span className="micro">WITNESS SELECTION</span></div><p className="section-description">당신의 대화를 기억하는 AI가 이번 심사의 증인입니다.</p><fieldset className="ai-options"><legend className="sr-only">평가를 요청할 AI</legend>{AI_OPTIONS.map(ai => <label className={'ai-option ' + (selected === ai.name ? 'selected' : '')} key={ai.name}><input type="radio" name="ai" value={ai.name} checked={selected === ai.name} onChange={() => onSelect(ai.name)} /><span className={'ai-symbol ' + ai.className} aria-hidden="true">{ai.symbol}</span><span>{ai.name}</span><span className="radio-mark" aria-hidden="true" /></label>)}</fieldset><p className="ai-hint" aria-live="polite"><Icon name="info" size={15} /><span>{option.hint}</span></p></section>
}