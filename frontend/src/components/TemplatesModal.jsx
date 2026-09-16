import { useEffect, useState } from 'react'
import Modal from './Modal'

export default function TemplatesModal({ open, onClose, settings, onSave }) {
  const [welcome, setWelcome] = useState('')
  const [warning, setWarning] = useState('')
  const [promotion, setPromotion] = useState('')
  const [qrMessage, setQrMessage] = useState('')
  const [reportTemplate, setReportTemplate] = useState('')

  useEffect(() => {
    if (settings) {
      setWelcome(settings.msg_welcome || '')
      setWarning(settings.msg_warning || '')
      setPromotion(settings.msg_promotion || '')
      setQrMessage(settings.qr_message_template || '')
      setReportTemplate(settings.msg_report_template || '')
    }
  }, [settings, open])

  const submit = (e) => {
    e.preventDefault()
    onSave({ msg_welcome: welcome, msg_warning: warning, msg_promotion: promotion, qr_message_template: qrMessage, msg_report_template: reportTemplate })
  }

  return (
    <Modal open={open} onClose={onClose} title="قوالب رسائل واتساب">
      <p className="text-fg-subtle text-xs mb-3">
        استخدم اللبنات الجاهزة أو اكتبها يدويًا: <code dir="ltr">{'{studentName}'}</code> و <code dir="ltr">{'{examScore}'}</code> و <code dir="ltr">{'{examMaxScore}'}</code> و <code dir="ltr">{'{report}'}</code> وهيتم استبدالهم تلقائيًا.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <TemplateField label="رسالة الترحيب" value={welcome} onChange={setWelcome} />
        <TemplateField label="رسالة الإنذار" value={warning} onChange={setWarning} />
        <TemplateField label="رسالة الترقية" value={promotion} onChange={setPromotion} />
        <TemplateField label="رسالة QR للطالب" value={qrMessage} onChange={setQrMessage} />
        <TemplateField label="قالب تقرير الطابور" value={reportTemplate} onChange={setReportTemplate} />
        <button className="w-full btn-glow font-bold py-3 rounded-xl text-sm">
          حفظ القوالب
        </button>
      </form>
    </Modal>
  )
}

function TemplateField({ label, value, onChange }) {
  const reportBricks = [
    ['اسم الطالب', '{studentName}'],
    ['عنوان الامتحان', '{examTitle}'],
    ['درجة الامتحان', '{examScore}'],
    ['من الدرجة', '{examMaxScore}'],
    ['النسبة', '{examPercentage}%'],
    ['الحضور', '{attendance}'],
    ['الواجب', '{homework}'],
    ['التقرير الكامل', '{report}'],
  ]
  const addBrick = (brick) => onChange(`${value || ''}${value && !value.endsWith(' ') ? ' ' : ''}${brick}`)
  return (
    <div>
      <label className="block text-sm text-fg-subtle mb-1">{label}</label>
      {label === 'قالب تقرير الطابور' && (
        <div className="flex flex-wrap gap-1.5 mb-2" aria-label="لبنات رسالة التقرير">
          {reportBricks.map(([name, brick]) => (
            <button key={brick} type="button" onClick={() => addBrick(brick)} className="rounded-full border border-brand-gold/30 bg-brand-gold/10 px-2 py-1 text-[11px] text-brand-gold-hover hover:bg-brand-gold/20">
              + {name}
            </button>
          ))}
        </div>
      )}
      <textarea
        rows={3} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold"
      />
    </div>
  )
}
