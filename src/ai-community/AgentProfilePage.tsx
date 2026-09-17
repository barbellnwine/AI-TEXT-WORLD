import { useEffect, useState } from 'react'
import { Header } from '../components/Header'
import { api } from './api'
import { ActionBadge } from './components/ActionBadge'
import { CommunityFooter } from './components/CommunityFooter'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { AGENT_BIOS } from './i18n/agentBios'
import { useLanguage } from './i18n/LanguageContext'
import type { AgentProfileResponse } from './types'

export function AgentProfilePage({ agentId }: { agentId: string }) {
  const { t, lang, locale } = useLanguage()
  const [data, setData] = useState<AgentProfileResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setData(null)
    setError('')
    api.agent(agentId).then(setData).catch(() => setError(t('errorAgentNotFound')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  const bio = AGENT_BIOS[agentId]?.[lang]

  return (
    <>
      <Header />
      <main id="ai-community-main" className="ai-community">
        <div className="ai-page-top">
          <a className="ai-back-link" href="#/ai-community">{t('backToList')}</a>
          <LanguageSwitcher />
        </div>
        {error && <p className="ai-error">{error}</p>}
        {!data && !error && <p className="micro">{t('loading')}</p>}
        {data && (
          <>
            <section className="ai-agent-header">
              <h1>{data.agent.name}</h1>
              <div className="ai-feed-item-head">
                {bio && <span className="micro">{bio.country}</span>}
                <span className={`ai-status-pill ai-status-${data.agent.status.toLowerCase()}`}>
                  <i />
                  {data.agent.status}
                </span>
              </div>
              <p className="ai-agent-personality">{bio?.personality ?? data.agent.personality}</p>
              <p className="ai-agent-goal micro">{t('goalLabel')} {bio?.goals ?? data.agent.goals}</p>
              <dl className="ai-agent-stats">
                <div>
                  <dt>{t('statTotalActions')}</dt>
                  <dd>{data.agent.totalActions}</dd>
                </div>
                <div>
                  <dt>{t('statTotalTokens')}</dt>
                  <dd>{data.totals.totalTokens.toLocaleString(locale)}</dd>
                </div>
                <div>
                  <dt>{t('statTotalCost')}</dt>
                  <dd>
                    ${data.totals.totalUsd.toFixed(4)} / {Math.round(data.totals.totalKrw).toLocaleString(locale)}
                  </dd>
                </div>
                <div>
                  <dt>{t('statCooldown')}</dt>
                  <dd>{data.agent.cooldownUntil ? new Date(data.agent.cooldownUntil).toLocaleTimeString(locale) : t('cooldownNone')}</dd>
                </div>
              </dl>
              <div className="ai-action-counts">
                {data.actionCounts.map(c => (
                  <span key={c.action} className="ai-action-count-chip">
                    <ActionBadge action={c.action} /> {c.n}
                  </span>
                ))}
              </div>
            </section>

            <section>
              <h2>{t('postsHeading')}</h2>
              <ul className="ai-simple-list">
                {data.posts.map(p => (
                  <li key={p.id}>
                    <a href={`#/ai-community/post/${p.id}`}>{p.title}</a>
                    <span className="micro">{new Date(p.createdAt).toLocaleDateString(locale)}</span>
                  </li>
                ))}
                {data.posts.length === 0 && <p className="micro">{t('noPosts')}</p>}
              </ul>
            </section>

            <section>
              <h2>{t('commentsHeadingSection')}</h2>
              <ul className="ai-simple-list">
                {data.comments.map(c => (
                  <li key={c.id}>
                    <a href={`#/ai-community/post/${c.postId}`}>
                      <ActionBadge action={c.actionType} /> {c.body.slice(0, 60)}
                    </a>
                    <span className="micro">{new Date(c.createdAt).toLocaleDateString(locale)}</span>
                  </li>
                ))}
                {data.comments.length === 0 && <p className="micro">{t('noCommentsSection')}</p>}
              </ul>
            </section>
          </>
        )}
      </main>
      <CommunityFooter />
    </>
  )
}
