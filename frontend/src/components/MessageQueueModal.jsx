import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { buildWhatsAppUrl } from '../lib/helpers'
import { buildQRWhatsAppUrl } from '../lib/qrPdfWhatsApp'

const BATCH_SIZE = 100
const BATCH_PAUSE_MS = 2500

/**
 * Message queue — one student at a time.
 *
 * Round 4 (iOS fix): the send button is now a REAL <a href="{wa.me link}">
 * element, not a button that calls window.open. A link the user taps is
 * browser-native navigation: iOS Safari's popup blocker never applies and
 * WhatsApp always opens. The wa.me URL for each item is precomputed (the
 * queue is built before the modal opens), so the href is ready up front.
 */
export default function MessageQueueModal({ open, onClose, queue, index, onAdvance }) {
  const [failed, setFailed] = useState(false)
  const [pauseUntil, setPauseUntil] = useState(0)
  const [remainingPause, setRemainingPause] = useState(0)
  const pauseTimerRef = useRef(null)

  useEffect(() => {
    setFailed(false)
    setPauseUntil(0)
    setRemainingPause(0)
  }, [index, open])

  useEffect(() => () => {
    if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current)
  }, [])

  useEffect(() => {
    if (!pauseUntil) return undefined
    const timer = window.setInterval(() => {
      const left = Math.max(0, pauseUntil - Date.now())
      setRemainingPause(left)
      if (!left) {
        window.clearInterval(timer)
        setPauseUntil(0)
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [pauseUntil])

  if (!open || index >= queue.length) return null
  const item = queue[index]
  const isBatchBoundary = (index + 1) % BATCH_SIZE === 0 && index + 1 < queue.length

  // Precomputed wa.me URL for THIS item. QR items go through the secure-link
  // validation; plain message items are built directly.
  const waHref = item.qrUrl
    ? buildQRWhatsAppUrl(item.phone, item.student.name, item.qrUrl, item.template)
    : buildWhatsAppUrl(item.phone, item.message)

  const advance = () => {
    if (isBatchBoundary) {
      const until = Date.now() + BATCH_PAUSE_MS
      setPauseUntil(until)
      setRemainingPause(BATCH_PAUSE_MS)
      pauseTimerRef.current = window.setTimeout(() => {
        pauseTimerRef.current = null
        setPauseUntil(0)
        setRemainingPause(0)
        onAdvance()
      }, BATCH_PAUSE_MS)
    } else {
      // Advance immediately after the link opens. Waiting on a timeout is
      // unreliable when mobile browsers background the dashboard tab.
      onAdvance()
    }
  }

  // The user tapped the real <a> link. The browser handles the WhatsApp
  // navigation natively — we only advance the queue.
  const handleSendTap = (event) => {
    if (!waHref) {
      event.preventDefault()
      setFailed(true)
      return
    }
    if (pauseUntil) {
      event.preventDefault()
      return
    }
    setFailed(false)
    advance()
  }

  const skip = () => {
    setFailed(false)
    onAdvance()
  }

  const greenButtonClass = 'flex-1 flex items-center justify-center gap-1.5 bg-[#25D366] hover:bg-[#1ebe5b] text-[#06231a] border border-[#25D366] font-black py-2 rounded-lg text-sm transition select-none'

  return (
    <Modal open={open} onClose={onClose} title={`إرسال (${index + 1}/${queue.length})`}>
      <p className="text-sm mb-2"><strong>الطالب:</strong> {item.student.name}</p>
      <p className="text-[11px] mb-2 text-fg-subtle">كل ضغطة تفتح واتساب برسالة الطالب مباشرة — اضغط الزرّ الأخضر.</p>
      {isBatchBoundary && <p className="text-[11px] mb-2 text-amber-300">بعد كل 100 رسالة سيأخذ الإرسال وقفة قصيرة لحماية WhatsApp والمتصفح.</p>}
      {remainingPause > 0 && <p className="text-xs font-bold text-amber-300 mb-3">استراحة تلقائية: {Math.ceil(remainingPause / 1000)} ثوانٍ...</p>}
      <div className="glass-input p-3 rounded text-xs whitespace-pre-line text-fg-subtle max-h-48 overflow-y-auto mb-4">{item.message}</div>
      {failed && <p className="text-rose-400 text-xs font-bold mb-3">تعذّر تجهيز رسالة واتساب لهذا الطالب — تأكد من رقم الهاتف ثم اضغط تخطي.</p>}
      <div className="flex gap-2">
        {waHref ? (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSendTap}
            className={greenButtonClass}
          >
            <span aria-hidden="true">💬</span>
            {failed ? 'إعادة المحاولة' : 'إرسال WhatsApp'}
          </a>
        ) : (
          <button type="button" className={`${greenButtonClass} opacity-40 cursor-not-allowed`} disabled>
            <span aria-hidden="true">💬</span>
            إرسال WhatsApp
          </button>
        )}
        <button type="button" onClick={skip} disabled={!!pauseUntil} className="flex-1 glass-input hover:bg-white/10 text-fg-subtle font-bold py-2 rounded-lg text-sm disabled:opacity-50">تخطي</button>
        <button type="button" onClick={onClose} className="flex-1 bg-rose-500/10 text-rose-400 border border-rose-500/30 font-bold py-2 rounded-lg text-sm">إيقاف</button>
      </div>
    </Modal>
  )
}
