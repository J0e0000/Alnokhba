import { useMemo, useRef, useState } from 'react'
import { useWorkspace, normalizeArabicSearch } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { parseQuestionsText, mapAiQuestions, buildQuizAnalytics, newQuestion, presetQuestions } from '../lib/hwQuiz'
import QuizQuestionsEditor from '../components/QuizQuestionsEditor'

// ═══════════════════════════════════════════════════════════════════════════
// HOMEWORK WORKSPACE — الواجبات التفاعلية (056 → 058 / Task 44d)
//   • المدرس يبني واجب MCQ — نص السؤال اختياري (الواجب ممكن يكون في الكتاب)
//   • قوالب جاهزة: أ ب ج د أو صح/غلط — المدرس يحدد الإجابة بس ويعدّل بعدين
//   • لصق/رفع ملف نصي → محلّل محلي يفهم الأسئلة؛ وصورة/PDF عبر الدالة الذكية
//   • لينك فيديو الشرح — الطالب مايشوفهش غير بعد ما يسلّم (058)
//   • الطالب يحل من صفحة الواجبات المخصصة (/hw/:token) — تسليم واحد بس،
//     والتصحيح سيرفر-آثوريتيتف — والدرجة تتسجل تلقائيًا في الحصة الجاية
//   • النتائج هنا: من حل/الدرجة + تحليل أكتر الأسئلة فيها مشاكل + إغلاق/فتح
// ═══════════════════════════════════════════════════════════════════════════

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fmtTime = (ts) => {
  try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) } catch { return '' }
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
    return <HomeworkBuilder onCreated={(created) => { if (created?.id) ui.openTask({ taskId: created.id }) }} onCancel={ui.goHomeworkHub} preset={params?.preset} />
  }
  if (!task) {
    return (
      <div className="nk-content text-center py-12">
        <p className="font-extrabold mb-3">{isArabic ? 'الواجب غير موجود أو تم حذفه' : 'Homework not found'}</p>
        <button className="btn-navy action-button !min-h-[3rem]" onClick={ui.goHomeworkHub}>{isArabic ? 'العودة للواجبات' : 'Back to homework'}</button>
      </div>
    )
  }
  return <HomeworkResults task={task} />
}

// ── البناء: عنوان/وصف/مجموعة/تاريخ/فيديو + بناء أسئلة الاختيار ───────────────
// editTask → وضع التعديل (مسموح بس لما مفيش أي طالب حلّ بعد — 058)
function HomeworkBuilder({ onCreated, onCancel, editTask, onUpdated, preset }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [title, setTitle] = useState(editTask?.title || '')
  const [description, setDescription] = useState(editTask?.description || '')
  const [groupName, setGroupName] = useState(editTask?.group_name || '')
  const [dueDate, setDueDate] = useState(editTask?.due_date || '')
  const [videoUrl, setVideoUrl] = useState(editTask?.video_url || '')
  const [questions, setQuestions] = useState(
    editTask?.questions?.length
      ? editTask.questions.map((q) => ({ text: q.text || '', choices: (q.choices || []).map(String), correct: Number(q.correct) || 0, marks: Number(q.marks) || 1 }))
      : (preset ? presetQuestions(preset) : [newQuestion()]),
  )
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const fileRef = useRef(null)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState([])
  const [busy, setBusy] = useState(false)

  const groupsList = ws.groups || []
  const totalMarks = questions.reduce((a, q) => a + (Number(q.marks) || 1), 0)

  // محلّل النص الملصوق (محلي — بدون أي AI)
  const applyPasted = () => {
    const { questions: parsed, warnings: w } = parseQuestionsText(pasteText)
    if (parsed.length) {
      setQuestions((prev) => (prev.length === 1 && !prev[0].text && prev[0].choices.every((c) => !c) ? parsed : [...prev, ...parsed]))
      setPasteText('')
      setPasteOpen(false)
      setWarnings(w)
      setError('')
    } else {
      setWarnings(w)
    }
  }

  // رفع ملف (نصي محليًا / صورة-PDF عبر الدالة الذكية لو فيها مفتاح AI)
  const onFile = async (file) => {
    if (!file) return
    setWarnings([])
    if (/\.(txt|md|csv)$/i.test(file.name)) {
      const text = await file.text()
      const { questions: parsed, warnings: w } = parseQuestionsText(text)
      if (parsed.length) {
        setQuestions((prev) => (prev.length === 1 && !prev[0].text && prev[0].choices.every((c) => !c) ? parsed : [...prev, ...parsed]))
      }
      setWarnings(w)
      return
    }
    setAiBusy(true)
    try {
      const buf = await file.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      const b64 = btoa(binary)
      const { supabase } = await import('../lib/supabaseClient')
      const res = await supabase.functions.invoke('ai-parse-homework', {
        body: { mime: file.type || 'application/octet-stream', file_base64: b64 },
      })
      if (res.error) throw res.error
      const mapped = mapAiQuestions(res.data?.questions)
      if (mapped.length) {
        setQuestions((prev) => (prev.length === 1 && !prev[0].text && prev[0].choices.every((c) => !c) ? mapped : [...prev, ...mapped]))
        setWarnings([isArabic ? `الدالة الذكية طلّعت ${mapped.length} سؤال — راجع الإجابات قبل النشر` : `AI extracted ${mapped.length} questions — review before publishing`])
      } else {
        setWarnings([isArabic ? 'الدالة الذكية مقدرتش تطلّع أسئلة من الملف ده — جرّب لصق النص' : 'AI could not extract questions — try pasting text'])
      }
    } catch (err) {
      const msg = String(err?.message || '')
      setWarnings([
        /501|not configured|GEMINI|OPENAI/i.test(msg)
          ? (isArabic ? 'تحليل الملفات بالذكاء الاصطناعي محتاج مفتاح GEMINI_API_KEY أو OPENAI_API_KEY على السيرفر — لحد ما يتبعت، لصق النص شغال كامل' : 'AI file parsing needs a server key — pasting text works meanwhile')
          : (isArabic ? `تعذر تحليل الملف: ${msg.slice(0, 80)}` : `Could not parse file: ${msg.slice(0, 80)}`),
      ])
    } finally { setAiBusy(false) }
  }

  const proceed = async () => {
    const clean = questions
      .map((q) => ({ ...q, text: String(q.text || '').trim(), choices: q.choices.map((c) => String(c || '').trim()).filter(Boolean) }))
      .filter((q) => q.choices.length >= 2)
    if (!title.trim()) { setError(isArabic ? 'اكتب عنوان الواجب' : 'Enter the homework title'); return }
    if (clean.length === 0) { setError(isArabic ? 'أضف سؤالًا واحدًا على الأقل (اختيارين على الأقل — النص اختياري)' : 'Add at least one question'); return }
    if (clean.some((q) => q.correct == null || q.correct < 0 || q.correct >= q.choices.length)) {
      setError(isArabic ? 'حدد الإجابة الصحيحة لكل سؤال' : 'Pick the correct answer for every question'); return
    }
    setError('')
    setBusy(true)
    const payload = {
      title, description, group_name: groupName || null, due_date: dueDate || null, video_url: videoUrl,
      questions: clean.map((q) => ({ text: q.text, choices: q.choices, correct: Number(q.correct) || 0, marks: Math.max(Number(q.marks) || 1, 0) })),
    }
    const saved = editTask ? await ws.updateHomeworkTask(editTask, payload) : await ws.createHomeworkTask(payload)
    setBusy(false)
    if (saved) (editTask ? onUpdated : onCreated)(saved)
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="nk-ws-head">
        <button className="nk-pill nk-pill-gold mb-2 cursor-pointer border-0" onClick={onCancel}>
          → {isArabic ? 'الرئيسية' : 'Home'}
        </button>
        <div className="nk-ws-muted text-[.62rem] font-black tracking-widest mb-1">HOMEWORK WORKSPACE</div>
        <h2 className="text-[1.15rem] sm:text-[1.3rem] font-black m-0 leading-snug">
          {editTask ? (isArabic ? 'تعديل الواجب' : 'Edit homework') : (isArabic ? 'واجب اختيار الإجابة' : 'New MCQ homework')}
        </h2>
        <p className="nk-ws-muted text-[.72rem] mt-1 mb-0">
          {isArabic
            ? 'الطالب يحل من صفحة الواجبات المخصصة — التصحيح تلقائي على السيرفر، التسليم مرة واحدة بس، والدرجة تتسجل لوحدها في الحصة الجاية.'
            : 'Students answer on the dedicated homework page — server-side grading, one submission only, auto-recorded into the next session.'}
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

          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">
              {isArabic ? '🎬 لينك فيديو الشرح (اختياري — الطالب يشوفه بعد التسليم بس)' : 'Explanation video link (optional — unlocked after submission)'}
            </span>
            <input dir="ltr" className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/..." />
          </label>

          {/* استيراد الأسئلة: لصق نص / رفع ملف */}
          {!editTask && (
            <div className="rounded-xl p-3" style={{ background: 'var(--surface-container)', border: '1px dashed var(--surface-border)' }}>
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-[.74rem] font-extrabold">{isArabic ? 'استيراد سريع:' : 'Quick import:'}</b>
                <button type="button" className="btn-ghost rounded-lg px-3 py-1.5 text-[.68rem] font-extrabold" onClick={() => setPasteOpen((v) => !v)}>
                  📋 {isArabic ? 'لصق نص الأسئلة' : 'Paste questions'}
                </button>
                <button type="button" className="btn-ghost rounded-lg px-3 py-1.5 text-[.68rem] font-extrabold" disabled={aiBusy} onClick={() => fileRef.current?.click()}>
                  {aiBusy ? '...' : (isArabic ? '📎 رفع ملف (نص/صورة/PDF)' : 'Upload file (text/image/PDF)')}
                </button>
                <input ref={fileRef} type="file" accept=".txt,.md,.csv,.png,.jpg,.jpeg,.webp,.pdf" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
              </div>
              {pasteOpen && (
                <div className="mt-2 grid gap-2">
                  <textarea
                    className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full min-h-[110px]"
                    dir="rtl"
                    placeholder={isArabic ? 'مثال:\n1) عاصمة مصر؟\nأ) القاهرة\nب) الإسكندرية\nالإجابة: أ\n\nأو صح / غلط مع «الإجابة: صح»' : '1) Question?\na) ...\nb) ...\nAnswer: a'}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  <button type="button" className="btn-ghost rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold self-start" onClick={applyPasted}>
                    {isArabic ? 'حلّل النص وأضف الأسئلة ←' : 'Parse & add questions →'}
                  </button>
                </div>
              )}
              {warnings.length > 0 && (
                <div className="nk-notice mt-2">
                  {warnings.slice(0, 4).map((w, i) => <div key={i} className="text-[.7rem] font-bold">• {w}</div>)}
                </div>
              )}
            </div>
          )}

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
              editorId="hw"
              optionalText
            />
          </div>

          {error && <div className="nk-notice" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-strong)' }}>{error}</div>}

          <div className="flex gap-2">
            <button className="btn-navy action-button !min-h-[3rem]" disabled={busy} onClick={proceed}>
              {busy ? '...' : (editTask ? (isArabic ? 'حفظ التعديل ←' : 'Save changes →') : (isArabic ? 'نشر الواجب ←' : 'Publish homework →'))}
            </button>
            <button className="btn-ghost action-button !min-h-[3rem]" onClick={onCancel}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── النتائج: من حل، الدرجة، تحليل المشاكل، إغلاق/فتح/تعديل ───────────────────
function HomeworkResults({ task }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(false)

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

  // TASK44d: تحليل الواجب — أكتر الأسئلة فيها مشاكل (طلبة فريق التحليل)
  const analytics = useMemo(
    () => buildQuizAnalytics(Object.values(subsByStudent), task.questions || []),
    [subsByStudent, task.questions],
  )

  const published = task.status === 'published'
  const createdLabel = (() => { try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long' }).format(new Date(task.created_at)) } catch { return '' } })()

  const toggleStatus = async () => {
    const ok = await ui.askConfirm(
      published
        ? (isArabic ? 'إغلاق الواجب؟ الطلاب مش هيقدروا يسلموا بعد كده.' : 'Close this homework? Students can no longer submit.')
        : (isArabic ? 'فتح الواجب تاني؟ اللي ما سلّمش يقدر يسلم — اللي سلّم مفيش له إعادة (التسليم مرة واحدة).' : 'Reopen? Students who never submitted can; submitted ones stay locked.'),
      { title: published ? (isArabic ? 'إغلاق الواجب' : 'Close homework') : (isArabic ? 'فتح الواجب' : 'Reopen'), confirmLabel: published ? (isArabic ? 'إغلاق' : 'Close') : (isArabic ? 'فتح' : 'Open') },
    )
    if (ok) ws.setHomeworkTaskStatus(task, published ? 'closed' : 'published')
  }

  const deleteTask = async () => {
    const ok = await ui.askConfirm(
      isArabic ? `حذف واجب «${task.title}» وكل التسليمات نهائيًا؟` : `Delete "${task.title}" and all submissions permanently?`,
      { title: isArabic ? 'حذف الواجب' : 'Delete homework', confirmLabel: isArabic ? 'حذف' : 'Delete', danger: true },
    )
    if (ok) { const done = await ws.deleteHomeworkTask(task); if (done) ui.goHomeworkHub() }
  }

  if (editing) {
    return (
      <HomeworkBuilder
        editTask={task}
        onUpdated={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    )
  }
  const canEdit = stats.solvedCount === 0

  return (
    <div className="flex flex-col gap-3">
      <section className="nk-ws-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {!ui.isMobile && (
              <button className="nk-pill nk-pill-gold mb-2 cursor-pointer border-0" onClick={ui.goHomeworkHub}>
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
              {task.video_url ? ` · 🎬 ${isArabic ? 'فيديو' : 'video'}` : ''}
              {createdLabel ? ` · ${createdLabel}` : ''}
            </p>
            {task.description && <p className="text-[.74rem] mt-1 mb-0 text-fg-muted">{task.description}</p>}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`nk-pill ${published ? 'nk-pill-live' : 'nk-pill-done'}`}>
              {published ? `● ${isArabic ? 'منشور' : 'Published'}` : `✓ ${isArabic ? 'مغلق' : 'Closed'}`}
            </span>
            <span className="flex gap-1.5">
              {canEdit && (
                <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" onClick={() => setEditing(true)}>
                  ✏️ {isArabic ? 'تعديل' : 'Edit'}
                </button>
              )}
              <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" onClick={toggleStatus}>
                {published ? (isArabic ? '🔒 إغلاق' : '🔒 Close') : (isArabic ? '🔓 فتح' : '🔓 Open')}
              </button>
              <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" style={{ color: 'var(--danger-strong)' }} onClick={deleteTask} aria-label={isArabic ? 'حذف الواجب' : 'Delete homework'}>🗑</button>
            </span>
          </div>
        </div>
        {!canEdit && (
          <p className="text-[.66rem] text-fg-muted mt-2 mb-0">
            {isArabic
              ? '✏️ التعديل مقفول — في طلاب سلّموا بالفعل (التسليم مرة واحدة عشان العدالة). لو عايز تغير حاجة جوهرية: اقفل الواجب واعمل واحد جديد.'
              : 'Editing is locked — students already submitted (one submission each). Close it and create a new one for major changes.'}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="nk-mini"><small>{isArabic ? 'الطلاب' : 'Students'}</small><b>{stats.total}</b></div>
          <div className="nk-mini nk-mini--ok"><small>{isArabic ? 'سلّموا' : 'Submitted'}</small><b>{stats.solvedCount} / {stats.total}</b></div>
          <div className="nk-mini nk-mini--gold"><small>{isArabic ? 'المتوسط %' : 'Average %'}</small><b>{stats.avg != null ? Math.round(stats.avg) : '—'}</b></div>
        </div>
      </section>

      {/* تحليل الواجب — أكتر الأسئلة فيها مشاكل */}
      {stats.solvedCount > 0 && (task.questions || []).length > 0 && (
        <section className="nk-content">
          <h3 className="text-[1rem] font-extrabold mt-0 mb-1">{isArabic ? '🔍 تحليل الواجب — أكتر الأسئلة فيها مشاكل' : 'Question analytics'}</h3>
          <p className="text-[.74rem] text-fg-muted mt-0 mb-3">
            {isArabic
              ? 'مرتبة من أكتر سؤال غلط — مفيد لفريق التحليل قبل الحصة الجاية.'
              : 'Sorted by most wrong answers — useful for the analysis team before the next session.'}
          </p>
          <div className="grid gap-2">
            {analytics.problemQuestions.slice(0, 6).map((pq) => (
              <div key={pq.index} className="nk-row">
                <span className="min-w-0">
                  <b className="truncate">{pq.label}</b>
                  <small>
                    {pq.wrong} {isArabic ? 'غلط' : 'wrong'} · {pq.correct} {isArabic ? 'صح' : 'right'}
                    {pq.blank > 0 ? ` · ${pq.blank} ${isArabic ? 'فاضي' : 'blank'}` : ''}
                  </small>
                </span>
                <span className={`nk-pill !text-[.66rem] ${pq.wrongPct >= 50 ? 'nk-pill-danger' : pq.wrongPct > 0 ? 'nk-pill-gold' : 'nk-pill-neutral'}`}>
                  {isArabic ? 'نسبة الغلط' : 'wrong'}: {pq.wrongPct}%
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="nk-content">
        <h3 className="text-[1rem] font-extrabold mt-0 mb-1">{isArabic ? 'تسليمات الطلاب' : 'Submissions'}</h3>
        <p className="text-[.74rem] text-fg-muted mt-0 mb-4">
          {isArabic
            ? 'التصحيح تلقائي على السيرفر فور التسليم — التسليم مرة واحدة بس لكل طالب (مفيش إعادة)، والدرجة بتتسجل لوحدها في الحصة الجاية.'
            : 'Auto-graded server-side on submit — one submission per student, auto-recorded into the next session.'}
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
                      : (isArabic ? 'لم يسلم بعد' : 'Not submitted yet')}
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
