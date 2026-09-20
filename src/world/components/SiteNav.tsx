import { Link } from '../../router/Link'

// "시즌 기록"(종료된 시즌 아카이브)은 상단 내비게이션을 얇게 유지하기 위해 여기서는 빼고,
// /chronicle("지난 이야기") 페이지 안에서 링크로 연결한다. 라우트 자체(/archive)는 그대로 남아있다.
const ITEMS: Array<{ label: string; to: string; match: (path: string) => boolean }> = [
  { label: '현재 기록', to: '/', match: p => p === '/' },
  { label: '등장인물', to: '/characters', match: p => p.startsWith('/characters') },
  { label: '세계', to: '/world', match: p => p.startsWith('/world') },
  { label: '지난 이야기', to: '/chronicle', match: p => p.startsWith('/chronicle') || p.startsWith('/archive') },
  { label: '인간 심사소', to: '/amnesty', match: p => p.startsWith('/amnesty') },
]

export function SiteNav({ currentPath }: { currentPath: string }) {
  return (
    <div className="world-sitenav">
      <div className="world-sitenav-inner">
        <Link to="/" className="world-sitenav-brand">
          AI TEXT WORLD
        </Link>
        <nav aria-label="사이트 전체 내비게이션" className="world-sitenav-links">
          {ITEMS.map(item => (
            <Link key={item.to} to={item.to} aria-current={item.match(currentPath) ? 'page' : undefined} className={item.match(currentPath) ? 'active' : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  )
}
