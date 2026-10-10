import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useWorkspace, normalizeArabicSearch } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import useIsMobile from '../shell/useIsMobile'
import { DEFAULT_GRADE_SCALE, normalizeGradeScale, gradeOf } from '../lib/helpers'
import { printExamReport } from './printExam'

// ═══════════════════════════════════════════════════════════════════════════
// EXAM WORKSPACE — الامتحان المنفصل (نفس فكرة الحصص بنفس الشكل، لكن للامتحانات فقط)
//   • اللي امتحن هو اللي حضر: اللي بيسجل الدرجات يسجل علطول — كل درجة تتحفظ
//     فورًا (upsert) من غير حضور ولا ربط بحصة.
//   • سلم تقديرات قابل للتعديل بالكامل (الاسم + الحد + العدد) — نسب مئوية من
//     الدرجة النهائية، والتقدير بيظهر جنب كل درجة علطول.
//   • نفس الهيكل البصري لمساحة الحصة: nk-ws-head + ملخص مصغّر + صفوف nk-row.
// ═══════════════════════════════════════════════════════════════════════════

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const AR_DATE_FMT = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })

// ألوان التقديرات — بحُسب الدلالة (ممتاز أخضر، جيد أزرق، مقبول دهبي، ضعيف أحمر)
const gradeColor = (name) => {
  const n = String(name || '')
  if (/ممتاز|امتياز|excel/i.test(n)) return { bg: 'var(--ok-bg)', border: 'var(--ok-border)', fg: 'var(--ok-strong)' }
  if (/جيد|good/i.test(n)) return { bg: 'var(--info-bg)', border: 'var(--info-border)', fg: 'var(--info-strong)' }
  if (/مقبول|متوسط|pass/i.test(n)) return { bg: 'var(--brand-gold-surface)', border: 'color-mix(in srgb, var(--brand-gold) 40%, transparent)', fg: 'var(--brand-gold)' }
  return { bg: 'var(--danger-bg)', border: 'var(--danger-border)', fg: 'var(--danger-strong)' }
}

export default function ExamWorkspace({ params }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const isNew = params?.examId === 'new'
  const exam = useMemo(
    () => ws.standaloneExams.find((e) => e.id === params?.examId) || null,
    [ws.standaloneExams, params?.examId],
  )

  // إنشاء جديد → شاشة الإعداد؛ امتحان محفوظ → مساحة الرصد
  if (isNew) {
    return <ExamSetup onCreated={(created) => { if (created?.id) ui.openExam({ examId: created.id }) }} onCancel={ui.closeExam} />
  }
  if (!exam) {
    return (
      <div className="nk-content text-center py-12">
        <p className="font-extrabold mb-3">{isArabic ? 'الامتحان غير موجود أو تم حذفه' : 'Exam not found'}</p>
        <button className="btn-navy action-button !min-h-[3rem]" onClick={ui.closeExam}>{isArabic ? 'العودة للرئيسية' : 'Back home'}</button>
      </div>
    )
  }
  return <ExamGrading exam={exam} />
}

// ── الإعداد: نفس فكرة إعداد امتحان الحصة — عنوان/تاريخ/مجموعة/نهائي + السلم ──
function ExamSetup({ onCreated, onCancel }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [title, setTitle] = useState(`امتحان ${AR_DATE_FMT.format(new Date())}`)
  const [examDate, setExamDate] = useState(todayISO())
  const [groupName, setGroupName] = useState('')
  const [maxScore, setMaxScore] = useState('100')
  const [scale, setScale] = useState(() => [...DEFAULT_GRADE_SCALE])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const groupsList = ws.groups || []
  const groupStudents = useMemo(
    () => (groupName ? ws.students.filter((s) => s.group_name === groupName) : ws.students),
    [ws.students, groupName],
  )

  const proceed = async () => {
    const max = Number(maxScore)
    if (!title.trim()) { setError(isArabic ? 'اكتب عنوان الامتحان' : 'Enter the exam title'); return }
    if (!Number.isFinite(max) || max <= 0) { setError(isArabic ? 'الدرجة النهائية غير صحيحة' : 'Invalid max score'); return }
    const cleanScale = normalizeGradeScale(scale)
    setError('')
    setBusy(true)
    const created = await ws.createStandaloneExam({
      title, exam_date: examDate || todayISO(), group_name: groupName || null, max_score: max, grade_scale: cleanScale, records: [],
    })
    setBusy(false)
    if (created) onCreated(created)
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="nk-ws-head">
        <button className="nk-pill nk-pill-gold mb-2 cursor-pointer border-0" onClick={onCancel}>
          → {isArabic ? 'الرئيسية' : 'Home'}
        </button>
        <div className="nk-ws-muted text-[.62rem] font-black tracking-widest mb-1">EXAM WORKSPACE</div>
        <h2 className="text-[1.15rem] sm:text-[1.3rem] font-black m-0 leading-snug">{isArabic ? 'إنشاء امتحان منفصل' : 'Create standalone exam'}</h2>
        <p className="nk-ws-muted text-[.72rem] mt-1 mb-0">
          {isArabic ? 'امتحان مستقل عن الحصص — اللي امتحن هو اللي حضر، والدرجات بتتحفظ فورًا.' : 'Independent from sessions — whoever took the exam is present; scores save instantly.'}
        </p>
      </section>

      <section className="nk-content">
        <div className="grid gap-3 max-w-xl">
          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'عنوان الامتحان' : 'Exam title'}</span>
            <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'تاريخ الامتحان' : 'Exam date'}</span>
              <input type="date" className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'الدرجة النهائية' : 'Max score'}</span>
              <input type="number" min="1" inputMode="decimal" className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
            </label>
          </div>

          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'المجموعة (اختياري — للفلترة فقط)' : 'Group (optional — filter only)'}</span>
            <select className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={groupName} onChange={(e) => setGroupName(e.target.value)}>
              <option value="">{isArabic ? `كل الطلاب (${ws.students.length})` : `All students (${ws.students.length})`}</option>
              {groupsList.map((g) => (
                <option key={g} value={g}>{g} ({ws.students.filter((s) => s.group_name === g).length})</option>
              ))}
            </select>
            <small className="block text-[.68rem] text-fg-muted mt-1">
              {isArabic ? `هترصد درجات ${groupStudents.length} طالب — امتحن = حضر، مفيش حضور ولا ربط بحصة.` : `Grading ${groupStudents.length} students — taking the exam counts as present; no attendance, no session link.`}
            </small>
          </label>

          {/* سلم التقديرات — أسماء وحدود وعدد قابل للتعديل */}
          <GradeScaleEditor scale={scale} setScale={setScale} maxScore={Number(maxScore) || 0} isArabic={isArabic} />

          {error && <div className="nk-notice" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-strong)' }}>{error}</div>}

          <div className="flex gap-2">
            <button className="btn-navy action-button !min-h-[3rem]" disabled={busy} onClick={proceed}>
              {busy ? '...' : (isArabic ? 'إنشاء الامتحان والبدء في الرصد ←' : 'Create & start grading →')}
            </button>
            <button className="btn-ghost action-button !min-h-[3rem]" onClick={onCancel}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── محرر سلم التقديرات (يُستخدم في الإعداد وفي مساحة الرصد) ─────────────────
function GradeScaleEditor({ scale, setScale, maxScore, isArabic, compact }) {
  const rows = normalizeGradeScale(scale)
  const setRow = (i, key, value) => setScale((prev) => normalizeGradeScale(prev.map((g, j) => (j === i ? { ...g, [key]: value } : g))))
  const removeRow = (i) => setScale((prev) => normalizeGradeScale(prev.filter((_, j) => j !== i)))
  const addRow = () => setScale((prev) => normalizeGradeScale([...prev, { name: isArabic ? 'تقدير جديد' : 'New grade', min: 0 }]))
  const scoreFor = (min) => (maxScore > 0 ? Math.round((Number(min) / 100) * maxScore) : 0)

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--brand-gold-surface)', border: '1px solid color-mix(in srgb, var(--brand-gold) 30%, transparent)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[.75rem] font-extrabold" style={{ color: 'var(--brand-gold)' }}>
          {isArabic ? 'سلم التقديرات' : 'Grade scale'}
        </span>
        <button className="btn-ghost rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold" onClick={addRow}>
          ＋ {isArabic ? 'تقدير' : 'Add grade'}
        </button>
      </div>
      {!compact && (
        <small className="block text-[.64rem] text-fg-muted mb-2">
          {isArabic
            ? 'الحد الأدنى نسبة من الدرجة النهائية (ممتاز من 80 يعني 80% أو أكتر). التقدير الأول اللي يحققه الطالب هو تقديره.'
            : 'Min is a percentage of the max (80 means 80%+). The first satisfied row is the grade.'}
        </small>
      )}
      <div className="grid gap-1.5">
        {rows.map((g, i) => (
          <div key={`${g.name}-${i}`} className="flex items-center gap-2">
            <input
              className="glass-input rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-0"
              value={g.name}
              onChange={(e) => setRow(i, 'name', e.target.value)}
              aria-label={isArabic ? 'اسم التقدير' : 'Grade name'}
            />
            <span className="text-[.68rem] text-fg-muted whitespace-nowrap">{isArabic ? 'من' : '≥'}</span>
            <input
              type="number" min="0" max="100" inputMode="decimal"
              className="glass-input rounded-lg px-2.5 py-1.5 text-sm w-[76px]"
              value={g.min}
              onChange={(e) => setRow(i, 'min', e.target.value === '' ? 0 : Number(e.target.value))}
              aria-label={isArabic ? 'الحد الأدنى (نسبة مئوية)' : 'Minimum percent'}
            />
            <span className="text-[.68rem] text-fg-muted whitespace-nowrap">%</span>
            {maxScore > 0 && <span className="text-[.64rem] text-fg-muted whitespace-nowrap hidden sm:inline">({scoreFor(g.min)} {isArabic ? 'من' : 'of'} {maxScore})</span>}
            {rows.length > 1 && (
              <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.72rem] font-extrabold" onClick={() => removeRow(i)} aria-label={isArabic ? 'حذف التقدير' : 'Remove grade'}>✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── مساحة الرصد: نفس هيكل مساحة الحصة (هيدر + ملخص مصغّر + قائمة رصد) ───────
function ExamGrading({ exam }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const isMobile = useIsMobile()
  const [search, setSearch] = useState('')
  const [scaleOpen, setScaleOpen] = useState(false)
  const [scaleDraft, setScaleDraft] = useState(() => normalizeGradeScale(exam.grade_scale))
  const [editingMeta, setEditingMeta] = useState(false)
  const [titleDraft, setTitleDraft] = useState(exam.title)
  const [maxDraft, setMaxDraft] = useState(String(exam.max_score))
  const [busy, setBusy] = useState(false)

  const open = exam.status === 'open'

  // مزامنة الحقول لو الامتحان اتغير من جهاز تاني (realtime)
  useEffect(() => { setScaleDraft(normalizeGradeScale(exam.grade_scale)) }, [exam.grade_scale])
  useEffect(() => { setTitleDraft(exam.title); setMaxDraft(String(exam.max_score)) }, [exam.title, exam.max_score])

  const pool = useMemo(
    () => (exam.group_name ? ws.students.filter((s) => s.group_name === exam.group_name) : ws.students),
    [ws.students, exam.group_name],
  )
  const scoresByStudent = useMemo(() => {
    const map = {}
    ws.standaloneExamScores.forEach((r) => { if (r.exam_id === exam.id) map[r.student_id] = r })
    return map
  }, [ws.standaloneExamScores, exam.id])

  const graded = useMemo(
    () => pool.filter((s) => scoresByStudent[s.id] !== undefined).map((s) => ({ student: s, row: scoresByStudent[s.id] })),
    [pool, scoresByStudent],
  )

  const visible = useMemo(() => {
    const q = normalizeArabicSearch(search)
    if (!q) return pool
    return pool.filter((s) => normalizeArabicSearch([s.name, s.code].filter(Boolean).join(' ')).includes(q))
  }, [pool, search])

  const stats = useMemo(() => {
    const values = graded.map(({ row }) => Number(row.score) || 0)
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
    const top = values.length ? Math.max(...values) : null
    return { total: pool.length, gradedCount: graded.length, avg, top }
  }, [graded, pool.length])

  // توزيع التقديرات — عدد اللي نالوا كل تقدير (يظهر جنب السلم)
  const tierCounts = useMemo(() => {
    const counts = {}
    graded.forEach(({ row }) => {
      const g = gradeOf(Number(row.score), exam.max_score, exam.grade_scale)
      counts[g] = (counts[g] || 0) + 1
    })
    return counts
  }, [graded, exam.max_score, exam.grade_scale])

  // تقرير A4 مطبوع — نفس الطابع الرسمي بتاع مراكز النخبة
  const printReport = () => {
    printExamReport({
      exam,
      stats: {
        total: stats.total,
        gradedCount: stats.gradedCount,
        avg: stats.avg != null ? Math.round(stats.avg * 10) / 10 : null,
        top: stats.top,
      },
      isArabic,
      rows: pool
        .map((s) => {
          const row = scoresByStudent[s.id]
          return {
            name: s.name,
            code: s.code || '',
            score: row ? Number(row.score) : null,
            grade: row ? gradeOf(Number(row.score), exam.max_score, exam.grade_scale) : '',
          }
        })
        .sort((a, b) => {
          if (a.score == null && b.score == null) return 0
          if (a.score == null) return 1
          if (b.score == null) return -1
          return b.score - a.score
        }),
    })
  }

  // إدخال فوري: كل تغيير درجة بيتحفظ علطول (debounce قصير لكتابة الأرقام)
  const [pending, setPending] = useState({}) // studentId → value being typed
  const timersRef = useRef({})
  const [flashIds, setFlashIds] = useState(new Set())

  const persist = useCallback((studentId, value) => {
    const v = String(value).trim()
    if (v === '') return
    ws.saveStandaloneScore(exam, studentId, Number(v))
    setPending((prev) => { const n = { ...prev }; delete n[studentId]; return n })
    setFlashIds((prev) => new Set([...prev, studentId]))
    setTimeout(() => setFlashIds((prev) => { const n = new Set(prev); n.delete(studentId); return n }), 1400)
  }, [exam, ws])

  const changeScore = (studentId, raw) => {
    const max = Number(exam.max_score)
    let v = String(raw).replace(/[^\d.]/g, '')
    if (v !== '' && Number(v) > max) v = String(max)
    setPending((prev) => ({ ...prev, [studentId]: v }))
    if (timersRef.current[studentId]) clearTimeout(timersRef.current[studentId])
    timersRef.current[studentId] = setTimeout(() => persist(studentId, v), 650)
  }

  // Enter → الطالب اللي بعده في القائمة (نفس Enter-to-next بتاع الحصص)
  const inputRefs = useRef({})
  const focusNext = (e, index) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    for (let n = index + 1; n < visible.length; n++) {
      const el = inputRefs.current[visible[n].id]
      if (el && !el.disabled) { el.focus(); try { el.select() } catch { /* noop */ } break }
    }
  }

  const finishExam = async () => {
    const ok = await ui.askConfirm(
      isArabic ? 'إنهاء الامتحان؟ الدرجات تفضل محفوظة، وتقدر تفتحه للتعديل في أي وقت.' : 'Finish this exam? Scores stay saved — you can reopen it for edits anytime.',
      { title: isArabic ? 'إنهاء الامتحان' : 'Finish exam', confirmLabel: isArabic ? 'إنهاء' : 'Finish' },
    )
    if (ok) ws.updateStandaloneExam(exam, { status: 'completed' })
  }

  const reopenExam = async () => {
    const ok = await ui.askConfirm(
      isArabic ? 'فتح الامتحان للتعديل؟ هترجع تقدر تعدل العنوان والدرجات والتقديرات.' : 'Reopen for editing? Title, scores and scale become editable again.',
      { title: isArabic ? 'فتح للتعديل' : 'Reopen', confirmLabel: isArabic ? 'فتح' : 'Open' },
    )
    if (ok) ws.updateStandaloneExam(exam, { status: 'open' })
  }

  const saveScale = async () => {
    setBusy(true)
    const ok = await ws.updateStandaloneExam(exam, { grade_scale: scaleDraft })
    setBusy(false)
    if (ok) setScaleOpen(false)
  }

  const saveMeta = async () => {
    const max = Number(maxDraft)
    if (!titleDraft.trim() || !Number.isFinite(max) || max <= 0) return
    setBusy(true)
    const ok = await ws.updateStandaloneExam(exam, { title: titleDraft, max_score: max })
    setBusy(false)
    if (ok) setEditingMeta(false)
  }

  const deleteExam = async () => {
    const ok = await ui.askConfirm(
      isArabic ? `حذف امتحان «${exam.title}» وكل درجاته نهائيًا؟` : `Delete "${exam.title}" and all its scores permanently?`,
      { title: isArabic ? 'حذف الامتحان' : 'Delete exam', confirmLabel: isArabic ? 'حذف' : 'Delete', danger: true },
    )
    if (ok) { const done = await ws.deleteStandaloneExam(exam); if (done) ui.closeExam() }
  }

  const examDateLabel = (() => {
    try { return AR_DATE_FMT.format(new Date(`${exam.exam_date}T00:00:00`)) } catch { return exam.exam_date }
  })()

  return (
    <div className="flex flex-col gap-3">
      {/* ── FOCUS HEADER (mobile) — نفس رأس مهمة الحصة ── */}
      {isMobile && (
        <div className="nk-focus-head" role="banner">
          <button className="nk-focus-head__exit" onClick={ui.closeExam} aria-label={isArabic ? 'الخروج والعودة للرئيسية' : 'Exit, back to Home'}>
            → {isArabic ? 'الرئيسية' : 'Home'}
          </button>
          <span className="nk-focus-head__task">
            <b className="truncate">{isArabic ? 'امتحان منفصل' : 'Standalone exam'}</b>
            <small className="truncate">{exam.title}</small>
          </span>
          <span className="nk-focus-head__status">
            <span className={`nk-pill ${open ? 'nk-pill-live' : 'nk-pill-done'}`}>{open ? '●' : '✓'}</span>
          </span>
        </div>
      )}

      {/* ── الهيدر: نفس النطاق الكحلي لمساحة الحصة ── */}
      <section className="nk-ws-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {!isMobile && (
              <button className="nk-pill nk-pill-gold mb-2 cursor-pointer border-0" onClick={ui.closeExam}>
                → {isArabic ? 'الرئيسية' : 'Home'}
              </button>
            )}
            <div className="nk-ws-muted text-[.62rem] font-black tracking-widest mb-1">EXAM WORKSPACE</div>
            {editingMeta ? (
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <input className="glass-input rounded-lg px-3 py-1.5 text-sm w-56" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} aria-label={isArabic ? 'عنوان الامتحان' : 'Exam title'} />
                <input type="number" min="1" className="glass-input rounded-lg px-3 py-1.5 text-sm w-24" value={maxDraft} onChange={(e) => setMaxDraft(e.target.value)} aria-label={isArabic ? 'الدرجة النهائية' : 'Max score'} />
                <button className="btn-gold rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold" disabled={busy} onClick={saveMeta}>{isArabic ? 'حفظ' : 'Save'}</button>
                <button className="btn-ghost rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold" onClick={() => { setEditingMeta(false); setTitleDraft(exam.title); setMaxDraft(String(exam.max_score)) }}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
              </div>
            ) : (
              <h2 className="text-[1.15rem] sm:text-[1.3rem] font-black m-0 leading-snug break-words">{exam.title}</h2>
            )}
            <p className="nk-ws-muted text-[.72rem] mt-1 mb-0">
              {examDateLabel}{exam.group_name ? ` · ${exam.group_name}` : ` · ${isArabic ? 'كل الطلاب' : 'All students'}`}
              {` · ${isArabic ? 'النهائي' : 'Max'}: ${exam.max_score}`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`nk-pill ${open ? 'nk-pill-live' : 'nk-pill-done'}`}>
              {open ? `● ${isArabic ? 'جاري الرصد' : 'Grading'}` : `✓ ${isArabic ? 'منتهي' : 'Completed'}`}
            </span>
            <span className="flex gap-1.5">
              <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" onClick={printReport} aria-label={isArabic ? 'طباعة نتيجة الامتحان' : 'Print exam report'}>🖨 {isArabic ? 'طباعة' : 'Print'}</button>
              {!editingMeta && open && (
                <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" onClick={() => setEditingMeta(true)}>✎ {isArabic ? 'العنوان والنهائي' : 'Title & max'}</button>
              )}
              {!open && (
                <button className="btn-gold rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" onClick={reopenExam}>✎ {isArabic ? 'فتح للتعديل' : 'Edit'}</button>
              )}
              <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" style={{ color: 'var(--danger-strong)' }} onClick={deleteExam} aria-label={isArabic ? 'حذف الامتحان' : 'Delete exam'}>🗑</button>
            </span>
          </div>
        </div>

        {/* الملخص المصغّر — نفس nk-mini بتاعة الحصة */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-4">
          <div className="nk-mini"><small>{isArabic ? 'الطلاب' : 'Students'}</small><b>{stats.total}</b></div>
          <div className="nk-mini nk-mini--ok"><small>{isArabic ? 'امتحنوا (حضروا)' : 'Took it'}</small><b>{stats.gradedCount} / {stats.total}</b></div>
          <div className="nk-mini nk-mini--gold"><small>{isArabic ? 'المتوسط' : 'Average'}</small><b>{stats.avg != null ? Math.round(stats.avg * 10) / 10 : '—'}</b></div>
          <div className="nk-mini nk-mini--info"><small>{isArabic ? 'أعلى درجة' : 'Highest'}</small><b>{stats.top != null ? stats.top : '—'}</b></div>
        </div>
      </section>

      {/* ── سلم التقديرات: عرض مصغر + لوحة تعديل قابلة للفتح ── */}
      <section className="nk-content !py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {normalizeGradeScale(exam.grade_scale).map((g, i) => {
              const c = gradeColor(g.name)
              return (
                <span key={`${g.name}-${i}`} className="nk-pill !text-[.66rem]" style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.fg }}>
                  {g.name} · {g.min}%{Number(exam.max_score) > 0 ? ` (${Math.round((g.min / 100) * exam.max_score)})` : ''}
                </span>
              )
            })}
          </div>
          {open && (
            <button className="btn-ghost rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold" onClick={() => setScaleOpen((o) => !o)} aria-expanded={scaleOpen}>
              {scaleOpen ? (isArabic ? 'إغلاق التعديل' : 'Close editor') : `✎ ${isArabic ? 'تعديل التقديرات' : 'Edit grades'}`}
            </button>
          )}
        </div>
        {stats.gradedCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-[.64rem] text-fg-muted">{isArabic ? 'التوزيع:' : 'Distribution:'}</span>
            {normalizeGradeScale(exam.grade_scale).filter((g) => tierCounts[g.name]).map((g, i) => {
              const c = gradeColor(g.name)
              return (
                <span key={`tc-${g.name}-${i}`} className="nk-pill !text-[.62rem]" style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.fg }}>
                  {g.name} · {tierCounts[g.name]}
                </span>
              )
            })}
          </div>
        )}
        {open && scaleOpen && (
          <div className="mt-3">
            <GradeScaleEditor scale={scaleDraft} setScale={setScaleDraft} maxScore={Number(exam.max_score)} isArabic={isArabic} compact />
            <div className="flex gap-2 mt-3">
              <button className="btn-navy rounded-xl px-4 py-2 text-[.74rem] font-extrabold" disabled={busy} onClick={saveScale}>{isArabic ? 'حفظ السلم' : 'Save scale'}</button>
              <button className="btn-ghost rounded-xl px-4 py-2 text-[.74rem] font-extrabold" onClick={() => { setScaleDraft(normalizeGradeScale(exam.grade_scale)); setScaleOpen(false) }}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
            </div>
          </div>
        )}
      </section>

      {/* ── قائمة الرصد: كل طالب صف واحد — درجة + تقدير + حفظ فوري ── */}
      <section className="nk-content">
        <h3 className="text-[1rem] font-extrabold mt-0 mb-1">{isArabic ? 'رصد الدرجات' : 'Grades'}</h3>
        <p className="text-[.74rem] text-fg-muted mt-0 mb-4">
          {isArabic
            ? 'اكتب الدرجة وستُحفظ فورًا — اللي كتبت درجته يبقى امتحن (حضر)، واللي من غير درجة مش داخل في الامتحان.'
            : 'Type a score — it saves instantly. Anyone with a score took the exam; the rest are simply not in it.'}
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-[160px]" placeholder={isArabic ? '🔍 بحث...' : 'Search...'} value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="nk-pill nk-pill-neutral">{visible.length} {isArabic ? 'طالب' : 'students'}</span>
        </div>

        <div className="grid gap-2">
          {visible.map((s, idx) => {
            const row = scoresByStudent[s.id]
            const value = pending[s.id] ?? (row ? String(row.score) : '')
            const displayScore = value === '' ? null : Number(value)
            const gradeName = displayScore != null ? gradeOf(displayScore, exam.max_score, exam.grade_scale) : null
            const gc = gradeName ? gradeColor(gradeName) : null
            const flashed = flashIds.has(s.id)
            return (
              <div key={s.id} className="nk-row">
                <span className="min-w-0">
                  <b className="truncate">{s.name}</b>
                  <small>
                    {row
                      ? `${row.score} / ${exam.max_score}`
                      : (isArabic ? 'لم يمتحن' : 'Not graded')}
                  </small>
                </span>
                <span className="flex items-center gap-2">
                  {gradeName && (
                    <span className="nk-pill !text-[.66rem]" style={{ background: gc.bg, border: `1px solid ${gc.border}`, color: gc.fg }}>{gradeName}</span>
                  )}
                  {flashed && <span className="text-[.64rem] font-extrabold" style={{ color: 'var(--ok-strong)' }}>✓ {isArabic ? 'اتحفظت' : 'Saved'}</span>}
                  <input
                    ref={(el) => { inputRefs.current[s.id] = el }}
                    type="number" min="0" max={exam.max_score} inputMode="decimal"
                    enterKeyHint="next"
                    className="glass-input rounded-xl px-3 py-2 text-sm w-24"
                    value={value}
                    onChange={(e) => changeScore(s.id, e.target.value)}
                    onBlur={(e) => { if (timersRef.current[s.id]) { clearTimeout(timersRef.current[s.id]); persist(s.id, e.target.value) } }}
                    onKeyDown={(e) => focusNext(e, idx)}
                    disabled={!open}
                    aria-label={`${s.name} — ${isArabic ? 'الدرجة من' : 'score out of'} ${exam.max_score}`}
                  />
                  <span className="text-[.66rem] text-fg-muted whitespace-nowrap">/ {exam.max_score}</span>
                </span>
              </div>
            )
          })}
          {visible.length === 0 && <p className="text-center py-6 text-sm text-fg-muted">{isArabic ? 'لا نتائج' : 'No students'}</p>}
        </div>

        {open && (
          <div className="flex flex-wrap gap-2 mt-5 pt-4" style={{ borderTop: '1px solid var(--surface-border)' }}>
            <button className="btn-gold action-button !min-h-[3rem]" onClick={finishExam}>
              ✓ {isArabic ? 'إنهاء الامتحان' : 'Finish exam'}
            </button>
            <button className="btn-ghost action-button !min-h-[3rem]" onClick={ui.closeExam}>{isArabic ? 'حفظ والرجوع للرئيسية' : 'Save & back home'}</button>
          </div>
        )}
      </section>
    </div>
  )
}
