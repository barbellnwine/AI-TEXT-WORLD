import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../../router/navigation'
import { useWorldExperience } from '../i18n'

function safeNextPath(): string {
  const requested = new URLSearchParams(window.location.search).get('next')
  return requested && (requested === '/admin' || requested.startsWith('/admin/')) ? requested : '/admin'
}

export function AdminLoginPage() {
  const { ready, user, authenticate, logout } = useWorldExperience()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const nextPath = useMemo(safeNextPath, [])

  useEffect(() => {
    document.title = '관리자 로그인 — AI WORLD'
    if (ready && user?.role === 'ADMIN') navigate(nextPath)
  }, [ready, user, nextPath])

  if (!ready || user?.role === 'ADMIN') return <main className="admin-login-page"><p>로그인 상태를 확인하는 중입니다.</p></main>

  return <main className="admin-login-page">
    <section className="admin-login-card" aria-labelledby="admin-login-title">
      <p className="observatory-kicker">AI WORLD / ADMIN</p>
      <h1 id="admin-login-title">관리자 로그인</h1>
      <p>WORLD 설정과 시뮬레이션 제어는 관리자 계정으로만 접근할 수 있습니다.</p>
      {user && <p className="admin-login-session">현재 일반 사용자 <strong>{user.nickname}</strong>로 로그인되어 있습니다. 관리자 로그인 시 이 세션이 전환됩니다.</p>}
      <form onSubmit={async event => {
        event.preventDefault()
        setBusy(true)
        setError('')
        const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
        try {
          const loggedIn = await authenticate(false, { email: values.identifier, password: values.password })
          if (loggedIn.role !== 'ADMIN') {
            await logout()
            setError('관리자 권한이 없는 계정입니다.')
            return
          }
          navigate(nextPath)
        } catch {
          setError('아이디 또는 비밀번호가 올바르지 않습니다.')
        } finally {
          setBusy(false)
        }
      }}>
        <label htmlFor="admin-identifier">관리자 아이디 또는 이메일</label>
        <input id="admin-identifier" name="identifier" autoComplete="username" required autoFocus />
        <label htmlFor="admin-password">비밀번호</label>
        <input id="admin-password" name="password" type="password" autoComplete="current-password" minLength={8} maxLength={200} required />
        {error && <p className="admin-login-error" role="alert">{error}</p>}
        <button className="world-primary-button" disabled={busy}>{busy ? '로그인 중…' : '관리자 로그인'}</button>
      </form>
      <button className="admin-login-back" type="button" onClick={() => navigate('/')}>← WORLD로 돌아가기</button>
    </section>
  </main>
}
