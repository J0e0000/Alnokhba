import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import Modal from './Modal'
import { useLanguage } from '../context/LanguageContext'
import { playFailureSound, playInfoSound, playSuccessSound } from '../lib/uiSounds'
import { animate, prefersReducedMotion } from '../lib/animeMotion'

const CONFIG = { fps: 20, qrbox: { width: 260, height: 260 }, aspectRatio: 1.0 }
const FEEDBACK_MS = 2000 // مدة إظهار النتيجة قبل السماح بمسح جديد

export default function QRScannerModal({ open, onClose, students, onMarkPresent, paymentStatuses, onConfirmPayment }) {
  const { isArabic } = useLanguage()
  const scannerRef = useRef(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [hint, setHint] = useState('جاري تشغيل الكاميرا...')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [scanCount, setScanCount] = useState(0)
  const feedbackRef = useRef(null)
  useEffect(() => {
    if (!feedbackRef.current || !feedback || prefersReducedMotion()) return
    animate(feedbackRef.current, {
      scale: feedback.type === 'success' ? [0.92, 1.04, 1] : [1, 1.03, 0.98, 1],
      translateX: feedback.type === 'error' ? [0, -7, 7, -4, 4, 0] : 0,
      duration: feedback.type === 'error' ? 360 : 420,
      ease: feedback.type === 'error' ? 'inOut(2)' : 'out(4)',
    })
  }, [feedback])
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
      setHint('وجّه الكاميرا نحو كود الطالب التالي...')
    }, FEEDBACK_MS)
  }

  const handleDecoded = async (decodedText) => {
    if (isProcessing) return

    const rawCode = decodedText.trim()
    const now = Date.now()

    // Diagnostic log — helps debug "scanner doesn't work" issues
    console.log('[QRScanner] Decoded:', rawCode, 'length:', rawCode.length)

    // منع تكرار نفس الكود في أقل من ثانيتين لتجنب المسح المزدوج بالخطأ
    if (rawCode === lastCodeRef.current && now - lastTimeRef.current < 2000) return

    lastCodeRef.current = rawCode
    lastTimeRef.current = now
    setIsProcessing(true)
    setHint('جاري معالجة الكود...')

    // The scanned QR might contain either:
    //   (a) a raw student_id (UUID)               → use as-is
    //   (b) a full portal URL like https://.../qr/TOKEN  → extract the token
    //   (c) a token from student_qr_tokens        → look up by token
    // We try all three paths so the scanner works with any QR the system generates.
    let code = rawCode
    if (rawCode.includes('/qr/')) {
      // Full URL — extract the last path segment
      code = rawCode.split('/qr/').pop().split('?')[0].split('#')[0].trim()
    }

    // Path 1: direct match by student_id
    let student = students.find((s) => s.id === code)

    // Path 2: if not found and code looks like a token (not a UUID), we can't
    // resolve it locally (tokens are stored server-side). Show a helpful message.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)

    if (!student) {
      if (!isUuid && code.length >= 10) {
        // Looks like a portal token — the scanner can't resolve it locally.
        // This happens when you scan a parent's QR (the portal link) instead of
        // the student's attendance QR. Tell the teacher clearly.
        showFeedback({
          type: 'error',
          text: '❌ ده رابط بوابة الطالب، مش كود الحضور. امسح كود الـ QR بتاع البطاقة.',
        })
      } else {
        showFeedback({ type: 'error', text: '❌ الكود غير معروف' })
      }
      return
    }

    if (student.attendance_status === 'حاضر') {
      showFeedback({ type: 'info', text: `ℹ️ ${student.name} مسجل حضور بالفعل` })
      return
    }

    const payStatus = paymentStatuses?.find(p => p.student_id === student.id)
    if (Number(student.warnings || 0) >= Number(payStatus?.max_warnings || 3) || payStatus?.blocked_by_warnings) { showFeedback({ type: 'error', text: isArabic ? `⛔ ${student.name} ممنوع من الدخول بعد ${student.warnings || 0} إنذارات` : `⛔ ${student.name} is blocked after repeated warnings` }); return }
    let payText = ''
    if (payStatus && payStatus.status !== 'paid') {
      const due = Math.max(0, Number(payStatus.remaining || 0))
      const confirmed = window.confirm(isArabic ? `هل دفع ${student.name}؟\nاضغط موافق لتسجيل الدفعة والسماح بالدخول، أو إلغاء لمنع الدخول.` : `Has ${student.name} paid?\nPress OK to record the payment and allow entry, or Cancel to block entry.`)
      if (!confirmed) { showFeedback({ type: 'error', text: isArabic ? `💳 لم يتم تأكيد الدفع — لا يمكن تسجيل دخول ${student.name}` : `💳 Payment not confirmed — ${student.name} cannot enter` }); return }
      if (onConfirmPayment) { const saved = await onConfirmPayment(student, payStatus, due); if (!saved) { showFeedback({ type: 'error', text: isArabic ? 'تعذر تسجيل الدفعة، لم يتم تسجيل الحضور.' : 'Payment could not be recorded; attendance was not saved.' }); return } }
      payText = isArabic ? ' | ✅ تم تأكيد الدفع' : ' | ✅ Payment confirmed'
    }
    showFeedback({ type: 'success', text: isArabic ? `✅ تم تسجيل: ${student.name}${payText}` : `✅ Registered: ${student.name}${payText}` })
    setScanCount((n) => n + 1)
    onMarkPresent(student.id)
  }

  const startScanner = async () => {
    setError('')
    setHint('جاري تشغيل الكاميرا...')
    
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop().catch(() => {})
      }
      
      const instance = new Html5Qrcode('qr-reader-react')
      scannerRef.current = instance
      
      await instance.start(
        { facingMode: 'environment' },
        CONFIG,
        handleDecoded,
        () => {} // handleFrame
      )
      
      setHint('وجّه كاميرا الجوال نحو رمز الـ QR على بطاقة الطالب.')
    } catch (err) {
      console.error('Scanner start error:', err)
      let msg = 'تأكد من إعطاء صلاحية الكاميرا للمتصفح.'
      if (err.name === 'NotAllowedError') msg = 'تم رفض إذن الكاميرا. اسمح بالوصول للكاميرا من إعدادات المتصفح.'
      else if (err.name === 'NotFoundError') msg = 'لا توجد كاميرا متاحة على هذا الجهاز.'
      setError(msg)
    }
  }

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop()
        scannerRef.current.clear()
      } catch (e) {
        console.warn('Scanner stop error:', e)
      }
      scannerRef.current = null
    }
  }

  useEffect(() => {
    if (open) {
      setScanCount(0)
      setFeedback(null)
      setIsProcessing(false)
      // تأخير بسيط للتأكد من أن الـ DOM element موجود
      const timer = setTimeout(startScanner, 300)
      return () => clearTimeout(timer)
    } else {
      stopScanner()
    }
  }, [open])

  const handleClose = () => {
    stopScanner()
    onClose()
  }

  const forceReload = () => {
    // حل المستخدم المقترح: إعادة تحميل الصفحة بالكامل
    window.location.reload()
  }

  const feedbackColors = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    info: 'bg-amber-50 border-amber-200 text-amber-700',
    error: 'bg-rose-50 border-rose-200 text-rose-700',
  }

  return (
    <Modal open={open} onClose={handleClose} title="مسح كود الطالب">
      {error ? (
        <div className="space-y-3 text-center">
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-4">{error}</div>
          <div className="flex gap-2">
            <button onClick={startScanner} className="flex-1 bg-brand-navy text-white text-sm font-bold py-2.5 rounded-lg">
              🔄 إعادة محاولة التشغيل
            </button>
            <button onClick={forceReload} className="flex-1 bg-slate-100 text-slate-700 text-sm font-bold py-2.5 rounded-lg border border-slate-200">
              🔃 تحديث الصفحة بالكامل
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative aspect-square max-w-[300px] mx-auto overflow-hidden rounded-2xl border-2 border-slate-100 bg-slate-50">
            <div id="qr-reader-react" className="w-full h-full" />
            
            {isProcessing && !feedback && (
              <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-brand-gold border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {feedback && (
              <div ref={feedbackRef} className={`absolute inset-x-4 bottom-4 rounded-xl border p-4 text-center text-sm font-bold shadow-xl ${feedbackColors[feedback.type]}`}>
                {feedback.text}
              </div>
            )}
          </div>
          
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className={`text-sm font-medium ${isProcessing ? 'text-brand-gold animate-pulse' : 'text-outline'}`}>
              {hint}
            </p>
            
            <div className="w-full flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-emerald-600 text-xs font-bold">
                {scanCount > 0 ? `✅ تم تسجيل ${scanCount} طلاب` : 'لم يتم مسح أي كود بعد'}
              </span>
              <button onClick={forceReload} className="text-on-surface-variant text-[10px] hover:text-brand-navy underline">
                تواجه مشكلة؟ حدث الصفحة
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
