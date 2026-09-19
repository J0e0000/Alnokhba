import { useEffect, useState } from 'react'
import Modal from './Modal'

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES (spec 12/16) — including the SEPARATE present vs absent
// attendance messages. Warning numbers are NEVER written by the teacher
// here: {warnings} / {remainingWarnings} are computed at send time from the
// student's real counters and the configured threshold (insight_config.
// max_warnings, default 3 — the QR entry-block rule).
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_PRESENT = 'مرحبًا،\nنحب نبلغ حضرتك إن {studentName} حضر حصة {group} اليوم.\n{lessonLine}شكرًا لكم.'
const DEFAULT_ABSENT = 'مرحبًا،\n{studentName} لم يحضر حصة {group} اليوم.\n{lessonLine}رصيد الإنذارات الحالي: {warnings}.\nمتبقي {remainingWarnings} إنذار قبل منع الدخول مؤقتًا عبر بوابة الطالب.\nنشكر لكم المتابعة.'

export default function TemplatesModal({ open, onClose, settings, onSave }) {
  const [welcome, setWelcome] = useState('')
  const [warning, setWarning] = useState('')
  const [promotion, setPromotion] = useState('')
  const [qrMessage, setQrMessage] = useState('')
  const [reportTemplate, setReportTemplate] = useState('')
  const [presentTemplate, setPresentTemplate] = useState('')
  const [absentTemplate, setAbsentTemplate] = useState('')

  useEffect(() => {
    if (settings) {
      setWelcome(settings.msg_welcome || '')
      setWarning(settings.msg_warning || '')
      setPromotion(settings.msg_promotion || '')
      setQrMessage(settings.qr_message_template || '')
      setReportTemplate(settings.msg_report_template || '')
      setPresentTemplate(settings.msg_attendance_present || '')
      setAbsentTemplate(settings.msg_attendance_absent || '')
    }
  }, [settings, open])

  const submit = (e) => {
    e.preventDefault()
    onSave({
      msg_welcome: welcome, msg_warning: warning, msg_promotion: promotion,
      qr_message_template: qrMessage, msg_report_template: reportTemplate,
      msg_attendance_present: presentTemplate, msg_attendance_absent: absentTemplate,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="قوالب رسائل واتساب" wide>
      <p className="text-fg-subtle text-xs mb-3">
        استخدم اللبنات الجاهزة أو اكتبها يدويًا وسيتم استبدالها تلقائيًا عند الإرسال. لو تركت قالب الحضور/الغياب فاضيًا هيُستخدم النص الافتراضي.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <TemplateField
          label="رسالة الحاضر (تقرير الحصة)"
          value={presentTemplate}
          onChange={setPresentTemplate}
          placeholder={DEFAULT_PRESENT}
          bricks={[
            ['اسم الطالب', '{studentName}'],
            ['المجموعة', '{group}'],
            ['التاريخ', '{date}'],
            ['موضوع الحصة', '{lessonLine}'],
          ]}
          hint="تُرسل للطلاب الحاضرين فقط — قصيرة ومباشرة."
        />
        <TemplateField
          label="رسالة الغائب (تقرير الغياب)"
          value={absentTemplate}
          onChange={setAbsentTemplate}
          placeholder={DEFAULT_ABSENT}
          bricks={[
            ['اسم الطالب', '{studentName}'],
            ['المجموعة', '{group}'],
            ['التاريخ', '{date}'],
            ['موضوع الحصة', '{lessonLine}'],
            ['رابط الفيديو', '{videoLink}'],
            ['الإنذارات الحالية', '{warnings}'],
            ['الإنذارات المتبقية', '{remainingWarnings}'],
          ]}
          hint="تُرسل للغائبين فقط. {warnings} و{remainingWarnings} يُحسبان من بيانات الطالب الحقيقية وعتبة الإنذارات في الإعدادات — لا تكتب رقمًا يدويًا."
        />
        <TemplateField label="رسالة الترحيب" value={welcome} onChange={setWelcome} />
        <TemplateField label="رسالة الإنذار" value={warning} onChange={setWarning} />
        <TemplateField label="رسالة الترقية" value={promotion} onChange={setPromotion} />
        <TemplateField label="رسالة QR للطالب" value={qrMessage} onChange={setQrMessage} bricks={[['اسم الطالب', '{studentName}'], ['رابط البوابة', '{link}']]} hint="لو {link} مش موجودة في القالب هتُضاف تلقائيًا في آخر الرسالة." />
        <TemplateField label="قالب تقرير الطابور" value={reportTemplate} onChange={setReportTemplate} />
        <button className="w-full btn-glow font-bold py-3 rounded-xl text-sm">
          حفظ القوالب
        </button>
      </form>
    </Modal>
  )
}

function TemplateField({ label, value, onChange, bricks = [], hint, placeholder }) {
  const addBrick = (brick) => onChange(`${value || ''}${value && !value.endsWith(' ') ? ' ' : ''}${brick}`)
  return (
    <div>
      <label className="block text-sm text-fg-subtle mb-1">{label}</label>
      {bricks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2" aria-label={`لبنات ${label}`}>
          {bricks.map(([name, brick]) => (
            <button key={brick} type="button" onClick={() => addBrick(brick)} className="rounded-full border border-brand-gold/30 bg-brand-gold/10 px-2 py-1 text-[11px] text-brand-gold-hover hover:bg-brand-gold/20">
              + {name}
            </button>
          ))}
        </div>
      )}
      <textarea
        rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || ''}
        className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold"
      />
      {hint && <p className="text-[11px] text-fg-muted mt-1 mb-0">{hint}</p>}
    </div>
  )
}
