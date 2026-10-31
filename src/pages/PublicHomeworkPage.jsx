/**
 * Student Homework Submission — /hw/:token (Task 44)
 * No authentication required — access is controlled entirely by the token.
 *
 * Flow (بناية طلب المستر):
 *   1) الطالب يفتح اللينك → يكتب رقمه بس (تليفون أو كود — يقبل أرقام عربية)
 *   2) يجاوب على أسئلة الاختيارات (أ ب ج د / صح وغلط) — نص السؤال اختياري
 *      لأن الواجب نفسه ممكن يكون في الكتاب
 *   3) تسليم واحد فقط لكل طالب + كل جهاز ليه تسليم واحد لكل واجب
 *      (ممنوع الإعادة نهائيًا — مفروضة من السيرفر unique constraints)
 *   4) بعد التسليم: النتيجة فورًا بألوان واضحة (أخضر=صح، أحمر=غلط) + رموز
 *      ✓/✗ + كلمة «إجابتك/الصحيحة» — مش اللون لوحده — + لينك الفيديو
 *      اللي كان مقفول بيتفتح هنا فقط
 *
 * الرصد كله على السيرفر داخل submit_homework_quiz (migration 055):
 * الإجابات الصحيحة عمرها ما تُرسل للمتصفح قبل التسليم.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { gradeOf } from '../lib/helpers'
import { getDeviceId, normalizeStudentNumber } from '../lib/hwQuiz'

const NAVY = '#142D62'
const GOLD = '#A65700'

// ألوان النتيجة — واضحة عمدًا (طلب المستر: الألوان مش واضحة عند الطلاب)
const C = {
  correct: { bg: 'rgba(34,197,94,.14)', border: '2px solid rgba(34,197,94,.85)', text: '#15803D' },
  wrong: { bg: 'rgba(239,68,68,.12)', border: '2px solid rgba(239,68,68,.85)', text: '#B91C1C' },
  missed: { bg: 'rgba(251,191,36,.16)', border: '2px solid rgba(245,158,11,.85)', text: '#B45309' },
  neutral: { bg: 'rgba(100,116,139,.08)', border: '2px solid rgba(100,116,139,.25)', text: '#475569' },
}

export default function PublicHomeworkPage() {
  const [state, setState] = useState('loading') // loading | ready | not_found | error
  const [errorMsg, setErrorMsg] = useState('')
  const [phase, setPhase] = useState('number')  // number | quiz | result
  const [quiz, setQuiz] = useState(null)        // { title, instructions, group_name, video_url, question_count }
  const [questions, setQuestions] = useState([]) // بدون correct_options (سيرفر)
  const [result, setResult] = useState(null)    // نتيجة ما بعد التسليم
  const [lockedMessage, setLockedMessage] = useState('')

  const [studentNumber, setStudentNumber] = useState('')
  const [studentName, setStudentName] = useState('')
  const [answers, setAnswers] = useState({})    // {qid: [optId]}
  const [qIndex, setQIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const tokenRef = useRef('')
  const retryCountRef = useRef(0)
  const loadSeqRef = useRef(0)

  const token = window.location.pathname.replace(/^\/hw\//, '').split('?')[0]

  // ── تحميل الواجب (بدون الإجابات) ─────────────────────────────────────────
  const load = useCallback(async (isRetry = false) => {
    if (!token) { setState('not_found'); return }
    const seq = ++loadSeqRef.current
    tokenRef.current = token
    try {
      const { data, error } = await supabase.rpc('get_homework_quiz_public', {
        p_token: token,
        p_device: getDeviceId(),
      })
      if (error) throw error
      if (seq !== loadSeqRef.current) return
      if (!data || data.status === 'not_found') {
        setState('not_found'); return
      }
      setQuiz(data.quiz || null)
      if (data.status === 'already_submitted_device' && data.result) {
        setResult(data.result)
        setPhase('result')
        setLockedMessage('الواجب ده اتسلّم من الجهاز ده بالفعل — دي نتيجته المحفوظة.')
      } else {
        setQuestions(data.questions || [])
        setPhase('number')
      }
      retryCountRef.current = 0
      setState('ready')
    } catch (err) {
      // نفس منطق البورتال: فشل أول تحميل غالبًا شبكة عابرة (iOS) → محاولة صامتة
      console.error('[PublicHomeworkPage] load error:', err?.message || err, err?.code || '')
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

  // ── إدخال الرقم → الأسئلة ────────────────────────────────────────────────
  const startQuiz = () => {
    const n = normalizeStudentNumber(studentNumber)
    if (n.length < 4 && studentNumber.trim().length < 2) {
      setSubmitError('اكتب رقمك الأول (رقم التليفون أو الكود)')
      return
    }
    setSubmitError('')
    setQIndex(0)
    setPhase('quiz')
  }

  const choose = (qid, optId) => {
    setAnswers((prev) => ({ ...prev, [qid]: [optId] }))
  }

  const current = questions[qIndex]
  const answeredCount = questions.filter((q) => (answers[q.id] || []).length > 0).length
  const allAnswered = answeredCount === questions.length && questions.length > 0

  // ── التسليم (مرة واحدة — السيرفر بيمنع الإعادة) ──────────────────────────
  const submit = async () => {
    if (submitting) return
    setSubmitting(true); setSubmitError('')
    try {
      const { data, error } = await supabase.rpc('submit_homework_quiz', {
        p_token: tokenRef.current,
        p_student_number: studentNumber,
        p_answers: answers,
        p_device: getDeviceId(),
      })
      if (error) throw error
      if (!data) throw new Error('رد فاضي من الخادم')

      if (data.status === 'ok') {
        setStudentName(data.student_name || '')
        setResult(data.result)
        setPhase('result')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else if (data.status === 'already_submitted' && data.result) {
        setStudentName(data.student_name || '')
        setResult(data.result)
        setLockedMessage('الواجب ده اتسلّم بالفعل — مش مسموح بالإعادة. دي نتيجتك المحفوظة.')
        setPhase('result')
      } else if (data.status === 'device_used') {
        setLockedMessage(data.message || 'الجهاز ده سلّم الواجب ده بالفعل — كل جهاز ليه تسليم واحد.')
        setState('locked')
      } else {
        setSubmitError(data.message || 'حصل خطأ — حاول تاني')
      }
    } catch (err) {
      console.error('[PublicHomeworkPage] submit error:', err?.message || err)
      setSubmitError(`تعذر التسليم: ${err?.message || 'مشكلة اتصال'} — حاول مرة تانية`)
    } finally { setSubmitting(false) }
  }

  // ── الشاشات ──────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <Shell>
        <p style={loadingText}>جاري التحميل...</p>
      </Shell>
    )
  }
  if (state === 'not_found') {
    return (
      <Shell>
        <div style={card}>
          <div style={bigIcon}>🔒</div>
          <h2 style={title}>الرابط غير متاح</h2>
          <p style={desc}>الواجب ده مش موجود أو الرابط قديم/اتقفل. اطلب لينك جديد من المدرس.</p>
        </div>
        <p style={footer}>Powered by النخبة</p>
      </Shell>
    )
  }
  if (state === 'error') {
    return (
      <Shell>
        <div style={card}>
          <div style={bigIcon}>⚠️</div>
          <h2 style={title}>حدث خطأ</h2>
          <p style={desc}>{errorMsg || 'حاول مرة أخرى.'}</p>
          <button style={primaryBtn} onClick={() => { setState('loading'); load() }}>إعادة المحاولة</button>
        </div>
        <p style={footer}>Powered by النخبة</p>
      </Shell>
    )
  }
  if (state === 'locked') {
    return (
      <Shell>
        <div style={card}>
          <div style={bigIcon}>🚫</div>
          <h2 style={title}>تم التسليم بالفعل</h2>
          <p style={desc}>{lockedMessage || 'كل جهاز ليه تسليم واحد لكل واجب — ومينفعش إعادة الإرسال.'}</p>
        </div>
        <p style={footer}>Powered by النخبة</p>
      </Shell>
    )
  }

  const qTitle = quiz?.title || 'واجب الحصة'

  // ── 1) شاشة الرقم ────────────────────────────────────────────────────────
  if (phase === 'number') {
    return (
      <Shell>
        <div style={headerCard}>
          <div style={hwBadge}>📝 واجب إلكتروني</div>
          <h1 style={title}>{qTitle}</h1>
          {quiz?.group_name && <p style={meta}>مجموعة: {quiz.group_name}</p>}
          {quiz?.instructions && <p style={desc}>{quiz.instructions}</p>}
          <p style={meta}>{quiz?.question_count} سؤال · اختيارات / صح وغلط</p>
        </div>

        <div style={card}>
          <label style={label} htmlFor="hw-number">اكتب رقمك للتسليم</label>
          <input
            id="hw-number"
            dir="ltr"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="01xxxxxxxxx أو الكود"
            value={studentNumber}
            onChange={(e) => setStudentNumber(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') startQuiz() }}
            style={numberInput}
          />
          <small style={hint}>رقم التليفون المسجّل عند المستر أو كود الطالب — أرقام عربية ولا إنجليزية مش فارقة.</small>
          {submitError && <p style={errorText}>{submitError}</p>}
          <button style={primaryBtn} onClick={startQuiz}>ابدأ الإجابة ←</button>
        </div>
        <p style={footer}>Powered by النخبة</p>
      </Shell>
    )
  }

  // ── 2) شاشة الأسئلة ──────────────────────────────────────────────────────
  if (phase === 'quiz' && current) {
    const chosen = (answers[current.id] || [])[0]
    return (
      <Shell>
        <div style={headerCard}>
          <div style={hwBadge}>📝 {qTitle}</div>
          <div style={progressTrack}><div style={{ ...progressFill, width: `${Math.round(((qIndex + 1) / Math.max(questions.length, 1)) * 100)}%` }} /></div>
          <p style={meta}>سؤال {qIndex + 1} من {questions.length} · جبت على {answeredCount}</p>
        </div>

        <div style={card} key={current.id}>
          {current.question_text
            ? <h2 style={{ ...title, margin: '0 0 14px', fontSize: 19 }}>{current.question_text}</h2>
            : (
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <h2 style={{ ...title, margin: '0 0 6px', fontSize: 19 }}>سؤال {qIndex + 1}</h2>
                <p style={meta}>الواجب في الكتاب — اختار الإجابة من عندك 👇</p>
              </div>
            )}

          {current.kind === 'true_false' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {current.options.map((o) => (
                <button key={o.id} onClick={() => choose(current.id, o.id)} style={tfBtn(chosen === o.id)}>{o.label}</button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {current.options.map((o, i) => (
                <button key={o.id} onClick={() => choose(current.id, o.id)} style={optionBtn(chosen === o.id)}>
                  <span style={optionLetter(chosen === o.id)}>{['أ', 'ب', 'ج', 'د', 'هـ', 'و'][i] || o.id.toUpperCase()}</span>
                  <span style={{ flex: 1, textAlign: 'start', fontWeight: 700, fontSize: 15 }}>
                    {o.label || `الاختيار ${i + 1}`}
                  </span>
                  {chosen === o.id && <span style={{ fontSize: 18 }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {qIndex > 0 && <button style={ghostBtn} onClick={() => setQIndex((i) => i - 1)}>→ السابق</button>}
          <div style={{ display: 'flex', gap: 5, flex: 1, justifyContent: 'center' }}>
            {questions.map((q, i) => (
              <button key={q.id} onClick={() => setQIndex(i)} title={`سؤال ${i + 1}`}
                style={{ width: 10, height: 10, borderRadius: 99, border: 'none', cursor: 'pointer', background: i === qIndex ? NAVY : (answers[q.id]?.length ? 'rgba(34,197,94,.75)' : 'rgba(20,45,98,.18)') }} />
            ))}
          </div>
          {qIndex < questions.length - 1
            ? <button style={primaryBtn} onClick={() => setQIndex((i) => i + 1)}>التالي ←</button>
            : <button style={primaryBtn} disabled={submitting || !allAnswered} onClick={submit}>
                {submitting ? 'جاري التسليم...' : 'سلّم الواجب ✓'}
              </button>}
        </div>
        {!allAnswered && qIndex === questions.length - 1 && (
          <p style={{ ...errorText, textAlign: 'center' }}>جاوب على كل الأسئلة الأول ({answeredCount} من {questions.length})</p>
        )}
        {submitError && <p style={{ ...errorText, textAlign: 'center' }}>{submitError}</p>}
        <p style={footer}>Powered by النخبة</p>
      </Shell>
    )
  }

  // ── 3) شاشة النتيجة (بعد التسليم — الألوان واضحة + الفيديو مفتوح) ────────
  if (phase === 'result' && result) {
    const per = result.per_question || []
    const pct = Number(result.percentage ?? (result.max_score > 0 ? Math.round((result.score / result.max_score) * 100) : 0))
    const gradeName = gradeOf(Number(result.score), Number(result.max_score))
    return (
      <Shell>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={hwBadge}>✅ التسليم وصل — الدرجة اتحفظت</div>
          {studentName && <h1 style={{ ...title, margin: '10px 0 2px', fontSize: 20 }}>برافو {studentName} 👏</h1>}
          <div style={scoreRing(pct)}>
            <div style={scoreInner}>
              <b style={{ fontSize: 30, color: NAVY }}>{result.score}<small style={{ fontSize: 15, color: '#64748B' }}> / {result.max_score}</small></b>
              <span style={{ fontSize: 14, fontWeight: 800, color: pct >= 50 ? '#15803D' : '#B91C1C' }}>{pct}%</span>
            </div>
          </div>
          <p style={{ margin: '8px 0 0', fontWeight: 800, fontSize: 15, color: GOLD }}>التقدير: {gradeName || '—'}</p>
          {result.quiz_title && <p style={meta}>واجب: {result.quiz_title}</p>}
          <p style={{ ...hint, marginTop: 6 }}>
            الدرجة اتحفظت تلقائيًا وهتتسجل في الحصة الجاية — ومينفعش إعادة الإرسال.
          </p>
        </div>

        {/* الفيديو — مقفول قبل التسليم، مفتوح هنا فقط */}
        {result.video_url && (
          <div style={{ ...card, borderColor: 'rgba(166,87,0,.5)' }}>
            <b style={{ color: GOLD, display: 'block', marginBottom: 8 }}>🎬 فيديو شرح الواجب — فتح ليك بعد ما سلّمت</b>
            <a href={result.video_url} target="_blank" rel="noopener noreferrer" style={videoBtn}>افتح الفيديو ↗</a>
          </div>
        )}

        {/* مراجعة الإجابات بألوان واضحة */}
        <div style={card}>
          <b style={{ display: 'block', marginBottom: 8, color: NAVY }}>مراجعة إجاباتك</b>
          <div style={legend}>
            <span><i style={dot(C.correct.border)} /> الصح</span>
            <span><i style={dot(C.wrong.border)} /> إجابتك الغلط</span>
            <span><i style={dot(C.missed.border)} /> الصح اللي فاتك</span>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {per.map((pq, i) => {
              const correctIds = Array.isArray(pq.correct_options) ? pq.correct_options : []
              const chosenIds = Array.isArray(pq.chosen) ? pq.chosen : []
              const isCorrect = pq.is_correct === true
              const chosenLabel = (id) => {
                const opt = (pq.options || []).find((o) => o.id === id)
                return opt?.label || { a: 'أ', b: 'ب', c: 'ج', d: 'د', t: 'صح', f: 'غلط' }[id] || id
              }
              const correctText = correctIds.map(chosenLabel).join('، ') || '—'
              return (
                <div key={pq.question_id || i} style={reviewCard(isCorrect, chosenIds.length === 0)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{
                      width: 26, height: 26, borderRadius: 99, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 900, fontSize: 14, color: '#fff', background: isCorrect ? '#16A34A' : chosenIds.length === 0 ? '#94A3B8' : '#DC2626',
                    }}>{isCorrect ? '✓' : chosenIds.length === 0 ? '—' : '✗'}</span>
                    <b style={{ fontSize: 14, color: NAVY }}>
                      {pq.question_text?.trim() ? pq.question_text : `سؤال ${pq.position != null ? pq.position + 1 : i + 1}`}
                    </b>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {chosenIds.length > 0 && (
                      <div style={answerLine(isCorrect ? C.correct : C.wrong)}>
                        <span>{isCorrect ? 'إجابتك ✓' : 'إجابتك ✗'}</span>
                        <b>{chosenIds.map(chosenLabel).join('، ')}</b>
                      </div>
                    )}
                    {!isCorrect && chosenIds.length > 0 && (
                      <div style={answerLine(C.missed)}>
                        <span>الصحيحة</span>
                        <b>{correctText}</b>
                      </div>
                    )}
                    {chosenIds.length === 0 && (
                      <div style={answerLine(C.missed)}>
                        <span>ما جبتش عليها — الصح</span>
                        <b>{correctText}</b>
                      </div>
                    )}
                    {pq.explanation && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>💡 {pq.explanation}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {lockedMessage && <p style={{ ...hint, textAlign: 'center' }}>{lockedMessage}</p>}
        <p style={footer}>Powered by النخبة</p>
      </Shell>
    )
  }

  return (
    <Shell>
      <p style={loadingText}>جاري التحميل...</p>
      <p style={footer}>Powered by النخبة</p>
    </Shell>
  )
}

// ── الأنماط (نفس لغة البوابة — inline styles، RTL، Cairo) ───────────────────
function Shell({ children }) {
  return (
    <div style={{
      minHeight: '100vh', fontFamily: "'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif",
      background: 'linear-gradient(160deg, #f4f7fb 0%, #ffffff 52%, #eef3f7 100%)',
      direction: 'rtl', padding: '18px 14px 40px', maxWidth: 640, margin: '0 auto',
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      {children}
    </div>
  )
}

const card = {
  background: '#fff', borderRadius: 20, padding: 18,
  border: '1px solid rgba(148,163,184,.30)', boxShadow: '0 10px 30px rgba(20,45,98,.07)',
}
const headerCard = { ...card, textAlign: 'center', background: `linear-gradient(160deg, ${NAVY} 0%, #24418C 100%)`, color: '#fff', border: 'none' }
const hwBadge = {
  display: 'inline-block', padding: '4px 14px', borderRadius: 99, marginBottom: 8,
  background: 'rgba(251,156,27,.18)', color: '#FDBA74', fontSize: 12, fontWeight: 800,
}
const title = { margin: '0 0 4px', fontSize: 20, fontWeight: 900 }
const meta = { margin: 0, fontSize: 13, opacity: 0.9 }
const desc = { margin: '10px 0 0', fontSize: 14, lineHeight: 1.7, opacity: 0.95 }
const loadingText = { textAlign: 'center', color: '#64748B', fontWeight: 700 }
const footer = { textAlign: 'center', fontSize: 12, color: '#94A3B8', margin: '6px 0 0' }
const bigIcon = { fontSize: 42, marginBottom: 8 }
const label = { display: 'block', fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 8 }
const numberInput = {
  width: '100%', boxSizing: 'border-box', fontSize: 18, fontWeight: 800, textAlign: 'center',
  padding: '14px 12px', borderRadius: 14, border: '2px solid rgba(20,45,98,.25)', outline: 'none',
  color: NAVY, letterSpacing: 1,
}
numberInput.focus = undefined
const hint = { display: 'block', marginTop: 8, fontSize: 12, color: '#64748B', lineHeight: 1.6 }
const errorText = { color: '#B91C1C', fontWeight: 800, fontSize: 13, marginTop: 10 }
const primaryBtn = {
  width: '100%', marginTop: 12, padding: '13px 16px', borderRadius: 14, border: 'none',
  background: `linear-gradient(135deg, ${GOLD} 0%, #E07F00 100%)`, color: '#fff',
  fontSize: 15, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit',
}
const ghostBtn = {
  padding: '12px 16px', borderRadius: 14, border: '1px solid rgba(20,45,98,.3)',
  background: '#fff', color: NAVY, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
}
const progressTrack = { height: 8, borderRadius: 99, background: 'rgba(255,255,255,.25)', margin: '12px 0 8px', overflow: 'hidden' }
const progressFill = { height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, #FB9C1B, #FDBA74)', transition: 'width .25s ease' }

function optionBtn(selected) {
  return {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxSizing: 'border-box',
    padding: '13px 14px', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start',
    border: selected ? `2px solid ${NAVY}` : '2px solid rgba(148,163,184,.4)',
    background: selected ? 'rgba(20,45,98,.07)' : '#fff', color: '#1E293B',
  }
}
function optionLetter(selected) {
  return {
    width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 900, fontSize: 13, flexShrink: 0,
    background: selected ? NAVY : 'rgba(20,45,98,.08)', color: selected ? '#fff' : NAVY,
  }
}
function tfBtn(selected) {
  return {
    ...optionBtn(selected), justifyContent: 'center', padding: '16px 10px', fontSize: 16, fontWeight: 900,
    border: selected ? `2px solid ${NAVY}` : '2px solid rgba(148,163,184,.4)',
  }
}

const legend = { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: '#475569', marginBottom: 12 }
function dot(border) {
  return { display: 'inline-block', width: 10, height: 10, borderRadius: 99, border, marginInlineEnd: 5, verticalAlign: 'middle' }
}
function reviewCard(isCorrect, blank) {
  return {
    borderRadius: 14, padding: 12,
    background: isCorrect ? C.correct.bg : blank ? C.neutral.bg : C.wrong.bg,
    border: isCorrect ? C.correct.border : blank ? C.neutral.border : C.wrong.border,
  }
}
function answerLine(palette) {
  return {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
    background: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 13,
    border: palette.border, color: palette.text,
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
