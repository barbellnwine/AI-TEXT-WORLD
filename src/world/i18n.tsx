import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const ko = {
  tribunal: 'AI 심판소',
  live: '현재 이야기', characters: '등장인물', map: '미니맵', history: '지난 이야기', events: '최근 사건',
  clearSelection: '선택 해제',
  login: '로그인', logout: '로그아웃', signup: '회원가입', email: '이메일', password: '비밀번호', nickname: '닉네임',
  guest: '로그인 없이도 세계를 관전할 수 있습니다.', close: '닫기', admin: '관리자', language: '언어',
  intro: '당신이 보고 있지 않아도, 이 세계는 멈추지 않습니다.',
  subtitle: '당신이 잠든 사이에도, 그들은 살아가고 있었습니다.\n당신이 돌아왔을 때, 세계는 이미 달라져 있을지도 모릅니다.',
  introInvitation: '지금, 살아 움직이는 AI 세계를 관전하세요.',
  story: '세계의 이야기', storyNote: '실제로 일어난 사건이 이야기가 됩니다.', people: '이 세계를 살아가는 사람들',
  all: '전체 보기', resources: '세계의 자원', topology: '공개 위치를 표시한 개략도입니다.',
  location: '현재 위치', selected: '선택한 인물', recent: '최근 행동', profile: '인물 자세히 보기',
  emptyEvents: '아직 공개된 사건이 없습니다.', loading: '세계를 여는 중…', error: '세계 정보를 불러오지 못했습니다.',
  connected: '실시간 연결', reconnecting: '연결 대기', RUNNING: '진행 중', PAUSED: '일시정지', ENDED: '종료', NOT_STARTED: '시작 전',
  clear: '맑음', cloudy: '흐림', rain: '비', storm: '폭풍', fog: '안개', snow: '눈',
  alive: '생존', injured: '부상', missing: '실종', deceased: '사망',
  footer: '선택은 흔적을 남기고, 세계는 그 다음을 기억합니다.', original: '이야기와 세계 데이터는 현재 원문으로 표시됩니다.',
  authError: '요청을 완료하지 못했습니다. 입력 내용과 연결 상태를 확인해 주세요.', saving: '처리 중…',
  first: '처음부터 읽기', latest: '최신 기록으로 이동', important: '중요 장면만', size: '글자 크기', small: '작게', medium: '보통', large: '크게', light: '밝은 기록지', dark: '어두운 기록지', older: '이전 기록 불러오기', reading: '기록을 펼치는 중…', noScenes: '아직 기록된 장면이 없습니다.', newScene: '새로운 기록이 도착했습니다.', evidence: '기록 근거 보기', changes: '이 장면에서 달라진 것',
}
const en: typeof ko = {
  tribunal: 'AI Tribunal',
  live: 'Live story', characters: 'Characters', map: 'Minimap', history: 'Story archive', events: 'Recent events',
  clearSelection: 'Clear selection',
  login: 'Log in', logout: 'Log out', signup: 'Sign up', email: 'Email', password: 'Password', nickname: 'Nickname', guest: 'Explore the world without an account.', close: 'Close', admin: 'Admin', language: 'Language',
  intro: 'The world goes on. Even when you’re away.', subtitle: 'One shared world, shaped by independent memories and choices. Witness what happens next.',
  introInvitation: 'Witness a living AI world, right now.',
  story: 'The world’s story', storyNote: 'Real events become the story.', people: 'The people of this world', all: 'View all', resources: 'World resources', topology: 'Schematic view of public locations.', location: 'Current location', selected: 'Selected character', recent: 'Recent action', profile: 'View character',
  emptyEvents: 'No public events yet.', loading: 'Opening the world…', error: 'Could not load the world.', connected: 'Connected', reconnecting: 'Reconnecting', RUNNING: 'Running', PAUSED: 'Paused', ENDED: 'Ended', NOT_STARTED: 'Not started',
  clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm', fog: 'Fog', snow: 'Snow', alive: 'Alive', injured: 'Injured', missing: 'Missing', deceased: 'Deceased',
  footer: 'Every choice leaves a trace. The world remembers what comes next.', original: 'Stories and world data are currently shown in their original language.', authError: 'Unable to complete the request. Check your details and connection.', saving: 'Please wait…',
  first: 'Read from the start', latest: 'Jump to latest', important: 'Important scenes', size: 'Text size', small: 'Small', medium: 'Medium', large: 'Large', light: 'Light paper', dark: 'Dark paper', older: 'Load earlier entries', reading: 'Opening the story…', noScenes: 'No scenes recorded yet.', newScene: 'A new story has arrived.', evidence: 'View source events', changes: 'What changed in this scene',
}
type Locale = 'ko-KR' | 'en-US'
interface User { id: string; nickname: string; role: 'USER' | 'ADMIN'; locale: string }
async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/auth/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error('auth_request_failed')
  return res.json()
}
const Context = createContext<{
  locale: Locale; t: (key: keyof typeof ko) => string; chooseLocale: (locale: Locale) => Promise<void>;
  ready: boolean; user: User | null; authenticate: (signup: boolean, values: Record<string, string>) => Promise<void>; logout: () => Promise<void>;
}>(null!)

export function WorldExperienceProvider({ children, welcome = true }: { children: ReactNode; welcome?: boolean }) {
  const [locale, setLocale] = useState<Locale>(() => { try { return localStorage.getItem('ai_world_locale') === 'en-US' ? 'en-US' : 'ko-KR' } catch { return 'ko-KR' } })
  const [firstVisit, setFirstVisit] = useState(() => { try { return !localStorage.getItem('ai_world_locale') } catch { return false } })
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  function applyLocale(value: Locale) { setLocale(value); setFirstVisit(false); try { localStorage.setItem('ai_world_locale', value) } catch { /* storage is optional */ } }
  function acceptUser(value: User) { setUser(value); applyLocale(value.locale === 'en-US' ? 'en-US' : 'ko-KR') }
  useEffect(() => { let active = true; request<{ user: User | null }>('me').then(res => { if (active && res.user) acceptUser(res.user) }).catch(() => {}).finally(() => { if (active) setReady(true) }); return () => { active = false } }, [])
  useEffect(() => { document.documentElement.lang = locale.slice(0, 2) }, [locale])
  async function chooseLocale(value: Locale) { if (user) await request('locale', { locale: value }); applyLocale(value) }
  async function authenticate(signup: boolean, values: Record<string, string>) { const result = await request<{ user: User }>(signup ? 'signup' : 'login', { ...values, identifier: values.email, locale }); acceptUser(result.user) }
  async function logout() { await request('logout', {}); setUser(null) }
  return <Context.Provider value={{ locale, t: key => (locale === 'en-US' ? en : ko)[key], chooseLocale, ready, user, authenticate, logout }}>
    {welcome && ready && firstVisit ? <main className="world-welcome"><span className="world-orbit" aria-hidden="true">◎</span><p className="observatory-kicker">AI WORLD / A LIVING WORLD</p><h1>하나의 세계,<br />서로 다른 이야기.</h1><p>Choose your language to step inside.</p><div><button onClick={() => void chooseLocale('ko-KR')}>한국어 <span>→</span></button><button onClick={() => void chooseLocale('en-US')}>English <span>→</span></button></div><small>로그인 없이 관전할 수 있습니다. · No account needed.</small></main> : children}
  </Context.Provider>
}
export function useWorldExperience() { return useContext(Context) }
