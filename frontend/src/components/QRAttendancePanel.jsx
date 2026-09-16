import { useEffect, useRef, useState, useCallback } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { useLanguage } from '../context/LanguageContext'
import { playFailureSound, playInfoSound, playSuccessSound } from '../lib/uiSounds'
import { handleScannedPayload } from '../lib/qrAttendance'

const CONFIG = { fps: 15, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 }
const FEEDBACK_MS = 2000
const CAMERA_EL_ID = 'qr-reader-panel'
const FILE_EL_ID = 'qr-reader-panel-file'

/**
 * QR Attendance Panel — الدايمن داخل مساحة الحصص (Round 10, طلب المستخدم):
 * الكاميرا شغالة ومستنية من غير أي زر — أول ما الحصة تفتح والصلاحية متاحة،
 * المسح بيبدأ لوحده. فيه بديل «مسح من صورة» للمتصفحات اللي مفيهاش كاميرا
 * أو لو الإذن مرفوض.
 */
export default function QRAttendancePanel({
  activeLessonId,
  students,
  paymentStatuses,
  markPresent,
  confirmPayment,
  onExpand,
}) {
  const { isArabic } = useLanguage()
  const scannerRef = useRef(null)
  const fileScannerRef = useRef(null)
  const processingRef = useRef(false)
  const lastCodeRef = useRef(null)
  const lastTimeRef = useRef(0)
  const [cameraState, setCameraState] = useState('idle') // idle | starting | running | denied | error | unsupported
  const [hint, setHint] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [scanCount, setScanCount] = useState(0)
  const [fileBusy, setFileBusy] = useState(false)

  const showFeedback = useCallback((fb) => {
    if (fb.type === 'success') playSuccessSound()
    else if (fb.type === 'error') playFailureSound()
    else playInfoSound()
    setFeedback(fb)
    if (fb.type === 'success') setScanCount((n) => n + 1)
    setTimeout(() => {
      setFeedback(null)
      processingRef.current = false
    }, FEEDBACK_MS)
  }, [])

  const onDecoded = useCallback(async (decodedText) => {
    if (processingRef.current) return
    const raw = String(decodedText || '').trim()
    const now = Date.now()
    // منع المسح المزدوج لنفس الكود في أقل من ثانيتين
    if (raw === lastCodeRef.current && now - lastTimeRef.current < 2000) return
    lastCodeRef.current = raw
    lastTimeRef.current = now
    processingRef.current = true
    setHint(isArabic ? 'جاري التحقق من الكود على السيرفر...' : 'Verifying code with the server...')
    try {
      const result = await handleScannedPayload(raw, {
        students,
        paymentStatuses,
        activeLessonId,
        isArabic,
        markPresent,
        confirmPayment,
      })
      showFeedback(result)
    } catch (err) {
      console.error('[QRAttendancePanel] scan failed:', err)
      showFeedback({ type: 'error', text: isArabic ? 'حدث خطأ غير متوقع أثناء المسح.' : 'Unexpected error while scanning.' })
    } finally {
      setHint(isArabic ? 'وجّه الكاميرا نحو كود الطالب التالي...' : 'Point the camera at the next student code...')
    }
  }, [students, paymentStatuses, activeLessonId, isArabic, markPresent, confirmPayment, showFeedback])

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop().catch(() => {}) } catch { /* already stopped */ }
      try { scannerRef.current.clear() } catch { /* element may be gone */ }
      scannerRef.current = null
    }
  }, [])

  const startCamera = useCallback(async () => {
    if (scannerRef.current) return
    setCameraState('starting')
    setHint(isArabic ? 'جاري تشغيل الكاميرا...' : 'Starting camera...')
    try {
      const instance = new Html5Qrcode(CAMERA_EL_ID)
      scannerRef.current = instance
      await instance.start(
        { facingMode: 'environment' },
        CONFIG,
        (text) => { onDecoded(text) },
        () => { /* per-frame callback — ignore */ },
      )
      setCameraState('running')
      setHint(isArabic ? 'وجّه الكاميرا نحو كود الطالب التالي...' : 'Point the camera at the next student code...')
    } catch (err) {
      scannerRef.current = null
      console.warn('[QRAttendancePanel] camera start failed:', err?.name, err?.message)
      if (err?.name === 'NotAllowedError') {
        setCameraState('denied')
        setHint(isArabic
          ? 'تم رفض إذن الكاميرا — اسمح بالوصول من إعدادات المتصفح (أو استخدم «مسح من صورة»).'
          : 'Camera permission denied — allow it in browser settings (or use "Scan from image").')
      } else if (err?.name === 'NotFoundError') {
        setCameraState('unsupported')
        setHint(isArabic
          ? 'لا توجد كاميرا متاحة — استخدم «مسح من صورة».'
          : 'No camera available — use "Scan from image".')
      } else {
        setCameraState('error')
        setHint(isArabic ? 'تعذر تشغيل الكاميرا — جرّب تاني أو استخدم «مسح من صورة».' : 'Camera failed to start — retry or use "Scan from image".')
      }
    }
  }, [isArabic, onDecoded])

  // التشغيل التلقائي: أول ما الحصة تفتح، لو صلاحية الكاميرا متاحة نبدأ فورًا
  // (طلب المستخدم: QR دايمًا جاهز من غير زرار).
  useEffect(() => {
    let cancelled = false
    const autoStart = async () => {
      if (!activeLessonId) return
      try {
        const status = await navigator.permissions?.query?.({ name: 'camera' })
        if (cancelled) return
        if (!status || status.state === 'granted') {
          const timer = setTimeout(() => { if (!cancelled) startCamera() }, 400)
          return () => clearTimeout(timer)
        }
        // 'prompt' | 'denied' — نسيب الزرار واضح للمستخدم يضغطه بنفسه
      } catch { /* permissions API unsupported — try directly */ 
        const timer = setTimeout(() => { if (!cancelled) startCamera() }, 400)
        return () => clearTimeout(timer)
      }
    }
    autoStart()
    return () => { cancelled = true }
  }, [activeLessonId, startCamera])

  // إيقاف الكاميرا عند إقفال الحصة أو الخروج من القسم
  useEffect(() => {
    if (!activeLessonId) { stopCamera(); setCameraState('idle') }
  }, [activeLessonId, stopCamera])

  useEffect(() => () => { stopCamera() }, [stopCamera])

  const onPickImage = useCallback(async (evt) => {
    const file = evt.target.files?.[0]
    evt.target.value = ''
    if (!file || processingRef.current || fileBusy) return
    setFileBusy(true)
    setHint(isArabic ? 'جاري قراءة الكود من الصورة...' : 'Reading code from image...')
    try {
      if (!fileScannerRef.current) {
        fileScannerRef.current = new Html5Qrcode(FILE_EL_ID)
      }
      const decoded = await fileScannerRef.current.scanFile(file, /* showImage= */false)
      await onDecoded(decoded)
    } catch (err) {
      const msg = String(err?.message || err || '')
      const isNoQr = msg.includes('NotFoundException') || msg.includes('No QR')
      showFeedback({
        type: 'error',
        text: isNoQr
          ? (isArabic ? '❌ مفيش كود QR واضح في الصورة دي — جرب صورة أوضح أو الكاميرا.' : '❌ No clear QR code in this image — try a clearer one or the camera.')
          : (isArabic ? '❌ تعذر قراءة الصورة — جرب صورة تانية.' : '❌ Could not read the image — try another one.'),
      })
    } finally {
      setFileBusy(false)
      setHint(isArabic ? 'وجّه الكاميرا نحو كود الطالب التالي...' : 'Point the camera at the next student code...')
    }
  }, [isArabic, fileBusy, onDecoded, showFeedback])

  const feedbackColors = {
    success: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300',
    info: 'bg-amber-500/15 border-amber-400/40 text-amber-300',
    error: 'bg-rose-500/15 border-rose-400/40 text-rose-300',
  }

  const cameraRunning = cameraState === 'running'

  return (
    <div className={`glass-card rounded-2xl p-3 border ${cameraRunning ? 'border-emerald-500/30' : 'border-subtle'}`}>
      {/* Hidden element for image scanning */}
      <div id={FILE_EL_ID} style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', opacity: 0, pointerEvents: 'none' }} aria-hidden="true" />

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black text-emerald-300">📷 {isArabic ? 'التحضير بالـ QR' : 'QR Attendance'}</span>
          {activeLessonId
            ? <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">{isArabic ? 'الحصة مفتوحة — جاهز' : 'Lesson open — ready'}</span>
            : <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300">{isArabic ? 'افتح حصة أولًا' : 'Open a lesson first'}</span>}
        </div>
        <div className="flex items-center gap-2">
          {scanCount > 0 && <span className="text-[11px] font-bold text-emerald-400">✅ {isArabic ? `تم تسجيل ${scanCount}` : `${scanCount} done`}</span>}
          {onExpand && (
            <button type="button" onClick={onExpand} disabled={!activeLessonId} className="text-[11px] font-bold text-fg-subtle hover:text-brand-gold-hover underline disabled:opacity-40">
              ⛶ {isArabic ? 'ملء الشاشة' : 'Fullscreen'}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {/* Camera area — always present (طلب المستخدم: QR دايمًا ظاهر ومستني) */}
        <div className="relative w-full sm:w-[280px] shrink-0 aspect-square overflow-hidden rounded-2xl border-2 border-slate-100/80 bg-slate-900/5 mx-auto sm:mx-0">
          <div id={CAMERA_EL_ID} className="w-full h-full" />
          {cameraState !== 'running' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
              <span className="text-3xl">📷</span>
              {cameraState === 'starting' && <span className="text-xs font-bold text-brand-gold animate-pulse">{isArabic ? 'جاري تشغيل الكاميرا...' : 'Starting camera...'}</span>}
              {(cameraState === 'idle' || cameraState === 'error') && (
                <>
                  <button type="button" onClick={startCamera} disabled={!activeLessonId} className="btn-glow text-xs font-black px-4 py-2 rounded-xl disabled:opacity-40">
                    {isArabic ? '🎥 تشغيل الكاميرا' : '🎥 Start camera'}
                  </button>
                  {cameraState === 'error' && <span className="text-[10px] text-rose-300">{hint}</span>}
                </>
              )}
              {cameraState === 'denied' && (
                <span className="text-[10px] leading-5 text-amber-300">
                  {isArabic
                    ? '⚠️ الإذن مرفوض — اضغط على أيقونة القفل/الكاميرا في شريط العنوان واسمح بالكاميرا، أو استخدم «مسح من صورة».'
                    : '⚠️ Permission denied — allow camera from the address bar, or use "Scan from image".'}
                </span>
              )}
              {cameraState === 'unsupported' && <span className="text-[10px] leading-5 text-amber-300">{hint}</span>}
            </div>
          )}
          {feedback && (
            <div className={`absolute inset-x-2 bottom-2 rounded-xl border p-2.5 text-center text-xs font-bold shadow-xl ${feedbackColors[feedback.type]}`}>
              {feedback.text}
            </div>
          )}
        </div>

        {/* Status + actions */}
        <div className="flex-1 flex flex-col justify-center gap-2 min-w-[180px]">
          <p className={`text-xs font-medium ${cameraRunning ? 'text-fg-subtle' : 'text-fg-subtle'}`}>
            {cameraRunning || feedback
              ? (hint || (isArabic ? 'وجّه الكاميرا نحو كود الطالب التالي...' : 'Point the camera at the next student code...'))
              : (isArabic ? 'الكاميرا هنا دايمًا جاهزة — بمجرد ما تشغّلها، امسح كود الطالب وهيتسجل حضوره فورًا ويختفي من القائمة.' : 'The camera here is always ready — start it once, then scan a student code to mark them present instantly.')}
          </p>
          <label className={`block w-full text-center rounded-lg px-3 py-2.5 text-xs font-black cursor-pointer glass-input hover:bg-white/10 ${fileBusy ? 'opacity-60' : ''}`}>
            🖼️ {isArabic ? 'مسح من صورة (لقطة شاشة / ملف محفوظ)' : 'Scan from image (screenshot / saved file)'}
            <input type="file" accept="image/*" className="hidden" onChange={onPickImage} disabled={fileBusy} />
          </label>
          {cameraRunning && (
            <button type="button" onClick={() => { stopCamera(); setCameraState('idle') }} className="text-[11px] font-bold text-fg-subtle hover:text-rose-300">
              ⏹️ {isArabic ? 'إيقاف الكاميرا مؤقتًا' : 'Pause camera'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
