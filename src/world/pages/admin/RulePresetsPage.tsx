import { useEffect, useState } from 'react'
import { rulePresetApi } from '../../builderApi'
import { RULE_CATEGORIES, RULE_CATEGORY_LABELS, type RuleCategory, type RulePresetDTO, type RulePresetSummary, type WorldRuleDTO } from '../../builderTypes'
import { navigate } from '../../../router/navigation'
import { Link } from '../../../router/Link'

export function RulePresetsPage() {
  const [presets, setPresets] = useState<RulePresetSummary[]>([])
  const [selected, setSelected] = useState<RulePresetDTO | null>(null)
  const [authError, setAuthError] = useState(false)
  const [message, setMessage] = useState('')

  async function refreshList() {
    try {
      const res = await rulePresetApi.list()
      setPresets(res.presets)
      setAuthError(false)
    } catch {
      setAuthError(true)
    }
  }

  useEffect(() => {
    document.title = 'WORLD RULE PRESET — AI TEXT WORLD 관리자'
    refreshList()
  }, [])


  async function openPreset(id: string) {
    try {
      const res = await rulePresetApi.get(id)
      setSelected(res.preset)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '프리셋을 불러오지 못했습니다.')
    }
  }

  async function createNew() {
    const name = window.prompt('새 PRESET 이름')?.trim()
    if (!name) return
    const res = await rulePresetApi.create(name)
    await refreshList()
    setSelected(res.preset)
  }

  async function duplicate(preset: RulePresetSummary) {
    const name = window.prompt('복제될 PRESET 이름', `${preset.name} (복제)`)?.trim()
    if (!name) return
    await rulePresetApi.duplicate(preset.id, name)
    await refreshList()
  }

  async function remove(preset: RulePresetSummary) {
    if (preset.isSystem) { setMessage('시스템 기본 PRESET은 삭제할 수 없습니다.'); return }
    if (!window.confirm(`"${preset.name}"을 삭제할까요?`)) return
    try {
      await rulePresetApi.remove(preset.id)
      if (selected?.id === preset.id) setSelected(null)
      await refreshList()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '삭제할 수 없습니다 (사용 중인 DRAFT가 있을 수 있습니다).')
    }
  }

  return (
    <main className="world-shell">
      <header className="world-page-header">
        <p className="world-eyebrow">ADMIN · WORLD BUILDER</p>
        <h1>WORLD RULE PRESET 관리</h1>
        <p className="world-dev-banner">
          여기서 관리하는 규칙은 각 WORLD에 적용되는 세부 법칙(WORLD RULES)입니다. 모든 WORLD에 적용되는 WORLD CONSTITUTION(서버 prompts/worldRules.ts)은
          이 화면에서 수정할 수 없습니다. system_locked로 표시된 규칙은 삭제하거나 내용을 바꿀 수 없습니다(활성화 여부·우선순위만 조정 가능).
        </p>
      </header>

      <section className="admin-panel">
        <p className="world-micro">관리자 계정으로 연결되었습니다.</p>
        {authError && <p className="ai-error">설정을 불러오지 못했습니다. 로그인 상태와 연결을 확인하세요.</p>}
        <p className="world-micro" style={{ marginTop: 10 }}>
          <Link to="/admin/world/builder">← WORLD 생성 Wizard로 돌아가기</Link>
        </p>
      </section>

      {!authError && (
        <section className="admin-panel">
          <div className="ai-page-top">
            <h2>PRESET 목록</h2>
            <button onClick={createNew}>새 PRESET 만들기</button>
          </div>
          {message && <p className="micro">{message}</p>}
          <table className="admin-table">
            <thead><tr><th>이름</th><th>규칙 수</th><th>구분</th><th></th></tr></thead>
            <tbody>
              {presets.map(p => (
                <tr key={p.id}>
                  <td><button onClick={() => openPreset(p.id)} style={{ background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>{p.name}</button></td>
                  <td>{p.ruleCount}</td>
                  <td>{p.isSystem ? '시스템 기본' : '사용자 생성'}</td>
                  <td>
                    <div className="admin-button-row" style={{ marginTop: 0 }}>
                      <button onClick={() => duplicate(p)}>복제</button>
                      {!p.isSystem && <button className="danger" onClick={() => remove(p)}>삭제</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {selected && <PresetEditor preset={selected} onSaved={async updated => { setSelected(updated); await refreshList() }} />}
    </main>
  )
}

function emptyRule(category: RuleCategory): WorldRuleDTO {
  return { id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category, title: '', description: '', enabled: true, priority: 0, systemLocked: false, custom: true }
}

function PresetEditor({ preset, onSaved }: { preset: RulePresetDTO; onSaved: (p: RulePresetDTO) => void }) {
  const [name, setName] = useState(preset.name)
  const [description, setDescription] = useState(preset.description)
  const [rules, setRules] = useState<WorldRuleDTO[]>(preset.rules)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { setName(preset.name); setDescription(preset.description); setRules(preset.rules) }, [preset])

  function updateRule(id: string, patch: Partial<WorldRuleDTO>) {
    setRules(current => current.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }
  function removeRule(id: string) {
    setRules(current => current.filter(r => r.id !== id))
  }
  function addRule(category: RuleCategory) {
    setRules(current => [...current, emptyRule(category)])
  }

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      const res = await rulePresetApi.update(preset.id, {
        name, description,
        rules: rules.map(r => ({ id: r.id.startsWith('new-') ? undefined : r.id, category: r.category, title: r.title, description: r.description, enabled: r.enabled, priority: r.priority, systemLocked: r.systemLocked, custom: r.custom })),
      })
      onSaved(res.preset)
      setMessage('저장되었습니다.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-panel">
      <h2>PRESET 편집 — {preset.name}</h2>
      <div className="world-operator-form" style={{ maxWidth: 640, marginBottom: 16 }}>
        <label>이름<input value={name} onChange={e => setName(e.target.value)} /></label>
        <label>설명<textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} /></label>
      </div>

      {RULE_CATEGORIES.map(category => {
        const categoryRules = rules.filter(r => r.category === category)
        return (
          <details key={category} className="rule-category-group" open={categoryRules.length > 0}>
            <summary>{RULE_CATEGORY_LABELS[category]} ({categoryRules.length})</summary>
            {categoryRules.map(rule => (
              <div key={rule.id} className={`rule-row ${rule.systemLocked ? 'is-locked' : ''}`}>
                <label className="world-filter-checkbox">
                  <input type="checkbox" checked={rule.enabled} onChange={e => updateRule(rule.id, { enabled: e.target.checked })} />
                  사용
                </label>
                <input type="text" value={rule.title} placeholder="규칙 제목" readOnly={rule.systemLocked}
                  onChange={e => updateRule(rule.id, { title: e.target.value })} />
                <textarea value={rule.description} placeholder="규칙 설명" readOnly={rule.systemLocked} rows={2}
                  onChange={e => updateRule(rule.id, { description: e.target.value })} />
                {rule.systemLocked ? <span className="character-card-tag">시스템 고정</span> : <button onClick={() => removeRule(rule.id)}>삭제</button>}
              </div>
            ))}
            <div style={{ padding: '8px 14px' }}>
              <button onClick={() => addRule(category)}>+ 이 항목에 규칙 추가</button>
            </div>
          </details>
        )
      })}

      <div className="builder-actions">
        <button onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        {message && <p className="micro">{message}</p>}
      </div>
    </section>
  )
}

export function navigateToBuilder(): void {
  navigate('/admin/world/builder')
}
