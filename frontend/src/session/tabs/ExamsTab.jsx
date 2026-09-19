import { useMemo, useState } from 'react'
import { useWorkspace, normalizeArabicSearch } from '../../store/WorkspaceStore'
import { usePublishBar } from '../WorkflowBar'

// ═══════════════════════════════════════════════════════════════════════════
// EXAMS / GRADES TAB (rule 12)
// Two operations are kept STRICTLY separate:
//   A) Change exam maximum score  → rpc update_exam_max_score (never rescales
//      stored student scores — 32 stays 32 when the max goes 40 → 50)
//   B) Change individual student score → rpc update_student_exam_score
// Absent students: excluded from the default grading list (PRESENT filter),
// never graded, never penalized — same server rule as production.
// ═══════════════════════════════════════════════════════════════════════════

export default function ExamsTab({ groupId, lessonId, lessonOpen, missingFocus, onBar, onAdvance, missingCount, onGoPrev }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [view, setView] = useState('list') // list | setup | grade
  const [setup, setSetup] = useState(null)

  const sessionExams = useMemo(
    () => ws.examsList.filter((e) => e.lesson_session_id === lessonId),
    [ws.examsList, lessonId],
  )

  // Persistent workflow bar — only on the exams home view (setup / grade
  // sub-flows carry their own actions → bar hidden, state-based interface).
  const barData = view === 'list' ? {
    ariaLabel: isArabic ? 'إجراءات الامتحانات' : 'Exams actions',
    primary: [{ key: 'next', kind: 'gold', label: isArabic ? 'التالي — المراجعة ←' : 'Next — Review →', disabled: !onAdvance }],
    secondary: [
      { key: 'prev', label: isArabic ? '→ السابق — التفاعل والواجب' : '← Previous — Interaction', disabled: !onGoPrev },
    ],
    meta: sessionExams.length === 0
      ? (isArabic ? 'الامتحانات اختيارية — تخطّيها لا يوقف المسار' : 'Exams are optional — skipping never blocks the pipeline')
      : missingCount > 0
        ? (isArabic ? `${missingCount} طالب لم تُرصد درجته` : `${missingCount} student(s) ungraded`)
        : '',
  } : null
  usePublishBar(onBar, barData, { next: () => onAdvance?.(), prev: () => onGoPrev?.() })

  if (!lessonOpen && sessionExams.length === 0) {
    return (
      <div className="nk-notice">
        {isArabic ? 'لا يوجد امتحان مرتبط بهذه الحصة والحصة منتهية — لا يمكن إضافة امتحان لحصة مغلقة.' : 'No exam linked to this completed session — exams cannot be added after closing.'}
      </div>
    )
  }

  if (view === 'setup') {
    return <ExamSetup setup={setup} setSetup={setSetup} onProceed={() => setView('grade')} onCancel={() => setView('list')} />
  }
  if (view === 'grade' && setup) {
    return (
      <GradeGrid
        setup={setup}
        groupId={groupId}
        lessonId={lessonId}
        onDone={(saved) => { setView('list'); if (saved) setSetup(null) }}
        onCancel={() => setView('setup')}
      />
    )
  }
  return (
    <div>
      {lessonOpen && (
        <button
          className="btn-gold action-button !min-h-[3rem] mb-4"
          onClick={() => { setSetup({ title: `امتحان ${new Date().toLocaleDateString('ar-EG')}`, sections: ['السؤال الأول', 'السؤال الثاني'], max: 20 }); setView('setup') }}
        >
          ＋ {isArabic ? 'امتحان جديد' : 'New exam'}
        </button>
      )}
      {sessionExams.length === 0 ? (
        <p className="text-center py-6 text-sm text-fg-muted">
          {isArabic ? 'لا يوجد امتحان مرتبط بهذه الحصة (اختياري).' : 'No exam linked to this session (optional).'}
        </p>
      ) : (
        <div className="grid gap-3">
          {sessionExams.map((exam) => <ExamCard key={exam.id} exam={exam} groupId={groupId} autoFilter={missingFocus ? 'ungraded' : null} />)}
        </div>
      )}
    </div>
  )
}

// ── Setup ────────────────────────────────────────────────────────────────────
function ExamSetup({ setup, setSetup, onProceed, onCancel }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [error, setError] = useState('')

  const proceed = () => {
    const sections = setup.sections.map((s) => s.trim()).filter(Boolean)
    const max = Number(setup.max)
    if (!setup.title.trim()) { setError(isArabic ? 'اكتب عنوان الامتحان' : 'Enter the exam title'); return }
    if (sections.length === 0) { setError(isArabic ? 'أضف قسمًا واحدًا على الأقل' : 'Add at least one section'); return }
    if (!Number.isFinite(max) || max <= 0) { setError(isArabic ? 'الدرجة النهائية لكل قسم غير صحيحة' : 'Invalid max score per section'); return }
    setSetup({ ...setup, sections, max })
    setError('')
    onProceed()
  }

  const setSection = (i, value) => {
    const next = [...setup.sections]; next[i] = value
    setSetup({ ...setup, sections: next })
  }

  return (
    <div>
      <div className="grid gap-3 max-w-xl">
        <label className="block">
          <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'عنوان الامتحان' : 'Exam title'}</span>
          <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={setup.title} onChange={(e) => setSetup({ ...setup, title: e.target.value })} />
        </label>
        <div>
          <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'أقسام الامتحان' : 'Sections'}</span>
          <div className="grid gap-2">
            {setup.sections.map((s, i) => (
              <div key={i} className="flex gap-2">
                <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm flex-1" value={s} onChange={(e) => setSection(i, e.target.value)} placeholder={`القسم ${i + 1}`} />
                {setup.sections.length > 1 && (
                  <button className="btn-ghost rounded-xl px-3 text-sm font-extrabold" onClick={() => setSetup({ ...setup, sections: setup.sections.filter((_, j) => j !== i) })}>✕</button>
                )}
              </div>
            ))}
          </div>
          <button
            className="btn-ghost rounded-xl px-4 py-2 text-[.75rem] font-extrabold mt-2"
            onClick={() => setSetup({ ...setup, sections: [...setup.sections, ''] })}
          >
            ＋ {isArabic ? 'قسم آخر' : 'Add section'}
          </button>
        </div>
        <label className="block max-w-[220px]">
          <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'الدرجة النهائية لكل قسم' : 'Max score per section'}</span>
          <input type="number" min="1" className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={setup.max} onChange={(e) => setSetup({ ...setup, max: e.target.value })} />
          <small className="block text-[.68rem] text-fg-muted mt-1">
            {isArabic ? `النهائي الكلي: ${Number(setup.max) * setup.sections.filter((s) => s.trim()).length || 0} درجة` : `Total: ${Number(setup.max) * setup.sections.filter((s) => s.trim()).length || 0}`}
          </small>
        </label>
        {error && <div className="nk-notice" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-strong)' }}>{error}</div>}
        <div className="flex gap-2">
          <button className="btn-navy action-button !min-h-[3rem]" onClick={proceed}>{isArabic ? 'التالي — رصد الدرجات' : 'Next — enter grades'}</button>
          <button className="btn-ghost action-button !min-h-[3rem]" onClick={onCancel}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Grading grid (new exam) ─────────────────────────────────────────────────
function GradeGrid({ setup, groupId, lessonId, onDone, onCancel }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('present') // present | absent | all | ungraded
  const [rows, setRows] = useState({}) // studentId → {sectionScores, total}
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const groupStudents = ws.sessionStudentsFor(groupId)
  const attendanceMap = ws.lessonAttendanceByStudent

  const statusOf = (s) => (attendanceMap[s.id]?.status || (lessonId ? 'لم يرصد' : s.attendance_status))
  const visible = useMemo(() => {
    const q = normalizeArabicSearch(search)
    return groupStudents.filter((s) => {
      const st = statusOf(s)
      if (filter === 'present' && st !== 'حاضر') return false
      if (filter === 'absent' && st !== 'غائب') return false
      if (filter === 'ungraded' && (st !== 'حاضر' || (rows[s.id] && Object.values(rows[s.id].sectionScores).some((v) => v !== '' && v != null)))) return false
      if (!q) return true
      return normalizeArabicSearch([s.name, s.code].filter(Boolean).join(' ')).includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupStudents, search, filter, attendanceMap, lessonId, rows])

  const setScore = (studentId, section, value) => {
    const max = Number(setup.max)
    let v = String(value).replace(/[^\d.]/g, '')
    if (v !== '' && Number(v) > max) v = String(max)
    setRows((prev) => {
      const row = { ...(prev[studentId] || { sectionScores: {}, total: 0 }) }
      const sectionScores = { ...row.sectionScores, [section]: v === '' ? '' : Number(v) }
      const total = Object.values(sectionScores).reduce((sum, x) => sum + (Number(x) || 0), 0)
      return { ...prev, [studentId]: { sectionScores, total } }
    })
  }

  const saveAll = async () => {
    const records = Object.entries(rows)
      .filter(([, r]) => Object.values(r.sectionScores).some((v) => v !== '' && v != null))
      .map(([studentId, r]) => ({
        studentId,
        sectionScores: Object.fromEntries(Object.entries(r.sectionScores).map(([k, v]) => [k, Number(v) || 0])),
        total: Number(r.total) || 0,
      }))
    for (const [, r] of Object.entries(rows)) {
      for (const v of Object.values(r.sectionScores)) {
        if (v !== '' && (Number(v) < 0 || Number(v) > Number(setup.max))) {
          setError(isArabic ? `درجة خارج النطاق (0 - ${setup.max})` : `Score out of range (0 - ${setup.max})`)
          return
        }
      }
    }
    if (records.length === 0) { setError(isArabic ? 'رصد درجة طالب واحد على الأقل' : 'Enter at least one student score'); return }
    setSaving(true); setError('')
    const ok = await ws.saveExam({ title: setup.title.trim(), sections: setup.sections, maxScorePerSection: Number(setup.max), records, lessonId })
    setSaving(false)
    if (ok) onDone(true)
  }

  const absentCount = groupStudents.filter((s) => statusOf(s) === 'غائب').length

  return (
    <div>
      <div className="nk-notice mb-4">
        {isArabic
          ? `الغائبون (${absentCount}) لا يظهرون في القائمة الافتراضية ولا ياخدوا درجات ولا خصوم.`
          : `Absent students (${absentCount}) are excluded by default — no grades, no penalties.`}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-[160px]" placeholder={isArabic ? '🔍 بحث...' : 'Search...'} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex rounded-xl overflow-hidden border border-subtle">
          {[['present', isArabic ? 'الحاضرون' : 'Present'], ['absent', isArabic ? 'الغائبون' : 'Absent'], ['ungraded', isArabic ? 'غير المرصدون' : 'Ungraded'], ['all', isArabic ? 'الكل' : 'All']].map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} className="px-3 py-2 text-[.72rem] font-extrabold"
              style={filter === key ? { background: 'var(--brand-navy)', color: '#fff' } : { background: 'var(--surface-container)', color: 'var(--fg-muted)' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        {visible.map((s) => {
          const row = rows[s.id]
          return (
            <div key={s.id} className="nk-row flex-col !items-stretch gap-2">
              <div className="flex items-center justify-between gap-2">
                <b className="truncate">{s.name}</b>
                <span className="nk-pill nk-pill-gold">{row?.total || 0} / {Number(setup.max) * setup.sections.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {setup.sections.map((section) => (
                  <label key={section} className="min-w-[110px] flex-1">
                    <small className="block text-[.64rem] text-fg-muted mb-1 truncate">{section}</small>
                    <input
                      type="number" min="0" max={setup.max} inputMode="decimal"
                      className="glass-input rounded-xl px-3 py-2 text-sm w-full"
                      value={row?.sectionScores?.[section] ?? ''}
                      onChange={(e) => setScore(s.id, section, e.target.value)}
                      disabled={statusOf(s) === 'غائب'}
                      aria-label={`${s.name} — ${section}`}
                    />
                  </label>
                ))}
              </div>
            </div>
          )
        })}
        {visible.length === 0 && <p className="text-center py-6 text-sm text-fg-muted">{isArabic ? 'لا نتائج' : 'No students'}</p>}
      </div>

      {error && <div className="nk-notice mt-3" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-strong)' }}>{error}</div>}

      <div className="flex flex-wrap gap-2 mt-5 pt-4" style={{ borderTop: '1px solid var(--surface-border)' }}>
        <button className="btn-gold action-button !min-h-[3rem]" disabled={saving} onClick={saveAll}>
          {saving ? '...' : `💾 ${isArabic ? 'حفظ الامتحان' : 'Save exam'}`}
        </button>
        <button className="btn-ghost action-button !min-h-[3rem]" onClick={onCancel}>{isArabic ? 'رجوع' : 'Back'}</button>
      </div>
    </div>
  )
}

// ── Existing exam card: A) max-score editor  B) per-student score editor ────
function ExamCard({ exam, groupId, autoFilter }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState(autoFilter === 'ungraded' ? 'ungraded' : 'present')
  const [maxDraft, setMaxDraft] = useState(null)
  const [scoreDrafts, setScoreDrafts] = useState({}) // scoreId → value
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const sections = exam.sections || []
  const maxTotal = Number(exam.max_score_per_section) * sections.length

  const groupStudents = ws.sessionStudentsFor(groupId)
  const attendanceMap = ws.lessonAttendanceByStudent

  const scores = useMemo(() => {
    const list = []
    Object.entries(ws.examScoresByStudent).forEach(([studentId, perStudent]) => perStudent.forEach((s) => {
      if (s.exam_id === exam.id) list.push({ ...s, student_id: s.student_id || studentId })
    }))
    return list
  }, [ws.examScoresByStudent, exam.id])
  const scoreByStudent = useMemo(() => Object.fromEntries(scores.map((s) => [s.student_id, s])), [scores])

  const statusOf = (s) => attendanceMap[s.id]?.status || s.attendance_status
  const visible = useMemo(() => {
    const q = normalizeArabicSearch(search)
    return groupStudents.filter((s) => {
      const st = statusOf(s)
      if (filter === 'present' && st !== 'حاضر') return false
      if (filter === 'absent' && st !== 'غائب') return false
      if (filter === 'graded' && !scoreByStudent[s.id]) return false
      if (filter === 'ungraded' && (scoreByStudent[s.id] || st !== 'حاضر')) return false
      if (!q) return true
      return normalizeArabicSearch([s.name, s.code].filter(Boolean).join(' ')).includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupStudents, search, filter, scoreByStudent, attendanceMap])

  const saveMax = async () => {
    const v = Number(maxDraft)
    if (!Number.isFinite(v) || v <= 0) { setMsg({ type: 'error', text: isArabic ? 'الدرجة النهائية غير صحيحة' : 'Invalid max score' }); return }
    setBusy(true)
    const { error } = await supabaseRpc('update_exam_max_score', { p_exam_id: exam.id, p_new_max: v, p_expected_version: exam.version ?? null })
    setBusy(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setMaxDraft(null); setMsg({ type: 'ok', text: isArabic ? 'تم تعديل النهائي — درجات الطلاب لم تتغير' : 'Max updated — student scores unchanged' })
    // PERF: targeted exam-tables refresh instead of the full 6-table loadAll.
    ws.refreshExamData({ immediate: true })
  }

  const saveStudentScore = async (scoreRow, studentName) => {
    const raw = scoreDrafts[scoreRow.id]
    if (raw === undefined) return
    const v = Number(raw)
    if (!Number.isFinite(v) || v < 0) { setMsg({ type: 'error', text: isArabic ? `درجة ${studentName} غير صحيحة` : `Invalid score for ${studentName}` }); return }
    setBusy(true)
    const { error } = await supabaseRpc('update_student_exam_score', { p_score_id: scoreRow.id, p_new_score: v, p_expected_version: scoreRow.version ?? null })
    setBusy(false)
    if (error) { setMsg({ type: 'error', text: `${studentName}: ${error.message}` }); return }
    setScoreDrafts((prev) => { const n = { ...prev }; delete n[scoreRow.id]; return n })
    setMsg({ type: 'ok', text: isArabic ? `تم تحديث درجة ${studentName}` : `Score updated for ${studentName}` })
    // PERF: targeted exam-tables refresh instead of the full 6-table loadAll.
    ws.refreshExamData({ immediate: true })
  }

  return (
    <div className="rounded-2xl border border-subtle overflow-hidden" style={{ background: 'var(--surface-container)' }}>
      <button className="flex items-center justify-between gap-3 w-full p-4 text-right" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="min-w-0">
          <b className="block text-[.86rem] truncate">{exam.title}</b>
          <small className="text-[.68rem] text-fg-muted">
            {isArabic ? 'النهائي' : 'Max'}: {maxTotal} · {isArabic ? 'الأقسام' : 'Sections'}: {sections.length} · {isArabic ? 'المرصدون' : 'Graded'}: {scores.length}
          </small>
        </span>
        <span aria-hidden="true" className="text-fg-muted">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="p-4 pt-0">
          {msg && (
            <div className={`nk-notice mb-3`} style={msg.type === 'error'
              ? { background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-strong)' }
              : { background: 'var(--ok-bg)', borderColor: 'var(--ok-border)', color: 'var(--ok-strong)' }}>
              {msg.text}
            </div>
          )}

          {/* A) EXAM MAXIMUM SCORE — separate operation (rule 12) */}
          <div className="rounded-xl p-3 mb-4" style={{ background: 'var(--brand-gold-surface)', border: '1px solid color-mix(in srgb, var(--brand-gold) 30%, transparent)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[.72rem] font-extrabold" style={{ color: 'var(--brand-gold)' }}>
                أ · {isArabic ? 'تعديل الدرجة النهائية للامتحان' : 'A · Change exam maximum'}
              </span>
              {maxDraft === null ? (
                <button className="btn-ghost rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold" onClick={() => setMaxDraft(maxTotal)}>
                  ✎ {isArabic ? 'تعديل' : 'Edit'} ({maxTotal})
                </button>
              ) : (
                <>
                  <input type="number" min="1" className="glass-input rounded-lg px-3 py-1.5 text-sm w-24" value={maxDraft} onChange={(e) => setMaxDraft(e.target.value)} aria-label={isArabic ? 'الدرجة النهائية الجديدة' : 'New max score'} />
                  <button className="btn-gold rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold" disabled={busy} onClick={saveMax}>{isArabic ? 'حفظ النهائي' : 'Save max'}</button>
                  <button className="btn-ghost rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold" onClick={() => setMaxDraft(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                </>
              )}
            </div>
            <small className="block text-[.64rem] text-fg-muted mt-1.5">
              {isArabic ? 'تعديل النهائي لا يغير درجات الطلاب المحفوظة (32 تبقى 32).' : 'Changing the max never rescales saved student scores (32 stays 32).'}
            </small>
          </div>

          {/* B) INDIVIDUAL STUDENT SCORES */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-[.72rem] font-extrabold" style={{ color: 'var(--accent-blue)' }}>ب · {isArabic ? 'تعديل درجة طالب' : 'B · Student scores'}</span>
            <input className="glass-input rounded-xl px-3 py-2 text-sm flex-1 min-w-[150px]" placeholder={isArabic ? '🔍 بحث...' : 'Search...'} value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="flex rounded-xl overflow-hidden border border-subtle">
              {[['present', isArabic ? 'الحاضرون' : 'Present'], ['absent', isArabic ? 'الغائبون' : 'Absent'], ['graded', isArabic ? 'المرصدون' : 'Graded'], ['ungraded', isArabic ? 'غير المرصدون' : 'Ungraded'], ['all', isArabic ? 'الكل' : 'All']].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} className="px-2.5 py-2 text-[.68rem] font-extrabold"
                  style={filter === key ? { background: 'var(--brand-navy)', color: '#fff' } : { background: 'var(--surface-container)', color: 'var(--fg-muted)' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            {visible.map((s) => {
              const score = scoreByStudent[s.id]
              const st = statusOf(s)
              const draft = score ? scoreDrafts[score.id] : undefined
              return (
                <div key={s.id} className="nk-row">
                  <span className="min-w-0">
                    <b className="truncate">{s.name}</b>
                    <small>{score ? `${score.total_score} / ${maxTotal}` : st === 'غائب' ? (isArabic ? 'غائب — بدون درجة' : 'Absent — no grade') : (isArabic ? 'لم يُرصد' : 'Not graded')}</small>
                  </span>
                  {score && (
                    <span className="flex items-center gap-1.5">
                      <input
                        type="number" min="0" max={maxTotal} inputMode="decimal"
                        className="glass-input rounded-lg px-2.5 py-1.5 text-sm w-20"
                        value={draft ?? score.total_score}
                        onChange={(e) => setScoreDrafts((prev) => ({ ...prev, [score.id]: e.target.value }))}
                        aria-label={`${s.name} score`}
                      />
                      <button
                        className="btn-navy rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold"
                        disabled={busy || draft === undefined || Number(draft) === Number(score.total_score)}
                        onClick={() => saveStudentScore(score, s.name)}
                      >
                        {isArabic ? 'حفظ' : 'Save'}
                      </button>
                    </span>
                  )}
                  {!score && st !== 'غائب' && <span className="nk-pill nk-pill-neutral">{isArabic ? 'لم يُرصد' : '—'}</span>}
                  {!score && st === 'غائب' && <span className="nk-pill nk-pill-danger">{isArabic ? 'غائب' : 'Absent'}</span>}
                </div>
              )
            })}
            {visible.length === 0 && <p className="text-center py-4 text-sm text-fg-muted">{isArabic ? 'لا نتائج' : 'No students'}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// thin wrapper so the card stays declarative
async function supabaseRpc(name, args) {
  const { supabase } = await import('../../lib/supabaseClient')
  return supabase.rpc(name, args)
}
void supabaseRpc

