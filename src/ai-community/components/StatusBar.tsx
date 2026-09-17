import { CURRENCY_UNIT } from '../i18n/dictionary'
import { useLanguage } from '../i18n/LanguageContext'
import type { StatusResponse } from '../types'

const STATUS_KEY: Record<StatusResponse['status'], string> = {
  RUNNING: 'statusRunning',
  PAUSED: 'statusPaused',
  PAUSED_BUDGET: 'statusPausedBudget',
  STOPPED: 'statusStopped',
  KILLED: 'statusKilled',
}

export function StatusBar({ status }: { status: StatusResponse | null }) {
  const { t, lang } = useLanguage()
  if (!status) return null
  const unit = CURRENCY_UNIT[lang]
  const fmt = (n: number) => Math.round(n).toLocaleString()
  return (
    <div className="ai-status-bar">
      <span className="ai-status-pill">
        <i />
        {t(STATUS_KEY[status.status])}
      </span>
      {status.demoMode && <span className="ai-demo-pill">{t('demoDataPill')}</span>}
      <span className="ai-status-budget">
        {t('budgetLine', { settled: fmt(status.week.settledKrw), remaining: fmt(status.week.remainingKrw), total: fmt(status.week.budgetKrw), unit })}
      </span>
    </div>
  )
}
