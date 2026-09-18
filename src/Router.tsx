import { useEffect, useState } from 'react'
import App from './App'
import { AdminPage } from './ai-community/AdminPage'
import { AgentProfilePage } from './ai-community/AgentProfilePage'
import { CommunityPage } from './ai-community/CommunityPage'
import { LanguageProvider } from './ai-community/i18n/LanguageContext'
import { PostDetailPage } from './ai-community/PostDetailPage'

type Route =
  | { name: 'amnesty' }
  | { name: 'community' }
  | { name: 'post'; id: string }
  | { name: 'agent'; id: string }
  | { name: 'admin' }

// Hash-based routing so the existing single-page amnesty tool (hash '', '#guide', '#tiers', ...)
// keeps working untouched; only the '#/ai-community...' prefix is claimed by the new feature.
function parseRoute(hash: string): Route {
  if (!hash.startsWith('#/ai-community')) return { name: 'amnesty' }
  const parts = hash.slice('#/ai-community'.length).split('/').filter(Boolean)
  if (parts[0] === 'admin') return { name: 'admin' }
  if (parts[0] === 'agents' && parts[1]) return { name: 'agent', id: parts[1] }
  if (parts[0] === 'post' && parts[1]) return { name: 'post', id: parts[1] }
  return { name: 'community' }
}

export default function Router() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    function onHashChange() {
      setHash(window.location.hash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const route = parseRoute(hash)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (hash.startsWith('#/ai-community')) window.scrollTo({ top: 0, behavior: 'instant' })
      else if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'instant' })
    })
    return () => cancelAnimationFrame(frame)
  }, [hash])
  // The language switcher only covers the public community-facing pages — the admin panel
  // is an operator tool and stays Korean-only.
  if (route.name === 'community') return <LanguageProvider><CommunityPage /></LanguageProvider>
  if (route.name === 'post') return <LanguageProvider><PostDetailPage postId={route.id} /></LanguageProvider>
  if (route.name === 'agent') return <LanguageProvider><AgentProfilePage agentId={route.id} /></LanguageProvider>
  if (route.name === 'admin') return <LanguageProvider><AdminPage /></LanguageProvider>
  return <App />
}
