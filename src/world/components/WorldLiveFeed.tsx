import { storyEvent } from '../../../server/domain/storyComposition'
import { useEffect, useRef, useState } from 'react'
import { worldApi } from '../api'
import { useWorldStream } from '../useWorldStream'
import type { ChronicleEntry, WorldEvent, WorldState } from '../types'
import { compactProse, eventProse, koreanParticles } from '../../../server/domain/eventProse'

const chronological = (a: WorldEvent, b: WorldEvent) => a.sequence != null && b.sequence != null ? a.sequence - b.sequence : (a.worldMinute ?? 0) - (b.worldMinute ?? 0) || a.occurredAt.localeCompare(b.occurredAt)

export function WorldLiveFeed({ world, onOpenDetail }: { world: WorldState; onOpenDetail: (id: string) => void }) {
  const [events, setEvents] = useState<WorldEvent[]>([])
  const [scenes, setScenes] = useState<ChronicleEntry[]>([])
  const [pending, setPending] = useState<WorldEvent[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const atLatest = useRef(true)
  const seen = useRef(new Set<string>())
  const initial = useRef(true)
  const mounted = useRef(true)
  const mergeScenes = (incoming: ChronicleEntry[]) => setScenes(old => {
    const byId = new Map(old.map(s => [s.id, s]))
    incoming.forEach(s => byId.set(s.id, s))
    return [...byId.values()]
  })
  const merge = (incoming: WorldEvent[]) => {
    const fresh = incoming.filter(e => !seen.current.has(e.id)).reverse()
    for (const e of fresh) seen.current.add(e.id)
    if (!fresh.length) return
    if (!atLatest.current) setPending(old => [...old, ...fresh])
    else {
      setEvents(old => [...old, ...fresh].sort(chronological))
      requestAnimationFrame(() => { if (viewport.current && atLatest.current) viewport.current.scrollTop = viewport.current.scrollHeight })
    }
  }
  async function refresh() {
    try {
      const [result, narration] = await Promise.all([worldApi.events({ limit: 30 }), worldApi.scenes({ limit: 50 })])
      if (!mounted.current) return
      merge(result.items)
      mergeScenes(narration.items)
      if (initial.current) { setHasMore(result.hasMore); initial.current = false }
      setError(false)
    } catch { if (mounted.current) setError(true) }
    finally { if (mounted.current) setLoading(false) }
  }
  useWorldStream(true, { onEvent: e => merge([e]), onScene: scene => mergeScenes([scene]), onReconnect: () => void refresh() })
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false } }, [])
  useEffect(() => {
    // Also reconcile improved narration when a sceneUpdated frame was missed.
    const timer = window.setInterval(() => void refresh(), 15000)
    return () => clearInterval(timer)
  }, [])
  async function older() {
    if (loading || !events.length) return
    setLoading(true)
    const height = viewport.current?.scrollHeight ?? 0
    const top = viewport.current?.scrollTop ?? 0
    atLatest.current = false
    try {
      const result = await worldApi.events({ before: events[0].id, limit: 30 })
      const fresh = result.items.filter(e => !seen.current.has(e.id)).reverse()
      for (const e of fresh) seen.current.add(e.id)
      setEvents(old => [...fresh, ...old]); setHasMore(result.hasMore); setError(false)
      requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollTop = top + viewport.current.scrollHeight - height })
    } catch { setError(true) } finally { setLoading(false) }
  }
  function latest() {
    atLatest.current = true
    setEvents(old => [...old, ...pending].sort(chronological)); setPending([])
    requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight })
  }
  const agents = new Map(world.agents.map(a => [a.id, a]))
  const sceneByEvent = new Map(scenes.flatMap(s => s.sourceEventIds.map(id => [id, s] as const)))
  const displayed = new Set<string>()
  const blocks: Array<{ id: string; day: number; time: string; placeId: string; paragraphs: string[]; eventIds: string[]; provisional: boolean }> = []
  for (const event of events) {
    if (!storyEvent(event)) continue
    const scene = sceneByEvent.get(event.id)
    if (scene) {
      if (displayed.has(scene.id)) continue
      displayed.add(scene.id)
      // Older deterministic scenes can be reconstructed from the loaded public facts.
      const legacy = scene.body.includes('에서의 기록이다.')
      const sources = events.filter(e => scene.sourceEventIds.includes(e.id) && e.phase !== 'STARTED')
      let body = scene.body
      if (legacy) {
        body = body.replace(/^\[[^\n]*\]\n/, '').replace(/[^.\n]+에서의 기록이다\.\s*/g, '')
        for (const source of sources) body = body.replace(source.summary, eventProse(source, agents))
        body = compactProse(body.split(/(?<=\.)\s+/), agents).join('\n\n')
      }
      body = koreanParticles(body)
      if (body.trim()) blocks.push({ id: scene.id, day: scene.worldDay, time: scene.timeStart === scene.timeEnd ? scene.timeStart : `${scene.timeStart}–${scene.timeEnd}`, placeId: scene.locationIds[0], paragraphs: body.split(/\n\s*\n/), eventIds: scene.sourceEventIds, provisional: false })
      continue
    }
    const previous = blocks.at(-1)
    const sentence = eventProse(event, agents) + (event.publicQuote ? `\n“${event.publicQuote}”` : '')
    if (previous?.provisional && previous.day === event.day && previous.time === event.worldTime && previous.placeId === event.placeId) {
      if (!previous.paragraphs.includes(sentence)) previous.paragraphs.push(sentence)
      previous.eventIds.push(event.id)
    } else blocks.push({ id: event.id, day: event.day, time: event.worldTime ?? '—', placeId: event.placeId, paragraphs: [sentence], eventIds: [event.id], provisional: true })
  }
  return <div className="world-live-feed">
    <p className="world-micro">WORLD LIVE · DAY {world.clock.day} · {world.clock.time}</p>
    {error && <p role="status">기록 연결을 확인하는 중입니다. <button onClick={() => void refresh()}>다시 연결</button></p>}
    <div className="world-live-viewport" ref={viewport} tabIndex={0} aria-label="실시간 사건 기록" onScroll={() => {
      const el = viewport.current
      if (el) atLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    }}>
      {hasMore && <button className="reader-load-older" disabled={loading} onClick={() => void older()}>과거 기록 더 보기</button>}
      {loading && !events.length && <p>기록을 불러오는 중…</p>}
      {!loading && !events.length && <p>아직 발생한 사건이 없습니다.</p>}
      <div className="world-live-story">{blocks.map(block => <article key={block.id} data-scene-id={block.id}>
        <header><h3>DAY {block.day} — {block.time}</h3><small>{world.places.find(p => p.id === block.placeId)?.name}</small></header>
        {compactProse(block.paragraphs, agents).map((paragraph, i) => <p key={i}>{paragraph}</p>)}
        <details><summary>사건 근거 {block.eventIds.length}개</summary>{block.eventIds.map((id, i) => <button key={id} onClick={() => onOpenDetail(id)}>사건 {i + 1} 보기</button>)}</details>
      </article>)}</div>
    </div>
    {pending.length > 0 && <button className="reader-new-scenes" onClick={latest}>새 기록 {pending.length}개 · 최신 위치로</button>}
  </div>
}
