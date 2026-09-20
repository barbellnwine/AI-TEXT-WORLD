import { useEffect, useMemo, useState } from 'react'
import { worldApi } from '../api'
import { CharacterCard } from '../components/CharacterCard'
import { ErrorState, LoadingState } from '../components/StateViews'
import { WorldFooter } from '../components/WorldFooter'
import { useFollowedAgents } from '../useFollowedAgents'
import type { Agent, Faction, Place } from '../types'

export function CharactersPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [factions, setFactions] = useState<Faction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [onlyFollowed, setOnlyFollowed] = useState(false)
  const { followed, isFollowed, toggle } = useFollowedAgents()

  useEffect(() => {
    document.title = '캐릭터 — AI TEXT WORLD'
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError(false)
      try {
        const [a, p, f] = await Promise.all([worldApi.agents(controller.signal), worldApi.places(controller.signal), worldApi.factions(controller.signal)])
        setAgents(a.agents)
        setPlaces(p.places)
        setFactions(f.factions)
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [])

  const placesById = useMemo(() => new Map(places.map(p => [p.id, p])), [places])
  const agentsById = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents])
  const visible = onlyFollowed ? agents.filter(a => followed.includes(a.id)) : agents

  return (
    <>
      <main className="world-shell">
        <header className="world-page-header">
          <p className="world-eyebrow">CHARACTERS</p>
          <h1>세계 속 캐릭터들</h1>
          <p className="world-page-description">각자의 목표와 기억을 가진 열 명이, 지금 이 순간에도 서로 다른 곳에서 움직이고 있습니다.</p>
          {agents.length > 0 && (
            <label className="world-filter-checkbox">
              <input type="checkbox" checked={onlyFollowed} onChange={e => setOnlyFollowed(e.target.checked)} />
              팔로우한 캐릭터만 보기 ({followed.length})
            </label>
          )}
        </header>

        {loading && <LoadingState label="캐릭터를 불러오는 중…" />}
        {!loading && error && <ErrorState onRetry={() => window.location.reload()} />}
        {!loading && !error && visible.length === 0 && <p className="world-micro">표시할 캐릭터가 없습니다.</p>}

        {!loading && !error && visible.length > 0 && (
          <ul className="world-character-grid">
            {visible.map(agent => (
              <CharacterCard
                key={agent.id}
                agent={agent}
                place={placesById.get(agent.publicState.locationId)}
                factions={factions}
                agentsById={agentsById}
                isFollowed={isFollowed(agent.id)}
                onToggleFollow={toggle}
              />
            ))}
          </ul>
        )}
      </main>
      <WorldFooter />
    </>
  )
}
