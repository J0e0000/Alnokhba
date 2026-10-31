import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import dictionary, { WEEKDAY_KEYS, REPORT_FIELD_KEYS } from '../lib/i18n'

const LanguageContext = createContext(null)

/**
 * Synchronously apply language BEFORE React renders (prevents flicker).
 * Called from index.html inline script or main.jsx top-level.
 */
export function applyLanguageSynchronously(lang) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  document.documentElement.setAttribute('dir', dir)
  document.documentElement.setAttribute('lang', lang)
}

export function LanguageProvider({ children }) {
  // Read from localStorage BEFORE first render (synchronous init)
  const [lang, setLangState] = useState(() => {
    const saved = localStorage.getItem('app-language')
    const initial = saved === 'en' ? 'en' : 'ar'
    // Apply synchronously on mount
    applyLanguageSynchronously(initial)
    return initial
  })

  const setLang = useCallback((newLang) => {
    setLangState(newLang)
    localStorage.setItem('app-language', newLang)
  }, [])

  const toggleLang = useCallback(() => {
    setLang(lang === 'ar' ? 'en' : 'ar')
  }, [lang, setLang])

  // Apply dir/lang whenever it changes
  useEffect(() => {
    applyLanguageSynchronously(lang)
  }, [lang])

  /**
   * Translation function: t('key') or t('key', { param: value })
   * Falls back to Arabic if key is missing in current language.
   */
  const t = useCallback((key, params) => {
    let str = dictionary[lang]?.[key] ?? dictionary.ar[key] ?? key
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\{${k}\}`, 'g'), v)
      })
    }
    return str
  }, [lang])

  const isArabic = lang === 'ar'

  /** Get weekday label by JS getDay() index (0=Sun) */
  const weekday = useCallback((dayIndex) => {
    return t(WEEKDAY_KEYS[dayIndex] || 'sun')
  }, [t])

  /** Get report field label by key */
  const reportFieldLabel = useCallback((key) => {
    return t(`rf_${key}`)
  }, [t])

  const value = useMemo(() => ({ lang, setLang, toggleLang, t, isArabic, weekday, reportFieldLabel }), [lang, setLang, toggleLang, t, isArabic, weekday, reportFieldLabel])

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider')
  return ctx
}
