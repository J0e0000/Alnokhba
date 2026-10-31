// Sanity test for the pure report builders (no Supabase).
// Run: node scripts/test_report_builders.mjs
import {
  weekWindow, completedSessionsInWindow, studentWeekStats, groupWeekStats,
  sessionStats, followUpStudents, interpolateTemplate, examScorePct,
  studentWeeklyVars, examResultVars, teacherSessionVars, teacherWeeklyVars, followUpVars,
  DEFAULT_TEMPLATES,
} from '../src/lib/reportBuilders.js'

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 } else console.log('ok —', msg) }

// ── week window ──
const w = weekWindow(new Date('2026-09-23T12:00:00'), 0) // Wednesday
assert(w.startISO.endsWith(String(Number(w.startISO.slice(8))) ? w.startISO.slice(8) : ''), 'week window returns ISO dates')
assert(new Date(w.startISO).getDay() === 5, 'week starts Friday (getDay 5)')

// ── interpolate: empty optional collapses ──
const out = interpolateTemplate('A\n{examLine}\nB', { examLine: '' })
assert(out === 'A\nB', `empty optional line collapses (got: ${JSON.stringify(out)})`)

// ── examScorePct both shapes ──
assert(examScorePct({ total_score: 17, max_score_per_section: 10, section_scores: { a: 9, b: 8 } }) === 85, 'raw exam row → 85%')
assert(examScorePct({ total: 8, max: 10 }) === 80, 'portal row → 80%')
assert(examScorePct({ total_score: 5, max_score_per_section: 0, section_scores: {} }) === null, 'zero max → null (no fake %)')

// ── fixtures ──
const students = [
  { id: 's1', name: 'محمد أحمد', group_name: 'G1', phone: '01012345678', points: 40, warnings: 2 },
  { id: 's2', name: 'عمر علي', group_name: 'G1', phone: '01012345679', points: 20, warnings: 0 },
  { id: 's3', name: 'يوسف محمود', group_name: 'G2', phone: '', points: 10, warnings: 0 },
]
const lessonSessions = [
  { id: 'l1', group_name: 'G1', status: 'completed', session_date: '2026-09-21', lesson_topic: 'المعادلات التربيعية' },
  { id: 'l2', group_name: 'G1', status: 'completed', session_date: '2026-09-23', lesson_topic: 'مراجعة المسائل التطبيقية' },
  { id: 'l3', group_name: 'G1', status: 'open', session_date: '2026-09-23', lesson_topic: '' },
  { id: 'l4', group_name: 'G2', status: 'completed', session_date: '2026-09-22', lesson_topic: '' },
  { id: 'l5', group_name: 'G1', status: 'completed', session_date: '2026-09-19', lesson_topic: '' },
]
const allAttendance = [
  { student_id: 's1', lesson_session_id: 'l1', status: 'حاضر', homework_status: 'مكتمل', recorded_at: '2026-09-21T10:00:00' },
  { student_id: 's2', lesson_session_id: 'l1', status: 'غائب', homework_status: '', recorded_at: '2026-09-21T10:00:00' },
  // duplicate (re-marked) row — must NOT double count
  { student_id: 's2', lesson_session_id: 'l1', status: 'غائب', homework_status: 'لم يتم', recorded_at: '2026-09-21T09:00:00' },
  { student_id: 's1', lesson_session_id: 'l2', status: 'حاضر', homework_status: 'ناقص', recorded_at: '2026-09-23T10:00:00' },
  { student_id: 's2', lesson_session_id: 'l2', status: 'حاضر', homework_status: 'لم يتم', recorded_at: '2026-09-23T10:00:00' },
  { student_id: 's1', lesson_session_id: 'l5', status: 'حاضر', homework_status: 'مكتمل', recorded_at: '2026-09-19T10:00:00' },
  { student_id: 's2', lesson_session_id: 'l5', status: 'غائب', homework_status: 'لم يتم', recorded_at: '2026-09-19T10:00:00' },
  { student_id: 's3', lesson_session_id: 'l4', status: 'غائب', homework_status: '', recorded_at: '2026-09-22T10:00:00' },
]
const examScoresByStudent = {
  s1: [{ exam_id: 'e1', exam_title: 'الاختبار الثالث', total_score: 17, max_score_per_section: 10, section_scores: { a: 9, b: 8 }, created_at: '2026-09-23T11:00:00' }],
  s2: [{ exam_id: 'e1', exam_title: 'الاختبار الثالث', total_score: 6, max_score_per_section: 10, section_scores: { a: 3, b: 3 }, created_at: '2026-09-23T11:00:00' }],
}
const examsList = [{ id: 'e1', title: 'الاختبار الثالث', lesson_session_id: 'l2', max_score_per_section: 10 }]

const week2 = weekWindow(new Date('2026-09-23T12:00:00'), 0)

// ── studentWeekStats (week window = Fri 18 → Thu 24, holds l1+l2+l5) ──
const s1stats = studentWeekStats({ studentId: 's1', groupName: 'G1', allAttendance, lessonSessions, examScores: examScoresByStudent.s1, startISO: week2.startISO, endISO: week2.endISO })
assert(s1stats.held === 3, `s1 held=3 (got ${s1stats.held})`)
assert(s1stats.present === 3, `s1 present=3 (got ${s1stats.present})`)
assert(s1stats.hwDone === 2 && s1stats.hwApplicable === 3, `s1 hw 2/3 (got ${s1stats.hwDone}/${s1stats.hwApplicable})`)
assert(s1stats.examAvg === 85, `s1 examAvg=85 (got ${s1stats.examAvg})`)

// ── groupWeekStats ──
const g1 = groupWeekStats({ groupName: 'G1', students, allAttendance, lessonSessions, examScoresByStudent, startISO: week2.startISO, endISO: week2.endISO, warningsThreshold: 3 })
assert(g1.held === 3, `G1 held=3 (got ${g1.held})`)
assert(g1.attendancePct === 67, `G1 attendance 67% (got ${g1.attendancePct})`)
assert(g1.hwPct === 40, `G1 hw 40% (got ${g1.hwPct})`)
assert(g1.examAvg === 58, `G1 examAvg 58% (got ${g1.examAvg})`)

// ── followUpStudents: s2 absent ≥50% + homework; s1 warnings>=2 ──
const fixedNow = new Date('2026-09-24T12:00:00')
const fus = followUpStudents({ groupName: 'G1', students, allAttendance, lessonSessions, examScoresByStudent, warningsThreshold: 3, now: fixedNow })
const f2 = fus.find((f) => f.student.id === 's2')
const f1 = fus.find((f) => f.student.id === 's1')
assert(f2 && f2.reasons.some((r) => r.includes('غياب متكرر')), 's2 flagged for repeated absence')
assert(f2 && f2.reasons.some((r) => r.includes('الواجب')), 's2 flagged for homework')
assert(f1 && f1.reasons.some((r) => r.includes('إنذارات')), 's1 flagged for warnings (2 of 3)')
assert(!fus.some((f) => f.student.id === 's3'), 's3 (other group) not flagged')

// ── sessionStats for l2 ──
const ls = sessionStats({ lesson: lessonSessions[1], attendanceRows: allAttendance, groupStudents: students.filter((s) => s.group_name === 'G1'), examScoresByStudent, examsList })
assert(ls.present === 2 && ls.absent === 0, `l2 present=2 absent=0 (got ${ls.present}/${ls.absent})`)
assert(ls.hwDone === 0 && ls.hwMissing === 2, `l2 hw 0 done / 2 missing`)
assert(ls.examLine.includes('الاختبار الثالث') && ls.examLine.includes('58%'), `l2 examLine real avg (got: ${ls.examLine})`)
assert(ls.followups.some((f) => f.student.id === 's2') && ls.followups.some((f) => f.student.id === 's1'), 'both flagged by session scope (exam<50 for s2)')

// ── builders → real messages ──
const weeklyMsg = interpolateTemplate(DEFAULT_TEMPLATES.msg_student_weekly, studentWeeklyVars({ student: students[0], stats: s1stats, weekLabel: w.label, allStudents: students, ranks: [{ min: 0, title: 'مبتدئ' }, { min: 30, title: 'نجم' }] }))
assert(weeklyMsg.includes('محمد أحمد') && weeklyMsg.includes('3 من 3') && weeklyMsg.includes('85%'), 'weekly message carries real numbers')
assert(!weeklyMsg.includes('{'), 'no leftover placeholders')
assert(weeklyMsg.includes('الواجبات: 2 مكتملة من 3'), 'weekly hw line present')

const s2stats = studentWeekStats({ studentId: 's2', groupName: 'G1', allAttendance, lessonSessions, examScores: examScoresByStudent.s2, startISO: week2.startISO, endISO: week2.endISO })
const weeklyNoExam = interpolateTemplate(DEFAULT_TEMPLATES.msg_student_weekly, studentWeeklyVars({ student: students[1], stats: { ...s2stats, examAvg: null, examsCount: 0 }, weekLabel: w.label, allStudents: students, ranks: [] }))
assert(!weeklyNoExam.includes('متوسط الاختبارات'), 'exam line collapses when no exams')

const examMsg = interpolateTemplate(DEFAULT_TEMPLATES.msg_student_exam, examResultVars({ student: students[1], scoreRow: examScoresByStudent.s2[0], groupName: 'G1' }))
assert(examMsg.includes('6 من 20') && examMsg.includes('30%'), `exam message shows 6/20 30% (got: ${examMsg.split('\n')[2]})`)
assert(!examMsg.includes('{noteLine}'), 'empty noteLine collapses in exam message')

const tsMsg = interpolateTemplate(DEFAULT_TEMPLATES.msg_teacher_session, teacherSessionVars({ lesson: lessonSessions[1], stats: ls, groupName: 'G1' }))
assert(tsMsg.includes('حاضر / 0 غياب') && tsMsg.includes('0 مكتمل / 2 غير مكتمل') && tsMsg.includes('متوسط المجموعة 58%'), 'teacher session report real numbers')
assert(tsMsg.includes('ملاحظات الجلسة: مراجعة المسائل التطبيقية'), 'lesson note line present')

const tw = groupWeekStats({ groupName: 'G1', students, allAttendance, lessonSessions, examScoresByStudent, startISO: week2.startISO, endISO: week2.endISO, warningsThreshold: 3 })
const twMsg = interpolateTemplate(DEFAULT_TEMPLATES.msg_teacher_weekly, teacherWeeklyVars({ stats: tw, groupName: 'G1', weekLabel: w.label }))
assert(twMsg.includes('الجلسات: 3') && twMsg.includes('67%') && twMsg.includes('يحتاجون متابعة:'), 'teacher weekly numbers')

const fuMsg = interpolateTemplate(DEFAULT_TEMPLATES.msg_teacher_followup, followUpVars({ stats: { followups: fus }, groupName: 'G1' }))
assert(fuMsg.includes('• عمر علي') && fuMsg.includes('غياب متكرر'), 'followup list with names + reasons')

console.log('\nDone.', process.exitCode ? 'SOME TESTS FAILED' : 'ALL PASS')
