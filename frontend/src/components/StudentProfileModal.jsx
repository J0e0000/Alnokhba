import { useEffect, useState } from 'react'
import Modal from './Modal'
import { getStudentRank, buildWhatsAppUrl, normalizeEgyptianPhone, openWhatsAppUrl, copyToClipboard } from '../lib/helpers'
import { getOrCreateStudentToken, buildStudentQRLink, generateStudentQR } from '../lib/qrPdfWhatsApp'

/**
 * StudentProfileModal — quick READ-ONLY profile opened by clicking a student's
 * NAME in the Students tab (rule: name = profile, row = selection).
 *
 * Shows identity + live status pills, and the student's PORTAL link with:
 *  • [نسخ الرابط] — copies https://.../qr/<token> to the clipboard (the teacher
 *    can paste it anywhere — this was impossible before)
 *  • [عرض QR] — renders the actual scannable QR for the portal link
 *  • [واتساب] — sends the link to the student's phone
 *
 * Data is never edited here — editing stays in StudentModal, session data in
 * the Session Workspace (existing permission model untouched).
 */
export default function StudentProfileModal({ open, student, onClose, onEdit, showToast, isArabic = true, ranks = [] }) {
  const [link, setLink] = useState('')
  const [loadingLink, setLoadingLink] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [showQr, setShowQr] = useState(false)

  // Resolve the portal link every time the modal opens for a student.
  useEffect(() => {
    if (!open || !student?.id) { setLink(''); setQrDataUrl(''); setShowQr(false); return }
    let alive = true
    setLoadingLink(true)
    setLink(''); setQrDataUrl(''); setShowQr(false)
    ;(async () => {
      try {
        const token = await getOrCreateStudentToken(student.id)
        if (!alive) return
        setLink(token ? buildStudentQRLink(token) : '')
      } catch {
        if (alive) setLink('')
      } finally {
        if (alive) setLoadingLink(false)
      }
    })()
    return () => { alive = false }
  }, [open, student?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // QR is generated lazily and only decoded once per open.
  useEffect(() => {
    if (!showQr || !link || qrDataUrl) return
    let alive = true
    generateStudentQR(link).then((url) => { if (alive && url) setQrDataUrl(url) })
    return () => { alive = false }
  }, [showQr, link, qrDataUrl])

  if (!student) return null

  const copyLink = async () => {
    if (!link) return
    const ok = await copyToClipboard(link)
    showToast?.(
      ok ? (isArabic ? '✅ تم نسخ رابط البوابة — الصقه في أي مكان' : 'Portal link copied') : (isArabic ? 'تعذر النسخ — انسخ الرابط يدويًا' : 'Copy failed'),
      ok ? 'success' : 'error',
    )
  }

  const sendByWhatsApp = () => {
    if (!link) return
    const phone = normalizeEgyptianPhone(student.phone)
    if (!phone) { showToast?.(isArabic ? 'لا يوجد رقم هاتف صحيح' : 'No valid phone', 'error'); return }
    const message = `مرحبًا ${student.name}\nرابط Student Portal الخاص بالطالب: ${link}`
    openWhatsAppUrl(buildWhatsAppUrl(phone, message))
  }

  const rank = getStudentRank(student.points || 0, ranks)

  return (
    <Modal open={open} onClose={onClose} title={isArabic ? 'ملف الطالب' : 'Student profile'}>
      {/* Identity */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-black shrink-0" style={{ background: 'var(--brand-gold-surface)', color: 'var(--brand-gold)' }}>
          {(student.name || '؟').trim().charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="font-black text-fg m-0 truncate">{student.name}</p>
          <p className="text-[.72rem] text-fg-muted m-0 truncate">
            {student.code || ''}{student.group_name ? ` · ${student.group_name}` : ''}{student.stage ? ` · ${student.stage}` : ''}
          </p>
        </div>
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <span className={`nk-pill ${student.attendance_status === 'حاضر' ? 'nk-pill-live' : student.attendance_status === 'غائب' ? 'nk-pill-danger' : 'nk-pill-neutral'}`}>
          {student.attendance_status === 'حاضر' ? '✓ حاضر' : student.attendance_status === 'غائب' ? '✗ غائب' : 'لم يُرصد'}
        </span>
        <span className="nk-pill nk-pill-gold">{rank} · {student.points || 0} نقطة</span>
        {(student.warnings || 0) > 0 && <span className="nk-pill nk-pill-danger">⚠ {student.warnings} إنذارات</span>}
        {student.phone && <span className="nk-pill nk-pill-neutral" dir="ltr">{student.phone}</span>}
      </div>

      {/* Portal link box */}
      <div className="rounded-xl p-3 mb-4" style={{ background: 'var(--surface-container)', border: '1px solid var(--surface-border)' }}>
        <p className="text-[.74rem] font-extrabold m-0 mb-1.5" style={{ color: 'var(--brand-gold)' }}>
          🔗 {isArabic ? 'رابط بوابة الطالب (Student Portal)' : 'Student portal link'}
        </p>
        {loadingLink ? (
          <p className="text-[.74rem] text-fg-muted m-0">جاري تحضير الرابط...</p>
        ) : link ? (
          <>
            <p dir="ltr" className="text-[.7rem] m-0 mb-2.5 truncate font-mono" style={{ color: 'var(--fg-subtle)' }}>{link}</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-navy !min-h-0 rounded-lg px-3 py-2 text-[.72rem] font-extrabold" onClick={copyLink}>
                📋 {isArabic ? 'نسخ الرابط' : 'Copy link'}
              </button>
              <button className="btn-ghost !min-h-0 rounded-lg px-3 py-2 text-[.72rem] font-extrabold" onClick={() => setShowQr((v) => !v)}>
                {showQr ? (isArabic ? 'إخفاء QR' : 'Hide QR') : `▦ ${isArabic ? 'عرض QR' : 'Show QR'}`}
              </button>
              {student.phone && (
                <button className="!min-h-0 rounded-lg px-3 py-2 text-[.72rem] font-extrabold" style={{ background: '#e7f8ee', color: '#0c6b50', border: '1px solid #b5e5d2' }} onClick={sendByWhatsApp}>
                  ✆ {isArabic ? 'إرسال واتساب' : 'Send WhatsApp'}
                </button>
              )}
            </div>
            {showQr && (
              <div className="mt-3 flex flex-col items-center gap-2">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Student portal QR" style={{ width: 'min(240px, 60vw)', imageRendering: 'pixelated' }} className="rounded-xl" />
                ) : (
                  <div style={{ width: 200, height: 200 }} className="rounded-xl" />
                )}
                <p className="text-[.66rem] text-fg-muted m-0 text-center">
                  {isArabic ? 'امسح الكود بالكاميرا أو التطبيق — يفتح بوابة الطالب مباشرة' : 'Scan with any camera app — opens the student portal'}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="text-[.74rem] m-0" style={{ color: 'var(--danger-strong)' }}>
            {isArabic ? 'تعذر تحضير الرابط — أعد فتح الملف أو تحقق من الاتصال.' : 'Could not prepare the link.'}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {onEdit && (
          <button className="btn-ghost !min-h-[2.6rem] rounded-xl px-4 text-[.74rem] font-extrabold" onClick={() => { onClose(); onEdit(student) }}>
            ✎ {isArabic ? 'تعديل البيانات' : 'Edit info'}
          </button>
        )}
      </div>
    </Modal>
  )
}
