// ============================================================================
// gradeImport — محرك استيراد درجات Excel (Round 9)
// ----------------------------------------------------------------------------
// مطابقة ذكية آمنة: مستحيل تخمّن طالب غلط بصمت.
//   الطبقات (بترتيب الأولوية):
//     1) كود الطالب نفسه بالظبط (فريد)      → مطابقة أكيدة
//     2) الاسم المُطبَّع نفسه بالظبط (فريد)   → مطابقة أكيدة
//     3) رقم الهاتف نفسه المُطبَّع (فريد)     → مطابقة أكيدة
//     4) مطابقة ضبابية قوية + بدون منافس      → ثقة عالية (تلقائية)
//     5) مطابقة ضبابية مع منافسين قريبين     → لازم تأكيد المستخدم
//     6) أقل من كده                          → مفيش مطابقة (اختيار يدوي/تخطي)
//   التطبيع العربي: تشكيل + تطويل + توحيد الحروف (أ/إ/آ→ا، ى→ي، ة→ه…) +
//   علامات الترقيم + المسافات — من غير over-normalization يدمج طلاب مختلفين.
// ============================================================================

// ── التطبيع العربي (أقوى من تطبيع البحث — للمطابقة) ──
const DIACRITICS = /[\u064B-\u0652\u0670\u0640\u0653-\u065F\u06D6-\u06ED]/g
const PUNCT = /[.,،؛:؟!'"«»„“”()\[\]{}\-_/\\|·•~`*#@%^&+=<>]/g

export function normalizeArabicName(value) {
  return String(value || '')
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(PUNCT, ' ')
    .replace(/[\u200c-\u200f\u202a-\u202e]/g, '') // zero-width + bidi marks
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

export function normalizePhone(value) {
  let d = String(value || '').replace(/\D/g, '')
  // تطبيع رقم مصري: 01012345678 / 201012345678 (بدون الصفر) / +201012345678 /
  // 00201012345678 → كلها 01012345678
  if (d.startsWith('0020') && d.length === 15) return d.slice(4)   // 0020 + 01012345678
  if (d.startsWith('0020') && d.length === 14) return '0' + d.slice(4) // 0020 + 1012345678
  if (d.startsWith('20') && d.length === 13) return d.slice(2)     // 20 + 01012345678
  if (d.startsWith('20') && d.length === 12) return '0' + d.slice(2) // 20 + 1012345678
  return d
}

// ── مسافة ليفنشتاين (نسبة تشابه 0..1) ──
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array(b.length + 1)
  let cur = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev; prev = cur; cur = tmp
  }
  return prev[b.length]
}

function similarityRatio(a, b) {
  if (!a && !b) return 1
  if (!a || !b) return 0
  const dist = levenshtein(a, b)
  return 1 - dist / Math.max(a.length, b.length)
}

// ── تشابه الاسم: tokens (ترتيب مستقل) + jaccard + السلسلة الكاملة ──
export function nameSimilarity(aNorm, bNorm) {
  const aT = aNorm.split(' ').filter(Boolean)
  const bT = bNorm.split(' ').filter(Boolean)
  if (!aT.length || !bT.length) return 0
  // احتواء توكنز الإكسل داخل الاسم الكامل (زي «يوسف حسن» ⊆ «يوسف حسن محمود»):
  // ثقة عالية (0.9) — لكن لو فيه أكتر من طالب بيحتوي نفس التوكنز نفسها بتتحول
  // تلقائيًا لتأكيد يدوي في matchRowToStudents (مثال المواصفات بالظبط).
  const setA = new Set(aT)
  const setB = new Set(bT)
  const contained = aT.every((t) => setB.has(t))
  // توكن واحد مستتر أضعف شوية (اسم واحد بس مش دليل كافي على التطابق التلقائي)
  const containmentScore = contained ? (aT.length >= 2 ? 0.9 : 0.7) : 0
  // مطابقة أفضل token لكل token (greedy)
  const usedB = new Array(bT.length).fill(false)
  let sum = 0
  for (const at of aT) {
    let best = 0, bestIdx = -1
    bT.forEach((bt, i) => {
      if (usedB[i]) return
      const s = at === bt ? 1 : similarityRatio(at, bt)
      if (s > best) { best = s; bestIdx = i }
    })
    if (bestIdx >= 0) { usedB[bestIdx] = true; sum += best }
  }
  const tokenAvg = sum / Math.max(aT.length, bT.length)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  const union = new Set([...setA, ...setB]).size
  const jaccard = union ? inter / union : 0
  const full = similarityRatio(aNorm, bNorm)
  return Math.max(containmentScore, tokenAvg, jaccard, full)
}

// ============================================================================
// اكتشاف الأعمدة
// ============================================================================
const HEADER_SETS = {
  name: ['الاسم', 'اسم الطالب', 'الطالب', 'الطلاب', 'اسم التلميذ', 'التلميذ', 'الاسم بالكامل', 'name', 'student name', 'student', 'fullname', 'full name'],
  code: ['الكود', 'كود الطالب', 'كود التلميذ', 'الرقم', 'الرقم التعريفي', 'الرقم القومي', 'كود', 'code', 'student code', 'id', 'student id', 'number'],
  grade: ['الدرجة', 'الدرجات', 'الدرجه', 'المجموع', 'النتيجة', 'العلامة', 'درجة', 'درجه', 'الدرجة الكلية', 'المجموع الكلي', 'grade', 'score', 'mark', 'marks', 'total', 'grades', 'result', 'degree'],
  group: ['المجموعة', 'المجموعه', 'الصف', 'الفصل', 'السنتر', 'group', 'class', 'section'],
}

function normHeader(h) {
  return normalizeArabicName(h)
}

// اكتشاف عمود من صف العناوين — الأولوية: تطابق كامل ثم احتواء.
function detectColumn(headers, role) {
  const normed = headers.map((h) => normHeader(h))
  const exact = HEADER_SETS[role]
  for (const key of exact) {
    const k = normHeader(key)
    const idx = normed.findIndex((h) => h === k)
    if (idx >= 0) return headers[idx]
  }
  for (const key of exact) {
    const k = normHeader(key)
    const idx = normed.findIndex((h) => h && (h.includes(k) || k.includes(h)) && Math.min(h.length, k.length) >= 2)
    if (idx >= 0) return headers[idx]
  }
  return null
}

// احتياط: أول عمود نصي = الاسم، وأول عمود رقمي = الدرجة
function guessByContent(headers, rows, role) {
  if (!rows.length) return null
  const candidates = headers.filter((h) => h && h !== '__rownum__')
  if (role === 'name') {
    for (const h of candidates) {
      const texts = rows.slice(0, 30).map((r) => String(r[h] ?? '')).filter(Boolean)
      if (texts.length && texts.every((t) => /[ء-يa-zA-Z]/.test(t) && !/^\d+(\.\d+)?$/.test(t.trim()))) return h
    }
    return candidates[0] || null
  }
  if (role === 'grade') {
    for (const h of candidates) {
      const nums = rows.slice(0, 30).map((r) => parseFloat(r[h])).filter((n) => Number.isFinite(n))
      if (nums.length) return h
    }
    return null
  }
  return null
}

export function detectColumns(headers, rows) {
  let name = detectColumn(headers, 'name') || guessByContent(headers, rows, 'name')
  let code = detectColumn(headers, 'code')
  let grade = detectColumn(headers, 'grade') || guessByContent(headers, rows, 'grade')
  let group = detectColumn(headers, 'group')
  // مفيش عمودين بنفس الدور
  const used = new Set([name, code, grade, group].filter(Boolean))
  if (grade && grade === name) grade = null
  return { name, code, grade, group }
}

// ============================================================================
// المطابقة الذكية
// ============================================================================
// الحالة:
//   exact_code / exact_name / exact_phone → مطابقة أكيدة (تلقائية)
//   high   → ثقة عالية (تلقائية) — لازم بدون منافس قريب
//   medium → لازم تأكيد المستخدم (فيه منافس أو الاسم أقصر من الداتابيس بكتير)
//   none   → مفيش مطابقة (اختيار يدوي / تخطي)

const THRESHOLDS = { candidate: 0.5, high: 0.85, highGap: 0.15, medium: 0.6 }

export function matchRowToStudents(row, students) {
  const normName = normalizeArabicName(row.name)
  const rowCode = String(row.code || '').trim()
  const rowPhone = normalizePhone(row.phone)

  // 1) كود الطالب بالظبط (فريد)
  if (rowCode) {
    const byCode = students.filter((s) => String(s.code || '').trim() === rowCode)
    if (byCode.length === 1) return { state: 'exact_code', student: byCode[0], score: 1, candidates: [] }
    if (byCode.length > 1) return { state: 'medium', student: null, score: 1, candidates: byCode.map((s) => ({ student: s, score: 1 })) }
  }
  // 2) الاسم المطبع بالظبط (فريد)
  if (normName) {
    const byName = students.filter((s) => normalizeArabicName(s.name) === normName)
    if (byName.length === 1) return { state: 'exact_name', student: byName[0], score: 1, candidates: [] }
    if (byName.length > 1) return { state: 'medium', student: null, score: 1, candidates: byName.map((s) => ({ student: s, score: 1 })) }
  }
  // 3) الهاتف المطبع (فريد)
  if (rowPhone && rowPhone.length >= 8) {
    const byPhone = students.filter((s) => {
      const p = normalizePhone(s.phone)
      return p && p === rowPhone
    })
    if (byPhone.length === 1) return { state: 'exact_phone', student: byPhone[0], score: 1, candidates: [] }
  }
  // 4-6) ضبابي مع منافسين
  if (!normName) return { state: 'none', student: null, score: 0, candidates: [] }
  const scored = students
    .map((s) => ({ student: s, score: nameSimilarity(normName, normalizeArabicName(s.name)) }))
    .filter((c) => c.score >= THRESHOLDS.candidate)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
  if (!scored.length) return { state: 'none', student: null, score: 0, candidates: [] }
  const top = scored[0]
  const second = scored[1]
  if (top.score >= THRESHOLDS.high && (!second || top.score - second.score >= THRESHOLDS.highGap || second.score < THRESHOLDS.medium)) {
    return { state: 'high', student: top.student, score: top.score, candidates: scored }
  }
  if (top.score >= THRESHOLDS.medium) {
    return { state: 'medium', student: null, score: top.score, candidates: scored }
  }
  return { state: 'none', student: null, score: top.score, candidates: scored }
}

// ============================================================================
// التحقق من الدرجة
// ============================================================================
export function validateGrade(rawScore, maxTotal) {
  if (rawScore === null || rawScore === undefined || String(rawScore).trim() === '') {
    return { ok: false, reason: 'empty', message: 'الدرجة فاضية' }
  }
  const n = parseFloat(String(rawScore).replace(/[٫,]/g, '.'))
  if (!Number.isFinite(n)) return { ok: false, reason: 'not_number', message: 'الدرجة مش رقم' }
  if (n < 0) return { ok: false, reason: 'negative', message: `درجة سالبة (${rawScore})` }
  if (maxTotal > 0 && n > maxTotal) {
    return { ok: false, reason: 'over_max', message: `درجة غير صالحة: ${n} بتتجاوز العظمى ${maxTotal}` }
  }
  return { ok: true, value: Math.round(n * 100) / 100 }
}
