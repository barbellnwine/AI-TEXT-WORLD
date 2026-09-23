import { useEffect, useMemo, useState } from 'react'
import { worldApi } from '../api'
import { ChronicleReader } from '../components/ChronicleReader'
import { EventDetailPanel } from '../components/EventDetailPanel'
import { ErrorState, LoadingState } from '../components/StateViews'
import { WorldFooter } from '../components/WorldFooter'
import { WorldStatusDrawer } from '../components/WorldStatusDrawer'
import { useWorldStream } from '../useWorldStream'
import type { ChronicleEntry, CurrentWorldResponse, WorldEvent } from '../types'
import { Link } from '../../router/Link'
import { Icon } from '../../components/Icon'
import { WorldMiniMap } from '../components/WorldMiniMap'
import { useWorldExperience } from '../i18n'
import { WorldLiveFeed } from '../components/WorldLiveFeed'

export function WorldHomePage() {
  const { t, locale } = useWorldExperience()
  const [tab, setTab] = useState('story')
  const [mode, setMode] = useState<'live' | 'text'>('live')
  const [away, setAway] = useState<Awaited<ReturnType<typeof worldApi.away>> | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [eventsError, setEventsError] = useState(false)
  const [current, setCurrent] = useState<CurrentWorldResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailEventId, setDetailEventId] = useState<string | null>(null)
  const [detailEvent, setDetailEvent] = useState<WorldEvent | null>(null)
  const [latestStreamScene, setLatestStreamScene] = useState<ChronicleEntry | null>(null)
  const [eventCache, setEventCache] = useState<Map<string, WorldEvent>>(new Map())

  useEffect(() => {
    document.title = 'AI WORLD — A living world'
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
    worldApi.events({ limit: 8 }, controller.signal).then(res => setEventCache(cache => new Map([...res.items.map(e => [e.id, e] as const), ...cache]))).catch(() => { if (!controller.signal.aborted) setEventsError(true) })
    return () => controller.abort()
  }, [])

  const { connected } = useWorldStream(true, {
    onReconnect: () => { void worldApi.current().then(snapshot => setCurrent(snapshot)).catch(() => {}) },
    onWorldState: worldState => {
      if (current && current.worldState.seasonId !== worldState.seasonId) { void worldApi.current().then(setCurrent).catch(() => {}); return }
      setCurrent(c => c ? { ...c, worldState } : c)
    },
    onRuntime: runtime => setCurrent(c => c ? { ...c, season: { ...c.season, status: runtime.status } } : c),
    onScene: setLatestStreamScene,
    onEvent: event => setEventCache(cache => new Map(cache).set(event.id, event)),
  })

  const placesById = useMemo(() => new Map((current?.worldState.places ?? []).map(p => [p.id, p])), [current])
  useEffect(() => {
    if (connected) return
    const timer = window.setInterval(() => { void worldApi.current().then(setCurrent).catch(() => {}) }, 15000)
    return () => clearInterval(timer)
  }, [connected])

  const seasonId = current?.worldState.seasonId
  useEffect(() => {
    if (!seasonId) return
    const key = `world-last-seen:${seasonId}`
    let active = true
    setAway(null)
    setEventCache(new Map())
    void worldApi.events({ limit: 8 }).then(result => { if (active) setEventCache(new Map(result.items.map(e => [e.id, e]))) }).catch(() => { if (active) setEventsError(true) })
    setLatestStreamScene(null)
    const check = () => {
      try {
        const since = localStorage.getItem(key)
        if (since && Date.now() - Date.parse(since) >= 60000) void worldApi.away(since).then(value => { if (active && value.eventCount > 0) setAway(value) }).catch(() => {})
      } catch { /* Storage is optional. */ }
    }
    const stamp = () => { try { localStorage.setItem(key, new Date().toISOString()) } catch { /* Storage is optional. */ } }
    check()
    const visibility = () => { if (document.visibilityState === 'visible') check(); else stamp() }
    document.addEventListener('visibilitychange', visibility)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') stamp() }, 30000)
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', visibility); stamp() }
  }, [seasonId])
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

  if (loading) return <main className="world-shell"><LoadingState label={t('loading')} /></main>
  if (error || !current) return <main className="world-shell"><ErrorState label={t('error')} onRetry={() => window.location.reload()} /></main>

  const { worldState, season } = current
  const selectedAgent = worldState.agents.find(a => a.id === selectedAgentId)
  const recentEvents = [...eventCache.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 8)
  const resources = worldState.places.flatMap(place => place.resources.map(resource => ({ ...resource, placeName: place.name, id: `${place.id}-${resource.key}` })))
  const activeAgents = worldState.agents.filter(agent => agent.publicState.status === 'alive' || agent.publicState.status === 'injured')
  const activeLocations = new Set(activeAgents.map(agent => agent.publicState.locationId).filter(Boolean)).size
  const activeEventIds = new Set(worldState.activeEventIds)
  const majorEventIds = new Set(recentEvents.filter(event => activeEventIds.has(event.id) && (event.importance === 'high' || event.importance === 'critical')).map(event => event.id))
  if (current.spotlightEvent && (current.spotlightEvent.importance === 'high' || current.spotlightEvent.importance === 'critical')) majorEventIds.add(current.spotlightEvent.id)
  const modeTabs = [{ id: 'live', label: 'LIVE' }, { id: 'text', label: 'TEXT' }] as const

  return (
    <>
      <main className="observatory">
        <header className="world-vitals" aria-labelledby="world-vitals-title">
          <div className="world-vitals-identity">
            <p className="world-vitals-brand">AI TEXT WORLD</p>
            <h1 id="world-vitals-title">{season.name}</h1>
            <p>{season.premise}</p>
          </div>
          <div className="world-vitals-now" aria-live="polite">
            <p className="world-vitals-clock">DAY {worldState.clock.day} <span>·</span> {worldState.clock.time}</p>
            <p className={`world-vitals-status status-${season.status.toLowerCase()}`}><i aria-hidden="true" /> WORLD {season.status}</p>
            <p className="world-vitals-weather">{t(worldState.clock.weather)} · {worldState.clock.temperatureC}°C · {connected ? t('connected') : t('reconnecting')}</p>
          </div>
          <dl className="world-vitals-counts">
            <div><dt>Characters</dt><dd>{activeAgents.length}</dd></div>
            <div><dt>Active Locations</dt><dd>{activeLocations}</dd></div>
            <div><dt>Major Events</dt><dd>{majorEventIds.size}</dd></div>
          </dl>
          <button className="world-vitals-expand" aria-label="세계 현황 자세히 보기" onClick={() => setDrawerOpen(true)}><Icon name="map" size={17} /> 세계 현황</button>
        </header>
        <nav className="observatory-mobile-tabs" aria-label={t('live')}>{(['story', 'characters', 'map', 'events'] as const).map(key => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{t(key)}</button>)}</nav>
        {away && <aside className="world-away" role="status"><p>자리를 비운 동안 {away.actions}개의 행동과 {away.majorEvents}개의 주요 사건이 기록되었습니다.</p><button onClick={() => { setMode('text'); setTab('story'); setAway(null) }}>지난 이야기 보기</button><button onClick={() => { setMode('live'); setTab('story'); setAway(null) }}>현재 LIVE로 이동</button></aside>}
        <div className="world-mode-tabs" role="tablist" aria-label="WORLD 보기 모드">{modeTabs.map(item => <button key={item.id} id={`world-mode-${item.id}`} role="tab" aria-selected={mode === item.id} aria-controls="world-mode-panel" tabIndex={mode === item.id ? 0 : -1} onClick={() => { setMode(item.id); setTab('story') }}>{item.label}</button>)}</div>
        <div className="observatory-grid" data-tab={tab}>
        <section id="world-mode-panel" className="observatory-story" role="tabpanel" aria-labelledby={`world-mode-${mode}`}><header className="observatory-section-head"><div><p className="observatory-kicker">{mode === 'live' ? 'WORLD LIVE' : 'THE CHRONICLE'}</p><h2>{mode === 'live' ? 'LIVE' : t('story')}</h2></div><Link to="/chronicle">{t('history')} <span>↗</span></Link></header><p className="observatory-story-note"><i />{t('storyNote')}</p>{locale === 'en-US' && <p className="map-caption">{t('original')}</p>}
        {mode === 'live' ? <WorldLiveFeed key={`live-${season.id}`} world={worldState} onOpenDetail={setDetailEventId} /> : <><p className="world-micro">완료된 사건을 챕터로 묶습니다. 진행 중인 기록은 LIVE에서 확인할 수 있습니다.</p><ChronicleReader key={`text-${season.id}`}
          placesById={placesById}
          agentsById={agentsById}
          latestStreamScene={latestStreamScene}
          onOpenDetail={setDetailEventId}
        /></>}</section>
        <aside className="observatory-sidebar">
          <section className="observatory-panel observatory-characters"><header className="observatory-section-head"><h2><Icon name="users" size={16} />{t('characters')} <span className="observatory-count">{worldState.agents.length}</span></h2><Link to="/characters">{t('all')} ↗</Link></header><p className="observatory-panel-note">{t('people')}</p><div className="observatory-people">{worldState.agents.map((agent, i) => <button key={agent.id} aria-pressed={selectedAgentId === agent.id} onClick={() => setSelectedAgentId(selectedAgentId === agent.id ? null : agent.id)} className="observatory-person"><span className={`observatory-avatar avatar-${i % 4}`}>{agent.name.slice(0, 1)}</span><span><strong>{agent.name}</strong><small>{placesById.get(agent.publicState.locationId)?.name ?? '—'}</small></span><span className={`observatory-person-status status-${agent.publicState.status}`}><i />{t(agent.publicState.status)}</span></button>)}</div>{selectedAgent && <div className="observatory-character-detail"><p className="observatory-kicker">{t('selected')}</p><h3>{selectedAgent.name}</h3><p>{selectedAgent.shortBio}</p>{selectedAgent.publicState.lastAction && <p><strong>{t('recent')}</strong> · {selectedAgent.publicState.lastAction}</p>}<Link to={`/characters/${encodeURIComponent(selectedAgent.id)}`}>{t('profile')} →</Link></div>}</section>
          <section className="observatory-panel observatory-map"><header className="observatory-section-head"><h2><Icon name="map" size={16} />{t('map')}</h2><span className="observatory-kicker">MINIMAP</span></header><WorldMiniMap state={worldState} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} /></section>
          <section className="observatory-panel observatory-resources"><header className="observatory-section-head"><h2><Icon name="pulse" size={16} />{t('resources')}</h2></header>{resources.map(resource => <div className="observatory-resource" key={resource.id}><div><span>{resource.label}<small>{resource.placeName}</small></span><strong>{resource.level}{resource.unit ?? ''} <span>{resource.trend === 'down' ? '↘' : resource.trend === 'up' ? '↗' : '—'}</span></strong></div><meter min={0} max={Math.max(resource.max, 1)} value={resource.level} aria-label={`${resource.placeName} ${resource.label}`} /></div>)}</section>
        </aside>
        <section className="observatory-events"><header className="observatory-section-head"><div><p className="observatory-kicker">WORLD TIMELINE</p><h2>{t('events')}</h2></div><span className="observatory-kicker">DAY {worldState.clock.day}</span></header>{eventsError && recentEvents.length === 0 ? <ErrorState onRetry={() => window.location.reload()} /> : recentEvents.length === 0 ? <p>{t('emptyEvents')}</p> : <ol>{recentEvents.map(event => <li key={event.id}><button onClick={() => setDetailEventId(event.id)}><span className="observatory-event-day">DAY {event.day}<small>{event.worldTime ?? '—'}</small></span><span className={`observatory-event-dot importance-${event.importance}`} /><span><strong>{event.title}</strong><small>{placesById.get(event.placeId)?.name} · {event.agentIds.map(id => agentsById.get(id)?.name).filter(Boolean).join(', ')}</small></span><span className="observatory-event-arrow">↗</span></button></li>)}</ol>}</section>
        </div>
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
