import { Icon } from '../../components/Icon'

export function LoadingState({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="world-state-view" role="status">
      <span className="world-spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  )
}

export function ErrorState({ label = '정보를 불러오지 못했습니다.', onRetry }: { label?: string; onRetry?: () => void }) {
  return (
    <div className="world-state-view world-state-view--error" role="alert">
      <Icon name="info" size={20} />
      <p>{label}</p>
      {onRetry && (
        <button type="button" className="world-text-button" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="world-state-view world-state-view--empty">
      <p>{label}</p>
    </div>
  )
}
