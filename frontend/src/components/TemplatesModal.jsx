import { useEffect, useState } from 'react'
import Modal from './Modal'

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES (spec 12/16) — including the SEPARATE present vs absent
// attendance messages. Warning numbers are NEVER written by the teacher
// here: {warnings} / {remainingWarnings} are computed at send time from the
// student's real counters and the configured threshold (insight_config.
// max_warnings, default 3 — the QR entry-block rule).
//
// READY EGYPTIAN TEMPLATES (owner request): every field carries a one-tap
// "قالب مصري جاهز" chip that fills the box with a colloquial Egyptian Arabic
// version. Placeholder policy per field follows the REAL send paths:
//   • present / absent → interpolated by buildAttendanceMessage (all bricks OK)
//   • welcome / QR     → {studentName} (+{link}) replaced by the send flows
//   • warning / promotion / queue-report → NO automated sender exists today,
//     so their ready texts are placeholder-free (safe to copy manually).
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_PRESENT = 'أهلًا حضرتك 🌟\n{studentName} حضر حصة {group} النهارده تمام ✅\n{lessonLine}شكرًا لمتابعتكم.'
const DEFAULT_ABSENT = 'مساء الخير حضرتك،\n{studentName} معدهش حصة {group} النهارده ❌\n{lessonLine}رصيد الإنذارات دلوقتي: {warnings}.\nلو كمل {remainingWarnings} إنذار هيتمنع مؤقتًا من بوابة الطالب.\nلو فيه عذر أو ظرف صحي، بلغنا — وشكرًا لمتابعتكم.'

const READY_EGYPTIAN = {
  present: DEFAULT_PRESENT,
  absent: DEFAULT_ABSENT,
  welcome: 'أهلًا بيك يا {studentName} في عيلة النخبة 🌟\nسعداء جدًا بإنضمامك، وإن شاء الله تكون سنة مليانة نجاح وتفوق.\nأي حاجة محتاجها إحنا معاك في أي وقت 💪',
  warning: 'تنبيه مهم حضرتك ⚠️\nالطالب وصل لعدد إنذارات كبير في المركز، ولو الاستمرار هيتم منعه مؤقتًا من بوابة الطالب.\nمحتاجين متابعة من حضرتك في البيت، وشكرًا لتعاونكم.',
  promotion: 'مبروووك! 🎉\nاستحقت الترقية للرتبة الجديدة بمجهودك والتزامك 🔥\nكمّل على البركة — إحنا فخورين بيك.',
  qrMessage: 'أهلًا يا {studentName} 👋\nدي بوابتك الشخصية في النخبة:\n{link}\nهتتابع منها حضورك ونقاطك ورتبتك كل ما تتقدم. احفظ اللينك عندك ✅',
  reportTemplate: 'السلام عليكم حضرتك،\nدي خلاصة حصة النهارده:\n• الموضوع: …\n• الواجب: …\n• ملاحظات عن الطالب: …\nشكرًا لمتابعتكم 🌟',
}

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
        استخدم اللبنات الجاهزة أو اكتبها يدويًا وسيتم استبدالها تلقائيًا عند الإرسال. لو تركت قالب الحضور/الغياب فاضيًا هيُستخدم النص الافتراضي (بالمصري). زر ✨ بيكتبلك قالب مصري جاهز للإرسال في أي خانة.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <TemplateField
          label="رسالة الحاضر (تقرير الحصة)"
          value={presentTemplate}
          onChange={setPresentTemplate}
          placeholder={DEFAULT_PRESENT}
          readyTemplate={READY_EGYPTIAN.present}
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
          readyTemplate={READY_EGYPTIAN.absent}
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
        <TemplateField label="رسالة الترحيب" value={welcome} onChange={setWelcome} readyTemplate={READY_EGYPTIAN.welcome} bricks={[['اسم الطالب', '{studentName}']]} />
        <TemplateField label="رسالة الإنذار" value={warning} onChange={setWarning} readyTemplate={READY_EGYPTIAN.warning} />
        <TemplateField label="رسالة الترقية" value={promotion} onChange={setPromotion} readyTemplate={READY_EGYPTIAN.promotion} />
        <TemplateField label="رسالة QR للطالب" value={qrMessage} onChange={setQrMessage} readyTemplate={READY_EGYPTIAN.qrMessage} bricks={[['اسم الطالب', '{studentName}'], ['رابط البوابة', '{link}']]} hint="لو {link} مش موجودة في القالب هتُضاف تلقائيًا في آخر الرسالة." />
        <TemplateField label="قالب تقرير الطابور" value={reportTemplate} onChange={setReportTemplate} readyTemplate={READY_EGYPTIAN.reportTemplate} />
        <button className="w-full btn-glow font-bold py-3 rounded-xl text-sm">
          حفظ القوالب
        </button>
      </form>
    </Modal>
  )
}

function TemplateField({ label, value, onChange, bricks = [], hint, placeholder, readyTemplate }) {
  // Two-tap replace: an empty field fills immediately; a written field asks
  // for a second confirming tap so nobody loses typed work by accident.
  const [armed, setArmed] = useState(false)
  const addBrick = (brick) => onChange(`${value || ''}${value && !value.endsWith(' ') ? ' ' : ''}${brick}`)
  const applyReady = () => {
    if (!value || armed) {
      onChange(readyTemplate)
      setArmed(false)
    } else {
      setArmed(true)
    }
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="block text-sm text-fg-subtle">{label}</label>
        {readyTemplate && (
          <button
            type="button"
            onClick={applyReady}
            onBlur={() => setArmed(false)}
            aria-pressed={armed}
            title="يكتب قالبًا مصريًا جاهزًا للإرسال في الخانة"
            className={armed
              ? 'rounded-full px-2.5 py-1 text-[11px] font-extrabold bg-brand-gold text-nk-navy border border-brand-gold'
              : 'rounded-full border border-brand-gold/40 bg-brand-gold/10 px-2.5 py-1 text-[11px] font-extrabold text-brand-gold-hover hover:bg-brand-gold/20'}
          >
            {armed ? 'متأكد؟ اضغط تاني للاستبدال' : '✨ قالب مصري جاهز'}
          </button>
        )}
      </div>
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
