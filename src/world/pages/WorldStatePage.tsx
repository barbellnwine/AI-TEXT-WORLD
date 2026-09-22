import { useEffect, useMemo, useState } from 'react'
import { Link } from '../../router/Link'
import { worldApi } from '../api'
import { PlaceCard } from '../components/PlaceCard'
import { ErrorState, LoadingState } from '../components/StateViews'
import { WorldFooter } from '../components/WorldFooter'
import { DANGER_LABEL, WEATHER_LABEL, dangerClass, formatDateTime } from '../format'
import type { CurrentWorldResponse, WorldEvent } from '../types'
import { WorldMiniMap } from '../components/WorldMiniMap'
import { useWorldExperience } from '../i18n'
import { useWorldStream } from '../useWorldStream'

export function WorldStatePage() {
  const { t } = useWorldExperience()
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [current, setCurrent] = useState<CurrentWorldResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [recentEvents, setRecentEvents] = useState<WorldEvent[]>([])

  useEffect(() => {
    document.title = 'Minimap — AI WORLD'
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError(false)
      try {
        const res = await worldApi.current(controller.signal)
        setCurrent(res)
        setSelectedPlaceId(res.worldState.places[0]?.id ?? null)
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [])

  useWorldStream(true, { onWorldState: worldState => setCurrent(value => value ? { ...value, worldState } : value) })

  const agentsById = useMemo(() => new Map((current?.worldState.agents ?? []).map(a => [a.id, a])), [current])

  useEffect(() => {
    if (!selectedPlaceId) return
    let cancelled = false
    worldApi.place(selectedPlaceId).then(res => {
      if (!cancelled) setRecentEvents(res.recentEvents)
    }).catch(() => {
      if (!cancelled) setRecentEvents([])
    })
    return () => {
      cancelled = true
    }
  }, [selectedPlaceId])

  if (loading) return <main className="world-shell"><LoadingState label="세계 정보를 불러오는 중…" /></main>
  if (error || !current) return <main className="world-shell"><ErrorState onRetry={() => window.location.reload()} /></main>

  const { worldState } = current
  const selectedPlace = worldState.places.find(p => p.id === selectedPlaceId) ?? worldState.places[0]

  return (
    <>
      <main className="world-shell">
        <header className="world-page-header">
          <p className="world-eyebrow">MINIMAP</p>
          <h1>{t('map')}</h1>
          <dl className="world-kv world-kv--inline">
            <div><dt>시간</dt><dd className="world-mono">DAY {worldState.clock.day} · {worldState.clock.time}</dd></div>
            <div><dt>날씨</dt><dd>{WEATHER_LABEL[worldState.clock.weather]} · {worldState.clock.temperatureC}°C</dd></div>
            <div><dt>위험도</dt><dd className={dangerClass(worldState.dangerLevel)}>{DANGER_LABEL[worldState.dangerLevel]}</dd></div>
            <div><dt>최근 변경</dt><dd className="world-mono">{formatDateTime(worldState.updatedAt)}</dd></div>
          </dl>
        </header>

        <section className="world-island-overview" aria-label={t('map')}>
          <WorldMiniMap state={worldState} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
          <div className="minimap-character-picker">{worldState.agents.map(agent => <button key={agent.id} aria-pressed={selectedAgentId === agent.id} onClick={() => setSelectedAgentId(selectedAgentId === agent.id ? null : agent.id)}>{agent.name}</button>)}</div>
        </section>

        <div className="world-place-grid">
          <ul className="world-place-nodes">
            {worldState.places.map(place => (
              <PlaceCard key={place.id} place={place} agentCount={place.currentAgentIds.length} selected={place.id === selectedPlace?.id} onSelect={setSelectedPlaceId} />
            ))}
          </ul>

          {selectedPlace && (
            <section className="world-place-detail">
              <h2>{selectedPlace.name}</h2>
              <p>{selectedPlace.description}</p>
              {selectedPlace.locked && <p className="world-flag">접근 제한 · {selectedPlace.accessCondition}</p>}

              <h3>연결된 장소</h3>
              <ul className="world-simple-list world-simple-list--inline">
                {selectedPlace.connectedPlaceIds.map(id => {
                  const target = worldState.places.find(p => p.id === id)
                  return (
                    <li key={id}>
                      <button type="button" className="world-text-button" onClick={() => setSelectedPlaceId(id)}>
                        {target?.name ?? id}
                      </button>
                    </li>
                  )
                })}
              </ul>

              <h3>현재 위치한 캐릭터</h3>
              {selectedPlace.currentAgentIds.length === 0 ? (
                <p className="world-micro">지금 이 장소에는 아무도 없습니다.</p>
              ) : (
                <ul className="world-simple-list world-simple-list--inline">
                  {selectedPlace.currentAgentIds.map(id => (
                    <li key={id}>
                      <Link to={`/characters/${id}`}>{agentsById.get(id)?.name ?? id}</Link>
                    </li>
                  ))}
                </ul>
              )}

              <h3>사용 가능한 자원</h3>
              <ul className="world-resource-list">
                {selectedPlace.resources.map(resource => (
                  <li key={resource.key}>
                    <span>{resource.label}</span>
                    <span className="world-resource-value">{resource.level}{resource.unit ?? ''}</span>
                  </li>
                ))}
              </ul>

              <h3>최근 발생한 사건</h3>
              {recentEvents.length === 0 ? (
                <p className="world-micro">최근 기록된 사건이 없습니다.</p>
              ) : (
                <ul className="world-simple-list">
                  {recentEvents.map(event => (
                    <li key={event.id}>
                      <span className="world-mono world-micro">{formatDateTime(event.occurredAt)}</span>
                      <span>{event.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </main>
      <WorldFooter />
    </>
  )
}
