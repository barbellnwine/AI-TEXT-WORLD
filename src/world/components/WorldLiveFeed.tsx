import { useEffect, useRef, useState } from 'react'
import { worldApi } from '../api'
import { useWorldStream } from '../useWorldStream'
import type { WorldEvent, WorldState } from '../types'

function category(e: WorldEvent) {
  if (e.phase === 'STARTED') return 'ACTION'
  if (e.type === 'DIALOGUE') return 'DIALOGUE'
  if (e.type === 'SYSTEM' || e.type === 'OPERATOR_EVENT') return 'SYSTEM'
  if (e.type === 'RESOURCE_CHANGE') return 'WORLD'
  return ['DISCOVERY', 'CONFLICT', 'INJURY'].includes(e.type) ? 'EVENT' : 'ACTION'
}

const chronological = (a: WorldEvent, b: WorldEvent) => a.sequence != null && b.sequence != null ? a.sequence - b.sequence : (a.worldMinute ?? 0) - (b.worldMinute ?? 0) || a.occurredAt.localeCompare(b.occurredAt)

export function WorldLiveFeed({ world, onOpenDetail }: { world: WorldState; onOpenDetail: (id: string) => void }) {
  const [events, setEvents] = useState<WorldEvent[]>([])
  const [pending, setPending] = useState<WorldEvent[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const atLatest = useRef(true)
  const seen = useRef(new Set<string>())
  const initial = useRef(true)
  const mounted = useRef(true)
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
      const result = await worldApi.events({ limit: 30 })
      if (!mounted.current) return
      merge(result.items)
      if (initial.current) { setHasMore(result.hasMore); initial.current = false }
      setError(false)
    } catch { if (mounted.current) setError(true) }
    finally { if (mounted.current) setLoading(false) }
  }
  const { connected } = useWorldStream(true, { onEvent: e => merge([e]), onReconnect: () => void refresh() })
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (connected) return
    const timer = window.setInterval(() => void refresh(), 15000)
    return () => clearInterval(timer)
  }, [connected])
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
      <ol className="world-live-list">{events.map(e => <li key={e.id} data-event-id={e.id}>
        <div><time>DAY {e.day} · {e.worldTime ?? '—'}</time><span>{category(e)}</span></div>
        <button onClick={() => onOpenDetail(e.id)}>{e.summary}</button>
        {e.publicQuote && <blockquote>{e.publicQuote}</blockquote>}
        <small>{world.places.find(p => p.id === e.placeId)?.name ?? ''}{e.phase === 'STARTED' ? ' · 진행 중' : e.phase === 'FAILED' || e.phase === 'CANCELLED' ? ' · 중단됨' : ''}</small>
      </li>)}</ol>
    </div>
    {pending.length > 0 && <button className="reader-new-scenes" onClick={latest}>새 기록 {pending.length}개 · 최신 위치로</button>}
  </div>
}
