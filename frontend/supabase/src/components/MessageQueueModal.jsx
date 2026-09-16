import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { sendWhatsApp } from '../lib/helpers'
import { sendQRViaWhatsApp } from '../lib/qrPdfWhatsApp'

const BATCH_SIZE = 100
const BATCH_PAUSE_MS = 2500

export default function MessageQueueModal({ open, onClose, queue, index, onAdvance }) {
  const [failed, setFailed] = useState(false)
  const [sending, setSending] = useState(false)
  const [pauseUntil, setPauseUntil] = useState(0)
  const [remainingPause, setRemainingPause] = useState(0)
  const sendingRef = useRef(false)
  const pauseTimerRef = useRef(null)

  useEffect(() => {
    setFailed(false)
    setSending(false)
    setPauseUntil(0)
    setRemainingPause(0)
    sendingRef.current = false
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
      // Advance immediately after the popup opens. Waiting on a timeout is
      // unreliable when mobile browsers background the dashboard tab.
      onAdvance()
    }
  }

  const send = () => {
    if (sendingRef.current || pauseUntil) return
    sendingRef.current = true
    setSending(true)
    try {
      const opened = item.qrUrl
        ? sendQRViaWhatsApp(item.phone, item.student.name, item.qrUrl, item.template)
        : sendWhatsApp(item.phone, item.message)
      if (!opened) {
        sendingRef.current = false
        setFailed(true)
        setSending(false)
        return
      }
      setFailed(false)
      advance()
    } catch (error) {
      console.warn('[Queue] WhatsApp handoff failed', error)
      sendingRef.current = false
      setFailed(true)
      setSending(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`إرسال (${index + 1}/${queue.length})`}>
      <p className="text-sm mb-2"><strong>الطالب:</strong> {item.student.name}</p>
      <p className="text-[11px] mb-2 text-fg-subtle">يتم استخدام نافذة WhatsApp واحدة فقط. لا تُفتح نافذة جديدة لكل طالب.</p>
      {isBatchBoundary && <p className="text-[11px] mb-2 text-amber-300">بعد كل 100 رسالة سيأخذ الإرسال وقفة قصيرة لحماية WhatsApp والمتصفح.</p>}
      {remainingPause > 0 && <p className="text-xs font-bold text-amber-300 mb-3">استراحة تلقائية: {Math.ceil(remainingPause / 1000)} ثوانٍ...</p>}
      <div className="glass-input p-3 rounded text-xs whitespace-pre-line text-fg-subtle max-h-48 overflow-y-auto mb-4">{item.message}</div>
      {failed && <p className="text-rose-400 text-xs font-bold mb-3">تعذر فتح أو إعادة استخدام نافذة WhatsApp. اسمح بالنوافذ المنبثقة، ثم اضغط إعادة المحاولة.</p>}
      <div className="flex gap-2">
        <button type="button" onClick={send} disabled={sending || !!pauseUntil} className="flex-1 bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/50 font-bold py-2 rounded-lg text-sm disabled:opacity-50">{sending ? 'تم فتح WhatsApp...' : failed ? 'إعادة المحاولة' : 'إرسال WhatsApp'}</button>
        <button type="button" onClick={() => { setFailed(false); onAdvance() }} disabled={sending || !!pauseUntil} className="flex-1 glass-input hover:bg-white/10 text-fg-subtle font-bold py-2 rounded-lg text-sm disabled:opacity-50">تخطي</button>
        <button type="button" onClick={onClose} className="flex-1 bg-rose-500/10 text-rose-400 border border-rose-500/30 font-bold py-2 rounded-lg text-sm">إيقاف</button>
      </div>
    </Modal>
  )
}
