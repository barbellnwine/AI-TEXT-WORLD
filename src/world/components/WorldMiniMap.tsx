import { useEffect, useId, useRef, useState } from 'react'
import type { WorldState } from '../types'
import { useWorldExperience } from '../i18n'

// The island is a schematic backdrop. Only public server locations determine grouping;
// spreading occupants within a location makes each person individually selectable.
export function WorldMiniMap({ state, selectedAgentId, onSelectAgent }: {
  state: WorldState
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
}) {
  const { t } = useWorldExperience()
  const id = useId().replaceAll(':', '')
  const reducedMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const [expanded, setExpanded] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (expanded) dialog.current?.showModal()
    else dialog.current?.close()
  }, [expanded])
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
  const maxOccupantRadius = Math.max(10, placeVisualRadius * 0.62)
  const agents = [...state.agents].filter(agent => anchors.has(agent.publicState.locationId)).sort((a, b) => a.id.localeCompare(b.id))
  const markers = agents.map(agent => {
    const occupants = agents.filter(other => other.publicState.locationId === agent.publicState.locationId)
    const index = occupants.findIndex(other => other.id === agent.id)
    const angle = index * 2.399963229728653
    const radius = occupants.length === 1 ? 0 : Math.min(maxOccupantRadius, (maxOccupantRadius / 2.2) * Math.sqrt(index + .5))
    const anchor = anchors.get(agent.publicState.locationId)!
    const move = state.engine?.ongoingActions.find(a => a.proposal.actorId === agent.id && a.proposal.actionType === 'MOVE')
    const destination = move?.proposal.destinationId ? anchors.get(move.proposal.destinationId) : null
    if (move && destination && state.engine) {
      const progress = Math.max(0, Math.min(1, (state.engine.minute - move.startedMinute) / (move.completesMinute - move.startedMinute)))
      return { agent, x: anchor.x + (destination.x - anchor.x) * progress, y: anchor.y + (destination.y - anchor.y) * progress }
    }
    return { agent, x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius }
  })
  const selected = markers.find(marker => marker.agent.id === selectedAgentId)
  const svgId = (suffix: string) => `${id}${suffix}`
  const mapSvg = (svgIdSuffix: string) => (
    <svg viewBox="0 0 410 330" role="group" aria-label={t('map')}>
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
      {designed && places.map(place => { const p = anchors.get(place.id)!; return <g key={place.id} aria-label={place.name}><circle cx={p.x} cy={p.y} r={placeVisualRadius} fill={`url(#${svgId(`${svgIdSuffix}-land`)})`} stroke="#7c9b8a" /><text x={p.x} y={p.y + placeVisualRadius + 17} textAnchor="middle" fill="currentColor" fontSize="11">{place.name}</text></g> })}
      {[...new Set(markers.map(m => m.agent.publicState.locationId))].flatMap(locationId => {
        const group = markers.filter(m => m.agent.publicState.locationId === locationId && m.agent.publicState.status !== 'deceased')
        const lines = []
        for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
          lines.push(<line key={`${group[i].agent.id}-${group[j].agent.id}`} x1={group[i].x} y1={group[i].y} x2={group[j].x} y2={group[j].y} className="map-meeting-line" />)
        }
        return lines
      })}
      {selected && selected.agent.movementLog.length > 1 && (() => {
        const points = selected.agent.movementLog.map(m => anchors.get(m.placeId)).filter((p): p is { x: number; y: number } => Boolean(p))
        return points.length > 1 ? <polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} className="map-trail" /> : null
      })()}
      {markers.map(({ agent, x, y }) => {
        const wandering = agent.publicState.status !== 'deceased' && !reducedMotion
        const seed = [...agent.id].reduce((n, c) => n + c.charCodeAt(0), 0)
        // Amplitude scales with this place's own drawn radius so the wander can never carry a
        // character outside the visible land it's supposed to be standing on. Two independent
        // axes on coprime-ish periods so the combined path only repeats after ~2 minutes.
        const amp = Math.max(3, Math.min(16, placeVisualRadius * 0.14))
        // The hit target stays put (so click/hover/tests stay reliable on a stable area) —
        // only the visible dot wanders, purely decorative, with pointer-events disabled.
        return <g key={agent.id} transform={`translate(${x} ${y})`} className={`map-character${agent.id === selectedAgentId ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-label={agent.name} aria-pressed={agent.id === selectedAgentId} onClick={() => onSelectAgent(agent.id === selectedAgentId ? null : agent.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectAgent(agent.id === selectedAgentId ? null : agent.id) } }}>
          <title>{agent.name}</title>
          <circle r="11" className="map-character-target" />
          <g pointerEvents="none">
            {wandering && <animateTransform attributeName="transform" type="translate" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1" keyTimes="0;0.22;0.48;0.74;1" dur={`${9 + (seed % 5)}s`} begin={`-${(seed % 47) / 10}s`} values={`0,0;${amp * .9},0;${-amp * .35},0;${-amp},0;0,0`} />}
            <g pointerEvents="none">
              {wandering && <animateTransform attributeName="transform" type="translate" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1" keyTimes="0;0.3;0.58;0.83;1" dur={`${11 + (seed % 6)}s`} begin={`-${(seed % 53) / 10}s`} values={`0,0;0,${-amp * .94};0,${amp * .53};0,${-amp * .53};0,0`} />}
              <circle r="4.5" className="map-character-dot" />
            </g>
          </g>
        </g>
      })}
      {selected && <g className="map-character-label" pointerEvents="none" aria-hidden="true"><rect x={selected.x - 49} y={selected.y - 36} width="98" height="22" rx="5" /><text x={selected.x} y={selected.y - 21} textAnchor="middle">{selected.agent.name}</text></g>}
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
    <p className="map-caption">{t('topology')}</p>
    <dialog ref={dialog} className="world-dialog map-dialog" aria-label={t('expandMap')} onCancel={e => { e.preventDefault(); setExpanded(false) }} onClose={() => setExpanded(false)}>
      {expanded && <>
        <button type="button" className="world-dialog-close" onClick={() => setExpanded(false)} aria-label={t('close')}>✕</button>
        <div className="world-minimap island-minimap map-dialog-map">
          <span className="map-compass" aria-hidden="true">N ↑</span>
          {mapSvg('-large')}
        </div>
        {legend}
        <p className="map-caption">{t('topology')}</p>
      </>}
    </dialog>
  </>
}
