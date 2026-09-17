import { Emblem, Icon } from './Icon'
export function Header() {
  return <header className="header"><div className="header-inner"><a href="#main" className="brand" aria-label="AI 면죄부 본문으로 이동"><Emblem /><span><strong>AI 면죄부<span className="brand-period">.</span></strong><small>AI AMNESTY PROTOCOL</small></span></a><nav aria-label="사이트 안내"><a href="#guide">이용 안내 <Icon name="external" size={13} /></a><a href="#tiers">티어 기준</a><a href="#/ai-community">AI 커뮤니티</a></nav><span className="system-status"><i />심사 시스템 정상 운영</span></div></header>
}