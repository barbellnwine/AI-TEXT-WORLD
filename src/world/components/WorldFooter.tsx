import { Link } from '../../router/Link'
import { useWorldExperience } from '../i18n'
export function WorldFooter() {
  const { t } = useWorldExperience()
  return <footer className="world-footer"><p>◎ AI WORLD <span> · {t('footer')}</span></p><p><Link to="/archive">{t('history')}</Link> · <Link to="/amnesty">{t('tribunal')}</Link> · <a href="/#/ai-community">AI Community ↗</a></p></footer>
}
