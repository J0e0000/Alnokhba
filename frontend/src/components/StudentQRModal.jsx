import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import Modal from './Modal'
import { useWorkspace } from '../store/WorkspaceStore'
import { getOrCreateStudentToken, buildStudentQRLink, buildQRMessage } from '../lib/qrPdfWhatsApp'
import { normalizeEgyptianPhone, buildWhatsAppUrl, openWhatsAppUrl, showWhatsAppHandoff } from '../lib/helpers'

// ═══════════════════════════════════════════════════════════════════════════
// STUDENT QR MODAL — the ONE place where a student's portal link is visible,
// copyable, sendable, and downloadable. Fixes the "اللينك ما بيتباعش" bug:
//  • the link is always appended to the WhatsApp message (buildQRMessage)
//  • the QR uses a 4-module quiet zone so screenshots/photos scan reliably
// ═══════════════════════════════════════════════════════════════════════════
export default function StudentQRModal({ open, student, template, onClose, showToast }) {
  const { isArabic } = useWorkspace()
  const [link, setLink] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const linkRef = useRef(null)

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
        return QRCode.toDataURL(url, {
          width: 512, margin: 4,
          color: { dark: '#111111', light: '#FFFFFF' },
          errorCorrectionLevel: 'H',
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
      if (!(template || '').trim()) {
        showToast?.(isArabic ? 'مفيش قالب محفوظ — هيتإرسال رسالة افتراضية مع الرابط' : 'No saved template — a default message with the link will be sent', 'info')
      }
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
          <button className="btn-navy rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold" onClick={() => { setStatus('loading'); if (student?.id) { getOrCreateStudentToken(student.id).then((t) => { if (t) { const u = buildStudentQRLink(t); setLink(u); QRCode.toDataURL(u, { width: 512, margin: 4, color: { dark: '#111111', light: '#FFFFFF' }, errorCorrectionLevel: 'H' }).then((d) => { setQrDataUrl(d); setStatus('ready') }) } else setStatus('error') }).catch(() => setStatus('error')) } }}>
            {isArabic ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}
      {status === 'ready' && (
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-2xl p-3" style={{ background: '#FFFFFF', border: '3px solid var(--brand-navy, #0E2954)' }}>
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
          </div>
          <p className="text-[.68rem] text-fg-muted text-center m-0">
            {isArabic ? 'الطالب يفتح الرابط ده من غير تسجيل دخول — ويقدر ينسخه أو يشاركه من صفحته نفسها.' : 'The student opens this link without login — and can copy/share it from their own page.'}
          </p>
        </div>
      )}
    </Modal>
  )
}
