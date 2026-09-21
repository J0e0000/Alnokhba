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

// ═══════════════════════════════════════════════════════════════════════════
// EXAM COVERAGE RULE — «امتحان الحصة بيختبر الحصة دي والحصص اللي قبلها»
// An exam held at session S tests S + every earlier session of the group.
// The engine must scope its absence cause-check to that covered window and
// say so in plain Arabic. Without exams/session links everything silently
// skips (never fabricated).
// ═══════════════════════════════════════════════════════════════════════════
const G = 'مجموعة س'
const covStudents = [
  { id: 'sa', name: 'أحمد', group_name: G, warnings: 0, points: 0 },
  { id: 'sb', name: 'سيف', group_name: G, warnings: 0, points: 0 },
  { id: 'sc', name: 'كريم', group_name: G, warnings: 0, points: 0 },
  { id: 'sd', name: 'دارين', group_name: G, warnings: 0, points: 0 },
]
const covSessions = []
const covAttendance = []
const covExams = []
for (let i = 0; i < 6; i++) {
  const date = new Date(now.getTime() - (6 - i) * 3 * DAY).toISOString().slice(0, 10)
  covSessions.push({ id: `s${i}`, group_name: G, session_date: date, status: 'completed' })
  covExams.push({ id: `e${i}`, lesson_session_id: `s${i}`, title: `امتحان ${i + 1}`, created_at: `${date}T20:00:00Z` })
}
let covRid = 0
const covMark = (si, studentId, status) => {
  const ses = covSessions[si]
  covAttendance.push({
    id: `cr${++covRid}`, student_id: studentId, lesson_session_id: ses.id,
    status, homework_status: 'مكتمل', attendance_date: ses.session_date, recorded_at: `${ses.session_date}T10:00:00Z`,
  })
}
// A,B decline at e3+e4 (last exam e4); C,D decline at e4+e5 (last exam e5)
covSessions.forEach((_, si) => {
  covStudents.forEach((st) => covMark(si, st.id, 'حاضر'))
})
function buildCoverageWorld({ absences = [], extraE5ForAB = false }) {
  const scores = {}
  const addScore = (sid2, examIdx, total) => {
    ;(scores[sid2] ||= []).push({
      id: `cs-${sid2}-${examIdx}`, exam_id: covExams[examIdx].id, exam_title: covExams[examIdx].title,
      max_score_per_section: 10, section_scores: { a: total }, total_score: total, created_at: covExams[examIdx].created_at,
    })
  }
  for (const sid2 of ['sa', 'sb']) {
    for (let i = 0; i < (extraE5ForAB ? 6 : 5); i++) addScore(sid2, i, i >= 3 ? 6 : 9)
  }
  for (const sid2 of ['sc', 'sd']) {
    for (let i = 0; i < 6; i++) addScore(sid2, i, i >= 4 ? 6 : 9)
  }
  const attendance = covAttendance.map((r) => ({ ...r }))
  for (const [sid2, si] of absences) {
    const rec = attendance.find((r) => r.student_id === sid2 && r.lesson_session_id === `s${si}`)
    if (rec) rec.status = 'غائب'
  }
  return { students: covStudents, allAttendance: attendance, lessonSessions: covSessions, examScoresByStudent: scores, exams: covExams, settings: { insight_config: { max_warnings: 3 } }, now }
}

console.log('\n— Exam coverage worlds —')
// W1: decline + 2 of the 4 declining students absent inside the covered window
{
  const w1 = buildCoverageWorld({ absences: [['sa', 1], ['sa', 3], ['sc', 2]] })
  const r1 = runInsightAnalysis(w1)
  const dec = r1.insights.find((i) => i.type === 'exam-decline' && i.group === G)
  expect(Boolean(dec), 'W1: exam-decline fires when last exams differ across students')
  expect(dec?.metrics?.coveredSessions === 6, 'W1: coverage window = exam session + all 5 before it (6 sessions)')
  expect(dec?.metrics?.absentInCovered === 2, 'W1: absentInCovered counts declining students absent in the covered window (2)')
  expect(Boolean(dec?.lines?.some((l) => l.includes('الجزء اللي الامتحان بيختبره') && l.includes('غايبين'))), 'W1: plain-Arabic coverage line links absence to the tested part')
  expect(!r1.insights.some((i) => i.type === 'exam-difficulty' && i.group === G), 'W1: NO exam-difficulty (drops split across two exams)')
  expect(Boolean(dec?.reasons?.some((x) => x.includes('الحصص اللي قبلها'))), 'W1: reason documents the coverage rule')
}
// W2: everyone declines on the SAME last exam → difficulty insight carries coverage
{
  const w2 = buildCoverageWorld({ absences: [], extraE5ForAB: true })
  const r2 = runInsightAnalysis(w2)
  const diff = r2.insights.find((i) => i.type === 'exam-difficulty' && i.group === G)
  expect(Boolean(diff), 'W2: exam-difficulty fires when all drop on the same last exam')
  expect(diff?.metrics?.coveredSessions === 6, 'W2: difficulty insight carries the covered sessions count')
  expect(Boolean(diff?.lines?.some((l) => l.includes('الحصص اللي قبلها'))), 'W2: difficulty line explains the exam tests its lesson + previous ones')
  expect(!r2.insights.some((i) => i.type === 'exam-decline' && i.group === G), 'W2: NO exam-decline alongside difficulty')
}
// W3: declining students all present in the covered window → honest line
{
  const w3 = buildCoverageWorld({ absences: [] })
  const r3 = runInsightAnalysis(w3)
  const dec3 = r3.insights.find((i) => i.type === 'exam-decline' && i.group === G)
  expect(dec3?.metrics?.absentInCovered === 0, 'W3: absentInCovered = 0 when nobody was absent')
  expect(Boolean(dec3?.lines?.some((l) => l.includes('مفيش غياب في الجزء'))), 'W3: honest line — the level itself needs review, not attendance')
}
// W4: back-compat — no exams input → no coverage claims at all
{
  const w4 = buildCoverageWorld({ absences: [['sa', 1], ['sc', 2]] })
  delete w4.exams
  const r4 = runInsightAnalysis(w4)
  const dec4 = r4.insights.find((i) => i.type === 'exam-decline' && i.group === G)
  expect(Boolean(dec4), 'W4: exam-decline still fires without the exams input')
  expect(dec4?.metrics?.absentInCovered == null && dec4?.metrics?.coveredSessions == null, 'W4: no coverage metrics without exams/session links')
  expect(!dec4?.lines?.some((l) => l.includes('الجزء اللي الامتحان بيختبره')), 'W4: no coverage line without exams/session links (never fabricated)')
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
