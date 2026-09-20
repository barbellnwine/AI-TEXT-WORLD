import { useEffect, useRef } from 'react'
import { Icon } from '../../components/Icon'
import { DANGER_LABEL, WEATHER_LABEL, dangerClass } from '../format'
import type { WorldEvent, WorldState } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  worldState: WorldState
  spotlightEvent: WorldEvent | null
}

// The only place time/weather/resources/headcounts/active-events are shown on the main reading
// page — everything else lives in the novel itself. Opens as a slide-over so the reader never has
// to look at a dashboard to keep reading.
export function WorldStatusDrawer({ open, onClose, worldState, spotlightEvent }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) closeButtonRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="world-drawer-backdrop" onClick={onClose}>
      <aside className="world-drawer" role="dialog" aria-modal="true" aria-labelledby="world-drawer-title" onClick={e => e.stopPropagation()}>
        <div className="world-drawer-head">
          <h2 id="world-drawer-title">세계 현황</h2>
          <button type="button" ref={closeButtonRef} className="world-dialog-close" onClick={onClose} aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>

        <dl className="world-kv">
          <div>
            <dt>세계 시간</dt>
            <dd className="world-mono">DAY {worldState.clock.day} · {worldState.clock.time}</dd>
          </div>
          <div>
            <dt>날씨</dt>
            <dd>{WEATHER_LABEL[worldState.clock.weather]} · {worldState.clock.temperatureC}°C</dd>
          </div>
          <div>
            <dt>주요 위험</dt>
            <dd className={dangerClass(worldState.dangerLevel)}>{DANGER_LABEL[worldState.dangerLevel]}</dd>
          </div>
        </dl>

        <h3>사용 가능한 핵심 자원</h3>
        <ul className="world-resource-list">
          {worldState.places.flatMap(place =>
            place.resources.map(resource => (
              <li key={`${place.id}-${resource.key}`}>
                <span>{place.name} · {resource.label}</span>
                <span className="world-resource-value">{resource.level}{resource.unit ?? ''}</span>
              </li>
            ))
          )}
        </ul>

        <h3>장소별 인원</h3>
        <ul className="world-simple-list">
          {worldState.places.map(place => (
            <li key={place.id}>
              <span>{place.name}</span>
              <span className="world-micro">{place.currentAgentIds.length}명</span>
            </li>
          ))}
        </ul>

        <h3>진행 중인 주요 사건</h3>
        {spotlightEvent ? <p className="world-drawer-active-event">{spotlightEvent.title}</p> : <p className="world-micro">현재 특별히 진행 중인 사건이 없습니다.</p>}
      </aside>
    </div>
  )
}
