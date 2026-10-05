import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ChronicleEntry, WorldState } from '../types'
import { combatMark, type CombatMark } from '../combatMarks'
import { Icon, ICON_PATHS } from '../../components/Icon'
import { TERRAIN_BY_CODE, type GeoPoint, type Terrain, type WorldGeo } from '../../../server/world/geo/geoTypes'

// The map IS the simulation. SVG user units are simulation metres and the painted island fills
// (0,0)-(width,height), so a marker drawn at agent.publicState.coord sits exactly where the engine
// says that person stands. Nothing here invents a position, a path or a place.
const TERRAIN_LABEL: Record<Terrain, string> = { GRASS: '풀밭', FOREST: '숲', BEACH: '모래사장', ROCK: '바위 지대', CANYON: '협곡', CLIFF: '절벽', WATER: '물', RIVER: '강', RUINS: '폐허', URBAN: '건물 지대' }

// How long a marker takes to glide from the last server position to the new one. Tick updates
// arrive in steps; the eye should see one continuous walk, never a teleport.
const GLIDE_MS = 1100
const TRAIL_POINTS = 8
// How long the camera takes to travel to the person you just picked from the character list.
const PAN_MS = 520

// A body and an open wound read the same wherever a character is named: on the map, in the panel,
// and in the character list. Driven by the engine's own status, never by a fresh judgement.
export function statusIcon(status: string): 'skull' | 'blood' | null {
  return status === 'deceased' ? 'skull' : status === 'injured' ? 'blood' : null
}

// One of those glyphs drawn into the map's own metres, centred on (0,0) of the enclosing group.
function MapGlyph({ name, size, className }: { name: keyof typeof ICON_PATHS; size: number; className: string }) {
  return <g className={className} transform={`scale(${size / 24}) translate(-12 -12)`}>
    <path d={ICON_PATHS[name]} vectorEffect="non-scaling-stroke" />
  </g>
}

function terrainAt(geo: WorldGeo, p: GeoPoint): Terrain {
  const col = Math.min(geo.cols - 1, Math.max(0, Math.floor(p.x / geo.cellMeters)))
  const row = Math.min(geo.rows - 1, Math.max(0, Math.floor(p.y / geo.cellMeters)))
  return TERRAIN_BY_CODE[geo.cells[row * geo.cols + col]] ?? 'GRASS'
}

// Horizontal runs of equal terrain — the fallback picture for worlds with no painted map.
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

// The outline of the ground a region owns, as the cells the engine assigned to it. Used to shade
// a zone the island is closing — the same cells that will actually start hurting people.
function regionCells(geo: WorldGeo, placeId: string) {
  const index = geo.regions.findIndex(r => r.placeId === placeId)
  if (index < 0) return []
  const rects: Array<{ x: number; y: number; w: number }> = []
  for (let row = 0; row < geo.rows; row++) {
    let start = -1
    for (let col = 0; col <= geo.cols; col++) {
      const owned = col < geo.cols && geo.cellRegion[row * geo.cols + col] === index && TERRAIN_BY_CODE[geo.cells[row * geo.cols + col]] !== 'WATER'
      if (owned && start < 0) start = col
      if (!owned && start >= 0) { rects.push({ x: start * geo.cellMeters, y: row * geo.cellMeters, w: (col - start) * geo.cellMeters }); start = -1 }
    }
  }
  return rects
}

// Glides every marker from where it was drawn to where the engine now says it is.
function useGlidingPositions(targets: Array<{ id: string; coord: GeoPoint }>): Map<string, GeoPoint> {
  const shown = useRef(new Map<string, GeoPoint>())
  const legs = useRef(new Map<string, { from: GeoPoint; to: GeoPoint; start: number }>())
  const frame = useRef(0)
  const [, repaint] = useState(0)
  const key = targets.map(t => `${t.id}:${Math.round(t.coord.x)}:${Math.round(t.coord.y)}`).join('|')

  useEffect(() => {
    const now = performance.now()
    let moving = false
    for (const { id, coord } of targets) {
      const current = shown.current.get(id)
      if (!current) { shown.current.set(id, coord); continue }
      if (Math.round(current.x) === Math.round(coord.x) && Math.round(current.y) === Math.round(coord.y)) continue
      legs.current.set(id, { from: current, to: coord, start: now })
      moving = true
    }
    for (const id of [...shown.current.keys()]) if (!targets.some(t => t.id === id)) { shown.current.delete(id); legs.current.delete(id) }
    if (!moving) return
    const step = () => {
      const t = performance.now()
      let running = false
      for (const [id, leg] of legs.current) {
        const progress = Math.min(1, (t - leg.start) / GLIDE_MS)
        // Ease out: a walker slows into the spot the engine reported rather than snapping to it.
        const eased = 1 - (1 - progress) * (1 - progress)
        shown.current.set(id, { x: leg.from.x + (leg.to.x - leg.from.x) * eased, y: leg.from.y + (leg.to.y - leg.from.y) * eased })
        if (progress >= 1) legs.current.delete(id)
        else running = true
      }
      repaint(n => n + 1)
      if (running) frame.current = requestAnimationFrame(step)
    }
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [key])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return new Map(targets.map(t => [t.id, shown.current.get(t.id) ?? t.coord]))
}

const SUPPLY_LABEL: Record<string, string> = { food: '식량', water: '식수', medicine: '의약품', tool: '장비', item: '보급품', fuel: '연료' }

export function GeoMap({ state, selectedAgentId, onSelectAgent, scene }: { state: WorldState; selectedAgentId: string | null; onSelectAgent: (id: string | null) => void; scene?: ChronicleEntry | null }) {
  const geo = state.engine!.geo!
  const W = geo.widthMeters, H = geo.heightMeters, minute = state.engine!.minute
  const [view, setView] = useState({ x: 0, y: 0, w: W })
  // The live viewport, readable from an animation frame without restarting it on every repaint.
  const viewRef = useRef(view)
  viewRef.current = view
  const [large, setLarge] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // The camera ride to a newly picked character. It yields the moment the viewer touches the map
  // themselves, so a drag, a wheel or a zoom button is never fought by a running animation.
  const panFrame = useRef(0)
  const stopAutoPan = () => cancelAnimationFrame(panFrame.current)
  const reducedMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const runs = useMemo(() => geo.image ? [] : terrainRuns(geo), [geo.image, geo.cells, geo.cols, geo.rows, geo.cellMeters])
  const placeName = (id: string | null | undefined) => state.places.find(p => p.id === id)?.name ?? ''
  const agents = state.agents.filter(a => a.publicState.coord)
  const living = agents.filter(a => a.publicState.status !== 'deceased')
  const selected = agents.find(a => a.id === selectedAgentId)
  // `unit` is a fixed fraction of the visible width, so anything sized in units keeps the same
  // size on screen at every zoom level. Closing in dims the painted map — its place names are part
  // of the picture and cannot be switched off — and grows the markers, so the people win the eye.
  const h = view.w * H / W, unit = view.w / 400
  const closeness = Math.min(1, Math.max(0, (1 - view.w / W) * 1.6))
  const close = view.w < W * 0.62
  const mark = close ? 1.5 : 1

  // Where this LIVE scene's fight happened, fixed the moment the scene arrives: the people who
  // fought walk on afterwards, and the mark has to stay on the ground where it happened. Keyed on
  // the scene id alone, so it lives exactly as long as the scene does — a new scene recomputes it
  // (to nothing, when that scene held no fight) and nothing else can expire it.
  const combat: CombatMark | null = useMemo(() => scene ? combatMark(scene, state.agents, geo) : null, [scene?.id])

  const zones = state.engine?.zones ?? []
  const fighting = new Set(state.engine?.fighting ?? [])
  const supplies = (state.engine?.objects ?? []).filter(o => o.coord && o.location.kind === 'place' && o.quantity > 0 && o.condition !== 'destroyed')
  const zoneAreas = useMemo(() => zones.map(z => ({ ...z, rects: regionCells(geo, z.placeId) })), [geo, zones.map(z => `${z.placeId}:${z.closed}`).join()])
  // Names close enough to collide at this zoom: keep the first, drop the crowd behind it. A place
  // the island is closing already shows its name with a countdown, so it is not labelled twice.
  const spacedLabels = geo.regions.filter((r, i) => {
    if (zones.some(z => z.placeId === r.placeId)) return false
    const here = r.label ?? r.center
    return !geo.regions.slice(0, i).some(other => {
      const there = other.label ?? other.center
      return Math.hypot(here.x - there.x, here.y - there.y) < view.w * 0.17
    })
  })

  // Markers follow the engine; the glide only fills the gap between two reported positions.
  const positions = useGlidingPositions(living.map(a => ({ id: a.id, coord: a.publicState.coord! })))
  const trails = useRef(new Map<string, GeoPoint[]>())
  for (const a of living) {
    const trail = trails.current.get(a.id) ?? []
    const last = trail.at(-1), now = a.publicState.coord!
    if (!last || Math.hypot(last.x - now.x, last.y - now.y) > 8) trails.current.set(a.id, [...trail, now].slice(-TRAIL_POINTS))
  }
  const at = (a: typeof agents[number]) => positions.get(a.id) ?? a.publicState.coord!
  // Where a person is facing: the next waypoint of their trip, else the way they just came from.
  const heading = (a: typeof agents[number]): GeoPoint | null => {
    const travel = a.publicState.travel
    const now = at(a)
    const next = travel?.path.find(p => p.minute > minute) ?? travel?.to
    if (next && Math.hypot(next.x - now.x, next.y - now.y) > 4) return next
    const trail = trails.current.get(a.id) ?? []
    const back = trail.at(-2)
    return back && Math.hypot(back.x - now.x, back.y - now.y) > 4 ? { x: now.x * 2 - back.x, y: now.y * 2 - back.y } : null
  }

  const clampView = (v: { x: number; y: number; w: number }) => {
    const w = Math.min(W, Math.max(150, v.w)), vh = w * H / W
    return { w, x: Math.min(W - w, Math.max(0, v.x)), y: Math.min(H - vh, Math.max(0, v.y)) }
  }
  const zoom = (factor: number, at?: GeoPoint) => {
    stopAutoPan()
    setView(v => {
      const c = at ?? { x: v.x + v.w / 2, y: v.y + v.w * H / W / 2 }, w = v.w * factor
      return clampView({ w, x: c.x - (c.x - v.x) * factor, y: c.y - (c.y - v.y) * factor })
    })
  }
  // Wheel zoom around the cursor (a non-passive listener so the page doesn't scroll instead).
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      stopAutoPan()
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
    // Dragging the map must not start on something you meant to press: capturing the pointer here
    // would swallow the button's own click.
    if (!el || (down.target instanceof Element && down.target.closest('.geo-agent, .geo-map-controls'))) return
    stopAutoPan()
    const r = el.getBoundingClientRect(), start = { ...view }, sx = down.clientX, sy = down.clientY
    el.setPointerCapture(down.pointerId)
    const onMove = (m: PointerEvent) => setView(clampView({ w: start.w, x: start.x - (m.clientX - sx) / r.width * start.w, y: start.y - (m.clientY - sy) / r.height * start.w * H / W }))
    const onUp = () => { el.releasePointerCapture(down.pointerId); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp) }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }
  const focus = (p: GeoPoint) => setView(clampView({ w: 500, x: p.x - 250, y: p.y - 250 * H / W }))

  // Picking someone in the character list brings the camera to them. The target is the agent's
  // engine coord, so the camera lands exactly where the marker is drawn, and only the centre moves:
  // view.w is read live from state every frame, so the zoom the viewer set is carried through
  // untouched and clampView keeps the viewport inside the island at all times.
  const focusCoord = selected?.publicState.coord
  // Keyed on the id alone: the camera travels when the selection changes, not on every tick the
  // selected person walks a metre — following them continuously would fight the viewer's own drag.
  const focusKey = focusCoord ? selectedAgentId : null
  useEffect(() => {
    if (!focusKey || !focusCoord) return
    const from = viewRef.current
    const fromCentre = { x: from.x + from.w / 2, y: from.y + from.w * H / W / 2 }
    const centre = (c: GeoPoint, w: number) => clampView({ w, x: c.x - w / 2, y: c.y - w * H / W / 2 })
    // Already in the middle of the view: nothing to animate.
    if (Math.hypot(fromCentre.x - focusCoord.x, fromCentre.y - focusCoord.y) < 1) return
    if (reducedMotion) { setView(v => centre(focusCoord, v.w)); return }
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / PAN_MS)
      const ease = t * t * (3 - 2 * t)
      setView(v => centre({ x: fromCentre.x + (focusCoord.x - fromCentre.x) * ease, y: fromCentre.y + (focusCoord.y - fromCentre.y) * ease }, v.w))
      if (t < 1) panFrame.current = requestAnimationFrame(step)
    }
    stopAutoPan()
    panFrame.current = requestAnimationFrame(step)
    return stopAutoPan
  }, [focusKey])
  useEffect(() => stopAutoPan, [])
  const remaining = (a: typeof agents[number]) => {
    const t = a.publicState.travel
    if (!t) return null
    return [at(a), ...t.path.filter(p => p.minute > minute).map(p => ({ x: p.x, y: p.y }))]
  }
  const closingIn = (z: { effectiveMinute: number }) => Math.max(0, z.effectiveMinute - minute)

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
        {/* The island itself: one painted picture, drawn once and never per tick. */}
        {geo.image
          ? <image href={geo.image} x={0} y={0} width={W} height={H} preserveAspectRatio="none" aria-hidden="true" />
          : <g aria-hidden="true">{runs.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w + 0.5} height={geo.cellMeters + 0.5} className={`geo-t geo-t-${r.terrain}`} />)}</g>}
        {/* The further in you look, the further back the artwork steps — including its own labels. */}
        {geo.image && closeness > 0 && <rect className="geo-scrim" x={0} y={0} width={W} height={H} fillOpacity={closeness * 0.34} aria-hidden="true" />}

        {zoneAreas.map(z => <g key={z.placeId} className={`geo-zone${z.closed ? ' is-closed' : ' is-closing'}`} aria-hidden="true">
          {z.rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={geo.cellMeters} />)}
          <text x={(geo.regions.find(r => r.placeId === z.placeId)?.center.x ?? 0)} y={(geo.regions.find(r => r.placeId === z.placeId)?.center.y ?? 0)}
            fontSize={unit * 11} textAnchor="middle" className="geo-zone-label">
            {z.closed ? `${placeName(z.placeId)} 폐쇄` : `${placeName(z.placeId)} ${Math.floor(closingIn(z) / 60)}시간 후 폐쇄`}
          </text>
        </g>)}

        {!close && spacedLabels.map(r => <text key={r.placeId} x={r.label?.x ?? r.center.x} y={r.label?.y ?? r.center.y}
          className={`geo-region-label${r.kind === 'POI' ? ' is-poi' : ''}`} fontSize={unit * (r.kind === 'POI' ? 10 : 12)}
          strokeWidth={unit * 1.1} textAnchor="middle">{placeName(r.placeId)}</text>)}

        {supplies.map(o => <g key={o.id} className="geo-supply">
          <title>{`${o.name} (${SUPPLY_LABEL[o.kind] ?? '보급품'})`}</title>
          <rect x={o.coord!.x - unit * 3} y={o.coord!.y - unit * 3} width={unit * 6} height={unit * 6} rx={unit} strokeWidth={unit * 0.8} />
          <line x1={o.coord!.x - unit * 3} y1={o.coord!.y} x2={o.coord!.x + unit * 3} y2={o.coord!.y} strokeWidth={unit * 0.8} />
        </g>)}

        {/* Where this scene's fight happened. Gunfire carries the translucent report; a close-quarters
            fight is the blade alone. The icon rides above the spot so it never covers a marker. */}
        {combat && <g className={`geo-combat geo-combat-${combat.kind}`} role="img"
          aria-label={combat.kind === 'gunfire' ? '이 장면의 총격 지점' : '이 장면의 근접전 지점'}
          transform={`translate(${combat.coord.x} ${combat.coord.y})`}>
          <title>{combat.kind === 'gunfire' ? '총격' : '근접전'}</title>
          {combat.kind === 'gunfire' && <>
            <circle className="geo-combat-blast" r={unit * 30} />
            <circle className="geo-combat-ring" r={unit * 30} strokeWidth={unit * 1.2} />
          </>}
          <g transform={`translate(0 ${-unit * 15})`}>
            <MapGlyph name={combat.kind === 'gunfire' ? 'gun' : 'blade'} size={unit * 22} className="geo-combat-icon" />
          </g>
        </g>}

        {living.map(a => {
          const path = remaining(a)
          return path && (a.id === selectedAgentId || !selectedAgentId) ? <g key={`trip-${a.id}`} className="geo-trip">
            <polyline points={path.map(p => `${p.x},${p.y}`).join(' ')} strokeWidth={unit * 1.4} strokeDasharray={`${unit * 4} ${unit * 3}`} />
            <circle cx={path.at(-1)!.x} cy={path.at(-1)!.y} r={unit * 3.5} strokeWidth={unit} />
          </g> : null
        })}

        {living.map(a => {
          // Only someone who has actually walked leaves a trail; standing still draws nothing.
          const walked = trails.current.get(a.id) ?? []
          return walked.length > 1
            ? <polyline key={`trail-${a.id}`} className="geo-trail" points={[...walked, at(a)].map(p => `${p.x},${p.y}`).join(' ')} strokeWidth={unit * 1.2} />
            : null
        })}

        {agents.map(a => {
          const p = at(a), face = heading(a)
          const angle = face ? Math.atan2(face.y - p.y, face.x - p.x) * 180 / Math.PI : null
          const picked = a.id === selectedAgentId
          const dot = unit * (picked ? 5.4 : 4.4) * mark
          // A name tag only earns its space up close, or when it is the person being followed.
          const named = picked || close
          const font = unit * (picked ? 13 : 11) * mark
          const status = statusIcon(a.publicState.status)
          const tag = { w: a.name.length * font * 1.06 + font * 0.9, h: font * 1.5, top: dot + unit * 2 * mark }
          return <g key={a.id} className={`geo-agent${picked ? ' is-selected' : ''}${a.publicState.status === 'deceased' ? ' is-dead' : ''}${fighting.has(a.id) ? ' is-fighting' : ''}`}
            transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0} aria-label={a.name} aria-pressed={picked}
            onClick={() => onSelectAgent(picked ? null : a.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectAgent(picked ? null : a.id) } }}>
            <title>{`${a.name}${fighting.has(a.id) ? ' · 교전 중' : ''}`}</title>
            <circle r={unit * 9 * mark} className="geo-agent-target" />
            {picked && <circle r={dot * 2.1} className="geo-agent-halo" strokeWidth={unit * 1.1 * mark} />}
            {fighting.has(a.id) && a.publicState.status !== 'deceased' && <circle r={dot * 1.5} className="geo-agent-fight" strokeWidth={unit * 1 * mark} />}
            {angle !== null && a.publicState.status !== 'deceased' &&
              <polygon className="geo-agent-heading" points={`${dot},0 ${dot * 2.2},${dot * 0.62} ${dot * 2.2},${-dot * 0.62}`} transform={`rotate(${angle})`} />}
            <circle r={dot} className="geo-agent-dot" strokeWidth={unit * 1.4 * mark} />
            {status && <g transform={`translate(${dot * 1.9} ${-dot * 1.6})`}>
              <MapGlyph name={status} size={unit * 13 * mark} className={`geo-agent-status is-${status}`} />
            </g>}
            {named && <g className="geo-agent-name">
              <rect x={-tag.w / 2} y={tag.top} width={tag.w} height={tag.h} rx={tag.h * 0.35} strokeWidth={unit * 0.5} />
              <text y={tag.top + font * 1.1} fontSize={font} textAnchor="middle" strokeWidth={unit * 0.9}>{a.name}</text>
            </g>}
          </g>
        })}
      </svg>
    </div>
    <div className="minimap-legend">
      <span><i />등장인물</span>
      <span><i className="selected-dot" />선택</span>
      <span><i className="geo-legend-supply" />보급품</span>
      <span><i className="geo-legend-zone" />폐쇄 구역</span>
      {selectedAgentId && <button type="button" onClick={() => onSelectAgent(null)}>선택 해제</button>}
    </div>
    {selected && <dl className="geo-agent-info">
      <div><dt>이름</dt><dd>{selected.name}{(() => { const s = statusIcon(selected.publicState.status); return s ? <span className={`status-mark is-${s}`}><Icon name={s} size={13} /></span> : null })()}{selected.publicState.status === 'deceased' ? ' (사망)' : selected.publicState.status === 'injured' ? ' (부상)' : ''}{fighting.has(selected.id) && selected.publicState.status !== 'deceased' ? ' · 교전 중' : ''}</dd></div>
      <div><dt>좌표</dt><dd>X {Math.round(selected.publicState.coord!.x)}m · Y {Math.round(selected.publicState.coord!.y)}m</dd></div>
      <div><dt>위치</dt><dd>{placeName(selected.publicState.locationId)} · {TERRAIN_LABEL[terrainAt(geo, selected.publicState.coord!)]}</dd></div>
      <div><dt>이동</dt><dd>{selected.publicState.travel ? `${placeName(selected.publicState.travel.destinationPlaceId) || '목적지'}(으)로 이동 중 · 약 ${Math.max(0, selected.publicState.travel.arriveMinute - minute)}분 남음` : '멈춰 있음'}</dd></div>
      <div><dd><button type="button" onClick={() => focus(selected.publicState.coord!)}>이 위치로 확대</button></dd></div>
    </dl>}
    {zones.length > 0 && <p className="map-caption">
      {zones.map(z => z.closed ? `${placeName(z.placeId)} 폐쇄됨` : `${placeName(z.placeId)} ${Math.floor(closingIn(z) / 60)}시간 ${closingIn(z) % 60}분 후 폐쇄`).join(' · ')}
    </p>}
    <p className="map-caption">{W}×{H}m · 시뮬레이션 좌표 그대로 표시 · 휠/버튼으로 확대, 드래그로 이동</p>
  </>
}
