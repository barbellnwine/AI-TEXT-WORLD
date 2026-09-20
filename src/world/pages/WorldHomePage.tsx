import { useEffect, useMemo, useState } from 'react'
import { worldApi } from '../api'
import { ChronicleReader } from '../components/ChronicleReader'
import { EventDetailPanel } from '../components/EventDetailPanel'
import { ErrorState, LoadingState } from '../components/StateViews'
import { SeasonStatusLine } from '../components/SeasonStatusLine'
import { WorldFooter } from '../components/WorldFooter'
import { WorldStatusDrawer } from '../components/WorldStatusDrawer'
import { useWorldStream } from '../useWorldStream'
import type { ChronicleEntry, CurrentWorldResponse, WorldEvent } from '../types'

export function WorldHomePage() {
  const [current, setCurrent] = useState<CurrentWorldResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailEventId, setDetailEventId] = useState<string | null>(null)
  const [detailEvent, setDetailEvent] = useState<WorldEvent | null>(null)
  const [latestStreamScene, setLatestStreamScene] = useState<ChronicleEntry | null>(null)
  const [eventCache, setEventCache] = useState<Map<string, WorldEvent>>(new Map())

  useEffect(() => {
    document.title = 'AI TEXT WORLD — 지금, 세계를 관전하다'
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError(false)
      try {
        const snapshot = await worldApi.current(controller.signal)
        setCurrent(snapshot)
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [])

  const { connected } = useWorldStream(true, {
    onWorldState: worldState => setCurrent(c => (c ? { ...c, worldState } : c)),
    onScene: setLatestStreamScene,
    onEvent: event => setEventCache(cache => new Map(cache).set(event.id, event)),
  })

  const placesById = useMemo(() => new Map((current?.worldState.places ?? []).map(p => [p.id, p])), [current])
  const agentsById = useMemo(() => new Map((current?.worldState.agents ?? []).map(a => [a.id, a])), [current])

  useEffect(() => {
    if (!detailEventId) {
      setDetailEvent(null)
      return
    }
    const cached = eventCache.get(detailEventId)
    if (cached) {
      setDetailEvent(cached)
      return
    }
    let cancelled = false
    worldApi.event(detailEventId).then(res => {
      if (cancelled) return
      setDetailEvent(res.event)
      setEventCache(cache => new Map(cache).set(res.event.id, res.event))
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [detailEventId, eventCache])

  if (loading) return <main className="world-shell"><LoadingState label="세계를 여는 중…" /></main>
  if (error || !current) return <main className="world-shell"><ErrorState label="세계 정보를 불러오지 못했습니다." onRetry={() => window.location.reload()} /></main>

  return (
    <>
      <main className="reader-page">
        <SeasonStatusLine season={current.season} worldState={current.worldState} connected={connected} onOpenDrawer={() => setDrawerOpen(true)} />
        <ChronicleReader
          placesById={placesById}
          agentsById={agentsById}
          latestStreamScene={latestStreamScene}
          onOpenDetail={setDetailEventId}
        />
      </main>
      <WorldFooter />
      <WorldStatusDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} worldState={current.worldState} spotlightEvent={current.spotlightEvent} />
      <EventDetailPanel
        event={detailEvent}
        placesById={placesById}
        agentsById={agentsById}
        eventsById={eventCache}
        onClose={() => setDetailEventId(null)}
        onSelectRelated={setDetailEventId}
      />
    </>
  )
}
