import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { SkeletonList } from './Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { pingPortalRefresh } from '../lib/portalRealtime'

// ============================================================================
// كل الامتحانات — واجهة رصد وتعديل الدرجات (Round 8)
// ----------------------------------------------------------------------------
// عمليتان منفصلتان تمامًا (كل واحدة بصلاحية وسجل تدقيق مستقل):
//   A) ✏️ تعديل الدرجة العظمى للامتحان كله          → update_exam_max_score
//      (درجات الطلاب المسجلة مبتتغيرش — 32/40 تبقى 32/50)
//   B) ✏️ تعديل درجة طالب واحد بس                    → update_student_exam_score
//      (الباقي والدرجة العظمى مبيتأثروش؛ الغايب مياخدش درجة عادية)
// التعديلين بيتموا inline من غير شاشات حاجزة، وبيظهروا فورًا بعد تأكيد
// السيرفر + toast خفيف. لو درجة اتعدلت من جهاز تاني في نفس اللحظة،
// التعديل القديم بيرفض برسالة واضحة والبيانات بتتحدث من السيرفر.
// ============================================================================

const fmt = (n) => { const v = Number(n ?? 0); return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0 }

const CONFLICT_TAG = '[CONFLICT]'

const cleanRpcError = (error) => {
  const message = String(error?.message || error || 'حدث خطأ غير متوقع')
  const isConflict = message.includes(CONFLICT_TAG)
  return { isConflict, message: message.replace(CONFLICT_TAG, '').trim() }
}

export default function ExamsListModal({ open, onClose }) {
  const { showToast } = useToast()
  const { effectiveTeacherId, user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [exams, setExams] = useState([])
  const [scoresByExam, setScoresByExam] = useState({})
  const [absentByExam, setAbsentByExam] = useState({})
  const [confirmId, setConfirmId] = useState(null)
  const [expandedScores, setExpandedScores] = useState(null)
  const [expandedAudit, setExpandedAudit] = useState(null)
  const [auditByExam, setAuditByExam] = useState({})
  const [auditLoading, setAuditLoading] = useState(false)
  const [loadingExamIds, setLoadingExamIds] = useState(() => new Set())

  // ── inline editors (بدون شاشات حاجزة) ──
  const [maxEdit, setMaxEdit] = useState(null) // { examId, value }
  const [scoreEdit, setScoreEdit] = useState(null) // { scoreId, examId, value }
  const [savingMax, setSavingMax] = useState(false)
  const [savingScore, setSavingScore] = useState(false)
  const reloadTimer = useRef(null)

  // ── تحميل البيانات المرجعية من السيرفر (مصدر الحقيقة الوحيد) ──
  const load = useCallback(async () => {
    if (!effectiveTeacherId) { setExams([]); setScoresByExam({}); setAbsentByExam({}); setLoading(false); return }
    try {
      const [examsRes, scoresRes, attendanceRes] = await Promise.all([
        supabase.from('exams').select('id, teacher_id, title, sections, max_score_per_section, lesson_session_id, created_at, version, updated_at').eq('teacher_id', effectiveTeacherId).order('created_at', { ascending: false }),
        supabase.from('exam_scores').select('id, exam_id, student_id, students(name), section_scores, total_score, created_at, version, updated_at').eq('teacher_id', effectiveTeacherId),
        supabase.from('attendance_records').select('student_id, status, recorded_at, lesson_session_id').eq('teacher_id', effectiveTeacherId).order('recorded_at', { ascending: false }).limit(5000),
      ])
      const examRows = examsRes.data ?? []
      const scoreRows = scoresRes.data ?? []
      const attendanceRows = attendanceRes.data ?? []

      // خريطة الغياب: (أ) حضور الحصة المرتبطة بالامتحان، (ب) أي رصد في نفس يوم الامتحان
      const lessonAtt = {}
      const dayAtt = {}
      attendanceRows.forEach((row) => {
        const day = (row.recorded_at || '').slice(0, 10)
        if (row.lesson_session_id) {
          lessonAtt[row.lesson_session_id] ||= {}
          if (!lessonAtt[row.lesson_session_id][row.student_id]) lessonAtt[row.lesson_session_id][row.student_id] = row.status
        }
        if (!dayAtt[day]) dayAtt[day] = {}
        if (!dayAtt[day][row.student_id]) dayAtt[day][row.student_id] = row.status
      })

      const byExam = {}
      const absentMap = {}
      scoreRows.forEach((row) => {
        const exam = examRows.find((e) => e.id === row.exam_id)
        const studentName = row.students?.name || 'طالب'
        byExam[row.exam_id] ||= []
        byExam[row.exam_id].push({
          id: row.id, student_id: row.student_id, student_name: studentName,
          section_scores: row.section_scores, total_score: row.total_score,
          version: row.version, created_at: row.created_at,
        })
        if (exam) {
          const status = (exam.lesson_session_id && lessonAtt[exam.lesson_session_id]?.[row.student_id])
            || dayAtt[(exam.created_at || '').slice(0, 10)]?.[row.student_id]
          if (status === 'غائب') {
            if (!absentMap[row.exam_id]) absentMap[row.exam_id] = new Set()
            absentMap[row.exam_id].add(row.student_id)
          }
        }
      })
      // ترتيب أبجدي مع الغايبين في الآخر
      Object.entries(byExam).forEach(([examId, list]) => {
        const abs = absentMap[examId] || new Set()
        list.sort((a, b) => {
          const aAbs = abs.has(a.student_id) ? 1 : 0
          const bAbs = abs.has(b.student_id) ? 1 : 0
          if (aAbs !== bAbs) return aAbs - bAbs
          return String(a.student_name).localeCompare(String(b.student_name), 'ar')
        })
      })

      setExams(examRows)
      setScoresByExam(byExam)
      setAbsentByExam(absentMap)
      setLoadingExamIds(new Set())
    } catch (err) {
      console.error('Load exams failed:', err)
      showToast('تعذر تحميل الامتحانات — جرب تاني', 'error')
    } finally {
      setLoading(false)
    }
  }, [effectiveTeacherId, showToast])

  useEffect(() => { if (open) { setLoading(true); load() } }, [open, load])

  // ── Realtime: تعديل من جهاز تاني يظهر هنا فورًا (Round 7 pattern) ──
  useEffect(() => {
    if (!open || !effectiveTeacherId) return
    const channel = supabase
      .channel(`exams-list-${effectiveTeacherId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exams', filter: `teacher_id=eq.${effectiveTeacherId}` }, () => scheduleReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_scores', filter: `teacher_id=eq.${effectiveTeacherId}` }, () => scheduleReload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_score_audit_logs', filter: `teacher_id=eq.${effectiveTeacherId}` }, () => { if (expandedAudit) scheduleReload() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectiveTeacherId, expandedAudit])

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => { load() }, 350)
  }, [load])

  // ── العملية A: تعديل الدرجة العظمى للامتحان ──
  const startMaxEdit = (exam) => {
    setScoreEdit(null)
    setMaxEdit({ examId: exam.id, value: String(examTotalMax(exam)) })
  }

  const examTotalMax = (exam) => fmt((Number(exam?.max_score_per_section) || 0) * (exam?.sections?.length || 0))

  const saveMax = async (exam) => {
    if (!maxEdit || savingMax) return
    const raw = parseFloat(maxEdit.value)
    if (!Number.isFinite(raw) || raw <= 0) { showToast('الدرجة العظمى لازم تكون رقم أكبر من صفر', 'error'); return }
    const sectionsCount = exam.sections?.length || 0
    if (sectionsCount > 0 && Math.round(raw * 100) % (sectionsCount * 100) !== 0) {
      showToast(`الدرجة لازم تقبل القسمة على ${sectionsCount} أقسام (جرّب ${Math.round(raw / sectionsCount) * sectionsCount})`, 'error'); return
    }
    setSavingMax(true)
    try {
      const { data, error } = await supabase.rpc('update_exam_max_score', {
        p_exam_id: exam.id,
        p_new_max: raw,
        p_expected_version: exam.version ?? 1,
      })
      if (error) throw error
      // تحديث فوري من رد السيرفر — من غير إعادة تحميل الصفحة
      setExams((prev) => prev.map((e) => (e.id === exam.id
        ? { ...e, max_score_per_section: Number(data?.per_section ?? e.max_score_per_section), version: data?.version ?? e.version, updated_at: new Date().toISOString() }
        : e)))
      setMaxEdit(null)
      showToast(`الدرجة العظمى لـ «${exam.title}» اتحدثت لـ ${fmt(data?.new_max_total)} (${fmt(data?.per_section)} لكل قسم)`, 'success')
      scheduleReload() // مزامنة سريعة مع باقي الشاشات والبوابة
    } catch (error) {
      const { isConflict, message } = cleanRpcError(error)
      showToast(isConflict ? `${message}` : `تعذر تعديل الدرجة العظمى: ${message}`, isConflict ? 'info' : 'error')
      if (isConflict) { setMaxEdit(null); load() }
    } finally { setSavingMax(false) }
  }

  // ── العملية B: تعديل درجة طالب واحد ──
  const startScoreEdit = (row, examId) => {
    setMaxEdit(null)
    setScoreEdit({ scoreId: row.id, examId, value: String(fmt(row.total_score)) })
  }

  const saveScore = async (row, exam) => {
    if (!scoreEdit || savingScore) return
    const raw = parseFloat(scoreEdit.value)
    const maxTotal = examTotalMax(exam)
    if (!Number.isFinite(raw) || raw < 0) { showToast('الدرجة لازم تكون رقم موجب', 'error'); return }
    if (raw > maxTotal) { showToast(`الدرجة أكبر من العظمى (${maxTotal})`, 'error'); return }
    setSavingScore(true)
    try {
      const { data, error } = await supabase.rpc('update_student_exam_score', {
        p_score_id: row.id,
        p_new_score: raw,
        p_expected_version: row.version ?? 1,
      })
      if (error) throw error
      // تحديث فوري من رد السيرفر
      setScoresByExam((prev) => ({
        ...prev,
        [exam.id]: (prev[exam.id] || []).map((r) => (r.id === row.id
          ? { ...r, total_score: data?.total_score ?? raw, section_scores: data?.section_scores ?? r.section_scores, version: data?.version ?? r.version }
          : r)),
      }))
      setScoreEdit(null)
      const delta = Number(data?.points_delta ?? 0)
      const pointsNote = delta === 0 ? '' : ` (${delta > 0 ? '+' + delta : delta} نقطة)`
      showToast(`درجة ${row.student_name} اتحدثت لـ ${fmt(data?.total_score ?? raw)}/${maxTotal}${pointsNote}`, 'success')
      // سجل التعديل في نشاط الطالب (زي الرصد الأصلي بالظبط)
      try {
        await supabase.from('behavior_logs').insert({
          teacher_id: effectiveTeacherId,
          student_id: row.student_id,
          note: `تعديل درجة امتحان (${exam.title}): من ${fmt(row.total_score)} لـ ${fmt(data?.total_score ?? raw)} من ${maxTotal}`,
          points_delta: delta,
        })
      } catch { /* السجل التوضيحي مش شرط للنجاح */ }
      // بوابة الطالب بتتحدث لحظيًا (Round 7) — ping مباشر + realtime
      try { pingPortalRefresh(effectiveTeacherId, 'exam-score') } catch { /* polling covers it */ }
    } catch (error) {
      const { isConflict, message } = cleanRpcError(error)
      showToast(isConflict ? `${message}` : `تعذر تعديل الدرجة: ${message}`, isConflict ? 'info' : 'error')
      if (isConflict) { setScoreEdit(null); load() }
    } finally { setSavingScore(false) }
  }

  const deleteExam = async () => {
    const { error } = await supabase.from('exams').delete().eq('id', confirmId)
    if (error) { showToast(`تعذر حذف الامتحان: ${error.message || ''}`, 'error'); return }
    setExams((prev) => prev.filter((e) => e.id !== confirmId))
    setConfirmId(null)
    showToast('اتحذف الامتحان', 'success')
  }

  // ── سجل التعديلات (lazy) ──
  const toggleAudit = async (exam) => {
    if (expandedAudit === exam.id) { setExpandedAudit(null); return }
    setExpandedAudit(exam.id)
    if (!auditByExam[exam.id]) {
      setAuditLoading(true)
      try {
        const { data, error } = await supabase
          .from('exam_score_audit_logs')
          .select('change_type, student_id, previous_value, new_value, reason, actor_id, created_at, students(name)')
          .eq('exam_id', exam.id)
          .order('created_at', { ascending: false })
          .limit(30)
        if (error) throw error
        setAuditByExam((prev) => ({ ...prev, [exam.id]: data ?? [] }))
      } catch (err) {
        console.error('Audit load failed:', err)
        showToast('سجل التعديلات محتاج Migration 038 — شغّلها من مجلد supabase', 'info')
      } finally { setAuditLoading(false) }
    }
  }

  const myId = user?.id

  const auditLabel = (row) => {
    const prev = fmt(row.previous_value)
    const next = fmt(row.new_value)
    if (row.change_type === 'max_score') return `تعديل الدرجة العظمى: ${prev} → ${next}`
    const name = row.students?.name || 'طالب'
    return `تعديل درجة ${name}: ${prev} → ${next}`
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
        <div className="space-y-3">
          {exams.map((exam) => {
            const scores = scoresByExam[exam.id] || []
            const absentSet = absentByExam[exam.id] || new Set()
            const maxTotal = examTotalMax(exam)
            const perSection = fmt(exam.max_score_per_section)
            const totals = scores.map((r) => Number(r.total_score) || 0)
            const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0
            const avgPct = maxTotal > 0 ? Math.round((avg / maxTotal) * 100) : 0
            return (
              <div key={exam.id} className="glass-input border border-subtle rounded-xl p-3">
                <div className="flex flex-wrap justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-brand-gold-hover break-words">{exam.title}</p>
                    <p className="text-[11px] text-fg-subtle">
                      {new Date(exam.created_at).toLocaleDateString('ar-EG')} · {exam.sections?.join('، ')}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-black text-brand-gold-hover">{avgPct}%</p>
                    <p className="text-[10px] text-fg-subtle">متوسط ({scores.length} طالب)</p>
                  </div>
                </div>

                {/* ── الدرجة العظمى (العملية A — منفصلة تمامًا عن درجات الطلاب) ── */}
                {maxEdit?.examId === exam.id ? (
                  <div className="mt-2 pt-2 border-t border-subtle space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-fg-subtle">الدرجة العظمى الكلية:</span>
                      <input
                        type="number" dir="ltr" min="1" step="1" autoFocus
                        value={maxEdit.value}
                        onChange={(e) => setMaxEdit((p) => ({ ...p, value: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveMax(exam); if (e.key === 'Escape') setMaxEdit(null) }}
                        className="w-24 text-center glass-input border border-brand-gold/50 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-brand-gold"
                      />
                      <span className="text-[11px] text-fg-subtle">
                        ({fmt((parseFloat(maxEdit.value) || 0) / (exam.sections?.length || 1))} لكل قسم × {exam.sections?.length || 0})
                      </span>
                      <button onClick={() => saveMax(exam)} disabled={savingMax}
                        className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg disabled:opacity-40">
                        {savingMax ? '⏳' : '💾 حفظ'}
                      </button>
                      <button onClick={() => setMaxEdit(null)} className="text-xs glass-input border border-subtle px-2 py-1.5 rounded-lg text-fg-subtle hover:bg-white/10">✕</button>
                    </div>
                    <p className="text-[10px] text-fg-subtle">⚠️ درجات الطلاب المسجلة مش هتتغير — بس النسب والدرجات النهائية بتتحسب من العظمى الجديدة.</p>
                  </div>
                ) : (
                  <div className="mt-2 pt-2 border-t border-subtle flex items-center justify-between gap-2">
                    <p className="text-xs text-fg">
                      الدرجة العظمى: <b className="text-brand-gold-hover">{maxTotal}</b>
                      <span className="text-fg-subtle"> ({perSection} لكل قسم)</span>
                    </p>
                    <button onClick={() => startMaxEdit(exam)}
                      className="text-[11px] text-brand-gold-hover border border-brand-gold/40 hover:bg-brand-gold/10 rounded-lg px-2.5 py-1.5 transition-colors">
                      ✏️ تعديل العظمى
                    </button>
                  </div>
                )}

                <div className="flex gap-2 mt-2 flex-wrap">
                  <button onClick={() => { setExpandedScores(expandedScores === exam.id ? null : exam.id); setExpandedAudit(null) }}
                    className="text-xs glass-input border border-subtle rounded-lg px-3 py-1.5 text-fg-subtle hover:bg-white/10 transition-colors">
                    📋 الدرجات {scores.length > 0 ? `(${scores.length})` : ''}
                  </button>
                  <button onClick={() => toggleAudit(exam)}
                    className="text-xs glass-input border border-subtle rounded-lg px-3 py-1.5 text-fg-subtle hover:bg-white/10 transition-colors">
                    🧾 سجل التعديلات
                  </button>
                  <button onClick={() => setConfirmId(exam.id)} title="حذف الامتحان" className="text-rose-400 hover:text-rose-300 text-sm px-1">🗑️</button>
                </div>

                {/* ── درجات الطلاب (العملية B — كل طالب لوحده) ── */}
                {expandedScores === exam.id && (
                  <div className="mt-2 pt-2 border-t border-subtle">
                    {scores.length === 0 ? (
                      <p className="text-xs text-fg-subtle py-1">مفيش درجات مرصودة للامتحان ده.</p>
                    ) : (
                      <div className="divide-y divide-subtle/50">
                        {scores.map((row) => {
                          const absent = absentSet.has(row.student_id)
                          if (scoreEdit?.scoreId === row.id) {
                            return (
                              <div key={row.id} className="py-2 flex flex-wrap items-center gap-2">
                                <span className="font-bold text-sm text-fg">{row.student_name}</span>
                                <span className="text-[11px] text-fg-subtle">الحالية: {fmt(row.total_score)}</span>
                                <input
                                  type="number" dir="ltr" min="0" step="0.5" autoFocus
                                  value={scoreEdit.value}
                                  onChange={(e) => setScoreEdit((p) => ({ ...p, value: e.target.value }))}
                                  onKeyDown={(e) => { if (e.key === 'Enter') saveScore(row, exam); if (e.key === 'Escape') setScoreEdit(null) }}
                                  className="w-20 text-center glass-input border border-brand-gold/50 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-brand-gold"
                                />
                                <span className="text-xs text-fg-subtle">/ {maxTotal}</span>
                                <button onClick={() => saveScore(row, exam)} disabled={savingScore}
                                  className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg disabled:opacity-40">
                                  {savingScore ? '⏳' : '💾 حفظ'}
                                </button>
                                <button onClick={() => setScoreEdit(null)} className="text-xs glass-input border border-subtle px-2 py-1.5 rounded-lg text-fg-subtle hover:bg-white/10">✕</button>
                              </div>
                            )
                          }
                          return (
                            <div key={row.id} className="py-2 flex items-center justify-between gap-2">
                              <span className="font-bold text-sm text-fg min-w-0 truncate">{row.student_name}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                {absent && (
                                  <span title="الطالب غائب يوم الامتحان — مينفعش ياخد درجة عادية"
                                    className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/40 rounded-full px-2 py-0.5">غائب</span>
                                )}
                                <span className="font-black text-violet-400 text-sm">
                                  {fmt(row.total_score)}
                                  <span className="text-fg-subtle text-[11px] font-normal"> / {maxTotal}</span>
                                </span>
                                <button
                                  onClick={() => startScoreEdit(row, exam.id)}
                                  disabled={absent}
                                  title={absent ? 'الطالب غائب — علّمه حاضر الأول' : 'تعديل درجة الطالب ده بس'}
                                  className={`text-[11px] rounded-lg px-2 py-1.5 transition-colors ${absent
                                    ? 'text-fg-subtle/40 border border-subtle/50 cursor-not-allowed'
                                    : 'text-brand-gold-hover border border-brand-gold/40 hover:bg-brand-gold/10'}`}>
                                  ✏️ تعديل
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    <p className="text-[10px] text-fg-subtle mt-1.5">💡 تعديل درجة طالب واحد مبيأثرش على باقي الطلاب ولا على الدرجة العظمى.</p>
                  </div>
                )}

                {/* ── سجل التعديلات (تدقيق append-only) ── */}
                {expandedAudit === exam.id && (
                  <div className="mt-2 pt-2 border-t border-subtle">
                    {auditLoading && !auditByExam[exam.id] ? (
                      <p className="text-xs text-fg-subtle">⏳ جاري التحميل...</p>
                    ) : (auditByExam[exam.id] || []).length === 0 ? (
                      <p className="text-xs text-fg-subtle">مفيش تعديلات مسجلة على الامتحان ده.</p>
                    ) : (
                      <div className="space-y-1">
                        {(auditByExam[exam.id] || []).map((row, i) => (
                          <p key={i} className="text-[11px] text-fg-subtle">
                            <span className="text-fg">🧾 {auditLabel(row)}</span>
                            {' '}· {row.actor_id === myId ? 'أنت' : (row.actor_id ? String(row.actor_id).slice(0, 8) : 'النظام')}
                            {' '}· {new Date(row.created_at).toLocaleString('ar-EG')}
                            {row.reason ? ` · السبب: ${row.reason}` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
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
