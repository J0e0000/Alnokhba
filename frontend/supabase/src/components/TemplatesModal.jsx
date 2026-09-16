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
        استخدم <code dir="ltr">{'{studentName}'}</code> و <code dir="ltr">{'{rank}'}</code> و <code dir="ltr">{'{link}'}</code> و <code dir="ltr">{'{report}'}</code> وهيتم استبدالهم تلقائيًا.
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
  return (
    <div>
      <label className="block text-sm text-fg-subtle mb-1">{label}</label>
      <textarea
        rows={3} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold"
      />
    </div>
  )
}
