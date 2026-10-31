import { useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import { useLanguage } from '../context/LanguageContext'
import { isValidPhone, normalizeEgyptianPhone } from '../lib/helpers'

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM MESSAGE COMPOSER (owner request: "send messages to specific people
// in these groups") — the free-form counterpart of the status-based report
// queues. The teacher already picked the recipients (RecipientPickerModal or
// the Students table selection); this modal writes THE text and hands the
// interpolated per-student messages to the send queue (ui.startQueue).
//
// CARET-SAFE CONTRACT (the TemplatesModal lesson): the text state is
// initialized ONCE from the welcome template and is never re-synced from
// props while typing — no effect can yank the caret back. Placeholder chips
// insert at the REAL caret position via selectionStart + setSelectionRange.
//
// PLACEHOLDERS: {studentName} {group} {date} — interpolated per student at
// send time, so one composed text becomes one personalized message each.
// Nothing sends from here: the queue modal stays the only sender.
// ═══════════════════════════════════════════════════════════════════════════

const PLACEHOLDERS = [
  { token: '{studentName}', ar: 'اسم الطالب', en: 'Student name' },
  { token: '{group}', ar: 'المجموعة', en: 'Group' },
  { token: '{date}', ar: 'تاريخ اليوم', en: 'Today' },
]

export const interpolateCustomMessage = (text, student) => String(text || '')
  .replaceAll('{studentName}', student?.name || '')
  .replaceAll('{group}', student?.group_name || '')
  .replaceAll('{date}', new Date().toLocaleDateString('ar-EG'))

export default function CustomMessageModal({ open, onClose, students = [], settings, onSend, title }) {
  const { isArabic } = useLanguage()
  const [text, setText] = useState(() => settings?.msg_welcome || '')
  const textareaRef = useRef(null)
  const [sent, setSent] = useState(false)

  const withPhone = useMemo(
    () => students.filter((s) => s?.phone && isValidPhone(s.phone)),
    [students],
  )
  const withoutPhone = useMemo(
    () => students.filter((s) => !(s?.phone && isValidPhone(s.phone))),
    [students],
  )
  const previewStudent = withPhone[0] || students[0] || null
  const preview = previewStudent ? interpolateCustomMessage(text, previewStudent) : ''

  // Caret-safe insert: place the token exactly where the teacher is typing.
  const insertToken = (token) => {
    const el = textareaRef.current
    if (!el) { setText((t) => t + token); return }
    const start = typeof el.selectionStart === 'number' ? el.selectionStart : text.length
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start
    const next = text.slice(0, start) + token + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      try { el.focus(); el.setSelectionRange(start + token.length, start + token.length) } catch { /* detached */ }
    })
  }

  const send = () => {
    if (sent) return
    const body = String(text || '').trim()
    if (!body) return
    if (!withPhone.length) return
    setSent(true)
    onSend(withPhone.map((s) => ({
      key: s.id,
      kind: 'custom',
      student: s,
      phone: normalizeEgyptianPhone(s.phone),
      message: interpolateCustomMessage(body, s),
    })))
  }

  return (
    <Modal open={open} onClose={onClose} title={title || (isArabic ? '✆ رسالة مخصصة' : 'Custom message')} wide>
      <p className="text-[.72rem] text-fg-muted m-0 mb-3">
        {isArabic
          ? `اكتب الرسالة مرة واحدة وهيتبعت لـ ${withPhone.length} طالب — كل طالب يستقبل نسخته باسمه. تعدّل كل رسالة لو حبيت من قائمة الإرسال نفسها.`
          : `Write once — ${withPhone.length} students receive their own copy. You can still edit each message from the send queue.`}
      </p>

      {/* Placeholder chips — insert at the caret, they never steal focus */}
      <div className="nk-att-chips mb-2" role="group" aria-label={isArabic ? 'إدراج متغير' : 'Insert placeholder'}>
        {PLACEHOLDERS.map((p) => (
          <button key={p.token} type="button" className="nk-att-chip" onClick={() => insertToken(p.token)} title={p.token}>
            ＋ {isArabic ? p.ar : p.en} <span dir="ltr" className="text-fg-subtle">{p.token}</span>
          </button>
        ))}
        <button type="button" className="nk-att-chip" onClick={() => setText('')}>
          🗑 {isArabic ? 'مسح النص' : 'Clear'}
        </button>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        autoFocus
        className="w-full glass-input border border-subtle rounded-xl px-3.5 py-3 text-sm outline-none focus:border-brand-gold min-h-[140px] resize-y"
        placeholder={isArabic ? 'اكتب رسالتك هنا...' : 'Write your message...'}
        aria-label={isArabic ? 'نص الرسالة' : 'Message text'}
      />

      {/* Live preview — the FIRST recipient's personalized copy */}
      {previewStudent && (
        <div className="rounded-xl p-3 mt-1 mb-1 text-[.74rem]" style={{ background: 'var(--surface-container-high)', border: '1px solid var(--surface-border)' }}>
          <b className="block mb-1 text-[.7rem] text-fg-subtle">
            {isArabic ? `معاينة — رسالة ${previewStudent.name}:` : `Preview — message for ${previewStudent.name}:`}
          </b>
          <div className="whitespace-pre-line text-fg-muted">{preview || (isArabic ? '—' : '—')}</div>
        </div>
      )}

      {withoutPhone.length > 0 && (
        <p className="text-[.68rem] mt-2 mb-0 text-fg-subtle">
          {isArabic
            ? `مش هيتبعت لـ ${withoutPhone.length} طالب (مفيش رقم صحيح): ${withoutPhone.slice(0, 5).map((s) => s.name).join(' · ')}${withoutPhone.length > 5 ? ' …' : ''}`
            : `${withoutPhone.length} skipped (no valid phone): ${withoutPhone.slice(0, 5).map((s) => s.name).join(' · ')}${withoutPhone.length > 5 ? ' …' : ''}`}
        </p>
      )}

      <div className="flex flex-wrap gap-2 items-center mt-4 pt-3" style={{ borderTop: '1px solid var(--surface-border)' }}>
        <button className="btn-ghost rounded-xl px-4 py-2.5 text-[.74rem] font-extrabold" onClick={onClose}>
          {isArabic ? 'إلغاء' : 'Cancel'}
        </button>
        <span className="nk-pill nk-pill-gold me-auto">{isArabic ? `${withPhone.length} مستلم` : `${withPhone.length} recipients`}</span>
        <button
          className="btn-gold action-button !min-h-[2.9rem]"
          disabled={!text.trim() || withPhone.length === 0 || sent}
          onClick={send}
        >
          ← {isArabic ? 'قائمة الإرسال' : 'Send queue'} ({withPhone.length})
        </button>
      </div>
    </Modal>
  )
}
