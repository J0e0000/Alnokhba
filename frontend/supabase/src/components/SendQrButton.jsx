/**
 * Send QR button — fetches student token, builds unique /qr/TOKEN link,
 * then opens WhatsApp with the per-student link.
 */
import { useState } from 'react'
import { sendQRViaWhatsApp, getOrCreateStudentToken, buildStudentQRLink } from '../lib/qrPdfWhatsApp'
import { useLanguage } from '../context/LanguageContext'
import { useToast } from '../context/ToastContext'

export default function SendQrButton({ student, disabled, className = '', template }) {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const { isArabic, t } = useLanguage()
  const { showToast } = useToast()

  if (!student?.phone) return null

  const handleSend = async () => {
    if (loading || sent) return
    setLoading(true)
    try {
      // 1) Get or create the student's QR token
      const token = await getOrCreateStudentToken(student.id)
      if (!token) {
        // DO NOT silently fall back to the bare site URL — that sends
        // the parent a broken link with no portal. Surface the error.
        console.error('Failed to get QR token for student:', student.id)
        showToast(
          isArabic
            ? 'تعذّر إنشاء رابط الطالب. تأكد إنك داخل بحسابك وحاول تاني.'
            : 'Could not create the student link. Make sure you are signed in and try again.',
          'error'
        )
        return
      }

      // 2) Build the unique link (e.g. https://your-tunnel/qr/abc123...)
      const studentLink = buildStudentQRLink(token)

      // 3) Send via WhatsApp
      sendQRViaWhatsApp(student.phone, student.name, studentLink, template)
      setSent(true)
      setTimeout(() => setSent(false), 10000)
    } catch (err) {
      console.error('QR send error:', err)
      showToast(t('qr_failed') || (isArabic ? 'فشل إرسال الكود' : 'Failed to send QR'), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleSend}
      disabled={disabled || loading}
      className={`clay-btn-gold text-xs px-4 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all ${loading ? 'opacity-50' : ''} ${className}`}
    >
      <span className="material-symbols-outlined" style={{fontSize:16}}>
        {loading ? 'sync' : sent ? 'check_circle' : 'qr_code_2'}
      </span>
      {loading ? (isArabic ? 'جاري الإرسال...' : 'Sending...') : sent ? (isArabic ? 'تم الإرسال' : 'Sent') : (isArabic ? 'إرسال QR للوالد' : 'Send QR to Parent')}
    </button>
  )
}
