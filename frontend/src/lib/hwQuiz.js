// ═══════════════════════════════════════════════════════════════════════════
// HOMEWORK QUIZ HELPERS — واجب الاختيارات (Task 44/056/058)
// أدوات واجهة المدرس: محلّل نص الأسئلة (لصق/ملف نصي) + تحليل النتائج.
// المخطط هنا هو مخطط homework_tasks.questions:
//   { text, choices: string[], correct: index, marks }
// نص السؤال اختياري — الواجب ممكن يكون في الكتاب والمدرس بيحدد الإجابات بس.
// ═══════════════════════════════════════════════════════════════════════════

export const TRUE_FALSE_CHOICES = ['صح', 'غلط']
export const READY_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و']

// ── تطبيع الأرقام العربية/الهندية → لاتيني ─────────────────────────────────
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

export function normalizeDigits(input) {
  let s = String(input ?? '')
  for (let i = 0; i < 10; i++) {
    s = s.split(AR_DIGITS[i]).join(String(i))
    s = s.split(FA_DIGITS[i]).join(String(i))
  }
  return s
}

export function newQuestion() {
  return { text: '', choices: ['', '', '', ''], correct: 0, marks: 1 }
}

export function newTrueFalseQuestion() {
  return { text: '', choices: [...TRUE_FALSE_CHOICES], correct: 0, marks: 1 }
}

// ── قوالب البدء السريع (Task 44e — تبويب الواجبات) ──────────────────────────
// «واجب 10 اختيارات» بضغطة واحدة: N سؤال جاهز باسم القالب، والنص اختياري.
export function presetQuestions({ type = 'mcq', count = 10 } = {}) {
  const n = Math.max(1, Math.min(Number(count) || 0, 60))
  const make = type === 'tf' ? newTrueFalseQuestion : newQuestion
  return Array.from({ length: n }, make)
}

export const HOMEWORK_PRESETS = [
  { key: 'quick5',  label: 'مراجعة سريعة (5)',   type: 'mcq', count: 5 },
  { key: 'mcq10',   label: 'واجب 10 اختيارات',   type: 'mcq', count: 10 },
  { key: 'mcq15',   label: 'واجب 15 اختيارات',   type: 'mcq', count: 15 },
  { key: 'mcq20',   label: 'اختبار قصير (20)',   type: 'mcq', count: 20 },
  { key: 'tf10',    label: 'واجب صح وغلط (10)',  type: 'tf',  count: 10 },
]

// ── محاولة فهم نص الأسئلة (لصق أو ملف نصي) ──────────────────────────────────
// best effort بالطلب — المدرس بيراجع ويصلّح قبل الحفظ.
// الصيغ المدعومة:
//   1) نص السؤال / س1: نص / Q1. نص — السؤال لوحده كافي (النص اختياري)
//   أ) خيار   ب- خيار   c) option   — أو سطر «صح / غلط» لسؤال صح وغلط
//   الإجابة: أ / الاجابه: صح / Answer: b — أو علامة ✅/✔/✓ جوّه الخيار
const LETTER_ALIASES = [
  ['أ', 'ا', 'آ', 'إ', 'a', 'A'],
  ['ب', 'b', 'B'],
  ['ج', 'g', 'G', 'c', 'C'],
  ['د', 'd', 'D'],
  ['هـ', 'ه', 'h', 'H', 'e', 'E'],
  ['و', 'w', 'W', 'f', 'F'],
]
const TF_LINE_RE = /(صح\s*[و/\\أو]+\s*غلط|true\s*[/?]?\s*false)/i
const ANSWER_LINE_RE = /(?:الإجابة|الاجابة|الإجابه|الصحيح|answer)\s*[:\-–]?\s*(.+)/i
const QNUM_RE = /^(?:س\s*)?(\d{1,3})\s*[-.)::：]\s*(.*)$|^(?:س\s*)(\d{1,3})\s*(.*)$|^[Qq](\d{1,3})\s*[-.)::：]?\s*(.*)$/

function letterToIndex(ch) {
  const c = String(ch || '').trim()
  for (let i = 0; i < LETTER_ALIASES.length; i++) {
    if (LETTER_ALIASES[i].includes(c)) return i
  }
  return -1
}

function matchOptionLine(line) {
  // «أ) نص» / «ب - نص» / «c) text» / «هـ- نص»
  const m = line.match(/^([^\w\sأ-ي]|\s)*([أ-يa-zA-Z]{1,2})\s*[-).::：]\s*(.+)$/)
  if (!m) return null
  const idx = letterToIndex(m[2])
  if (idx < 0 || idx >= 6) return null
  return { index: idx, label: m[3].trim() }
}

function answerToIndex(answerText, choiceCount, isTF) {
  const raw = String(answerText || '').trim()
  if (!raw) return null
  const cleaned = normalizeDigits(raw).replace(/[().*✅✔✓\s]+/g, (mm) => (/\s/.test(mm) ? ' ' : ''))
  if (isTF) {
    if (/صح|true|✔|✅|✓/i.test(cleaned)) return 0
    if (/غلط|خطأ|false|✗|❌/i.test(cleaned)) return 1
    return null
  }
  for (const part of cleaned.split(/[,،\sو]+/)) {
    const idx = letterToIndex(part)
    if (idx >= 0 && idx < choiceCount) return idx
  }
  return null
}

export function parseQuestionsText(text) {
  const warnings = []
  const questions = []
  const lines = String(text ?? '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\u0640/g, '').trim())
    .filter((l) => l.length > 0)

  let cur = null
  const pushCur = () => {
    if (!cur) return
    // سطر واحد بدون أي شكل سؤال (لا رقم ولا اختيارات ولا إجابة) = نص عادي → تجاهل
    if (!cur.structured) {
      warnings.push(`السطر «${(cur.text || 'بدون نص').slice(0, 30)}» ملوش شكل سؤال واضح — اتتجاهل`)
      cur = null
      return
    }
    // ورقة إجابات جاهزة (كل الاختيارات فاضية) أو أقل من اختيارين → قالب أ ب ج د
    const allEmpty = cur.choices.every((c) => !String(c || '').trim())
    if (allEmpty || cur.choices.length < 2) {
      cur.choices = [...READY_LETTERS.slice(0, 4)]
      if (cur.correct >= cur.choices.length) cur.correct = 0
    }
    questions.push(cur)
    cur = null
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    // choices الجاهزة فاضية (نصوص '' ) — تُعتبر «مفيش اختيارات» لأغراض التحويل
    const emptyChoices = () => cur && cur.choices.every((c) => !String(c || '').trim())
    const markStructured = () => { if (cur) cur.structured = true }

    // سطر إجابة صريح
    const am = line.match(ANSWER_LINE_RE)
    if (am && cur) {
      // إجابة صح/غلط على سؤال لسه ملهوش اختيارات → حوّله صح وغلط أولًا
      if (emptyChoices() && /^(صح|غلط|خطأ|true|false)/i.test(normalizeDigits(am[1]).trim())) {
        cur.choices = [...TRUE_FALSE_CHOICES]
        cur.isTF = true
      }
      const idx = answerToIndex(am[1], cur.choices.length, cur.isTF)
      markStructured()
      if (idx != null) cur.correct = idx
      else warnings.push(`سؤال ${questions.length + 1}: مقدرتش أفهم الإجابة «${am[1].slice(0, 24)}» — حددها بنفسك`)
      continue
    }

    // بداية سؤال مرقّم: «1)» / «س2:» / «Q3.»
    const qm = line.match(QNUM_RE)
    if (qm && (qm[1] || qm[3] || qm[5])) {
      pushCur()
      const isTF = TF_LINE_RE.test(line)
      cur = isTF ? newTrueFalseQuestion() : newQuestion()
      cur.text = (qm[2] ?? qm[4] ?? qm[6] ?? '').replace(TF_LINE_RE, '').trim()
      cur.isTF = isTF
      cur.structured = true // مرقّم = نية سؤال واضحة
      continue
    }

    if (!cur) {
      const isTF = TF_LINE_RE.test(line)
      // سطر حرف عريان («أ)» بدون محتوى) = ورقة إجابات جاهزة — نص السؤال فاضي
      const bareLetter = /^([أ-يa-zA-Z]{1,2})\s*[-).::：]?\s*$/.test(line)
      cur = isTF ? newTrueFalseQuestion() : newQuestion()
      cur.text = bareLetter ? '' : line.replace(TF_LINE_RE, '').trim()
      cur.isTF = isTF
      continue
    }

    // داخل سؤال قائم: سطر «صح / غلط» → تحويل لصح وغلط (لو لسه مفيش اختيارات حقيقية)
    if (TF_LINE_RE.test(line) && emptyChoices()) {
      cur.choices = [...TRUE_FALSE_CHOICES]
      cur.isTF = true
      cur.structured = true
      continue
    }

    // خيار
    const om = matchOptionLine(line)
    if (om) {
      while (cur.choices.length < om.index) cur.choices.push('')
      const marked = /[✅✔✓]/.test(line) || /\(\s*صح\s*\)\s*$/.test(line)
      cur.choices[om.index] = om.label
      if (marked) cur.correct = om.index
      cur.structured = true
      continue
    }

    // سطر عادي جوّه السؤال — يضاف للنص
    if (cur.text) cur.text += ' ' + line
  }
  pushCur()

  const cleaned = questions.map((q, i) => ({
    text: String(q.text || '').trim(),
    choices: q.choices.map((c) => String(c || '').trim()).filter(Boolean),
    correct: Math.max(0, Math.min(Number(q.correct) || 0, Math.max(q.choices.length - 1, 0))),
    marks: 1,
  })).filter((q) => q.choices.length >= 2)

  if (cleaned.length === 0) warnings.push('مقدرتش أطلع أسئلة من النص — جرّب تنسخه بصيغة أوضح أو اكتب الأسئلة يدويًا')
  return { questions: cleaned, warnings }
}

// ── مفتاح الإجابات الجماعي (Task 44e) ────────────────────────────────────────
// المدرس يلصق «أ ب ج د أ» أو «1-أ 2-ج 3-ب» أو «صح غلط صح» — كل توكن = إجابة
// سؤال بالترتيب. «0» = سبي على السؤال ده من غير تغيير.
const TF_TRUE_RE = /^(صح|true|✔|✅|✓)$/i
const TF_FALSE_RE = /^(غلط|خطا|خطأ|false|✗|❌|x)$/i

export function parseAnswerKey(text) {
  let src = normalizeDigits(String(text ?? ''))
  // لو المفتاح فيه حروف → أرقام الأسئلة («1-» «2.» «3)») بقاوا ضوضاء — شيلها
  if (/[\u0621-\u064Aa-zA-Z]/.test(src)) {
    src = src.replace(/(^|[\s,،\-–_/:.|])(\d{1,2})\s*[-–_.::：)]\s*/g, '$1')
  }
  const tokens = src
    .split(/[\s,،\-–_/:.•|()+]+/)
    .filter(Boolean)
  const keys = tokens.map((t) => {
    const low = t.toLowerCase().replace(/[إأآا]/g, 'ا')
    if (low === '0') return { raw: t, skip: true }
    if (TF_TRUE_RE.test(low)) return { raw: t, index: 0, tf: true }
    if (TF_FALSE_RE.test(low)) return { raw: t, index: 1, tf: true }
    const bare = low.replace(/^ال/, '')
    for (let i = 0; i < LETTER_ALIASES.length; i++) {
      const norm = LETTER_ALIASES[i].map((c) => String(c).replace(/[إأآا]/g, 'ا'))
      if (norm.includes(low) || norm.includes(bare)) return { raw: t, index: i }
    }
    if (/^[1-6]$/.test(t)) return { raw: t, index: Number(t) - 1 }
    return { raw: t, index: null }
  })
  return { keys }
}

// ── تحويل رد الدالة الذكية (ai-parse-homework) لمخطط الأسئلة ────────────────
// الدالة بترجّع {question_text, kind, options[], correct_options[], explanation}
export function mapAiQuestions(list) {
  const out = []
  if (!Array.isArray(list)) return out
  list.forEach((q) => {
    const options = (Array.isArray(q?.options) ? q.options : []).map((o) => String(o ?? '').trim()).filter(Boolean)
    if (options.length < 2) return
    const isTF = q?.kind === 'true_false'
      || (options.length === 2 && /^(صح|غلط)$/i.test(options[0]) && /^(صح|غلط)$/i.test(options[1]))
    const choices = isTF ? [...TRUE_FALSE_CHOICES] : options
    const correctOpts = (Array.isArray(q?.correct_options) ? q.correct_options : []).map((o) => String(o ?? '').trim())
    let correct = 0
    if (correctOpts.length > 0) {
      const found = choices.findIndex((c) => correctOpts.includes(c))
      if (found >= 0) correct = found
    }
    out.push({ text: String(q?.question_text ?? '').trim(), choices, correct, marks: 1 })
  })
  return out
}

// ── تحليل الواجب (واجهة المدرس): أكتر الأسئلة فيها مشاكل ────────────────────
export function buildQuizAnalytics(submissions, questions) {
  const total = submissions.length
  const perQuestion = (questions || []).map((q, idx) => {
    let correct = 0
    let wrong = 0
    let blank = 0
    submissions.forEach((s) => {
      const answers = Array.isArray(s.answers) ? s.answers : []
      const chosen = Number.isInteger(answers[idx]) ? answers[idx] : null
      if (chosen == null) { blank++; return }
      if (Number(q.correct) === chosen) correct++; else wrong++
    })
    return {
      index: idx,
      label: String(q.text || '').trim() ? String(q.text).trim().slice(0, 60) : `السؤال ${idx + 1}`,
      correct, wrong, blank,
      wrongPct: total > 0 ? Math.round((wrong / total) * 100) : 0,
    }
  })
  const problemQuestions = [...perQuestion].sort((a, b) => b.wrong - a.wrong || b.wrongPct - a.wrongPct)
  const avgPct = total > 0
    ? Math.round(submissions.reduce((acc, s) => {
        const mx = Number(s.max_score) || 0
        return acc + (mx > 0 ? (Number(s.score) || 0) / mx * 100 : 0)
      }, 0) / total)
    : 0
  return { total, avgPct, perQuestion, problemQuestions }
}
