/**
 * صفحة الواجبات المخصصة — /hw/:token (Task 44d)
 * ═══════════════════════════════════════════════════════════════════════════
 * طلب المستر: «لما أدوس تسليم الواجب يودّيني لصفحة مخصصة للواجبات» —
 * صفحة عامة بالتوكن (من غير تسجيل دخول) مخصصة بالكامل للواجبات:
 *
 *   1) قائمة الواجبات: العنوان/الوصف/آخر موعد + الحالة (تسلّم ✓ أو لم تسلّم)
 *   2) الإجابة: أ ب ج د / صح وغلط — نص السؤال اختياري (الواجب ممكن يكون في الكتاب)
 *      ألوان واضحة عمدًا: كروت بيضاء + نص غامق + الاختيار المحدد دهبي —
 *      (إصلاح مشكلة «الإجابات مش ظاهرة»: WHITE كان متعرّف بالغلط navy!)
 *   3) التسليم مرة واحدة بس (058: ممنوع الإعادة — السيرفر بيحسم)
 *   4) بعد التسليم: النتيجة فورًا + مراجعة ✓/✗ لكل سؤال + فيديو الشرح
 *      (مقفول قبل التسليم — السيرفر مش بيبعت اللينك غير بعد التسليم)
 *
 * الرصد كله على السيرفر: submit_homework_task_answers (migration 058) —
 * الإجابات الصحيحة عمرها ما توصل للمتصفح قبل التسليم.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { gradeOf } from '../lib/helpers'

const NAVY = '#142D62'
const GOLD = '#A65700'
const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و']

// ألوان المراجعة — واضحة عمدًا (طلب المستر: الألوان لازم تكون أوضح)
const C = {
  ok: { bg: 'rgba(34,197,94,.13)', border: '2px solid rgba(34,197,94,.8)', text: '#15803D' },
  bad: { bg: 'rgba(239,68,68,.10)', border: '2px solid rgba(239,68,68,.8)', text: '#B91C1C' },
  blank: { bg: 'rgba(100,116,139,.08)', border: '2px solid rgba(100,116,139,.35)', text: '#475569' },
}

export default function PublicHomeworkPage() {
  const [state, setState] = useState('loading') // loading | ready | not_found | error
  const [errorMsg, setErrorMsg] = useState('')
  const [payload, setPayload] = useState(null)  // get_student_portal_data payload
  const [openTaskId, setOpenTaskId] = useState(null)
  const [answers, setAnswers] = useState({})    // taskId → [choiceIdx|null]
  const [results, setResults] = useState({})    // taskId → submit RPC result
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const tokenRef = useRef('')
  const retryCountRef = useRef(0)
  const loadSeqRef = useRef(0)

  // Task 44g: /hw/:token/:taskId? — الجزء التاني (اختياري) هو واجب معيّن
  // جاي من لينك إشعار «في واجب نزل». قبل كده التوكن كان بيتلقط بالكامل مع
  // الـ /taskId فكان بيفشل — دلوقتي: أول segment = توكن، التاني = واجب يفتح.
  const pathRest = window.location.pathname.replace(/^\/hw\//, '').split(/[?#]/)[0]
  const token = pathRest.split('/')[0] || ''
  const urlTaskId = pathRest.split('/')[1] || null

  // Task 44g: استكمال بعد الريفرش — الإجابات والواجب المفتوح بيتحفظوا محليًا
  // (التسليم الفعلي سيرفر-آثوريتيتف، فمفيش أي احتمال غش: اللي متخزن محليًا
  // مجرد UI state، والتصحيح دايمًا من submit_homework_task_answers).
  const hwStoreKey = `nokhba_hw_${token}`
  const hwRestoredRef = useRef(false)

  const load = useCallback(async (isRetry = false) => {
    if (!token) { setState('not_found'); return }
    const seq = ++loadSeqRef.current
    tokenRef.current = token
    try {
      const { data, error } = await supabase.rpc('get_student_portal_data', { p_token: token })
      if (error) throw error
      if (seq !== loadSeqRef.current) return
      if (!data || !data.student) { setState('not_found'); return }
      setPayload(data)
      retryCountRef.current = 0
      setState('ready')
    } catch (err) {
      console.error('[PublicHomeworkPage] load error:', err?.message || err, err?.code || '')
      // توكن غلط/ملغي → صفحة «الرابط غير متاح» مش خطأ سيرفر
      if (/student_not_found|invalid_token/i.test(String(err?.message || ''))) {
        if (seq !== loadSeqRef.current) return
        setState('not_found'); return
      }
      if (!isRetry && retryCountRef.current < 1) {
        retryCountRef.current += 1
        setTimeout(() => load(true), 900)
        return
      }
      setState('error')
      setErrorMsg(`خطأ في الخادم: ${err?.message || 'خطأ غير معروف'}${err?.code ? ` (كود: ${err.code})` : ''}`)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  // ── Task 44g: استرجاع حالة الريفرش (مرة واحدة أول ما البيانات تجهز) ─────
  const student = payload?.student || {}
  const tasksRaw = (payload?.homework_tasks || [])

  useEffect(() => {
    if (state !== 'ready' || hwRestoredRef.current) return
    hwRestoredRef.current = true
    const tasks = tasksRaw
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(hwStoreKey) || 'null') } catch { saved = null }
    const savedAnswers = (saved && typeof saved.answers === 'object' && saved.answers) || {}
    // إجابات واجبات سلّمها الطالب (اتحفظت سيرفرًا) أو اتحذت → تتسقط
    const cleanAnswers = {}
    for (const [tid, arr] of Object.entries(savedAnswers)) {
      const t = tasks.find((x) => x && x.id === tid)
      if (t && !t.submission && Array.isArray(arr)) cleanAnswers[tid] = arr
    }
    if (Object.keys(cleanAnswers).length) setAnswers(cleanAnswers)
    // الواجب المفتوح: أولوية للينك المباشر (إشعار) وبعدهن المحفوظ المحلي
    const candidate = urlTaskId || saved?.open || null
    if (candidate) {
      const t = tasks.find((x) => x && x.id === candidate)
      if (t && t.has_questions && !t.submission) setOpenTaskId(candidate)
    }
  }, [state, tasksRaw, hwStoreKey, urlTaskId])

  // ── Task 44g: حفظ الحالة مع كل تغيير (بعد الاسترجاع بس) ─────────────────
  useEffect(() => {
    if (state !== 'ready' || !hwRestoredRef.current) return
    try {
      localStorage.setItem(hwStoreKey, JSON.stringify({ open: openTaskId, answers, ts: Date.now() }))
    } catch { /* خصوصي/ممتلئ — نتجاهل بأمان */ }
  }, [openTaskId, answers, state, hwStoreKey])
  const tasks = tasksRaw.filter((t) => t && t.has_questions)
  const simpleTasks = tasksRaw.filter((t) => t && !t.has_questions)
  const branding = payload?.branding || {}
  const centerName = branding.display_name || branding.center_name || 'النخبة'

  const refreshTaskFromList = (taskId, sub) => {
    // local echo: حدّث التسليم في القائمة بدون انتظار ريفريش كامل
    setPayload((prev) => prev ? {
      ...prev,
      homework_tasks: (prev.homework_tasks || []).map((t) => t.id === taskId
        ? { ...t, submission: { score: sub.score, max_score: sub.max_score, correct_count: sub.correct_count, question_count: sub.question_count, submitted_at: sub.submitted_at, results: sub.results || null } }
        : t),
    } : prev)
  }

  const pick = (taskId, qIdx, choiceIdx) => {
    setAnswers((prev) => {
      const cur = Array.isArray(prev[taskId]) ? [...prev[taskId]] : []
      cur[qIdx] = choiceIdx
      return { ...prev, [taskId]: cur }
    })
  }

  const submit = async (task) => {
    if (busy) return
    const questions = Array.isArray(task.questions) ? task.questions : []
    const answerArr = questions.map((_, i) => (answers[task.id]?.[i] ?? null))
    if (answerArr.every((a) => a == null)) {
      setSubmitError('اختار إجابة سؤال واحد على الأقل قبل التسليم')
      return
    }
    setBusy(true); setSubmitError('')
    try {
      const { data, error } = await supabase.rpc('submit_homework_task_answers', {
        p_token: tokenRef.current,
        p_task_id: task.id,
        p_answers: answerArr,
      })
      if (error) {
        console.warn('[PublicHomeworkPage] submit failed:', error.message)
        setSubmitError(/task_closed/i.test(error.message)
          ? 'الواجب اتقفل — تواصل مع المستر.'
          : 'تعذر التسليم — تأكد من الإنترنت وحاول تاني.')
        return
      }
      // ok أو already_submitted: النتيجة نفسها — التسليم مرة واحدة بس (058)
      setResults((prev) => ({ ...prev, [task.id]: data }))
      refreshTaskFromList(task.id, data)
      // Task 44g: نضّف الإجابات المحلية للواجب ده — النتيجة بقت على السيرفر
      setAnswers((prev) => { const next = { ...prev }; delete next[task.id]; return next })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      console.error('[PublicHomeworkPage] submit threw:', err)
      setSubmitError('تعذر التسليم (مشكلة اتصال). تحقق من الإنترنت وحاول مرة أخرى.')
    } finally { setBusy(false) }
  }

  // ── الشاشات ───────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return <Shell centerName={centerName}><p style={loadingText}>جاري التحميل...</p></Shell>
  }
  if (state === 'not_found') {
    return (
      <Shell centerName={centerName}>
        <div style={card}>
          <div style={bigIcon}>🔒</div>
          <h2 style={title}>الرابط غير متاح</h2>
          <p style={desc}>الواجبات دي مش موجودة أو الرابط قديم/اتقفل. اطلب لينك جديد من المدرس.</p>
        </div>
      </Shell>
    )
  }
  if (state === 'error') {
    return (
      <Shell centerName={centerName}>
        <div style={card}>
          <div style={bigIcon}>⚠️</div>
          <h2 style={title}>حدث خطأ</h2>
          <p style={desc}>{errorMsg || 'حاول مرة أخرى.'}</p>
          <button style={primaryBtn} onClick={() => { setState('loading'); load() }}>إعادة المحاولة</button>
        </div>
      </Shell>
    )
  }

  const openTask = tasks.find((t) => t.id === openTaskId) || null
  const openResult = openTask ? (results[openTask.id] || openTask.submission || null) : null

  // ── شاشة واجب مفتوح (إجابة أو نتيجة) ─────────────────────────────────────
  if (openTask) {
    const questions = Array.isArray(openTask.questions) ? openTask.questions : []
    const sub = openResult
    const answered = questions.filter((_, i) => (answers[openTask.id]?.[i] ?? null) != null).length
    const already = Boolean(openTask.submission)
    return (
      <Shell centerName={centerName}>
        <button style={backBtn} onClick={() => { setOpenTaskId(null); setSubmitError('') }}>→ رجوع للواجبات</button>

        <div style={headerCard}>
          <div style={hwBadge}>📝 {openTask.title}</div>
          {openTask.description && <p style={desc}>{openTask.description}</p>}
          <p style={meta}>
            {questions.length} سؤال · إجمالي {Number(openTask.max_score) || questions.length} درجة
            {openTask.due_date ? ` · آخر موعد: ${openTask.due_date}` : ''}
          </p>
        </div>

        {/* التسليم تم — نتيجة + مراجعة (مفيش إعادة إرسال خالص) */}
        {already && sub ? (
          <ResultView task={openTask} sub={sub} />
        ) : (
          <>
            {questions.map((q, qi) => {
              const choices = Array.isArray(q.choices) ? q.choices : []
              const chosen = answers[openTask.id]?.[qi] ?? null
              return (
                <div style={card} key={qi}>
                  <p style={qText}>
                    <span style={qNum}>{qi + 1}</span>
                    {String(q.text || '').trim() ? String(q.text) : <span style={{ color: '#64748B' }}>الواجب في الكتاب — اختار الإجابة من عندك</span>}
                    {Number(q.marks) > 0 && Number(q.marks) !== 1 && <span style={qMarks}> ({Number(q.marks)} درجات)</span>}
                  </p>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {choices.map((c, ci) => {
                      const picked = chosen === ci
                      return (
                        <button
                          key={ci}
                          onClick={() => pick(openTask.id, qi, ci)}
                          style={optionBtn(picked)}
                          aria-pressed={picked}
                        >
                          <span style={optionLetter(picked)}>{LETTERS[ci] || ci + 1}</span>
                          <span style={{ flex: 1, textAlign: 'start', fontWeight: picked ? 900 : 700, fontSize: 15, color: '#1E293B' }}>
                            {String(c || `الاختيار ${ci + 1}`)}
                          </span>
                          {picked && <span style={{ fontSize: 18, color: GOLD }}>✓</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            <div style={card}>
              <p style={{ margin: '0 0 10px', fontWeight: 800, fontSize: 13.5, color: NAVY, textAlign: 'center' }}>
                جاوبت على {answered} من {questions.length}
              </p>
              <button style={primaryBtn} disabled={busy} onClick={() => submit(openTask)}>
                {busy ? 'جاري التصحيح...' : `تسليم الواجب ✓ (${answered}/${questions.length})`}
              </button>
              <p style={{ ...hint, textAlign: 'center', margin: '8px 0 0' }}>
                ⚠️ التسليم مرة واحدة بس — بعد ما تدوس تسليم مفيش إعادة ولا تعديل.
              </p>
              {submitError && <p style={{ ...errorText, textAlign: 'center' }}>{submitError}</p>}
            </div>
          </>
        )}
      </Shell>
    )
  }

  // ── قائمة الواجبات ────────────────────────────────────────────────────────
  return (
    <Shell centerName={centerName}>
      <div style={headerCard}>
        <div style={hwBadge}>📚 صفحة الواجبات</div>
        {/* Task 44g إصلاح تباين: العنوان كان NAVY على خلفية NAVY (شبه مخفي في الصورة) —
            الهيدر الملاكي دايمًا غامق فلازم اللون أبيض ثابت في الوضعين */}
        <h1 style={titleLight}>واجبات {student.name || 'الطالب'}</h1>
        {student.group_name && <p style={meta}>مجموعة: {student.group_name}</p>}
        <p style={meta}>اختار الواجب اللي عايز تسلّمه — الإجابة مرة واحدة بس لكل واجب</p>
      </div>

      {tasks.length === 0 && simpleTasks.length === 0 && (
        <div style={card}>
          <div style={bigIcon}>🎉</div>
          <h2 style={title}>مفيش واجبات حالية</h2>
          <p style={desc}>لحد ما المستر ينزل واجب جديد — ساعتها هيظهر هنا على طول.</p>
        </div>
      )}

      {tasks.map((t) => {
        const sub = t.submission
        const pct = sub && Number(sub.max_score) > 0 ? Math.round((Number(sub.score) / Number(sub.max_score)) * 100) : null
        return (
          <div style={card} key={t.id}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ ...title, margin: '0 0 2px' }}>{t.title}</h2>
                <p style={{ margin: 0, fontSize: 12.5, color: '#64748B', fontWeight: 700 }}>
                  {(t.questions || []).length} سؤال · إجمالي {Number(t.max_score) || (t.questions || []).length} درجة
                  {t.due_date ? ` · آخر موعد: ${t.due_date}` : ''}
                </p>
                {t.description && <p style={{ ...desc, margin: '6px 0 0' }}>{t.description}</p>}
              </div>
              {sub ? (
                <span style={pillOk}>تسلّم ✓</span>
              ) : (
                <span style={pillPending}>لسه</span>
              )}
            </div>
            {sub && (
              <div style={scoreLine}>
                نتيجتك: <b>{Number(sub.score)} / {Number(sub.max_score)}</b>
                {pct != null && <> · <b style={{ color: pct >= 50 ? '#15803D' : '#B91C1C' }}>{pct}%</b></>}
                <span style={{ color: '#64748B', fontWeight: 700 }}> — اضغط لمراجعة الإجابات</span>
              </div>
            )}
            <button
              style={sub ? ghostBtn : primaryBtn}
              onClick={() => { setOpenTaskId(t.id); setSubmitError(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            >
              {sub ? 'شوف نتيجتك ومراجعة الإجابات ←' : 'تسليم الواجب ←'}
            </button>
          </div>
        )
      })}

      {/* واجبات تحديد كمكتمل (بدون أسئلة) — نفس روح البوابة */}
      {simpleTasks.length > 0 && (
        <div style={{ ...card, background: 'rgba(251,156,27,.05)' }}>
          <b style={{ display: 'block', marginBottom: 6, color: NAVY, fontSize: 14 }}>واجبات بدون أسئلة</b>
          {simpleTasks.map((t) => (
            <p key={t.id} style={{ margin: '4px 0', fontSize: 13, fontWeight: 700, color: '#475569' }}>
              • {t.title}{t.due_date ? ` — آخر موعد: ${t.due_date}` : ''} <span style={{ color: '#94A3B8' }}>(تتحدد من البوابة)</span>
            </p>
          ))}
        </div>
      )}

      <a href={`/qr/${tokenRef.current}`} style={backLink}>→ العودة لبوابة الطالب</a>
    </Shell>
  )
}

// ── بطاقة النتيجة + المراجعة ───────────────────────────────────────────────
function ResultView({ task, sub }) {
  const per = Array.isArray(sub.results) ? sub.results : []
  const questions = Array.isArray(task.questions) ? task.questions : []
  const pct = Number(sub.max_score) > 0 ? Math.round((Number(sub.score) / Number(sub.max_score)) * 100) : 0
  const gradeName = gradeOf(Number(sub.score), Number(sub.max_score))
  const hasReview = per.length === questions.length && questions.length > 0
  return (
    <>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={hwBadge}>✅ التسليم وصل — الدرجة اتحفظت</div>
        <div style={scoreRing(pct)}>
          <div style={scoreInner}>
            <b style={{ fontSize: 30, color: NAVY }}>{Number(sub.score)}<small style={{ fontSize: 15, color: '#64748B' }}> / {Number(sub.max_score)}</small></b>
            <span style={{ fontSize: 14, fontWeight: 800, color: pct >= 50 ? '#15803D' : '#B91C1C' }}>{pct}%</span>
          </div>
        </div>
        {gradeName && <p style={{ margin: '6px 0 0', fontWeight: 800, fontSize: 15, color: GOLD }}>التقدير: {gradeName}</p>}
        <p style={{ fontSize: 12.5, color: '#15803D', fontWeight: 800, margin: '8px 0 0' }}>
          {sub.correct_count}/{sub.question_count} إجابة صحيحة ✓
        </p>
        <p style={{ ...hint, marginTop: 6 }}>
          الدرجة اتحفظت تلقائيًا وهتتسجل في الحصة الجاية — ومينفعش إعادة التسليم.
        </p>
      </div>

      {/* فيديو الشرح — مقفول قبل التسليم، مفتوح هنا فقط (السيرفر هو اللي بيبعته) */}
      {task.video_url && (
        <div style={{ ...card, borderColor: 'rgba(166,87,0,.5)' }}>
          <b style={{ color: GOLD, display: 'block', marginBottom: 8 }}>🎬 فيديو شرح الواجب — اتفتح ليك بعد ما سلّمت</b>
          <a href={task.video_url} target="_blank" rel="noopener noreferrer" style={videoBtn}>افتح الفيديو ↗</a>
        </div>
      )}

      {hasReview && (
        <div style={card}>
          <b style={{ display: 'block', marginBottom: 8, color: NAVY }}>مراجعة إجاباتك</b>
          <div style={legend}>
            <span><i style={dot(C.ok.border)} /> صح</span>
            <span><i style={dot(C.bad.border)} /> غلط</span>
            <span><i style={dot(C.blank.border)} /> ما جبتش عليها</span>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {questions.map((q, qi) => {
              const chosen = (sub.answers && Number.isInteger(sub.answers[qi])) ? sub.answers[qi] : null
              const isOk = per[qi] === true
              const palette = isOk ? C.ok : chosen == null ? C.blank : C.bad
              const chosenText = chosen != null ? String(q.choices?.[chosen] ?? '—') : '—'
              return (
                <div key={qi} style={reviewCard(palette)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      width: 26, height: 26, borderRadius: 99, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 900, fontSize: 14, color: '#fff', flexShrink: 0,
                      background: isOk ? '#16A34A' : chosen == null ? '#94A3B8' : '#DC2626',
                    }}>{isOk ? '✓' : chosen == null ? '—' : '✗'}</span>
                    <b style={{ fontSize: 14, color: NAVY }}>
                      {String(q.text || '').trim() ? String(q.text) : `السؤال ${qi + 1}`}
                    </b>
                  </div>
                  <div style={answerLine(palette)}>
                    <span>إجابتك</span>
                    <b>{chosen != null ? `${LETTERS[chosen] || ''} — ${chosenText}` : 'ما جبتش عليها'}</b>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

// ── الأنماط (نفس لغة البوابة — inline styles، RTL، Cairo) ──────────────────
function Shell({ children, centerName }) {
  return (
    <div style={{
      minHeight: '100vh', fontFamily: "'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif",
      background: 'linear-gradient(160deg, #f4f7fb 0%, #ffffff 52%, #eef3f7 100%)',
      direction: 'rtl', padding: '18px 14px 40px', maxWidth: 640, margin: '0 auto',
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={topBar}>
        <span style={topMark}>ن</span>
        <b style={topName}>{centerName}</b>
      </div>
      {children}
      <p style={footer}>Powered by النخبة</p>
    </div>
  )
}

const topBar = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }
const topMark = {
  width: 34, height: 34, borderRadius: 11, background: `linear-gradient(135deg, ${NAVY}, #24418C)`,
  color: '#FB9C1B', fontWeight: 900, fontSize: 17, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const topName = { color: NAVY, fontSize: 14.5, fontWeight: 900 }
const card = {
  background: '#fff', borderRadius: 20, padding: 18,
  border: '1px solid rgba(148,163,184,.30)', boxShadow: '0 10px 30px rgba(20,45,98,.07)',
}
const headerCard = { ...card, textAlign: 'center', background: `linear-gradient(160deg, ${NAVY} 0%, #24418C 100%)`, color: '#fff', border: 'none' }
const hwBadge = {
  display: 'inline-block', padding: '4px 14px', borderRadius: 99, marginBottom: 8,
  background: 'rgba(251,156,27,.18)', color: '#FDBA74', fontSize: 12, fontWeight: 800,
}
const title = { margin: '0 0 4px', fontSize: 20, fontWeight: 900, color: NAVY }
// Task 44g: نسخة فاتحة للعناوين جوّه headerCard (navy gradient) — كانت NAVY
// على NAVY فبانت شبه مختفية. #fff ثابت لأن الخلفية navy في كل الأوضاع.
const titleLight = { ...title, color: '#FFFFFF', textShadow: '0 1px 2px rgba(2,6,23,.35)' }
const meta = { margin: 0, fontSize: 13, opacity: 0.9 }
const desc = { margin: '10px 0 0', fontSize: 14, lineHeight: 1.7, opacity: 0.95 }
const loadingText = { textAlign: 'center', color: '#64748B', fontWeight: 700 }
const footer = { textAlign: 'center', fontSize: 12, color: '#94A3B8', margin: '6px 0 0' }
const bigIcon = { fontSize: 42, marginBottom: 8 }
const hint = { display: 'block', fontSize: 12, color: '#64748B', lineHeight: 1.6 }
const errorText = { color: '#B91C1C', fontWeight: 800, fontSize: 13, marginTop: 10 }
const qText = { fontSize: 15, fontWeight: 900, color: NAVY, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
const qNum = {
  width: 26, height: 26, borderRadius: 9, background: 'rgba(20,45,98,.08)', color: NAVY,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, flexShrink: 0,
}
const qMarks = { fontSize: 12, color: GOLD, fontWeight: 800 }
const primaryBtn = {
  width: '100%', marginTop: 10, padding: '13px 16px', borderRadius: 14, border: 'none',
  background: `linear-gradient(135deg, ${GOLD} 0%, #E07F00 100%)`, color: '#fff',
  fontSize: 15, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit',
}
const ghostBtn = {
  width: '100%', marginTop: 10, padding: '12px 16px', borderRadius: 14,
  border: `1.5px solid rgba(20,45,98,.3)`, background: '#fff', color: NAVY,
  fontSize: 14, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit',
}
const backBtn = {
  alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 12, cursor: 'pointer',
  border: '1px solid rgba(20,45,98,.25)', background: '#fff', color: NAVY,
  fontWeight: 900, fontSize: 13, fontFamily: 'inherit',
}
const backLink = { textAlign: 'center', color: NAVY, fontWeight: 800, fontSize: 13, textDecoration: 'none', padding: '8px 0 0' }
const pillOk = {
  padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 900, flexShrink: 0,
  background: 'rgba(34,197,94,.14)', color: '#15803D', border: '1.5px solid rgba(34,197,94,.5)',
}
const pillPending = {
  padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 900, flexShrink: 0,
  background: 'rgba(251,156,27,.14)', color: GOLD, border: '1.5px solid rgba(251,156,27,.5)',
}
const scoreLine = {
  marginTop: 10, padding: '9px 12px', borderRadius: 12, fontSize: 13.5,
  background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', color: NAVY,
}
const legend = { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: '#475569', marginBottom: 12 }
function dot(border) {
  return { display: 'inline-block', width: 10, height: 10, borderRadius: 99, border, marginInlineEnd: 5, verticalAlign: 'middle' }
}
function reviewCard(palette) {
  return { borderRadius: 14, padding: 12, background: palette.bg, border: palette.border }
}
function answerLine(palette) {
  return {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
    background: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 13,
    border: '1px solid rgba(148,163,184,.35)', color: palette.text,
  }
}
const scoreRing = (pct) => ({
  width: 130, height: 130, borderRadius: '50%', margin: '14px auto 4px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: `conic-gradient(#16A34A 0% ${pct}%, rgba(148,163,184,.25) ${pct}% 100%)`,
})
const scoreInner = {
  width: 106, height: 106, borderRadius: '50%', background: '#fff',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
}
const videoBtn = {
  display: 'inline-block', padding: '11px 18px', borderRadius: 12, textDecoration: 'none',
  background: NAVY, color: '#fff', fontWeight: 900, fontSize: 14,
}

function optionBtn(selected) {
  return {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxSizing: 'border-box',
    padding: '13px 14px', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start',
    border: selected ? `2px solid ${GOLD}` : '2px solid rgba(148,163,184,.4)',
    background: selected ? 'rgba(251,156,27,.13)' : '#fff', color: '#1E293B',
    transition: 'border-color .12s ease, background .12s ease',
  }
}
function optionLetter(selected) {
  return {
    width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 900, fontSize: 13, flexShrink: 0,
    background: selected ? GOLD : 'rgba(20,45,98,.08)', color: selected ? '#fff' : NAVY,
  }
}
