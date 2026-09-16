import { useState } from 'react'
import Modal from './Modal'
import { generateCertificate, downloadPDF } from '../lib/pdfGenerator'
import { useToast } from '../context/ToastContext'

const ACHIEVEMENTS = [
  'تفوق أكاديمي متميز',
  'حضور منتظم مثالي',
  'تحسن ملحوظ في الأداء',
  'مشاركة فعّالة في الدروس',
  'التزام عالي بالسلوك',
  'إنجاز متميز في المشروع',
  'قيادة وتعاون مع الزملاء',
]

export default function CertificateGeneratorModal({ open, onClose, student, teacherName }) {
  const { showToast } = useToast()
  const [selectedAchievement, setSelectedAchievement] = useState('')
  const [customAchievement, setCustomAchievement] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGenerate = async () => {
    try {
      setLoading(true)
      const achievement = customAchievement || selectedAchievement
      if (!achievement) {
        showToast('يرجى اختيار أو كتابة إنجاز', 'error')
        return
      }

      const doc = await generateCertificate(
        student.name,
        achievement,
        teacherName,
        new Date().toLocaleDateString('ar-EG')
      )

      downloadPDF(doc, `certificate_${student.name}.pdf`)
      showToast('تم تحميل الشهادة بنجاح', 'success')
      onClose()
    } catch (error) {
      console.error('Certificate generation error:', error)
      showToast('حدث خطأ أثناء إنشاء الشهادة', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="إنشاء شهادة تقدير">
      <div className="space-y-4">
        <div>
          <p className="text-sm text-outline mb-2">الطالب: <span className="font-bold">{student?.name}</span></p>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">الإنجاز</label>
          <select
            value={selectedAchievement}
            onChange={(e) => {
              setSelectedAchievement(e.target.value)
              setCustomAchievement('')
            }}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
          >
            <option value="">اختر إنجازاً</option>
            {ACHIEVEMENTS.map((ach) => (
              <option key={ach} value={ach}>{ach}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">أو أضف إنجازاً مخصصاً</label>
          <textarea
            value={customAchievement}
            onChange={(e) => {
              setCustomAchievement(e.target.value)
              setSelectedAchievement('')
            }}
            placeholder="أكتب الإنجاز هنا..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
            rows="3"
          />
        </div>

        <div className="flex gap-3 pt-4">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex-1 bg-brand-gold hover:bg-brand-gold-hover text-brand-navy disabled:opacity-50 font-bold py-2 rounded-lg transition-all text-sm"
          >
            {loading ? 'جاري الإنشاء...' : 'إنشاء الشهادة'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2 rounded-lg transition-all text-sm"
          >
            إلغاء
          </button>
        </div>
      </div>
    </Modal>
  )
}
