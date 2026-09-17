import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { DICTIONARY, LANGUAGES, type Lang } from './dictionary'

const STORAGE_KEY = 'aiCommunityLang'

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && LANGUAGES.some(l => l.code === stored)) return stored as Lang
  } catch {
    /* ignore: private-mode browsers may block storage */
  }
  return 'ko'
}

interface LanguageContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
  locale: string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang)

  function setLang(next: Lang) {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* per-viewer convenience only; safe to ignore if storage is unavailable */
    }
  }

  const value = useMemo<LanguageContextValue>(() => {
    const dict = DICTIONARY[lang]
    const locale = LANGUAGES.find(l => l.code === lang)?.locale ?? 'ko-KR'
    function t(key: string, vars?: Record<string, string | number>): string {
      let text = dict[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v))
      return text
    }
    return { lang, setLang, t, locale }
  }, [lang])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
