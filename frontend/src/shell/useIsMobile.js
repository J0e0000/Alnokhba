import { useEffect, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// useIsMobile — media-query driven mobile detection (NOT viewport width
// sniffing inside render). Matches the app's lg breakpoint (1024px): below
// it the bottom nav shows and the session workspace enters FOCUS MODE.
// Desktop (>1023px) keeps the existing shell untouched (spec: desktop is
// generally acceptable — do not unnecessarily restructure it).
// ═══════════════════════════════════════════════════════════════════════════

const QUERY = '(max-width: 1023px)'

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    try { return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY).matches : false } catch { return false }
  })

  useEffect(() => {
    let mq
    try { mq = window.matchMedia(QUERY) } catch { return undefined }
    if (!mq) return undefined
    const onChange = (e) => setIsMobile(e.matches)
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else if (mq.addListener) mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else if (mq.removeListener) mq.removeListener(onChange)
    }
  }, [])

  return isMobile
}
