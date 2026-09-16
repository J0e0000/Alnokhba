import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { SkeletonList } from './Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

export default function ExamsListModal({ open, onClose }) {
  const { showToast } = useToast()
  const { effectiveTeacherId } = useAuth()
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmId, setConfirmId] = useState(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    // Defense-in-depth (migration_019): scope by teacher_id in addition to RLS.
    // If effectiveTeacherId is null we return nothing rather than fall back
    // to an unscoped query.
    if (!effectiveTeacherId) {
      setExams([])
      setLoading(false)
      return
    }
    Promise.all([
      supabase.from('exams').select('*').eq('teacher_id', effectiveTeacherId).order('created_at', { ascending: false }),
      supabase.from('exam_scores').select('exam_id, total_score').eq('teacher_id', effectiveTeacherId),
    ]).then(([{ data: examRows }, { data: scoreRows }]) => {
      const byExam = {}
      ;(scoreRows ?? []).forEach((r) => {
        if (!byExam[r.exam_id]) byExam[r.exam_id] = []
        byExam[r.exam_id].push(r.total_score)
      })
      const merged = (examRows ?? []).map((e) => {
        const scores = byExam[e.id] || []
        const max = e.max_score_per_section * e.sections.length
        const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
        return { ...e, count: scores.length, avgPct: max > 0 ? Math.round((avg / max) * 100) : 0 }
      })
      setExams(merged)
      setLoading(false)
    })
  }, [open, effectiveTeacherId])

  const deleteExam = async () => {
    await supabase.from('exams').delete().eq('id', confirmId)
    setExams((prev) => prev.filter((e) => e.id !== confirmId))
    setConfirmId(null)
    showToast('اتحذف الامتحان', 'success')
  }

  return (
    <Modal open={open} onClose={onClose} title="كل الامتحانات" wide>
      {loading ? (
        <SkeletonList rows={4} />
      ) : exams.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-3xl mb-2">📝</div>
          <p className="text-fg-subtle text-sm">لسه مفيش امتحانات مرصودة.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {exams.map((e) => (
            <div key={e.id} className="glass-input border border-subtle rounded-lg p-3 flex flex-wrap justify-between items-center gap-2">
              <div>
                <p className="font-bold text-brand-gold-hover">{e.title}</p>
                <p className="text-xs text-fg-subtle">
                  {new Date(e.created_at).toLocaleDateString('ar-EG')} · {e.sections.join('، ')} · العظمى {e.max_score_per_section} لكل قسم
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-lg font-black text-brand-gold-hover">{e.avgPct}%</p>
                  <p className="text-[10px] text-fg-subtle">متوسط ({e.count} طالب)</p>
                </div>
                <button onClick={() => setConfirmId(e.id)} title="حذف الامتحان" className="text-rose-400 hover:text-rose-300 text-sm">🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmId} title="حذف الامتحان" danger confirmLabel="حذف نهائي"
        message="هيتحذف الامتحان ده وكل درجات الطلاب فيه نهائيًا."
        onConfirm={deleteExam} onCancel={() => setConfirmId(null)}
      />
    </Modal>
  )
}
