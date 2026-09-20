// Sanity tests for the فريق التحليل pipeline (pure functions, no DOM/DB).
// Run: node scripts/test-analytics-pipeline.mjs
import { runInsightAnalysis } from '../src/lib/insights/engine.js'
import { computeDomainMetrics, buildCurrentState, diffInsights } from '../src/lib/insights/pipeline.js'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-09-21T12:00:00Z')
let failures = 0

function expect(cond, label) {
  if (cond) { console.log(`  PASS  ${label}`) } else { failures += 1; console.error(`  FAIL  ${label}`) }
}

const dateInCur = (i) => new Date(now.getTime() - (i + 1) * 3 * DAY).toISOString().slice(0, 10)
const dateInPrev = (i) => new Date(now.getTime() - (28 + (i + 1) * 3) * DAY).toISOString().slice(0, 10)

// ── world: 10 students, one group, 8 cur + 6 prev completed sessions ──
const students = []
for (let i = 0; i < 10; i++) students.push({ id: `s${i}`, name: `طالب${i + 1}`, group_name: 'العلمين', warnings: 0, points: 5 })

const sessions = []
const attendance = []
let rid = 0
const mark = (session, studentId, status, hw = null) => {
  attendance.push({
    id: `r${++rid}`, student_id: studentId, lesson_session_id: session.id,
    status, homework_status: hw, attendance_date: session.session_date, recorded_at: `${session.session_date}T10:00:00Z`,
  })
}

for (let i = 0; i < 8; i++) sessions.push({ id: `c${i}`, group_name: 'العلمين', session_date: dateInCur(i), status: 'completed' })
for (let i = 0; i < 6; i++) sessions.push({ id: `p${i}`, group_name: 'العلمين', session_date: dateInPrev(i), status: 'completed' })

// current window: last 4 sessions 50% absent; homework degrades to 40%
sessions.filter((s) => s.id.startsWith('c')).forEach((session, i) => {
  students.forEach((st, idx) => {
    const absent = i >= 4 && idx < 5
    mark(session, st.id, absent ? 'غائب' : 'حاضر', i >= 4 ? (idx % 2 === 0 ? 'لم يتم' : 'ناقص') : 'مكتمل')
  })
})
// previous window: healthy baseline
sessions.filter((s) => s.id.startsWith('p')).forEach((session) => {
  students.forEach((st) => mark(session, st.id, 'حاضر', 'مكتمل'))
})

const scores = {}
const mkScore = (studentId, total, max, created) => {
  scores[studentId] ||= []
  scores[studentId].push({
    exam_id: `e${created}`, exam_title: 'اختبار', max_score_per_section: max,
    section_scores: { s1: total }, total_score: total, created_at: created,
  })
}
// 3 exams in current window: 80% → 70% → 60% (visible decline, shared difficulty excluded by only 3 students sharing last exam)
students.slice(0, 6).forEach((st) => {
  mkScore(st.id, 40, 50, dateInCur(5))
  mkScore(st.id, 35, 50, dateInCur(3))
  mkScore(st.id, 30, 50, dateInCur(1))
})

const inputs = { students, allAttendance: attendance, lessonSessions: sessions, examScoresByStudent: scores, settings: { insight_config: { max_warnings: 3 } }, now }

// ═══ 1) domain metrics ═══
console.log('— computeDomainMetrics —')
const domains = computeDomainMetrics(inputs)
expect(domains.attendance.absRateCur != null && domains.attendance.absRateCur > 0.2, `attendance absRateCur computed (${domains.attendance.absRateCur})`)
expect(domains.attendance.absRatePrev === 0, `attendance absRatePrev healthy baseline (${domains.attendance.absRatePrev})`)
expect(Array.isArray(domains.attendance.weekly) && domains.attendance.weekly.length === 8, `weekly series = 8 Friday→Thursday buckets (${domains.attendance.weekly?.length})`)
expect(domains.homework.hwRateCur != null && domains.homework.hwRateCur < 0.6, `homework hwRateCur degraded (${domains.homework.hwRateCur})`)
expect(domains.homework.hwRatePrev === 1, `homework hwRatePrev = 100% (${domains.homework.hwRatePrev})`)
expect(domains.academic.examAvgCur === 70, `academic examAvgCur = 70% (${domains.academic.examAvgCur})`)
expect(domains.academic.examAvgPrev == null, 'academic examAvgPrev null (no prev-window exams — honest)')
expect(domains.operations.heldCur === 8 && domains.operations.heldPrev === 6, `operations heldCur/heldPrev = 8/6 (${domains.operations.heldCur}/${domains.operations.heldPrev})`)
expect(domains.financial && domains.financial.available === false, 'financial honestly marked unavailable')
expect(domains.engagement.provided === false && domains.engagement.negativeNotes === 0, 'engagement zero when no behavior logs provided (no fabrication)')

// engagement counts REAL negative logs only
const behaviorLogs = [
  { student_id: 's0', points_delta: -2, created_at: dateInCur(1) },
  { student_id: 's0', points_delta: -1, created_at: dateInCur(2) },
  { student_id: 's1', points_delta: -3, created_at: dateInCur(2) },
  { student_id: 's1', points_delta: -1, created_at: dateInCur(3) },
  { student_id: 's2', points_delta: -1, created_at: dateInCur(1) },
  { student_id: 's2', points_delta: -2, created_at: dateInCur(4) },
  { student_id: 's3', points_delta: 2, created_at: dateInCur(1) }, // positive → ignored
  { student_id: 's4', points_delta: -1, created_at: dateInPrev(0) }, // prev window → ignored
]
const domainsEng = computeDomainMetrics({ ...inputs, behaviorLogs })
expect(domainsEng.engagement.negativeNotes === 6 && domainsEng.engagement.flaggedStudents === 3, `engagement counts 6 negative notes on 3 students (${domainsEng.engagement.negativeNotes}/${domainsEng.engagement.flaggedStudents})`)

// ═══ 2) current state narrative ═══
console.log('— buildCurrentState —')
const computed = runInsightAnalysis(inputs)
const csAttention = buildCurrentState({ students, domains, insights: computed.insights, now })
expect(csAttention.overall === 'attention', `verdict=attention when needs-attention insights exist (${csAttention.overall})`)
expect(/غياب/.test(csAttention.bullets.join(' ')) || /رصد/.test(csAttention.bullets.join(' ')), 'attendance bullet grounded in real numbers')
expect(/متوسط الامتحانات/.test(csAttention.bullets.join(' ')), 'academic bullet present with exam average')
const csStable = buildCurrentState({ students, domains, insights: [], now })
expect(csStable.overall === 'stable' && /مستقر/.test(csStable.headline), `verdict=stable without insights (${csStable.overall})`)
const csEmpty = buildCurrentState({ students: [], domains, insights: [], now })
expect(/مفيش بيانات/.test(csEmpty.headline), 'honest headline when there are no students at all')

// ═══ 3) insight lifecycle (spec 11) ═══
console.log('— diffInsights lifecycle —')
const { upserts } = diffInsights([], computed.insights)
expect(upserts.every((u) => u.status === 'new'), `first run: every insight is new (${upserts.map((u) => u.status).join(',')})`)
expect(upserts.length > 0, `world produces material insights (${upserts.length})`)

// simulate stored open rows from a previous run with same metrics → ongoing
const openRows = upserts.map((u) => ({
  dedupe_key: u.id,
  evidence: { metrics: u.metrics },
  first_detected_at: '2026-08-01T00:00:00Z',
  dbId: `db-${u.id}`,
}))
const { upserts: again, resolvedKeys: resolved0 } = diffInsights(openRows, computed.insights)
expect(again.every((u) => u.status === 'ongoing'), `same metrics again → ongoing (${again.map((u) => u.status).join(',')})`)
expect(resolved0.length === 0, 'nothing resolved while patterns persist')

// worsening: stored metrics were BETTER than the freshly computed ones
const bumpWorse = (metrics = {}) => ({
  ...metrics,
  ...(metrics.absenceRate != null ? { absenceRate: Math.max(0, metrics.absenceRate - 0.2) } : {}),
  ...(metrics.students != null ? { students: metrics.students + 5 } : {}),
  ...(metrics.affected != null ? { affected: metrics.affected + 5 } : {}),
  ...(metrics.hwRate != null ? { hwRate: Math.min(1, metrics.hwRate + 0.2) } : {}),
})
const worsePrev = openRows.map((u) => ({ ...u, evidence: { metrics: bumpWorse(u.evidence?.metrics) } }))
const { upserts: worse } = diffInsights(worsePrev, computed.insights)
expect(worse.some((u) => u.status === 'worsening'), `worse metrics → worsening (${worse.map((u) => u.status).join(',')})`)
expect(worse.every((u) => u.first_detected_at === '2026-08-01T00:00:00Z'), 'first_detected_at carried across runs')

// improving: stored metrics were WORSE than the freshly computed ones
const bumpBetter = (metrics = {}) => ({
  ...metrics,
  ...(metrics.absenceRate != null ? { absenceRate: Math.min(1, metrics.absenceRate + 0.3) } : {}),
  ...(metrics.students != null ? { students: Math.max(0, metrics.students - 5) } : {}),
  ...(metrics.affected != null ? { affected: Math.max(0, metrics.affected - 5) } : {}),
  ...(metrics.hwRate != null ? { hwRate: Math.max(0, metrics.hwRate - 0.2) } : {}),
})
const betterPrev = openRows.map((u) => ({ ...u, evidence: { metrics: bumpBetter(u.evidence?.metrics) } }))
const { upserts: better } = diffInsights(betterPrev, computed.insights)
expect(better.some((u) => u.status === 'improving'), `better metrics → improving (${better.map((u) => u.status).join(',')})`)

// resolved: an open key that did not reappear
const staleOpen = [...openRows, { dedupe_key: 'group-absence:مجموعة قديمة', evidence: { metrics: { absenceRate: 0.4 } }, dbId: 'db-stale' }]
const { upserts: mixed, resolvedKeys } = diffInsights(staleOpen, computed.insights)
expect(resolvedKeys.includes('group-absence:مجموعة قديمة'), `disappeared open key → resolved (${resolvedKeys.join(',')})`)
expect(mixed.length === upserts.length, 'resolved key did not leak into upserts')

// dismissed (spec 11): teacher's dismissal stands — never re-announced
const dismissed = new Set(upserts.map((u) => u.id).slice(0, 2))
const { upserts: suppressed, resolvedKeys: resolvedD } = diffInsights(openRows.filter((r) => !dismissed.has(r.dedupe_key)), computed.insights, dismissed)
expect(suppressed.every((u) => !dismissed.has(u.id)), 'dismissed keys are not re-announced')
expect(!resolvedD.some((k) => dismissed.has(k)), 'dismissed keys never appear as resolved')

// ═══ 4) engagement finder (engine, additive) ═══
console.log('— engine engagement finder —')
const computedEng = runInsightAnalysis({ ...inputs, behaviorLogs })
const eng = computedEng.insights.find((i) => i.type === 'engagement-drop')
expect(eng && eng.severity === 'watch' && eng.students.length === 3, `engagement-drop fires for 3 students with >= 2 negative notes (${eng?.students?.length})`)
expect(!eng.reasons.some((r) => /سبب/.test(r) && /واضح/.test(r) === false), 'engagement reasons stay observable-only')
const computedNoEng = runInsightAnalysis({ ...inputs, behaviorLogs: [{ student_id: 's0', points_delta: -1, created_at: dateInCur(1) }] })
expect(!computedNoEng.insights.some((i) => i.type === 'engagement-drop'), 'no engagement insight when data is below materiality (no fabrication)')

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
