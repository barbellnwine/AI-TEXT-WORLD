import type { ReactNode } from 'react'
import { useWorldExperience } from '../i18n'

export function WorldAdminAccess({ children }: { children: ReactNode }) {
  const { ready, user } = useWorldExperience()
  if (!ready) return <main className="world-shell"><p>로그인 확인 중…</p></main>
  if (user?.role !== 'ADMIN') return <main className="world-shell"><h1>관리자 전용 화면</h1><p>{user ? '이 계정에는 관리자 권한이 없습니다.' : '상단 로그인 버튼으로 관리자 계정에 로그인해 주세요.'}</p></main>
  return <>{children}</>
}
