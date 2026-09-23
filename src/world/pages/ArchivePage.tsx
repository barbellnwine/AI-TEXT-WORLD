import { useCallback, useEffect, useState } from 'react'
import { worldApi, worldAdminApi } from '../api'
import { useWorldExperience } from '../i18n'
import { ErrorState, LoadingState } from '../components/StateViews'
import { WorldFooter } from '../components/WorldFooter'
import { formatDateTime } from '../format'
import type { Season } from '../types'

export function ArchivePage() {
  const { user } = useWorldExperience()
  const [seasons, setSeasons] = useState<Season[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(false)
    try {
      const res = await worldApi.seasons(signal)
      setSeasons(res.seasons.filter(s => s.status === 'ENDED'))
    } catch {
      if (!signal?.aborted) setError(true)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    document.title = '시즌 기록 — AI TEXT WORLD'
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function handleDelete(season: Season) {
    if (!window.confirm(`"${season.name}" 시즌 기록을 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return
    setDeletingId(season.id)
    setMessage('')
    try {
      await worldAdminApi.deleteSeason(season.id)
      setSeasons(prev => prev.filter(s => s.id !== season.id))
      if (expandedId === season.id) setExpandedId(null)
    } catch {
      setMessage('삭제하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <main className="world-shell">
        <header className="world-page-header">
          <p className="world-eyebrow">ARCHIVE</p>
          <h1>종료된 시즌</h1>
          <p className="world-page-description">이미 막을 내린 세계들의 기록입니다.</p>
        </header>

        {message && <p className="world-micro" role="alert">{message}</p>}
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
                      {user?.role === 'ADMIN' && (
                        <button type="button" className="danger" disabled={deletingId === season.id} onClick={() => void handleDelete(season)}>
                          {deletingId === season.id ? '삭제 중…' : '이 시즌 기록 완전히 삭제'}
                        </button>
                      )}
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
