import { useEffect, useMemo, useState } from 'react'
import { Link } from '../../router/Link'
import { Icon } from '../../components/Icon'
import { worldApi } from '../api'
import { EventCard } from '../components/EventCard'
import { EventDetailPanel } from '../components/EventDetailPanel'
import { ErrorState, LoadingState } from '../components/StateViews'
import { WorldFooter } from '../components/WorldFooter'
import { useFollowedAgents } from '../useFollowedAgents'
import { AGENT_STATUS_LABEL, RELATIONSHIP_LABEL, formatDateTime, statusClass } from '../format'
import type { Agent, Faction, Place, WorldEvent } from '../types'

const TABS = ['개요', '최근 행동', '관계', '소지품', '이동 기록', '알려진 정보', '주요 사건'] as const
type Tab = (typeof TABS)[number]

export function CharacterDetailPage({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [keyEvents, setKeyEvents] = useState<WorldEvent[]>([])
  const [recentEvents, setRecentEvents] = useState<WorldEvent[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [factions, setFactions] = useState<Faction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [tab, setTab] = useState<Tab>('개요')
  const [detailEventId, setDetailEventId] = useState<string | null>(null)
  const { isFollowed, toggle } = useFollowedAgents()

  useEffect(() => {
    const controller = new AbortController()
    setTab('개요')
    async function load() {
      setLoading(true)
      setError(false)
      try {
        const [agentRes, eventsRes, placesRes, agentsRes, factionsRes] = await Promise.all([
          worldApi.agent(agentId),
          worldApi.events({ agentId, limit: 30 }, controller.signal),
          worldApi.places(controller.signal),
          worldApi.agents(controller.signal),
          worldApi.factions(controller.signal),
        ])
        setAgent(agentRes.agent)
        setKeyEvents(agentRes.keyEvents)
        setRecentEvents(eventsRes.items)
        setPlaces(placesRes.places)
        setAgents(agentsRes.agents)
        setFactions(factionsRes.factions)
        document.title = `${agentRes.agent.name} — AI TEXT WORLD`
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [agentId])

  const placesById = useMemo(() => new Map(places.map(p => [p.id, p])), [places])
  const agentsById = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents])
  const eventsById = useMemo(() => new Map([...recentEvents, ...keyEvents].map(e => [e.id, e])), [recentEvents, keyEvents])
  const detailEvent = detailEventId ? eventsById.get(detailEventId) ?? null : null

  if (loading) return <main className="world-shell"><LoadingState label="캐릭터 정보를 불러오는 중…" /></main>
  if (error || !agent) return <main className="world-shell"><ErrorState label="캐릭터 정보를 불러오지 못했습니다." onRetry={() => window.location.reload()} /></main>

  const place = placesById.get(agent.publicState.locationId)
  const myFactions = factions.filter(f => agent.factionIds.includes(f.id))

  return (
    <>
      <main className="world-shell">
        <Link to="/characters" className="world-back-link">← 캐릭터 목록으로</Link>
        <header className="world-character-header">
          <span className="world-character-avatar world-character-avatar--large" aria-hidden="true">{agent.name.slice(0, 1)}</span>
          <div>
            <div className="world-character-header-top">
              <h1>{agent.name}</h1>
              <span className={`world-status-badge ${statusClass(agent.publicState.status)}`}>{AGENT_STATUS_LABEL[agent.publicState.status]}</span>
              <button type="button" className={`world-follow-button${isFollowed(agent.id) ? ' is-followed' : ''}`} onClick={() => toggle(agent.id)}>
                <Icon name="users" size={14} />
                {isFollowed(agent.id) ? '팔로우 중' : '팔로우'}
              </button>
            </div>
            <p className="world-micro world-mono">{agent.codeNumber}</p>
            <p className="world-character-bio">{agent.shortBio}</p>
          </div>
        </header>

        <nav className="world-tabs" aria-label="캐릭터 정보 탭">
          {TABS.map(t => (
            <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)} aria-current={tab === t ? 'true' : undefined}>
              {t}
            </button>
          ))}
        </nav>

        {tab === '개요' && (
          <section className="world-tab-panel">
            <dl className="world-kv">
              <div><dt>현재 위치</dt><dd>{place?.name ?? '위치 불명'}</dd></div>
              <div><dt>공개된 목표</dt><dd>{agent.publicState.visibleGoal ?? '공개되지 않음'}</dd></div>
              <div><dt>최근 행동</dt><dd>{agent.publicState.lastAction ?? '기록 없음'}</dd></div>
              <div><dt>소속</dt><dd>{myFactions.length > 0 ? myFactions.map(f => f.name).join(', ') : '무소속'}</dd></div>
              <div><dt>최근 활동</dt><dd className="world-mono">{formatDateTime(agent.publicState.lastActiveAt)}</dd></div>
            </dl>
          </section>
        )}

        {tab === '최근 행동' && (
          <section className="world-tab-panel">
            {recentEvents.length === 0 && <p className="world-micro">기록된 행동이 없습니다.</p>}
            <ul className="world-event-list">
              {recentEvents.map(event => (
                <EventCard key={event.id} event={event} place={placesById.get(event.placeId)} agents={event.agentIds.map(id => agentsById.get(id)).filter((a): a is Agent => Boolean(a))} onOpenDetail={setDetailEventId} />
              ))}
            </ul>
          </section>
        )}

        {tab === '관계' && (
          <section className="world-tab-panel">
            {agent.relationships.length === 0 && <p className="world-micro">아직 알려진 관계가 없습니다.</p>}
            <ul className="world-relationship-list">
              {agent.relationships.map(r => (
                <li key={r.otherAgentId}>
                  <Link to={`/characters/${r.otherAgentId}`}>{agentsById.get(r.otherAgentId)?.name ?? r.otherAgentId}</Link>
                  <span className={`world-status-badge world-relationship--${r.stance}`}>{RELATIONSHIP_LABEL[r.stance]}</span>
                  {r.note && <span className="world-micro">{r.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === '소지품' && (
          <section className="world-tab-panel">
            {agent.inventory.length === 0 ? <p className="world-micro">소지품이 없습니다.</p> : (
              <ul className="world-simple-list">
                {agent.inventory.map(item => <li key={item}>{item}</li>)}
              </ul>
            )}
          </section>
        )}

        {tab === '이동 기록' && (
          <section className="world-tab-panel">
            <ol className="world-movement-log">
              {agent.movementLog.map((entry, i) => (
                <li key={i}>
                  <span className="world-mono">{formatDateTime(entry.arrivedAt)}</span>
                  <span>{placesById.get(entry.placeId)?.name ?? entry.placeId}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {tab === '알려진 정보' && (
          <section className="world-tab-panel">
            {agent.knowledge.length === 0 ? <p className="world-micro">아직 알려진 정보가 없습니다.</p> : (
              <ul className="world-simple-list">
                {agent.knowledge.map(k => (
                  <li key={k.id}>
                    <p>{k.summary}</p>
                    <span className="world-micro world-mono">{formatDateTime(k.learnedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === '주요 사건' && (
          <section className="world-tab-panel">
            {keyEvents.length === 0 && <p className="world-micro">주요 사건 기록이 없습니다.</p>}
            <ul className="world-event-list">
              {keyEvents.map(event => (
                <EventCard key={event.id} event={event} place={placesById.get(event.placeId)} agents={event.agentIds.map(id => agentsById.get(id)).filter((a): a is Agent => Boolean(a))} onOpenDetail={setDetailEventId} />
              ))}
            </ul>
          </section>
        )}
      </main>
      <WorldFooter />
      <EventDetailPanel event={detailEvent} placesById={placesById} agentsById={agentsById} eventsById={eventsById} onClose={() => setDetailEventId(null)} onSelectRelated={setDetailEventId} />
    </>
  )
}
