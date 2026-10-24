import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useWorkspace, normalizeArabicSearch } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { supabase } from '../lib/supabaseClient'
import { newQuestion } from '../lib/hwQuiz'
import QuizQuestionsEditor from '../components/QuizQuestionsEditor'

// ═══════════════════════════════════════════════════════════════════════════
// ONLINE EXAM WORKSPACE — الامتحانات الأونلاين (057)
//   • المؤقت سيرفر-آثوريتيتف: الـ deadline بيتحسب على السيرفر لحظة بدء المحاولة
//     وساعة الجهاز عرض فقط — التصحيح سيرفر-آثوريتيتف عند التسليم.
//   • المدرس يبني أسئلة MCQ (نفس شكل الواجبات) أو يسحب من بنك الأسئلة (qb_*)
//   • المراقبة: مين بدأ/جاري/سلّم/انتهى وقتّه + إعادة تعيين محاولة طالب
//   • نفس الهيكل البصري لمساحة الواجب (nk-ws-head/nk-content/nk-row)
// ═══════════════════════════════════════════════════════════════════════════

const fmtTime = (ts) => {
  try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) } catch { return '' }
}

const dtLocalValue = (ts) => {
  try {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}

export default function OnlineExamWorkspace({ params }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const isNew = params?.examId === 'new'
  const exam = useMemo(
    () => ws.onlineExams.find((e) => e.id === params?.examId) || null,
    [ws.onlineExams, params?.examId],
  )

  if (isNew) {
    return <OnlineExamBuilder onCreated={(created) => { if (created?.id) ui.openOnlineExam({ examId: created.id }) }} onCancel={ui.closeOnlineExam} />
  }
  if (!exam) {
    return (
      <div className="nk-content text-center py-12">
        <p className="font-extrabold mb-3">{isArabic ? 'الامتحان غير موجود أو تم حذفه' : 'Exam not found'}</p>
        <button className="btn-navy action-button !min-h-[3rem]" onClick={ui.closeOnlineExam}>{isArabic ? 'العودة للرئيسية' : 'Back home'}</button>
      </div>
    )
  }
  return <OnlineExamMonitor exam={exam} />
}

// ── البناء: بيانات + أسئلة MCQ + سحب من بنك الأسئلة ─────────────────────────
function OnlineExamBuilder({ onCreated, onCancel }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [groupName, setGroupName] = useState('')
  const [duration, setDuration] = useState(30)
  const [opensAt, setOpensAt] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [shuffle, setShuffle] = useState(false)
  const [saveToBank, setSaveToBank] = useState(false)
  const [questions, setQuestions] = useState([newQuestion()])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // بنك الأسئلة (qb_* — موجودة على الإنتاج من m019، القراءة عبر RLS المدرس)
  const [bankOpen, setBankOpen] = useState(false)
  const [bank, setBank] = useState([])
  const [bankLoading, setBankLoading] = useState(false)
  const [bankSearch, setBankSearch] = useState('')

  const groupsList = ws.groups || []
  const totalMarks = questions.reduce((a, q) => a + (Number(q.marks) || 1), 0)

  const loadBank = useCallback(async () => {
    setBankLoading(true)
    try {
      const tid = ws.effectiveTeacherId
      const { data, error } = await supabase
        .from('qb_questions')
        .select('id, question_text, choices, correct_answer, marks, subject, difficulty, lesson')
        .eq('teacher_id', tid)
        .eq('type', 'mcq')
        .order('updated_at', { ascending: false })
        .limit(300)
      if (error) throw error
      // MCQ صالح للاستخدام فقط: اختيارين على الأقل + index إجابة صحيح موجود
      const usable = (data || []).filter((q) => Array.isArray(q.choices) && q.choices.length >= 2
        && q.correct_answer != null && Number.isInteger(Number(q.correct_answer?.index))
        && Number(q.correct_answer?.index) >= 0 && Number(q.correct_answer?.index) < q.choices.length)
      setBank(usable)
    } catch (err) {
      console.error('Load question bank error:', err)
      setBank([])
    } finally { setBankLoading(false) }
  }, [ws.effectiveTeacherId])

  useEffect(() => { if (bankOpen) loadBank() }, [bankOpen, loadBank])

  const bankVisible = useMemo(() => {
    const q = normalizeArabicSearch(bankSearch)
    if (!q) return bank
    return bank.filter((b) => normalizeArabicSearch([b.question_text, b.subject, b.lesson].filter(Boolean).join(' ')).includes(q))
  }, [bank, bankSearch])

  const addFromBank = (b) => {
    setQuestions((prev) => [...prev, {
      text: b.question_text,
      choices: b.choices.map((c) => String(c)),
      correct: Number(b.correct_answer?.index) || 0,
      marks: Number(b.marks) || 1,
    }])
  }

  const proceed = async () => {
    const clean = questions
      .map((q) => ({ ...q, text: String(q.text || '').trim(), choices: q.choices.map((c) => String(c || '').trim()).filter(Boolean) }))
      .filter((q) => q.text && q.choices.length >= 2)
    if (!title.trim()) { setError(isArabic ? 'اكتب عنوان الامتحان' : 'Enter the exam title'); return }
    if (clean.length === 0) { setError(isArabic ? 'أضف سؤالًا واحدًا على الأقل (نص + اختيارين على الأقل)' : 'Add at least one question'); return }
    if (clean.some((q) => q.correct == null || q.correct < 0 || q.correct >= q.choices.length)) {
      setError(isArabic ? 'حدد الإجابة الصحيحة لكل سؤال' : 'Pick the correct answer for every question'); return
    }
    if (!duration || Number(duration) < 1) { setError(isArabic ? 'حدد مدة الامتحان بالدقائق' : 'Set the duration in minutes'); return }
    setError('')
    setBusy(true)
    const toISO = (v) => { try { return v ? new Date(v).toISOString() : null } catch { return null } }
    const created = await ws.createOnlineExam({
      title,
      instructions,
      group_name: groupName || null,
      status: 'open',
      opens_at: toISO(opensAt),
      closes_at: toISO(closesAt),
      duration_minutes: Number(duration),
      questions: clean.map((q) => ({ text: q.text, choices: q.choices, correct: Number(q.correct) || 0, marks: Math.max(Number(q.marks) || 1, 0) })),
      shuffle_questions: shuffle,
    })
    // حفظ نسخة في بنك الأسئلة (غير حرِج — الفشل يتسجل بالكونسول فقط)
    if (created && saveToBank) {
      try {
        const tid = ws.effectiveTeacherId
        const rows = clean.map((q) => ({
          teacher_id: tid, subject: 'عام', difficulty: 'medium', type: 'mcq',
          question_text: q.text, choices: q.choices, correct_answer: { index: Number(q.correct) || 0 },
          marks: Math.max(Number(q.marks) || 1, 0),
        }))
        const { error: bankErr } = await supabase.from('qb_questions').insert(rows)
        if (bankErr) console.error('Save to question bank error:', bankErr)
      } catch (err) { console.error('Save to question bank error:', err) }
    }
    setBusy(false)
    if (created) onCreated(created)
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="nk-ws-head">
        <button className="nk-pill nk-pill-gold mb-2 cursor-pointer border-0" onClick={onCancel}>
          → {isArabic ? 'الرئيسية' : 'Home'}
        </button>
        <div className="nk-ws-muted text-[.62rem] font-black tracking-widest mb-1">ONLINE EXAM WORKSPACE</div>
        <h2 className="text-[1.15rem] sm:text-[1.3rem] font-black m-0 leading-snug">{isArabic ? 'امتحان أونلاين' : 'New online exam'}</h2>
        <p className="nk-ws-muted text-[.72rem] mt-1 mb-0">
          {isArabic
            ? 'الطالب يحل من بوابة QR بمؤقت حقيقي يحسبه السيرفر — التصحيح تلقائي ومفتاح الإجابات مش بيتسرب. لو عدّى الوقت بيتصحّح من آخر حفظ تلقائي.'
            : 'Students take it from the QR portal with a real server-computed timer — server-side grading; late attempts are graded from the last autosave.'}
        </p>
      </section>

      <section className="nk-content">
        <div className="grid gap-3 max-w-2xl">
          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'عنوان الامتحان' : 'Exam title'}</span>
            <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isArabic ? 'مثال: امتحان الوحدة الثانية' : 'e.g. Unit 2 exam'} />
          </label>

          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'تعليمات للطالب (اختياري)' : 'Instructions (optional)'}</span>
            <textarea className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full min-h-[54px]" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'المجموعة (فارغ = الكل)' : 'Group (empty = all)'}</span>
              <select className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={groupName} onChange={(e) => setGroupName(e.target.value)}>
                <option value="">{isArabic ? 'كل الطلاب' : 'All students'}</option>
                {groupsList.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'مدة الامتحان (دقائق)' : 'Duration (minutes)'}</span>
              <input type="number" min="1" max="300" inputMode="numeric" className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'يفتح في (اختياري)' : 'Opens at (optional)'}</span>
              <input type="datetime-local" className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'يقفل في (اختياري)' : 'Closes at (optional)'}</span>
              <input type="datetime-local" className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            </label>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-[.74rem] font-extrabold cursor-pointer">
              <input type="checkbox" className="w-3.5 h-3.5 accent-[var(--brand-navy)]" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
              {isArabic ? 'ترتيب عشوائي للأسئلة (لكل طالب)' : 'Shuffle questions per student'}
            </label>
            <label className="flex items-center gap-2 text-[.74rem] font-extrabold cursor-pointer">
              <input type="checkbox" className="w-3.5 h-3.5 accent-[var(--brand-navy)]" checked={saveToBank} onChange={(e) => setSaveToBank(e.target.checked)} />
              {isArabic ? 'حفظ الأسئلة في بنك الأسئلة' : 'Save questions to the bank'}
            </label>
          </div>

          {/* بنك الأسئلة */}
          <div className="rounded-xl p-3" style={{ background: 'var(--surface-container)', border: '1px solid var(--surface-border)' }}>
            <button className="flex items-center justify-between w-full bg-transparent border-0 cursor-pointer p-0" onClick={() => setBankOpen((v) => !v)}>
              <span className="text-[.78rem] font-extrabold" style={{ color: 'var(--navy-ink)' }}>
                🏦 {isArabic ? 'بنك الأسئلة' : 'Question bank'} {bank.length ? `(${bank.length})` : ''}
              </span>
              <span className="text-[.72rem] font-extrabold" style={{ color: 'var(--brand-gold)' }}>{bankOpen ? '▲' : '▼'}</span>
            </button>
            {bankOpen && (
              <div className="mt-3 grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input className="glass-input rounded-xl px-3 py-2 text-sm flex-1 min-w-[140px]" placeholder={isArabic ? '🔍 بحث في البنك...' : 'Search bank...'} value={bankSearch} onChange={(e) => setBankSearch(e.target.value)} />
                  <button className="btn-ghost rounded-xl px-3 py-2 text-[.7rem] font-extrabold" onClick={loadBank}>{isArabic ? '↻ تحديث' : '↻ Refresh'}</button>
                </div>
                {bankLoading && <p className="text-[.72rem] text-fg-muted m-0">{isArabic ? '...' : 'Loading...'}</p>}
                {!bankLoading && bankVisible.length === 0 && (
                  <p className="text-[.72rem] text-fg-muted m-0">
                    {isArabic ? 'البنك فاضي أو مفيش أسئلة MCQ صالحة — اعمل أسئلة جديدة وهتتخزن هنا لو فعّلت «حفظ في البنك».' : 'Bank is empty — build questions and enable "save to bank" to store them.'}
                  </p>
                )}
                {bankVisible.map((b) => (
                  <div key={b.id} className="nk-row">
                    <span className="min-w-0">
                      <b className="block text-[.78rem] truncate">{b.question_text}</b>
                      <small className="block text-[.64rem] text-fg-muted truncate">
                        {[b.subject, b.lesson, `${b.choices.length} ${isArabic ? 'اختيارات' : 'choices'}`, `${b.marks} ${isArabic ? 'درجة' : 'marks'}`].filter(Boolean).join(' · ')}
                      </small>
                    </span>
                    <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold shrink-0" onClick={() => addFromBank(b)}>
                      ＋ {isArabic ? 'إضافة' : 'Add'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* بناء الأسئلة — المحرّر الذكي المشترك (44e): توليد سريع + Enter flow + مفتاح إجابات */}
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[.78rem] font-extrabold" style={{ color: 'var(--navy-ink)' }}>
                {isArabic ? `الأسئلة (${questions.length})` : `Questions (${questions.length})`}
              </span>
              <span className="nk-pill nk-pill-gold">{isArabic ? 'الإجمالي' : 'Total'}: {totalMarks} {isArabic ? 'درجة' : 'marks'}</span>
            </div>
            <QuizQuestionsEditor
              questions={questions}
              setQuestions={setQuestions}
              isArabic={isArabic}
              editorId="ox"
              optionalText={false}
            />
          </div>

          {error && <div className="nk-notice" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-strong)' }}>{error}</div>}

          <div className="flex gap-2">
            <button className="btn-navy action-button !min-h-[3rem]" disabled={busy} onClick={proceed}>
              {busy ? '...' : (isArabic ? 'نشر الامتحان ←' : 'Publish exam →')}
            </button>
            <button className="btn-ghost action-button !min-h-[3rem]" onClick={onCancel}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── المراقبة: مين بدأ/جاري/سلّم/انتهى + إعادة تعيين محاولة ───────────────────
function OnlineExamMonitor({ exam }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [search, setSearch] = useState('')
  const [nowTick, setNowTick] = useState(() => Date.now())

  // تحديث الساعة كل 10 ثواني + تحديث بيانات المحاولات دوريًا أثناء فتح الامتحان
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 10000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    ws.refreshOnlineExams()
    const t = setInterval(() => { ws.refreshOnlineExams() }, 20000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id])

  const pool = useMemo(
    () => (exam.group_name ? ws.students.filter((s) => s.group_name === exam.group_name) : ws.students),
    [ws.students, exam.group_name],
  )
  const attemptsByStudent = useMemo(() => {
    const m = {}
    ws.onlineExamAttempts.forEach((a) => { if (a.exam_id === exam.id) m[a.student_id] = a })
    return m
  }, [ws.onlineExamAttempts, exam.id])

  const visible = useMemo(() => {
    const q = normalizeArabicSearch(search)
    if (!q) return pool
    return pool.filter((s) => normalizeArabicSearch([s.name, s.code].filter(Boolean).join(' ')).includes(q))
  }, [pool, search])

  const stats = useMemo(() => {
    const rows = pool.map((s) => attemptsByStudent[s.id]).filter(Boolean)
    const started = rows.length
    const finished = rows.filter((a) => a.status === 'submitted' || a.status === 'expired')
    const vals = finished.map((a) => Number(a.score) || 0)
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    const inProgress = rows.filter((a) => a.status === 'in_progress' && new Date(a.deadline_at).getTime() > nowTick).length
    return { total: pool.length, started, finished: finished.length, avg, inProgress }
  }, [pool, attemptsByStudent, nowTick])

  const open = exam.status === 'open'
  const windowNote = useMemo(() => {
    const o = exam.opens_at ? new Date(exam.opens_at) : null
    const c = exam.closes_at ? new Date(exam.closes_at) : null
    const parts = []
    if (o) parts.push(`${isArabic ? 'يفتح' : 'Opens'}: ${fmtTime(o)}`)
    if (c) parts.push(`${isArabic ? 'يقفل' : 'Closes'}: ${fmtTime(c)}`)
    return parts.join(' · ')
  }, [exam.opens_at, exam.closes_at, isArabic])

  const toggleStatus = async () => {
    const ok = await ui.askConfirm(
      open
        ? (isArabic ? 'إغلاق الامتحان؟ محاولات جديدة ممنوعة — اللي بدأ يكمّل لحد وقته.' : 'Close this exam? No new attempts — in-progress students keep their timer.')
        : (isArabic ? 'فتح الامتحان تاني؟ الطلاب يقدروا يبدأوا.' : 'Reopen? Students can start again.'),
      { title: open ? (isArabic ? 'إغلاق الامتحان' : 'Close exam') : (isArabic ? 'فتح الامتحان' : 'Open exam'), confirmLabel: open ? (isArabic ? 'إغلاق' : 'Close') : (isArabic ? 'فتح' : 'Open') },
    )
    if (ok) ws.setOnlineExamStatus(exam, open ? 'closed' : 'open')
  }

  const deleteExam = async () => {
    const ok = await ui.askConfirm(
      isArabic ? `حذف امتحان «${exam.title}» وكل المحاولات نهائيًا؟` : `Delete "${exam.title}" and all attempts permanently?`,
      { title: isArabic ? 'حذف الامتحان' : 'Delete exam', confirmLabel: isArabic ? 'حذف' : 'Delete', danger: true },
    )
    if (ok) { const done = await ws.deleteOnlineExam(exam); if (done) ui.closeOnlineExam() }
  }

  const resetAttempt = async (attempt, studentName) => {
    const ok = await ui.askConfirm(
      isArabic ? `إعادة تعيين محاولة ${studentName}؟ هتتحذف درجته ويقدر يبدأ الامتحان من الأول.` : `Reset ${studentName}'s attempt? Their score is deleted and they can retake.`,
      { title: isArabic ? 'إعادة تعيين المحاولة' : 'Reset attempt', confirmLabel: isArabic ? 'إعادة تعيين' : 'Reset', danger: true },
    )
    if (ok) ws.resetOnlineExamAttempt(attempt)
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="nk-ws-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {!ui.isMobile && (
              <button className="nk-pill nk-pill-gold mb-2 cursor-pointer border-0" onClick={ui.closeOnlineExam}>
                → {isArabic ? 'الرئيسية' : 'Home'}
              </button>
            )}
            <div className="nk-ws-muted text-[.62rem] font-black tracking-widest mb-1">ONLINE EXAM WORKSPACE</div>
            <h2 className="text-[1.15rem] sm:text-[1.3rem] font-black m-0 leading-snug break-words">{exam.title}</h2>
            <p className="nk-ws-muted text-[.72rem] mt-1 mb-0">
              {exam.group_name || (isArabic ? 'كل الطلاب' : 'All students')}
              {` · ${isArabic ? 'المدة' : 'Duration'}: ${exam.duration_minutes} ${isArabic ? 'دقيقة' : 'min'}`}
              {` · ${isArabic ? 'الإجمالي' : 'Total'}: ${exam.max_score}`}
              {` · ${(exam.questions || []).length} ${isArabic ? 'سؤال' : 'questions'}`}
              {exam.shuffle_questions ? (isArabic ? ' · ترتيب عشوائي' : ' · shuffled') : ''}
            </p>
            {(windowNote || exam.instructions) && (
              <p className="text-[.72rem] mt-1 mb-0 text-fg-muted">{[windowNote, exam.instructions].filter(Boolean).join(' — ')}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`nk-pill ${open ? 'nk-pill-live' : 'nk-pill-done'}`}>
              {open ? `● ${isArabic ? 'مفتوح' : 'Open'}` : (exam.status === 'scheduled' ? `⏱ ${isArabic ? 'مجدول' : 'Scheduled'}` : `✓ ${isArabic ? 'مغلق' : 'Closed'}`)}
            </span>
            <span className="flex gap-1.5">
              <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" onClick={() => ws.refreshOnlineExams()} aria-label={isArabic ? 'تحديث' : 'Refresh'}>↻</button>
              <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" onClick={toggleStatus}>
                {open ? (isArabic ? '🔒 إغلاق' : '🔒 Close') : (isArabic ? '🔓 فتح' : '🔓 Open')}
              </button>
              <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" style={{ color: 'var(--danger-strong)' }} onClick={deleteExam} aria-label={isArabic ? 'حذف الامتحان' : 'Delete exam'}>🗑</button>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 mt-4">
          <div className="nk-mini"><small>{isArabic ? 'الطلاب' : 'Students'}</small><b>{stats.total}</b></div>
          <div className="nk-mini nk-mini--ok"><small>{isArabic ? 'سلّموا' : 'Finished'}</small><b>{stats.finished} / {stats.total}</b></div>
          <div className="nk-mini nk-mini--gold"><small>{isArabic ? 'جاري الآن' : 'In progress'}</small><b>{stats.inProgress}</b></div>
          <div className="nk-mini"><small>{isArabic ? 'المتوسط' : 'Average'}</small><b>{stats.avg != null ? Math.round(stats.avg * 10) / 10 : '—'}</b></div>
        </div>
      </section>

      <section className="nk-content">
        <h3 className="text-[1rem] font-extrabold mt-0 mb-1">{isArabic ? 'محاولات الطلاب' : 'Student attempts'}</h3>
        <p className="text-[.74rem] text-fg-muted mt-0 mb-4">
          {isArabic
            ? 'الوقت بيتحسب على السيرفر من لحظة البدء — لو الطالب قفل الصفحة وفتح تاني يلاقي امتحانه مستني والوقت ماشي.'
            : 'Timers are server-computed from the moment a student starts — closing the page does not pause anything.'}
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-[160px]" placeholder={isArabic ? '🔍 بحث...' : 'Search...'} value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="nk-pill nk-pill-neutral">{visible.length} {isArabic ? 'طالب' : 'students'}</span>
        </div>
        <div className="grid gap-2">
          {visible.map((s) => {
            const a = attemptsByStudent[s.id]
            let statePill = <span className="nk-pill nk-pill-neutral">{isArabic ? 'لم يبدأ' : 'Not started'}</span>
            let detail = null
            if (a) {
              const deadline = new Date(a.deadline_at).getTime()
              if (a.status === 'in_progress') {
                const remainingMs = deadline - nowTick
                if (remainingMs > 0) {
                  const remMin = Math.max(0, Math.ceil(remainingMs / 60000))
                  statePill = <span className="nk-pill nk-pill-live">⏱ {isArabic ? 'جاري' : 'Active'}</span>
                  detail = <span className="text-[.64rem] text-fg-muted">{isArabic ? `متبقي ~${remMin} دقيقة` : `~${remMin} min left`}</span>
                } else {
                  statePill = <span className="nk-pill nk-pill-danger">⌛ {isArabic ? 'انتهى الوقت' : 'Timed out'}</span>
                  detail = <span className="text-[.64rem] text-fg-muted">{isArabic ? 'بيتصحح تلقائيًا عند أول فتح' : 'auto-graded on next open'}</span>
                }
              } else {
                const pct = Number(a.max_score) > 0 ? Math.round((Number(a.score) / Number(a.max_score)) * 100) : null
                statePill = (
                  <span className="flex items-center gap-1.5">
                    {pct != null && <span className={`nk-pill !text-[.66rem] ${pct >= 50 ? 'nk-pill-gold' : 'nk-pill-danger'}`}>{pct}%</span>}
                    <span className={`nk-pill !text-[.66rem] ${a.status === 'submitted' ? 'nk-pill-done' : 'nk-pill-danger'}`}>
                      {a.status === 'submitted' ? (isArabic ? `سلّم ${a.score}/${a.max_score}` : `Submitted ${a.score}/${a.max_score}`) : (isArabic ? `انتهى وقته ${a.score}/${a.max_score}` : `Timed out ${a.score}/${a.max_score}`)}
                    </span>
                  </span>
                )
                detail = <span className="text-[.64rem] text-fg-muted">{fmtTime(a.submitted_at || a.started_at)} · {a.correct_count}/{a.question_count} {isArabic ? 'صحيحة' : 'correct'}</span>
              }
            }
            return (
              <div key={s.id} className="nk-row">
                <span className="min-w-0">
                  <b className="truncate">{s.name}</b>
                  {detail && <small className="block">{detail}</small>}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {statePill}
                  {a && (
                    <button className="btn-ghost rounded-lg px-2 py-1 text-[.64rem] font-extrabold" onClick={() => resetAttempt(a, s.name)} title={isArabic ? 'إعادة تعيين — يقدر يبدأ من الأول' : 'Reset — student retakes'}>
                      ↺ {isArabic ? 'إعادة' : 'Reset'}
                    </button>
                  )}
                </span>
              </div>
            )
          })}
          {visible.length === 0 && <p className="text-center py-6 text-sm text-fg-muted">{isArabic ? 'لا نتائج' : 'No students'}</p>}
        </div>
      </section>
    </div>
  )
}
