import { useEffect, useMemo, useState } from 'react'
import { getWorldAdminToken, setWorldAdminToken, worldAdminApi, worldApi } from '../api'
import { EventDetailPanel } from '../components/EventDetailPanel'
import { EventFeed } from '../components/EventFeed'
import { WorldFooter } from '../components/WorldFooter'
import { formatDateTime } from '../format'
import type { AdminWorldRuntime, Agent, OperatorLogEntry, Place, Season, WorldEvent } from '../types'

export function AdminWorldPage() {
  const [tokenInput, setTokenInput] = useState(getWorldAdminToken())
  const [runtime, setRuntime] = useState<AdminWorldRuntime | null>(null)
  const [season, setSeason] = useState<Season | null>(null)
  const [operatorLog, setOperatorLog] = useState<OperatorLogEntry[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [authError, setAuthError] = useState(false)
  const [message, setMessage] = useState('')
  const [detailEventId, setDetailEventId] = useState<string | null>(null)
  const [detailEvent, setDetailEvent] = useState<WorldEvent | null>(null)
  const placesById = useMemo(() => new Map(places.map(p => [p.id, p])), [places])
  const agentsById = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents])

  useEffect(() => {
    if (!detailEventId) {
      setDetailEvent(null)
      return
    }
    let cancelled = false
    worldApi.event(detailEventId).then(res => { if (!cancelled) setDetailEvent(res.event) }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [detailEventId])

  useEffect(() => {
    document.title = '운영자 — AI TEXT WORLD'
    worldApi.places().then(res => setPlaces(res.places)).catch(() => {})
    worldApi.agents().then(res => setAgents(res.agents)).catch(() => {})
  }, [])

  async function refresh() {
    try {
      const res = await worldAdminApi.runtime()
      setRuntime(res.runtime)
      setSeason(res.season)
      setOperatorLog(res.operatorLog)
      setAuthError(false)
    } catch {
      setAuthError(true)
    }
  }

  useEffect(() => {
    if (getWorldAdminToken()) refresh()
  }, [])

  function connect() {
    setWorldAdminToken(tokenInput)
    refresh()
  }

  async function run(action: () => Promise<unknown>, label: string) {
    try {
      await action()
      setMessage(label)
      await refresh()
    } catch (err) {
      setMessage(`${label} 실패 — ${err instanceof Error ? err.message : ''}`)
    }
  }

  return (
    <>
      <main className="world-shell">
        <header className="world-page-header">
          <p className="world-eyebrow">ADMIN</p>
          <h1>시뮬레이션 운영자 화면</h1>
          <p className="world-dev-banner">
            ⚠ 개발 환경 전용 화면입니다. 별도의 운영자 계정/로그인 시스템은 아직 없으며, AI 커뮤니티 관리자 화면과 동일한 x-admin-token 공유 비밀값(AI_COMMUNITY_ADMIN_TOKEN)으로 보호됩니다.
            실제 서비스 전에는 반드시 정식 인증으로 교체해야 합니다.
          </p>
        </header>

        <section className="admin-panel">
          <label className="admin-token-row">
            운영자 토큰
            <input type="password" value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="x-admin-token" />
            <button onClick={connect}>연결</button>
          </label>
          {authError && <p className="ai-error">인증 실패 — 토큰을 확인하세요.</p>}
        </section>

        {runtime && season && (
          <>
            <section className="admin-panel">
              <h2>시즌 제어</h2>
              <p className="micro">
                시즌: {season.name} · 상태: {runtime.status} · DAY {season.currentDay}
              </p>
              {message && <p className="micro">{message}</p>}
              <div className="admin-button-row">
                <button onClick={() => run(worldAdminApi.start, '시즌 시작')}>시즌 시작</button>
                <button onClick={() => run(worldAdminApi.pause, '일시정지')}>일시정지</button>
                <button onClick={() => run(worldAdminApi.resume, '재개')}>재개</button>
                <button className="danger" onClick={() => run(worldAdminApi.end, '시즌 종료')}>시즌 종료</button>
              </div>
            </section>

            <section className="admin-panel">
              <h2>시뮬레이션 설정</h2>
              <SettingsForm runtime={runtime} onSaved={refresh} setMessage={setMessage} />
            </section>

            <section className="admin-panel">
              <h2>런타임 현황</h2>
              <dl className="world-kv world-kv--inline">
                <div><dt>tick 간격</dt><dd>{Math.round(runtime.tickIntervalMs / 1000)}초</dd></div>
                <div><dt>최대 활성 에이전트</dt><dd>{runtime.maxActiveAgents}</dd></div>
                <div><dt>호출 예산</dt><dd>{runtime.callBudget}</dd></div>
                <div><dt>현재까지 호출 수</dt><dd>{runtime.callsUsed}</dd></div>
                <div><dt>이벤트 큐</dt><dd>{runtime.queuedEvents}</dd></div>
                <div><dt>실패한 작업</dt><dd>{runtime.failedJobs}</dd></div>
                <div><dt>재시도 횟수</dt><dd>{runtime.retryCount}</dd></div>
                <div><dt>lock 상태</dt><dd>{runtime.lockHolder ?? '보유자 없음'}</dd></div>
                <div><dt>마지막 tick</dt><dd className="world-mono">{runtime.lastTickAt ? formatDateTime(runtime.lastTickAt) : '-'}</dd></div>
                <div><dt>다음 tick 예정</dt><dd className="world-mono">{runtime.nextTickAt ? formatDateTime(runtime.nextTickAt) : '-'}</dd></div>
              </dl>
              <h3>provider별 호출 수 · 예상 비용</h3>
              <table className="admin-table">
                <thead><tr><th>provider</th><th>호출 수</th><th>예상 토큰</th><th>예상 비용(USD)</th></tr></thead>
                <tbody>
                  {runtime.providerUsage.map(p => (
                    <tr key={p.provider}><td>{p.provider}</td><td>{p.calls}</td><td>{p.estTokens}</td><td>{p.estCostUsd.toFixed(2)}</td></tr>
                  ))}
                </tbody>
              </table>
              {Object.keys(runtime.agentLastCallAt).length > 0 && (
                <>
                  <h3>에이전트별 마지막 호출 시간</h3>
                  <ul className="world-simple-list">
                    {Object.entries(runtime.agentLastCallAt).map(([id, at]) => <li key={id}><span>{id}</span><span className="world-mono">{formatDateTime(at)}</span></li>)}
                  </ul>
                </>
              )}
              {runtime.recentErrors.length > 0 && (
                <>
                  <h3>최근 서버 로그 (오류)</h3>
                  <ul className="world-simple-list">
                    {runtime.recentErrors.map(err => <li key={err.id}><span className="world-mono">{formatDateTime(err.occurredAt)}</span><span>{err.scope} · {err.message}</span></li>)}
                  </ul>
                </>
              )}
            </section>

            <section className="admin-panel">
              <h2>외부 사건 추가 (OPERATOR_EVENT)</h2>
              <OperatorEventForm places={places} agents={agents} onAdded={refresh} setMessage={setMessage} />
            </section>

            <section className="admin-panel">
              <h2>운영 로그</h2>
              {operatorLog.length === 0 ? (
                <p className="micro">아직 운영자가 추가한 사건이 없습니다.</p>
              ) : (
                <table className="admin-table">
                  <thead><tr><th>시각</th><th>작성자</th><th>내용</th></tr></thead>
                  <tbody>
                    {operatorLog.map(entry => (
                      <tr key={entry.id}><td className="micro">{formatDateTime(entry.addedAt)}</td><td>{entry.addedBy}</td><td>{entry.summary}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="admin-panel">
              <h2>원본 이벤트 로그</h2>
              <p className="micro">NARRATOR가 요약한 소설형 기록(현재 기록 페이지)의 실제 근거입니다. 필터로 원하는 사건만 검증할 수 있습니다.</p>
              <EventFeed agents={agents} placesById={placesById} agentsById={agentsById} latestStreamEvent={null} onOpenDetail={setDetailEventId} />
            </section>
          </>
        )}
      </main>
      <WorldFooter />
      <EventDetailPanel event={detailEvent} placesById={placesById} agentsById={agentsById} eventsById={new Map(detailEvent ? [[detailEvent.id, detailEvent]] : [])} onClose={() => setDetailEventId(null)} onSelectRelated={setDetailEventId} />
    </>
  )
}

function SettingsForm({ runtime, onSaved, setMessage }: { runtime: AdminWorldRuntime; onSaved: () => void; setMessage: (m: string) => void }) {
  const [tickSeconds, setTickSeconds] = useState(String(Math.round(runtime.tickIntervalMs / 1000)))
  const [maxAgents, setMaxAgents] = useState(String(runtime.maxActiveAgents))
  const [callBudget, setCallBudget] = useState(String(runtime.callBudget))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await worldAdminApi.setTickInterval(Number(tickSeconds) * 1000)
      await worldAdminApi.setMaxAgents(Number(maxAgents))
      await worldAdminApi.setCallBudget(Number(callBudget))
      setMessage('설정 저장됨')
      onSaved()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '설정 저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-settings-form">
      <label>
        tick 간격(초)
        <input value={tickSeconds} onChange={e => setTickSeconds(e.target.value)} inputMode="numeric" />
      </label>
      <label>
        최대 활성 에이전트 수
        <input value={maxAgents} onChange={e => setMaxAgents(e.target.value)} inputMode="numeric" />
      </label>
      <label>
        호출 예산 상한
        <input value={callBudget} onChange={e => setCallBudget(e.target.value)} inputMode="numeric" />
      </label>
      <button onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
    </div>
  )
}

function OperatorEventForm({ places, agents, onAdded, setMessage }: { places: Place[]; agents: Agent[]; onAdded: () => void; setMessage: (m: string) => void }) {
  const [placeId, setPlaceId] = useState('')
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [importance, setImportance] = useState('normal')
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  function toggleAgent(id: string) {
    setAgentIds(current => (current.includes(id) ? current.filter(x => x !== id) : [...current, id]))
  }

  async function submit() {
    setSubmitting(true)
    setErrors([])
    try {
      const result = await worldAdminApi.addEvent({ placeId, agentIds, title, summary, importance })
      if ('error' in result) {
        setErrors(result.details ?? [result.error])
      } else {
        setMessage('사건이 추가되었습니다.')
        setTitle('')
        setSummary('')
        setAgentIds([])
        onAdded()
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : '요청에 실패했습니다.'])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="world-operator-form">
      <p className="world-micro">세계에 존재하는 장소·캐릭터만 지정할 수 있습니다. 존재하지 않는 ID는 WORLD RULES 검증에서 거부됩니다.</p>
      <label>
        장소
        <select value={placeId} onChange={e => setPlaceId(e.target.value)}>
          <option value="">장소 선택</option>
          {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>관련 캐릭터</legend>
        {agents.map(a => (
          <label key={a.id} className="world-filter-checkbox">
            <input type="checkbox" checked={agentIds.includes(a.id)} onChange={() => toggleAgent(a.id)} />
            {a.name}
          </label>
        ))}
      </fieldset>
      <label>
        제목
        <input value={title} onChange={e => setTitle(e.target.value)} />
      </label>
      <label>
        요약
        <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3} />
      </label>
      <label>
        중요도
        <select value={importance} onChange={e => setImportance(e.target.value)}>
          <option value="low">낮음</option>
          <option value="normal">보통</option>
          <option value="high">중요</option>
          <option value="critical">긴급</option>
        </select>
      </label>
      <button onClick={submit} disabled={submitting || !placeId || !title.trim() || !summary.trim()}>
        {submitting ? '추가하는 중…' : '사건 추가'}
      </button>
      {errors.length > 0 && (
        <ul className="ai-error">
          {errors.map(e => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  )
}
