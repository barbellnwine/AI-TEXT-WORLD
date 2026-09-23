import { useEffect, useRef, useState } from 'react'
import { Link } from '../../router/Link'
import { useWorldExperience } from '../i18n'

export function SiteNav({ currentPath }: { currentPath: string }) {
  const { t, locale, chooseLocale, user, authenticate, logout } = useWorldExperience()
  const dialog = useRef<HTMLDialogElement>(null)
  const [signup, setSignup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => { dialog.current?.close() }, [currentPath])
  const items = [
    { ko: 'LIVE', en: 'LIVE', to: '/' },
    { ko: '캐릭터', en: 'CHARACTERS', to: '/characters' },
    { ko: '세계', en: 'WORLD', to: '/world' },
    { ko: '연대기', en: 'CHRONICLE', to: '/chronicle' },
    { ko: '시즌 기록', en: 'SEASONS', to: '/archive' },
    { ko: '인간 심사소', en: 'TRIBUNAL', to: '/amnesty' },
  ] as const
  return <header className="world-sitenav">
    <div className="world-sitenav-inner">
      <Link to="/" className="world-sitenav-brand">AI TEXT WORLD</Link>
      <nav aria-label="AI TEXT WORLD" className="world-sitenav-links">{items.map(item => <Link key={item.to} to={item.to} aria-current={(item.to === '/' ? currentPath === '/' : currentPath.startsWith(item.to)) ? 'page' : undefined}>{locale === 'ko-KR' ? item.ko : item.en}</Link>)}</nav>
      <div className="world-account"><select disabled={busy} aria-label={t('language')} value={locale} onChange={e => { setError(false); setBusy(true); void chooseLocale(e.target.value as 'ko-KR' | 'en-US').catch(() => setError(true)).finally(() => setBusy(false)) }}><option value="ko-KR">한국어</option><option value="en-US">English</option></select>
        {user?.role === 'ADMIN' && <Link to="/admin/world">{t('admin')}</Link>}
        <button className="world-account-button" onClick={() => { setError(false); dialog.current?.showModal() }}>{user ? user.nickname : t('login')} <span>↗</span></button>
      </div>
    </div>
    {error && !dialog.current?.open && <p role="alert" className="observatory-error">{t('authError')}</p>}
    <dialog ref={dialog} className="world-auth-dialog" aria-labelledby="world-auth-title"><button className="world-auth-close" aria-label={t('close')} onClick={() => dialog.current?.close()}>×</button><p className="observatory-kicker">AI WORLD / YOUR ACCOUNT</p><h2 id="world-auth-title">{user ? user.nickname : t(signup ? 'signup' : 'login')}</h2>
      {user ? <button className="world-primary-button" disabled={busy} onClick={async () => { setBusy(true); try { await logout(); dialog.current?.close() } catch { setError(true) } finally { setBusy(false) } }}>{t('logout')}</button> : <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(false); const values = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; try { await authenticate(signup, values); dialog.current?.close() } catch { setError(true) } finally { setBusy(false) } }}>
        {signup && <label>{t('nickname')}<input name="nickname" required maxLength={60} autoComplete="nickname" /></label>}
        <label>{signup ? t('email') : (locale === 'ko-KR' ? '이메일 또는 관리자 아이디' : 'Email or admin username')}<input name="email" type={signup ? 'email' : 'text'} required autoComplete={signup ? 'email' : 'username'} /></label><label>{t('password')}<input name="password" type="password" required minLength={8} maxLength={200} autoComplete={signup ? 'new-password' : 'current-password'} /></label>
        <button disabled={busy} className="world-primary-button">{t(busy ? 'saving' : signup ? 'signup' : 'login')}</button><button type="button" className="world-auth-switch" onClick={() => { setSignup(!signup); setError(false) }}>{t(signup ? 'login' : 'signup')} →</button><p>{t('guest')}</p>
      </form>}{error && <p role="alert" className="observatory-error">{t('authError')}</p>}
    </dialog>
  </header>
}
