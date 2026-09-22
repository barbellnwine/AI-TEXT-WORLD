import { useEffect, useState } from 'react'
import { rulePresetApi, worldBuilderApi, type CharacterInputPayload } from '../../builderApi'
import type {
  CharacterDTO, DraftDTO, DraftResource, Emotion, HumanState, PlaceDTO, RelationshipDTO,
  RulePresetDTO, RulePresetSummary, ValidationResult,
} from '../../builderTypes'
import { RULE_CATEGORY_LABELS } from '../../builderTypes'
import { navigate } from '../../../router/navigation'
import { Link } from '../../../router/Link'

const STEPS = ['01 WORLD', '02 RULES', '03 ENVIRONMENT', '04 MAP', '05 CHARACTERS', '06 REVIEW', '07 START'] as const

export function WorldBuilderWizardPage({ draftId }: { draftId: string }) {
  const [draft, setDraft] = useState<DraftDTO | null>(null)
  const [step, setStep] = useState(1)
  const [authError, setAuthError] = useState(false)

  async function refresh() {
    try {
      const res = await worldBuilderApi.getDraft(draftId)
      setDraft(res.draft)
      setStep(current => (current === 1 ? Math.min(7, Math.max(1, res.draft.wizardStep)) : current))
      setAuthError(false)
    } catch {
      setAuthError(true)
    }
  }

  useEffect(() => {
    document.title = 'WORLD 생성 Wizard — AI TEXT WORLD 관리자'
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])


  function goToStep(next: number) {
    setStep(next)
    worldBuilderApi.setStep(draftId, next).catch(() => {})
  }

  if (!draft) {
    return (
      <main className="world-shell">
        <header className="world-page-header">
          <p className="world-eyebrow">ADMIN · WORLD BUILDER</p>
          <h1>WORLD 생성 Wizard</h1>
        </header>
        <section className="admin-panel">
          <p className="world-micro">WORLD를 불러오는 중입니다.</p>
          {authError && <p className="ai-error">WORLD를 불러오지 못했습니다. 로그인 상태와 WORLD를 확인하세요.</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="world-shell">
      <header className="world-page-header">
        <p className="world-eyebrow">ADMIN · WORLD BUILDER</p>
        <h1>{draft.name || '(이름 없음)'} — WORLD 생성 Wizard</h1>
        <p className="world-micro"><Link to="/admin/world/builder">← WORLD 목록으로</Link></p>
      </header>

      <nav className="builder-steps">
        {STEPS.map((label, index) => {
          const n = index + 1
          return (
            <button key={label} className={`builder-step ${n === step ? 'is-active' : ''} ${n < step ? 'is-done' : ''}`} onClick={() => goToStep(n)}>
              {label}
            </button>
          )
        })}
      </nav>
      {draft.status !== 'DRAFT' && (
        <p className="world-dev-banner">이 WORLD는 이미 {draft.status} 상태입니다. {draft.status === 'RUNNING' || draft.status === 'PAUSED' ? '실행 중인 WORLD의 초기 설계는 더 이상 수정할 수 없습니다 (섹션 39).' : ''}</p>
      )}

      <fieldset disabled={!['DRAFT', 'READY'].includes(draft.status)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {step === 1 && <StepWorld draft={draft} onSaved={setDraft} onNext={() => goToStep(2)} />}
      {step === 2 && <StepRules draft={draft} onSaved={setDraft} onPrev={() => goToStep(1)} onNext={() => goToStep(3)} />}
      {step === 3 && <StepEnvironment draft={draft} onSaved={setDraft} onPrev={() => goToStep(2)} onNext={() => goToStep(4)} />}
      {step === 4 && <StepMap draft={draft} onSaved={setDraft} onPrev={() => goToStep(3)} onNext={() => goToStep(5)} />}
      {step === 5 && <StepCharacters draft={draft} onSaved={setDraft} onPrev={() => goToStep(4)} onNext={() => goToStep(6)} />}
      {step === 6 && <StepReview draft={draft} onSaved={setDraft} onPrev={() => goToStep(5)} onNext={() => goToStep(7)} />}
      {step === 7 && <StepStart draft={draft} onPrev={() => goToStep(6)} />}
      </fieldset>
    </main>
  )
}

// --- STEP 1: WORLD ------------------------------------------------------------

function StepWorld({ draft, onSaved, onNext }: { draft: DraftDTO; onSaved: (d: DraftDTO) => void; onNext: () => void }) {
  const [form, setForm] = useState({
    name: draft.name, intro: draft.intro, genre: draft.genre, background: draft.background, seasonName: draft.seasonName,
    maxDays: draft.maxDays, simSpeedMs: draft.simSpeedMs, targetPopulation: draft.targetPopulation, isPublic: draft.isPublic,
  })
  const [saving, setSaving] = useState(false)

  async function save(andNext: boolean) {
    setSaving(true)
    try {
      const res = await worldBuilderApi.saveBasicInfo(draft.id, form)
      onSaved(res.draft)
      if (andNext) onNext()
    } finally { setSaving(false) }
  }

  return (
    <section className="admin-panel">
      <h2>01 · 세계 기본 정보</h2>
      <div className="world-operator-form" style={{ maxWidth: 640 }}>
        <label>WORLD 이름<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label>WORLD 소개<textarea rows={3} value={form.intro} onChange={e => setForm({ ...form, intro: e.target.value })} /></label>
        <label>세계 장르<input value={form.genre} onChange={e => setForm({ ...form, genre: e.target.value })} placeholder="예: 현실 기반 생존" /></label>
        <label>세계 배경<textarea rows={2} value={form.background} onChange={e => setForm({ ...form, background: e.target.value })} /></label>
        <label>시즌 이름<input value={form.seasonName} onChange={e => setForm({ ...form, seasonName: e.target.value })} placeholder="예: Season 1" /></label>
        <label>최대 진행 기간(일, 비워두면 무제한)
          <input type="number" min={1} value={form.maxDays ?? ''} onChange={e => setForm({ ...form, maxDays: e.target.value ? Number(e.target.value) : null })} />
        </label>
        <label>시뮬레이션 속도 (tick 간격, 초)
          <input type="number" min={5} value={Math.round(form.simSpeedMs / 1000)} onChange={e => setForm({ ...form, simSpeedMs: Math.max(5, Number(e.target.value || 5)) * 1000 })} />
        </label>
        <label>초기 참가 인원
          <input type="number" min={1} max={draft.maxActiveCharacters} value={form.targetPopulation} onChange={e => setForm({ ...form, targetPopulation: Math.max(1, Math.min(draft.maxActiveCharacters ?? draft.targetPopulation, Number(e.target.value || 1))) })} />
          <small>현재 WORLD 한도: {draft.maxActiveCharacters}명</small>
        </label>
        <label className="world-filter-checkbox">
          <input type="checkbox" checked={form.isPublic} onChange={e => setForm({ ...form, isPublic: e.target.checked })} />
          공개 WORLD (비로그인 사용자도 관전 가능)
        </label>
      </div>
      <div className="builder-actions">
        <span />
        <div className="admin-button-row" style={{ marginTop: 0 }}>
          <button onClick={() => save(false)} disabled={saving}>DRAFT 저장</button>
          <button onClick={() => save(true)} disabled={saving}>저장하고 다음 →</button>
        </div>
      </div>
    </section>
  )
}

// --- STEP 2: RULES -------------------------------------------------------------

function StepRules({ draft, onSaved, onPrev, onNext }: { draft: DraftDTO; onSaved: (d: DraftDTO) => void; onPrev: () => void; onNext: () => void }) {
  const [presets, setPresets] = useState<RulePresetSummary[]>([])
  const [selectedPreset, setSelectedPreset] = useState<RulePresetDTO | null>(null)
  const [rulePresetId, setRulePresetId] = useState(draft.rulePresetId ?? '')

  useEffect(() => { rulePresetApi.list().then(res => setPresets(res.presets)).catch(() => {}) }, [])
  useEffect(() => {
    if (!rulePresetId) { setSelectedPreset(null); return }
    rulePresetApi.get(rulePresetId).then(res => setSelectedPreset(res.preset)).catch(() => {})
  }, [rulePresetId])

  async function save(andNext: boolean) {
    const res = await worldBuilderApi.saveRuleSelection(draft.id, rulePresetId || null)
    onSaved(res.draft)
    if (andNext) onNext()
  }

  return (
    <section className="admin-panel">
      <h2>02 · WORLD RULES 선택 / 검토</h2>
      <p className="world-micro">WORLD CONSTITUTION(모든 WORLD 공통, 수정 불가)에 더해 이 WORLD에만 적용될 세부 규칙 PRESET을 선택하세요.</p>
      <div className="world-operator-form" style={{ maxWidth: 480 }}>
        <label>
          WORLD RULE PRESET
          <select value={rulePresetId} onChange={e => setRulePresetId(e.target.value)}>
            <option value="">선택 안 함</option>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name}{p.isSystem ? ' (시스템 기본)' : ''} — 규칙 {p.ruleCount}개</option>)}
          </select>
        </label>
      </div>
      <p className="world-micro"><Link to="/admin/world/rule-presets">PRESET을 새로 만들거나 편집하려면 여기서 →</Link></p>

      {selectedPreset && (
        <div style={{ marginTop: 14 }}>
          <h3 className="micro">선택된 PRESET 미리보기 — {selectedPreset.name}</h3>
          {Object.entries(RULE_CATEGORY_LABELS).map(([category, label]) => {
            const rules = selectedPreset.rules.filter(r => r.category === category)
            if (rules.length === 0) return null
            return (
              <details key={category} className="rule-category-group">
                <summary>{label} ({rules.length})</summary>
                <ul className="world-simple-list" style={{ padding: '8px 14px' }}>
                  {rules.map(r => (
                    <li key={r.id}>
                      <span>{r.title}{r.systemLocked ? ' 🔒' : ''}{!r.enabled ? ' (비활성)' : ''}</span>
                      <span className="micro">{r.description}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )
          })}
        </div>
      )}

      <div className="builder-actions">
        <button onClick={onPrev}>← 이전</button>
        <div className="admin-button-row" style={{ marginTop: 0 }}>
          <button onClick={() => save(false)}>DRAFT 저장</button>
          <button onClick={() => save(true)}>저장하고 다음 →</button>
        </div>
      </div>
    </section>
  )
}

// --- STEP 3: ENVIRONMENT --------------------------------------------------------

const WEATHER_OPTIONS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow']

function StepEnvironment({ draft, onSaved, onPrev, onNext }: { draft: DraftDTO; onSaved: (d: DraftDTO) => void; onPrev: () => void; onNext: () => void }) {
  const [form, setForm] = useState({
    startDay: draft.startDay, startTime: draft.startTime, startWeather: draft.startWeather, startTemperatureC: draft.startTemperatureC,
    backgroundSituation: draft.backgroundSituation, initialEvent: draft.initialEvent, powerStatus: draft.powerStatus,
    initialResources: draft.initialResources, facilityStatus: draft.facilityStatus, hiddenWorldTruth: draft.hiddenWorldTruth, endCondition: draft.endCondition,
    discoverableTruths: draft.discoverableTruths ?? [],
  })

  function updateResource(index: number, patch: Partial<DraftResource>) {
    setForm(f => ({ ...f, initialResources: f.initialResources.map((r, i) => (i === index ? { ...r, ...patch } : r)) }))
  }
  function addResource() {
    setForm(f => ({ ...f, initialResources: [...f.initialResources, { key: '', label: '', level: 100, max: 100 }] }))
  }
  function removeResource(index: number) {
    setForm(f => ({ ...f, initialResources: f.initialResources.filter((_, i) => i !== index) }))
  }

  async function save(andNext: boolean) {
    const res = await worldBuilderApi.saveEnvironment(draft.id, form)
    onSaved(res.draft)
    if (andNext) onNext()
  }

  return (
    <section className="admin-panel">
      <h2>03 · 시작 환경 (DAY 1)</h2>
      <div className="world-operator-form" style={{ maxWidth: 640 }}>
        <label>DAY<input type="number" min={1} value={form.startDay} onChange={e => setForm({ ...form, startDay: Math.max(1, Number(e.target.value || 1)) })} /></label>
        <label>시작 시간 (HH:MM)<input value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} placeholder="08:00" /></label>
        <label>날씨
          <select value={form.startWeather} onChange={e => setForm({ ...form, startWeather: e.target.value })}>
            {WEATHER_OPTIONS.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <label>기온(°C)<input type="number" value={form.startTemperatureC} onChange={e => setForm({ ...form, startTemperatureC: Number(e.target.value || 0) })} /></label>
        <label>배경 상황<textarea rows={3} value={form.backgroundSituation} onChange={e => setForm({ ...form, backgroundSituation: e.target.value })} /></label>
        <label>초기 사건<textarea rows={2} value={form.initialEvent} onChange={e => setForm({ ...form, initialEvent: e.target.value })} /></label>
        <label>전력 상태<input value={form.powerStatus} onChange={e => setForm({ ...form, powerStatus: e.target.value })} placeholder="예: 예비 전력 92%" /></label>
        <label>시설 상태<input value={form.facilityStatus} onChange={e => setForm({ ...form, facilityStatus: e.target.value })} /></label>
        <label>종료 조건<textarea rows={2} value={form.endCondition} onChange={e => setForm({ ...form, endCondition: e.target.value })} /></label>
        <label>
          HIDDEN WORLD TRUTH (세계 판정 전용 배경 · 캐릭터에게 자동 전달되지 않습니다)
          <textarea rows={3} value={form.hiddenWorldTruth} onChange={e => setForm({ ...form, hiddenWorldTruth: e.target.value })} />
        </label>
      </div>

      <h3 className="micro" style={{ marginTop: 16 }}>초기 자원</h3>
      <p className="world-micro">초기 자원은 첫 번째 장소에 배치됩니다. 식량은 food, 물은 water 키를 사용하세요.</p>
      {form.initialResources.map((r, i) => (
        <div key={i} className="place-row-grid" style={{ marginBottom: 8 }}>
          <input placeholder="key" value={r.key} onChange={e => updateResource(i, { key: e.target.value })} />
          <input placeholder="라벨 (예: 식량)" value={r.label} onChange={e => updateResource(i, { label: e.target.value })} />
          <input type="number" placeholder="현재치" value={r.level} onChange={e => updateResource(i, { level: Number(e.target.value || 0) })} />
          <input type="number" placeholder="최대치" value={r.max} onChange={e => updateResource(i, { max: Number(e.target.value || 0) })} />
          <button onClick={() => removeResource(i)}>삭제</button>
        </div>
      ))}
      <button onClick={addResource}>+ 자원 추가</button>

      <h3>탐색으로 발견할 수 있는 진실</h3>
      <p className="world-micro">지도에서 장소를 먼저 저장한 뒤 발견 장소를 지정하세요. 해당 장소의 탐색이 완료된 캐릭터만 내용을 알게 됩니다.</p>
      {form.discoverableTruths.map((truth, index) => <div className="place-row" key={truth.id}>
        <label>발견 내용<textarea value={truth.summary} onChange={e => setForm({ ...form, discoverableTruths: form.discoverableTruths.map((t, i) => i === index ? { ...t, summary: e.target.value } : t) })} /></label>
        <label>발견 장소<select value={truth.placeId} onChange={e => setForm({ ...form, discoverableTruths: form.discoverableTruths.map((t, i) => i === index ? { ...t, placeId: e.target.value } : t) })}><option value="">장소 선택</option>{draft.places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>알게 되는 장소 (선택)<select value={truth.revealedPlaceId ?? ''} onChange={e => setForm({ ...form, discoverableTruths: form.discoverableTruths.map((t, i) => i === index ? { ...t, revealedPlaceId: e.target.value || undefined } : t) })}><option value="">없음</option>{draft.places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button onClick={() => setForm({ ...form, discoverableTruths: form.discoverableTruths.filter((_, i) => i !== index) })}>진실 삭제</button>
      </div>)}
      <button onClick={() => setForm({ ...form, discoverableTruths: [...form.discoverableTruths, { id: crypto.randomUUID(), summary: '', placeId: '' }] })}>+ 발견 가능한 진실 추가</button>

      <div className="builder-actions">
        <button onClick={onPrev}>← 이전</button>
        <div className="admin-button-row" style={{ marginTop: 0 }}>
          <button onClick={() => save(false)}>DRAFT 저장</button>
          <button onClick={() => save(true)}>저장하고 다음 →</button>
        </div>
      </div>
    </section>
  )
}

// --- STEP 4: MAP ---------------------------------------------------------------

interface EditablePlace extends Omit<PlaceDTO, 'id'> { id?: string; tempId: string }
interface EditableConnection { id?: string; tempId: string; fromPlaceRef: string; toPlaceRef: string; travelTime: number; connectionType: string; blocked: boolean; requirements: string }

function toEditablePlace(p: PlaceDTO): EditablePlace {
  return { ...p, tempId: p.id }
}

function toEditableConnection(c: DraftDTO['connections'][number]): EditableConnection {
  return { id: c.id, tempId: c.id, fromPlaceRef: c.fromPlaceId, toPlaceRef: c.toPlaceId, travelTime: c.travelTime, connectionType: c.connectionType, blocked: c.blocked, requirements: c.requirements }
}

function StepMap({ draft, onSaved, onPrev, onNext }: { draft: DraftDTO; onSaved: (d: DraftDTO) => void; onPrev: () => void; onNext: () => void }) {
  const [places, setPlaces] = useState<EditablePlace[]>(draft.places.map(toEditablePlace))
  const [connections, setConnections] = useState<EditableConnection[]>(draft.connections.map(toEditableConnection))

  function addPlace() {
    const tempId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setPlaces(p => [...p, { tempId, name: '', description: '', type: 'GENERIC', x: 0, y: 0, isPublic: true, isDiscovered: true, capacity: null, resources: [], items: [], facilityStatus: '' }])
  }
  function updatePlace(tempId: string, patch: Partial<EditablePlace>) {
    setPlaces(current => current.map(p => (p.tempId === tempId ? { ...p, ...patch } : p)))
  }
  function removePlace(tempId: string) {
    setPlaces(current => current.filter(p => p.tempId !== tempId))
    setConnections(current => current.filter(c => c.fromPlaceRef !== tempId && c.toPlaceRef !== tempId))
  }
  function addConnection() {
    if (places.length < 2) return
    setConnections(c => [...c, { tempId: `newc-${Date.now()}`, fromPlaceRef: places[0].tempId, toPlaceRef: places[1].tempId, travelTime: 5, connectionType: 'PATH', blocked: false, requirements: '' }])
  }
  function updateConnection(tempId: string, patch: Partial<EditableConnection>) {
    setConnections(current => current.map(c => (c.tempId === tempId ? { ...c, ...patch } : c)))
  }
  function removeConnection(tempId: string) {
    setConnections(current => current.filter(c => c.tempId !== tempId))
  }

  async function save(andNext: boolean) {
    const res = await worldBuilderApi.savePlaces(
      draft.id,
      places.map(p => ({ id: p.id, tempId: p.tempId, name: p.name, description: p.description, type: p.type, x: p.x, y: p.y, isPublic: p.isPublic, isDiscovered: p.isDiscovered, capacity: p.capacity, resources: p.resources, items: p.items, facilityStatus: p.facilityStatus })),
      connections.map(c => ({ id: c.id, fromPlaceRef: c.fromPlaceRef, toPlaceRef: c.toPlaceRef, travelTime: c.travelTime, connectionType: c.connectionType, blocked: c.blocked, requirements: c.requirements })),
    )
    onSaved(res.draft)
    setPlaces(res.draft.places.map(toEditablePlace))
    setConnections(res.draft.connections.map(toEditableConnection))
    if (andNext) onNext()
  }

  return (
    <section className="admin-panel">
      <h2>04 · 지도 / 장소</h2>
      {places.map(place => (
        <div key={place.tempId} className="place-row">
          <div className="place-row-grid">
            <input placeholder="장소 이름" value={place.name} onChange={e => updatePlace(place.tempId, { name: e.target.value })} />
            <input placeholder="유형" value={place.type} onChange={e => updatePlace(place.tempId, { type: e.target.value })} />
            <input type="number" placeholder="x" value={place.x} onChange={e => updatePlace(place.tempId, { x: Number(e.target.value || 0) })} />
            <input type="number" placeholder="y" value={place.y} onChange={e => updatePlace(place.tempId, { y: Number(e.target.value || 0) })} />
            <input type="number" placeholder="수용 인원(비우면 무제한)" value={place.capacity ?? ''} onChange={e => updatePlace(place.tempId, { capacity: e.target.value ? Number(e.target.value) : null })} />
          </div>
          <textarea placeholder="설명" rows={2} value={place.description} onChange={e => updatePlace(place.tempId, { description: e.target.value })} />
          <input placeholder="물품 (쉼표로 구분)" value={place.items.join(', ')} onChange={e => updatePlace(place.tempId, { items: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
          <input placeholder="시설 상태" value={place.facilityStatus} onChange={e => updatePlace(place.tempId, { facilityStatus: e.target.value })} />
          <p className="world-micro">이 장소의 자원 · 식량 food / 물 water</p>
          {place.resources.map((resource, index) => <div className="place-row-grid" key={index}>
            <input aria-label="자원 키" value={resource.key} onChange={e => updatePlace(place.tempId, { resources: place.resources.map((r, i) => i === index ? { ...r, key: e.target.value } : r) })} />
            <input aria-label="자원 이름" value={resource.label} onChange={e => updatePlace(place.tempId, { resources: place.resources.map((r, i) => i === index ? { ...r, label: e.target.value } : r) })} />
            <input aria-label="현재 자원 수량" type="number" min={0} value={resource.level} onChange={e => updatePlace(place.tempId, { resources: place.resources.map((r, i) => i === index ? { ...r, level: Number(e.target.value) } : r) })} />
            <input aria-label="최대 자원 수량" type="number" min={0} value={resource.max} onChange={e => updatePlace(place.tempId, { resources: place.resources.map((r, i) => i === index ? { ...r, max: Number(e.target.value) } : r) })} />
            <button onClick={() => updatePlace(place.tempId, { resources: place.resources.filter((_, i) => i !== index) })}>자원 삭제</button>
          </div>)}
          <button onClick={() => updatePlace(place.tempId, { resources: [...place.resources, { key: '', label: '', level: 0, max: 100 }] })}>+ 장소 자원 추가</button>
          <div className="place-row-grid">
            <label className="world-filter-checkbox"><input type="checkbox" checked={place.isPublic} onChange={e => updatePlace(place.tempId, { isPublic: e.target.checked })} />공개</label>
            <label className="world-filter-checkbox"><input type="checkbox" checked={place.isDiscovered} onChange={e => updatePlace(place.tempId, { isDiscovered: e.target.checked })} />발견됨</label>
            <button onClick={() => removePlace(place.tempId)}>장소 삭제</button>
          </div>
        </div>
      ))}
      <button onClick={addPlace}>+ 장소 추가</button>

      <h3 className="micro" style={{ marginTop: 18 }}>장소 연결</h3>
      {connections.map(conn => (
        <div key={conn.tempId} className="connection-row">
          <div className="place-row-grid">
            <select value={conn.fromPlaceRef} onChange={e => updateConnection(conn.tempId, { fromPlaceRef: e.target.value })}>
              {places.map(p => <option key={p.tempId} value={p.tempId}>{p.name || '(이름 없음)'}</option>)}
            </select>
            <select value={conn.toPlaceRef} onChange={e => updateConnection(conn.tempId, { toPlaceRef: e.target.value })}>
              {places.map(p => <option key={p.tempId} value={p.tempId}>{p.name || '(이름 없음)'}</option>)}
            </select>
            <input type="number" placeholder="이동 시간(분)" value={conn.travelTime} onChange={e => updateConnection(conn.tempId, { travelTime: Number(e.target.value || 0) })} />
            <label className="world-filter-checkbox"><input type="checkbox" checked={conn.blocked} onChange={e => updateConnection(conn.tempId, { blocked: e.target.checked })} />봉쇄됨</label>
            <button onClick={() => removeConnection(conn.tempId)}>삭제</button>
          </div>
        </div>
      ))}
      <button onClick={addConnection} disabled={places.length < 2}>+ 연결 추가</button>

      <div className="builder-actions">
        <button onClick={onPrev}>← 이전</button>
        <div className="admin-button-row" style={{ marginTop: 0 }}>
          <button onClick={() => save(false)}>DRAFT 저장</button>
          <button onClick={() => save(true)}>저장하고 다음 →</button>
        </div>
      </div>
    </section>
  )
}

// --- STEP 5: CHARACTERS ---------------------------------------------------------

function StepCharacters({ draft, onSaved, onPrev, onNext }: { draft: DraftDTO; onSaved: (d: DraftDTO) => void; onPrev: () => void; onNext: () => void }) {
  const [generating, setGenerating] = useState(false)
  const [count, setCount] = useState(draft.targetPopulation)
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creatingManual, setCreatingManual] = useState(false)
  const [message, setMessage] = useState('')

  async function refresh() {
    const res = await worldBuilderApi.getDraft(draft.id)
    onSaved(res.draft)
  }

  async function generate() {
    setGenerating(true)
    setMessage('')
    try {
      const res = await worldBuilderApi.generateCharacters(draft.id, count, provider)
      await refresh()
      setMessage(res.usedDemo ? `${res.characters.length}명 생성됨 (DEMO 모드 — 실제 AI 호출 없음)` : `${res.characters.length}명 생성됨`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '캐릭터 생성 실패')
    } finally { setGenerating(false) }
  }

  async function regenerate(charId: string) {
    try {
      await worldBuilderApi.regenerateCharacter(draft.id, charId, provider)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '재생성 실패')
    }
  }

  async function remove(charId: string) {
    if (!window.confirm('이 캐릭터를 삭제할까요?')) return
    await worldBuilderApi.deleteCharacter(draft.id, charId)
    await refresh()
  }

  return (
    <section className="admin-panel">
      <h2>05 · 캐릭터 생성</h2>
      <p className="world-micro">현재 {draft.characters.length}명 / 목표 {draft.targetPopulation}명</p>

      <div className="world-operator-form" style={{ maxWidth: 480 }}>
        <label>Provider
          <select value={provider} onChange={e => setProvider(e.target.value as 'openai' | 'anthropic')}>
            <option value="openai">OpenAI (GPT)</option>
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </label>
        <label>MODE A — AI AUTO GENERATE (인원수)
          <input type="number" min={1} max={Math.max(0, (draft.maxActiveCharacters ?? draft.targetPopulation) - draft.characters.length)} value={count} onChange={e => setCount(Math.max(1, Number(e.target.value || 1)))} />
        </label>
        <button onClick={generate} disabled={generating}>{generating ? '생성 중…' : `${count}명 자동 생성`}</button>
      </div>
      {message && <p className="micro">{message}</p>}

      <div className="admin-button-row">
        <button onClick={() => setCreatingManual(true)}>MODE B — 캐릭터 직접 추가</button>
      </div>
      {creatingManual && (
        <CharacterForm draft={draft}
          onCancel={() => setCreatingManual(false)}
          onSave={async payload => { await worldBuilderApi.addCharacter(draft.id, payload); setCreatingManual(false); await refresh() }}
        />
      )}

      <div className="character-card-grid">
        {draft.characters.map(c => (
          <div key={c.id} className="character-card">
            <span className="character-card-tag">{c.source} · {c.provider}</span>
            <h4>{c.name || '(이름 없음)'}</h4>
            <span className="micro">{c.age ?? '?'}세 / {c.gender || '성별 미지정'} · {c.occupation}</span>
            <span className="micro">{c.personality.slice(0, 80)}{c.personality.length > 80 ? '…' : ''}</span>
            <div className="character-card-buttons">
              <button onClick={() => setEditingId(c.id)}>수정</button>
              <button onClick={() => regenerate(c.id)}>재생성(AI)</button>
              <button onClick={() => remove(c.id)}>삭제</button>
            </div>
          </div>
        ))}
      </div>

      {editingId && (
        <CharacterForm draft={draft} character={draft.characters.find(c => c.id === editingId)}
          onCancel={() => setEditingId(null)}
          onSave={async payload => { await worldBuilderApi.updateCharacter(draft.id, editingId, payload); setEditingId(null); await refresh() }}
        />
      )}

      <div className="builder-actions">
        <button onClick={onPrev}>← 이전</button>
        <button onClick={onNext}>다음 (CHARACTER REVIEW) →</button>
      </div>
    </section>
  )
}

function CharacterForm({ draft, character, onSave, onCancel }: {
  draft: DraftDTO; character?: CharacterDTO
  onSave: (payload: CharacterInputPayload) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<CharacterInputPayload>(character ? {
    name: character.name, age: character.age, gender: character.gender, appearance: character.appearance, background: character.background,
    occupation: character.occupation, personality: character.personality, goal: character.goal, strengths: character.strengths, weaknesses: character.weaknesses,
    provider: character.provider, model: character.model, humanState: character.humanState, emotion: character.emotion, knowledge: character.knowledge,
    privateInfo: character.privateInfo, inventory: character.inventory, initialPlaceId: character.initialPlaceId,
  } : {
    name: '', age: null, gender: '', appearance: '', background: '', occupation: '', personality: '', goal: '',
    strengths: [], weaknesses: [], provider: 'openai', model: '',
    humanState: { survival_need: 5, fatigue: 3, stress: 3, sexual_desire: 3, greed: 3, ambition: 4 },
    emotion: { mood: 6, anger: 2, fear: 2 }, knowledge: [], privateInfo: '', inventory: [], initialPlaceId: null,
  })
  const [saving, setSaving] = useState(false)

  function updateHumanState(key: keyof HumanState, value: number) {
    setForm(f => ({ ...f, humanState: { ...f.humanState, [key]: Math.min(10, Math.max(1, value)) } }))
  }
  function updateEmotion(key: keyof Emotion, value: number) {
    setForm(f => ({ ...f, emotion: { ...f.emotion, [key]: Math.min(10, Math.max(1, value)) } }))
  }

  async function submit() {
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <div className="admin-panel" style={{ background: '#0d171b' }}>
      <h3>{character ? `캐릭터 수정 — ${character.name}` : '캐릭터 직접 생성'}</h3>
      <div className="world-operator-form" style={{ maxWidth: 640 }}>
        <label>이름<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <div className="place-row-grid">
          <label>나이<input type="number" value={form.age ?? ''} onChange={e => setForm({ ...form, age: e.target.value ? Number(e.target.value) : null })} /></label>
          <label>성별<input value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })} /></label>
          <label>직업<input value={form.occupation} onChange={e => setForm({ ...form, occupation: e.target.value })} /></label>
        </div>
        <label>외형<textarea rows={2} value={form.appearance} onChange={e => setForm({ ...form, appearance: e.target.value })} /></label>
        <label>배경<textarea rows={2} value={form.background} onChange={e => setForm({ ...form, background: e.target.value })} /></label>
        <label>성격<textarea rows={3} value={form.personality} onChange={e => setForm({ ...form, personality: e.target.value })} /></label>
        <label>목표<input value={form.goal} onChange={e => setForm({ ...form, goal: e.target.value })} /></label>
        <label>장점 (쉼표로 구분)<input value={form.strengths.join(', ')} onChange={e => setForm({ ...form, strengths: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></label>
        <label>약점 (쉼표로 구분)<input value={form.weaknesses.join(', ')} onChange={e => setForm({ ...form, weaknesses: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></label>
        <div className="place-row-grid">
          <label>Provider
            <select value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })}>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label>초기 위치
            <select value={form.initialPlaceId ?? ''} onChange={e => setForm({ ...form, initialPlaceId: e.target.value || null })}>
              <option value="">선택 안 함</option>
              {draft.places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        <h4 className="micro">HUMAN STATE (1~10)</h4>
        <div className="place-row-grid">
          {(['survival_need', 'fatigue', 'stress', 'sexual_desire', 'greed', 'ambition'] as const).map(key => (
            <label key={key}>{key}<input type="number" min={1} max={10} value={form.humanState[key]} onChange={e => updateHumanState(key, Number(e.target.value || 1))} /></label>
          ))}
        </div>
        <h4 className="micro">EMOTION (1~10)</h4>
        <div className="place-row-grid">
          {(['mood', 'anger', 'fear'] as const).map(key => (
            <label key={key}>{key}<input type="number" min={1} max={10} value={form.emotion[key]} onChange={e => updateEmotion(key, Number(e.target.value || 1))} /></label>
          ))}
        </div>

        <label>초기 소지품 (쉼표로 구분)<input value={form.inventory.join(', ')} onChange={e => setForm({ ...form, inventory: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></label>
        <label>초기 KNOWLEDGE (한 줄에 하나씩)
          <textarea rows={3} value={form.knowledge.map(k => k.summary).join('\n')}
            onChange={e => setForm({ ...form, knowledge: e.target.value.split('\n').map(s => ({ summary: s.trim() })).filter(k => k.summary) })} />
        </label>
        <label>PRIVATE INFORMATION (비공개 배경/비밀)<textarea rows={2} value={form.privateInfo} onChange={e => setForm({ ...form, privateInfo: e.target.value })} /></label>
      </div>
      <div className="admin-button-row">
        <button onClick={submit} disabled={saving || !form.name.trim()}>{saving ? '저장 중…' : '저장'}</button>
        <button onClick={onCancel}>취소</button>
      </div>
    </div>
  )
}

// --- STEP 6: REVIEW --------------------------------------------------------------

function StepReview({ draft, onSaved, onPrev, onNext }: { draft: DraftDTO; onSaved: (d: DraftDTO) => void; onPrev: () => void; onNext: () => void }) {
  const [relationships, setRelationships] = useState<RelationshipDTO[]>(draft.relationships)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { worldBuilderApi.validate(draft.id).then(setValidation).catch(() => {}) }, [draft.id])

  function nameOf(id: string): string {
    return draft.characters.find(c => c.id === id)?.name || id
  }
  function addRow() {
    if (draft.characters.length < 2) return
    setRelationships(r => [...r, { id: `new-${Date.now()}`, fromCharacterId: draft.characters[0].id, toCharacterId: draft.characters[1].id, trust: 5, affection: 5, attraction: 1, note: '' }])
  }
  function updateRow(index: number, patch: Partial<RelationshipDTO>) {
    setRelationships(current => current.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }
  function removeRow(index: number) {
    setRelationships(current => current.filter((_, i) => i !== index))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await worldBuilderApi.saveRelationships(draft.id, relationships)
      setRelationships(res.relationships)
      const validated = await worldBuilderApi.validate(draft.id)
      setValidation(validated)
      const fresh = await worldBuilderApi.getDraft(draft.id)
      onSaved(fresh.draft)
    } finally { setSaving(false) }
  }

  const placementWarnings = draft.characters.filter(c => !c.initialPlaceId)

  return (
    <section className="admin-panel">
      <h2>06 · CHARACTER REVIEW</h2>

      {placementWarnings.length > 0 && (
        <ul className="builder-issue-list">
          {placementWarnings.map(c => <li key={c.id} className="warning">WARNING — "{c.name || '이름 없음'}"의 초기 위치가 설정되지 않았습니다. (05단계에서 수정)</li>)}
        </ul>
      )}

      <h3 className="micro">초기 관계 (방향성 있음: A→B와 B→A는 별개)</h3>
      {relationships.map((rel, index) => (
        <div key={rel.id} className="relationship-row">
          <div className="place-row-grid">
            <select value={rel.fromCharacterId} onChange={e => updateRow(index, { fromCharacterId: e.target.value })}>
              {draft.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="micro" style={{ alignSelf: 'center' }}>→</span>
            <select value={rel.toCharacterId} onChange={e => updateRow(index, { toCharacterId: e.target.value })}>
              {draft.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label>trust<input type="number" min={1} max={10} value={rel.trust} onChange={e => updateRow(index, { trust: Number(e.target.value || 1) })} /></label>
            <label>affection<input type="number" min={1} max={10} value={rel.affection} onChange={e => updateRow(index, { affection: Number(e.target.value || 1) })} /></label>
            <label>attraction<input type="number" min={1} max={10} value={rel.attraction} onChange={e => updateRow(index, { attraction: Number(e.target.value || 1) })} /></label>
          </div>
          <input placeholder={`예: ${nameOf(rel.fromCharacterId)}는 ${nameOf(rel.toCharacterId)}의 직장 동료였다.`} value={rel.note} onChange={e => updateRow(index, { note: e.target.value })} />
          <button onClick={() => removeRow(index)}>이 관계 삭제</button>
        </div>
      ))}
      <button onClick={addRow} disabled={draft.characters.length < 2}>+ 관계 추가</button>

      {validation && (
        <div style={{ marginTop: 16 }}>
          <h3 className="micro">START WORLD 검증 미리보기</h3>
          {validation.ok && validation.warnings.length === 0 && <p className="micro">문제가 발견되지 않았습니다.</p>}
          <ul className="builder-issue-list">
            {validation.errors.map(e => <li key={e.code}>{e.message}</li>)}
            {validation.warnings.map(w => <li key={w.code} className="warning">{w.message}</li>)}
          </ul>
        </div>
      )}

      <div className="builder-actions">
        <button onClick={onPrev}>← 이전</button>
        <div className="admin-button-row" style={{ marginTop: 0 }}>
          <button onClick={save} disabled={saving}>관계 저장</button>
          <button onClick={onNext}>다음 (FINAL REVIEW) →</button>
        </div>
      </div>
    </section>
  )
}

// --- STEP 7: START -----------------------------------------------------------------

function StepStart({ draft, onPrev }: { draft: DraftDTO; onPrev: () => void }) {
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [starting, setStarting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { worldBuilderApi.validate(draft.id).then(setValidation).catch(() => {}) }, [draft.id])

  const providerCounts = draft.characters.reduce<Record<string, number>>((acc, c) => { acc[c.provider] = (acc[c.provider] ?? 0) + 1; return acc }, {})

  async function start() {
    if (!window.confirm('START WORLD를 실행하면 현재 시뮬레이션이 이 WORLD로 대체됩니다. 계속할까요?')) return
    setStarting(true)
    setMessage('')
    try {
      const res = await worldBuilderApi.start(draft.id)
      if (!res.ok) {
        setMessage('검증 실패 — 아래 오류를 확인하세요.')
        const revalidated = await worldBuilderApi.validate(draft.id)
        setValidation(revalidated)
      } else {
        navigate('/admin/world')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'START WORLD 실패')
    } finally { setStarting(false) }
  }

  return (
    <section className="admin-panel">
      <h2>07 · WORLD 최종 검토 및 시작</h2>
      <dl className="world-kv world-kv--inline">
        <div><dt>WORLD 이름</dt><dd>{draft.name}</dd></div>
        <div><dt>시즌</dt><dd>{draft.seasonName || '-'}</dd></div>
        <div><dt>DAY 1</dt><dd>{draft.startDay}일 {draft.startTime} · {draft.startWeather} · {draft.startTemperatureC}°C</dd></div>
        <div><dt>장소 수</dt><dd>{draft.places.length}</dd></div>
        <div><dt>장소 연결 수</dt><dd>{draft.connections.length}</dd></div>
        <div><dt>캐릭터 수</dt><dd>{draft.characters.length}</dd></div>
        <div><dt>provider 구성</dt><dd>{Object.entries(providerCounts).map(([p, n]) => `${p}:${n}`).join(', ') || '-'}</dd></div>
        <div><dt>초기 관계 수</dt><dd>{draft.relationships.length}</dd></div>
        <div><dt>Hidden World Truth</dt><dd>{draft.hiddenWorldTruth ? '설정됨' : '없음'}</dd></div>
        <div><dt>종료 조건</dt><dd>{draft.endCondition || '-'}</dd></div>
      </dl>

      {validation && (
        <div style={{ marginTop: 16 }}>
          <ul className="builder-issue-list">
            {validation.errors.map(e => <li key={e.code}>{e.message}</li>)}
            {validation.warnings.map(w => <li key={w.code} className="warning">{w.message}</li>)}
          </ul>
        </div>
      )}
      {message && <p className="micro">{message}</p>}

      <div className="builder-actions">
        <button onClick={onPrev}>← 이전</button>
        <button onClick={start} disabled={starting || Boolean(validation && !validation.ok)}>{starting ? '시작하는 중…' : 'START WORLD'}</button>
      </div>
    </section>
  )
}
