import { useEffect, useRef, useState } from 'react'
import { worldApi } from '../api'
import { EVENT_TYPE_LABEL } from '../format'
import type { Agent, EventType, Place, WorldEvent } from '../types'
import { EventCard } from './EventCard'
import { EmptyState, ErrorState, LoadingState } from './StateViews'

const HOURS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: '1시간' },
  { value: '6', label: '6시간' },
  { value: '24', label: '24시간' },
  { value: 'all', label: '전체' },
]

interface Props {
  agents: Agent[]
  placesById: Map<string, Place>
  agentsById: Map<string, Agent>
  latestStreamEvent: WorldEvent | null
  onOpenDetail: (id: string) => void
}

export function EventFeed({ agents, placesById, agentsById, latestStreamEvent, onOpenDetail }: Props) {
  const [hours, setHours] = useState('24')
  const [type, setType] = useState('')
  const [agentId, setAgentId] = useState('')
  const [importantOnly, setImportantOnly] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [events, setEvents] = useState<WorldEvent[]>([])
  const [pending, setPending] = useState<WorldEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const seenIds = useRef(new Set<string>())
  const feedTop = useRef<HTMLDivElement>(null)

  async function load(signal?: AbortSignal) {
    setLoading(true)
    setError(false)
    try {
      const res = await worldApi.events(
        { hours: hours === 'all' ? undefined : Number(hours), type: type || undefined, agentId: agentId || undefined, importantOnly, limit: 50 },
        signal
      )
      setEvents(res.items)
      seenIds.current = new Set(res.items.map(e => e.id))
      setPending([])
    } catch {
      if (!signal?.aborted) setError(true)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, type, agentId, importantOnly])

  useEffect(() => {
    if (!latestStreamEvent || !autoRefresh) return
    if (seenIds.current.has(latestStreamEvent.id)) return
    const matchesType = !type || latestStreamEvent.type === type
    const matchesAgent = !agentId || latestStreamEvent.agentIds.includes(agentId)
    const matchesImportance = !importantOnly || latestStreamEvent.importance === 'high' || latestStreamEvent.importance === 'critical'
    if (!matchesType || !matchesAgent || !matchesImportance) return
    seenIds.current.add(latestStreamEvent.id)
    setPending(p => [latestStreamEvent, ...p])
  }, [latestStreamEvent, autoRefresh, type, agentId, importantOnly])

  function flushPending() {
    setEvents(e => [...pending, ...e])
    setPending([])
    feedTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="world-feed" aria-label="실시간 사건 피드">
      <div ref={feedTop} />
      <div className="world-feed-toolbar">
        <div className="world-filter-group">
          {HOURS_OPTIONS.map(opt => (
            <button key={opt.value} type="button" className={hours === opt.value ? 'active' : ''} onClick={() => setHours(opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
        <label className="world-filter-select">
          유형
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="">전체</option>
            {(Object.keys(EVENT_TYPE_LABEL) as EventType[]).map(t => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="world-filter-select">
          캐릭터
          <select value={agentId} onChange={e => setAgentId(e.target.value)}>
            <option value="">전체</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="world-filter-checkbox">
          <input type="checkbox" checked={importantOnly} onChange={e => setImportantOnly(e.target.checked)} />
          주요 사건만
        </label>
        <label className="world-filter-checkbox">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          자동 갱신
        </label>
      </div>

      {pending.length > 0 && (
        <button type="button" className="world-new-events-pill" onClick={flushPending}>
          새로운 사건 {pending.length}건 보기
        </button>
      )}

      {loading && <LoadingState label="사건을 불러오는 중…" />}
      {!loading && error && <ErrorState onRetry={() => load()} />}
      {!loading && !error && events.length === 0 && <EmptyState label="조건에 맞는 사건이 아직 없습니다." />}

      {!loading && !error && events.length > 0 && (
        <ul className="world-event-list">
          {events.map(event => (
            <EventCard
              key={event.id}
              event={event}
              place={placesById.get(event.placeId)}
              agents={event.agentIds.map(id => agentsById.get(id)).filter((a): a is Agent => Boolean(a))}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
