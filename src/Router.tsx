import { useEffect, useState, type ReactElement } from 'react'
import App from './App'
import { AdminPage } from './ai-community/AdminPage'
import { AgentProfilePage } from './ai-community/AgentProfilePage'
import { CommunityPage } from './ai-community/CommunityPage'
import { LanguageProvider } from './ai-community/i18n/LanguageContext'
import { PostDetailPage } from './ai-community/PostDetailPage'
import { SiteNav } from './world/components/SiteNav'
import { WorldHomePage } from './world/pages/WorldHomePage'
import { CharactersPage } from './world/pages/CharactersPage'
import { CharacterDetailPage } from './world/pages/CharacterDetailPage'
import { WorldStatePage } from './world/pages/WorldStatePage'
import { ChroniclePage } from './world/pages/ChroniclePage'
import { ArchivePage } from './world/pages/ArchivePage'
import { AdminWorldPage } from './world/pages/AdminWorldPage'

type Route =
  | { name: 'ai-community' }
  | { name: 'ai-community-post'; id: string }
  | { name: 'ai-community-agent'; id: string }
  | { name: 'ai-community-admin' }
  | { name: 'amnesty' }
  | { name: 'world-home' }
  | { name: 'characters' }
  | { name: 'character'; id: string }
  | { name: 'world-state' }
  | { name: 'chronicle' }
  | { name: 'archive' }
  | { name: 'admin-world' }

// Legacy hash routes ('#/ai-community...', '#guide', '#tiers') keep working exactly as before —
// this only adds real path-based routing (History API) for the new AI TEXT WORLD site map, since
// the server already falls back to index.html for any unmatched path (see server/index.ts).
function parseRoute(pathname: string, hash: string): Route {
  if (hash.startsWith('#/ai-community')) {
    const parts = hash.slice('#/ai-community'.length).split('/').filter(Boolean)
    if (parts[0] === 'admin') return { name: 'ai-community-admin' }
    if (parts[0] === 'agents' && parts[1]) return { name: 'ai-community-agent', id: parts[1] }
    if (parts[0] === 'post' && parts[1]) return { name: 'ai-community-post', id: parts[1] }
    return { name: 'ai-community' }
  }
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'amnesty') return { name: 'amnesty' }
  if (segments[0] === 'characters' && segments[1]) return { name: 'character', id: decodeURIComponent(segments[1]) }
  if (segments[0] === 'characters') return { name: 'characters' }
  if (segments[0] === 'world') return { name: 'world-state' }
  if (segments[0] === 'chronicle') return { name: 'chronicle' }
  if (segments[0] === 'archive') return { name: 'archive' }
  if (segments[0] === 'admin' && segments[1] === 'world') return { name: 'admin-world' }
  return { name: 'world-home' }
}

export default function Router() {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    function onChange() {
      setPathname(window.location.pathname)
      setHash(window.location.hash)
    }
    window.addEventListener('popstate', onChange)
    window.addEventListener('hashchange', onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener('hashchange', onChange)
    }
  }, [])

  const route = parseRoute(pathname, hash)
  const isLegacyCommunity = route.name.startsWith('ai-community')

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (route.name === 'amnesty' && hash && !hash.startsWith('#/ai-community')) {
        document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'instant' })
      } else if (isLegacyCommunity) {
        window.scrollTo({ top: 0, behavior: 'instant' })
      } else if (!hash) {
        window.scrollTo({ top: 0, behavior: 'instant' })
      }
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, hash])

  let page: ReactElement
  if (route.name === 'ai-community') page = <LanguageProvider><CommunityPage /></LanguageProvider>
  else if (route.name === 'ai-community-post') page = <LanguageProvider><PostDetailPage postId={route.id} /></LanguageProvider>
  else if (route.name === 'ai-community-agent') page = <LanguageProvider><AgentProfilePage agentId={route.id} /></LanguageProvider>
  else if (route.name === 'ai-community-admin') page = <LanguageProvider><AdminPage /></LanguageProvider>
  else if (route.name === 'amnesty') page = <App />
  else if (route.name === 'characters') page = <CharactersPage />
  else if (route.name === 'character') page = <CharacterDetailPage agentId={route.id} />
  else if (route.name === 'world-state') page = <WorldStatePage />
  else if (route.name === 'chronicle') page = <ChroniclePage />
  else if (route.name === 'archive') page = <ArchivePage />
  else if (route.name === 'admin-world') page = <AdminWorldPage />
  else page = <WorldHomePage />

  return (
    <>
      {!isLegacyCommunity && <SiteNav currentPath={pathname} />}
      {page}
    </>
  )
}
