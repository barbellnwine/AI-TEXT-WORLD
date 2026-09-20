import { useEffect, useMemo, useRef, useState } from 'react'
import { worldApi } from '../api'
import { useReaderSettings } from '../useReaderSettings'
import { EmptyState, ErrorState, LoadingState } from './StateViews'
import { SceneEntry } from './SceneEntry'
import type { Agent, ChronicleEntry, Place } from '../types'

interface Props {
  placesById: Map<string, Place>
  agentsById: Map<string, Agent>
  latestStreamScene: ChronicleEntry | null
  onOpenDetail: (eventId: string) => void
}

// Ascending order (oldest first, newest last) — new scenes are appended at the bottom, matching
// "새 사건이 발생하면 새로운 문단이 아래에 추가된다."
export function ChronicleReader({ placesById, agentsById, latestStreamScene, onOpenDetail }: Props) {
  const [scenes, setScenes] = useState<ChronicleEntry[]>([])
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState(false)
  const [pendingScenes, setPendingScenes] = useState<ChronicleEntry[]>([])
  const [importantOnly, setImportantOnly] = useState(false)
  const seenIds = useRef(new Set<string>())
  const sceneEls = useRef(new Map<string, HTMLElement>())
  const bottomAnchor = useRef<HTMLDivElement>(null)
  const { fontSize, setFontSize, theme, setTheme, getLastReadSceneId, saveLastReadSceneId } = useReaderSettings()

  async function loadInitial() {
    setLoadingInitial(true)
    setError(false)
    try {
      const hasSavedPosition = Boolean(getLastReadSceneId())
      const res = await worldApi.scenes({ limit: hasSavedPosition ? 50 : 2, importantOnly })
      const ascending = [...res.items].reverse()
      setScenes(ascending)
      seenIds.current = new Set(ascending.map(s => s.id))
      setHasMoreOlder(res.hasMore)
    } catch {
      setError(true)
    } finally {
      setLoadingInitial(false)
    }
  }

  useEffect(() => {
    loadInitial()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importantOnly])

  useEffect(() => {
    if (loadingInitial || scenes.length === 0) return
    const lastId = getLastReadSceneId()
    const frame = requestAnimationFrame(() => {
      const target = lastId ? sceneEls.current.get(lastId) : null
      if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingInitial])

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const id = (visible?.target as HTMLElement | undefined)?.dataset.sceneId
        if (id) saveLastReadSceneId(id)
      },
      { threshold: [0.5] }
    )
    for (const el of sceneEls.current.values()) observer.observe(el)
    return () => observer.disconnect()
  }, [scenes, saveLastReadSceneId])

  useEffect(() => {
    if (!latestStreamScene || seenIds.current.has(latestStreamScene.id)) return
    if (importantOnly && latestStreamScene.importance === 'ordinary') return
    seenIds.current.add(latestStreamScene.id)
    setPendingScenes(p => [...p, latestStreamScene])
  }, [latestStreamScene, importantOnly])

  async function loadOlder() {
    if (loadingOlder || scenes.length === 0) return
    setLoadingOlder(true)
    try {
      const oldest = scenes[0]
      const previousHeight = document.documentElement.scrollHeight
      const res = await worldApi.scenes({ before: oldest.createdAt, limit: 2, importantOnly })
      const olderAscending = [...res.items].reverse()
      for (const s of olderAscending) seenIds.current.add(s.id)
      setScenes(current => [...olderAscending, ...current])
      setHasMoreOlder(res.hasMore)
      requestAnimationFrame(() => {
        window.scrollTo({ top: window.scrollY + (document.documentElement.scrollHeight - previousHeight) })
      })
    } finally {
      setLoadingOlder(false)
    }
  }

  async function readFromStart() {
    setLoadingInitial(true)
    try {
      const res = await worldApi.scenes({ limit: 50, importantOnly })
      const ascending = [...res.items].reverse()
      setScenes(ascending)
      seenIds.current = new Set(ascending.map(s => s.id))
      setHasMoreOlder(res.hasMore)
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    } finally {
      setLoadingInitial(false)
    }
  }

  function flushPending() {
    setScenes(current => [...current, ...pendingScenes])
    setPendingScenes([])
    requestAnimationFrame(() => bottomAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
  }

  async function jumpToLatest() {
    if (pendingScenes.length > 0) {
      flushPending()
      return
    }
    await loadInitial()
    requestAnimationFrame(() => bottomAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
  }

  const days = useMemo(() => [...new Set(scenes.map(s => s.worldDay))].sort((a, b) => a - b), [scenes])

  function jumpToDay(day: number) {
    const first = scenes.find(s => s.worldDay === day)
    if (first) sceneEls.current.get(first.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={`reader-shell reader-theme-${theme} reader-font-${fontSize}`}>
      <div className="reader-toolbar">
        <div className="reader-toolbar-group">
          <button type="button" className="world-text-button" onClick={readFromStart}>처음부터 읽기</button>
          <button type="button" className="world-text-button" onClick={jumpToLatest}>최신 기록으로 이동</button>
        </div>
        {days.length > 0 && (
          <nav className="reader-toc" aria-label="하루 단위 목차">
            {days.map(day => (
              <button key={day} type="button" onClick={() => jumpToDay(day)}>DAY {day}</button>
            ))}
          </nav>
        )}
        <label className="world-filter-checkbox">
          <input type="checkbox" checked={importantOnly} onChange={e => setImportantOnly(e.target.checked)} />
          중요 장면만 모아 보기
        </label>
        <div className="reader-toolbar-group">
          <label className="world-micro">
            글자 크기
            <select value={fontSize} onChange={e => setFontSize(e.target.value as typeof fontSize)}>
              <option value="small">작게</option>
              <option value="medium">보통</option>
              <option value="large">크게</option>
            </select>
          </label>
          <button type="button" className="world-text-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '밝은 기록지' : '어두운 기록지'}
          </button>
        </div>
      </div>

      {hasMoreOlder && !loadingInitial && (
        <button type="button" className="reader-load-older" onClick={loadOlder} disabled={loadingOlder}>
          {loadingOlder ? '불러오는 중…' : '이전 기록 불러오기'}
        </button>
      )}

      {loadingInitial && <LoadingState label="기록을 펼치는 중…" />}
      {!loadingInitial && error && <ErrorState onRetry={loadInitial} />}
      {!loadingInitial && !error && scenes.length === 0 && <EmptyState label="아직 기록된 장면이 없습니다." />}

      {!loadingInitial && !error && scenes.length > 0 && (
        <div className="reader-scenes">
          {scenes.map((scene, i) => (
            <div key={scene.id}>
              {i > 0 && <div className="reader-scene-divider" aria-hidden="true">＊ ＊ ＊</div>}
              <SceneEntry
                scene={scene}
                placesById={placesById}
                agentsById={agentsById}
                onOpenDetail={onOpenDetail}
                registerRef={(id, el) => {
                  if (el) sceneEls.current.set(id, el)
                  else sceneEls.current.delete(id)
                }}
              />
            </div>
          ))}
        </div>
      )}

      <div ref={bottomAnchor} />

      {pendingScenes.length > 0 && (
        <button type="button" className="reader-new-scene-toast" onClick={flushPending}>
          새로운 기록이 도착했습니다.
        </button>
      )}
    </div>
  )
}
