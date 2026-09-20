import { useEffect, useState } from 'react'
import { worldApi } from '../api'
import { ErrorState, LoadingState } from '../components/StateViews'
import { WorldFooter } from '../components/WorldFooter'
import { formatDateTime } from '../format'
import type { Season } from '../types'

export function ArchivePage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    document.title = '시즌 기록 — AI TEXT WORLD'
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError(false)
      try {
        const res = await worldApi.seasons(controller.signal)
        setSeasons(res.seasons.filter(s => s.status === 'ENDED'))
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [])

  return (
    <>
      <main className="world-shell">
        <header className="world-page-header">
          <p className="world-eyebrow">ARCHIVE</p>
          <h1>종료된 시즌</h1>
          <p className="world-page-description">이미 막을 내린 세계들의 기록입니다.</p>
        </header>

        {loading && <LoadingState label="시즌 기록을 불러오는 중…" />}
        {!loading && error && <ErrorState onRetry={() => window.location.reload()} />}
        {!loading && !error && seasons.length === 0 && <p className="world-micro">아직 종료된 시즌이 없습니다. 지금 진행 중인 시즌은 LIVE에서 볼 수 있습니다.</p>}

        {!loading && !error && seasons.length > 0 && (
          <ul className="world-archive-list">
            {seasons.map(season => {
              const expanded = expandedId === season.id
              return (
                <li key={season.id} className="world-archive-card">
                  <button type="button" className="world-archive-card-head" onClick={() => setExpandedId(expanded ? null : season.id)} aria-expanded={expanded}>
                    <div>
                      <h2>{season.name}</h2>
                      <p className="world-micro">{season.premise}</p>
                    </div>
                    <span className="world-micro world-mono">
                      {season.startedAt && formatDateTime(season.startedAt)} ~ {season.endedAt && formatDateTime(season.endedAt)}
                    </span>
                  </button>
                  {expanded && (
                    <div className="world-archive-detail">
                      <dl className="world-kv world-kv--inline">
                        <div><dt>참여 캐릭터</dt><dd>{season.agentCount}명</dd></div>
                        <div><dt>생존자</dt><dd>{season.survivorCount}명</dd></div>
                        {season.biggestEventTitle && <div><dt>가장 큰 사건</dt><dd>{season.biggestEventTitle}</dd></div>}
                      </dl>
                      {season.finalStateSummary && <p>{season.finalStateSummary}</p>}
                      {season.seasonSummary && <p>{season.seasonSummary}</p>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </main>
      <WorldFooter />
    </>
  )
}
