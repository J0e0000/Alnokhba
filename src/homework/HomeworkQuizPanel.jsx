// ═══════════════════════════════════════════════════════════════════════════
// HOMEWORK QUIZ PANEL — واجب الاختيارات الإلكتروني (Task 44)
// بناية طلب المستر:
//   • نص السؤال اختياري (الواجب ممكن يكون في كتاب) — المهم الإجابات
//   • قوالب جاهزة فورًا: اختيارات أ/ب/ج/د أو صح وغلط — المدرس يحدد الإجابة
//   • يقدر يعدّل في الأسئلة والإجابات في أي وقت لاحقًا
//   • لو اترفع ملف أسئلة (صورة/PDF/نص) → محاولة فهمه واستخراج الأسئلة بإجاباتها
//   • لينك عام يتبعت للطلاب: الطالب يكتب رقمه بس ويسلّم (جهاز = تسليم واحد)
//   • لينك فيديو يظهر للطالب فقط بعد التسليم
//   • تحليل بسيط: أكتر الأسئلة فيها مشاكل + مين سلّم ومين لسه
// الرصد على السيرفر (migration 055) — الإجابات الصحيحة عمرها ما تُرسل للطالب.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useWorkspace } from '../store/WorkspaceStore'
import { describeEdgeFunctionError } from '../lib/edgeFunctionErrors'
import {
  newQuestion, normalizeQuestions, parseQuestionsText, buildQuizAnalytics,
  TRUE_FALSE_OPTIONS, READY_OPTION_LABELS,
} from '../lib/hwQuiz'

const LETTER_IDS = ['a', 'b', 'c', 'd', 'e', 'f']

function makeToken() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'الآن'
  if (m < 60) return `منذ ${m} دقيقة`
  const h = Math.floor(m / 60)
  if (h < 24) return `منذ ${h} ساعة`
  return `منذ ${Math.floor(h / 24)} يوم`
}

// ── محرر سؤال واحد (يُستخدم في البناء ومراجعة الاستخراج) ────────────────────
function QuestionEditor({ q, index, onChange, onDelete, onMoveUp, onMoveDown, total }) {
  const setQ = (patch) => onChange({ ...q, ...patch })
  const toggleCorrect = (optId) => {
    setQ({ correct_options: q.correct_options[0] === optId ? [] : [optId] })
  }
  const switchKind = (kind) => {
    if (kind === q.kind) return
    if (kind === 'true_false') setQ({ kind, options: TRUE_FALSE_OPTIONS.map((o) => ({ ...o })), correct_options: [] })
    else setQ({ kind, options: READY_OPTION_LABELS.slice(0, 4).map((label, i) => ({ id: LETTER_IDS[i], label })), correct_options: [] })
  }
  const setOption = (i, label) => {
    const options = q.options.map((o, oi) => (oi === i ? { ...o, label } : o))
    setQ({ options })
  }
  const addOption = () => {
    if (q.options.length >= 6) return
    const i = q.options.length
    setQ({ options: [...q.options, { id: LETTER_IDS[i], label: '' }] })
  }
  const removeOption = (i) => {
    if (q.options.length <= 2) return
    const removed = q.options[i]
    const options = q.options.filter((_, oi) => oi !== i)
    setQ({ options, correct_options: q.correct_options.filter((c) => c !== removed.id) })
  }

  return (
    <div className="nk-row !items-start flex-col gap-2.5" style={{ borderInlineStartWidth: 3, borderInlineStartColor: 'var(--brand-gold)' }}>
      <div className="flex items-center gap-2 w-full flex-wrap">
        <span className="nk-pill nk-pill-gold">سؤال {index + 1}</span>
        <span className="nk-seg">
          <button className={q.kind === 'mcq' ? 'nk-on' : ''} aria-pressed={q.kind === 'mcq'} onClick={() => switchKind('mcq')}>أ ب ج د</button>
          <button className={q.kind === 'true_false' ? 'nk-on' : ''} aria-pressed={q.kind === 'true_false'} onClick={() => switchKind('true_false')}>صح / غلط</button>
        </span>
        <span className="ms-auto flex items-center gap-1">
          <button className="nk-icon-btn" onClick={onMoveUp} disabled={index === 0} title="لأعلى">↑</button>
          <button className="nk-icon-btn" onClick={onMoveDown} disabled={index === total - 1} title="لأسفل">↓</button>
          <button className="nk-icon-btn" onClick={onDelete} title="حذف السؤال" style={{ color: '#dc2626' }}>🗑</button>
        </span>
      </div>

      <input
        className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full"
        placeholder="نص السؤال (اختياري — لو الواجب في الكتاب سيبه فاضي)"
        value={q.question_text}
        onChange={(e) => setQ({ question_text: e.target.value })}
      />

      {q.kind === 'true_false' ? (
        <div className="flex items-center gap-2 w-full">
          {q.options.map((o) => {
            const on = q.correct_options[0] === o.id
            return (
              <button
                key={o.id}
                onClick={() => toggleCorrect(o.id)}
                aria-pressed={on}
                className="rounded-xl px-5 py-2.5 text-sm font-extrabold border transition-all"
                style={on
                  ? { background: 'rgba(34,197,94,.18)', borderColor: 'rgba(34,197,94,.8)', color: '#15803D' }
                  : { background: 'var(--surface-container)', borderColor: 'var(--border-subtle, #e2e8f0)', color: 'var(--fg-muted)' }}
              >
                {on ? '✓ ' : ''}{o.label}
              </button>
            )
          })}
          <small className="text-fg-muted">اضغط على الإجابة الصحيحة</small>
        </div>
      ) : (
        <div className="grid gap-1.5 w-full">
          {q.options.map((o, i) => {
            const on = q.correct_options[0] === o.id
            return (
              <div key={o.id} className="flex items-center gap-2">
                <button
                  onClick={() => toggleCorrect(o.id)}
                  aria-pressed={on}
                  title={on ? 'دي الإجابة الصحيحة' : 'حددها كإجابة صحيحة'}
                  className="shrink-0 w-9 h-9 rounded-lg border font-extrabold text-sm"
                  style={on
                    ? { background: 'rgba(34,197,94,.18)', borderColor: 'rgba(34,197,94,.8)', color: '#15803D' }
                    : { background: 'var(--surface-container)', borderColor: 'var(--border-subtle, #e2e8f0)', color: 'var(--fg-muted)' }}
                >{on ? '✓' : o.id.toUpperCase()}</button>
                <input
                  className="glass-input rounded-xl px-3 py-2 text-sm flex-1"
                  placeholder={`الاختيار ${READY_OPTION_LABELS[i] || i + 1} (اختياري)`}
                  value={o.label}
                  onChange={(e) => setOption(i, e.target.value)}
                />
                {q.options.length > 2 && (
                  <button className="nk-icon-btn" onClick={() => removeOption(i)} title="حذف الاختيار">✕</button>
                )}
              </div>
            )
          })}
          {q.options.length < 6 && (
            <button className="text-[.72rem] font-extrabold text-start px-2 py-1 rounded-lg hover:bg-black/5" style={{ color: 'var(--brand-navy)' }} onClick={addOption}>
              + زوّد اختيار
            </button>
          )}
        </div>
      )}

      <input
        className="glass-input rounded-xl px-3 py-2 text-[.8rem] w-full"
        placeholder="تعليق/شرح يظهر للطالب بعد التسليم (اختياري)"
        value={q.explanation}
        onChange={(e) => setQ({ explanation: e.target.value })}
      />
    </div>
  )
}

// ═══════════════════════════════ اللوحة ═══════════════════════════════
export default function HomeworkQuizPanel({ lessonId }) {
  const ws = useWorkspace()
  const lesson = ws.lessonSessions.find((l) => l.id === lessonId) || null

  const [quiz, setQuiz] = useState(null)          // صف homework_quizzes الحالي
  const [questions, setQuestions] = useState([])  // أسئلة الواجب المحفوظة
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)   // وضع البناء/التعديل
  const [draft, setDraft] = useState(null)        // { title, instructions, video_url, questions }
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [extractOpen, setExtractOpen] = useState(false)
  const [extractText, setExtractText] = useState('')
  const [extractResult, setExtractResult] = useState(null) // { questions, warnings }
  const [extractBusy, setExtractBusy] = useState(false)
  const [extractError, setExtractError] = useState('')

  const groupStudents = useMemo(
    () => (lesson ? ws.sessionStudentsFor(lesson.group_name) : []),
    [lesson, ws],
  )

  const loadQuiz = useCallback(async (lid) => {
    if (!lid) { setQuiz(null); setQuestions([]); setSubmissions([]); return }
    setLoading(true)
    try {
      const { data: qz, error } = await supabase
        .from('homework_quizzes')
        .select('*, homework_quiz_questions(*)')
        .eq('lesson_session_id', lid)
        .maybeSingle()
      if (error) throw error
      if (!qz) { setQuiz(null); setQuestions([]); setSubmissions([]); return }
      const { id, homework_quiz_questions: qs, ...rest } = qz
      setQuiz({ ...rest, id })
      setQuestions(normalizeQuestions(qs || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)))
      const { data: subs } = await supabase
        .from('homework_quiz_submissions')
        .select('*')
        .eq('quiz_id', id)
        .order('submitted_at')
      setSubmissions(subs || [])
    } catch (err) {
      // migration 055 لسه مش مطبقة؟ (أو جدول ناقص) → اللوحة تختفي بأمان
      console.warn('[HomeworkQuizPanel] load failed:', err?.message || err)
      setQuiz(null); setQuestions([]); setSubmissions([])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadQuiz(lessonId) }, [lessonId, loadQuiz])

  const published = Boolean(quiz?.is_published)
  const quizLink = quiz?.access_token ? `${window.location.origin}/hw/${quiz.access_token}` : ''
  const analytics = useMemo(() => buildQuizAnalytics(submissions, questions), [submissions, questions])
  const submittedIds = useMemo(() => new Set(submissions.map((s) => s.student_id)), [submissions])
  const notSubmitted = groupStudents.filter((s) => !submittedIds.has(s.id))
  const nameOf = (sid) => ws.allStudents.find((s) => s.id === sid)?.name || 'طالب'

  // ── البناء ──────────────────────────────────────────────────────────────
  const startNew = () => {
    setDraft({ title: '', instructions: '', video_url: '', questions: [newQuestion('mcq', 0)] })
    setEditing(true)
  }
  const startEdit = () => {
    setDraft({ title: quiz?.title || '', instructions: quiz?.instructions || '', video_url: quiz?.video_url || '', questions: normalizeQuestions(questions) })
    setEditing(true)
  }

  const validateDraft = () => {
    const qs = draft.questions
    if (qs.length === 0) return 'لازم سؤال واحد على الأقل'
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i]
      if (q.kind === 'mcq') {
        const filled = q.options.filter((o) => o.label.trim() !== '')
        if (filled.length < 2) return `سؤال ${i + 1}: لازم اختيارين على الأقل`
      }
      if (!q.correct_options || q.correct_options.length !== 1) return `سؤال ${i + 1}: حدد الإجابة الصحيحة الأول`
    }
    return null
  }

  const saveDraft = async ({ publishAfter = false } = {}) => {
    const problem = validateDraft()
    if (problem) { ws.showToast(problem, 'error'); return }
    setSaving(true)
    try {
      const tid = ws.effectiveTeacherId
      let quizId = quiz?.id
      const patch = {
        title: draft.title.trim() || null,
        instructions: draft.instructions.trim() || null,
        video_url: draft.video_url.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (quizId) {
        const { error } = await supabase.from('homework_quizzes').update(patch).eq('id', quizId)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('homework_quizzes')
          .insert({ teacher_id: tid, lesson_session_id: lessonId, ...patch })
          .select('id')
          .single()
        if (error) throw error
        quizId = data.id
      }

      // حفظ بفرق ذكي: الأسئلة القديمة بتحتفظ بـ id بتاعها عشان تسليمات
      // الطلاب القديمة تفضل مرتبطة بيها (التعديل اللاحق مش بيكسر النتايج)
      const existingIds = new Set(questions.map((q) => q.id))
      const draftIds = new Set(draft.questions.map((q) => q.id))

      // حذف المحذوف
      const removed = questions.filter((q) => !draftIds.has(q.id) && existingIds.has(q.id))
      if (removed.length) {
        const { error } = await supabase.from('homework_quiz_questions').delete().in('id', removed.map((q) => q.id))
        if (error) throw error
      }
      // تحديث/إضافة
      for (let i = 0; i < draft.questions.length; i++) {
        const q = draft.questions[i]
        const row = {
          quiz_id: quizId,
          teacher_id: tid,
          position: i,
          question_text: q.question_text.trim() || null,
          kind: q.kind,
          options: q.options,
          correct_options: q.correct_options,
          explanation: q.explanation.trim() || null,
          updated_at: new Date().toISOString(),
        }
        if (existingIds.has(q.id)) {
          const { error } = await supabase.from('homework_quiz_questions').update(row).eq('id', q.id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('homework_quiz_questions').insert(row)
          if (error) throw error
        }
      }

      if (publishAfter) {
        const { error } = await supabase.from('homework_quizzes').update({ is_published: true }).eq('id', quizId)
        if (error) throw error
      }
      setEditing(false)
      setDraft(null)
      await loadQuiz(lessonId)
      ws.showToast(publishAfter ? 'اتحفظ واننشر — جيب اللينك وابعته للطلاب 👌' : 'اتحفظ التعديل ✅', 'success')
    } catch (err) {
      console.error('[HomeworkQuizPanel] save failed:', err)
      ws.showToast(`تعذر الحفظ: ${err?.message || 'خطأ غير معروف'}`, 'error')
    } finally { setSaving(false) }
  }

  const togglePublish = async () => {
    if (!quiz) return
    if (!published && questions.length === 0) { ws.showToast('ضيف سؤال واحد على الأقل قبل النشر', 'error'); return }
    setBusy(true)
    try {
      const { error } = await supabase.from('homework_quizzes')
        .update({ is_published: !published, updated_at: new Date().toISOString() }).eq('id', quiz.id)
      if (error) throw error
      setQuiz((prev) => ({ ...prev, is_published: !published }))
      ws.showToast(!published ? 'الواجب بقى شغال — اللينك جاهز للطلاب 🚀' : 'اتقفل اللينك — الطلاب مش هيقدروا يسلّموا', 'success')
    } catch (err) { ws.showToast(`تعذر التغيير: ${err?.message || ''}`, 'error') }
    finally { setBusy(false) }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(quizLink)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { ws.showToast('انسخه يدوي: ' + quizLink, 'info') }
  }
  const shareLink = async () => {
    const text = `📝 واجب «${quiz?.title || 'الحصة'}» — ادخل واجيب عليك: ${quizLink}`
    if (navigator.share) { try { await navigator.share({ title: 'واجب إلكتروني', text, url: quizLink }); return } catch { /* أسقط للنسخ */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const regenerateToken = async () => {
    if (!quiz) return
    if (!window.confirm('توليد لينك جديد هيلغي اللينك القديم — اللي بعته قبل كده مش هيشتغل. تكمّل؟')) return
    setBusy(true)
    try {
      const token = makeToken()
      const { error } = await supabase.from('homework_quizzes').update({ access_token: token, updated_at: new Date().toISOString() }).eq('id', quiz.id)
      if (error) throw error
      setQuiz((prev) => ({ ...prev, access_token: token }))
      ws.showToast('لينك جديد اتولّد ✅', 'success')
    } catch (err) { ws.showToast(`تعذر التوليد: ${err?.message || ''}`, 'error') }
    finally { setBusy(false) }
  }

  // ── استخراج الأسئلة من نص/ملف ───────────────────────────────────────────
  const openExtract = () => { setExtractOpen(true); setExtractError(''); setExtractResult(null); setExtractText('') }

  const runTextParse = (text) => {
    const { questions: parsed, warnings } = parseQuestionsText(text)
    setExtractResult({ questions: parsed, warnings })
  }

  const handleFile = async (file) => {
    if (!file) return
    setExtractError(''); setExtractResult(null)
    const isText = /\.(txt|md|csv|srt)$/i.test(file.name) || file.type.startsWith('text/')
    if (isText) {
      const text = await file.text()
      runTextParse(text)
      return
    }
    // صورة/PDF → محاولة فهم بالـ AI (Edge Function — محتاج مفتاح AI على السيرفر)
    setExtractBusy(true)
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
        reader.onerror = () => reject(new Error('read_failed'))
        reader.readAsDataURL(file)
      })
      const { data, error } = await supabase.functions.invoke('ai-parse-homework', {
        body: { file_base64: base64, mime: file.type || 'application/octet-stream', filename: file.name },
      })
      if (error) throw error
      const parsed = normalizeQuestions(data?.questions || [])
      if (!parsed.length) {
        setExtractError(data?.message || 'مقدرتش أطلع أسئلة من الملف — جرّب ملف أوضح أو اكتب الأسئلة يدويًا')
        return
      }
      setExtractResult({ questions: parsed, warnings: data?.warnings || [] })
    } catch (err) {
      const friendly = await describeEdgeFunctionError(err, { functionName: 'تحليل الأسئلة' })
      setExtractError(
        friendly.message +
        (friendly.status === 501 || /مفتاح|key/i.test(friendly.raw || '')
          ? ' — فهم الصور والـ PDF محتاج مفتاح AI على سيرفر النظام. النص المكتوب/الملصوق شغال من غيره.'
          : ''),
      )
    } finally { setExtractBusy(false) }
  }

  const startNewWith = (qs) => {
    setDraft({ title: '', instructions: '', video_url: '', questions: qs })
    setEditing(true)
  }

  const addExtracted = () => {
    if (!extractResult?.questions?.length) return
    const base = editing && draft ? draft : { title: '', instructions: '', video_url: '', questions: [] }
    const existing = base.questions || []
    const offset = existing.length
    const merged = [...existing, ...normalizeQuestions(extractResult.questions).map((q, i) => ({ ...q, position: offset + i, id: `q-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}` }))]
    if (!editing) startNewWith(merged)
    else setDraft({ ...base, questions: merged })
    setExtractOpen(false); setExtractResult(null); setExtractText('')
  }

  // ── عرض ─────────────────────────────────────────────────────────────────
  if (!lessonId || !lesson) return null

  return (
    <div className="mt-6 pt-5" style={{ borderTop: '1px dashed var(--border-subtle, #dbe3ee)' }}>
      {/* الرأس */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="nk-pill nk-pill-gold">📝 واجب إلكتروني (اختيارات)</span>
        {quiz && (
          <span className="nk-pill" style={{ background: published ? 'rgba(34,197,94,.15)' : 'var(--surface-container)', color: published ? '#15803D' : 'var(--fg-muted)' }}>
            {published ? '🟢 منشور — اللينك شغال' : '⚪ مش منشور'}
          </span>
        )}
        {quiz && submissions.length > 0 && <span className="nk-pill">تسليمات: {submissions.length}</span>}
        {!loading && !quiz && !editing && (
          <button className="btn-gold rounded-xl px-4 py-2 text-[.78rem] font-extrabold !min-h-[2.5rem] ms-auto" onClick={startNew}>
            + اعمل واجب اختيارات جاهز
          </button>
        )}
        {quiz && !editing && (
          <button className="nk-pill ms-auto hover:opacity-80 cursor-pointer" onClick={startEdit}>✎ تعديل الأسئلة والإجابات</button>
        )}
      </div>

      {/* البناء / التعديل */}
      {editing && draft && (
        <div className="grid gap-3 mb-4">
          <div className="grid sm:grid-cols-2 gap-2.5">
            <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm" placeholder="عنوان الواجب (اختياري — مثال: واجب الوحدة الثانية)"
              value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm" dir="ltr" placeholder="🎬 رابط فيديو الشرح (يظهر للطالب بعد التسليم فقط)"
              value={draft.video_url} onChange={(e) => setDraft({ ...draft, video_url: e.target.value })} />
          </div>
          <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm" placeholder="تعليمات للطلاب (اختياري — مثال: حِل من الكتاب صفحة 40 واختار الإجابات هنا)"
            value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />

          <div className="flex items-center gap-2 flex-wrap">
            <span className="nk-seg">
              <button onClick={() => setDraft({ ...draft, questions: [...draft.questions, newQuestion('mcq', draft.questions.length)] })}>+ سؤال اختيارات</button>
              <button onClick={() => setDraft({ ...draft, questions: [...draft.questions, newQuestion('true_false', draft.questions.length)] })}>+ سؤال صح وغلط</button>
            </span>
            <button className="nk-pill cursor-pointer hover:opacity-80" onClick={openExtract}>📄 ارفع ملف أسئلة / الصق نص</button>
          </div>

          <div className="grid gap-2.5">
            {draft.questions.map((q, i) => (
              <QuestionEditor
                key={q.id}
                q={q}
                index={i}
                total={draft.questions.length}
                onChange={(nq) => setDraft({ ...draft, questions: draft.questions.map((x, xi) => (xi === i ? nq : x)) })}
                onDelete={() => setDraft({ ...draft, questions: draft.questions.filter((_, xi) => xi !== i) })}
                onMoveUp={() => {
                  if (i === 0) return
                  const qs = [...draft.questions]; [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]
                  setDraft({ ...draft, questions: qs })
                }}
                onMoveDown={() => {
                  if (i === draft.questions.length - 1) return
                  const qs = [...draft.questions]; [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]]
                  setDraft({ ...draft, questions: qs })
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-gold rounded-xl px-4 py-2.5 text-[.8rem] font-extrabold !min-h-[2.6rem]" disabled={saving} onClick={() => saveDraft()}>
              {saving ? 'جاري الحفظ...' : (quiz ? 'حفظ التعديل' : 'حفظ الواجب')}
            </button>
            {!quiz && (
              <button className="btn-gold rounded-xl px-4 py-2.5 text-[.8rem] font-extrabold !min-h-[2.6rem]" disabled={saving} onClick={() => saveDraft({ publishAfter: true })}>
                حفظ + نشر فورًا 🚀
              </button>
            )}
            <button className="nk-pill" disabled={saving} onClick={() => { setEditing(false); setDraft(null) }}>إلغاء</button>
            {quiz && submissions.length > 0 && (
              <small className="text-fg-muted">فيه {submissions.length} تسليم محفوظ — التعديل مش هيغيّر درجاتهم اللي اتحسبت</small>
            )}
          </div>
        </div>
      )}

      {/* الواجب المحفوظ — ملخص + لينك + تحليل */}
      {!editing && quiz && (
        <div className="grid gap-3">
          {(quiz.title || quiz.instructions) && (
            <div className="nk-notice">
              {quiz.title && <b>{quiz.title}</b>}
              {quiz.instructions && <div className="text-[.82rem] mt-0.5">{quiz.instructions}</div>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="nk-pill">{questions.length} سؤال</span>
            {quiz.video_url && <span className="nk-pill">🎬 فيديو بعد التسليم</span>}
            <button className="nk-pill cursor-pointer hover:opacity-80" onClick={() => setShowAnalytics((v) => !v)}>
              📊 تحليل الواجب {submissions.length > 0 ? `(${submissions.length} تسليم)` : ''}
            </button>
          </div>

          {questions.length > 0 && (
            <div className="grid gap-1.5">
              {questions.map((q, i) => {
                const correctOpt = q.options.find((o) => o.id === q.correct_options[0])
                const correctLabel = correctOpt
                  ? (q.kind === 'true_false' ? correctOpt.label : `${correctOpt.id.toUpperCase()} — ${correctOpt.label || ''}`)
                  : '—'
                return (
                  <div key={q.id} className="nk-row !py-2 gap-2">
                    <b className="text-[.8rem]">{i + 1}.</b>
                    <span className="text-[.8rem] flex-1 min-w-0 truncate">{q.question_text?.trim() || '(من الكتاب — بدون نص)'}</span>
                    <span className="nk-pill" style={{ background: 'rgba(34,197,94,.13)', color: '#15803D' }}>✓ {correctLabel}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* اللينك */}
          <div className="nk-row flex-col !items-stretch gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <b className="text-[.82rem]">لينك التسليم:</b>
              {published
                ? <input readOnly dir="ltr" onFocus={(e) => e.target.select()} value={quizLink}
                    className="glass-input rounded-xl px-3 py-2 text-[.78rem] flex-1 min-w-[220px]" style={{ background: '#F8FAFC' }} />
                : <small className="text-fg-muted">انشر الواجب الأول ليظهر اللينك</small>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {published && (
                <>
                  <button className="btn-gold rounded-xl px-4 py-2 text-[.76rem] font-extrabold" onClick={copyLink}>{copied ? '✓ اتنسخ' : 'نسخ اللينك'}</button>
                  <button className="btn-gold rounded-xl px-4 py-2 text-[.76rem] font-extrabold" onClick={shareLink}>ابعت للطلاب ↗</button>
                </>
              )}
              <button className="nk-pill" disabled={busy} onClick={togglePublish}>{published ? '⏸ قفل اللينك' : '🚀 نشر الواجب'}</button>
              {published && <button className="nk-pill" disabled={busy} onClick={regenerateToken}>♻️ لينك جديد</button>}
            </div>
            {published && (
              <small className="text-fg-muted">
                الطالب يفتح اللينك → يكتب رقمه (تليفون أو كود) → يجاوب → التسليم مرة واحدة فقط، وكل جهاز ليه تسليم واحد.
                الدرجة تتحفظ لوحدها وتتسجل في الحصة اللي وراها.
              </small>
            )}
          </div>

          {/* التسليمات */}
          {submissions.length > 0 && (
            <div className="grid gap-1.5">
              <b className="text-[.82rem]">التسليمات ({submissions.length})</b>
              {submissions.map((s) => {
                const pct = Number(s.max_score) > 0 ? Math.round((Number(s.score) / Number(s.max_score)) * 100) : 0
                return (
                  <div key={s.id} className="nk-row !py-2 gap-2">
                    <b className="text-[.8rem] flex-1 min-w-0 truncate">{nameOf(s.student_id)}</b>
                    <small className="text-fg-muted">{timeAgo(s.submitted_at)}</small>
                    <span className="nk-pill" style={{ background: pct >= 50 ? 'rgba(34,197,94,.13)' : 'rgba(239,68,68,.13)', color: pct >= 50 ? '#15803D' : '#B91C1C' }}>
                      {s.score}/{s.max_score} ({pct}%)
                    </span>
                  </div>
                )
              })}
              {notSubmitted.length > 0 && (
                <div className="nk-notice">
                  لسه مسلّمش ({notSubmitted.length}): {notSubmitted.map((s) => s.name).join('، ')}
                </div>
              )}
            </div>
          )}
          {submissions.length === 0 && published && (
            <div className="nk-notice">لسه مفيش تسليمات — التسليمات بتظهر هنا لحظة وصولها (أو بعد تحديث الصفحة).</div>
          )}

          {/* التحليل */}
          {showAnalytics && submissions.length > 0 && (
            <div className="grid gap-2">
              <div className="nk-notice">
                متوسط النتايج: <b>{analytics.avgPct}%</b> — عدد التسليمات: <b>{analytics.total}</b>
              </div>
              {analytics.problemQuestions.some((p) => p.wrong > 0) && (
                <div className="grid gap-1.5">
                  <b className="text-[.82rem]">⚠️ أكتر الأسئلة فيها مشاكل (فريق التحليل):</b>
                  {analytics.problemQuestions.filter((p) => p.wrong > 0).map((p) => (
                    <div key={p.id} className="nk-row !py-2 gap-2">
                      <span className="text-[.8rem] flex-1 min-w-0 truncate">{p.label}</span>
                      <span className="nk-pill" style={{ background: p.wrongPct >= 50 ? 'rgba(239,68,68,.14)' : 'rgba(245,158,11,.14)', color: p.wrongPct >= 50 ? '#B91C1C' : '#B45309' }}>
                        {p.wrong} غلط من {analytics.total} ({p.wrongPct}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* مودال الاستخراج */}
      {extractOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" style={{ background: 'rgba(10,18,40,.55)' }} onClick={() => !extractBusy && setExtractOpen(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-2xl max-h-[85vh] overflow-auto grid gap-3" onClick={(e) => e.stopPropagation()} style={{ direction: 'rtl' }}>
            <b>📄 استخراج الأسئلة من ملف أو نص</b>
            <p className="text-[.78rem] text-fg-muted">
              ارفع صورة/PDF فيه الأسئلة (الفهم الذكي محتاج مفتاح AI على السيرفر) — أو الصق نص الأسئلة ونا فاهم الصيغة الشائعة
              (س1/1- ثم أ) ب) ج) د) و«الإجابة:»). راجع النتيجة قبل الإضافة.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="btn-gold rounded-xl px-4 py-2 text-[.78rem] font-extrabold cursor-pointer">
                اختر ملف (صورة / PDF / نص)
                <input type="file" accept=".txt,.md,.csv,image/*,application/pdf" className="hidden"
                  onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
              </label>
              <span className="text-[.72rem] text-fg-muted">أو الصق النص:</span>
            </div>
            <textarea
              className="glass-input rounded-xl px-3 py-2.5 text-sm min-h-[120px]"
              placeholder={'مثال:\n1) عاصمة مصر؟\nأ) القاهرة\nب) أسوان\nالإجابة: أ\n\n2) الشمس تشرق من الشرق\nصح / غلط\nالإجابة: صح'}
              value={extractText}
              onChange={(e) => setExtractText(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button className="btn-gold rounded-xl px-4 py-2 text-[.78rem] font-extrabold" disabled={extractBusy || !extractText.trim()} onClick={() => runTextParse(extractText)}>
                جرّب الفهم
              </button>
              {extractBusy && <span className="nk-pill">جاري تحليل الملف...</span>}
            </div>
            {extractError && <div className="nk-notice" style={{ color: '#B91C1C' }}>{extractError}</div>}
            {extractResult && (
              <div className="grid gap-2">
                {extractResult.warnings.length > 0 && (
                  <div className="nk-notice" style={{ color: '#B45309' }}>
                    {extractResult.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                  </div>
                )}
                <div className="grid gap-2">
                  {extractResult.questions.map((q, i) => (
                    <QuestionEditor
                      key={q.id}
                      q={q}
                      index={i}
                      total={extractResult.questions.length}
                      onChange={(nq) => setExtractResult({ ...extractResult, questions: extractResult.questions.map((x, xi) => (xi === i ? nq : x)) })}
                      onDelete={() => setExtractResult({ ...extractResult, questions: extractResult.questions.filter((_, xi) => xi !== i) })}
                      onMoveUp={() => {
                        if (i === 0) return
                        const qs = [...extractResult.questions]; [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]
                        setExtractResult({ ...extractResult, questions: qs })
                      }}
                      onMoveDown={() => {
                        if (i === extractResult.questions.length - 1) return
                        const qs = [...extractResult.questions]; [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]]
                        setExtractResult({ ...extractResult, questions: qs })
                      }}
                    />
                  ))}
                </div>
                <button className="btn-gold rounded-xl px-4 py-2.5 text-[.8rem] font-extrabold" onClick={addExtracted}>
                  + ضيف {extractResult.questions.length} سؤال للواجب
                </button>
              </div>
            )}
            <div className="flex justify-start">
              <button className="nk-pill" disabled={extractBusy} onClick={() => setExtractOpen(false)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
