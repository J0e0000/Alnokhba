// ============================================================================
// نظام النخبة — Test: intelligent Excel student matching (Round 9)
// REAL logic tests against src/lib/gradeImport.js (ESM import).
// run: node --test tests/excel-import-check.mjs
// ============================================================================
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeArabicName, normalizePhone, nameSimilarity,
  matchRowToStudents, detectColumns, validateGrade,
} from '../src/lib/gradeImport.js'

const ST = [
  { id: 's1', name: 'أحمد محمد حسن', code: '10452', phone: '01012345678', group_name: 'السادس أ' },
  { id: 's2', name: 'أحمد محمد علي', code: '10931', phone: '01198765432', group_name: 'السادس ب' },
  { id: 's3', name: 'محمد علي', code: '10453', phone: null, group_name: 'السادس أ' },
  { id: 's4', name: 'يوسف حسن محمود', code: '10454', phone: '01234567890', group_name: 'السادس أ' },
  { id: 's5', name: 'خالد سعيد', code: '10455', phone: null, group_name: 'السادس أ' },
]

test('normalizeArabicName: diacritics + letter unification + tatweel + punctuation', () => {
  assert.equal(normalizeArabicName('أَحْـمَد'), normalizeArabicName('أحمد'))
  assert.equal(normalizeArabicName('احمد'), normalizeArabicName('أحمد'))
  assert.equal(normalizeArabicName('أسامه'), normalizeArabicName('اسامه'))
  assert.equal(normalizeArabicName('مصطفى'), normalizeArabicName('مصطفى'))
  assert.equal(normalizeArabicName('مصطفي'), normalizeArabicName('مصطفى'))
  assert.equal(normalizeArabicName('هدى'), normalizeArabicName('هدي'))
  assert.equal(normalizeArabicName('هداة'), normalizeArabicName('هداه')) // ة→ه
  assert.equal(normalizeArabicName('محمـــد'), normalizeArabicName('محمد'))
  assert.equal(normalizeArabicName('محمد, علي.'), normalizeArabicName('محمد علي'))
  assert.equal(normalizeArabicName('Ahmed Mohamed'), 'ahmed mohamed')
})

test('normalizePhone: Egyptian prefix forms collapse to the same number', () => {
  assert.equal(normalizePhone('+20 101 234 5678'), normalizePhone('01012345678'))
  assert.equal(normalizePhone('00201012345678'), normalizePhone('01012345678'))
  assert.equal(normalizePhone('201012345678'), normalizePhone('01012345678'))
  assert.notEqual(normalizePhone('01012345678'), normalizePhone('01198765432'))
})

test('exact code match → auto (exact_code)', () => {
  const r = matchRowToStudents({ name: 'اسم مختلف خالص', code: '10452' }, ST)
  assert.equal(r.state, 'exact_code')
  assert.equal(r.student.id, 's1')
})

test('exact normalized full name (unique) → auto (exact_name)', () => {
  const r = matchRowToStudents({ name: 'أَحمد محمّد حَسن', code: '' }, ST)
  assert.equal(r.state, 'exact_name')
  assert.equal(r.student.id, 's1')
})

test('exact phone match (normalized) → auto (exact_phone)', () => {
  const r = matchRowToStudents({ name: 'اسم تاني', code: '', phone: '+201234567890' }, ST)
  assert.equal(r.state, 'exact_phone')
  assert.equal(r.student.id, 's4')
})

// 🔴 SPEC 12 — the exact example from the spec: ambiguous names must ASK,
// never silently pick one of two "Ahmed Mohamed" students.
test('ambiguous partial name (spec example) → medium with BOTH candidates — never auto-picks', () => {
  const r = matchRowToStudents({ name: 'أحمد محمد', code: '' }, ST)
  assert.equal(r.state, 'medium')
  assert.equal(r.student, null)
  const ids = r.candidates.map((c) => c.student.id)
  assert.ok(ids.includes('s1') && ids.includes('s2'), 'both Ahmed Mohamed candidates present')
})

test('unique strong partial (no competitor) → high auto-match', () => {
  const r = matchRowToStudents({ name: 'يوسف حسن', code: '' }, ST)
  assert.equal(r.state, 'high')
  assert.equal(r.student.id, 's4')
})

test('duplicate names in DB → medium (ambiguous), even exact name', () => {
  const db = [...ST, { id: 's9', name: 'محمد علي', code: '99', phone: null }]
  const r = matchRowToStudents({ name: 'محمد علي', code: '' }, db)
  assert.equal(r.state, 'medium')
})

test('no match at all → none (never guesses)', () => {
  const r = matchRowToStudents({ name: 'شخص مش موجود خالص', code: '' }, ST)
  assert.equal(r.state, 'none')
  assert.equal(r.student, null)
})

test('unknown code does not match a different student', () => {
  const r = matchRowToStudents({ name: 'أحمد محمد حسن', code: '77777' }, ST)
  // الكود مش موجود → مفيش مطابقة بالكود؛ الاسم نفسه فريد → exact_name للطالب الصح
  assert.ok(['exact_name', 'high'].includes(r.state))
  assert.equal(r.student.id, 's1')
})

test('fuzzy: spelling variation with a stray letter (typo)', () => {
  // يوسف حسن محمود vs يوسف حسن محماد (خطأ حرف)
  const r = matchRowToStudents({ name: 'يوسف حسن محماد', code: '' }, ST)
  assert.ok(['exact_name', 'high', 'medium'].includes(r.state))
  if (r.student) assert.equal(r.student.id, 's4')
  else assert.ok(r.candidates[0].student.id === 's4')
})

test('nameSimilarity basics', () => {
  assert.ok(nameSimilarity(normalizeArabicName('أحمد محمد حسن'), normalizeArabicName('احمد محمد حسن')) === 1)
  const partial = nameSimilarity(normalizeArabicName('يوسف حسن'), normalizeArabicName('يوسف حسن محمود'))
  assert.ok(partial >= 0.6 && partial < 1, `partial in (0.6,1): ${partial}`)
  assert.equal(nameSimilarity('', 'محمد'), 0)
})

test('column detection: Arabic headers', () => {
  const rows = [{ 'الاسم': 'أحمد', 'الكود': '1', 'الدرجة': 30, 'المجموعة': 'أ' }]
  const c = detectColumns(Object.keys(rows[0]), rows)
  assert.equal(c.name, 'الاسم')
  assert.equal(c.code, 'الكود')
  assert.equal(c.grade, 'الدرجة')
  assert.equal(c.group, 'المجموعة')
})

test('column detection: English headers', () => {
  const rows = [{ 'Student Name': 'Ahmed', 'Code': 'A1', 'Score': 30, 'Class': '6A' }]
  const c = detectColumns(Object.keys(rows[0]), rows)
  assert.equal(c.name, 'Student Name')
  assert.equal(c.code, 'Code')
  assert.equal(c.grade, 'Score')
  assert.equal(c.group, 'Class')
})

test('column detection: fallback by content when headers are unnamed', () => {
  const rows = [{ 'عمود 1': 'أحمد محمد', 'عمود 2': 32, 'عمود 3': 'ملاحظة' }]
  const c = detectColumns(Object.keys(rows[0]), rows)
  assert.equal(c.name, 'عمود 1')
  assert.equal(c.grade, 'عمود 2')
})

test('grade validation: over max / negative / non-numeric / empty', () => {
  assert.deepEqual(validateGrade('55', 50), { ok: false, reason: 'over_max', message: 'درجة غير صالحة: 55 بتتجاوز العظمى 50' })
  assert.equal(validateGrade('-3', 50).ok, false)
  assert.equal(validateGrade('abc', 50).ok, false)
  assert.equal(validateGrade('', 50).ok, false)
  assert.equal(validateGrade('32', 50).ok, true)
  assert.equal(validateGrade(32.5, 50).value, 32.5)
  assert.equal(validateGrade('٤٥', 50).ok, false) // Arabic-Indic digits rejected as non-number (fix in Excel first)
  assert.equal(validateGrade('٣2', 50).ok, false)
})

test('grade validation: never clamps', () => {
  const r = validateGrade('55', 50)
  assert.equal(r.ok, false) // ممنوع القص التلقائي — رفض صريح
})
