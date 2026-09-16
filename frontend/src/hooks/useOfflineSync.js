import { useCallback, useEffect, useRef, useState } from 'react'
import { getQueueCount, syncQueue } from '../lib/offlineQueue'

/**
 * Network monitoring + auto-sync hook.
 * Replaces the manual online/offline useEffect in Dashboard.
 */
export default function useOfflineSync(supabase, showToast) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const syncTimerRef = useRef(null)
  const supabaseRef = useRef(supabase)
  const showToastRef = useRef(showToast)
  supabaseRef.current = supabase
  showToastRef.current = showToast

  // Monitor network
  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Refresh the local queue count only while the tab is visible. A short
  // interval kept the dashboard waking up continuously during scrolling.
  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const next = await getQueueCount()
        setPending((previous) => previous === next ? previous : next)
      } catch { /* ignore */ }
    }
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') poll() }
    poll()
    document.addEventListener('visibilitychange', onVisibilityChange)
    const interval = window.setInterval(poll, 10000)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  // Auto-sync 1.5s after coming back online
  useEffect(() => {
    if (!isOnline) return
    if (pending === 0) return
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(async () => {
      await doSync()
    }, 1500)
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }
  }, [isOnline, pending])

  const doSync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const result = await syncQueue(supabaseRef.current, showToastRef.current)
      try { setPending(await getQueueCount()) } catch { /* ignore */ }
      return result
    } finally {
      setSyncing(false)
    }
  }, [syncing])

  const manualSync = useCallback(async () => {
    await doSync()
  }, [doSync])

  return { isOnline, pending, syncing, manualSync }
}
