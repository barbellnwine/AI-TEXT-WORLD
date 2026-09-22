import { useEffect, useMemo, useState } from 'react'
import { Link } from '../../router/Link'
import { worldApi } from '../api'
import { ErrorState, LoadingState } from '../components/StateViews'
import { WorldFooter } from '../components/WorldFooter'
import type { Agent, Chapter } from '../types'

export function ChroniclePage() {
  const [entries, setEntries] = useState<Chapter[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    document.title = '지난 이야기 — AI TEXT WORLD'
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError(false)
      try {
        const [chronicleRes, agentsRes] = await Promise.all([worldApi.chronicle(controller.signal), worldApi.agents(controller.signal)])
        setEntries(chronicleRes.chapters)
        setAgents(agentsRes.agents)
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [])

  const agentsById = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents])

  return (
    <>
      <main className="world-shell">
        <header className="world-page-header">
          <p className="world-eyebrow">지난 이야기</p>
          <h1>이 세계가 걸어온 길</h1>
          <p className="world-page-description">
            낱낱의 장면을 하루 단위로 엮은 줄거리입니다. 자세한 이야기는 <Link to="/">현재 기록</Link>에서 읽을 수 있습니다.
          </p>
          <p className="world-micro">
            <Link to="/archive">종료된 이전 시즌의 기록 보기 →</Link>
          </p>
        </header>

        {loading && <LoadingState label="연대기를 불러오는 중…" />}
        {!loading && error && <ErrorState onRetry={() => window.location.reload()} />}
        {!loading && !error && entries.length === 0 && <p className="world-micro">아직 기록된 연대기가 없습니다.</p>}

        {!loading && !error && entries.length > 0 && (
          <ol className="world-chronicle-list">
            {entries.map(entry => (
              <li key={entry.id} className="world-chronicle-entry">
                <span className="world-chronicle-day world-mono">DAY {entry.day}</span>
                <div>
                  <h2>{entry.title}{entry.status === 'IN_PROGRESS' ? ' · 진행 중' : ''}</h2>
                  <p style={{ whiteSpace: 'pre-line' }}>{entry.status === 'IN_PROGRESS' ? '세계에서 사건이 진행되고 있습니다. 완료되면 이야기로 기록됩니다.' : entry.summary}</p>
                  {entry.agentIds.length > 0 && (
                    <p className="world-micro">
                      참여:{' '}
                      {entry.agentIds.map((id, i) => (
                        <span key={id}>
                          {i > 0 && ', '}
                          <Link to={`/characters/${id}`}>{agentsById.get(id)?.name ?? id}</Link>
                        </span>
                      ))}
                    </p>
                  )}
                  {entry.changes.length > 0 && (
                    <ul className="world-simple-list world-simple-list--inline">
                      {entry.changes.map(change => <li key={change}>{change}</li>)}
                    </ul>
                  )}
                  <details className="reader-details">
                    <summary>기록 근거 보기</summary>
                    <p className="world-micro world-mono">관련 EVENT ID: {entry.eventIds.join(', ')}</p>
                  </details>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
      <WorldFooter />
    </>
  )
}
