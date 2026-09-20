// Sanity tests for the Smart Insights engine (pure functions, no DOM).
// Run: node scripts/test-insights-engine.mjs
import { runInsightAnalysis } from '../src/lib/insights/engine.js'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-09-21T12:00:00Z')
let failures = 0

function expect(cond, label) {
  if (cond) { console.log(`  PASS  ${label}`) } else { failures += 1; console.error(`  FAIL  ${label}`) }
}

const dateInCur = (i) => new Date(now.getTime() - (i + 1) * 3 * DAY).toISOString().slice(0, 10)
const dateInPrev = (i) => new Date(now.getTime() - (28 + (i + 1) * 3) * DAY).toISOString().slice(0, 10)

// ── Build a world: 2 groups ──
// groupA "الإعدادي أ": absence rising to 45% (5/11 sessions), 4 repeat absentees, homework dropped to 40%
// groupB "الثانوي ب": healthy (90% present, hw 85%) → must produce NOTHING
const students = []
const sessions = []
const attendance = []
const scores = {}

let sid = 0
const mkStudent = (group, name, warnings = 0) => {
  const id = `s${++sid}`
  students.push({ id, name, group_name: group, warnings, points: 10 })
  return id
}
const A = Array.from({ length: 10 }, (_, i) => mkStudent('الإعدادي أ', `طالبأ${i + 1}`))
const B = Array.from({ length: 10 }, (_, i) => mkStudent('الثانوي ب', `طالبب${i + 1}`))
// 3 students near the warnings limit (3) with 2 warnings
A.slice(0, 3).forEach((id) => { students.find((s) => s.id === id).warnings = 2 })

// sessions: 11 current-window per group + 8 previous-window per group
for (let i = 0; i < 11; i++) {
  for (const g of ['الإعدادي أ', 'الثانوي ب']) {
    sessions.push({ id: `${g}-${i}`, group_name: g, session_date: dateInCur(i), status: 'completed' })
  }
}
for (let i = 0; i < 8; i++) {
  for (const g of ['الإعدادي أ', 'الثانوي ب']) {
    sessions.push({ id: `${g}-p${i}`, group_name: g, session_date: dateInPrev(i), status: 'completed' })
  }
}

// attendance helper
let rid = 0
const mark = (session, studentId, status, hw = null) => {
  attendance.push({
    id: `r${++rid}`, student_id: studentId, lesson_session_id: session.id,
    status, homework_status: hw, attendance_date: session.session_date, recorded_at: `${session.session_date}T10:00:00Z`,
  })
}

// ── groupA current: 11 sessions. First 6: all present. Last 5: 5 absent, 5 present (45% overall absences)
sessions.filter((s) => s.group_name === 'الإعدادي أ' && !s.id.includes('-p')).forEach((session, i) => {
  A.forEach((sid2, idx) => {
    const absent = i >= 3 && idx < 6
    mark(session, sid2, absent ? 'غائب' : 'حاضر', i >= 3 ? 'لم يتم' : 'مكتمل')
  })
})
// ── groupA previous: all present, hw done (healthy baseline)
sessions.filter((s) => s.group_name === 'الإعدادي أ' && s.id.includes('-p')).forEach((session) => {
  A.forEach((sid2) => mark(session, sid2, 'حاضر', 'مكتمل'))
})
// ── groupB current+previous: healthy
sessions.filter((s) => s.group_name === 'الثانوي ب').forEach((session) => {
  B.forEach((sid2) => mark(session, sid2, 'حاضر', 'مكتمل'))
})

// ── exam scores: 4 students in groupB share a hard last exam (drop 30%) — exam-difficulty insight
const mkScore = (studentId, examId, title, total, max, created) => {
  scores[studentId] ||= []
  scores[studentId].push({
    exam_id: examId, exam_title: title, max_score_per_section: max,
    section_scores: { s1: total }, total_score: total, created_at: created,
  })
}
const exams = ['امتحان1', 'امتحان2', 'امتحان3', 'امتحان4']
const examTotals = [9, 8.5, 8, 5] // 90%, 85%, 80%, 50% — consistent shared drop
exams.forEach((examId, i) => {
  B.slice(0, 4).forEach((sid2) => {
    mkScore(sid2, examId, examId, examTotals[i], 10, new Date(now.getTime() - (40 - i * 9) * DAY).toISOString())
  })
})
// 3 students in groupA: individual consistent decline with DIFFERENT last
// exams (s5 ends at a4; s6/s7 end at a3) → NOT a shared-exam difficulty case
mkScore(A[5], 'ex-a1', 'أ1', 9, 10, new Date(now.getTime() - 50 * DAY).toISOString())
mkScore(A[5], 'ex-a2', 'أ2', 8, 10, new Date(now.getTime() - 40 * DAY).toISOString())
mkScore(A[5], 'ex-a3', 'أ3', 6, 10, new Date(now.getTime() - 30 * DAY).toISOString())
mkScore(A[5], 'ex-a4', 'أ4', 4, 10, new Date(now.getTime() - 20 * DAY).toISOString())
;[A[6], A[7]].forEach((sid2, k) => {
  mkScore(sid2, 'ex-a1', 'أ1', 9, 10, new Date(now.getTime() - (45 - k) * DAY).toISOString())
  mkScore(sid2, 'ex-a2', 'أ2', 8, 10, new Date(now.getTime() - (35 - k) * DAY).toISOString())
  mkScore(sid2, 'ex-a3', 'أ3', 6, 10, new Date(now.getTime() - (25 - k) * DAY).toISOString())
})

const result = runInsightAnalysis({ students, allAttendance: attendance, lessonSessions: sessions, examScoresByStudent: scores, settings: { insight_config: { max_warnings: 3 } }, now })

const byType = {}
for (const ins of result.insights) (byType[ins.type] ||= []).push(ins)
console.log('\nInsights produced:')
result.insights.forEach((i) => console.log(` - [${i.severity}] ${i.type} :: ${i.title}`))
console.log(`meta: findings=${result.meta.findingsTotal} insights=${result.meta.insightsCreated}`)

console.log('\nAssertions:')
expect(result.insights.some((i) => i.type === 'group-absence' && i.group === 'الإعدادي أ'), 'group-absence insight for rising absence group')
expect(result.insights.some((i) => i.type === 'repeat-absence' && i.group === 'الإعدادي أ'), 'repeat-absence insight (5 absent students of 5)')
expect(result.insights.some((i) => i.type === 'homework-decline' && i.group === 'الإعدادي أ'), 'homework-decline insight')
expect(result.insights.some((i) => i.type === 'exam-decline' && i.group === 'الإعدادي أ'), 'exam-decline insight for groupA individual trends')
expect(!result.insights.some((i) => i.type === 'exam-decline' && i.group === 'الثانوي ب'), 'NO exam-decline for groupB (difficulty, not student trend)')
expect(result.insights.some((i) => i.type === 'warnings-cluster'), 'warnings-cluster insight (3 students at 2/3 warnings)')
expect(!result.insights.some((i) => i.group === 'الثانوي ب' && ['group-absence', 'repeat-absence', 'homework-decline'].includes(i.type)), 'healthy group produces NO attendance/hw insights (materiality)')
expect(result.insights.every((i) => Array.isArray(i.reasons) && i.reasons.length > 0), 'every insight carries internal materiality reasons')
expect(result.insights.every((i) => i.action && i.lines.length >= 1), 'every insight has action + evidence lines')

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
