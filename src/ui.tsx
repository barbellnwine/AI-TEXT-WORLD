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
// A triangle, not a word: the warning has to read before the sentence under it does.
export function Caution() { return <svg className="caution-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.4 22.2 21H1.8L12 3.4Z" stroke="currentColor" strokeWidth="1.5"/><path d="M12 9.3v5.1" stroke="currentColor" strokeWidth="1.7"/><circle cx="12" cy="17.4" r="1.05" fill="currentColor"/></svg> }
// Footage belongs under the photographs in the same cover block, not in a tab of its own: the
// still is the first frame and the reel is what follows it. This record says plainly what
// watching has done to the people who watched, so the warning stands above the player, and the
// player never starts on its own — the reader presses play having read it.
export function CoverFilm({ record }: { record: { id: string; evidence?: { title: string; type: string; url?: string; body?: string; locked?: boolean }[] } }) {
  const reels = (record.evidence || []).filter(e => e.type === 'video' && e.url && !e.locked)
  if (!reels.length) return null
  return <div className="record-film">
    <p className="film-caution"><Caution/><span><strong>열람 주의 — 행동 동화 가능성</strong>개체의 동작이 그대로 기록된 자료입니다. 반복 재생을 권장하지 않습니다. 열람 후 자신의 습관적 동작에 변화가 없는지 확인하고, 이상이 확인되면 공동 조사에 보고하십시오.</span></p>
    {reels.map((reel,i) => <figure className="film-reel" key={reel.url}>
      <video src={reel.url} controls preload="metadata" playsInline aria-label={reel.title}/>
      <figcaption><span className="mono">REEL {String(i+1).padStart(2,'0')} — {record.id}</span><strong>{reel.title}</strong>{reel.body && <span>{reel.body}</span>}</figcaption>
    </figure>)}
  </div>
}
// Each record numbers its own sections, so the open questions are found by what the section is
// called rather than by a fixed number: TA-021 files them at 10, TA-059 at 12.
export function unresolved(record: { unresolvedSection?: string; sections?: { number: string; title: string; body: string }[]; mission?: { question?: string } | null }) {
  const section = record.sections?.find(s => s.number === record.unresolvedSection) || record.sections?.find(s => s.title.includes('미해결'))
  return section?.body || record.mission?.question || ''
}
function inline(value: string): ReactNode[] { return value.split(/(\*\*[^*]+\*\*)/g).map((part,i) => part.startsWith('**') ? <strong key={i}>{part.slice(2,-2)}</strong> : part) }
// A short "항목: 값" line standing alone is a field of the file, not a sentence of it. A run of
// them read as body paragraphs scatters the page; set as a list they read as the header block
// they are. The key is kept short and punctuation-free so ordinary prose with a colon is not caught.
const FIELD = /^([^:\n]{2,14}): (.+)$/
const field = (block: string) => {
  const line = block.trim()
  if (line.includes('\n') || /^[-\d#>"“]/.test(line)) return null
  const m = line.match(FIELD)
  return m && !/[.!?]$/.test(m[1]) ? { key: m[1], value: m[2] } : null
}
export function Prose({ text }: { text: string }) {
  const blocks = text.replace(/\r/g,'').split(/\n\s*\n/).filter(b => b.trim() && b.trim() !== '---')
  const out: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i], lines = block.trim().split('\n')
    if (/^#{3,5}\s/.test(block)) {
      const title = block.replace(/^#{3,5}\s/,'')
      out.push(block.startsWith('####') ? <h4 key={i}>{inline(title)}</h4> : <h3 key={i}>{inline(title)}</h3>)
      continue
    }
    if (lines.every(line => /^-\s/.test(line))) { out.push(<ul key={i}>{lines.map((line,j) => <li key={j}>{inline(line.replace(/^-\s/,''))}</li>)}</ul>); continue }
    if (lines.every(line => /^\d+\.\s/.test(line))) { out.push(<ol key={i}>{lines.map((line,j) => <li key={j}>{inline(line.replace(/^\d+\.\s/,''))}</li>)}</ol>); continue }
    // A quoted passage runs from the block that opens it to the block that closes it, and a
    // transcript runs for as long as the lines keep coming. Both are one blockquote of several
    // paragraphs: matching only on the opening mark dropped every middle paragraph of a long
    // excerpt — and the paragraph carrying the closing mark — back into body text.
    if (/^["“]/.test(block.trim())) {
      const said: string[] = []
      const structural = (s: string) => /^#{3,5}\s/.test(s) || /^-\s/.test(s) || /^\d+\.\s/.test(s)
      while (i + said.length < blocks.length && said.length < 24) {
        const cur = blocks[i + said.length].trim()
        if (said.length && structural(cur)) break
        said.push(cur)
        const next = blocks[i + said.length]?.trim()
        // Still open: keep going whatever follows. Closed: only keep going for another line of dialogue.
        if (/["”]\s*$/.test(cur) && !(next && /^["“]/.test(next))) break
      }
      out.push(<blockquote className="transcript" key={i}>{said.map((line,j) => <p key={j}>{inline(line)}</p>)}</blockquote>)
      i += said.length - 1
      continue
    }
    const run = []
    while (i + run.length < blocks.length) { const f = field(blocks[i + run.length]); if (!f) break; run.push(f) }
    if (run.length > 1) {
      out.push(<dl className="fields" key={i}>{run.map((f,j) => <div key={j}><dt>{f.key}</dt><dd>{inline(f.value)}</dd></div>)}</dl>)
      i += run.length - 1
      continue
    }
    out.push(<p key={i}>{lines.map((line,j) => <span key={j}>{j > 0 && <br/>}{inline(line.replace(/  $/,''))}</span>)}</p>)
  }
  return <div className="prose">{out}</div>
}
