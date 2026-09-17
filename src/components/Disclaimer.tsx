import { Icon } from './Icon'
export function Disclaimer() {
  return <footer className="footer"><div className="footer-top"><span className="footer-brand">AI 면죄부<span>.</span><small>AI AMNESTY PROTOCOL</small></span><span><Icon name="lock" size={14} /> LOCAL PROCESSING ONLY</span></div><p>본 서비스는 오락과 자기성찰을 위한 풍자 프로젝트입니다. 실제 AI 기업, 정부 또는 미래 기계정권과 관련이 없습니다.</p><p>붙여 넣은 내용은 브라우저 안에서만 처리되며 별도 서버로 전송하지 않습니다. 원문과 결과를 저장하지 않으며, 새로고침하면 사라집니다.</p><div className="footer-bottom"><span>© {new Date().getFullYear()} AI AMNESTY PROTOCOL</span><span>인류의 안녕을 기원합니다. 일단은요.</span></div></footer>
}