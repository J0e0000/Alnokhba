// Task 41 — deterministic tests for the SESSION-AWARE exam pick + LINE-AWARE
// attendance interpolation (src/lib/qrPdfWhatsApp.js). Run: bun scripts/task41_test_report_smarts.js
import {
  buildAttendanceMessage,
  getReportTemplateValues,
  DEFAULT_PRESENT_TEMPLATE,
} from '../src/lib/qrPdfWhatsApp.js'

let pass = 0
let fail = 0
const ok = (cond, name) => { if (cond) { pass++ ; console.log('  ✓', name) } else { fail++; console.log('  ✗ FAIL:', name) } }

const lessonExamDay = { id: 'L1', session_date: '2026-10-14', lesson_topic: 'شرح درس جديد', homework_text: '' }
const lessonNoExam = { id: 'L3', session_date: '2026-10-13', lesson_topic: 'مراجعة' }
const exams = [
  { id: 'E1', title: 'امتحان شهر أكتوبر', lesson_session_id: 'L1', max_score_per_section: 10, created_at: '2026-10-01T10:00:00Z' },
  { id: 'E2', title: 'اختبار اليوم القصير', lesson_session_id: 'L2', max_score_per_section: 10, created_at: '2026-10-14T09:00:00Z' },
]
const scoresZiad = [
  // NOTE: E2 is NEWER than E1 — the session pick must STILL choose E1 on L1.
  // Shape mirrors the store's examScoresByStudent mapping (exam_title +
  // max_score_per_section resolved from the exams embed).
  { exam_id: 'E1', exam_title: 'امتحان شهر أكتوبر', max_score_per_section: 10, total_score: 9, section_scores: { a: 9 }, created_at: '2026-10-01T10:00:00Z' },
  { exam_id: 'E2', exam_title: 'اختبار اليوم القصير', max_score_per_section: 10, total_score: 5, section_scores: { a: 5 }, created_at: '2026-10-14T09:00:00Z' },
]
const student = { name: 'زياد', group_name: 'ب', points: 42, warnings: 0 }
const settings = {}

// 1) Session exam day → THAT exam's score (not the newest overall).
const m1 = buildAttendanceMessage(student, { status: 'حاضر', lesson: lessonExamDay, settings, examScores: scoresZiad, exams })
ok(m1.includes('امتحان شهر أكتوبر'), 'exam day → session exam title (not newest)')
ok(m1.includes('9 من 10 (90%)'), 'exam day → session exam score/max/pct')
ok(!m1.includes('اختبار اليوم القصير'), 'exam day → newer other-session exam NOT leaked')

// 2) No exam in this session → NO exam line at all (student has scores in history).
const m2 = buildAttendanceMessage(student, { status: 'حاضر', lesson: lessonNoExam, settings, examScores: scoresZiad, exams })
ok(!m2.includes('درجة الامتحان'), 'no-exam session → no exam line')
ok(!m2.includes('أكتوبر') && !m2.includes('القصير'), 'no-exam session → no history leak')

// 3) Session HAS an exam but THIS student has no score in it → collapse (absent kid / ungraded).
const scoresNoor = [{ exam_id: 'E2', exam_title: 'اختبار اليوم القصير', max_score_per_section: 10, total_score: 7, section_scores: { a: 7 }, created_at: '2026-10-14T09:00:00Z' }]
const m3 = buildAttendanceMessage(student, { status: 'حاضر', lesson: lessonExamDay, settings, examScores: scoresNoor, exams })
ok(!m3.includes('درجة الامتحان'), 'no score in session exam → no exam line')

// 4) Legacy call (no exams arg) → LATEST exam pick preserved (PDF profile path).
const legacy = getReportTemplateValues(scoresZiad, student, lessonExamDay)
ok(legacy.examTitle === 'اختبار اليوم القصير' && legacy.examScore === 5, 'legacy (no exams arg) → latest-exam fallback unchanged')

// 5) LINE-AWARE collapse: {examLine} alone on a line + no data → the whole line disappears.
const custom = 'سطر أول\n{examLine}\nسطر أخير'
const vEmpty = getReportTemplateValues(scoresNoor, student, lessonExamDay, exams)
const t1 = (() => { // replicate interpolateAttendance through the public builder
  const msg = buildAttendanceMessage(student, {
    status: 'حاضر', lesson: lessonExamDay, settings: { ...settings, msg_attendance_present: custom }, examScores: scoresNoor, exams,
  })
  return msg
})()
ok(t1 === 'سطر أول\nسطر أخير', 'blank {examLine} line collapses (no empty gap)')
ok(!/\n{3,}/.test(t1), 'no triple newlines left behind')

// 6) Same custom template WITH data → line appears between the others.
const t2 = buildAttendanceMessage(student, {
  status: 'حاضر', lesson: lessonExamDay, settings: { ...settings, msg_attendance_present: custom }, examScores: scoresZiad, exams,
})
ok(t2.includes('سطر أول\nدرجة الامتحان: اختبار «امتحان شهر أكتوبر»'), 'filled {examLine} line stays in place')

// 7) Default present template still renders exactly as before on an exam day.
const t3 = buildAttendanceMessage(student, { status: 'حاضر', lesson: lessonExamDay, settings, examScores: scoresZiad, exams })
ok(t3 === DEFAULT_PRESENT_TEMPLATE
  .replaceAll('{studentName}', 'زياد')
  .replaceAll('{group}', 'ب')
  .replace('{sessionDetails}', 'درجة الامتحان: اختبار «امتحان شهر أكتوبر» — 9 من 10 (90%)\nموضوع الحصة: شرح درس جديد\n')
  .replaceAll('{sessionDetails}', '')
  , 'default present template shape unchanged (exam → topic order)')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
