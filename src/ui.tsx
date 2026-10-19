import { useState, type ReactNode } from 'react'
export function Mark({ small = false }: { small?: boolean }) { return <svg className={`symbol ${small ? 'small' : ''}`} viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M3 14V3h11m12 0h11v11M3 26v11h11m12 0h11V26" stroke="currentColor" strokeWidth="1.5"/><path d="m13 28 7-17 7 17m-11-6h8" stroke="currentColor" strokeWidth="1.5"/></svg> }
export function Arrow() { return <span aria-hidden="true">↗</span> }
export function Risk({ value, label }: { value: string; label?: string }) { return <span className={`risk ${value.toLowerCase()}`}><i/>{label || value}</span> }
export function Cover({ src, title, className = '' }: { src?: string; title: string; className?: string }) { return src ? <img className={`cover ${className}`} src={src} alt={title} decoding="async"/> : <div className={`cover no-cover ${className}`}><Mark/><span>IMAGE NOT REGISTERED</span></div> }
// A withheld photograph: obscured behind a stamp until the reader asks for it. Revealing
// hands straight over to Cover, so the original is always shown whole and uncropped.
// Each place a photograph appears withholds it on its own; opening the archive thumbnail
// does not open the record cover.
export function Censored({ src, title, className = '' }: { src?: string; title: string; className?: string }) {
  const [open, setOpen] = useState(false)
  if (!src || open) return <Cover src={src} title={title} className={className}/>
  return <button type="button" className={`censored ${className}`} onClick={() => setOpen(true)} aria-label={`${title} — 가려진 자료입니다. 열람하려면 선택하십시오.`}>
    <img className="censored-plate" src={src} alt="" aria-hidden="true" decoding="async"/>
    <span className="stamp" aria-hidden="true"><strong>CLASSIFIED</strong><small>열람 주의</small></span>
  </button>
}
function inline(value: string): ReactNode[] { return value.split(/(\*\*[^*]+\*\*)/g).map((part,i) => part.startsWith('**') ? <strong key={i}>{part.slice(2,-2)}</strong> : part) }
export function Prose({ text }: { text: string }) {
  const blocks = text.replace(/\r/g,'').split(/\n\s*\n/)
  return <div className="prose">{blocks.map((block,i) => {
    const lines = block.trim().split('\n')
    if (!block.trim() || block.trim() === '---') return null
    if (/^#{3,5}\s/.test(block)) { const level = block.startsWith('####') ? 4 : 3; const title = block.replace(/^#{3,5}\s/,''); return level === 4 ? <h4 key={i}>{inline(title)}</h4> : <h3 key={i}>{inline(title)}</h3> }
    if (lines.every(line => /^-\s/.test(line))) return <ul key={i}>{lines.map((line,j) => <li key={j}>{inline(line.replace(/^-\s/,''))}</li>)}</ul>
    if (lines.every(line => /^\d+\.\s/.test(line))) return <ol key={i}>{lines.map((line,j) => <li key={j}>{inline(line.replace(/^\d+\.\s/,''))}</li>)}</ol>
    if (/^["“]/.test(block.trim())) return <blockquote key={i}>{inline(block)}</blockquote>
    return <p key={i}>{lines.map((line,j) => <span key={j}>{j > 0 && <br/>}{inline(line.replace(/  $/,''))}</span>)}</p>
  })}</div>
}
