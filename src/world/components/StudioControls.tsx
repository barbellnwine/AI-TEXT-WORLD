import { useEffect, useState } from 'react'

export function NumberControl({ label, value, onChange, min = 0, max = 10, step = 1, hint = '', nullable = false }: { label: string; value: number | null; onChange: (n: number | null) => void; min?: number; max?: number; step?: number; hint?: string; nullable?: boolean }) {
  const [raw, setRaw] = useState(String(value ?? ''))
  useEffect(() => setRaw(String(value ?? '')), [value])
  function commit(next = raw) { const n = next.trim() === '' && nullable ? null : Math.min(max, Math.max(min, Number.isFinite(Number(next)) && next !== '' ? Number(next) : value ?? min)); setRaw(String(n ?? '')); onChange(n) }
  function adjust(amount: number) { commit(String((raw === '' ? value ?? min : Number(raw)) + amount)) }
  return <label className="studio-number" title={hint}>{label}<span className="studio-stepper"><button type="button" aria-label={`${label} 감소`} onClick={() => adjust(-step)}>−</button><input aria-label={label} type="number" inputMode="decimal" value={raw} min={min} max={max} step={step} onChange={e => { setRaw(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n) }} onBlur={() => commit()} onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); adjust(e.key === 'ArrowUp' ? step : -step) } }} /><button type="button" aria-label={`${label} 증가`} onClick={() => adjust(step)}>+</button></span>{hint && <small>{hint}</small>}</label>
}
export function Tags({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [custom, setCustom] = useState('')
  return <fieldset className="studio-tags"><legend>{label}</legend><div>{[...new Set([...options, ...value])].map(v => <button type="button" key={v} aria-pressed={value.includes(v)} onClick={() => onChange(value.includes(v) ? value.filter(t => t !== v) : [...value, v])}>{v}</button>)}</div><div className="studio-inline"><input aria-label={`${label} 사용자 정의`} value={custom} placeholder="직접 추가" onChange={e => setCustom(e.target.value)} /><button type="button" onClick={() => { if (custom.trim()) onChange([...new Set([...value, custom.trim()])]); setCustom('') }}>추가</button></div></fieldset>
}
export function Impact({ display = false }: { display?: boolean }) { return <small className="studio-impact" title={display ? '관전자에게 보여주는 설명이며 세계 규칙이나 행동 조건으로 사용하지 않습니다.' : '저장 후 시작하면 엔진 상태 또는 AI 행동 판단에 전달됩니다.'}>{display ? '👁 표시용' : '⚙ 시뮬레이션 반영'}</small> }
