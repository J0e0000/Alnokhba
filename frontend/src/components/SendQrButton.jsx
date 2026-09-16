/**
 * Send QR button — fetches student token, builds unique /qr/TOKEN link,
 * then opens WhatsApp with the per-student link.
 */
import { useState } from 'react'
import { sendQRViaWhatsApp, openWhatsAppPlaceholder, getOrCreateStudentToken, buildStudentQRLink, getCachedStudentPortalLink } from '../lib/qrPdfWhatsApp'
import { useLanguage } from '../context/LanguageContext'
import { useToast } from '../context/ToastContext'
import QRDiagnosticPanel from './QRDiagnosticPanel'

export default function SendQrButton({ student, disabled, className = '', template }) {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [diagnosticEvents, setDiagnosticEvents] = useState([])
  const [diagnosticOpen, setDiagnosticOpen] = useState(false)
  const { isArabic, t } = useLanguage()
  const { showToast } = useToast()

  if (!student?.phone) return null

  const recordStep = (event) => {
    setDiagnosticEvents((current) => [...current, event])
  }

  const handleSend = async () => {
    if (loading || sent) return
    setLoading(true)
    setDiagnosticEvents([])
    setDiagnosticOpen(false)
    const reservedWindow = openWhatsAppPlaceholder()
    const onStep = (event) => recordStep(event)
    try {
      recordStep({ stage: 'send started', status: 'info', details: { browser: navigator.userAgent.includes('CriOS') ? 'iPhone Chrome' : navigator.userAgent.includes('Safari') ? 'Safari' : 'other', browserOnline: navigator.onLine }, time: Date.now() })

      // Reuse a previously server-issued link whenever possible. This works
      // during a temporary weak-network interruption and never uses a UUID.
      let studentLink = getCachedStudentPortalLink(student.id)
      if (studentLink) recordStep({ stage: 'cached portal link', status: 'ok', details: { secureTokenCached: true }, time: Date.now() })
      if (!studentLink) {
        const token = await getOrCreateStudentToken(student.id, { onStep })
        if (token) studentLink = buildStudentQRLink(token)
      }
      if (!studentLink) {
        try { reservedWindow?.close?.() } catch {}
        recordStep({ stage: 'send result', status: 'error', details: { reason: 'secure_portal_link_not_created' }, time: Date.now() })
        setDiagnosticOpen(true)
        console.error('Failed to get QR token for student:', student.id)
        showToast(
          isArabic
            ? (navigator.onLine === false ? 'لا يوجد اتصال. صوّر تفاصيل التشخيص ثم جرّب بعد استقرار الإنترنت.' : 'تعذّر إنشاء رابط الطالب. افتح تفاصيل التشخيص لمعرفة السبب.')
            : (navigator.onLine === false ? 'No connection. Screenshot the diagnostics and retry when the internet is stable.' : 'Could not create the student link. Open diagnostics to see the reason.'),
          'error'
        )
        return
      }

      // Send via WhatsApp. The reserved window avoids iOS Safari popup blocking.
      const opened = sendQRViaWhatsApp(student.phone, student.name, studentLink, template, reservedWindow, { onStep })
      if (!opened) {
        try { reservedWindow?.close?.() } catch {}
        recordStep({ stage: 'send result', status: 'error', details: { reason: 'whatsapp_handoff_failed_or_input_invalid' }, time: Date.now() })
        setDiagnosticOpen(true)
        showToast(isArabic ? 'تعذر فتح واتساب. افتح تفاصيل التشخيص وصوّرها.' : 'WhatsApp could not open. Open and screenshot the diagnostics.', 'error')
        return
      }
      recordStep({ stage: 'send result', status: 'ok', details: { urlCreated: true }, time: Date.now() })
      setSent(true)
      setTimeout(() => setSent(false), 10000)
    } catch (err) {
      try { reservedWindow?.close?.() } catch {}
      recordStep({ stage: 'unexpected error', status: 'error', details: { name: err?.name || 'Error', message: String(err?.message || err).slice(0, 240) }, time: Date.now() })
      setDiagnosticOpen(true)
      console.error('QR send error:', err)
      showToast(isArabic ? 'حدث خطأ غير متوقع. افتح تفاصيل التشخيص.' : 'Unexpected error. Open the diagnostics.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full">
      <button
        onClick={handleSend}
        disabled={disabled || loading}
        className={`clay-btn-gold text-xs px-4 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all ${loading ? 'opacity-50' : ''} ${className}`}
      >
        <span className="material-symbols-outlined" style={{fontSize:16}}>
          {loading ? 'sync' : sent ? 'check_circle' : 'qr_code_2'}
        </span>
        {loading ? (isArabic ? 'جاري الفحص والإرسال...' : 'Checking and sending...') : sent ? (isArabic ? 'تم الإرسال' : 'Sent') : (isArabic ? 'إرسال QR للوالد' : 'Send QR to Parent')}
      </button>
      {diagnosticEvents.length > 0 && !diagnosticOpen && (
        <button type="button" onClick={() => setDiagnosticOpen(true)} className="mt-2 w-full rounded-xl border border-rose-300/70 bg-rose-50 px-3 py-2 text-[11px] font-black text-rose-700">
          {isArabic ? 'عرض تفاصيل آخر فحص' : 'View last diagnostic'}
        </button>
      )}
      {diagnosticOpen && <QRDiagnosticPanel events={diagnosticEvents} isArabic={isArabic} onClose={() => setDiagnosticOpen(false)} />}
    </div>
  )
}
