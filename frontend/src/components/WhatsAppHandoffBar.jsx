/**
 * WhatsAppHandoffBar — the guaranteed WhatsApp path on iPhone (Round 4).
 *
 * Root cause it fixes: iOS Safari silently drops JS-initiated WhatsApp
 * navigation (window.open after await, named-window reuse, blank reserved
 * windows). The ONLY navigation iOS never blocks is a link the user actually
 * taps. Every send in the app therefore publishes its prepared wa.me link
 * here, and this bar renders it as a REAL <a href target="_blank">.
 *
 * Behavior:
 *  - Appears at the bottom whenever a WhatsApp send is prepared.
 *  - Auto-dismisses after 20s (the automatic handoff usually already worked
 *    on desktop/Android — this bar is the safety net, not noise).
 *  - Tapping the green button opens WhatsApp natively — always works.
 *  - A new send replaces the current bar and resets the timer.
 */
import { useEffect, useRef, useState } from 'react'
import { subscribeWhatsAppHandoff } from '../lib/helpers'

const AUTO_DISMISS_MS = 20000

function decodeMessageFromUrl(waUrl) {
  try { return new URL(waUrl).searchParams.get('text') || '' } catch { return '' }
}

export default function WhatsAppHandoffBar() {
  const [handoff, setHandoff] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const dismissTimerRef = useRef(null)

  useEffect(() => subscribeWhatsAppHandoff((event) => {
    setHandoff(event)
    setRemaining(AUTO_DISMISS_MS)
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current)
  }), [])

  useEffect(() => {
    if (!handoff) return undefined
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const left = Math.max(0, AUTO_DISMISS_MS - (Date.now() - startedAt))
      setRemaining(left)
      if (!left) {
        window.clearInterval(timer)
        setHandoff(null)
      }
    }, 500)
    return () => window.clearInterval(timer)
  }, [handoff])

  if (!handoff) return null

  const dismiss = () => setHandoff(null)
  const preview = String(handoff.message || decodeMessageFromUrl(handoff.waUrl) || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110)
  const caption = handoff.caption || ''

  return (
    <div dir="rtl" className="fixed bottom-4 inset-x-0 z-[80] flex justify-center px-3 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-[#25D366]/40 bg-[#0b1f33]/95 backdrop-blur-md shadow-2xl shadow-black/50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366]/15 border border-[#25D366]/40">
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 fill-[#25D366]" aria-hidden="true">
                <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.19-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.22-8.24 8.22Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.15.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.65-1.23-1.46-1.38-1.71-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.28Z" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-black text-white leading-tight">
                رسالة واتساب جاهزة {caption ? <span className="text-[#25D366]">— {caption}</span> : null}
              </div>
              <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                لو واتساب ما اتفتحش تلقائيًا اضغط الزرّ الأخضر · If WhatsApp didn&apos;t open, tap the green button
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="إغلاق"
            className="shrink-0 h-7 w-7 rounded-full text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center text-lg leading-none"
          >
            ×
          </button>
        </div>

        {preview && (
          <p className="mt-2 truncate text-[11px] text-slate-300/90 border-r-2 border-[#25D366]/50 pr-2" title={preview}>
            {preview}{preview.length >= 110 ? '…' : ''}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-3">
          <a
            href={handoff.waUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={dismiss}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#25D366] hover:bg-[#1ebe5b] active:scale-[0.98] transition text-[#06231a] font-black text-sm py-2.5 shadow-lg shadow-[#25D366]/25"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#06231a]" aria-hidden="true">
              <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.19-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.22-8.24 8.22Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.15.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.65-1.23-1.46-1.38-1.71-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.28Z" />
            </svg>
            فتح واتساب
          </a>
          <span className="shrink-0 text-[10px] text-slate-500 tabular-nums" dir="rtl">
            يختفي بعد {Math.ceil(remaining / 1000)} ث
          </span>
        </div>
      </div>
    </div>
  )
}
