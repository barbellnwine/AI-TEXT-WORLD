import { useEffect, useState, type ReactNode } from 'react'
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
// A record can carry more photographs than the one on its cover, and they used to be reachable
// only from the 증거 자료 tab. The plate sheet gathers every image the reader is allowed to see
// and files it as a numbered figure, the way the attachments page of a case file would.
type Plate = { url: string; title: string; body: string }
export function Plates({ record }: { record: { subtitle: string; id: string; coverImage?: string; summary: string; evidence?: { title: string; type: string; url?: string; body?: string; locked?: boolean }[] } }) {
  const [open, setOpen] = useState(-1)
  const images = (record.evidence || []).filter(e => e.type === 'image' && e.url && !e.locked)
  const plates: Plate[] = images.map(e => ({ url: e.url!, title: e.title, body: e.body || '' }))
  if (record.coverImage && !images.some(e => e.url === record.coverImage)) plates.unshift({ url: record.coverImage, title: '표지 원본', body: record.summary })
  // One image is already shown whole as the cover; a sheet repeating it would say nothing new.
  if (plates.length < 2) return null
  const label = (i: number) => `FIG. ${String(i + 1).padStart(2,'0')}`
  return <>
    <section className="plates">
      <div className="plate-head"><span>첨부 도판</span><span>PLATES / {record.id}</span></div>
      <div className="plate-grid">{plates.map((plate,i) =>
        <button type="button" className="plate" key={plate.url} onClick={() => setOpen(i)} aria-label={`${label(i)} ${plate.title} — 크게 보기`}>
          <img src={plate.url} alt={plate.title} loading="lazy" decoding="async"/>
          <span className="plate-caption"><span className="mono">{label(i)}</span><strong>{plate.title}</strong></span>
        </button>)}
      </div>
    </section>
    {open >= 0 && <Lightbox plates={plates} index={open} label={label} close={() => setOpen(-1)} move={d => setOpen(o => (o + d + plates.length) % plates.length)}/>}
  </>
}
function Lightbox({ plates, index, label, close, move }: { plates: Plate[]; index: number; label: (i: number) => string; close: () => void; move: (d: number) => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') move(1)
      if (e.key === 'ArrowLeft') move(-1)
    }
    addEventListener('keydown', key)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', key); document.body.style.overflow = overflow }
  }, [close, move])
  const plate = plates[index]
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${label(index)} ${plate.title}`} onClick={close}>
    <button type="button" className="close" onClick={close} aria-label="닫기">×</button>
    {plates.length > 1 && <button type="button" className="lightbox-step prev" onClick={e => { e.stopPropagation(); move(-1) }} aria-label="이전 도판">‹</button>}
    <figure onClick={e => e.stopPropagation()}>
      <img src={plate.url} alt={plate.title}/>
      <figcaption><span className="mono">{label(index)} — {index + 1} / {plates.length}</span><strong>{plate.title}</strong>{plate.body && <p>{plate.body}</p>}</figcaption>
    </figure>
    {plates.length > 1 && <button type="button" className="lightbox-step next" onClick={e => { e.stopPropagation(); move(1) }} aria-label="다음 도판">›</button>}
  </div>
}
// Each record numbers its own sections, so the open questions are found by what the section is
// called rather than by a fixed number: TA-021 files them at 10, TA-059 at 12.
export function unresolved(record: { sections?: { number: string; title: string; body: string }[]; mission?: { question?: string } | null }) {
  const section = record.sections?.find(s => s.title.includes('미해결')) || record.sections?.find(s => s.number === '10')
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
