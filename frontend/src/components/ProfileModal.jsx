import { useEffect, useRef, useState, useCallback } from 'react'
import QRCode from 'qrcode'
import html2canvas from 'html2canvas-pro'
import Modal from './Modal'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import { getStudentRank, getStudentRankPosition, checkAcademicWarning } from '../lib/helpers'
import { sendQRViaWhatsApp, openWhatsAppPlaceholder, getOrCreateStudentToken, buildStudentQRLink } from '../lib/qrPdfWhatsApp'
import QRDiagnosticPanel from './QRDiagnosticPanel'

export default function ProfileModal({ open, student, allStudents, exams, dailyLogs, session, ranks, onClose, onEdit, onRemoveWarning, onEditPoints, attendancePct, paymentStatus, insights, qrMessageTemplate }) {
  const { showToast } = useToast()
  const { isArabic, t } = useLanguage()
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrCardDataUrl, setQrCardDataUrl] = useState('')
  const [qrSending, setQrSending] = useState(false)
  const [studentQRLink, setStudentQRLink] = useState('')
  const [diagnosticEvents, setDiagnosticEvents] = useState([])
  const [diagnosticOpen, setDiagnosticOpen] = useState(false)
  const qrCardRef = useRef(null)

  useEffect(() => {
    let active = true
    if (!student || !studentQRLink) {
      setQrDataUrl('')
      setQrCardDataUrl('')
      return () => { active = false }
    }
    Promise.all([
      QRCode.toDataURL(studentQRLink, { width: 240, margin: 1, color: { dark: '#0E2954', light: '#ffffff' } }),
      QRCode.toDataURL(studentQRLink, { width: 200, margin: 1, color: { dark: '#0E2954', light: '#ffffff' } }),
    ]).then(([main, card]) => {
      if (active) { setQrDataUrl(main); setQrCardDataUrl(card) }
    }).catch((error) => console.warn('[ProfileModal] QR generation failed', error))
    return () => { active = false }
  }, [student, studentQRLink])

  const rank = student ? getStudentRank(student.points, ranks) : ''
  const position = student ? getStudentRankPosition(student.id, allStudents) : '—'
  const hasWarning = student ? checkAcademicWarning(exams) : false
  const today = new Date().toLocaleDateString(isArabic ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const downloadQR = useCallback(() => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `QR_${student?.name || 'student'}.png`
    a.click()
  }, [qrDataUrl, student])

  const downloadQRCard = useCallback(async () => {
    if (!qrCardRef.current || !student || !qrCardDataUrl) return
    const card = qrCardRef.current
    const previousWidth = card.style.width
    try {
      const viewportWidth = Math.max(280, Math.min(420, (window.innerWidth || 420) - 32))
      card.style.width = `${viewportWidth}px`
      const images = Array.from(card.querySelectorAll('img'))
      await Promise.all(images.map((img) => img.decode?.().catch(() => undefined)))
      const canvas = await html2canvas(card, {
        scale: Math.min(3, Math.max(2, window.devicePixelRatio || 2)),
        width: card.scrollWidth,
        height: card.scrollHeight,
        windowWidth: card.scrollWidth,
        windowHeight: card.scrollHeight,
        useCORS: true,
        imageTimeout: 15000,
        backgroundColor: '#ffffff',
      })
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('qr_card_blob_failed')), 'image/png', 1))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${isArabic ? 'بطاقة' : 'QR_Card'}_${student.name}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast(t('qr_card_loaded'), 'success')
    } catch (err) {
      console.error(err)
      showToast(t('qr_card_error'), 'error')
    } finally {
      card.style.width = previousWidth
    }
  }, [student, qrCardDataUrl, isArabic, showToast, t])

  useEffect(() => {
    let active = true
    setStudentQRLink('')
    setDiagnosticEvents([])
    setDiagnosticOpen(false)
    if (!student) return () => { active = false }
    getOrCreateStudentToken(student.id, {
      onStep: (event) => {
        if (!active) return
        setDiagnosticEvents((current) => [...current, event])
        if (event.status === 'error') setDiagnosticOpen(true)
      },
    }).then((token) => {
      if (active && token) setStudentQRLink(buildStudentQRLink(token))
    }).catch((error) => {
      if (active) {
        setDiagnosticEvents((current) => [...current, { stage: 'profile token load', status: 'error', details: { name: error?.name || 'Error', message: String(error?.message || error).slice(0, 240) }, time: Date.now() }])
        setDiagnosticOpen(true)
      }
      console.warn('[ProfileModal] portal link unavailable', error)
    })
    return () => { active = false }
  }, [student])

  const sendQRLink = useCallback(async () => {
    if (!student?.phone) {
      showToast(t('no_phone'), 'error')
      return
    }
    setQrSending(true)
    const reservedWindow = openWhatsAppPlaceholder()
    try {
      // Reuse the link already loaded for this profile. This avoids a second
      // token request at the exact moment iOS Safari hands off to WhatsApp.
      let link = studentQRLink
      if (!link) {
        const token = await getOrCreateStudentToken(student.id)
        if (token) {
          link = buildStudentQRLink(token)
          setStudentQRLink(link)
        }
      }
      if (!link) {
        // DO NOT fall back to the bare site URL — that sends the parent
        // a broken link with no portal. Surface the error instead.
        try { reservedWindow?.close?.() } catch {}
        setDiagnosticEvents((current) => [...current, { stage: 'send result', status: 'error', details: { reason: 'secure_portal_link_not_created' }, time: Date.now() }])
        setDiagnosticOpen(true)
        showToast(
          isArabic
            ? (navigator.onLine === false ? 'لا يوجد اتصال. صوّر تفاصيل التشخيص ثم جرّب بعد استقرار الإنترنت.' : 'تعذّر إنشاء رابط الطالب. افتح تفاصيل التشخيص لمعرفة السبب.')
            : (navigator.onLine === false ? 'No connection. Screenshot the diagnostics and retry when the internet is stable.' : 'Could not create the student link. Open diagnostics to see the reason.'),
          'error'
        )
        return
      }
      const opened = sendQRViaWhatsApp(student.phone, student.name, link, qrMessageTemplate, reservedWindow, {
        onStep: (event) => setDiagnosticEvents((current) => [...current, event]),
      })
      if (!opened) setDiagnosticOpen(true)
      showToast(opened ? (isArabic ? 'تم فتح واتساب مع رابط الكود' : 'WhatsApp opened with QR link') : (isArabic ? 'تعذر فتح واتساب. افتح تفاصيل التشخيص.' : 'WhatsApp could not open. Open diagnostics.'), opened ? 'success' : 'error')
    } catch (err) {
      try { reservedWindow?.close?.() } catch {}
      console.error(err)
      setDiagnosticEvents((current) => [...current, { stage: 'unexpected error', status: 'error', details: { name: err?.name || 'Error', message: String(err?.message || err).slice(0, 240) }, time: Date.now() }])
      setDiagnosticOpen(true)
      showToast(isArabic ? 'حدث خطأ غير متوقع. افتح تفاصيل التشخيص.' : 'Unexpected error. Open diagnostics.', 'error')
    } finally {
      setQrSending(false)
    }
  }, [student, studentQRLink, qrMessageTemplate, isArabic, showToast, t])

  const copyQRLink = useCallback(() => {
    if (!student) return
    if (!studentQRLink) {
      showToast(
        isArabic
          ? 'الرابط لسه بيتجهّز أو تعذّر إنشاؤه. حاول تاني.'
          : 'Link is not ready yet or could not be created. Try again.',
        'error'
      )
      return
    }
    const copy = async () => {
      if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(studentQRLink)
      const field = document.createElement('textarea')
      field.value = studentQRLink; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0'
      document.body.appendChild(field); field.select(); document.execCommand('copy'); field.remove()
    }
    copy().then(() => {
      showToast(isArabic ? 'تم نسخ الرابط' : 'Link copied', 'success')
    }).catch(() => {
      showToast(isArabic ? 'فشل نسخ الرابط' : 'Failed to copy link', 'error')
    })
  }, [student, studentQRLink, isArabic, showToast])

  if (!student) return null
  const safePaymentStatus = paymentStatus && typeof paymentStatus === 'object' ? paymentStatus : null

  return (
    <Modal open={open} onClose={onClose} title={t('student_file')} wide>
      {/* Report card — intentionally light (printable document), not themed */}
      <div className="bg-white rounded-xl p-4 space-y-4" style={{ colorScheme: 'light' }}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-lg font-black text-slate-400 border border-slate-200">ن</div>
            <div>
            <h4 className="text-xl font-black text-[#0E2954] flex items-center gap-2">
              {student.name}
              {hasWarning && <span className="text-rose-600 text-sm" title={isArabic ? 'تراجع أكاديمي' : 'Academic decline'}>📉</span>}
            </h4>
            <p className="text-sm text-outline">{student.stage} · {student.group_name}</p>
            <p className="text-xs text-outline font-mono mt-1" dir="ltr">{student.code || 'N/A'}</p>
            </div>
          </div>
          {qrDataUrl && <img src={qrDataUrl} alt="QR" className="w-20 h-20 rounded-lg border border-slate-200 p-1" />}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
          <Stat label={t('points')} value={`${student.points} pt`} color="text-[#D97706]" />
          <Stat label={t('position')} value={`#${position}`} color="text-violet-600" />
          <Stat label={t('rank')} value={`🛡️ ${rank}`} color="text-[#D97706]" />
          <Stat label={t('attendance')} value={student.attendance_status} color="text-emerald-600" />
          {attendancePct != null && (
            <Stat
              label={isArabic ? 'نسبة الحضور' : 'Attendance %'}
              value={`${attendancePct}%`}
              color={attendancePct >= 75 ? 'text-emerald-400' : attendancePct >= 50 ? 'text-amber-400' : 'text-rose-400'}
            />
          )}
          {safePaymentStatus && (
            <Stat
              label={isArabic ? 'الدفاعة' : 'Payment'}
              value={safePaymentStatus.status === 'paid'
                ? `✓ ${isArabic ? 'مدفوع' : 'Paid'}`
                : safePaymentStatus.status === 'partial'
                  ? `◐ ${isArabic ? 'جزئي' : 'Partial'} (${safePaymentStatus.remaining ?? ''})`
                  : `⚠ ${isArabic ? 'غير مدفوع' : 'Unpaid'} (${safePaymentStatus.total_due ?? ''})`}
              color={safePaymentStatus.status === 'paid' ? 'text-emerald-400' : safePaymentStatus.status === 'partial' ? 'text-amber-400' : 'text-rose-400'}
            />
          )}
        </div>

        {insights && insights.length > 0 && (
          <div className="space-y-1">
            <h5 className="text-sm font-bold text-slate-700 mb-1">💡 {isArabic ? 'تنبيهات ذكية' : 'Smart Insights'}</h5>
            {insights.map((ins, i) => (
              <div key={i} className={`text-xs px-2 py-1 rounded-lg border ${ins.severity === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-700' : ins.severity === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
                {ins.message}
              </div>
            ))}
          </div>
        )}

        {session && (session.lesson_topic || session.homework_text) && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm font-bold text-[#D97706] mb-1">📚 {t('today_session')} ({student.group_name})</p>
            {session.lesson_topic && <p className="text-xs text-outline"><span className="text-on-surface-variant">{t('lesson')} </span>{session.lesson_topic}</p>}
            {session.homework_text && <p className="text-xs text-outline mt-0.5"><span className="text-on-surface-variant">{t('homework_label')} </span>{session.homework_text}</p>}
          </div>
        )}

        <div>
          <h5 className="text-sm font-bold text-slate-700 mb-2">{t('events_today')}</h5>
          {dailyLogs.length === 0 ? (
            <p className="text-on-surface-variant text-xs">{t('no_events_today')}</p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {dailyLogs.map((l) => (
                <div key={l.id} className="text-xs text-outline border-b border-slate-100 pb-1">
                  [{new Date(l.created_at).toLocaleTimeString(isArabic ? 'ar-EG' : 'en', { hour: '2-digit', minute: '2-digit' })}] {l.note}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h5 className="text-sm font-bold text-slate-700 mb-2">{t('exams_title')}</h5>
          {exams.length === 0 ? (
            <p className="text-on-surface-variant text-xs text-center py-3">{t('no_exams_student')}</p>
          ) : (
            <div className="space-y-2">
              {exams.map((ex) => {
                const totalMax = ex.max_score_per_section * Object.keys(ex.section_scores || {}).length
                const pct = totalMax > 0 ? Math.round((ex.total_score / totalMax) * 100) : 0
                return (
                  <div key={ex.id} className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-bold text-[#D97706]">{ex.exam_title}</span>
                      <span className="text-on-surface-variant text-xs">{new Date(ex.created_at).toLocaleDateString(isArabic ? 'ar-EG' : 'en')}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-outline">{t('total')} {ex.total_score}</span>
                      <span className="font-black text-[#D97706]">{pct}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        <button onClick={() => onEditPoints?.(student.id)} className="glass-input hover:bg-white/10 text-slate-100 font-bold py-2 rounded-lg text-sm border border-sky-500/30">✎ تعديل النقاط</button>
        {student.warnings > 0 && <button onClick={() => onRemoveWarning?.(student.id)} className="glass-input hover:bg-white/10 text-emerald-300 font-bold py-2 rounded-lg text-sm border border-emerald-500/30">🚨− إزالة إنذار</button>}
        <button onClick={() => onEdit(student)} className="glass-input hover:bg-white/10 text-slate-100 font-bold py-2 rounded-lg text-sm border border-white/10">
          {t('edit_data')}
        </button>
        <button onClick={sendQRLink} disabled={qrSending} className="bg-gradient-to-l from-brand-gold to-brand-gold-hover text-brand-bg font-bold py-2 rounded-lg text-sm disabled:opacity-50">
          📱 {isArabic ? 'إرسال رابط QR' : 'Send QR Link'}
        </button>
        <button onClick={downloadQRCard} className="glass-input hover:bg-white/10 text-slate-100 font-bold py-2 rounded-lg text-sm border border-white/10">
          🪪 {t('qr_card_print')}
        </button>
        <button onClick={copyQRLink} className="glass-input hover:bg-white/10 text-slate-100 font-bold py-2 rounded-lg text-sm border border-white/10">
          🔗 {isArabic ? 'نسخ الرابط' : 'Copy Link'}
        </button>
      </div>
      <button onClick={downloadQR} className="w-full text-on-surface-variant hover:text-on-surface text-xs mt-2">{t('download_qr_only')}</button>
      {diagnosticEvents.length > 0 && !diagnosticOpen && <button type="button" onClick={() => setDiagnosticOpen(true)} className="w-full mt-2 rounded-xl border border-rose-300/70 bg-rose-50 px-3 py-2 text-[11px] font-black text-rose-700">{isArabic ? 'عرض تفاصيل آخر فحص' : 'View last diagnostic'}</button>}
      {diagnosticOpen && <QRDiagnosticPanel events={diagnosticEvents} isArabic={isArabic} onClose={() => setDiagnosticOpen(false)} />}

      {/* QR Card — hidden, used for image capture only */}
      <div className="fixed pointer-events-none" style={{ left: 0, top: 0, zIndex: -1, opacity: 0.01, maxWidth: '100vw' }}>
        <div ref={qrCardRef} className="bg-white p-6" style={{ width: 'min(420px, calc(100vw - 32px))', boxSizing: 'border-box', colorScheme: 'light' }}>
          <div className="border-2 border-[#0E2954] rounded-2xl p-5 relative overflow-hidden" style={{ background: 'linear-gradient(180deg,#ffffff 0%,#F8FAFC 100%)' }}>
            <div className="absolute top-0 right-0 w-16 h-16 border-b-2 border-l-2 border-[#F59E0B] rounded-bl-2xl" />
            <div className="absolute bottom-0 left-0 w-16 h-16 border-t-2 border-r-2 border-[#F59E0B] rounded-tr-2xl" />
            <div className="flex flex-col items-center gap-1 pb-3 mb-3 border-b border-slate-200">
              <img src="/nokhba-mark.svg" alt="" className="w-10 h-10" />
              <p className="font-black text-[#0E2954] text-sm">{isArabic ? 'النخبة' : 'Al-Nokhba'}</p>
              <p className="text-[10px] text-slate-400">{isArabic ? 'إدارة الحصص الذكية' : 'Smart Class Management'}</p>
            </div>

            <div className="text-center mb-4">
              <p className="text-lg font-black text-[#0E2954] leading-tight">{student.name}</p>
              <span className="inline-block bg-amber-50 text-[#D97706] text-[10px] font-bold px-2 py-0.5 rounded-full mt-1">{t('student_label')}</span>
              <p className="text-outline text-xs mt-1">{student.group_name} · {student.stage}</p>
              <p className="text-on-surface-variant text-[10px] mt-0.5">{today}</p>
            </div>

            <div className="flex justify-center">
              <div className="border-2 border-[#F59E0B] rounded-xl p-2 bg-white">
                {qrCardDataUrl && <img src={qrCardDataUrl} alt="QR" className="w-40 h-40" />}
              </div>
            </div>

            <p className="text-center text-[#0E2954] text-[11px] font-bold mt-4 pt-3 border-t border-slate-200">
              {t('scan_to_attend')}
            </p>
            <p className="text-center text-[10px] text-slate-400 mt-1" dir="ltr">{studentQRLink || '—'}</p>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2 text-center">
      <p className={`font-black text-sm ${color}`}>{value}</p>
      <p className="text-on-surface-variant text-[10px]">{label}</p>
    </div>
  )
}
