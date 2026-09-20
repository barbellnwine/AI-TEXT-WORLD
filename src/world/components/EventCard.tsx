import { EVENT_TYPE_LABEL, eventTypeClass, formatDateTime } from '../format'
import type { Agent, Place, WorldEvent } from '../types'

interface Props {
  event: WorldEvent
  place?: Place
  agents: Agent[]
  onOpenDetail: (id: string) => void
}

export function EventCard({ event, place, agents, onOpenDetail }: Props) {
  return (
    <li className={`world-event-card ${eventTypeClass(event.type)}`}>
      <button type="button" className="world-event-card-button" onClick={() => onOpenDetail(event.id)}>
        <div className="world-event-card-head">
          <span className="world-event-type-badge">{EVENT_TYPE_LABEL[event.type]}</span>
          {place && <span className="world-micro">{place.name}</span>}
          <span className="world-micro world-mono">{formatDateTime(event.occurredAt)}</span>
          {(event.importance === 'high' || event.importance === 'critical') && <span className="world-flag">주요 사건</span>}
        </div>
        <p className="world-event-card-title">{event.title}</p>
        <p className="world-event-card-summary">{event.summary}</p>
        {agents.length > 0 && (
          <p className="world-event-card-agents">
            {agents.map(a => a.name).join(', ')}
          </p>
        )}
        <span className="world-event-card-id world-micro world-mono">{event.id}</span>
      </button>
    </li>
  )
}
