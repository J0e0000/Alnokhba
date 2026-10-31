import { useMemo, useState } from 'react'
import { useWorkspace, normalizeArabicSearch } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'

// ═══════════════════════════════════════════════════════════════════════════
// HOMEWORK WORKSPACE — الواجبات التفاعلية (056): اختيار الإجابة فقط
//   • المدرس يبني واجب أسئلة MCQ (نص + اختيارات + الإجابة الصحيحة + الدرجة)
//   • الطالب يحله من بوابة QR — التصحيح سيرفر-آثوريتيتف (submit RPC)
//   • النتائج هنا: من حل، الدرجة، إغلاق/فتح الواجب — والملفات لاحقًا
//   • نفس الهيكل البصري لمساحة الامتحان المنفصل (nk-ws-head/nk-content/nk-row)
// ═══════════════════════════════════════════════════════════════════════════

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fmtTime = (ts) => {
  try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) } catch { return '' }
}

function newQuestion() {
  return { text: '', choices: ['', '', '', ''], correct: 0, marks: 1 }
}

export default function HomeworkWorkspace({ params }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const isNew = params?.taskId === 'new'
  const task = useMemo(
    () => ws.homeworkTasks.find((t) => t.id === params?.taskId) || null,
    [ws.homeworkTasks, params?.taskId],
  )

  if (isNew) {
    return <HomeworkBuilder onCreated={(created) => { if (created?.id) ui.openTask({ taskId: created.id }) }} onCancel={ui.closeTask} />
  }
  if (!task) {
    return (
      <div className="nk-content text-center py-12">
        <p className="font-extrabold mb-3">{isArabic ? 'الواجب غير موجود أو تم حذفه' : 'Homework not found'}</p>
        <button className="btn-navy action-button !min-h-[3rem]" onClick={ui.closeTask}>{isArabic ? 'العودة للرئيسية' : 'Back home'}</button>
      </div>
    )
  }
  return <HomeworkResults task={task} />
}

// ── البناء: عنوان/وصف/مجموعة/تاريخ تسليم + بناء أسئلة الاختيار ──────────────
function HomeworkBuilder({ onCreated, onCancel }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [groupName, setGroupName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [questions, setQuestions] = useState([newQuestion()])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const groupsList = ws.groups || []
  const totalMarks = questions.reduce((a, q) => a + (Number(q.marks) || 1), 0)

  const setQ = (i, patch) => setQuestions((prev) => prev.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  const addQuestion = () => setQuestions((prev) => [...prev, newQuestion()])
  const removeQuestion = (i) => setQuestions((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))

  const proceed = async () => {
    const clean = questions
      .map((q) => ({ ...q, text: String(q.text || '').trim(), choices: q.choices.map((c) => String(c || '').trim()).filter(Boolean) }))
      .filter((q) => q.text && q.choices.length >= 2)
    if (!title.trim()) { setError(isArabic ? 'اكتب عنوان الواجب' : 'Enter the homework title'); return }
    if (clean.length === 0) { setError(isArabic ? 'أضف سؤالًا واحدًا على الأقل (نص + اختيارين على الأقل)' : 'Add at least one question'); return }
    if (clean.some((q) => q.correct == null || q.correct < 0 || q.correct >= q.choices.length)) {
      setError(isArabic ? 'حدد الإجابة الصحيحة لكل سؤال' : 'Pick the correct answer for every question'); return
    }
    setError('')
    setBusy(true)
    const created = await ws.createHomeworkTask({
      title, description, group_name: groupName || null, due_date: dueDate || null,
      questions: clean.map((q) => ({ text: q.text, choices: q.choices, correct: Number(q.correct) || 0, marks: Math.max(Number(q.marks) || 1, 0) })),
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
        <div className="nk-ws-muted text-[.62rem] font-black tracking-widest mb-1">HOMEWORK WORKSPACE</div>
        <h2 className="text-[1.15rem] sm:text-[1.3rem] font-black m-0 leading-snug">{isArabic ? 'واجب اختيار الإجابة' : 'New MCQ homework'}</h2>
        <p className="nk-ws-muted text-[.72rem] mt-1 mb-0">
          {isArabic
            ? 'الطالب يحل من بوابة QR باختيار الإجابة — التصحيح تلقائي على السيرفر ومفتاح الإجابات مش بيتسرب للبوابة.'
            : 'Students answer from the QR portal — server-side auto-grading; the answer key never reaches the client.'}
        </p>
      </section>

      <section className="nk-content">
        <div className="grid gap-3 max-w-2xl">
          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'عنوان الواجب' : 'Homework title'}</span>
            <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isArabic ? 'مثال: واجب الوحدة الثانية' : 'e.g. Unit 2 homework'} />
          </label>

          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'وصف قصير (اختياري)' : 'Short description (optional)'}</span>
            <textarea className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} />
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
              <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'آخر موعد (اختياري)' : 'Due date (optional)'}</span>
              <input type="date" className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={dueDate} min={todayISO()} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>

          {/* بناء الأسئلة */}
          <div className="grid gap-3">
            {questions.map((q, i) => (
              <div key={i} className="rounded-xl p-3" style={{ background: 'var(--surface-container)', border: '1px solid var(--surface-border)' }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[.72rem] font-extrabold" style={{ color: 'var(--brand-navy)' }}>{isArabic ? `السؤال ${i + 1}` : `Question ${i + 1}`}</span>
                  {questions.length > 1 && (
                    <button className="btn-ghost rounded-lg px-2 py-1 text-[.68rem] font-extrabold" onClick={() => removeQuestion(i)} aria-label={isArabic ? 'حذف السؤال' : 'Remove question'}>✕</button>
                  )}
                </div>
                <input
                  className="glass-input rounded-lg px-3 py-2 text-sm w-full mb-2"
                  placeholder={isArabic ? 'نص السؤال...' : 'Question text...'}
                  value={q.text}
                  onChange={(e) => setQ(i, { text: e.target.value })}
                  aria-label={isArabic ? 'نص السؤال' : 'Question text'}
                />
                <div className="grid gap-1.5">
                  {q.choices.map((c, ci) => (
                    <label key={ci} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`correct-${i}`}
                        checked={Number(q.correct) === ci}
                        onChange={() => setQ(i, { correct: ci })}
                        className="w-3.5 h-3.5 accent-[var(--ok-strong)]"
                        aria-label={isArabic ? 'الإجابة الصحيحة' : 'Correct answer'}
                      />
                      <input
                        className="glass-input rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-0"
                        placeholder={isArabic ? `اختيار ${ci + 1}` : `Choice ${ci + 1}`}
                        value={c}
                        onChange={(e) => { const choices = [...q.choices]; choices[ci] = e.target.value; setQ(i, { choices }) }}
                      />
                      {q.choices.length > 2 && (
                        <button className="btn-ghost rounded-lg px-2 py-1 text-[.66rem] font-extrabold" onClick={() => { const choices = q.choices.filter((_, j) => j !== ci); setQ(i, { choices, correct: q.correct >= choices.length ? 0 : q.correct }) }} aria-label={isArabic ? 'حذف الاختيار' : 'Remove choice'}>✕</button>
                      )}
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <div className="flex gap-1.5">
                    {q.choices.length < 6 && (
                      <button className="btn-ghost rounded-lg px-2.5 py-1 text-[.66rem] font-extrabold" onClick={() => setQ(i, { choices: [...q.choices, ''] })}>＋ {isArabic ? 'اختيار' : 'Choice'}</button>
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 text-[.68rem] text-fg-muted">
                    {isArabic ? 'الدرجة' : 'Marks'}
                    <input type="number" min="1" inputMode="decimal" className="glass-input rounded-lg px-2 py-1 text-[.75rem] w-14" value={q.marks} onChange={(e) => setQ(i, { marks: e.target.value })} />
                  </label>
                </div>
                <small className="block text-[.62rem] text-fg-muted mt-1.5">
                  {isArabic ? '✔ الدائرة = الإجابة الصحيحة. الدرجة الافتراضية 1.' : '✔ Radio = correct answer. Default mark is 1.'}
                </small>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <button className="btn-ghost rounded-xl px-4 py-2 text-[.74rem] font-extrabold" onClick={addQuestion}>
                ＋ {isArabic ? 'سؤال جديد' : 'Add question'}
              </button>
              <span className="nk-pill nk-pill-gold">{isArabic ? 'الإجمالي' : 'Total'}: {totalMarks} {isArabic ? 'درجة' : 'marks'}</span>
            </div>
          </div>

          {error && <div className="nk-notice" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-strong)' }}>{error}</div>}

          <div className="flex gap-2">
            <button className="btn-navy action-button !min-h-[3rem]" disabled={busy} onClick={proceed}>
              {busy ? '...' : (isArabic ? 'نشر الواجب ←' : 'Publish homework →')}
            </button>
            <button className="btn-ghost action-button !min-h-[3rem]" onClick={onCancel}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── النتائج: من حل، الدرجة، إغلاق/فتح الواجب ─────────────────────────────────
function HomeworkResults({ task }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [search, setSearch] = useState('')

  const pool = useMemo(
    () => (task.group_name ? ws.students.filter((s) => s.group_name === task.group_name) : ws.students),
    [ws.students, task.group_name],
  )
  const subsByStudent = useMemo(() => {
    const m = {}
    ws.homeworkSubmissions.forEach((s) => { if (s.task_id === task.id) m[s.student_id] = s })
    return m
  }, [ws.homeworkSubmissions, task.id])

  const visible = useMemo(() => {
    const q = normalizeArabicSearch(search)
    if (!q) return pool
    return pool.filter((s) => normalizeArabicSearch([s.name, s.code].filter(Boolean).join(' ')).includes(q))
  }, [pool, search])

  const stats = useMemo(() => {
    const solvedRows = pool.filter((s) => subsByStudent[s.id]).map((s) => ({ s, sub: subsByStudent[s.id] }))
    const vals = solvedRows.map(({ sub }) => Number(sub.score) || 0)
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    const full = solvedRows.filter(({ sub }) => Number(task.max_score) > 0 && Number(sub.score) === Number(task.max_score)).length
    return { total: pool.length, solvedCount: solvedRows.length, avg, full }
  }, [pool, subsByStudent, task.max_score])

  const published = task.status === 'published'
  const createdLabel = (() => { try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long' }).format(new Date(task.created_at)) } catch { return '' } })()

  const toggleStatus = async () => {
    const ok = await ui.askConfirm(
      published
        ? (isArabic ? 'إغلاق الواجب؟ الطلاب مش هيقدروا يحلوا أو يعدلوا بعد كده.' : 'Close this homework? Students can no longer submit.')
        : (isArabic ? 'فتح الواجب تاني؟ الطلاب يرجعوا يحلوا (آخر إجابة هي اللي تتسجل).' : 'Reopen? Students can submit again (latest wins).'),
      { title: published ? (isArabic ? 'إغلاق الواجب' : 'Close homework') : (isArabic ? 'فتح الواجب' : 'Reopen'), confirmLabel: published ? (isArabic ? 'إغلاق' : 'Close') : (isArabic ? 'فتح' : 'Open') },
    )
    if (ok) ws.setHomeworkTaskStatus(task, published ? 'closed' : 'published')
  }

  const deleteTask = async () => {
    const ok = await ui.askConfirm(
      isArabic ? `حذف واجب «${task.title}» وكل التسليمات نهائيًا؟` : `Delete "${task.title}" and all submissions permanently?`,
      { title: isArabic ? 'حذف الواجب' : 'Delete homework', confirmLabel: isArabic ? 'حذف' : 'Delete', danger: true },
    )
    if (ok) { const done = await ws.deleteHomeworkTask(task); if (done) ui.closeTask() }
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="nk-ws-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {!ui.isMobile && (
              <button className="nk-pill nk-pill-gold mb-2 cursor-pointer border-0" onClick={ui.closeTask}>
                → {isArabic ? 'الرئيسية' : 'Home'}
              </button>
            )}
            <div className="nk-ws-muted text-[.62rem] font-black tracking-widest mb-1">HOMEWORK WORKSPACE</div>
            <h2 className="text-[1.15rem] sm:text-[1.3rem] font-black m-0 leading-snug break-words">{task.title}</h2>
            <p className="nk-ws-muted text-[.72rem] mt-1 mb-0">
              {task.group_name || (isArabic ? 'كل الطلاب' : 'All students')}
              {task.due_date ? ` · ${isArabic ? 'آخر موعد' : 'Due'}: ${task.due_date}` : ''}
              {` · ${isArabic ? 'الإجمالي' : 'Total'}: ${task.max_score}`}
              {` · ${(task.questions || []).length} ${isArabic ? 'سؤال' : 'questions'}`}
              {createdLabel ? ` · ${createdLabel}` : ''}
            </p>
            {task.description && <p className="text-[.74rem] mt-1 mb-0 text-fg-muted">{task.description}</p>}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`nk-pill ${published ? 'nk-pill-live' : 'nk-pill-done'}`}>
              {published ? `● ${isArabic ? 'منشور' : 'Published'}` : `✓ ${isArabic ? 'مغلق' : 'Closed'}`}
            </span>
            <span className="flex gap-1.5">
              <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" onClick={toggleStatus}>
                {published ? (isArabic ? '🔒 إغلاق' : '🔒 Close') : (isArabic ? '🔓 فتح' : '🔓 Open')}
              </button>
              <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" style={{ color: 'var(--danger-strong)' }} onClick={deleteTask} aria-label={isArabic ? 'حذف الواجب' : 'Delete homework'}>🗑</button>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="nk-mini"><small>{isArabic ? 'الطلاب' : 'Students'}</small><b>{stats.total}</b></div>
          <div className="nk-mini nk-mini--ok"><small>{isArabic ? 'حلّوا' : 'Solved'}</small><b>{stats.solvedCount} / {stats.total}</b></div>
          <div className="nk-mini nk-mini--gold"><small>{isArabic ? 'المتوسط' : 'Average'}</small><b>{stats.avg != null ? Math.round(stats.avg * 10) / 10 : '—'}</b></div>
        </div>
      </section>

      <section className="nk-content">
        <h3 className="text-[1rem] font-extrabold mt-0 mb-1">{isArabic ? 'تسليمات الطلاب' : 'Submissions'}</h3>
        <p className="text-[.74rem] text-fg-muted mt-0 mb-4">
          {isArabic
            ? 'التصحيح تلقائي على السيرفر فور التسليم — آخر إجابة هي اللي تتسجل لو أعاد الطالب الحل.'
            : 'Auto-graded server-side on submit — the latest attempt wins if a student retries.'}
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-[160px]" placeholder={isArabic ? '🔍 بحث...' : 'Search...'} value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="nk-pill nk-pill-neutral">{visible.length} {isArabic ? 'طالب' : 'students'}</span>
        </div>
        <div className="grid gap-2">
          {visible.map((s) => {
            const sub = subsByStudent[s.id]
            const pct = sub && Number(sub.max_score) > 0 ? Math.round((Number(sub.score) / Number(sub.max_score)) * 100) : null
            return (
              <div key={s.id} className="nk-row">
                <span className="min-w-0">
                  <b className="truncate">{s.name}</b>
                  <small>
                    {sub
                      ? `${sub.score} / ${sub.max_score} · ${sub.correct_count}/${sub.question_count} ${isArabic ? 'صحيحة' : 'correct'}`
                      : (isArabic ? 'لم يحلّ بعد' : 'Not submitted yet')}
                  </small>
                </span>
                <span className="flex items-center gap-2">
                  {pct != null && (
                    <span className={`nk-pill !text-[.66rem] ${pct >= 50 ? 'nk-pill-gold' : 'nk-pill-danger'}`}>{pct}%</span>
                  )}
                  {sub && <span className="text-[.62rem] text-fg-muted">{fmtTime(sub.submitted_at)}</span>}
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
