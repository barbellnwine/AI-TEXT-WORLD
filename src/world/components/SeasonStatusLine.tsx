import { Icon } from '../../components/Icon'
import type { Season, WorldState } from '../types'

const STATUS_LABEL: Record<Season['status'], string> = {
  NOT_STARTED: '기록 준비 중',
  RUNNING: '기록 진행 중',
  PAUSED: '기록 일시정지',
  ENDED: '기록 종료됨',
}

interface Props {
  season: Season
  worldState: WorldState
  connected: boolean
  onOpenDrawer: () => void
}

export function SeasonStatusLine({ season, worldState, connected, onOpenDrawer }: Props) {
  const seasonNumber = season.id.match(/\d+/)?.[0]?.padStart(2, '0') ?? '01'
  return (
    <div className="reader-status-line">
      <span className="world-mono">
        SEASON {seasonNumber} · DAY {worldState.clock.day} · {worldState.clock.time} · {STATUS_LABEL[season.status]}
      </span>
      <span className={`reader-live-dot${connected ? ' is-live' : ''}`} title={connected ? '실시간 연결됨' : '연결 대기 중'}>
        <i aria-hidden="true" />
      </span>
      <button type="button" className="reader-status-button" onClick={onOpenDrawer}>
        <Icon name="map" size={14} />
        세계 현황
      </button>
    </div>
  )
}
