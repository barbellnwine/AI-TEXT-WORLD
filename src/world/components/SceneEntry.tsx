import { useState } from 'react'
import { Link } from '../../router/Link'
import { worldApi } from '../api'
import { EventCard } from './EventCard'
import { formatDateTime, formatKoreanClock } from '../format'
import type { Agent, ChronicleEntry, Place, WorldEvent } from '../types'
import { useWorldExperience } from '../i18n'

interface Props {
  scene: ChronicleEntry
  placesById: Map<string, Place>
  agentsById: Map<string, Agent>
  onOpenDetail: (eventId: string) => void
  registerRef: (id: string, el: HTMLElement | null) => void
}

export function SceneEntry({ scene, placesById, agentsById, onOpenDetail, registerRef }: Props) {
  const { t, locale } = useWorldExperience()
  const [evidence, setEvidence] = useState<WorldEvent[] | null>(null)
  const [loadingEvidence, setLoadingEvidence] = useState(false)

  const locations = scene.locationIds.map(id => placesById.get(id)?.name ?? id)
  const agents = scene.agentIds.map(id => agentsById.get(id)?.name ?? id)

  async function loadEvidence() {
    if (evidence || loadingEvidence) return
    setLoadingEvidence(true)
    try {
      const results = await Promise.all(scene.sourceEventIds.map(id => worldApi.event(id).then(r => r.event).catch(() => null)))
      setEvidence(results.filter((e): e is WorldEvent => Boolean(e)))
    } finally {
      setLoadingEvidence(false)
    }
  }

  return (
    <article className="reader-scene" data-scene-id={scene.id} ref={el => registerRef(scene.id, el)}>
      <p className="reader-scene-meta world-mono">DAY {scene.worldDay} · {locale === 'ko-KR' ? formatKoreanClock(scene.timeEnd) : scene.timeEnd}</p>
      <h2 className="reader-scene-title">{scene.title}</h2>
      <div className="reader-scene-body">
        {scene.body.split('\n\n').map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>

      <p className="reader-scene-footer">
        {locations.length > 0 && <span>{locations.join(', ')}</span>}
        {agents.length > 0 && (
          <span>
            {agents.map((name, i) => (
              <span key={scene.agentIds[i]}>
                {i > 0 && ', '}
                <Link to={`/characters/${scene.agentIds[i]}`}>{name}</Link>
              </span>
            ))}
          </span>
        )}
        <span className="world-mono">{formatDateTime(scene.createdAt)}</span>
        <span>{t('events')} {scene.sourceEventIds.length}</span>
      </p>

      <div className="reader-scene-details">
        {scene.stateChanges.length > 0 && (
          <details className="reader-details">
            <summary>{t('changes')}</summary>
            <ul className="world-simple-list">
              {scene.stateChanges.map((change, i) => (
                <li key={i}>
                  {change.field.split(':').pop()} · {change.from} → {change.to}
                </li>
              ))}
            </ul>
          </details>
        )}

        <details className="reader-details" onToggle={event => { if ((event.target as HTMLDetailsElement).open) loadEvidence() }}>
          <summary>{t('evidence')}</summary>
          {loadingEvidence && <p className="world-micro">{t('reading')}</p>}
          {evidence && (
            <ul className="world-event-list">
              {evidence.map(event => (
                <EventCard key={event.id} event={event} place={placesById.get(event.placeId)} agents={event.agentIds.map(id => agentsById.get(id)).filter((a): a is Agent => Boolean(a))} onOpenDetail={onOpenDetail} />
              ))}
            </ul>
          )}
        </details>
      </div>
    </article>
  )
}
