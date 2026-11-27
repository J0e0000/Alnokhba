import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { useWorkspace } from '../store/WorkspaceStore'
import { useAuth } from '../context/AuthContext'
import { getOrCreateStudentToken, buildStudentQRLink, buildQRMessage, generateStudentReportPDF } from '../lib/qrPdfWhatsApp'
import { printStudentCardPdf } from '../lib/studentCardPdf'
import { findCardByCode, nextFreeCard, assignCardToStudent, fetchAssignedPoolByStudent } from '../lib/cardPool'
import { normalizeEgyptianPhone, buildWhatsAppUrl, openWhatsAppUrl, showWhatsAppHandoff } from '../lib/helpers'

// ═══════════════════════════════════════════════════════════════════════════
// STUDENT QR MODAL — the ONE place where a student's portal link is visible,
// copyable, sendable, and downloadable. Fixes the "اللينك ما بيتباعش" bug:
//  • the link is always appended to the WhatsApp message (buildQRMessage)
//  • the QR uses a 4-module quiet zone so screenshots/photos scan reliably
// ═══════════════════════════════════════════════════════════════════════════
export default function StudentQRModal({ open, student, template, onClose, showToast }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const { effectiveTeacherId } = useAuth()
  // PERF: qrcode loads on demand (dynamic import) — it used to ship in the
  // first bundle for every teacher even though QR modals are button-driven.
  const makeQR = (url, opts) => import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(url, opts))
  const [link, setLink] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [cardBusy, setCardBusy] = useState(false)
  // 🎴 pool-card binding (note #27-4): printing is for students ASSIGNED a
  // pool card — the printed 5-digit code IS that card's code. Attach a card
  // here (by code or next-free) for students that don't have one yet.
  const [poolCode, setPoolCode] = useState(null)
  const [attachCode, setAttachCode] = useState('')
  const [attachBusy, setAttachBusy] = useState(false)
  const linkRef = useRef(null)

  useEffect(() => {
    if (!open || !student?.id || !effectiveTeacherId) return
    let alive = true
    fetchAssignedPoolByStudent(effectiveTeacherId)
      .then((map) => { if (alive) setPoolCode(map.get(student.id)?.code || null) })
      .catch(() => { /* pool invisible — printing shows the guidance toast */ })
    return () => { alive = false }
  }, [open, student?.id, effectiveTeacherId])

  useEffect(() => {
    if (!open || !student?.id) return
    let alive = true
    setStatus('loading'); setLink(''); setQrDataUrl(''); setCopied(false)
    getOrCreateStudentToken(student.id)
      .then((token) => {
        if (!alive) return
        if (!token) { setStatus('error'); return }
        const url = buildStudentQRLink(token)
        setLink(url)
        return makeQR(url, {
          width: 320, margin: 4,
          color: { dark: '#142D62', light: '#FFFFFF' },
          errorCorrectionLevel: 'M',
        }).then((dataUrl) => { if (alive) { setQrDataUrl(dataUrl); setStatus('ready') } })
      })
      .catch(() => { if (alive) setStatus('error') })
    return () => { alive = false }
  }, [open, student?.id])

  const copyLink = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = link
      ta.style.position = 'fixed'; ta.style.opacity = '0.01'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    showToast?.(isArabic ? 'تم نسخ الرابط ✓' : 'Link copied ✓', 'success')
    setTimeout(() => setCopied(false), 2000)
  }

  const sendWhatsApp = () => {
    if (!link || sending) return
    const phone = normalizeEgyptianPhone(student?.phone)
    if (!phone) { showToast?.(isArabic ? 'لا يوجد رقم هاتف صحيح لهذا الطالب' : 'No valid phone for this student', 'error'); return }
    setSending(true)
    try {
      // buildQRMessage ALWAYS appends the link when the template lacks {link}
      const message = buildQRMessage(student?.name || '', link, template || '')
      const url = buildWhatsAppUrl(phone, message)
      if (!url) { showToast?.(isArabic ? 'تعذر تجهيز رسالة الواتساب' : 'Could not build WhatsApp message', 'error'); return }
      const res = openWhatsAppUrl(url)
      if (!res?.ok) showWhatsAppHandoff(url, { caption: student?.name || '' })
    } finally { setSending(false) }
  }

  const downloadQR = () => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `QR_${(student?.name || 'student').replace(/\s+/g, '_')}.png`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  // 📄 تقرير PDF للطالب (نفس تقرير متابعة الطالب المُوثّق في بوابة أولياء الأمور):
  // هوية الطالب واضحة (الاسم/الكود/المرحلة/المجموعة) + هوية النخبة في الترويسة.
  const downloadStudentPdf = async () => {
    if (pdfBusy || !student?.id) return
    setPdfBusy(true)
    try {
      const res = await generateStudentReportPDF(student, {
        ranks: ws.ranks,
        allStudents: ws.students,
        examScores: ws.examScoresByStudent?.[student.id] || [],
        download: true,
      })
      if (res?.success) showToast?.(isArabic ? 'تم تحميل تقرير الطالب PDF ✓' : 'Student report PDF downloaded ✓', 'success')
      else showToast?.(isArabic ? 'تعذر توليد الـ PDF — حاول تاني' : 'Could not generate the PDF — try again', 'error')
    } finally { setPdfBusy(false) }
  }

  // 💳 كرت الطالب المطبوع (وجهان — أمام: اللوجو + كود الكرت، خلف: QR الحضور):
  // PDF جاهز للطباعة مع خطوط قص متقطعة. الطباعة للطلاب المربوطين بكرت جاهز
  // فقط (note #27-4) — الكود المطبوع هو كود الكرت المرتبط.
  const printVisaCard = async () => {
    if (cardBusy || !student?.id) return
    if (!poolCode) {
      showToast?.(
        isArabic ? 'الطالب مش مربوط بكرت جاهز — اربطه من «🔗 اربط بطاقة جاهزة» تحت واطبع تاني' : 'This student has no assigned card — attach one below first',
        'error',
      )
      return
    }
    setCardBusy(true)
    try {
      const res = await printStudentCardPdf(student, { poolCode })
      if (res?.success) showToast?.(isArabic ? `تم تحميل كرت الطالب PDF ✓ (كود الكرت ${poolCode} — وجهان: قص على الخطوط)` : `Student card PDF downloaded ✓ (card code ${poolCode})`, 'success')
      else showToast?.(isArabic ? 'تعذر تجهيز كرت الطالب — حاول تاني' : 'Could not build the student card — try again', 'error')
    } finally { setCardBusy(false) }
  }

  // 🔗 اربط بطاقة جاهزة لطالب موجود (note #27-4): بالكود أو أول بطاقة حرة —
  // نفس الـ QR المطبوع يشتغل فورًا للحضور والبوابة.
  const attachPoolCard = async (card) => {
    if (attachBusy || !student?.id || !effectiveTeacherId) return
    setAttachBusy(true)
    try {
      await assignCardToStudent(effectiveTeacherId, card, student.id)
      setPoolCode(card.code)
      setAttachCode('')
      showToast?.(isArabic ? `تم ربط البطاقة ${card.code} بالطالب ✓ — نفس الـ QR المطبوع هيشتغل للحضور` : `Card ${card.code} attached ✓ — the same printed QR now works`, 'success')
    } catch (err) {
      const msg = String(err?.message || err)
      showToast?.(
        msg.includes('card-already-assigned')
          ? (isArabic ? 'البطاقة دي مربوطة بطالب تاني' : 'That card is assigned to another student')
          : (isArabic ? 'تعذر الربط — حاول تاني' : 'Could not attach the card — try again'),
        'error',
      )
    } finally { setAttachBusy(false) }
  }

  const attachByCode = async () => {
    const clean = String(attachCode || '').trim()
    if (!/^\d{5}$/.test(clean)) { showToast?.(isArabic ? 'اكتب كود البطاقة (٥ أرقام)' : 'Enter the 5-digit card code', 'error'); return }
    setAttachBusy(true)
    try {
      const card = await findCardByCode(effectiveTeacherId, clean)
      if (!card) { showToast?.(isArabic ? 'مفيش بطاقة بالكود ده — اتأكد من الكود المطبوع' : 'No card with that code — check the printed card', 'error'); return }
      await attachPoolCard(card)
    } finally { setAttachBusy(false) }
  }

  const attachNextFree = async () => {
    setAttachBusy(true)
    try {
      const card = await nextFreeCard(effectiveTeacherId)
      if (!card) { showToast?.(isArabic ? 'مفيش بطاقات حرة — اطبع كروت جاهزة الأول من صفحة الطلاب' : 'No free cards — print blank stock first', 'error'); return }
      await attachPoolCard(card)
    } finally { setAttachBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={isArabic ? `رابط بوابة الطالب — ${student?.name || ''}` : `Student portal link — ${student?.name || ''}`}>
      {status === 'loading' && (
        <p className="text-center py-8 text-sm font-extrabold text-fg-muted">{isArabic ? 'جاري تجهيز الرابط...' : 'Preparing link...'}</p>
      )}
      {status === 'error' && (
        <div className="text-center py-6">
          <p className="text-sm font-extrabold mb-3" style={{ color: 'var(--danger-strong)' }}>
            {isArabic ? 'تعذر إنشاء رابط الطالب. حاول تاني.' : 'Could not create the student link. Try again.'}
          </p>
          <button className="btn-navy rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold" onClick={() => { setStatus('loading'); if (student?.id) { getOrCreateStudentToken(student.id).then((t) => { if (t) { const u = buildStudentQRLink(t); setLink(u); makeQR(u, { width: 320, margin: 4, color: { dark: '#142D62', light: '#FFFFFF' }, errorCorrectionLevel: 'M' }).then((d) => { setQrDataUrl(d); setStatus('ready') }) } else setStatus('error') }).catch(() => setStatus('error')) } }}>
            {isArabic ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}
      {status === 'ready' && (
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-2xl p-3" style={{ background: '#FFFFFF', border: '3px solid var(--brand-navy, #142D62)' }}>
            {qrDataUrl && <img src={qrDataUrl} alt={isArabic ? 'QR الطالب' : 'Student QR'} style={{ width: 240, height: 240, display: 'block' }} />}
          </div>
          <input
            ref={linkRef}
            readOnly
            dir="ltr"
            value={link}
            onFocus={(e) => e.target.select()}
            className="glass-input rounded-xl px-3 py-2.5 text-[.8rem] w-full text-center"
            style={{ userSelect: 'all' }}
            aria-label={isArabic ? 'رابط البوابة' : 'Portal link'}
          />
          <div className="flex flex-wrap gap-2 justify-center w-full">
            <button className="btn-navy rounded-xl px-4 py-2.5 text-[.75rem] font-extrabold" onClick={copyLink}>
              {copied ? '✓ ' : '📋 '}{isArabic ? 'نسخ الرابط' : 'Copy link'}
            </button>
            <button className="rounded-xl px-4 py-2.5 text-[.75rem] font-extrabold" style={{ background: '#e7f8ee', color: '#0c6b50', border: '1px solid #b5e5d2' }} onClick={sendWhatsApp} disabled={sending}>
              ✆ {isArabic ? 'إرسال واتساب' : 'Send WhatsApp'}
            </button>
            <button className="btn-ghost rounded-xl px-4 py-2.5 text-[.75rem] font-extrabold" onClick={downloadQR} disabled={!qrDataUrl}>
              ⬇ {isArabic ? 'تحميل QR' : 'Download QR'}
            </button>
            <button className="btn-gold rounded-xl px-4 py-2.5 text-[.75rem] font-extrabold" onClick={downloadStudentPdf} disabled={pdfBusy} title={isArabic ? 'تقرير متابعة الطالب — PDF بالهوية الرسمية' : 'Student follow-up report — branded PDF'}>
              {pdfBusy ? '… جاري التجهيز' : '📄 تقرير PDF'}
            </button>
            <button className="btn-navy rounded-xl px-4 py-2.5 text-[.75rem] font-extrabold" onClick={printVisaCard} disabled={cardBusy} title={isArabic ? 'كرت مطبوع بوجهين — اللوجو وكود الكرت أمامًا و QR خلف' : 'Printable two-face card — logo + card code front, QR back'}>
              {cardBusy ? '… جاري التجهيز' : poolCode ? `💳 كرت الطالب (${poolCode})` : '💳 كرت الطالب (فيزا)'}
            </button>
          </div>
          {/* 🎴 اربط بطاقة جاهزة — للطلاب من غير كرت مربوط (note #27-4):
              بالكود أو أول بطاقة حرة؛ نفس الـ QR المطبوع يشتغل فورًا. */}
          <div className="rounded-2xl p-3 w-full" style={{ background: 'var(--surface-container, rgba(20,45,98,.06))', border: '1px solid var(--surface-border)' }}>
            <p className="text-[.72rem] font-extrabold m-0 mb-2">
              {poolCode
                ? (isArabic ? `🎴 مربوط بالبطاقة ${poolCode} — الكود ده هو المطبوع على الكرت` : `🎴 Attached to card ${poolCode}`)
                : (isArabic ? '🎴 الطالب مش مربوط ببطاقة — اربطه بكود البطاقة المطبوعة أو بأول بطاقة حرة' : '🎴 No card attached — attach a printed card by code or auto-assign')}
            </p>
            {!poolCode && (
              <div className="flex flex-wrap gap-2">
                <input
                  value={attachCode}
                  onChange={(e) => setAttachCode(e.target.value)}
                  inputMode="numeric"
                  placeholder={isArabic ? 'كود البطاقة (٥ أرقام)' : 'Card code (5 digits)'}
                  aria-label={isArabic ? 'كود البطاقة المطبوعة' : 'Printed card code'}
                  className="glass-input rounded-xl px-3 py-2 text-[.78rem] w-36"
                  dir="ltr"
                />
                <button className="btn-navy rounded-xl px-3 py-2 text-[.72rem] font-extrabold" onClick={attachByCode} disabled={attachBusy}>
                  {attachBusy ? '…' : '🔗'} {isArabic ? 'ربط بكود' : 'Attach by code'}
                </button>
                <button className="btn-ghost rounded-xl px-3 py-2 text-[.72rem] font-extrabold" onClick={attachNextFree} disabled={attachBusy}>
                  {attachBusy ? '…' : '✨'} {isArabic ? 'أول بطاقة حرة' : 'Next free card'}
                </button>
              </div>
            )}
          </div>
          <p className="text-[.68rem] text-fg-muted text-center m-0">
            {isArabic ? 'الطالب يفتح الرابط ده من غير تسجيل دخول — ويقدر ينسخه أو يشاركه من صفحته نفسها.' : 'The student opens this link without login — and can copy/share it from their own page.'}
          </p>
        </div>
      )}
    </Modal>
  )
}
