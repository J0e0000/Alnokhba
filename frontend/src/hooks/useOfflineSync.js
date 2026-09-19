import { useCallback, useEffect, useRef, useState } from 'react'
import { getQueueCount, syncQueue } from '../lib/offlineQueue'

// ── Real reachability probe ────────────────────────────────────────────────
// WHY THIS EXISTS — the offline banner used to get STUCK on "أنت غير متصل":
// it trusted navigator.onLine + online/offline events blindly. Those reflect
// the OS network ADAPTER state, not actual internet reachability. A spurious
// `offline` event (Wi-Fi roaming, VPN blip, sleep/wake, adapter reset) flipped
// the state to offline — and since the adapter never really changed state
// again, no `online` event ever fired to clear it, while data kept loading
// fine. Now the probe is the ground truth: a tiny same-origin HEAD request —
// ANY HTTP response (even 404/405) proves the internet path works. It runs
// while the banner shows and auto-recovers without needing any event.
async function probeConnectivity(timeoutMs = 6000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = setTimeout(() => { try { if (controller) controller.abort() } catch { /* noop */ } }, timeoutMs)
  try {
    await fetch(`${window.location.origin}/favicon.ico?nk=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    })
    return true // ANY response = network path alive
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Network monitoring + auto-sync hook.
 * Replaces the manual online/offline useEffect in Dashboard.
 *
 * Reliability contract:
 *   - `online` event → back online immediately (standard fast path).
 *   - `offline` event → show offline state, then VERIFY with probes
 *     (first after a 1.5s grace so blips self-heal, then every 5s).
 *     The probe result overrides navigator.onLine — a spurious offline
 *     event self-clears within seconds; a genuine outage keeps the banner
 *     until the network actually returns. No more stuck banner while
 *     connected.
 *   - Tab focus while "offline" → probe immediately (speeds recovery after
 *     wake-from-sleep, the #1 real-world trigger).
 *   - Boot with navigator.onLine === false → verify before trusting it.
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

  // Monitor network — with real-verification recovery while "offline".
  useEffect(() => {
    let stopped = false
    let verifyTimer = null
    let onlineRef = navigator.onLine // mirror for event handlers

    const stopVerifying = () => { if (verifyTimer) { clearTimeout(verifyTimer); verifyTimer = null } }

    // One probe at a time; re-arms itself while the offline state persists.
    const scheduleProbe = (delayMs) => {
      if (stopped || verifyTimer) return
      verifyTimer = setTimeout(async () => {
        verifyTimer = null
        if (stopped || onlineRef) return // recovered via event meanwhile
        const reachable = await probeConnectivity()
        if (stopped || onlineRef) return
        if (reachable) {
          onlineRef = true
          setIsOnline(true) // recovered — no `online` event needed
        } else {
          scheduleProbe(5000) // still dark — keep checking every 5s
        }
      }, delayMs)
    }

    const goOnline = () => { onlineRef = true; stopVerifying(); setIsOnline(true) }
    const goOffline = () => {
      onlineRef = false
      setIsOnline(false)
      scheduleProbe(1500) // grace period, then verify
    }

    // Speeds up recovery after wake-from-sleep / tab refocus while the
    // offline banner is showing.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (onlineRef) return
      stopVerifying()
      scheduleProbe(0)
    }

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    document.addEventListener('visibilitychange', onVisible)
    // Boot check: some browsers/VMs report onLine=false at load while the
    // internet actually works — verify before trusting the initial state.
    if (!navigator.onLine) scheduleProbe(1000)

    return () => {
      stopped = true
      stopVerifying()
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      document.removeEventListener('visibilitychange', onVisible)
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
