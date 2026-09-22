import { useEffect, useState } from 'react'
import { worldBuilderApi } from '../../builderApi'
import type { DraftSummary } from '../../builderTypes'
import { Link } from '../../../router/Link'
import { navigate } from '../../../router/navigation'

const STATUS_LABEL: Record<DraftSummary['status'], string> = {
  DRAFT: 'DRAFT (작성 중)', READY: 'READY (시작 가능)', RUNNING: 'RUNNING (진행 중)',
  PAUSED: 'PAUSED (일시정지)', ENDED: 'ENDED (종료)', ARCHIVED: 'ARCHIVED (보관)',
}

export function WorldBuilderListPage() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [authError, setAuthError] = useState(false)
  const [message, setMessage] = useState('')

  async function refresh() {
    try {
      const res = await worldBuilderApi.listDrafts()
      setDrafts(res.drafts)
      setAuthError(false)
    } catch {
      setAuthError(true)
    }
  }

  useEffect(() => {
    document.title = 'WORLD 생성 — AI TEXT WORLD 관리자'
    refresh()
  }, [])


  async function createDraft() {
    const name = window.prompt('새 WORLD 이름', 'PROJECT ISLAND')?.trim()
    if (!name) return
    try {
      const res = await worldBuilderApi.createDraft(name)
      navigate(`/admin/world/builder/${res.draft.id}`)
    } catch (err) { setMessage(err instanceof Error ? err.message : 'WORLD 생성 실패') }
  }

  async function removeDraft(draft: DraftSummary) {
    if (draft.status !== 'DRAFT') { setMessage('DRAFT 상태의 WORLD만 삭제할 수 있습니다.'); return }
    if (!window.confirm(`"${draft.name}" DRAFT를 삭제할까요?`)) return
    await worldBuilderApi.deleteDraft(draft.id)
    await refresh()
  }

  return (
    <main className="world-shell">
      <header className="world-page-header">
        <p className="world-eyebrow">ADMIN · WORLD BUILDER</p>
        <h1>WORLD 생성 · 관리</h1>
        <p className="world-dev-banner">
          여기서 만든 WORLD는 START WORLD를 누르는 순간 현재 실행 중인 시뮬레이션을 대체합니다 (엔진은 한 번에 하나의 WORLD만 운영합니다).
          시작 전까지는 몇 번이고 자유롭게 수정할 수 있는 DRAFT 상태입니다.
        </p>
      </header>

      <section className="admin-panel">
        <p className="world-micro">관리자 계정으로 연결되었습니다.</p>
        {authError && <p className="ai-error">설정을 불러오지 못했습니다. 로그인 상태와 연결을 확인하세요.</p>}
        <p className="world-micro" style={{ marginTop: 10, display: 'flex', gap: 14 }}>
          <Link to="/admin/world/rule-presets">WORLD RULE PRESET 관리 →</Link>
          <Link to="/admin/world">운영자 모니터링 화면 →</Link>
        </p>
      </section>

      <section className="admin-panel">
        <div className="ai-page-top">
          <h2>WORLD 목록</h2>
          <button onClick={createDraft}>+ 새 WORLD 만들기</button>
        </div>
        {message && <p className="micro">{message}</p>}
        {drafts.length === 0 ? (
          <p className="micro">아직 만든 WORLD가 없습니다.</p>
        ) : (
          <table className="admin-table">
            <thead><tr><th>이름</th><th>상태</th><th>시즌</th><th>장소</th><th>캐릭터</th><th>수정</th><th></th></tr></thead>
            <tbody>
              {drafts.map(d => (
                <tr key={d.id}>
                  <td>
                    <button onClick={() => navigate(`/admin/world/builder/${d.id}`)} style={{ background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>
                      {d.name || '(이름 없음)'}
                    </button>
                  </td>
                  <td>{STATUS_LABEL[d.status]}</td>
                  <td>{d.seasonName || '-'}</td>
                  <td>{d.placeCount}</td>
                  <td>{d.characterCount} / {d.targetPopulation}</td>
                  <td className="micro">{new Date(d.updatedAt).toLocaleString('ko-KR')}</td>
                  <td>{d.status === 'DRAFT' && <button className="danger" onClick={() => removeDraft(d)}>삭제</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
