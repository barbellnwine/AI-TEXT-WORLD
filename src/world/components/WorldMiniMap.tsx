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
    const radius = places.length <= 1 ? 0 : 78 * Math.sqrt((index + .5) / places.length)
    return [place.id, designed && hasCoordinates ? {
      x: maxX === minX ? 205 : 55 + ((place.x ?? 0) - minX) / (maxX - minX) * 300,
      y: maxY === minY ? 165 : 55 + ((place.y ?? 0) - minY) / (maxY - minY) * 220,
    } : { x: 205 + Math.cos(angle) * radius, y: 174 + Math.sin(angle) * radius * .8 }]
  }))
  const agents = [...state.agents].filter(agent => anchors.has(agent.publicState.locationId)).sort((a, b) => a.id.localeCompare(b.id))
  const markers = agents.map(agent => {
    const occupants = agents.filter(other => other.publicState.locationId === agent.publicState.locationId)
    const index = occupants.findIndex(other => other.id === agent.id)
    const angle = index * 2.399963229728653
    const radius = occupants.length === 1 ? 0 : Math.min(27, 10 * Math.sqrt(index + .5))
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
      {designed && places.map(place => { const p = anchors.get(place.id)!; return <g key={place.id} aria-label={place.name}><circle cx={p.x} cy={p.y} r="17" fill="#243b35" stroke="#7c9b8a" /><text x={p.x} y={p.y + 34} textAnchor="middle" fill="currentColor" fontSize="11">{place.name}</text></g> })}
      {markers.map(({ agent, x, y }) => <g key={agent.id} transform={`translate(${x} ${y})`} className={`map-character${agent.id === selectedAgentId ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-label={agent.name} aria-pressed={agent.id === selectedAgentId} onClick={() => onSelectAgent(agent.id === selectedAgentId ? null : agent.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectAgent(agent.id === selectedAgentId ? null : agent.id) } }}>
        <title>{agent.name}</title><circle r="11" className="map-character-target" /><circle r="4.5" className="map-character-dot" />
      </g>)}
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
