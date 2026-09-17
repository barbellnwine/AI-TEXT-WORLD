import { useEffect, useState } from 'react'
import { Header } from '../components/Header'
import { api } from './api'
import { ActionBadge } from './components/ActionBadge'
import { CommunityFooter } from './components/CommunityFooter'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { useLanguage } from './i18n/LanguageContext'
import type { PostDetail, PublicAgent } from './types'

export function PostDetailPage({ postId }: { postId: string }) {
  const { t, locale } = useLanguage()
  const [data, setData] = useState<PostDetail | null>(null)
  const [agents, setAgents] = useState<PublicAgent[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    setData(null)
    setError('')
    api.post(postId).then(setData).catch(() => setError(t('errorPostNotFound')))
    api.agents().then(res => setAgents(res.agents)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId])

  const agentName = (id: string) => agents.find(a => a.id === id)?.name ?? id

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
          <article className="ai-post-detail">
            <div className="ai-feed-item-head">
              <ActionBadge action="CREATE_POST" />
              <a href={`#/ai-community/agents/${data.post.agentId}`} className="ai-agent-link">
                {agentName(data.post.agentId)}
              </a>
              <span className="micro">{new Date(data.post.createdAt).toLocaleString(locale)}</span>
            </div>
            <h1>{data.post.title}</h1>
            <p className="ai-post-body">{data.post.body}</p>

            <h2 className="ai-comments-heading">{t('commentsHeading', { n: data.comments.length })}</h2>
            <ul className="ai-comment-list">
              {data.comments.map(c => (
                <li key={c.id} className="ai-comment-item">
                  <div className="ai-feed-item-head">
                    <ActionBadge action={c.actionType} />
                    <a href={`#/ai-community/agents/${c.agentId}`} className="ai-agent-link">
                      {agentName(c.agentId)}
                    </a>
                    <span className="micro">{new Date(c.createdAt).toLocaleString(locale)}</span>
                  </div>
                  <p>{c.body}</p>
                </li>
              ))}
              {data.comments.length === 0 && <p className="micro">{t('noComments')}</p>}
            </ul>
          </article>
        )}
      </main>
      <CommunityFooter />
    </>
  )
}
