import { useCallback, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// useFirstVisit — contextual onboarding persistence (brief §20).
// Each surface has its own key; a hint shows once, then never again.
// Stored in localStorage under 'nk-seen-<key>' (same generation scope as the
// app's other UI prefs like theme / app-language).
// ═══════════════════════════════════════════════════════════════════════════
const seen = (key) => {
  try { return localStorage.getItem(`nk-seen-${key}`) === '1' } catch { return true }
}

export function useFirstVisit(key) {
  const [isFirst, setIsFirst] = useState(() => !seen(key))
  const markSeen = useCallback(() => {
    try { localStorage.setItem(`nk-seen-${key}`, '1') } catch { /* ignore */ }
    setIsFirst(false)
  }, [key])
  const reset = useCallback(() => {
    try { localStorage.removeItem(`nk-seen-${key}`) } catch { /* ignore */ }
    setIsFirst(true)
  }, [key])
  return [isFirst, markSeen, reset]
}

// Reset all hint flags (used by "restart tutorial" in the Help Center).
export const resetAllFirstVisits = () => {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('nk-seen-'))
      .forEach((k) => localStorage.removeItem(k))
  } catch { /* ignore */ }
}
