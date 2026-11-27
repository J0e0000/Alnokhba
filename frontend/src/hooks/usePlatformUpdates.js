import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { dismissUpdatePopup, isUpdatePopupDismissed, retireUpdateNotifications } from '../lib/platformUpdates'

/**
 * usePlatformUpdates() — retires the old ✨ seeded notices (one sweep per
 * teacher per session) and drives the ONE-TIME welcome popup (note #23):
 * 'checking' → 'show' (first open, not dismissed) | 'dismissed'.
 * The ◔ launcher re-opens the tutorial via openPopup(); there is no unread
 * badge anymore — the pinned updates section is gone from the center.
 */
export function usePlatformUpdates() {
  const { effectiveTeacherId } = useAuth()
  const [popupState, setPopupState] = useState('checking')

  useEffect(() => {
    let alive = true
    if (!effectiveTeacherId) { setPopupState('dismissed'); return }
    setPopupState('checking')
    ;(async () => {
      try { await retireUpdateNotifications(effectiveTeacherId) } catch { /* non-fatal */ }
      const { dismissed } = await isUpdatePopupDismissed(effectiveTeacherId)
      if (alive) setPopupState(dismissed ? 'dismissed' : 'show')
    })()
    return () => { alive = false }
  }, [effectiveTeacherId])

  const dismissPopup = useCallback(() => {
    setPopupState('dismissed')
    if (effectiveTeacherId) dismissUpdatePopup(effectiveTeacherId).catch(() => {})
  }, [effectiveTeacherId])

  const openPopup = useCallback(() => setPopupState('show'), [])

  return { popupState, dismissPopup, openPopup }
}
