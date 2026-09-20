import { Icon } from '../../components/Icon'
import type { Place } from '../types'

interface Props {
  place: Place
  agentCount: number
  selected: boolean
  onSelect: (id: string) => void
}

export function PlaceCard({ place, agentCount, selected, onSelect }: Props) {
  return (
    <li>
      <button type="button" className={`world-place-node${selected ? ' is-selected' : ''}`} onClick={() => onSelect(place.id)} aria-pressed={selected}>
        <div className="world-place-node-head">
          <span>{place.name}</span>
          {place.locked && <Icon name="lock" size={13} />}
        </div>
        <p className="world-micro">캐릭터 {agentCount}명 · 연결 {place.connectedPlaceIds.length}곳</p>
      </button>
    </li>
  )
}
