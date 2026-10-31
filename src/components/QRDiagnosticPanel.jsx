import { useState } from 'react'

function formatDetails(details) {
  if (!details) return ''
  if (typeof details === 'string') return details
  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(' • ')
}

function diagnosticText(events, isArabic) {
  const header = isArabic ? 'تشخيص إرسال QR / WhatsApp' : 'QR / WhatsApp Send Diagnostic'
  const lines = events.map((event, index) => {
    const time = event.time ? new Date(event.time).toLocaleTimeString() : ''
    const status = event.status === 'ok' ? 'OK' : event.status === 'error' ? 'ERROR' : 'INFO'
    return `${index + 1}. [${status}] ${event.stage}${time ? ` (${time})` : ''}${event.details ? ` — ${formatDetails(event.details)}` : ''}`
  })
  return [header, ...lines].join('\n')
}

export default function QRDiagnosticPanel({ events = [], isArabic = true, onClose }) {
  const [copied, setCopied] = useState(false)
  if (!events.length) return null

  const copyDetails = async () => {
    const text = diagnosticText(events, isArabic)
    try {
      await navigator.clipboard?.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      return
    } catch { /* Safari fallback below */ }
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* keep the visible details available for a screenshot */ }
  }

  return (
    <div className="mt-3 rounded-2xl border border-rose-300/70 bg-rose-50 p-3 text-right shadow-sm" dir="rtl" role="alert">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-rose-800">{isArabic ? 'تفاصيل التشخيص' : 'Diagnostic details'}</p>
          <p className="mt-1 text-[11px] leading-5 text-rose-700">{isArabic ? 'صوّر هذه النافذة أو انسخ التفاصيل لإرسالها للدعم.' : 'Screenshot this panel or copy the details for support.'}</p>
        </div>
        {onClose && <button type="button" onClick={onClose} className="text-lg font-black text-rose-500" aria-label={isArabic ? 'إغلاق' : 'Close'}>×</button>}
      </div>
      <div className="mt-3 max-h-56 overflow-auto rounded-xl bg-white/80 p-2 font-mono text-[10px] leading-5 text-slate-700" dir="ltr">
        {events.map((event, index) => (
          <div key={`${event.time || index}-${index}`} className={`border-b border-slate-100 py-1 last:border-0 ${event.status === 'error' ? 'font-bold text-rose-700' : ''}`}>
            <span className="mr-1">{event.status === 'ok' ? '✓' : event.status === 'error' ? '✕' : '•'}</span>
            <strong>{event.stage}</strong>{event.details ? ` — ${formatDetails(event.details)}` : ''}
          </div>
        ))}
      </div>
      <button type="button" onClick={copyDetails} className="mt-2 w-full rounded-xl bg-rose-700 px-3 py-2 text-xs font-black text-white hover:bg-rose-800">
        {copied ? (isArabic ? 'تم نسخ التفاصيل' : 'Details copied') : (isArabic ? 'نسخ تفاصيل الخطأ' : 'Copy diagnostic details')}
      </button>
    </div>
  )
}

export { diagnosticText }
