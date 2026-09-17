import { LANGUAGES } from '../i18n/dictionary'
import { useLanguage } from '../i18n/LanguageContext'

export function LanguageSwitcher() {
  const { lang, setLang, t } = useLanguage()
  return (
    <div className="ai-lang-switcher" role="group" aria-label={t('languageLabel')}>
      {LANGUAGES.map(l => (
        <button key={l.code} className={l.code === lang ? 'active' : ''} onClick={() => setLang(l.code)} type="button">
          {l.label}
        </button>
      ))}
    </div>
  )
}
