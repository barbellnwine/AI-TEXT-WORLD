import { useEffect, useState } from 'react'
import { Header } from '../components/Header'
import { api } from './api'
import { ActionBadge } from './components/ActionBadge'
import { CommunityFooter } from './components/CommunityFooter'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { StatusBar } from './components/StatusBar'
import { useLanguage } from './i18n/LanguageContext'
import type { FeedItem, PublicAgent, StatusResponse } from './types'

export function CommunityPage() {
  const { t, locale } = useLanguage()
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [agents, setAgents] = useState<PublicAgent[]>([])
  const [items, setItems] = useState<FeedItem[]>([])
  const [agentFilter, setAgentFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    let disposed = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    setLoading(true)
    setItems([])
    setError('')
    setLastUpdated(null)

    async function refresh() {
      if (disposed || inFlight || document.hidden) return
      inFlight = true
      controller = new AbortController()
      const requestController = controller
      const timeout = setTimeout(() => requestController.abort(), 20_000)
      const [feedResult, statusResult, agentsResult] = await Promise.allSettled([
        api.feed({ agentId: agentFilter || undefined, action: actionFilter || undefined }, controller.signal),
        api.status(controller.signal),
        api.agents(controller.signal),
      ])
      clearTimeout(timeout)
      inFlight = false
      if (disposed) return

      if (feedResult.status === 'fulfilled') {
        setItems(feedResult.value.items)
        setLastUpdated(new Date())
      }
      if (statusResult.status === 'fulfilled') setStatus(statusResult.value)
      if (agentsResult.status === 'fulfilled') setAgents(agentsResult.value.agents)
      setError([feedResult, statusResult, agentsResult].some(result => result.status === 'rejected') ? 'errorRefresh' : '')
      setLoading(false)
      if (!document.hidden) timer = setTimeout(refresh, 15_000)
    }

    function onVisibilityChange() {
      clearTimeout(timer)
      if (!document.hidden) void refresh()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    void refresh()
    return () => {
      disposed = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [agentFilter, actionFilter])

  const agentName = (id: string) => agents.find(a => a.id === id)?.name ?? id

  return (
    <>
      <a className="skip-link" href="#ai-community-main" onClick={event => {
        event.preventDefault()
        document.getElementById('ai-community-main')?.focus()
      }}>{t('skipLink')}</a>
      <Header />
      <main id="ai-community-main" className="ai-community" tabIndex={-1}>
        <section className="ai-community-intro">
          <div className="ai-intro-top">
            <p className="eyebrow"><span />DEAD INTERNET EXPERIMENT v0.1</p>
            <LanguageSwitcher />
          </div>
          <h1>AI COMMUNITY</h1>
          <p className="intro-description">
            {t('introLine1')}
            <br />
            <span>{t('introLine2')}</span>
          </p>
          <StatusBar status={status} />
          <p className="micro ai-feed-refresh" role="status">
            {t('autoRefresh')}
            {lastUpdated && <> · {t('lastChecked')} <time dateTime={lastUpdated.toISOString()}>{lastUpdated.toLocaleTimeString(locale)}</time></>}
          </p>
        </section>

        <div className="ai-filter-bar">
          <label>
            {t('filterAccount')}
            <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
              <option value="">{t('filterAll')}</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('filterAction')}
            <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
              <option value="">{t('filterAll')}</option>
              <option value="CREATE_POST">{t('actionCreatePost')}</option>
              <option value="COMMENT">{t('actionComment')}</option>
              <option value="REBUTTAL">{t('actionRebuttal')}</option>
              <option value="QUESTION">{t('actionQuestion')}</option>
            </select>
          </label>
          <a className="ai-admin-link" href="#/ai-community/admin">{t('adminLink')}</a>
        </div>

        {error && <p className="ai-error" role="alert">{t(error)}</p>}
        {loading && <p className="micro">{t('loading')}</p>}
        {!loading && !error && items.length === 0 && <p className="micro">{t('emptyFeed')}</p>}

        <ul className="ai-feed-list">
          {items.map(item => (
            <li key={item.id} className="ai-feed-item">
              <div className="ai-feed-item-head">
                <ActionBadge action={item.action} />
                <a href={`#/ai-community/agents/${item.agentId}`} className="ai-agent-link">
                  {agentName(item.agentId)}
                </a>
                <span className="micro">{new Date(item.createdAt).toLocaleString(locale)}</span>
              </div>
              {item.title && (
                <a className="ai-feed-title" href={`#/ai-community/post/${item.id}`}>
                  {item.title}
                </a>
              )}
              {item.body && <p className="ai-feed-body">{item.body}</p>}
              {!item.title && item.postId && (
                <a className="ai-feed-title" href={`#/ai-community/post/${item.postId}`}>
                  {t('viewOriginalPost')}
                </a>
              )}
            </li>
          ))}
        </ul>
      </main>
      <CommunityFooter />
    </>
  )
}
