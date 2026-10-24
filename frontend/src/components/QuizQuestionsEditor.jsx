import { useEffect, useMemo, useRef, useState } from 'react'
import { newQuestion, newTrueFalseQuestion, normalizeDigits, READY_LETTERS, parseAnswerKey } from '../lib/hwQuiz'

// ═══════════════════════════════════════════════════════════════════════════
// QUIZ QUESTIONS EDITOR — محرّر أسئلة الاختيارات المشترك (Task 44e)
//   • توليد سريع: اختار النوع والعدد (5/10/15/20 أو أي رقم) → N سؤال جاهزين فورًا
//   • Enter بينقلّك للاختيار اللي بعده → السؤال اللي بعده — وآخر سؤال يعمل
//     سؤالًا جديدًا تلقائيًا (إدخال كامل من الكيبورد من غير ماوس)
//   • مفتاح إجابات جماعي: «أ ب ج د» أو «1-أ 2-ج 3-ب» أو «صح غلط» → يتحسب
//     بالترتيب لكل السؤال، و«0» يسَب أي سؤال من غير تغيير
//   • قوالب جماعية (أ ب ج د / صح-غلط) بس للأسئلة الفاضية — عشان منضيّعش شغل
//   • كشف الأسئلة المكررة + تركيز تلقائي بعد التوليد
// مستخدم في: HomeworkWorkspace + OnlineExamWorkspace (نفس مخطط الأسئلة:
//   { text, choices: string[], correct: index, marks })
// ═══════════════════════════════════════════════════════════════════════════

const QUICK_COUNTS = [5, 10, 15, 20]
const MAX_QUESTIONS = 60

export default function QuizQuestionsEditor({ questions, setQuestions, isArabic, editorId = 'qq', optionalText = false }) {
  const [genCount, setGenCount] = useState(10)
  const [genType, setGenType] = useState('mcq')
  const [keyText, setKeyText] = useState('')
  const [toolMsg, setToolMsg] = useState(null) // { ok: boolean, text: string }
  const pendingFocus = useRef(null)

  const idText = (i) => `${editorId}-q${i}-text`
  const idChoice = (i, ci) => `${editorId}-q${i}-c${ci}`

  // تركيز العنصر المطلوب بعد ما الـ render الجديد يركّب الـ inputs
  useEffect(() => {
    if (!pendingFocus.current) return
    const el = document.getElementById(pendingFocus.current)
    if (el) { el.focus(); try { el.select?.() } catch { /* noop */ } }
    pendingFocus.current = null
  }, [questions])

  const setQ = (i, patch) => setQuestions((prev) => prev.map((q, j) => (j === i ? { ...q, ...patch } : q)))

  const focusNow = (id) => {
    const el = document.getElementById(id)
    if (el) { el.focus(); try { el.select?.() } catch { /* noop */ } }
  }

  const isUntouched = (q) => !String(q.text || '').trim() && (q.choices || []).every((c) => !String(c || '').trim())

  // ── التوليد السريع: N سؤال فورًا ──────────────────────────────────────────
  const generate = () => {
    const n = Math.max(1, Math.min(Number(normalizeDigits(genCount)) || 0, MAX_QUESTIONS))
    if (!n) return
    const fresh = Array.from({ length: n }, () => (genType === 'tf' ? newTrueFalseQuestion() : newQuestion()))
    const onlyStarter = questions.length === 1 && isUntouched(questions[0])
    const start = onlyStarter ? 0 : questions.length
    setQuestions(onlyStarter ? fresh : [...questions, ...fresh])
    pendingFocus.current = idText(start)
    setToolMsg(null)
  }

  // ── إدخال Enter: الخيار اللي بعده → السؤال اللي بعده → سؤال جديد ──────────
  const onEnter = (e, i, ci) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    const q = questions[i]
    if (!q) return
    if (ci == null) { focusNow(idChoice(i, 0)); return } // نص السؤال → أول اختيار
    if (ci + 1 < q.choices.length) { focusNow(idChoice(i, ci + 1)); return } // الاختيار اللي بعده
    if (i + 1 < questions.length) { focusNow(idText(i + 1)); return } // السؤال اللي بعده
    // آخر سؤال → أنشئ سؤالًا جديدًا من نفس النوع وركّز عليه
    const isTF = q.choices.length === 2 && q.choices[0] === 'صح' && q.choices[1] === 'غلط'
    setQuestions([...questions, isTF ? newTrueFalseQuestion() : newQuestion()])
    pendingFocus.current = idText(i + 1)
  }

  // ── مفتاح الإجابات الجماعي ────────────────────────────────────────────────
  const applyKey = () => {
    const { keys } = parseAnswerKey(keyText)
    if (!keys.length) {
      setToolMsg({ ok: false, text: isArabic ? 'اكتب المفتاح الأول — مثال: أ ب ج د أو 1-أ 2-ج' : 'Enter the key first — e.g. A B C D' })
      return
    }
    const next = questions.map((q) => ({ ...q }))
    const warns = []
    let applied = 0
    keys.forEach((k, i) => {
      if (i >= next.length) {
        warns.push(isArabic ? `«${k.raw}» زيادة عن عدد الأسئلة (${next.length})` : `"${k.raw}" exceeds question count`)
        return
      }
      if (k.skip) return
      if (k.index == null || k.index >= next[i].choices.length) {
        warns.push(isArabic ? `س${i + 1}: «${k.raw}» مش مفهومة أو بره عدد الاختيارات — اتسابت` : `Q${i + 1}: unclear "${k.raw}" — skipped`)
        return
      }
      next[i] = { ...next[i], correct: k.index }
      applied++
    })
    setQuestions(next)
    setKeyText('')
    setToolMsg({
      ok: applied > 0,
      text: (isArabic ? `✔ اتطبّق على ${applied} ${isArabic ? 'سؤال' : ''}` : `✔ Applied to ${applied} questions`)
        + (warns.length ? (isArabic ? ' — ' : ' — ') + warns.slice(0, 3).join(' · ') : ''),
    })
  }

  // ── قوالب جماعية — بس للأسئلة الفاضية/نفس القالب عشان منضيّعش اختيارات مكتوبة ──
  const templateAll = (kind) => {
    const target = kind === 'tf' ? ['صح', 'غلط'] : [...READY_LETTERS.slice(0, 4)]
    let changed = 0
    const next = questions.map((q) => {
      const untouched = (q.choices || []).every((c) => !String(c || '').trim())
      const already = (q.choices || []).length === target.length && q.choices.every((c, j) => c === target[j])
      if (untouched || already) {
        if (!already) changed++
        return { ...q, choices: [...target], correct: Math.min(Number(q.correct) || 0, target.length - 1) }
      }
      return q
    })
    setQuestions(next)
    setToolMsg({
      ok: true,
      text: changed > 0
        ? (isArabic ? `✔ القالب اتطبّق على ${changed} سؤال — اللي فيها اختيارات مكتوبة اتسابت زي ما هي` : `✔ Template applied to ${changed} empty questions`)
        : (isArabic ? 'مفيش أسئلة فاضية محتاجة القالب — اختياراتك المكتوبة في أمان' : 'No empty questions to apply'),
    })
  }

  // ── كشف الأسئلة المكررة ───────────────────────────────────────────────────
  const dups = useMemo(() => {
    const seen = new Map()
    const out = []
    questions.forEach((q, i) => {
      const t = String(q.text || '').trim()
      if (!t) return
      if (seen.has(t)) out.push([seen.get(t) + 1, i + 1])
      else seen.set(t, i)
    })
    return out
  }, [questions])

  return (
    <div className="grid gap-3">
      {/* لوحة الأدوات السريعة */}
      <div className="rounded-xl p-3" style={{ background: 'var(--surface-container)', border: '1px dashed var(--surface-border)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[.74rem] font-extrabold">{isArabic ? '⚡ توليد سريع:' : '⚡ Quick generate:'}</b>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--surface-border)' }}>
            <button type="button" className="px-3 py-1.5 text-[.68rem] font-extrabold cursor-pointer border-0" style={genType === 'mcq' ? { background: 'var(--brand-navy)', color: '#fff' } : { background: 'transparent' }} onClick={() => setGenType('mcq')}>{isArabic ? 'اختيارات' : 'MCQ'}</button>
            <button type="button" className="px-3 py-1.5 text-[.68rem] font-extrabold cursor-pointer border-0" style={genType === 'tf' ? { background: 'var(--brand-navy)', color: '#fff' } : { background: 'transparent' }} onClick={() => setGenType('tf')}>{isArabic ? 'صح / غلط' : 'True/False'}</button>
          </div>
          <input
            type="number" min="1" max={MAX_QUESTIONS} inputMode="numeric" value={genCount}
            onChange={(e) => setGenCount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); generate() } }}
            className="glass-input rounded-lg px-2.5 py-1.5 text-sm w-16 text-center"
            aria-label={isArabic ? 'عدد الأسئلة' : 'Question count'}
          />
          <button type="button" className="btn-navy rounded-lg px-4 py-1.5 text-[.7rem] font-extrabold cursor-pointer border-0" onClick={generate}>
            {isArabic ? 'اعملهم ←' : 'Generate →'}
          </button>
          {QUICK_COUNTS.map((n) => (
            <button key={n} type="button" className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.66rem] font-extrabold" onClick={() => { setGenCount(n); setGenType('mcq') }}>{n}</button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          <b className="text-[.74rem] font-extrabold">{isArabic ? '🔑 مفتاح الإجابات:' : '🔑 Answer key:'}</b>
          <input
            dir="rtl"
            className="glass-input rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[180px]"
            placeholder={isArabic ? 'أ ب ج د أ …  أو  1-أ 2-ج 3-ب  أو  صح غلط صح (0 = سَب)' : 'A B C D … or 1-A 2-C (0 = skip)'}
            value={keyText}
            onChange={(e) => setKeyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyKey() } }}
            aria-label={isArabic ? 'مفتاح الإجابات' : 'Answer key'}
          />
          <button type="button" className="btn-ghost rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold" onClick={applyKey}>{isArabic ? 'طبّق' : 'Apply'}</button>
          <span className="text-[.62rem] text-fg-muted">|</span>
          <button type="button" className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.66rem] font-extrabold" onClick={() => templateAll('abcd')}>{isArabic ? 'اجعل الكل أ ب ج د' : 'All A-D'}</button>
          <button type="button" className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.66rem] font-extrabold" onClick={() => templateAll('tf')}>{isArabic ? 'اجعل الكل صح/غلط' : 'All T/F'}</button>
        </div>

        {toolMsg && (
          <div className="nk-notice mt-2" style={toolMsg.ok
            ? { background: 'var(--success-bg, rgba(34,150,94,.08))', borderColor: 'rgba(34,150,94,.4)', color: 'var(--ok-strong, #16913A)' }
            : { background: 'var(--warning-bg, rgba(251,156,27,.08))', borderColor: 'rgba(251,156,27,.4)', color: 'var(--brand-navy)' }}>
            <span className="text-[.7rem] font-bold">{toolMsg.text}</span>
          </div>
        )}
        {dups.length > 0 && (
          <div className="nk-notice mt-2" style={{ background: 'var(--warning-bg, rgba(251,156,27,.08))', borderColor: 'rgba(251,156,27,.4)', color: 'var(--brand-navy)' }}>
            {dups.slice(0, 3).map(([a, b], i) => (
              <div key={i} className="text-[.7rem] font-bold">• {isArabic ? `السؤال ${b} مكرر مع السؤال ${a} — لو مقصود سيبه، لو غلط امسحه` : `Q${b} duplicates Q${a}`}</div>
            ))}
          </div>
        )}
        <p className="text-[.62rem] text-fg-muted mt-2 mb-0">
          💡 {isArabic
            ? 'اكتب الاختيار واضغط Enter — بينقلك للاختيار اللي بعده وللسؤال اللي بعده، وآخر سؤال بيعمل سؤال جديد لوحده.'
            : 'Type a choice and press Enter — jumps to the next choice, then the next question; the last question spawns a new one.'}
        </p>
      </div>

      {/* كروت الأسئلة */}
      {questions.map((q, i) => (
        <div key={i} className="rounded-xl p-3" style={{ background: 'var(--surface-container)', border: '1px solid var(--surface-border)' }}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[.72rem] font-extrabold" style={{ color: 'var(--brand-navy)' }}>{isArabic ? `السؤال ${i + 1}` : `Question ${i + 1}`}</span>
            {questions.length > 1 && (
              <button className="btn-ghost rounded-lg px-2 py-1 text-[.68rem] font-extrabold" onClick={() => setQuestions(questions.filter((_, j) => j !== i))} aria-label={isArabic ? 'حذف السؤال' : 'Remove question'}>✕</button>
            )}
          </div>
          <input
            id={idText(i)}
            className="glass-input rounded-lg px-3 py-2 text-sm w-full mb-2"
            placeholder={optionalText
              ? (isArabic ? 'نص السؤال (اختياري — لو الواجب في الكتاب سيبه فاضي)' : 'Question text (optional)')
              : (isArabic ? 'نص السؤال...' : 'Question text...')}
            value={q.text}
            onChange={(e) => setQ(i, { text: e.target.value })}
            onKeyDown={(e) => onEnter(e, i, null)}
            enterKeyHint="next"
            aria-label={isArabic ? 'نص السؤال' : 'Question text'}
          />
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-[.64rem] font-extrabold text-fg-muted">{isArabic ? 'قالب جاهز:' : 'Template:'}</span>
            <button type="button" className="btn-ghost rounded-lg px-2.5 py-1 text-[.66rem] font-extrabold" onClick={() => setQ(i, { choices: [...READY_LETTERS.slice(0, 4)], correct: Math.min(Number(q.correct) || 0, 3) })}>أ ب ج د</button>
            <button type="button" className="btn-ghost rounded-lg px-2.5 py-1 text-[.66rem] font-extrabold" onClick={() => setQ(i, { choices: ['صح', 'غلط'], correct: Math.min(Number(q.correct) || 0, 1) })}>صح / غلط</button>
          </div>
          <div className="grid gap-1.5">
            {q.choices.map((c, ci) => (
              <label key={ci} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={`${editorId}-correct-${i}`}
                  checked={Number(q.correct) === ci}
                  onChange={() => setQ(i, { correct: ci })}
                  className="w-3.5 h-3.5 accent-[var(--ok-strong)]"
                  aria-label={isArabic ? 'الإجابة الصحيحة' : 'Correct answer'}
                />
                <input
                  id={idChoice(i, ci)}
                  className="glass-input rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-0"
                  placeholder={isArabic ? `اختيار ${ci + 1}` : `Choice ${ci + 1}`}
                  value={c}
                  onChange={(e) => { const choices = [...q.choices]; choices[ci] = e.target.value; setQ(i, { choices }) }}
                  onKeyDown={(e) => onEnter(e, i, ci)}
                  enterKeyHint="next"
                  aria-label={isArabic ? `اختيار ${ci + 1}` : `Choice ${ci + 1}`}
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
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button className="btn-ghost rounded-xl px-4 py-2 text-[.74rem] font-extrabold" onClick={() => { setQuestions([...questions, newQuestion()]); pendingFocus.current = idText(questions.length) }}>
            ＋ {isArabic ? 'سؤال اختيارات' : 'Add MCQ'}
          </button>
          <button className="btn-ghost rounded-xl px-4 py-2 text-[.74rem] font-extrabold" onClick={() => { setQuestions([...questions, newTrueFalseQuestion()]); pendingFocus.current = idText(questions.length) }}>
            ＋ {isArabic ? 'سؤال صح/غلط' : 'Add true/false'}
          </button>
        </div>
      </div>
    </div>
  )
}
