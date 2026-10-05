import { useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ChronicleEntry, WorldState } from '../types'
import { useWorldExperience } from '../i18n'
import { GeoMap } from './GeoMap'

// The island is a schematic backdrop. Only public server locations determine grouping;
// spreading occupants within a location makes each person individually selectable.
// Worlds with continuous space (engine.geo) get the real top-down map; older node-based worlds
// keep this schematic view.
export function WorldMiniMap(props: {
  state: WorldState
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
  // The LIVE scene being read right now. The real map marks where its fight happened; the
  // schematic one has no simulation coordinates to mark, so it ignores this.
  scene?: ChronicleEntry | null
}) {
  const { scene: _scene, ...node } = props
  return props.state.engine?.geo ? <GeoMap {...props} /> : <NodeMiniMap {...node} />
}

function NodeMiniMap({ state, selectedAgentId, onSelectAgent }: {
  state: WorldState
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
}) {
  const { t } = useWorldExperience()
  const id = useId().replaceAll(':', '')
  const reducedMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const [expanded, setExpanded] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const panRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (expanded) dialog.current?.showModal()
    else dialog.current?.close()
  }, [expanded])
  // Click-and-drag panning for the oversized expanded map (touch already scrolls natively).
  function startPan(down: ReactPointerEvent<HTMLDivElement>) {
    const el = panRef.current
    if (!el || down.pointerType === 'touch') return
    if (down.target instanceof Element && down.target.closest('.map-character')) return
    down.preventDefault()
    const startX = down.clientX, startY = down.clientY, startLeft = el.scrollLeft, startTop = el.scrollTop
    el.setPointerCapture(down.pointerId)
    const onMove = (move: PointerEvent) => { el.scrollLeft = startLeft - (move.clientX - startX); el.scrollTop = startTop - (move.clientY - startY) }
    const onUp = () => { el.releasePointerCapture(down.pointerId); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp) }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }
  const island = 'M68 167 Q48 140 72 116 L97 108 Q93 83 118 73 L151 78 Q167 48 193 59 L212 83 L241 73 Q272 70 280 98 L304 114 Q332 118 329 145 L351 170 Q358 196 331 208 L312 232 Q306 258 275 253 L248 276 Q224 289 204 267 L178 273 Q153 266 148 249 L115 244 Q88 244 87 221 L62 202 Q49 184 68 167Z'
  const places = [...state.places].sort((a, b) => a.id.localeCompare(b.id))
  const designed = Boolean(state.engine)
  const xs = places.map(p => p.x ?? 0), ys = places.map(p => p.y ?? 0)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const hasCoordinates = maxX !== minX || maxY !== minY
  const anchors = new Map(places.map((place, index) => {
    const angle = index * 2.399963229728653
    const radius = places.length <= 1 ? 0 : 110 * Math.sqrt((index + .5) / places.length)
    return [place.id, designed && hasCoordinates ? {
      x: maxX === minX ? 205 : 55 + ((place.x ?? 0) - minX) / (maxX - minX) * 300,
      y: maxY === minY ? 165 : 55 + ((place.y ?? 0) - minY) / (maxY - minY) * 220,
    } : { x: 205 + Math.cos(angle) * radius, y: 174 + Math.sin(angle) * radius * .8 }]
  }))
  // The visible "land" for a place must be drawn big enough to actually contain where
  // characters at that place can appear — otherwise they render floating outside it. Shrinks as
  // more places compete for the same canvas so they don't overlap each other.
  const placeVisualRadius = Math.max(26, Math.min(115, 260 / places.length))
  // A place can be a whole 2km island — LOCAL_AREAS (server/world/actionSchema.ts) lets an
  // agent's own last action move it to a real direction within that one place (no separate
  // "place" needed per spot), so map movement actually tracks what the AI decided to do.
  const AREA_ANGLES: Record<string, number> = { SHORE: 0, FOREST: (2 * Math.PI) / 6, HIGH_GROUND: (4 * Math.PI) / 6, CAVE: Math.PI, WATER: (8 * Math.PI) / 6, CAMP: (10 * Math.PI) / 6 }
  const AREA_LABELS: Record<string, string> = { SHORE: '해안', FOREST: '숲', HIGH_GROUND: '고지대', CAVE: '동굴', WATER: '물가', CAMP: '야영지' }
  const maxOccupantRadius = Math.max(10, placeVisualRadius * 0.62)
  const agents = [...state.agents].filter(agent => anchors.has(agent.publicState.locationId)).sort((a, b) => a.id.localeCompare(b.id))
  // Stable per-character offsets never change when another character arrives or leaves.
  const point = (agent: typeof agents[number], placeId: string, area?: string, position?: {x:number;y:number}) => {
    const anchor = anchors.get(placeId)!
    const seed = [...agent.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0)
    const angle = (seed % 360) * Math.PI / 180
    const spread = Math.min(5, maxOccupantRadius / 4)
    const areaAngle = AREA_ANGLES[area ?? 'CENTER']
    const r = placeVisualRadius * .55
    const cell=position && Number.isFinite(position.x)&&Number.isFinite(position.y) ? position : undefined
    return { x: anchor.x + (areaAngle === undefined ? 0 : Math.cos(areaAngle) * r) + (cell ? (cell.x-.5)*placeVisualRadius*.38 : Math.cos(angle)*spread),
      y: anchor.y + (areaAngle === undefined ? 0 : Math.sin(areaAngle) * r * .8) + (cell ? (cell.y-.5)*placeVisualRadius*.30 : Math.sin(angle)*spread) }
  }
  const markers = agents.map(agent => {
    const origin = point(agent, agent.publicState.locationId, agent.publicState.localArea,agent.publicState.position)
    const task = state.engine?.ongoingActions.find(a => a.proposal.actorId === agent.id)
    const target = task?.proposal.actionType === 'MOVE' && task.proposal.destinationId && anchors.has(task.proposal.destinationId)
      ? point(agent, task.proposal.destinationId,'CENTER',{x:.5,y:.5})
      : task?.proposal.actionType === 'EXPLORE' && task.proposal.areaHint
        ? point(agent, agent.publicState.locationId, task.proposal.areaHint,task.proposal.searchPoint) : origin
    const progress = task && state.engine ? Math.max(0, Math.min(1, (state.engine.minute - task.startedMinute) / Math.max(1, task.completesMinute - task.startedMinute))) : 0
    return { agent, x: origin.x + (target.x - origin.x) * progress, y: origin.y + (target.y - origin.y) * progress }
  })
  const selected = markers.find(marker => marker.agent.id === selectedAgentId)
  const followed = selected ?? markers.find(m => m.agent.publicState.status !== 'deceased') ?? markers[0]
  const [overview, setOverview] = useState(false)
  const targetX = overview ? 205 : followed?.x ?? 205, targetY = overview ? 165 : followed?.y ?? 165
  const targetWidth = overview ? 410 : 115
  const [camera, setCamera] = useState({ x: targetX, y: targetY, width: targetWidth })
  const cameraRef = useRef(camera)
  useEffect(() => {
    const from = cameraRef.current, start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = reducedMotion ? 1 : Math.min(1, (now - start) / 900)
      const ease = t * t * (3 - 2 * t)
      const next = { x: from.x + (targetX - from.x) * ease, y: from.y + (targetY - from.y) * ease, width: from.width + (targetWidth - from.width) * ease }
      cameraRef.current = next; setCamera(next)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [targetX, targetY, targetWidth, reducedMotion])
  useEffect(() => {
    if (expanded && panRef.current) {
      const el = panRef.current
      el.scrollLeft = (984 - el.clientWidth) / 2; el.scrollTop = (792 - el.clientHeight) / 2
    }
  }, [expanded])
  const svgId = (suffix: string) => `${id}${suffix}`
  // The expanded view deliberately does NOT try to fit everything into one glance — it renders
  // the same map at ~2.4x the pixel size and lets the container scroll, so a busy multi-place
  // world stays legible and pannable instead of shrinking everyone down to fit.
  const mapSvg = (svgIdSuffix: string, large = false) => (
    <svg viewBox={`${camera.x - camera.width / 2} ${camera.y - camera.width * 330 / 410 / 2} ${camera.width} ${camera.width * 330 / 410}`} role="group" aria-label={t('map')} style={large ? { width: 410 * 2.4, height: 330 * 2.4, maxWidth: 'none' } : undefined}>
      <defs>
        <radialGradient id={svgId(`${svgIdSuffix}-land`)}><stop stopColor="#50684b" /><stop offset="1" stopColor="#263f35" /></radialGradient>
        <clipPath id={svgId(`${svgIdSuffix}-clip`)}><path d={island} /></clipPath>
      </defs>
      {!designed && <g aria-hidden="true">
        <path d={island} transform="translate(-20 -16) scale(1.1)" className="island-waterline island-waterline-outer" />
        <path d={island} transform="translate(-9 -8) scale(1.045)" className="island-waterline" />
        <path d={island} fill={`url(#${svgId(`${svgIdSuffix}-land`)})`} className="island-coast" />
        <g clipPath={`url(#${svgId(`${svgIdSuffix}-clip`)})`} className="island-contours">
          <path d="M87 153Q138 86 202 110T323 146 M77 182Q129 108 203 128T331 164 M94 212Q138 147 203 147T319 194 M121 231Q173 169 230 177T299 224" />
          <path d="M124 168Q130 124 175 133T234 167Q241 210 196 224T145 199Z M142 166Q145 143 176 151T215 173Q216 199 190 205T159 190Z M238 93Q225 141 265 150T307 189" />
        </g>
      </g>}
      {state.engine?.connections.map((edge, i) => {
        const from = anchors.get(edge.fromPlaceId), to = anchors.get(edge.toPlaceId)
        return from && to ? <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.blocked ? '#9a6262' : '#7c9b8a'} strokeWidth="1.5" strokeDasharray={edge.blocked ? '4 5' : undefined}><title>{edge.travelMinutes} min{edge.blocked ? ' · blocked' : ''}</title></line> : null
      })}
      {designed && places.map(place => {
        const p = anchors.get(place.id)!
        return <g key={place.id} aria-label={place.name}>
          <circle cx={p.x} cy={p.y} r={placeVisualRadius} fill={`url(#${svgId(`${svgIdSuffix}-land`)})`} stroke="#7c9b8a" />
          {[.3, .6, .9].map(r => <circle key={r} cx={p.x} cy={p.y} r={placeVisualRadius * r} fill="none" stroke="#7c9b8a" strokeOpacity=".15" strokeWidth=".4" />)}
          {placeVisualRadius >= 60 && Object.entries(AREA_LABELS).map(([area, label]) => {
            const a = AREA_ANGLES[area], r = placeVisualRadius * 0.55
            return <text key={area} x={p.x + Math.cos(a) * r} y={p.y + Math.sin(a) * r * .8} textAnchor="middle" className="map-area-label">{label}</text>
          })}
          <text x={p.x} y={p.y + placeVisualRadius + 17} textAnchor="middle" fill="currentColor" fontSize="11">{place.name}</text>
        </g>
      })}
      {[...new Set(markers.map(m => m.agent.publicState.locationId))].flatMap(locationId => {
        const group = markers.filter(m => m.agent.publicState.locationId === locationId && m.agent.publicState.status !== 'deceased')
        const lines = []
        for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
          if ((group[i].agent.publicState.localArea ?? 'CENTER') !== (group[j].agent.publicState.localArea ?? 'CENTER')) continue
          const a=group[i].agent.publicState.position,b=group[j].agent.publicState.position
          if(a&&b&&Math.hypot(a.x-b.x,a.y-b.y)>.12)continue
          lines.push(<line key={`${group[i].agent.id}-${group[j].agent.id}`} x1={group[i].x} y1={group[i].y} x2={group[j].x} y2={group[j].y} className="map-meeting-line" />)
        }
        return lines
      })}
      {selected && selected.agent.movementLog.length > 1 && (() => {
        const points = selected.agent.movementLog.map(m => anchors.get(m.placeId)).filter((p): p is { x: number; y: number } => Boolean(p))
        return points.length > 1 ? <polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} className="map-trail" /> : null
      })()}
      {markers.map(({ agent, x, y }) => {
        return <g key={agent.id} transform={`translate(${x} ${y})`} className={`map-character${agent.id === selectedAgentId ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-label={agent.name} aria-pressed={agent.id === selectedAgentId} onClick={() => onSelectAgent(agent.id === selectedAgentId ? null : agent.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectAgent(agent.id === selectedAgentId ? null : agent.id) } }}>
          <title>{agent.name}</title>
          <circle r={overview ? 11 : 4} className="map-character-target" />
          <circle r={overview ? 4.5 : 1.8} className="map-character-dot" pointerEvents="none" />
        </g>
      })}
      {selected && <g className="map-character-label" transform={`translate(${selected.x} ${selected.y}) scale(${overview ? 1 : .35})`} pointerEvents="none" aria-hidden="true"><rect x={-49} y={-36} width="98" height="22" rx="5" /><text x={0} y={-21} textAnchor="middle">{selected.agent.name}</text></g>}
    </svg>
  )
  const legend = <div className="minimap-legend"><span><i />{t('characters')}</span><span><i className="selected-dot" />{t('selected')}</span>{selectedAgentId && <button type="button" onClick={() => onSelectAgent(null)}>{t('clearSelection')}</button>}</div>
  return <>
    <div className="world-minimap island-minimap">
      <span className="map-compass" aria-hidden="true">N ↑</span>
      <button type="button" className="map-expand-button" onClick={() => setExpanded(true)} aria-label={t('expandMap')} title={t('expandMap')}>⤢</button>
      {mapSvg('-small')}
    </div>
    {legend}
    <div className="map-camera-controls"><button type="button" onClick={() => setOverview(!overview)}>{overview ? 'GPS 추적' : '전체 지도'}</button><select aria-label="추적할 캐릭터" value={followed?.agent.id ?? ''} onChange={e => { onSelectAgent(e.target.value); setOverview(false) }}>{markers.map(m => <option key={m.agent.id} value={m.agent.id}>{m.agent.name}</option>)}</select></div>
    <p className="map-caption">{overview ? '전체 위치' : `${followed?.agent.name ?? '캐릭터'} 추적 중 · 실제 이동 기록 반영`} · 구역 지도</p>
    <dialog ref={dialog} className="world-dialog map-dialog" aria-label={t('expandMap')} onCancel={e => { e.preventDefault(); setExpanded(false) }} onClose={() => setExpanded(false)}>
      {expanded && <>
        <button type="button" className="world-dialog-close" onClick={() => setExpanded(false)} aria-label={t('close')}>✕</button>
        <div className="world-minimap island-minimap map-dialog-map" ref={panRef} onPointerDown={startPan}>
          <span className="map-compass" aria-hidden="true">N ↑</span>
          {mapSvg('-large', true)}
        </div>
        {legend}
        <p className="map-caption">{t('topology')}</p>
      </>}
    </dialog>
  </>
}
