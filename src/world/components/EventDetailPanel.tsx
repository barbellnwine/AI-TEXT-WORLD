import { useEffect, useRef } from 'react'
import { Icon } from '../../components/Icon'
import { EVENT_TYPE_LABEL, IMPORTANCE_LABEL, formatDateTime } from '../format'
import type { Agent, Place, WorldEvent } from '../types'

interface Props {
  event: WorldEvent | null
  placesById: Map<string, Place>
  agentsById: Map<string, Agent>
  eventsById: Map<string, WorldEvent>
  onClose: () => void
  onSelectRelated: (id: string) => void
}

export function EventDetailPanel({ event, placesById, agentsById, eventsById, onClose, onSelectRelated }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (event) dialog.current?.showModal()
    else dialog.current?.close()
  }, [event])

  if (!event) return null
  const place = placesById.get(event.placeId)
  const agents = event.agentIds.map(id => agentsById.get(id)).filter((a): a is Agent => Boolean(a))
  const related = event.relatedEventIds.map(id => eventsById.get(id)).filter((e): e is WorldEvent => Boolean(e))

  return (
    <dialog ref={dialog} className="world-dialog" aria-labelledby="event-detail-title" onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}>
      <button type="button" className="world-dialog-close" onClick={onClose} aria-label="닫기">
        <Icon name="x" size={16} />
      </button>
      <p className="world-eyebrow">{EVENT_TYPE_LABEL[event.type]} · EVENT ID {event.id}</p>
      <h2 id="event-detail-title">{event.title}</h2>
      <div className="world-spotlight-meta">
        <span className="world-mono">{formatDateTime(event.occurredAt)}</span>
        {place && <span>{place.name}</span>}
        <span>위험도 {IMPORTANCE_LABEL[event.importance]}</span>
      </div>

      {agents.length > 0 && (
        <p className="world-detail-agents">
          관련 캐릭터: {agents.map(a => a.name).join(', ')}
        </p>
      )}

      <div className="world-detail-body">
        {event.beforeStateSummary && (
          <section>
            <h3>사건 발생 전</h3>
            <p>{event.beforeStateSummary}</p>
          </section>
        )}
        {event.attemptedAction && (
          <section>
            <h3>시도된 행동</h3>
            <p>{event.attemptedAction}</p>
          </section>
        )}
        {event.engineVerdict && (
          <section>
            <h3>WORLD ENGINE 판정</h3>
            <p>{event.engineVerdict}</p>
          </section>
        )}
        {!event.beforeStateSummary && !event.attemptedAction && !event.engineVerdict && <p>{event.summary}</p>}
        {event.afterStateSummary && (
          <section>
            <h3>사건 발생 후</h3>
            <p>{event.afterStateSummary}</p>
          </section>
        )}
        {event.publicQuote && (
          <section>
            <h3>공개된 발언</h3>
            <blockquote>{event.publicQuote}</blockquote>
          </section>
        )}
        {event.stateChanges.length > 0 && (
          <section>
            <h3>상태 변화</h3>
            <ul>
              {event.stateChanges.map((change, i) => (
                <li key={i}>
                  {change.field} · {change.from} → {change.to}
                </li>
              ))}
            </ul>
          </section>
        )}
        {event.operator && (
          <p className="world-micro">운영자 개입 · {event.operator.addedBy} · {formatDateTime(event.operator.addedAt)}</p>
        )}
      </div>

      {related.length > 0 && (
        <section className="world-detail-related">
          <h3>관련된 이전 사건</h3>
          <ul>
            {related.map(r => (
              <li key={r.id}>
                <button type="button" className="world-text-button" onClick={() => onSelectRelated(r.id)}>
                  {r.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </dialog>
  )
}
