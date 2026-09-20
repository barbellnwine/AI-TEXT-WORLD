import { Link } from '../../router/Link'
import { Icon } from '../../components/Icon'
import { AGENT_STATUS_LABEL, formatRelative, statusClass } from '../format'
import type { Agent, Faction, Place } from '../types'

interface Props {
  agent: Agent
  place?: Place
  factions: Faction[]
  agentsById: Map<string, Agent>
  isFollowed: boolean
  onToggleFollow: (id: string) => void
}

export function CharacterCard({ agent, place, factions, agentsById, isFollowed, onToggleFollow }: Props) {
  const myFactions = factions.filter(f => agent.factionIds.includes(f.id))
  const topRelationship = agent.relationships[0]
  const topRelationshipName = topRelationship ? agentsById.get(topRelationship.otherAgentId)?.name ?? topRelationship.otherAgentId : null
  return (
    <li className="world-character-card">
      <button
        type="button"
        className={`world-follow-toggle${isFollowed ? ' is-followed' : ''}`}
        onClick={() => onToggleFollow(agent.id)}
        aria-pressed={isFollowed}
        aria-label={isFollowed ? `${agent.name} 팔로우 해제` : `${agent.name} 팔로우`}
      >
        <Icon name="users" size={14} />
      </button>
      <Link to={`/characters/${agent.id}`} className="world-character-card-link">
        <div className="world-character-card-head">
          <span className="world-character-avatar" aria-hidden="true">{agent.name.slice(0, 1)}</span>
          <div>
            <p className="world-character-name">{agent.name}</p>
            <p className="world-micro world-mono">{agent.codeNumber}</p>
          </div>
          <span className={`world-status-badge ${statusClass(agent.publicState.status)}`}>{AGENT_STATUS_LABEL[agent.publicState.status]}</span>
        </div>
        <p className="world-micro">{place?.name ?? '위치 불명'}</p>
        {agent.publicState.visibleGoal && <p className="world-character-goal">목표: {agent.publicState.visibleGoal}</p>}
        {agent.publicState.lastAction && <p className="world-micro">최근 행동: {agent.publicState.lastAction}</p>}
        {myFactions.length > 0 && <p className="world-micro">소속: {myFactions.map(f => f.name).join(', ')}</p>}
        {topRelationshipName && <p className="world-micro">핵심 관계 {topRelationshipName}</p>}
        <p className="world-micro world-character-time">최근 활동 {formatRelative(agent.publicState.lastActiveAt)}</p>
      </Link>
    </li>
  )
}
