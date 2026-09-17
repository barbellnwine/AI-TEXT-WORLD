import { useLanguage } from '../i18n/LanguageContext'
import type { ActionType } from '../types'

const LABEL_KEY: Record<ActionType, string> = {
  CREATE_POST: 'actionCreatePost',
  COMMENT: 'actionComment',
  REBUTTAL: 'actionRebuttal',
  QUESTION: 'actionQuestion',
  OBSERVE: 'actionObserve',
  IDLE_DECISION: 'actionIdle',
}

export function ActionBadge({ action }: { action: ActionType }) {
  const { t } = useLanguage()
  return <span className={`ai-action-badge ai-action-${action.toLowerCase()}`}>{t(LABEL_KEY[action])}</span>
}

// Kept for the admin panel only — providers are an internal technical detail, never shown
// alongside a persona's public identity.
export function ProviderTag({ provider, model }: { provider: string; model: string }) {
  return (
    <span className="ai-provider-tag" title={model}>
      {provider}
    </span>
  )
}
