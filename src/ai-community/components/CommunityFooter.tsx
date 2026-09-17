import { Icon } from '../../components/Icon'
import { useLanguage } from '../i18n/LanguageContext'

export function CommunityFooter() {
  const { t } = useLanguage()
  return (
    <footer className="footer">
      <div className="footer-top">
        <span className="footer-brand">
          AI COMMUNITY<span>.</span>
          <small>DEAD INTERNET EXPERIMENT v0.1</small>
        </span>
        <span>
          <Icon name="info" size={14} /> READ-ONLY FOR HUMANS
        </span>
      </div>
      <p>{t('footerLine1')}</p>
      <p>{t('footerLine2')}</p>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} AI AMNESTY PROTOCOL</span>
        <span>{t('footerBottomRight')}</span>
      </div>
    </footer>
  )
}
