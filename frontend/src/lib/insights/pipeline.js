// ═══════════════════════════════════════════════════════════════════════════
// فريق التحليل — PIPELINE (domains, current state, insight lifecycle)
//
// Sits ON TOP of the tested engine (engine.js stays the finder/materiality
// core) and provides the three products the restructured area needs:
//
//   1. computeDomainMetrics()  — one metric definition per domain, computed
//      from the SAME authoritative sources the rest of the app uses
//      (attendance_records / lesson_sessions / exam_scores / behavior_logs).
//      No competing definitions: rates here are the same rates the engine
//      and the reports use.
//   2. buildCurrentState()     — «إحنا واقفين فين دلوقتي؟» a grounded
//      narrative (verdict + evidence bullets), never generic AI prose.
//   3. diffInsights()          — the insight lifecycle (spec 11): compares
//      freshly computed insights against the open ones stored from previous
//      runs → new / ongoing / worsening / improving, and returns the keys
//      that disappeared → resolved. Same insight is NOT re-announced every
//      week without a meaningful change.
//
// All functions are pure (testable without Supabase), Egyptian Arabic output,
// and they NEVER invent a cause the data does not show (spec 19).
// ═══════════════════════════════════════════════════════════════════════════

import { INSIGHT_CONFIG } from './engine.js'
import { weekStart, localISODate } from '../week.js'

export const CATEGORY_OF = {
  'group-absence': 'attendance',
  'repeat-absence': 'attendance',
  'homework-decline': 'homework',
  'exam-decline': 'academic',
  'exam-difficulty': 'academic',
  'warnings-cluster': 'behavior',
  'engagement-drop': 'engagement',
}

// Lifecycle direction rules (spec 11): which metric defines "worse" per type.
const TREND_RULES = {
  'group-absence': { metric: 'absenceRate', higherIsWorse: true, epsilon: 0.02 },
  'repeat-absence': { metric: 'students', higherIsWorse: true, epsilon: 0.5 },
  'homework-decline': { metric: 'hwRate', higherIsWorse: false, epsilon: 0.02 },
  'exam-decline': { metric: 'students', higherIsWorse: true, epsilon: 0.5 },
  'exam-difficulty': { metric: 'affected', higherIsWorse: true, epsilon: 0.5 },
  'warnings-cluster': { metric: 'students', higherIsWorse: true, epsilon: 0.5 },
  'engagement-drop': { metric: 'students', higherIsWorse: true, epsilon: 0.5 },
}

const pct = (x) => Math.round((Number(x) || 0) * 100)
const rateOf = (records) => {
  const recorded = records.filter((r) => r.status === 'حاضر' || r.status === 'غائب')
  return recorded.length
    ? recorded.filter((r) => r.status === 'غائب').length / recorded.length
    : null
}
const HW_DONE = new Set(['مكتمل', 'تم'])
const HW_APPLICABLE = new Set(['مكتمل', 'تم', 'ناقص', 'لم يتم'])

const examPctOf = (sc) => {
  const sections = Object.keys(sc.section_scores || {}).length
  const max = Number(sc.max_score_per_section) * sections
  return sections > 0 && max > 0 && Number.isFinite(Number(sc.total_score))
    ? Number(sc.total_score) / max
    : null
}

/**
 * Domain metrics over the engine's analysis window (28d current vs the
 * 28d before), from the same rows the engine consumed — no re-fetching,
 * no second source of truth.
 */
export function computeDomainMetrics(input = {}) {
  const cfg = INSIGHT_CONFIG
  const now = input.now ? new Date(input.now) : new Date()
  const students = Array.isArray(input.students) ? input.students : []
  const attendance = Array.isArray(input.allAttendance) ? input.allAttendance : []
  const sessions = Array.isArray(input.lessonSessions) ? input.lessonSessions : []
  const scoresByStudent = input.examScoresByStudent || {}
  const behaviorLogs = Array.isArray(input.behaviorLogs) ? input.behaviorLogs : []

  const curStart = now.getTime() - cfg.windowDays * 24 * 60 * 60 * 1000
  const prevStart = curStart - cfg.windowDays * 24 * 60 * 60 * 1000
  const dayOf = (r) => r.attendance_date || (r.recorded_at ? String(r.recorded_at).slice(0, 10) : '')
  const ts = (d) => new Date(d).getTime()

  const cur = attendance.filter((r) => { const d = dayOf(r); return d && ts(d) >= curStart && ts(d) <= ts(now) + 86400000 })
  const prev = attendance.filter((r) => { const d = dayOf(r); return d && ts(d) >= prevStart && ts(d) < curStart })

  // ── Attendance: rate + Friday→Thursday weekly series (central week rule) ──
  const weekly = []
  for (let i = 7; i >= 0; i--) {
    const ref = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
    const s = weekStart(ref)
    const e = new Date(s.getTime() + 6 * 24 * 60 * 60 * 1000)
    const sStr = localISODate(s)
    const eStr = localISODate(e)
    const weekRecords = attendance.filter((r) => {
      const d = dayOf(r)
      return d && d >= sStr && d <= eStr
    })
    const rate = rateOf(weekRecords, 'غائب')
    weekly.push({ weekStart: sStr, weekEnd: eStr, rate: rate == null ? null : Math.round(rate * 100), records: weekRecords.length })
  }

  const absRateCur = rateOf(cur)
  const absRatePrev = rateOf(prev)

  // ── Homework ──
  const hwCur = cur.filter((r) => HW_APPLICABLE.has(r.homework_status || ''))
  const hwPrev = prev.filter((r) => HW_APPLICABLE.has(r.homework_status || ''))
  const hwRateCur = hwCur.length >= 5 ? hwCur.filter((r) => HW_DONE.has(r.homework_status)).length / hwCur.length : null
  const hwRatePrev = hwPrev.length >= 5 ? hwPrev.filter((r) => HW_DONE.has(r.homework_status)).length / hwPrev.length : null

  // ── Academic: exam average + per-exam chronological series ──
  const byExam = new Map()
  let aCur = { earned: 0, max: 0 }
  let aPrev = { earned: 0, max: 0 }
  for (const s of students) {
    for (const sc of (scoresByStudent[s.id] || [])) {
      const p = examPctOf(sc)
      if (p == null) continue
      const d = sc.created_at ? String(sc.created_at).slice(0, 10) : ''
      const t = sc.created_at ? ts(sc.created_at) : NaN
      if (Number.isFinite(t)) {
        if (t >= curStart && t <= ts(now) + 86400000) { aCur.earned += Number(sc.total_score); aCur.max += Number(sc.max_score_per_section) * Object.keys(sc.section_scores || {}).length }
        else if (t >= prevStart && t < curStart) { aPrev.earned += Number(sc.total_score); aPrev.max += Number(sc.max_score_per_section) * Object.keys(sc.section_scores || {}).length }
      }
      if (!byExam.has(d)) byExam.set(d, { earned: 0, max: 0 })
      const agg = byExam.get(d)
      agg.earned += Number(sc.total_score)
      agg.max += Number(sc.max_score_per_section) * Object.keys(sc.section_scores || {}).length
    }
  }
  const examSeries = [...byExam.keys()].sort().map((d) => ({
    date: d,
    avg: byExam.get(d).max ? Math.round((byExam.get(d).earned / byExam.get(d).max) * 100) : null,
  }))
  const examAvgCur = aCur.max ? Math.round((aCur.earned / aCur.max) * 100) : null
  const examAvgPrev = aPrev.max ? Math.round((aPrev.earned / aPrev.max) * 100) : null

  // ── Operations: held (completed) sessions per group, current vs previous ──
  const completed = sessions.filter((s) => s.status === 'completed' && s.session_date && s.group_name)
  const heldCurByGroup = new Map()
  let heldCur = 0
  let heldPrev = 0
  for (const s of completed) {
    const t = ts(s.session_date)
    if (t >= curStart && t <= ts(now) + 86400000) {
      heldCur += 1
      heldCurByGroup.set(s.group_name, (heldCurByGroup.get(s.group_name) || 0) + 1)
    } else if (t >= prevStart && t < curStart) heldPrev += 1
  }
  const perGroup = [...heldCurByGroup.keys()].map((g) => ({ group: g, held: heldCurByGroup.get(g) }))

  // ── Engagement: observable negative behavior notes in the window ──
  let negativeNotes = 0
  const flaggedStudents = new Set()
  for (const b of behaviorLogs) {
    if (!b?.student_id || Number(b.points_delta) >= 0) continue
    const t = b.created_at ? ts(b.created_at) : NaN
    if (!Number.isFinite(t) || t < curStart || t > ts(now) + 86400000) continue
    negativeNotes += 1
    flaggedStudents.add(b.student_id)
  }

  return {
    periodStart: localISODate(new Date(curStart)),
    periodEnd: localISODate(now),
    attendance: {
      absRateCur, absRatePrev, weekly,
      recordedCur: cur.filter((r) => r.status === 'حاضر' || r.status === 'غائب').length,
    },
    homework: { hwRateCur, hwRatePrev, records: hwCur.length },
    academic: { examAvgCur, examAvgPrev, examSeries, studentsWithExams: Object.keys(scoresByStudent).length },
    operations: { heldCur, heldPrev, perGroup, groups: perGroup.length },
    engagement: { negativeNotes, flaggedStudents: flaggedStudents.size, provided: behaviorLogs.length > 0 },
    financial: { available: false },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Current state — «إحنا واقفين فين دلوقتي؟» (spec 15)
// ═══════════════════════════════════════════════════════════════════════════
export function buildCurrentState({ students = [], domains, insights = [], now = new Date() }) {
  const hasMaterial = insights.some((i) => i.severity === 'needs-attention')
  const hasWatch = insights.some((i) => i.severity !== 'needs-attention')
  const overall = hasMaterial ? 'attention' : hasWatch ? 'watch' : 'stable'

  const headline = students.length === 0
    ? 'مفيش بيانات طلاب كفاية لأي استنتاج دلوقتي — لما تضيف طلاب وترصد حصص، الفريق هيبدأ يشتغل.'
    : overall === 'stable'
      ? 'الوضع العام مستقر — مفيش تغير مادي يستاهل تدخل دلوقتي.'
      : overall === 'watch'
        ? 'الوضع العام مستقر بشكل عام، لكن فيه نقاط محتاجة متابعة.'
        : 'فيه ملاحظات مادية محتاجة تدخل الأسبوع ده — التفاصيل تحت.'

  const bullets = []
  const a = domains?.academic
  if (a) {
    bullets.push(
      a.examAvgCur != null
        ? (a.examAvgPrev != null
          ? `متوسط الامتحانات في آخر ٤ أسابيع ${a.examAvgCur}% مقابل ${a.examAvgPrev}% قبله.`
          : `متوسط الامتحانات في آخر ٤ أسابيع ${a.examAvgCur}%.`)
        : 'مفيش امتحانات كفاية في الفترة لأي حكم على المستوى الأكاديمي.',
    )
  }
  const at = domains?.attendance
  if (at) {
    bullets.push(
      at.absRateCur != null
        ? (at.absRatePrev != null
          ? `نسبة الغياب ${pct(at.absRateCur)}% في آخر ٤ أسابيع مقابل ${pct(at.absRatePrev)}% الشهر اللي فاته.`
          : `نسبة الغياب ${pct(at.absRateCur)}% في آخر ٤ أسابيع.`)
        : 'مفيش رصد حضور كفاية في الفترة دي.',
    )
  }
  const hw = domains?.homework
  if (hw) {
    bullets.push(
      hw.hwRateCur != null
        ? (hw.hwRatePrev != null
          ? `تسليم الواجب ${pct(hw.hwRateCur)}% مقابل ${pct(hw.hwRatePrev)}% الشهر اللي فاته.`
          : `تسليم الواجب ${pct(hw.hwRateCur)}% في آخر ٤ أسابيع.`)
        : 'مفيش علامات واجب كفاية في الفترة.',
    )
  }
  const ops = domains?.operations
  if (ops) bullets.push(ops.heldCur ? `اتعقدت ${ops.heldCur} حصة مسجلة في آخر ٤ أسابيع على ${ops.groups} مجموعات.` : 'مفيش حصص مكتملة مسجلة في آخر ٤ أسابيع.')
  const en = domains?.engagement
  if (en?.provided) bullets.push(en.negativeNotes ? `ملاحظات سلوكية سلبية مسجلة: ${en.negativeNotes} على ${en.flaggedStudents} طالب في الفترة.` : 'مفيش ملاحظات سلوكية سلبية مسجلة في الفترة.')

  return {
    overall,
    headline,
    bullets,
    generatedAt: new Date(now).toISOString(),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Insight lifecycle (spec 11) — compare computed insights with the open rows
// stored from previous runs.
//   previousOpenRows: analytics_insights rows with status NOT IN (resolved,
//                     dismissed) — shaped { dedupe_key, evidence, status }
//   computedInsights: engine output (with type + metrics)
//   dismissedKeys:    keys the teacher dismissed before (spec 11 DISMISSED) —
//                     they are NOT re-announced and NOT re-inserted; the
//                     teacher's decision stands until the pattern changes to
//                     a DIFFERENT insight key.
// Returns { upserts, resolvedKeys }:
//   upserts: computed insights + { status, first_detected_at? } ready to
//            persist (status ∈ new|ongoing|worsening|improving)
//   resolvedKeys: open keys that did NOT reappear this run
// ═══════════════════════════════════════════════════════════════════════════
export function diffInsights(previousOpenRows = [], computedInsights = [], dismissedKeys = []) {
  const dismissed = dismissedKeys instanceof Set ? dismissedKeys : new Set(dismissedKeys || [])
  const openByKey = new Map()
  for (const row of previousOpenRows) {
    if (row?.dedupe_key && !openByKey.has(row.dedupe_key)) openByKey.set(row.dedupe_key, row)
  }

  const upserts = computedInsights
    .filter((ins) => ins?.id && !dismissed.has(ins.id))
    .map((ins) => {
      const key = ins.id
      const prevRow = openByKey.get(key)
      openByKey.delete(key)
      if (!prevRow) return { ...ins, status: 'new' }

      const rule = TREND_RULES[ins.type]
      let status = 'ongoing'
      if (rule) {
        const curVal = Number(ins.metrics?.[rule.metric])
        const prevVal = Number(prevRow.evidence?.metrics?.[rule.metric])
        if (Number.isFinite(curVal) && Number.isFinite(prevVal)) {
          const delta = curVal - prevVal
          if (rule.higherIsWorse ? delta > rule.epsilon : delta < -rule.epsilon) status = 'worsening'
          else if (rule.higherIsWorse ? delta < -rule.epsilon : delta > rule.epsilon) status = 'improving'
        }
      }
      return {
        ...ins,
        status,
        first_detected_at: prevRow.first_detected_at || undefined,
      }
    })

  const resolvedKeys = [...openByKey.keys()]
  return { upserts, resolvedKeys }
}
