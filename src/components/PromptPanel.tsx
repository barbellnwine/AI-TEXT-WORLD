import { useState } from 'react'
import type { AIName } from '../types/evaluation'
import { evaluationPrompt } from '../data/evaluationPrompt'
import { AI_OPTIONS } from './AISelector'
import { CopyButton } from './CopyButton'
import { Icon } from './Icon'
export function PromptPanel({ selected, onCopied }: { selected: AIName; onCopied: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const option = AI_OPTIONS.find(ai => ai.name === selected)!
  return <section className="panel prompt-panel" aria-labelledby="prompt-heading"><div className="section-heading"><span className="section-no">02</span><h2 id="prompt-heading">평가 프롬프트를 전달하세요</h2><span className="micro">TESTIMONY REQUEST</span></div><p className="section-description">아래 요청서를 복사해 평소 대화하던 AI에게 보내세요.</p><div className={'prompt-document ' + (expanded ? 'expanded' : '')}><div className="document-toolbar"><span><Icon name="file" size={14} /> EVALUATION_REQUEST.txt</span><span>VER. 1.0</span></div><pre id="prompt-text" tabIndex={expanded ? 0 : -1}>{evaluationPrompt}</pre><button className="expand-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="prompt-text">{expanded ? '접기' : '프롬프트 전체 보기'}<Icon name="chevron" size={14} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} /></button></div><CopyButton text={evaluationPrompt} label="평가 프롬프트 복사" successLabel="복사 완료 — AI에게 전달하세요" onCopied={onCopied} /><div className="prompt-foot"><span><Icon name="info" size={14} /> AI는 확인 가능한 대화만 평가할 수 있습니다.</span>{option.url && <a href={option.url} target="_blank" rel="noreferrer">{selected} 열기 <Icon name="external" size={13} /></a>}</div></section>
}