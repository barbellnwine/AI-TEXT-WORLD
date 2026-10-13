import { useEffect, useRef } from 'react'
import { Link } from '../../router/Link'
import { Icon } from '../../components/Icon'
import { useWorldExperience } from '../i18n'
import { portraitFor } from '../portraits'
import { formatRelative } from '../format'
import { statusIcon } from './GeoMap'
import { carriedGear, conditionGroups, looseInventory, sheetLabel, woundReport, type EngineObject } from '../characterSheet'
import type { Agent, Place } from '../types'

interface Props {
  agent: Agent | null
  placesById: Map<string, Place>
  agentsById: Map<string, Agent>
  objects?: EngineObject[]
  onClose: () => void
  onSelectAgent?: (id: string) => void
}

// The sidebar window has room for a face and a line of biography. This is the same person at the
// size the pictures were drawn for, with the state the engine actually keeps on them: what is in
// their hands, how their body and mind are holding, and what is still bleeding. It is a modal
// rather than a page so the reader never loses the story they were in the middle of.
export function CharacterDetailPanel({ agent, placesById, agentsById, objects, onClose, onSelectAgent }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { t, locale } = useWorldExperience()
  const label = (key: string) => sheetLabel(key, locale)

  useEffect(() => {
    if (agent) dialog.current?.showModal()
    else dialog.current?.close()
  }, [agent])

  if (!agent) return null
  const portrait = portraitFor(agent)
  const mark = statusIcon(agent.publicState.status)
  const place = placesById.get(agent.publicState.locationId)
  const gear = carriedGear(agent.id, objects)
  const loose = looseInventory(agent, gear)
  const wounds = woundReport(agent)
  const groups = conditionGroups(agent)
  const trade = agent.shortBio.split('·')[0].trim()
  // A bio with no separator is the trade line and nothing more, and printing it twice reads as
  // a rendering fault rather than as emphasis.
  const bio = agent.shortBio.trim() === trade ? null : agent.shortBio
  const destination = agent.publicState.travel?.destinationPlaceId
  const travelTo = destination ? placesById.get(destination)?.name : undefined

  return (
    <dialog ref={dialog} className="world-dialog character-sheet" aria-labelledby="character-sheet-title" onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}>
      <button type="button" className="world-dialog-close" onClick={onClose} aria-label={t('close')}>
        <Icon name="x" size={16} />
      </button>

      <div className="character-sheet-head">
        {portrait
          ? <img className="character-sheet-portrait" src={portrait} alt={`${agent.name} 초상`} />
          : <span className="character-sheet-portrait character-sheet-portrait--letter" aria-hidden="true">{agent.name.slice(0, 1)}</span>}
        <div className="character-sheet-identity">
          <p className="world-eyebrow world-mono">{agent.codeNumber}</p>
          <h2 id="character-sheet-title">{agent.name}{mark && <span className={`status-mark is-${mark}`}><Icon name={mark} size={15} /></span>}</h2>
          <p className="character-sheet-trade">{[trade, agent.age ? `${agent.age}세` : null, agent.profile?.gender].filter(Boolean).join(' · ')}</p>
          <p className={`observatory-person-status status-${agent.publicState.status}`}><i />{t(agent.publicState.status)}</p>
          {bio && <p className="character-sheet-bio">{bio}</p>}
          <dl className="world-kv character-sheet-now">
            <div><dt>{t('location')}</dt><dd>{place?.name ?? label('text:unknownPlace')}{travelTo ? ` → ${travelTo} ${label('text:travel')}` : ''}</dd></div>
            <div><dt>{label('text:goal')}</dt><dd>{agent.publicState.visibleGoal ?? label('text:noGoal')}</dd></div>
            <div><dt>{t('recent')}</dt><dd>{agent.publicState.lastAction ?? label('text:noAction')}</dd></div>
            <div><dt>{label('text:lastActive')}</dt><dd>{formatRelative(agent.publicState.lastActiveAt)}</dd></div>
          </dl>
        </div>
      </div>

      <div className="character-sheet-grid">
        <section className="character-sheet-block character-sheet-gear">
          <h3><Icon name="blade" size={14} />{label('text:gear')}</h3>
          {gear.length === 0 && loose.length === 0
            ? <p className="world-micro">{label('text:noGear')}</p>
            : <ul className="character-sheet-items">
              {gear.map(item => (
                <li key={item.id}>
                  <strong>{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</strong>
                  <span className="world-micro">{[
                    label(`kind:${item.kind}`),
                    item.edge ? label(`edge:${item.edge}`) : null,
                    item.attackPower > 0 ? `${label('text:attack')} ${item.attackPower}` : null,
                    item.cover > 0 ? `${label('text:cover')} ${item.cover}` : null,
                    item.condition === 'intact' ? null : label(`condition:${item.condition}`),
                  ].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
              {loose.map(name => <li key={name}><strong>{name}</strong></li>)}
            </ul>}
        </section>

        {groups.map(group => (
          <section className="character-sheet-block" key={group.key}>
            <h3><Icon name={group.key === 'body' ? 'pulse' : group.key === 'mind' ? 'radio' : 'droplet'} size={14} />{label(`group:${group.key}`)}</h3>
            <ul className="character-sheet-gauges">
              {group.gauges.map(gauge => (
                <li key={gauge.key} className={`tone-${gauge.tone}`}>
                  <span>{label(`gauge:${gauge.key}`)}</span>
                  <span className="character-sheet-track" role="img" aria-label={`${gauge.value} / 10`}>
                    <i style={{ width: `${gauge.value * 10}%` }} />
                  </span>
                  <span className="world-mono">{Number.isInteger(gauge.value) ? gauge.value : gauge.value.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {wounds && (
          <section className="character-sheet-block character-sheet-wounds">
            <h3><Icon name="blood" size={14} />{label('text:wounds')}</h3>
            <dl className="world-kv">
              <div><dt>{label('text:pain')}</dt><dd>{wounds.pain.toFixed(1)} / 10</dd></div>
              <div><dt>{label('text:blood')}</dt><dd>{(wounds.bloodLoss * 100).toFixed(1)}%</dd></div>
              {wounds.untreated > 0 && <div><dt>{label('text:untreated')}</dt><dd>{wounds.untreated}</dd></div>}
              {wounds.functions.map(fn => (
                <div key={fn.key}><dt>{label(`function:${fn.key}`)} {label('text:impairment')}</dt><dd>{Math.round(fn.loss * 100)}%</dd></div>
              ))}
            </dl>
            {wounds.injuries.length > 0 && (
              <ul className="character-sheet-items">
                {wounds.injuries.map(wound => (
                  <li key={wound.id}>
                    <strong>{[label(`part:${wound.part}`), wound.site === 'general' ? null : label(`site:${wound.site}`)].filter(Boolean).join(' ')} {label(`injury:${wound.type}`)}</strong>
                    <span className="world-micro">{label('text:severity')} {wound.severity} · {wound.treatedAt === null ? label('text:needsCare') : label('text:treated')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {agent.relationships.length > 0 && (
          <section className="character-sheet-block">
            <h3><Icon name="users" size={14} />{label('text:ties')}</h3>
            <ul className="character-sheet-items">
              {agent.relationships.map(tie => {
                const other = agentsById.get(tie.otherAgentId)
                return (
                  <li key={tie.otherAgentId}>
                    {other && onSelectAgent
                      ? <button type="button" className="world-text-button" onClick={() => onSelectAgent(tie.otherAgentId)}>{other.name}</button>
                      : <strong>{other?.name ?? tie.otherAgentId}</strong>}
                    <span className={`world-status-badge world-relationship--${tie.stance}`}>{label(`stance:${tie.stance}`)}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>

      <Link to={`/characters/${encodeURIComponent(agent.id)}`} className="character-sheet-record" onClick={onClose}>{label('text:record')} →</Link>
    </dialog>
  )
}
