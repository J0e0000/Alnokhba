// ═══════════════════════════════════════════════════════════════════════════
// HOMEWORK QUIZ HELPERS — واجب الاختيارات (Task 44)
// أدوات مشتركة بين واجهة المدرس (بناء الواجب) وصفحة الطالب (التسليم):
//   • تطبيع الأرقام العربية/الهندية → لاتيني (الطالب يكتب رقمه بأي لغة)
//   • بصمة الجهاز (كل جهاز = تسليم واحد لكل واجب)
//   • قوالب جاهزة: اختيارات A/B/C/D أو صح/غلط — نص السؤال اختياري
//   • محلّل نص الأسئلة (لصق/ملف نصي) — محاولة ذكية لفهم الصيغ الشائعة
// الرصد الفعلي يتم على السيرفر داخل submit_homework_quiz (migration 055).
// ═══════════════════════════════════════════════════════════════════════════

// ── الأرقام ─────────────────────────────────────────────────────────────────
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

// الرقم اللي بيكتبه الطالب: نطلّع الأرقام بس (بتقبل +20 / مسافات / شرطات)
export function normalizeStudentNumber(input) {
  return normalizeDigits(String(input ?? '')).replace(/\D/g, '')
}

// ── بصمة الجهاز ─────────────────────────────────────────────────────────────
// معرّف عشوائي ثابت في localStorage — بيتخزن مع التسليم الأول، والسيرفر
// يمنع تاني تسليم من نفس الجهاز لكل واجب (unique quiz_id + device_fingerprint).
const DEVICE_KEY = 'nokhba_hw_device_v1'
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = (crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`)
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return `dev-${Date.now()}-e`
  }
}

// ── قوالب الأسئلة الجاهزة ───────────────────────────────────────────────────
export const TRUE_FALSE_OPTIONS = [
  { id: 't', label: 'صح' },
  { id: 'f', label: 'غلط' },
]

// الاختيارات الجاهزة أ/ب/ج/د — المدرس يقدر يعدّل النص أو يسيبه فاضي
// (الواجب أصلًا في الكتاب — المهم يحدد الإجابة)
export const READY_OPTION_LABELS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و']

export function newQuestion(kind = 'mcq', position = 0) {
  if (kind === 'true_false') {
    return {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'true_false',
      question_text: '',
      options: TRUE_FALSE_OPTIONS.map((o) => ({ ...o })),
      correct_options: [],
      explanation: '',
      position,
    }
  }
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'mcq',
    question_text: '',
    options: READY_OPTION_LABELS.slice(0, 4).map((label, i) => ({ id: String.fromCharCode(97 + i), label })),
    correct_options: [],
    explanation: '',
    position,
  }
}

export function normalizeQuestions(list) {
  const out = []
  if (!Array.isArray(list)) return out
  list.forEach((q, i) => {
    const kind = q?.kind === 'true_false' ? 'true_false' : 'mcq'
    let options = Array.isArray(q?.options)
      ? q.options
        .map((o, oi) => {
          if (o && typeof o === 'object') {
            const id = String(o.id ?? String.fromCharCode(97 + oi)).slice(0, 4)
            return { id, label: String(o.label ?? '').trim() }
          }
          return { id: String.fromCharCode(97 + oi), label: String(o ?? '').trim() }
        })
        .filter((o) => o.label !== '')
      : []
    if (kind === 'true_false') options = TRUE_FALSE_OPTIONS.map((o) => ({ ...o }))
    const correct = Array.isArray(q?.correct_options) ? q.correct_options.map(String) : []
    out.push({
      id: String(q?.id || `q-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`),
      kind,
      question_text: String(q?.question_text ?? '').trim(),
      options,
      correct_options: correct.filter((c) => options.some((o) => o.id === c)),
      explanation: String(q?.explanation ?? '').trim(),
      position: Number.isFinite(q?.position) ? q.position : i,
    })
  })
  return out
}

// ── محاولة فهم نص الأسئلة (لصق أو ملف نصي) ──────────────────────────────────
// بيخرج أفضل تفسير ممكن — المدرس بيراجع ويصلّح قبل الحفظ (best effort بالطلب).
// الصيغ المدعومة:
//   1) نص السؤال / س1: نص / Q1. نص — والسؤال لوحده كافي (نص اختياري)
//   أ) خيار   ب- خيار   c) option   — أو سطر "صح / غلط" لسؤال صح وغلط
//   الإجابة: أ / الاجابه: صح / Answer: b — أو علامة ✅/✔/✓ جوّه الخيار
const LETTER_IDS = ['a', 'b', 'c', 'd', 'e', 'f']
// كل الحروف اللي ممكن تعبّر عن "الخيار رقم i" (أ/ا، ب، ج/جـ، د، هـ، و)
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
  // "أ) نص" / "ب - نص" / "c) text" / "هـ- نص"
  const m = line.match(/^([^\w\sأ-ي]|\s)*([أ-يa-zA-Z]{1,2})\s*[-).::：]\s*(.+)$/)
  if (!m) return null
  const idx = letterToIndex(m[2])
  if (idx < 0 || idx >= 6) return null
  return { index: idx, label: m[3].trim() }
}

function answerToIds(answerText, options, kind) {
  const raw = String(answerText || '').trim()
  if (!raw) return []
  const cleaned = normalizeDigits(raw).replace(/[().*✅✔✓\s]+/g, (mm) => (/\s/.test(mm) ? ' ' : ''))
  if (kind === 'true_false') {
    if (/صح|true|✔|✅|✓/i.test(cleaned)) return ['t']
    if (/غلط|خطأ|false|✗|❌/i.test(cleaned)) return ['f']
    return []
  }
  // حرف؟
  for (const part of cleaned.split(/[,،\sو]+/)) {
    const idx = letterToIndex(part)
    if (idx >= 0 && options[idx]) return [options[idx].id]
  }
  // نص خيار كامل؟
  const byLabel = options.find((o) => o.label && cleaned.includes(normalizeDigits(o.label).replace(/\s+/g, '')))
  if (byLabel) return [byLabel.id]
  return []
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
    if (cur.kind === 'true_false') cur.options = TRUE_FALSE_OPTIONS.map((o) => ({ ...o }))
    else if (cur.options.length === 0) cur.options = READY_OPTION_LABELS.slice(0, 4).map((label, i) => ({ id: LETTER_IDS[i], label }))
    if (cur.correct_options.length === 0) warnings.push(`سؤال ${questions.length + 1}: ملوش إجابة محددة — هتحتاج تحددها بنفسك`)
    questions.push(cur)
    cur = null
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]

    // سطر إجابة صريح
    const am = line.match(ANSWER_LINE_RE)
    if (am && cur) {
      const ids = answerToIds(am[1], cur.options, cur.kind)
      if (ids.length) cur.correct_options = ids
      else warnings.push(`سؤال ${questions.length + 1}: مقدرتش أفهم الإجابة «${am[1].slice(0, 24)}» — حددها بنفسك`)
      continue
    }

    // بداية سؤال مرقّم: "1)" / "س2:" / "Q3."
    const qm = line.match(QNUM_RE)
    if (qm && (qm[1] || qm[3] || qm[5])) {
      pushCur()
      const isTF = TF_LINE_RE.test(line)
      cur = newQuestion(isTF ? 'true_false' : 'mcq', questions.length)
      cur.question_text = (qm[2] ?? qm[4] ?? qm[6] ?? '').replace(TF_LINE_RE, '').trim()
      continue
    }

    if (!cur) {
      // أول سطر متساب = نص سؤال (أو سؤال صح/غلط)
      const isTF = TF_LINE_RE.test(line)
      cur = newQuestion(isTF ? 'true_false' : 'mcq', questions.length)
      cur.question_text = line.replace(TF_LINE_RE, '').trim()
      continue
    }

    // داخل سؤال قائم: سطر "صح / غلط" → تحويل لصح وغلط
    if (TF_LINE_RE.test(line) && cur.options.length === 0) {
      cur.kind = 'true_false'
      cur.options = TRUE_FALSE_OPTIONS.map((o) => ({ ...o }))
      continue
    }

    // خيار
    const om = matchOptionLine(line)
    if (om && cur.kind === 'mcq') {
      // لو القالب اتولّد جاهز (أ ب ج د فاضي) استبدل أول واحد
      const slot = cur.options[om.index]
      const marked = /[✅✔✓]/.test(line) || /\(\s*صح\s*\)\s*$/.test(line)
      if (slot && !slot.label) cur.options[om.index] = { id: slot.id, label: om.label }
      else cur.options[om.index] = { id: LETTER_IDS[om.index], label: om.label }
      if (marked) cur.correct_options = [cur.options[om.index].id]
      continue
    }

    // سطر عادي جوّه السؤال: لو فيه ✅ على خيار سابق؟ لأ — نضيفه للنص
    if (cur.question_text) cur.question_text += ' ' + line
  }
  pushCur()

  const cleaned = normalizeQuestions(questions.map((q, i) => ({ ...q, position: i })))
  if (cleaned.length === 0) warnings.push('مقدرتش أطلع أسئلة من النص — جرّب تنسخه بصيغة أوضح أو اكتب الأسئلة يدويًا')
  return { questions: cleaned, warnings }
}

// ── تحليل الواجب (واجهة المدرس): أكتر الأسئلة فيها مشاكل ────────────────────
export function buildQuizAnalytics(submissions, questions) {
  const total = submissions.length
  const perQuestion = (questions || []).map((q, idx) => {
    let correct = 0
    let wrong = 0
    let blank = 0
    submissions.forEach((s) => {
      let chosen = s.answers?.[q.id]
      if (typeof chosen === 'string') { try { chosen = JSON.parse(chosen) } catch { /* keep */ } }
      if (!Array.isArray(chosen) || chosen.length === 0) { blank++; return }
      const ok = [...chosen].sort().join(',') === [...(q.correct_options || [])].sort().join(',')
      if (ok) correct++; else wrong++
    })
    return {
      id: q.id,
      label: q.question_text?.trim() ? q.question_text.trim().slice(0, 60) : `السؤال ${idx + 1}`,
      kind: q.kind,
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

// ── تلوين واضح للنتيجة (بناية طلب المستر: الألوان لازم تكون أوضح) ───────────
export const RESULT_COLORS = {
  correct: { bg: 'rgba(34,197,94,.16)', border: 'rgba(34,197,94,.75)', text: '#15803D' },
  wrong: { bg: 'rgba(239,68,68,.14)', border: 'rgba(239,68,68,.75)', text: '#B91C1C' },
  missed: { bg: 'rgba(34,197,94,.16)', border: 'rgba(34,197,94,.75)', text: '#15803D' },
  neutral: { bg: 'rgba(100,116,139,.10)', border: 'rgba(100,116,139,.30)', text: '#475569' },
}
