// ═══════════════════════════════════════════════════════════════════════════
// SMART INSIGHTS ENGINE (فريق التحليل)
//
// Core philosophy (product spec): a detected pattern is only a FINDING.
// It becomes an INSIGHT only after passing validation, trend/persistence,
// impact, and a materiality check — i.e. it has meaningful operational,
// academic, or business impact. "Not every problem is an Insight."
//
// Pipeline implemented here, per candidate pattern:
//   DATA → FINDING → VALIDATION → TREND/PERSISTENCE → IMPACT ASSESSMENT
//        → MATERIALITY CHECK → INSIGHT → RECOMMENDED ACTION
//
// EXAM COVERAGE RULE (teacher directive): an exam held at session S tests
// S's lesson PLUS every lesson of the same group held before it. When the
// exam rows carry lesson_session_id, exam findings scope their cause-check
// (absence) to that covered window instead of the generic analysis window —
// and the insight says so in plain Arabic. When the link is missing the
// coverage is silently skipped (never fabricated).
//
// Design constraints:
// - Pure functions over data ALREADY loaded in WorkspaceStore. No extra
//   network calls, no background timers — the analysis runs ONLY inside the
//   فريق التحليل area, on demand, inside its weekly window (spec 5), so the
//   daily workflow never pays for it.
// - Thresholds are explicit, explainable, and grouped in INSIGHT_CONFIG so
//   they are configurable without hunting through logic (spec 2).
// - Every insight carries `reasons[]`: the internal, human-readable materiality
//   justification (spec 2) — stored with the report but not surfaced as
//   technical scoring jargon in the UI.
// - Language: Egyptian Arabic, professional tone, short and action-oriented
//   (spec 4). Insight content is Arabic regardless of UI chrome language.
//
// IMPORTANT HONESTY NOTE: the app currently holds NO financial data (no fees,
// payments, or balances in the schema), so payment-delay insights are NOT
// fabricated here. The engine covers the domains the real data supports:
// attendance, repeated absence, homework completion, exam performance, and
// warning accumulation.
// ═══════════════════════════════════════════════════════════════════════════

export const INSIGHT_CONFIG = {
  // Analysis window: compare the last 4 weeks against the 4 weeks before.
  windowDays: 28,

  // A group needs enough completed sessions in the window before any
  // group-level statement is honest at all.
  minSessionsPerGroup: 4,

  // Population materiality: a pattern must affect at least this many
  // students, or at least this share of the group (whichever is larger).
  minPopulation: 3,
  populationShare: 0.25,

  // ── Absence ──
  absenceBaseline: 0.15,   // expected normal absence for a healthy group
  absenceFloor: 0.30,      // clearly problematic level
  absenceDelta: 0.10,      // a rise of >= 10 points vs the previous window matters
  absenceImpactHigh: 0.35, // at this level the impact is high even without a trend

  // ── Repeated absence (per student) ──
  repeatAbsenceShare: 0.5, // absent for >= half of the group's held sessions
  repeatAbsenceMin: 3,     // and at least 3 absences in the window

  // ── Homework ──
  hwFloor: 0.6,            // below 60% completion the group loses pacing
  hwDelta: 0.15,           // a drop of >= 15 points vs the previous window
  hwMinRecords: 10,        // need a meaningful number of hw marks to compare

  // ── Exams ──
  examMinExams: 3,         // a trend needs >= 3 exams, not one bad day
  examRecent: 2,           // compare the last 2 exams vs everything before
  examDeclineShare: 0.12,  // >= 12% relative drop that is consistent

  // ── Warnings ──
  warningsNear: 1,         // students within 1 warning of the configured limit

  // ── Engagement (behavior logs, observable records only) ──
  engagementMinNotes: 2,   // >= 2 negative behavior notes in the window per student
}

const DAY_MS = 24 * 60 * 60 * 1000
const HW_DONE = new Set(['مكتمل', 'تم'])
const HW_APPLICABLE = new Set(['مكتمل', 'تم', 'ناقص', 'لم يتم'])

const pct = (x) => Math.round((Number(x) || 0) * 100)
const iso = (d) => new Date(d).toISOString()
const arNum = (n) => String(n)

function recordDate(r) {
  return r.attendance_date || (r.recorded_at ? String(r.recorded_at).slice(0, 10) : '')
}

/**
 * Run the full analysis. All inputs come from WorkspaceStore state.
 * @param {object} input
 *   students          student rows
 *   allAttendance     recent attendance_records (student_id, status, homework_status,
 *                     lesson_session_id, attendance_date, recorded_at)
 *   lessonSessions    lesson_sessions rows (id, group_name, session_date, status)
 *   examScoresByStudent map student_id → [{ total_score, max_score_per_section,
 *                     section_scores, created_at, exam_id, exam_title }]
 *   exams             OPTIONAL exams rows (id, lesson_session_id, created_at).
 *                     Enables the exam-coverage rule: an exam tests its own
 *                     lesson + the lessons before it. Missing → skipped.
 *   settings          teacher_settings row (insight_config.max_warnings)
 *   behaviorLogs      OPTIONAL behavior_logs rows (student_id, points_delta,
 *                     created_at) covering the current window. When absent
 *                     the engagement finder silently skips (no fabricated
 *                     engagement data).
 *   now               Date (defaults to now)
 * @returns {{ insights: Array, meta: object }}
 */
export function runInsightAnalysis(input = {}) {
  const cfg = INSIGHT_CONFIG
  const now = input.now ? new Date(input.now) : new Date()
  const students = Array.isArray(input.students) ? input.students : []
  const attendance = Array.isArray(input.allAttendance) ? input.allAttendance : []
  const sessions = Array.isArray(input.lessonSessions) ? input.lessonSessions : []
  const scoresByStudent = input.examScoresByStudent || {}
  const exams = Array.isArray(input.exams) ? input.exams : []
  const behaviorLogs = Array.isArray(input.behaviorLogs) ? input.behaviorLogs : []
  const maxWarnings = Number(input.settings?.insight_config?.max_warnings ?? 3) || 3

  const curStart = now.getTime() - cfg.windowDays * DAY_MS
  const prevStart = curStart - cfg.windowDays * DAY_MS
  const inCur = (d) => { const t = new Date(d).getTime(); return t >= curStart && t <= now.getTime() + DAY_MS }
  const inPrev = (d) => { const t = new Date(d).getTime(); return t >= prevStart && t < curStart }

  const completed = sessions.filter((s) => s.status === 'completed' && s.session_date && s.group_name)
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  const studentsById = new Map(students.map((s) => [s.id, s]))

  const insights = []
  let findingsTotal = 0

  const push = (insight) => { insights.push({ generatedAt: iso(now), ...insight }) }

  // Pre-bucket attendance records by session for group attribution.
  const recordsBySession = new Map()
  for (const r of attendance) {
    if (!r.lesson_session_id) continue
    if (!recordsBySession.has(r.lesson_session_id)) recordsBySession.set(r.lesson_session_id, [])
    recordsBySession.get(r.lesson_session_id).push(r)
  }

  // ── Exam coverage (the exam tests its lesson + the lessons before it) ────
  const sessionOfExam = new Map()
  for (const e of exams) {
    if (e?.id && e.lesson_session_id) sessionOfExam.set(e.id, e.lesson_session_id)
  }
  // Returns { examSessionDate, sessions } — every completed session of the
  // exam's group with session_date <= the exam's session date — or null when
  // the exam is not linked to a session (coverage is never fabricated).
  const coveredForExam = (examId) => {
    const sid = sessionOfExam.get(examId)
    if (!sid) return null
    const ses = sessionById.get(sid)
    if (!ses?.group_name || !ses.session_date) return null
    return {
      examSessionDate: ses.session_date,
      sessions: completed.filter((s) => s.group_name === ses.group_name && s.session_date <= ses.session_date),
    }
  }

  const groups = [...new Set(completed.map((s) => s.group_name))]
  const groupResults = []

  for (const group of groups) {
    const gSessions = completed.filter((s) => s.group_name === group)
    const gStudents = students.filter((s) => s.group_name === group)
    const res = { group, sessions: gSessions, students: gStudents, cur: [], prev: [] }
    for (const s of gSessions) {
      const recs = recordsBySession.get(s.id) || []
      for (const r of recs) {
        const d = recordDate(r) || s.session_date
        if (inCur(d)) res.cur.push(r)
        else if (inPrev(d)) res.prev.push(r)
      }
    }
    groupResults.push(res)
  }

  // ── 1) Group absence level ────────────────────────────────────────────────
  for (const g of groupResults) {
    const group = g.group
    const heldCur = new Set(g.cur.map((r) => r.lesson_session_id)).size
    if (heldCur < cfg.minSessionsPerGroup) continue // not enough sessions to say anything

    const recordedCur = g.cur.filter((r) => r.status === 'حاضر' || r.status === 'غائب')
    const absRate = recordedCur.length ? recordedCur.filter((r) => r.status === 'غائب').length / recordedCur.length : 0
    const recordedPrev = g.prev.filter((r) => r.status === 'حاضر' || r.status === 'غائب')
    const absRatePrev = recordedPrev.length ? recordedPrev.filter((r) => r.status === 'غائب').length / recordedPrev.length : null

    // FINDING: absence above healthy baseline.
    if (absRate < cfg.absenceBaseline + 0.05) continue
    findingsTotal += 1

    const trendUp = absRatePrev != null && (absRate - absRatePrev) >= cfg.absenceDelta
    const persistent = absRatePrev != null && absRatePrev >= cfg.absenceFloor && absRate >= cfg.absenceFloor
    const impactHigh = absRate >= cfg.absenceImpactHigh

    // VALIDATION + MATERIALITY: needs the level to be problematic AND either
    // a clear rise, persistence, or high absolute impact.
    const material = absRate >= cfg.absenceFloor && (trendUp || persistent || impactHigh)
    if (!material) continue

    const affected = new Set(recordedCur.filter((r) => r.status === 'غائب').map((r) => r.student_id))
    // IMPACT: population share must be meaningful too (unless impact is high).
    const shareOk = affected.size >= Math.max(cfg.minPopulation, Math.ceil(g.students.length * cfg.populationShare))
    if (!shareOk && !impactHigh) continue

    const reasons = [
      `نسبة الغياب ${pct(absRate)}% (الحد المقلق ${pct(cfg.absenceFloor)}%)`,
      trendUp ? `مقارنة بالشهر اللي فات: زادت ${pct(absRate - (absRatePrev || 0))} نقطة` : null,
      persistent ? 'نفس المستوى العالي مستمر من الشهر اللي فات' : null,
      impactHigh ? `المستوى عالي بما يكفي إنه يأثر على سير المجموعة (${pct(absRate)}%)` : null,
      `عدد الطلاب المتأثرين: ${affected.size} من ${g.students.length}`,
    ].filter(Boolean)

    const lines = [
      absRatePrev != null
        ? `غياب مجموعة ${group} وصل ${pct(absRate)}% في آخر ٤ أسابيع، مقابل ${pct(absRatePrev)}% الشهر اللي فاته.`
        : `غياب مجموعة ${group} وصل ${pct(absRate)}% في آخر ٤ أسابيع.`,
      `الغياب بيأثر على ${affected.size} طالب — وده بيتسبب في فجوات في الفهم وتأخير في المنهج.`,
    ]

    push({
      id: `group-absence:${group}`,
      type: 'group-absence',
      group,
      severity: trendUp || impactHigh ? 'needs-attention' : 'watch',
      title: `غياب مجموعة ${group} عالي${trendUp ? ' وزايد' : ''}`,
      lines,
      action: 'افتح تقارير الحصص الأخيرة للمجموعة وابعت تقارير الغياب لأولياء الأمور، واتابع الغياب المتكرر بالاسم.',
      students: [],
      metrics: { absenceRate: absRate, prevRate: absRatePrev, heldSessions: heldCur, affected: affected.size, groupSize: g.students.length },
      reasons,
    })
  }

  // ── 2) Repeated absentees per group ──────────────────────────────────────
  for (const g of groupResults) {
    const group = g.group
    const heldCur = new Set(g.cur.map((r) => r.lesson_session_id)).size
    if (heldCur < cfg.minSessionsPerGroup) continue
    const perStudent = new Map()
    for (const r of g.cur) {
      if (r.status !== 'غائب') continue
      perStudent.set(r.student_id, (perStudent.get(r.student_id) || 0) + 1)
    }
    const repeat = []
    for (const [sid, absences] of perStudent) {
      if (absences >= cfg.repeatAbsenceMin && absences / heldCur >= cfg.repeatAbsenceShare) {
        const st = studentsById.get(sid)
        if (st) repeat.push({ id: sid, name: st.name, absences })
      }
    }
    if (!repeat.length) continue
    findingsTotal += 1

    // MATERIALITY: population affected must clear the bar.
    const needed = Math.max(cfg.minPopulation, Math.ceil(g.students.length * cfg.populationShare))
    if (repeat.length < needed) continue

    repeat.sort((a, b) => b.absences - a.absences)
    const names = repeat.slice(0, 5).map((s) => s.name).join('، ') + (repeat.length > 5 ? ` و${repeat.length - 5} تانيين` : '')
    push({
      id: `repeat-absence:${group}`,
      type: 'repeat-absence',
      group,
      severity: 'needs-attention',
      title: `${arNum(repeat.length)} طلاب في مجموعة ${group} غايبين بشكل متكرر`,
      lines: [
        `الأسامي: ${names}.`,
        `كل واحد فيهم فاتته ${pct(cfg.repeatAbsenceShare)}% أو أكتر من حصص المجموعة في آخر ٤ أسابيع — ده مش غياب عادي وبيأثر على مستواهم.`,
      ],
      action: 'ابعت تقارير الغياب لأولياء الأمور من صفحة التقارير، واتفق معاهم على خطة متابعة قبل ما الغياب يتضاعف.',
      students: repeat.map((s) => ({ id: s.id, name: s.name })),
      metrics: { students: repeat.length, needed, heldSessions: heldCur },
      reasons: [`عدد الطلاب ${repeat.length} >= الحد المطلوب ${needed}`, `كل طالب غايب >= ${pct(cfg.repeatAbsenceShare)}% من الحصص (${cfg.repeatAbsenceMin} غياب على الأقل)`],
    })
  }

  // ── 3) Homework completion decline ───────────────────────────────────────
  for (const g of groupResults) {
    const group = g.group
    const hwCur = g.cur.filter((r) => HW_APPLICABLE.has(r.homework_status || ''))
    if (hwCur.length < cfg.hwMinRecords) continue
    const hwRate = hwCur.filter((r) => HW_DONE.has(r.homework_status)).length / hwCur.length
    const hwPrevRecords = g.prev.filter((r) => HW_APPLICABLE.has(r.homework_status || ''))
    const hwRatePrev = hwPrevRecords.length >= cfg.hwMinRecords
      ? hwPrevRecords.filter((r) => HW_DONE.has(r.homework_status)).length / hwPrevRecords.length
      : null

    // FINDING: completion below healthy floor.
    if (hwRate >= cfg.hwFloor) continue
    findingsTotal += 1

    const dropped = hwRatePrev != null && (hwRatePrev - hwRate) >= cfg.hwDelta
    const persistent = hwRatePrev != null && hwRatePrev < cfg.hwFloor && hwRate < cfg.hwFloor

    // MATERIALITY: below the floor AND (a material drop OR persistent lowness).
    if (!dropped && !persistent) continue

    const reasons = [
      `نسبة التسليم ${pct(hwRate)}% واقعة تحت الحد الصحي ${pct(cfg.hwFloor)}%`,
      dropped ? `نزلت ${pct((hwRatePrev || 0) - hwRate)} نقطة مقارنة بالشهر اللي فات` : null,
      persistent ? 'المستوى الواطي مستمر من شهرين' : null,
      `عدد علامات الواجب في الفترة: ${hwCur.length}`,
    ].filter(Boolean)

    push({
      id: `homework-decline:${group}`,
      type: 'homework-decline',
      group,
      severity: dropped && hwRate < cfg.hwFloor - 0.1 ? 'needs-attention' : 'watch',
      title: `تسليم الواجب في مجموعة ${group}${dropped ? ' بيقل بشكل ملحوظ' : ' واطي بشكل مستمر'}`,
      lines: [
        hwRatePrev != null
          ? `نسبة تسليم الواجب نزلت لـ ${pct(hwRate)}% في آخر ٤ أسابيع، وكانت ${pct(hwRatePrev)}% قبله.`
          : `نسبة تسليم الواجب ${pct(hwRate)}% بس في آخر ٤ أسابيع.`,
        'الواجب هو أساس متابعة الفهم — الاستمرار كده هيبان في مستوى الطلاب مع الوقت.',
      ],
      action: 'راجع نوع الواجب المطلوب وصعوبته، وابعت تذكير للأولياء بمتابعة الواجب — ممكن تخصص رسالة للمجموعة من قوالب الرسائل.',
      students: [],
      metrics: { hwRate, prevRate: hwRatePrev, records: hwCur.length },
      reasons,
    })
  }

  // ── 4) Exam performance (decline per student + exam-difficulty check) ────
  const declinedByStudent = new Map()
  for (const s of students) {
    const scores = (scoresByStudent[s.id] || [])
      .filter((sc) => {
        const sectionCount = Object.keys(sc.section_scores || {}).length
        const max = Number(sc.max_score_per_section) * sectionCount
        return sectionCount > 0 && max > 0 && Number.isFinite(Number(sc.total_score))
      })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    if (scores.length < cfg.examMinExams) continue
    const pctOf = (sc) => Number(sc.total_score) / (Number(sc.max_score_per_section) * Object.keys(sc.section_scores || {}).length)
    const recent = scores.slice(-cfg.examRecent)
    const earlier = scores.slice(0, scores.length - cfg.examRecent)
    if (!earlier.length) continue
    const avgRecent = recent.reduce((a, sc) => a + pctOf(sc), 0) / recent.length
    const avgEarlier = earlier.reduce((a, sc) => a + pctOf(sc), 0) / earlier.length
    // VALIDATION: the drop must be consistent (every recent exam below the
    // earlier average), not one unusually bad day.
    const consistent = recent.every((sc) => pctOf(sc) < avgEarlier)
    const relativeDrop = avgEarlier > 0 ? (avgEarlier - avgRecent) / avgEarlier : 0
    if (consistent && relativeDrop >= cfg.examDeclineShare) {
      declinedByStudent.set(s.id, { student: s, drop: relativeDrop, avgRecent, avgEarlier })
    }
  }

  // Group the declines, and decide per group: a shared difficult exam vs a
  // real per-student trend (spec: "Is the exam unusually difficult? Is the
  // decline isolated to one exam?").
  const declinedByGroup = new Map()
  for (const d of declinedByStudent.values()) {
    const gname = d.student.group_name
    if (!gname) continue
    if (!declinedByGroup.has(gname)) declinedByGroup.set(gname, [])
    declinedByGroup.get(gname).push(d)
  }

  for (const [group, list] of declinedByGroup) {
    const groupStudents = students.filter((s) => s.group_name === group)
    const withScores = groupStudents.filter((s) => (scoresByStudent[s.id] || []).length >= cfg.examMinExams)
    if (withScores.length < cfg.minPopulation) continue
    findingsTotal += 1

    const needed = Math.max(cfg.minPopulation, Math.ceil(withScores.length * cfg.populationShare))

    // Exam-difficulty check: did most declining students hit their drop at
    // the SAME most-recent exam? Then the exam itself is the likely cause.
    const lastExamIdByStudent = new Map()
    for (const s of withScores) {
      const arr = (scoresByStudent[s.id] || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      if (arr.length) lastExamIdByStudent.set(s.id, arr[arr.length - 1].exam_id)
    }
    const declinedExamIds = new Map()
    for (const d of list) {
      const eid = lastExamIdByStudent.get(d.student.id)
      if (eid) declinedExamIds.set(eid, (declinedExamIds.get(eid) || 0) + 1)
    }
    let sharedExamId = null
    let sharedCount = 0
    for (const [eid, count] of declinedExamIds) {
      if (count > sharedCount) { sharedCount = count; sharedExamId = eid }
    }
    const examDifficultyLikely = Boolean(sharedExamId) && sharedCount >= Math.max(cfg.minPopulation, Math.ceil(withScores.length * cfg.populationShare))

    if (examDifficultyLikely) {
      let examTitle = ''
      for (const s of withScores) {
        const hit = (scoresByStudent[s.id] || []).find((sc) => sc.exam_id === sharedExamId)
        if (hit) { examTitle = hit.exam_title || ''; break }
      }
      // Coverage: the shared exam tests its lesson + the lessons before it —
      // so the collective drop measures understanding of THAT part exactly.
      const sharedCoverage = coveredForExam(sharedExamId)
      const difficultyLines = [
        'أغلب الطلاب اللي نزل مستواهم نزل مع بعض في نفس الامتحان — ده بيوحي إن صعوبة الامتحان هي السبب مش مستوى الطلاب.',
        `عدد الطلاب المتأثرين: ${sharedCount}.`,
      ]
      if (sharedCoverage?.sessions.length) {
        difficultyLines.push(`والامتحان ده بيختبر حصته والحصص اللي قبلها (${arNum(sharedCoverage.sessions.length)} حصص) — فالنزول فيه بيقيس فهم الجزء ده تحديدًا.`)
      }
      push({
        id: `exam-difficulty:${group}`,
        type: 'exam-difficulty',
        group,
        severity: 'watch',
        title: `امتحان ${examTitle || 'الأخير'} كان أصعب من العادة في مجموعة ${group}`,
        lines: difficultyLines,
        action: 'راجع الامتحان نفسه: لو فعلاً كان أصعب، اشرح الأسئلة الصعبة في الحصة الجاية — مفيش داعي تتعامل مع الموضوع كمشكلة عند الطلاب.',
        students: [],
        metrics: { affected: sharedCount, eligible: withScores.length, coveredSessions: sharedCoverage?.sessions.length ?? null },
        reasons: [
          `نفس الامتحان هو نقطة النزول لـ ${sharedCount} طلاب`,
          `عدد الطلاب اللي عندهم تاريخ امتحانات كافي: ${withScores.length}`,
        ],
      })
      continue
    }

    if (list.length < needed) continue
    list.sort((a, b) => b.drop - a.drop)
    const names = list.slice(0, 5).map((d) => d.student.name).join('، ') + (list.length > 5 ? ` و${list.length - 5} تانيين` : '')

    // Coverage window (the exam tests its lesson + the lessons before it):
    // scope the cause-check to the part actually tested. We use the latest
    // scopeable last-exam among the declining students and count how many of
    // them were absent inside its covered lessons — observed fact only, no
    // invented causation. Skipped silently when exams/session links are missing.
    let coverage = null
    for (const d of list) {
      const arr = (scoresByStudent[d.student.id] || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      const last = arr[arr.length - 1]
      if (!last?.exam_id) continue
      const cov = coveredForExam(last.exam_id)
      if (cov?.sessions.length && (!coverage || cov.examSessionDate > coverage.examSessionDate)) coverage = cov
    }
    let coverageLine = null
    let absentInCovered = null
    if (coverage) {
      const decliningIds = new Set(list.map((d) => d.student.id))
      const absentSet = new Set()
      for (const s of coverage.sessions) {
        for (const r of (recordsBySession.get(s.id) || [])) {
          if (r.status === 'غائب' && decliningIds.has(r.student_id)) absentSet.add(r.student_id)
        }
      }
      absentInCovered = absentSet.size
      coverageLine = absentInCovered > 0
        ? `و${arNum(absentInCovered)} منهم كانوا غايبين في حصص من الجزء اللي الامتحان بيختبره (حصة الامتحان والحصص اللي قبلها — ${arNum(coverage.sessions.length)} حصص) — دي أول فجوة تراجعها.`
        : `ومفيش غياب في الجزء اللي الامتحان بيختبره (حصة الامتحان والحصص اللي قبلها — ${arNum(coverage.sessions.length)} حصص) — فمراجعة المستوى نفسها أهم هنا من متابعة الحضور.`
    }

    push({
      id: `exam-decline:${group}`,
      type: 'exam-decline',
      group,
      severity: 'needs-attention',
      title: `مستوى ${arNum(list.length)} طلاب في مجموعة ${group} بيقل باستمرار في الامتحانات`,
      lines: [
        `الأسامي: ${names}.`,
        `كل واحد فيهم نزل ${pct(cfg.examDeclineShare)}% أو أكتر بين آخر امتحانين ومتوسط الامتحانات اللي قبلهم — والنزول متكرر مش يوم وحيد.`,
        ...(coverageLine ? [coverageLine] : []),
        'لو الاستمرار كده، هيوصلوا لمرحلة تعجز فيها عن متابعة المنهج.',
      ],
      action: 'حدد موعد مراجعة سريعة مع الطلاب دول قبل الامتحان الجاي، وابعت لأولياء الأمور تقرير بمستوى ولادهم بالظبط.',
      students: list.map((d) => ({ id: d.student.id, name: d.student.name })),
      metrics: {
        students: list.length,
        needed,
        eligible: withScores.length,
        coveredSessions: coverage?.sessions.length ?? null,
        absentInCovered,
      },
      reasons: [
        `عدد الطلاب ${list.length} >= الحد المطلوب ${needed}`,
        `النزول متكرر في آخر ${cfg.examRecent} امتحانات وليس امتحان واحد`,
        `النسبة >= ${pct(cfg.examDeclineShare)}%`,
        ...(coverage ? [`امتحان الحصة بيختبر حصته والحصص اللي قبلها (${arNum(coverage.sessions.length)} حصة) — الغياب اتحسب جوه الجزء ده بس`] : []),
      ],
    })
  }

  // ── 5) Warnings cluster ──────────────────────────────────────────────────
  {
    const near = students.filter((s) => {
      const w = Number(s.warnings || 0)
      return w >= maxWarnings - cfg.warningsNear && w < maxWarnings
    })
    if (near.length >= cfg.minPopulation) {
      const names = near.slice(0, 5).map((s) => s.name).join('، ') + (near.length > 5 ? ` و${near.length - 5} تانيين` : '')
      push({
        id: 'warnings-cluster',
        type: 'warnings-cluster',
        group: null,
        severity: 'watch',
        title: `${arNum(near.length)} طلاب قربوا من حد الإنذارات`,
        lines: [
          `الأسامي: ${names}.`,
          `كل واحد فيهم عنده إنذار واحد بس قبل الحد (${maxWarnings} إنذارات) — أي مخالفة جاية هينقلهم لمسار الإجراءات.`,
        ],
        action: 'كلمة واحدة مع الطلاب دول دلوقتي ممكن تمنع مشكلة أكبر — ولو حصل إنذار هيبقى لازم إجراء رسمي.',
        students: near.map((s) => ({ id: s.id, name: s.name })),
        metrics: { students: near.length, maxWarnings },
        reasons: [`عدد الطلاب ${near.length} >= الحد الأدنى ${cfg.minPopulation}`, 'كلهم على خطوة واحدة من الإجراء الرسمي — تأثير تشغيلي مباشر'],
      })
    }
  }

  // ── 6) Engagement drop (observable behavior records only) ────────────────
  // Spec 7F: never infer motivation or mental state — we count RECORDED
  // negative behavior notes. A pattern across several students in the same
  // window is an operational signal worth one watch-level insight.
  if (behaviorLogs.length) {
    const negByStudent = new Map()
    for (const b of behaviorLogs) {
      if (!b?.student_id) continue
      const d = b.created_at ? new Date(b.created_at).getTime() : NaN
      if (!Number.isFinite(d) || d < curStart || d > now.getTime() + DAY_MS) continue
      if (Number(b.points_delta) >= 0) continue
      negByStudent.set(b.student_id, (negByStudent.get(b.student_id) || 0) + 1)
    }
    const flagged = []
    for (const [sid, notes] of negByStudent) {
      if (notes < cfg.engagementMinNotes) continue
      const st = studentsById.get(sid)
      if (st) flagged.push({ id: sid, name: st.name, notes })
    }
    const needed = Math.max(cfg.minPopulation, Math.ceil(students.length * cfg.populationShare))
    if (flagged.length >= needed) {
      findingsTotal += 1
      flagged.sort((a, b) => b.notes - a.notes)
      const names = flagged.slice(0, 5).map((s) => s.name).join('، ') + (flagged.length > 5 ? ` و${flagged.length - 5} تانيين` : '')
      push({
        id: 'engagement-drop',
        type: 'engagement-drop',
        group: null,
        severity: 'watch',
        title: `${arNum(flagged.length)} طلاب عليهم ملاحظات سلوكية متكررة في آخر ٤ أسابيع`,
        lines: [
          `الأسامي: ${names}.`,
          `كل واحد فيهم عليه ${cfg.engagementMinNotes} ملاحظات سلبية مسجلة أو أكتر في نفس الفترة — ده تسجيل ملاحظات حقيقي، والسبب المحتمل مش واضح من البيانات لوحدها.`,
        ],
        action: 'تكلم مع الطلاب دول قبل ما الموضوع يكبر، وسجل أي تطور في ملاحظاتهم عشان الفريق يقدر يقيس التغير الشهر الجاي.',
        students: flagged.map((s) => ({ id: s.id, name: s.name })),
        metrics: { students: flagged.length, needed },
        reasons: [
          `عدد الطلاب ${flagged.length} >= الحد المطلوب ${needed}`,
          `كل طالب عليه ${cfg.engagementMinNotes} ملاحظات سلبية مسجلة على الأقل في الفترة`,
        ],
      })
    }
  }

  const order = { 'needs-attention': 0, watch: 1 }
  insights.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))

  return {
    insights,
    meta: {
      generatedAt: iso(now),
      windowDays: cfg.windowDays,
      studentsAnalyzed: students.length,
      sessionsAnalyzed: completed.length,
      groupsAnalyzed: groups.length,
      findingsTotal,
      insightsCreated: insights.length,
      config: cfg,
    },
  }
}
