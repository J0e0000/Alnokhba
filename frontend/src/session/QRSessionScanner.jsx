import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import Modal from '../components/Modal'
import { useLanguage } from '../context/LanguageContext'
import { playFailureSound, playInfoSound, playSuccessSound } from '../lib/uiSounds'
import { handleScannedPayload } from '../lib/qrAttendance'
import { logAttendanceOp } from '../lib/attendanceDiagnostics'

const CONFIG = { fps: 15, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 }
const FEEDBACK_MS = 2000

// Session QR scanner — resolves codes SERVER-SIDE via resolve_student_by_qr
// (portal URLs, raw tokens, and legacy UUID cards all work; QR codes and URLs
// are never changed by this frontend).
export default function QRSessionScanner({ open, onClose, students, activeLessonId, markPresent }) {
  const { isArabic } = useLanguage()
  const scannerRef = useRef(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [scanCount, setScanCount] = useState(0)
  const lastCodeRef = useRef(null)
  const lastTimeRef = useRef(0)

  const showFeedback = (fb) => {
    if (fb.type === 'success') playSuccessSound()
    else if (fb.type === 'error') playFailureSound()
    else playInfoSound()
    setFeedback(fb)
    setTimeout(() => {
      setFeedback(null)
      setIsProcessing(false)
      setHint(isArabic ? 'وجّه الكاميرا نحو كود الطالب التالي...' : 'Aim the camera at the next student code...')
    }, FEEDBACK_MS)
  }

  const handleDecoded = async (decodedText) => {
    if (isProcessing) return
    const rawCode = String(decodedText || '').trim()
    const now = Date.now()
    if (rawCode === lastCodeRef.current && now - lastTimeRef.current < 2000) return
    lastCodeRef.current = rawCode
    lastTimeRef.current = now
    setIsProcessing(true)
    setHint(isArabic ? 'جاري معالجة الكود...' : 'Processing...')

    const result = await handleScannedPayload(rawCode, {
      students,
      paymentStatuses: [],
      activeLessonId,
      isArabic,
      markPresent,
      confirmPayment: null,
    })
    logAttendanceOp({
      action: 'qr_scan',
      result: result.type === 'success' ? 'ok' : 'error',
      category: result.type === 'success' ? 'save_ok' : 'qr_unknown_format',
      context: { decodedLength: rawCode.length, lessonId: activeLessonId, error: result.text?.slice(0, 120) },
    })
    showFeedback(result)
    if (result.type === 'success') setScanCount((n) => n + 1)
  }

  const startScanner = async () => {
    setError('')
    setHint(isArabic ? 'جاري تشغيل الكاميرا...' : 'Starting camera...')
    try {
      if (scannerRef.current) await scannerRef.current.stop().catch(() => {})
      const instance = new Html5Qrcode('qr-session-reader')
      scannerRef.current = instance
      await instance.start({ facingMode: 'environment' }, CONFIG, handleDecoded, () => {})
      setHint(isArabic ? 'وجّه كاميرا الجوال نحو رمز الـ QR على بطاقة الطالب.' : 'Aim the camera at the student QR card.')
    } catch (err) {
      console.error('Scanner start error:', err)
      let msg = isArabic ? 'تأكد من إعطاء صلاحية الكاميرا للمتصفح.' : 'Check the browser camera permission.'
      if (err?.name === 'NotAllowedError') msg = isArabic ? 'تم رفض إذن الكاميرا. اسمح بالوصول للكاميرا من إعدادات المتصفح.' : 'Camera permission denied. Allow camera access in browser settings.'
      else if (err?.name === 'NotFoundError') msg = isArabic ? 'لا توجد كاميرا متاحة على هذا الجهاز.' : 'No camera available on this device.'
      setError(msg)
    }
  }

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); scannerRef.current.clear() } catch (e) { console.warn('Scanner stop error:', e) }
      scannerRef.current = null
    }
  }

  useEffect(() => {
    if (open) {
      setScanCount(0); setFeedback(null); setIsProcessing(false)
      const timer = setTimeout(startScanner, 300)
      return () => clearTimeout(timer)
    }
    stopScanner()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => () => { stopScanner() }, [])

  const feedbackColors = {
    success: { background: 'var(--ok-bg)', borderColor: 'var(--ok-border)', color: 'var(--ok-strong)' },
    info: { background: 'var(--warn-bg)', borderColor: 'var(--warn-border)', color: 'var(--warn-strong)' },
    error: { background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-strong)' },
  }

  return (
    <Modal open={open} onClose={() => { stopScanner(); onClose() }} title={isArabic ? 'مسح كود الطالب' : 'Scan student QR'}>
      {error ? (
        <div className="space-y-3 text-center">
          <div className="rounded-xl p-4 text-sm font-bold" style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger-strong)' }}>{error}</div>
          <div className="flex gap-2">
            <button onClick={startScanner} className="btn-navy flex-1 rounded-xl py-2.5 text-sm font-bold">🔄 {isArabic ? 'إعادة المحاولة' : 'Retry'}</button>
            <button onClick={() => window.location.reload()} className="btn-ghost flex-1 rounded-xl py-2.5 text-sm font-bold">🔃 {isArabic ? 'تحديث الصفحة' : 'Reload'}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative mx-auto aspect-square max-w-[300px] overflow-hidden rounded-2xl border-2" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-container)' }}>
            <div id="qr-session-reader" className="h-full w-full" />
            {isProcessing && !feedback && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/40">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: 'var(--brand-gold)', borderTopColor: 'transparent' }} />
              </div>
            )}
            {feedback && (
              <div className="absolute inset-x-4 bottom-4 rounded-xl border p-4 text-center text-sm font-bold shadow-xl" style={feedbackColors[feedback.type]}>
                {feedback.text}
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-sm font-bold" style={{ color: isProcessing ? 'var(--brand-gold)' : 'var(--fg-subtle)' }}>{hint}</p>
            <span className="text-xs font-bold" style={{ color: 'var(--ok)' }}>
              {scanCount > 0 ? (isArabic ? `✅ تم تسجيل ${scanCount} طالب` : `✅ Registered ${scanCount} students`) : (isArabic ? 'لم يتم مسح أي كود بعد' : 'No code scanned yet')}
            </span>
          </div>
        </>
      )}
    </Modal>
  )
}
