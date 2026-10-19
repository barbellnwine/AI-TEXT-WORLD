import { useState, type ReactNode } from 'react'
export function Mark({ small = false }: { small?: boolean }) { return <svg className={`symbol ${small ? 'small' : ''}`} viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M3 14V3h11m12 0h11v11M3 26v11h11m12 0h11V26" stroke="currentColor" strokeWidth="1.5"/><path d="m13 28 7-17 7 17m-11-6h8" stroke="currentColor" strokeWidth="1.5"/></svg> }
export function Arrow() { return <span aria-hidden="true">↗</span> }
export function Risk({ value, label }: { value: string; label?: string }) { return <span className={`risk ${value.toLowerCase()}`}><i/>{label || value}</span> }
export function Cover({ src, title, className = '' }: { src?: string; title: string; className?: string }) { return src ? <img className={`cover ${className}`} src={src} alt={title} decoding="async"/> : <div className={`cover no-cover ${className}`}><Mark/><span>IMAGE NOT REGISTERED</span></div> }
// A withheld photograph. Listings never show the picture, whoever is reading: the plate is
// the teaser and the record itself is where the photograph lives. For a reader who is not
// signed in the server sends no image at all, so the plate stands on its own.
export function Censored({ src, title, className = '' }: { src?: string; title: string; className?: string }) {
  return <div className={`censored ${className}`} role="img" aria-label={`${title} — 가려진 자료입니다. 기록에서 열람하십시오.`}>
    {src && <img className="censored-plate" src={src} alt="" aria-hidden="true" decoding="async"/>}
    <span className="stamp" aria-hidden="true"><strong>CLASSIFIED</strong><small>열람 주의</small></span>
  </div>
}
// The record's photographs live on the cover itself: one frame at a time, paged sideways,
// rather than parked in a tab of their own. The caption follows whichever frame is showing.
export function CoverGallery({ record }: { record: { id: string; title: string; summary: string; coverImage?: string; evidence?: { title: string; type: string; url?: string; body?: string; locked?: boolean }[] } }) {
  const [at, setAt] = useState(0)
  const images = (record.evidence || []).filter(e => e.type === 'image' && e.url && !e.locked).map(e => ({ url: e.url!, title: e.title, body: e.body || '' }))
  // The cover opens the sequence, whether it is listed among the evidence or stands alone.
  const cover = images.findIndex(e => e.url === record.coverImage)
  if (cover > 0) images.unshift(...images.splice(cover, 1))
  else if (cover < 0 && record.coverImage) images.unshift({ url: record.coverImage, title: `${record.id} ${record.title} 원본 첨부 이미지`, body: record.summary })
  if (!images.length) return <div className="record-cover"><Cover title={`${record.id} ${record.title} 원본 첨부 이미지`}/></div>
  const frame = images[Math.min(at, images.length - 1)]
  const move = (d: number) => setAt(a => (a + d + images.length) % images.length)
  const label = `FIG. ${String(at + 1).padStart(2,'0')} — ${record.id}`
  return <div className="record-cover">
    <img className="cover" src={frame.url} alt={frame.title} decoding="async"/>
    {images.length > 1 && <>
      <button type="button" className="cover-step prev" onClick={() => move(-1)} aria-label="이전 사진">‹</button>
      <button type="button" className="cover-step next" onClick={() => move(1)} aria-label="다음 사진">›</button>
      <div className="cover-dots" role="tablist" aria-label="첨부 사진">{images.map((image,i) =>
        <button type="button" key={image.url} role="tab" aria-selected={i===at} aria-label={`사진 ${i+1}`} className={i===at?'on':''} onClick={() => setAt(i)}/>)}
      </div>
    </>}
    <div className="record-cover-note">
      <span>{label}</span>
      <p>{frame.body || frame.title}</p>
      <span>{images.length > 1 ? `${at + 1} / ${images.length}` : 'ORIGINAL ARCHIVE IMAGE'}</span>
    </div>
  </div>
}
// Each record numbers its own sections, so the open questions are found by what the section is
// called rather than by a fixed number: TA-021 files them at 10, TA-059 at 12.
export function unresolved(record: { unresolvedSection?: string; sections?: { number: string; title: string; body: string }[]; mission?: { question?: string } | null }) {
  const section = record.sections?.find(s => s.number === record.unresolvedSection) || record.sections?.find(s => s.title.includes('미해결'))
  return section?.body || record.mission?.question || ''
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
