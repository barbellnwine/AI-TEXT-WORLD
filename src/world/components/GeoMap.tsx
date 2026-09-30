import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { WorldState } from '../types'
import { TERRAIN_BY_CODE, type GeoPoint, type Terrain, type WorldGeo } from '../../../server/world/geo/geoTypes'

// Continuous top-down map. SVG user units ARE simulation meters: a marker is drawn exactly at
// agent.publicState.coord, with no per-place layout or offsets.
const TERRAIN_LABEL: Record<Terrain, string> = { GRASS: '풀밭', FOREST: '숲', BEACH: '모래사장', ROCK: '바위 지대', CLIFF: '절벽', WATER: '물', RIVER: '강', RUINS: '폐허', URBAN: '건물 지대' }

function terrainAt(geo: WorldGeo, p: GeoPoint): Terrain {
  const col = Math.min(geo.cols - 1, Math.max(0, Math.floor(p.x / geo.cellMeters)))
  const row = Math.min(geo.rows - 1, Math.max(0, Math.floor(p.y / geo.cellMeters)))
  return TERRAIN_BY_CODE[geo.cells[row * geo.cols + col]] ?? 'GRASS'
}

// Horizontal runs of equal terrain: far fewer rects than one per cell.
function terrainRuns(geo: WorldGeo) {
  const runs: Array<{ x: number; y: number; w: number; terrain: Terrain }> = []
  for (let row = 0; row < geo.rows; row++) {
    let start = 0
    for (let col = 1; col <= geo.cols; col++) {
      const code = geo.cells[row * geo.cols + start]
      if (col < geo.cols && geo.cells[row * geo.cols + col] === code) continue
      runs.push({ x: start * geo.cellMeters, y: row * geo.cellMeters, w: (col - start) * geo.cellMeters, terrain: TERRAIN_BY_CODE[code] ?? 'GRASS' })
      start = col
    }
  }
  return runs
}

export function GeoMap({ state, selectedAgentId, onSelectAgent }: { state: WorldState; selectedAgentId: string | null; onSelectAgent: (id: string | null) => void }) {
  const geo = state.engine!.geo!
  const W = geo.widthMeters, H = geo.heightMeters, minute = state.engine!.minute
  const [view, setView] = useState({ x: 0, y: 0, w: W })
  const [large, setLarge] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const runs = useMemo(() => terrainRuns(geo), [geo.cells, geo.cols, geo.rows, geo.cellMeters])
  const placeName = (id: string | null | undefined) => state.places.find(p => p.id === id)?.name ?? ''
  const agents = state.agents.filter(a => a.publicState.coord)
  const selected = agents.find(a => a.id === selectedAgentId)
  const h = view.w * H / W, unit = view.w / 400

  const clampView = (v: { x: number; y: number; w: number }) => {
    const w = Math.min(W, Math.max(150, v.w)), vh = w * H / W
    return { w, x: Math.min(W - w, Math.max(0, v.x)), y: Math.min(H - vh, Math.max(0, v.y)) }
  }
  const zoom = (factor: number, at?: GeoPoint) => setView(v => {
    const c = at ?? { x: v.x + v.w / 2, y: v.y + v.w * H / W / 2 }, w = v.w * factor
    return clampView({ w, x: c.x - (c.x - v.x) * factor, y: c.y - (c.y - v.y) * factor })
  })
  // Wheel zoom around the cursor (a non-passive listener so the page doesn't scroll instead).
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setView(v => {
        const at = { x: v.x + (e.clientX - r.left) / r.width * v.w, y: v.y + (e.clientY - r.top) / r.height * v.w * H / W }
        const f = e.deltaY > 0 ? 1.2 : 1 / 1.2, w = v.w * f
        return clampView({ w, x: at.x - (at.x - v.x) * f, y: at.y - (at.y - v.y) * f })
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [W, H])
  function startPan(down: ReactPointerEvent<HTMLDivElement>) {
    const el = box.current
    if (!el || (down.target instanceof Element && down.target.closest('.geo-agent'))) return
    const r = el.getBoundingClientRect(), start = { ...view }, sx = down.clientX, sy = down.clientY
    el.setPointerCapture(down.pointerId)
    const onMove = (m: PointerEvent) => setView(clampView({ w: start.w, x: start.x - (m.clientX - sx) / r.width * start.w, y: start.y - (m.clientY - sy) / r.height * start.w * H / W }))
    const onUp = () => { el.releasePointerCapture(down.pointerId); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp) }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }
  const focus = (p: GeoPoint) => setView(clampView({ w: 500, x: p.x - 250, y: p.y - 250 * H / W }))
  const remaining = (a: typeof agents[number]) => {
    const t = a.publicState.travel
    if (!t) return null
    return [a.publicState.coord!, ...t.path.filter(p => p.minute > minute).map(p => ({ x: p.x, y: p.y }))]
  }

  return <>
    <div className={`world-minimap geo-map${large ? ' geo-map-large' : ''}`} ref={box} onPointerDown={startPan}>
      <span className="map-compass" aria-hidden="true">N ↑</span>
      <div className="geo-map-controls">
        <button type="button" onClick={() => zoom(1 / 1.5)} aria-label="확대">＋</button>
        <button type="button" onClick={() => zoom(1.5)} aria-label="축소">－</button>
        <button type="button" onClick={() => setView({ x: 0, y: 0, w: W })}>전체</button>
        <button type="button" onClick={() => setLarge(!large)}>{large ? '작게' : '크게'}</button>
      </div>
      <svg viewBox={`${view.x} ${view.y} ${view.w} ${h}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="WORLD 지도">
        <g aria-hidden="true">{runs.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w + 0.5} height={geo.cellMeters + 0.5} className={`geo-t geo-t-${r.terrain}`} />)}</g>
        {geo.regions.filter(r => r.kind === 'TERRAIN').map(r => <text key={r.placeId} x={r.center.x} y={r.center.y} className="geo-region-label" fontSize={unit * 11} textAnchor="middle">{placeName(r.placeId)}</text>)}
        {geo.regions.filter(r => r.kind === 'POI').map(r => <g key={r.placeId} className="geo-poi">
          <circle cx={r.center.x} cy={r.center.y} r={r.radius} className="geo-poi-area" />
          <rect x={r.center.x - unit * 3} y={r.center.y - unit * 3} width={unit * 6} height={unit * 6} transform={`rotate(45 ${r.center.x} ${r.center.y})`} className="geo-poi-mark" />
          <text x={r.center.x} y={r.center.y - unit * 7} fontSize={unit * 9} textAnchor="middle" className="geo-poi-label">{placeName(r.placeId)}</text>
        </g>)}
        {agents.map(a => {
          const path = remaining(a)
          return path && (a.id === selectedAgentId || !selectedAgentId) ? <g key={`trip-${a.id}`} className="geo-trip">
            <polyline points={path.map(p => `${p.x},${p.y}`).join(' ')} strokeWidth={unit * 1.4} strokeDasharray={`${unit * 4} ${unit * 3}`} />
            <circle cx={path.at(-1)!.x} cy={path.at(-1)!.y} r={unit * 3.5} strokeWidth={unit} />
          </g> : null
        })}
        {agents.map(a => <g key={a.id} className={`geo-agent${a.id === selectedAgentId ? ' is-selected' : ''}${a.publicState.status === 'deceased' ? ' is-dead' : ''}`}
          transform={`translate(${a.publicState.coord!.x} ${a.publicState.coord!.y})`} role="button" tabIndex={0} aria-label={a.name} aria-pressed={a.id === selectedAgentId}
          onClick={() => onSelectAgent(a.id === selectedAgentId ? null : a.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectAgent(a.id === selectedAgentId ? null : a.id) } }}>
          <title>{a.name}</title>
          <circle r={unit * 8} className="geo-agent-target" />
          <circle r={unit * 3.2} className="geo-agent-dot" strokeWidth={unit} />
          {a.id === selectedAgentId && <text y={unit * 13} fontSize={unit * 10} textAnchor="middle" className="geo-agent-label">{a.name}</text>}
        </g>)}
      </svg>
    </div>
    <div className="minimap-legend"><span><i />등장인물</span><span><i className="selected-dot" />선택</span><span><i className="geo-legend-poi" />장소(POI)</span>{selectedAgentId && <button type="button" onClick={() => onSelectAgent(null)}>선택 해제</button>}</div>
    {selected && <dl className="geo-agent-info">
      <div><dt>이름</dt><dd>{selected.name}{selected.publicState.status === 'deceased' ? ' (사망)' : ''}</dd></div>
      <div><dt>좌표</dt><dd>X {Math.round(selected.publicState.coord!.x)}m · Y {Math.round(selected.publicState.coord!.y)}m</dd></div>
      <div><dt>위치</dt><dd>{placeName(selected.publicState.locationId)} · {TERRAIN_LABEL[terrainAt(geo, selected.publicState.coord!)]}</dd></div>
      <div><dt>이동</dt><dd>{selected.publicState.travel ? `${placeName(selected.publicState.travel.destinationPlaceId) || '목적지'}(으)로 이동 중 · 약 ${Math.max(0, selected.publicState.travel.arriveMinute - minute)}분 남음` : '멈춰 있음'}</dd></div>
      <div><dd><button type="button" onClick={() => focus(selected.publicState.coord!)}>이 위치로 확대</button></dd></div>
    </dl>}
    <p className="map-caption">{W}×{H}m · 시뮬레이션 좌표 그대로 표시 · 휠/버튼으로 확대, 드래그로 이동</p>
  </>
}
