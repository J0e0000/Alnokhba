// ═══════════════════════════════════════════════════════════════════════════
// ALNOKHBA EDU — FULL SIMULATION + SMART INSIGHTS VALIDATION HARNESS
//
// Zero-risk validation: runs the ACTUAL deployed engine code
// (src/lib/insights/engine.js + pipeline.js) against a deterministic
// 1,000-student × 12-week simulated dataset. NO production data touched.
//
// Scenarios (spec §14) — ground truth is embedded per group:
//   G1  stable                 (S9)  expect NO insight
//   G2  mid-dip + recovery     (S10) expect fire at k=8, resolved by final
//   G3  real academic decline  (S1)  expect exam-decline at final
//   G4  attendance decline     (S5)  expect group-absence + repeat-absence
//   G5  normal variation       (S2)  expect NO insight
//   G6  one-week absence spike (S6)  expect NO persistent insight (FP probe)
//   G7  homework decline       (S7)  expect homework-decline
//   G8  hard exam (group-wide)(S1b)  expect exam-difficulty, NOT exam-decline
//   S3/S4 (payments)            → domain not implemented (code-level check)
//   Engagement/warnings noise   → below materiality, expect NO insight
// Run: node scripts/sim-validate-insights.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { runInsightAnalysis } from '../src/lib/insights/engine.js'
import { computeDomainMetrics, buildCurrentState, diffInsights } from '../src/lib/insights/pipeline.js'

// ── deterministic PRNG ────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20260921)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ── calendar: weeks Friday→Thursday (the app's ONE week rule) ─────────────
// W1 = Fri 2026-07-03 … Thu 2026-07-09 ; W12 = Fri 2026-09-18 … Thu 2026-09-24
const W1_FRI = Date.UTC(2026, 6, 3)
const isoDate = (t) => new Date(t).toISOString().slice(0, 10)
const weekFri = (k) => W1_FRI + (k - 1) * 7 * 86400000
// each group: 2 sessions/week — Friday + Monday
const SESSION_DAYS = [0, 3] // offsets from week Friday
const weekDates = (k) => SESSION_DAYS.map((off) => isoDate(weekFri(k) + off * 86400000))
// weekly analysis runs: Thu 20:00Z of weeks 8..11 + FINAL = Mon 2026-09-21 20:00Z
const RUNS = [
  { k: 8, now: new Date('2026-08-06T20:00:00Z') },
  { k: 9, now: new Date('2026-08-13T20:00:00Z') },
  { k: 10, now: new Date('2026-08-20T20:00:00Z') },
  { k: 11, now: new Date('2026-08-27T20:00:00Z') },
  { k: 'FINAL', now: new Date('2026-09-21T20:00:00Z') },
  // post-data runs: teacher opens the app in the following weeks (no new data)
  { k: 'POST+1', now: new Date('2026-09-28T20:00:00Z') },
  { k: 'POST+2', now: new Date('2026-10-05T20:00:00Z') },
]
const EXAM_WEEKS = [3, 6, 9, 12]

// ── groups & scenario parameters ──────────────────────────────────────────
const GROUPS = [
  { key: 'G1', name: 'TEST-المجموعة أ (ثابتة)', n: 125, absByWeek: () => 0.09, hwByWeek: () => 0.85, examPct: () => 74 + rnd() * 4 },
  { key: 'G2', name: 'TEST-المجموعة ب (تعافي)', n: 125, // W4-7 dip, W8+ recovery
    absByWeek: (w) => (w >= 4 && w <= 7 ? 0.40 : w < 4 ? 0.10 : 0.08 + (12 - w) * 0),
    hwByWeek: (w) => (w >= 4 && w <= 7 ? 0.35 : w < 4 ? 0.80 : 0.85),
    examPct: (w) => (w === 3 ? 45 : w === 6 ? 55 : w === 9 ? 72 : 80) },
  { key: 'G3', name: 'TEST-المجموعة ج (انخفاض أكاديمي)', n: 125,
    absByWeek: () => 0.08, hwByWeek: () => 0.85,
    examPct: null, // special per-cohort logic below
    // two decline cohorts with DIFFERENT last-exams (exam 4 / exam 3) so the
    // shared-last-exam count stays under the 25% difficulty threshold while
    // the total decline (36%) clears it → exam-decline must fire
    cohorts: { dropAt2All: 0.18, dropAt2MissExam4: 0.18, stable: 0.64 } },
  { key: 'G4', name: 'TEST-المجموعة د (غياب متزايد)', n: 125,
    absByWeek: (w) => (w <= 6 ? 0.08 : [0, 0.12, 0.18, 0.24, 0.32, 0.42, 0.50][w - 6]),
    hwByWeek: () => 0.85, examPct: () => 74 + rnd() * 4,
    absenceCohortShare: 0.40 }, // decline concentrated on fixed 40%
  { key: 'G5', name: 'TEST-المجموعة هـ (تذبذب طبيعي)', n: 125,
    absByWeek: () => 0.08 + rnd() * 0.08, hwByWeek: () => 0.78 + rnd() * 0.14, examPct: () => 70 + rnd() * 12 },
  { key: 'G6', name: 'TEST-المجموعة و (سبايك أسبوع)', n: 125,
    absByWeek: (w) => (w === 10 ? 1.00 : 0.08), hwByWeek: (w) => (w === 10 ? 0.0 : 0.85), examPct: () => 74 + rnd() * 4 },
  { key: 'G7', name: 'TEST-المجموعة ز (واجب بيقل)', n: 125,
    absByWeek: () => 0.08, hwByWeek: (w) => (w <= 8 ? 0.82 : 0.38), examPct: () => 74 + rnd() * 4 },
  { key: 'G8', name: 'TEST-المجموعة ح (امتحان أصعب)', n: 125,
    absByWeek: () => 0.08, hwByWeek: () => 0.85,
    examPct: (w) => (w <= 6 ? 74 + rnd() * 4 : w === 9 ? 55 + rnd() * 4 : 52 + rnd() * 4) }, // exams 3+4 hard for ALL
]

// ── generate the world ────────────────────────────────────────────────────
const students = []
const sessions = []
const attendance = []
const exams = []
const examScoresByStudent = {}
const behaviorLogs = []

let sN = 0
for (const G of GROUPS) {
  const gStudents = []
  for (let i = 0; i < G.n; i++) {
    const id = `TEST-STUDENT-${String(++sN).padStart(4, '0')}`
    const warnings = rnd() < 0.08 ? 1 : 0 // noise only — never 2 (near limit 3)
    students.push({ id, name: id, group_name: G.name, warnings, points: 10 })
    gStudents.push(id)
  }
  // fixed absence cohort for G4 (the declining 40%) — order frozen across weeks
  const absenceCohort = G.absenceCohortShare
    ? gStudents.slice(0, Math.round(G.n * G.absenceCohortShare))
    : []
  const rota = [...gStudents] // rotating order for general absence variety

  // G3 cohorts
  let g3Cohort = null
  if (G.cohorts) {
    g3Cohort = new Map()
    const c1 = Math.round(G.n * G.cohorts.dropAt2All)
    const c2 = Math.round(G.n * G.cohorts.dropAt2MissExam4)
    gStudents.forEach((id, i) => g3Cohort.set(id, i < c1 ? 'all' : i < c1 + c2 ? 'miss4' : 'stable'))
  }

  // sessions + attendance
  for (let w = 1; w <= 12; w++) {
    const dates = weekDates(w)
    const absP = G.absByWeek(w)
    const hwP = G.hwByWeek(w)
    dates.forEach((date, di) => {
      const sid = `${G.key}-S${w}-${di}`
      sessions.push({ id: sid, teacher_id: 'TEST-TEACHER', group_name: G.name, stage: 'TEST', session_date: date, status: 'completed' })
      for (const sid2 of gStudents) {
        let absent
        if (G.absenceCohortShare && w > 6) {
          // decline phase: cohort misses ~75% of sessions, others ~ rota noise
          if (absenceCohort.includes(sid2)) absent = rnd() < 0.75
          else absent = rnd() < Math.max(0, absP - 0.3) // rest of group lightly affected
        } else {
          // rota rotation for even spread + individual jitter
          const inRotaSlot = (rota.indexOf(sid2) + w * 7 + di) % rota.length
          absent = inRotaSlot < Math.round(absP * rota.length) ? rnd() < 0.9 : rnd() < absP * 0.15
        }
        const hw = absent ? 'لم يتم' : rnd() < hwP ? 'مكتمل' : rnd() < 0.5 ? 'ناقص' : 'لم يتم'
        attendance.push({
          id: `TEST-ATT-${attendance.length + 1}`, teacher_id: 'TEST-TEACHER',
          lesson_session_id: sid, student_id: sid2, status: absent ? 'غائب' : 'حاضر',
          homework_status: hw, attendance_date: date, recorded_at: `${date}T16:00:00Z`,
        })
      }
    })
  }

  // exams at weeks 3/6/9/12 (Friday session) + scores per student
  EXAM_WEEKS.forEach((w, ei) => {
    const eid = `${G.key}-EX${w}`
    const fid = `${G.key}-S${w}-0`
    exams.push({ id: eid, teacher_id: 'TEST-TEACHER', title: `امتحان أسبوع ${w} — ${G.key}`, lesson_session_id: fid, created_at: `${weekDates(w)[0]}T18:00:00Z`, max_score_per_section: 10, sections: ['عام'] })
    for (const sid2 of gStudents) {
      let pct
      if (g3Cohort) {
        const c = g3Cohort.get(sid2)
        // drop at exam #2 (ordinal), sustained: recent(2) vs earlier avg — consistent ≥12% drop
        if (c === 'all') pct = ei === 0 ? 75 + rnd() * 3 : ei === 1 ? 58 : ei === 2 ? 56 : 55 + rnd() * 3
        else if (c === 'miss4') pct = ei === 0 ? 75 + rnd() * 3 : ei === 1 ? 58 : ei === 2 ? 56 : null // absent from exam #4
        else pct = 74 + rnd() * 4
      } else pct = G.examPct(w)
      if (pct == null) continue
      const score = clamp(Math.round(pct) / 10, 0, 10)
      ;(examScoresByStudent[sid2] ||= []).push({
        exam_id: eid, exam_title: `امتحان أسبوع ${w} — ${G.key}`, total_score: score,
        max_score_per_section: 10, section_scores: { عام: score }, created_at: `${weekDates(w)[0]}T18:00:00Z`,
      })
    }
  })
}

// engagement noise (below materiality by design)
for (let i = 0; i < 40; i++) {
  const st = students[Math.floor(rnd() * students.length)]
  behaviorLogs.push({ student_id: st.id, points_delta: -1, created_at: `${isoDate(weekFri(10 + Math.floor(rnd() * 3)))}T12:00:00Z` })
}
// 3 students with 2 negative notes (still ≪ needed 250 at 1000-student scale)
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 2; j++) {
    behaviorLogs.push({ student_id: students[i].id, points_delta: -2, created_at: `${isoDate(weekFri(11))}T12:00:00Z` })
  }
}

// ── §24 DATA INTEGRITY checks ─────────────────────────────────────────────
function integrity() {
  const studentIds = new Set(students.map((s) => s.id))
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  const examIds = new Set(exams.map((e) => e.id))
  const errs = []
  const seenPairs = new Set()
  for (const r of attendance) {
    if (!studentIds.has(r.student_id)) errs.push(`orphan attendance student ${r.student_id}`)
    const s = sessionById.get(r.lesson_session_id)
    if (!s) errs.push(`orphan attendance session ${r.lesson_session_id}`)
    else {
      if (r.attendance_date !== s.session_date) errs.push(`date mismatch ${r.id}`)
      const st = students.find((x) => x.id === r.student_id)
      if (st && st.group_name !== s.group_name) errs.push(`cross-group attendance ${r.id}`)
      const pair = r.student_id + '|' + r.lesson_session_id
      if (seenPairs.has(pair)) errs.push(`duplicate attendance ${pair}`)
      seenPairs.add(pair)
    }
  }
  for (const e of exams) {
    if (!sessionById.has(e.lesson_session_id)) errs.push(`exam ${e.id} orphan session link`)
  }
  for (const [sid, arr] of Object.entries(examScoresByStudent)) {
    if (!studentIds.has(sid)) errs.push(`orphan scores ${sid}`)
    for (const sc of arr) {
      if (!examIds.has(sc.exam_id)) errs.push(`orphan score exam ${sc.exam_id}`)
      if (sc.total_score > sc.max_score_per_section) errs.push(`impossible score ${sid}/${sc.exam_id}`)
    }
  }
  const dates = sessions.map((s) => s.session_date)
  if (Math.min(...dates) < isoDate(W1_FRI) || Math.max(...dates) > '2026-09-21') errs.push('session dates out of range')
  return { errs, counts: { students: students.length, sessions: sessions.length, attendance: attendance.length, exams: exams.length, scores: Object.values(examScoresByStudent).flat().length, behavior: behaviorLogs.length } }
}

// ── build engine inputs as of a run time (cumulative feeding) ─────────────
function inputsAt(now) {
  const nowT = now.getTime()
  const sess = sessions.filter((s) => new Date(s.session_date + 'T23:59:59Z').getTime() <= nowT)
  const sessIds = new Set(sess.map((s) => s.id))
  const att = attendance.filter((r) => sessIds.has(r.lesson_session_id))
  const scores = {}
  for (const [sid, arr] of Object.entries(examScoresByStudent)) {
    const f = arr.filter((sc) => new Date(sc.created_at).getTime() <= nowT)
    if (f.length) scores[sid] = f
  }
  const ex = exams.filter((e) => new Date(e.created_at).getTime() <= nowT)
  return { students, allAttendance: att, lessonSessions: sess, examScoresByStudent: scores, exams: ex, settings: { insight_config: { max_warnings: 3 } }, behaviorLogs, now }
}

// ── run the weekly lifecycle exactly like the app does ────────────────────
const integrityResult = integrity()
console.log('═══ DATA INTEGRITY (§24) ═══')
console.log('counts:', JSON.stringify(integrityResult.counts))
console.log(integrityResult.errs.length ? 'ERRORS:\n' + integrityResult.errs.slice(0, 20).join('\n') : 'PASS — no orphans, no duplicates, no cross-group rows, no impossible dates/scores')

const openRowsLatest = new Map() // dedupe_key → latest row (mirrors analytics_insights upsert)
const dismissed = new Set()
const runLog = []
let engineMs = 0
let domainsMs = 0

console.log('\n═══ WEEKLY RUNS (§16) ═══')
for (const run of RUNS) {
  const t0 = performance.now()
  const input = inputsAt(run.now)
  const computed = runInsightAnalysis(input)
  const t1 = performance.now()
  const domains = computeDomainMetrics(input)
  const t2 = performance.now()
  engineMs += t1 - t0; domainsMs += t2 - t1
  const { upserts, resolvedKeys } = diffInsights([...openRowsLatest.values()], computed.insights, dismissed)
  for (const u of upserts) openRowsLatest.set(u.id, { dedupe_key: u.id, evidence: { metrics: u.metrics }, status: u.status, first_detected_at: u.first_detected_at })
  for (const k of resolvedKeys) openRowsLatest.delete(k) // real app marks rows resolved → they leave the open set
  const cur = computed.insights.map((i) => {
    const up = upserts.find((u) => u.id === i.id)
    return `${i.id} [${i.severity}${up ? '/' + up.status : ''}]`
  })
  console.log(`run k=${run.k} (${run.now.toISOString().slice(0, 10)}): findings=${computed.meta.findingsTotal} insights=${computed.insights.length}${cur.length ? '\n    ' + cur.join('\n    ') : ' (none)'}${resolvedKeys.length ? '\n    RESOLVED: ' + resolvedKeys.join(', ') : ''}`)
  runLog.push({ k: run.k, at: run.now.toISOString(), findings: computed.meta.findingsTotal, insights: computed.insights.map((i) => ({ id: i.id, type: i.type, severity: i.severity, status: upserts.find((u) => u.id === i.id)?.status, metrics: i.metrics, title: i.title, reasons: i.reasons })), resolvedKeys })
}

// ── final-state snapshots for evaluation + on-demand (§19) ────────────────
// On-demand/current-state must reflect the FINAL run moment (2026-09-21),
// not the POST lifecycle probes — "latest available data" at the final run.
const finalInput = inputsAt(RUNS.find((r) => r.k === 'FINAL').now)
const finalComputed = runInsightAnalysis(finalInput)
const finalDomains = computeDomainMetrics(finalInput)
const finalState = buildCurrentState({ students, domains: finalDomains, insights: finalComputed.insights })

console.log('\n═══ ON-DEMAND «استنتج المستوى الحالي» (§19) ═══')
console.log('overall:', finalState.overall)
console.log('headline:', finalState.headline)
for (const b of finalState.bullets) console.log('  •', b)
console.log('domains: att.cur=', finalDomains.attendance.absRateCur == null ? null : Math.round(finalDomains.attendance.absRateCur * 100) + '%',
  'hw.cur=', finalDomains.homework.hwRateCur == null ? null : Math.round(finalDomains.homework.hwRateCur * 100) + '%',
  'exam.cur=', finalDomains.academic.examAvgCur, 'held=', finalDomains.operations.heldCur)

// ── §21 PERFORMANCE at 1,000-student scale ────────────────────────────────
console.log('\n═══ PERFORMANCE (§21) ═══')
const tA = performance.now(); runInsightAnalysis(finalInput); const engineFull = performance.now() - tA
const tB = performance.now(); computeDomainMetrics(finalInput); const domFull = performance.now() - tB
const tC = performance.now(); diffInsights([...openRowsLatest.values()], finalComputed.insights, dismissed); const diffMs = performance.now() - tC
const fresh56d = attendance.filter((r) => new Date(r.recorded_at).getTime() >= RUNS.find((r2) => r2.k === "FINAL").now.getTime() - 56 * 86400000).length
const payloadKB = Math.round(JSON.stringify(finalInput.allAttendance).length / 1024)
console.log(`engine runInsightAnalysis: ${engineFull.toFixed(1)} ms | computeDomainMetrics: ${domFull.toFixed(1)} ms | diffInsights: ${diffMs.toFixed(2)} ms`)
console.log(`weekly runs engine total: ${engineMs.toFixed(1)} ms over ${RUNS.length} runs`)
console.log(`attendance rows in 56d fresh-pull window: ${fresh56d} — fetchFreshAnalysisData limit=5000 → coverage ${(100 * 5000 / fresh56d).toFixed(0)}% (SILENT TRUNCATION at 1000-student scale)`)
console.log(`full attendance payload for engine: ~${payloadKB} KB JSON (${attendance.length} rows)`)

// ── §15 EXPECTED vs ACTUAL matrix ─────────────────────────────────────────
console.log('\n═══ VALIDATION MATRIX (§15-17) ═══')
const finalRun = runLog.find((r) => r.k === 'FINAL')
const postRuns = runLog.filter((r) => typeof r.k === 'string' && r.k.startsWith('POST'))
const idsAt = (r) => new Set(r.insights.map((i) => i.id))
const finIds = idsAt(finalRun)
const has = (set, pre) => [...set].some((x) => x.startsWith(pre))
const gname = (key) => GROUPS.find((g) => g.key === key).name
const inGroup = (r, key) => r.insights.filter((i) => i.id.includes(gname(key)))
const check = (label, expected, actual, cls) => console.log(`  ${cls.padEnd(26)} ${label} — expected: ${expected} | actual: ${actual}`)

// S1 real academic decline (G3)
const s1 = has(finIds, `exam-decline:${gname('G3')}`) && !has(finIds, `exam-difficulty:${gname('G3')}`)
check('S1 academic decline (G3)', 'exam-decline', s1 ? 'exam-decline ✓' : [...finIds].filter((x) => x.includes(gname('G3'))).join(',') || 'none', s1 ? 'TRUE POSITIVE' : 'FALSE NEGATIVE')
// S2 normal variation (G5)
const s2 = !runLog.some((r) => inGroup(r, 'G5').length)
check('S2 normal variation (G5)', 'no insight (all runs)', s2 ? 'none ✓' : 'insight fired', s2 ? 'TRUE NEGATIVE' : 'FALSE POSITIVE')
// S3/S4 financial
check('S3 late-payments healthy', 'no insight', 'financial domain not implemented (engine has no payment input — honesty note in code)', 'N/A-BY-DESIGN')
check('S4 material payment problem', 'insight expected', 'financial domain not implemented — cannot fire (coverage gap, not a FP/FN)', 'GAP-DOCUMENTED')
// S5 attendance decline (G4)
const s5 = has(finIds, `group-absence:${gname('G4')}`) && has(finIds, `repeat-absence:${gname('G4')}`)
check('S5 attendance decline (G4)', 'group-absence + repeat-absence', s5 ? 'both ✓' : [...finIds].filter((x) => x.includes(gname('G4'))).join(',') || 'none', s5 ? 'TRUE POSITIVE' : 'FALSE NEGATIVE')
// S6 spike (G6) — probe across ALL runs including POST
const g6AbsRuns = runLog.filter((r) => r.insights.some((i) => i.id.startsWith(`group-absence:${gname('G6')}`)))
const s6 = g6AbsRuns.length === 0
check('S6 one-week spike (G6)', 'no persistent insight', g6AbsRuns.length ? `absence insight in ${g6AbsRuns.length}/${runLog.length} runs (${g6AbsRuns.map((r) => r.k).join(',')})` : 'never fired ✓', s6 ? 'TRUE NEGATIVE' : 'FALSE POSITIVE')
// S7 homework decline (G7)
const g7First = runLog.find((r) => inGroup(r, 'G7').length)
const s7 = has(finIds, `homework-decline:${gname('G7')}`)
check('S7 homework decline (G7)', 'homework-decline', s7 ? `fired ✓ (first at k=${g7First?.k})` : 'none', s7 ? 'TRUE POSITIVE' : 'FALSE NEGATIVE')
// S8 homework improvement → folded into G2 recovery
// S9 stable (G1)
const g1Any = runLog.some((r) => inGroup(r, 'G1').length)
check('S9 stable (G1)', 'no insight', g1Any ? 'insight fired' : 'none ✓', g1Any ? 'FALSE POSITIVE' : 'TRUE NEGATIVE')
// S10 recovery (G2): fired during dip → resolved at a post-recovery run, never re-announced
const g2Runs = runLog.filter((r) => inGroup(r, 'G2').length)
const g2Resolved = runLog.some((r) => (r.resolvedKeys || []).some((k) => k.includes(gname('G2'))))
const g2LastOpen = g2Runs.length ? g2Runs[g2Runs.length - 1].k : null
const s10 = g2Runs.length > 0 && g2Resolved && !postRuns.some((r) => inGroup(r, 'G2').length) // resolved after recovery, never re-announced
check('S10 recovery (G2)', 'fire during dip → resolved after recovery', `fired in runs [${g2Runs.map((r) => r.k).join(',')}]${g2Resolved ? ' → RESOLVED ✓' : ''}${postRuns.some((r) => inGroup(r, 'G2').length) ? ' (re-announced after!)' : ''}`, s10 ? 'TRUE POSITIVE (correct lifecycle)' : 'PARTIAL')
// S1b exam difficulty (G8)
const s1b = has(finIds, `exam-difficulty:${gname('G8')}`) && !has(finIds, `exam-decline:${gname('G8')}`)
check('S1b hard exam (G8)', 'exam-difficulty (watch), NOT exam-decline', s1b ? 'exam-difficulty ✓' : [...finIds].filter((x) => x.includes(gname('G8'))).join(',') || 'none', s1b ? 'TRUE POSITIVE (parsimony ✓)' : 'MISCLASSIFIED')
// engagement + warnings noise
const engWarn = runLog.some((r) => r.insights.some((i) => i.type === 'engagement-drop' || i.type === 'warnings-cluster'))
check('noise: engagement/warnings', 'no insight (below materiality)', engWarn ? 'fired' : 'none ✓', engWarn ? 'FALSE POSITIVE' : 'TRUE NEGATIVE')

// G2 lifecycle detail (S10 evidence)
console.log('\nG2 (recovery) lifecycle detail:')
for (const r of runLog) {
  const gi = inGroup(r, 'G2')
  if (gi.length) console.log(`  k=${r.k}:`, gi.map((i) => `${i.id.split(':')[0]}/${i.status}${i.metrics?.absenceRate != null ? ' abs=' + Math.round(i.metrics.absenceRate * 100) + '%' : i.metrics?.hwRate != null ? ' hw=' + Math.round(i.metrics.hwRate * 100) + '%' : ''}`).join(' | '))
  else if (r.resolvedKeys?.some((k) => k.includes(gname('G2')))) console.log(`  k=${r.k}: — resolved: ${r.resolvedKeys.filter((k) => k.includes(gname('G2'))).join(', ')}`)
}

// ground truth vs metrics table (final window) — properly group-scoped
console.log('\n═══ GROUND TRUTH — final 28d window per group (§26-2) ═══')
const gSessionIds = new Map(GROUPS.map((G) => [G.key, new Set(sessions.filter((s) => s.group_name === G.name).map((s) => s.id))]))
for (const G of GROUPS) {
  const ids = gSessionIds.get(G.key)
  const gInput = {
    students: finalInput.students.filter((s) => s.group_name === G.name),
    allAttendance: finalInput.allAttendance.filter((r) => ids.has(r.lesson_session_id)),
    lessonSessions: finalInput.lessonSessions.filter((s) => s.group_name === G.name),
    examScoresByStudent: Object.fromEntries(Object.entries(finalInput.examScoresByStudent).filter(([sid]) => finalInput.students.find((s) => s.id === sid)?.group_name === G.name)),
    exams: finalInput.exams.filter((e) => e.id.includes(G.key)),
    settings: finalInput.settings, behaviorLogs: [], now: finalInput.now,
  }
  const d = computeDomainMetrics(gInput)
  const ins = finalComputed.insights.filter((i) => i.id.endsWith(G.name))
  console.log(`  ${G.key}: abs=${d.attendance.absRateCur == null ? '—' : Math.round(d.attendance.absRateCur * 100) + '%'} (prev ${d.attendance.absRatePrev == null ? '—' : Math.round(d.attendance.absRatePrev * 100) + '%'}) hw=${d.homework.hwRateCur == null ? '—' : Math.round(d.homework.hwRateCur * 100) + '%'} exam=${d.academic.examAvgCur ?? '—'} held=${d.operations.heldCur} insights=${ins.map((i) => i.id.split(':')[0]).join('+') || 'none'}`)
}

// exam coverage evidence (the new rule) at scale
const fullInsights = finalComputed.insights
const s1Ins = fullInsights.find((i) => i.id.startsWith(`exam-decline:${gname('G3')}`))
const s1bIns = fullInsights.find((i) => i.id.startsWith(`exam-difficulty:${gname('G8')}`))
console.log('\nexam-coverage evidence (rule: امتحان الحصة بيختبر الحصة أو الحصص اللي قبلها):')
if (s1Ins) console.log('  exam-decline G3:', JSON.stringify({ coveredSessions: s1Ins.metrics.coveredSessions, absentInCovered: s1Ins.metrics.absentInCovered }))
if (s1bIns) console.log('  exam-difficulty G8:', JSON.stringify({ coveredSessions: s1bIns.metrics.coveredSessions }))

console.log('\nsample insight text (G4 group-absence):')
const g4 = fullInsights.find((i) => i.id.startsWith(`group-absence:${gname('G4')}`))
if (g4) { console.log('  title:', g4.title); for (const l of g4.lines) console.log('  -', l); for (const r of g4.reasons) console.log('  · reason:', r) }
const g6 = fullInsights.find((i) => i.id.startsWith(`group-absence:${gname('G6')}`))
if (g6) { console.log('\nsample FALSE POSITIVE text (G6 spike):'); console.log('  title:', g6.title); for (const l of g6.lines) console.log('  -', l) }

// dump results for the report
const fs = await import('node:fs')
fs.writeFileSync('/home/z/my-project/.local-tmp/sim-results.json', JSON.stringify({
  integrity: integrityResult, runs: runLog,
  groundTruth: GROUPS.map((G) => {
    const ids = gSessionIds.get(G.key)
    const gInput = {
      students: finalInput.students.filter((s) => s.group_name === G.name),
      allAttendance: finalInput.allAttendance.filter((r) => ids.has(r.lesson_session_id)),
      lessonSessions: finalInput.lessonSessions.filter((s) => s.group_name === G.name),
      examScoresByStudent: Object.fromEntries(Object.entries(finalInput.examScoresByStudent).filter(([sid]) => finalInput.students.find((s) => s.id === sid)?.group_name === G.name)),
      exams: finalInput.exams.filter((e) => e.id.includes(G.key)),
      settings: finalInput.settings, behaviorLogs: [], now: finalInput.now,
    }
    const d = computeDomainMetrics(gInput)
    return { key: G.key, abs: d.attendance.absRateCur, absPrev: d.attendance.absRatePrev, hw: d.homework.hwRateCur, exam: d.academic.examAvgCur, held: d.operations.heldCur }
  }),
  onDemand: { overall: finalState.overall, headline: finalState.headline, bullets: finalState.bullets, domains: finalDomains },
  perf: { engineFull, domFull, diffMs, fresh56d, attendanceRows: attendance.length, payloadKB, engineMsTotal: engineMs },
  counts: integrityResult.counts,
}, null, 2))
console.log('\nsaved → .local-tmp/sim-results.json')
