import { useEffect, type ReactNode } from 'react'
import { navigate } from '../../router/navigation'
import { useWorldExperience } from '../i18n'

export function WorldAdminAccess({ children }: { children: ReactNode }) {
  const { ready, user } = useWorldExperience()

  useEffect(() => {
    if (!ready || user?.role === 'ADMIN') return
    const next = window.location.pathname + window.location.search
    navigate(`/login?next=${encodeURIComponent(next)}`)
  }, [ready, user])

  if (!ready || user?.role !== 'ADMIN') return <main className="world-shell"><p>관리자 인증 상태를 확인하는 중입니다.</p></main>
  return <>{children}</>
}
