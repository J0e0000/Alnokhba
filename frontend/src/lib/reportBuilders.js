// ═══════════════════════════════════════════════════════════════════════════
// استوديو التقارير — REPORT BUILDERS (pure, testable, no Supabase imports)
//
// Owner spec (2026-09): reports are a MEANINGFUL AGGREGATE of events —
//   العنوان → ملخص صغير → أهم الأرقام → سبب الأهمية → دعوة للمتابعة
// with SIX report types (3 student / 3 teacher), each driven by a
// teacher-editable template (teacher_settings.msg_* columns) filled with
// REAL data — never invented numbers.
//
// DATA SOURCES (all already loaded in WorkspaceStore):
//   attendance_records (status / homework_status / lesson_session_id /
//     attendance_date) · lesson_sessions (completed = status 'completed') ·
//     exam_scores (+ exams join) · students (points / warnings).
//
// HONESTY RULES (same contract as the insights engine):
//   • A placeholder whose data does not exist collapses its LINE entirely
//     (same semantics as the attendance templates) — no dangling "ٍ: " and
//     no fake zeros dressed up as data.
//   • "التفاعل" per session is NOT fabricated: the schema stores interaction
//     as cumulative points (behavior_logs), not a per-session tri-state, so
//     session reports cover حضور / واجب / امتحان — the data that really
//     exists per session.
//   • Follow-up reasons reuse the engine's OWN thresholds
//     (INSIGHT_CONFIG.windowDays / repeatAbsenceShare) + the academic
//     warning rule the app already uses (≥10-point drop).
// ═══════════════════════════════════════════════════════════════════════════

import { weekStart, weekEnd, localISODate, attendanceDateOf } from './week.js'
import { INSIGHT_CONFIG } from './insights/engine.js'
import { getStudentRank, getStudentRankPosition } from './helpers.js'

const HW_DONE = new Set(['مكتمل', 'تم'])
const HW_APPLICABLE = new Set(['مكتمل', 'تم', 'ناقص', 'لم يتم'])

// ─────────────────────────────────────────────────────────────────────────────
// Small date/number utils
// ─────────────────────────────────────────────────────────────────────────────

/** الأحد 22 سبتمبر (session-report style date). */
export function arabicDay(d) {
  try {
    return new Date(d).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })
  } catch { return String(d || '') }
}

/** 22 سبتمبر 2026 (admin/record style date). */
export function arabicDate(d) {
  try {
    return new Date(d).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return String(d || '') }
}

/** The app's ONE week rule (Friday → Thursday, lib/week.js). */
export function weekWindow(refDate = new Date(), offsetWeeks = 0) {
  const ref = new Date(refDate.getTime() + (Number(offsetWeeks) || 0) * 7 * 86400000)
  const s = weekStart(ref)
  const e = weekEnd(s)
  return { startISO: localISODate(s), endISO: localISODate(e), label: `${arabicDay(s)} – ${arabicDay(e)}` }
}

/**
 * One exam score row → percentage. Tolerates both row shapes:
 * raw exam_scores (total_score + max_score_per_section + section_scores)
 * and simplified portal rows ({ total, max }).
 */
export function examScorePct(sc) {
  if (!sc) return null
  const earned = Number(sc.total_score ?? sc.total ?? sc.score)
  let max = NaN
  if (sc.max_score_per_section != null && Number.isFinite(Number(sc.max_score_per_section))) {
    const sectionCount = Object.keys(sc.section_scores || {}).length || 1
    max = Number(sc.max_score_per_section) * sectionCount
  } else if (Number.isFinite(Number(sc.max ?? sc.max_score))) {
    max = Number(sc.max ?? sc.max_score)
  }
  if (!Number.isFinite(earned) || !Number.isFinite(max) || max <= 0) return null
  return pctOf(earned, max)
}

/** Integer-safe percentage: (earned*100)/max avoids the 0.575*100 → 57.4999 float trap. */
export function pctOf(earned, max) {
  if (!Number.isFinite(Number(earned)) || !Number.isFinite(Number(max)) || Number(max) <= 0) return null
  return Math.round((Number(earned) * 100) / Number(max))
}

/** Same max computation as examScorePct, returning the raw earned/max pair. */
export function examScoreParts(sc) {
  if (!sc) return null
  const earned = Number(sc.total_score ?? sc.total ?? sc.score)
  let max = NaN
  if (sc.max_score_per_section != null && Number.isFinite(Number(sc.max_score_per_section))) {
    const sectionCount = Object.keys(sc.section_scores || {}).length || 1
    max = Number(sc.max_score_per_section) * sectionCount
  } else if (Number.isFinite(Number(sc.max ?? sc.max_score))) {
    max = Number(sc.max ?? sc.max_score)
  }
  if (!Number.isFinite(earned) || !Number.isFinite(max) || max <= 0) return null
  return { earned, max }
}

// ─────────────────────────────────────────────────────────────────────────────
// Template interpolation — LINE-AWARE semantics: a line that held only
// placeholders and becomes blank after substitution disappears entirely
// (missing data → no dangling label). Intentional blank lines stay.
// ─────────────────────────────────────────────────────────────────────────────

export function interpolateTemplate(template, vars = {}) {
  const src = String(template || '')
  const outLines = []
  for (const rawLine of src.split('\n')) {
    let line = rawLine
    for (const [key, value] of Object.entries(vars)) {
      line = line.replaceAll(`{${key}}`, String(value ?? ''))
    }
    // Owner contract: a line that HELD placeholders and became blank after
    // substitution disappears entirely (missing data → no dangling label,
    // no empty gap). Intentional blank lines (never had a placeholder) stay.
    if (/\{[^{}]+\}/.test(rawLine) && !line.trim()) continue
    outLines.push(line.replace(/\s+$/, ''))
  }
  return outLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregations over real rows
// ─────────────────────────────────────────────────────────────────────────────

/** Completed sessions of ONE group inside an ISO date window (inclusive). */
export function completedSessionsInWindow(lessonSessions = [], groupName, startISO, endISO) {
  return (lessonSessions || [])
    .filter((l) => l.group_name === groupName && l.status === 'completed' && l.session_date
      && String(l.session_date) >= startISO && String(l.session_date) <= endISO)
    .sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)))
}

/**
 * allAttendance arrives ordered recorded_at DESC from the store — keep the
 * FIRST row per (student, session) so re-marked records don't double count.
 */
export function latestRecordPerStudentSession(records = []) {
  const map = new Map()
  for (const r of records || []) {
    const key = `${r.student_id}|${r.lesson_session_id}`
    if (!map.has(key)) map.set(key, r)
  }
  return [...map.values()]
}

/**
 * Per-student weekly stats inside one Friday→Thursday window.
 * @returns {{ held, present, absent, hwDone, hwApplicable, examAvg, examsCount }}
 */
export function studentWeekStats({ studentId, groupName, allAttendance = [], lessonSessions = [], examScores = [], startISO, endISO }) {
  const sessions = completedSessionsInWindow(lessonSessions, groupName, startISO, endISO)
  const sessionIds = new Set(sessions.map((l) => l.id))
  const mine = latestRecordPerStudentSession(
    (allAttendance || []).filter((r) => r.student_id === studentId && sessionIds.has(r.lesson_session_id)),
  )
  let present = 0
  let absent = 0
  let hwDone = 0
  let hwApplicable = 0
  for (const r of mine) {
    if (r.status === 'حاضر') present++
    else if (r.status === 'غائب') absent++
    if (HW_APPLICABLE.has(r.homework_status || '')) {
      hwApplicable++
      if (HW_DONE.has(r.homework_status)) hwDone++
    }
  }
  const pcts = (examScores || [])
    .filter((sc) => { const d = sc.created_at ? String(sc.created_at).slice(0, 10) : ''; return d && d >= startISO && d <= endISO })
    .map(examScorePct)
    .filter((p) => p != null)
  const examAvg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
  return { held: sessions.length, present, absent, hwDone, hwApplicable, examAvg, examsCount: pcts.length }
}

/**
 * Students needing follow-up — 28d window (engine window), explainable
 * reasons only: repeated absence (engine share), homework missing twice in
 * a row, a ≥10-point exam drop (the existing academic-warning rule), and
 * warnings at/near the QR-block threshold.
 * @returns {Array<{ student, reasons: string[] }>}
 */
export function followUpStudents({ groupName, students = [], allAttendance = [], lessonSessions = [], examScoresByStudent = {}, now = new Date(), warningsThreshold }) {
  const endISO = localISODate(now)
  const startISO = localISODate(new Date(now.getTime() - (INSIGHT_CONFIG.windowDays || 28) * 86400000))
  const sessions = completedSessionsInWindow(lessonSessions, groupName, startISO, endISO)
  const sessionIds = new Set(sessions.map((l) => l.id))
  const held = sessions.length
  const threshold = Number(warningsThreshold ?? 3)
  const out = []
  for (const s of students || []) {
    if (s.group_name !== groupName) continue
    const reasons = []
    const mine = latestRecordPerStudentSession(
      (allAttendance || []).filter((r) => r.student_id === s.id && sessionIds.has(r.lesson_session_id)),
    ).sort((a, b) => attendanceDateOf(a).localeCompare(attendanceDateOf(b)))
    const absent = mine.filter((r) => r.status === 'غائب').length
    if (held >= 2 && absent / held >= (INSIGHT_CONFIG.repeatAbsenceShare ?? 0.5)) {
      reasons.push(`غياب متكرر (${absent} من ${held})`)
    }
    const hwRecent = mine.filter((r) => HW_APPLICABLE.has(r.homework_status || '')).slice(-2)
    if (hwRecent.length === 2 && hwRecent.every((r) => !HW_DONE.has(r.homework_status))) {
      reasons.push('الواجب مش مكتمل')
    }
    const pcts = (examScoresByStudent[s.id] || [])
      .map((sc) => ({ p: examScorePct(sc), d: sc.created_at ? String(sc.created_at).slice(0, 10) : '' }))
      .filter((x) => x.p != null)
      .sort((a, b) => a.d.localeCompare(b.d))
    if (pcts.length >= 2) {
      const last = pcts[pcts.length - 1]
      const prev = pcts[pcts.length - 2]
      if (prev.p - last.p >= 10) reasons.push(`انخفاض في الدرجات (من ${prev.p}% لـ ${last.p}%)`)
    }
    if (Number(s.warnings || 0) >= Math.max(1, threshold - 1)) {
      reasons.push(`إنذارات: ${s.warnings || 0} من ${threshold}`)
    }
    if (reasons.length) out.push({ student: s, reasons })
  }
  return out
}

/**
 * Group-level weekly stats + who improved (exam avg this window vs the
 * previous equal window, ≥10 points — the same delta rule as the engine).
 */
export function groupWeekStats({ groupName, students = [], allAttendance = [], lessonSessions = [], examScoresByStudent = {}, startISO, endISO, warningsThreshold, now = new Date() }) {
  const sessions = completedSessionsInWindow(lessonSessions, groupName, startISO, endISO)
  const sessionIds = new Set(sessions.map((l) => l.id))
  const groupStudents = (students || []).filter((s) => s.group_name === groupName)
  const groupIds = new Set(groupStudents.map((s) => s.id))
  const rows = latestRecordPerStudentSession(
    (allAttendance || []).filter((r) => sessionIds.has(r.lesson_session_id) && groupIds.has(r.student_id)),
  )
  let present = 0
  let absent = 0
  let hwDone = 0
  let hwApplicable = 0
  for (const r of rows) {
    if (r.status === 'حاضر') present++
    else if (r.status === 'غائب') absent++
    if (HW_APPLICABLE.has(r.homework_status || '')) {
      hwApplicable++
      if (HW_DONE.has(r.homework_status)) hwDone++
    }
  }
  const attendancePct = present + absent ? Math.round((present / (present + absent)) * 100) : null
  const hwPct = hwApplicable ? Math.round((hwDone / hwApplicable) * 100) : null

  const windowMs = new Date(endISO).getTime() - new Date(startISO).getTime()
  const prevStartISO = localISODate(new Date(new Date(startISO).getTime() - windowMs))
  let curEarned = 0
  let curMax = 0
  let curScores = 0
  let improvedCount = 0
  for (const s of groupStudents) {
    const inWindow = []
    const inPrev = []
    for (const sc of (examScoresByStudent[s.id] || [])) {
      const d = sc.created_at ? String(sc.created_at).slice(0, 10) : ''
      const parts = examScoreParts(sc)
      if (!d || !parts) continue
      if (d >= startISO && d <= endISO) inWindow.push(parts)
      else if (d >= prevStartISO && d < startISO) inPrev.push(parts)
    }
    for (const p of inWindow) { curEarned += p.earned; curMax += p.max; curScores++ }
    const avg = (list) => {
      const earned = list.reduce((a, b) => a + b.earned, 0)
      const max = list.reduce((a, b) => a + b.max, 0)
      return pctOf(earned, max)
    }
    const curAvg = avg(inWindow)
    const prevAvg = avg(inPrev)
    if (curAvg != null && prevAvg != null && curAvg - prevAvg >= 10) improvedCount++
  }
  const examAvg = pctOf(curEarned, curMax)

  const followups = followUpStudents({ groupName, students, allAttendance, lessonSessions, examScoresByStudent, now, warningsThreshold })
  return {
    held: sessions.length,
    present, absent,
    attendancePct, hwDone, hwApplicable, hwPct,
    examAvg, examsCount: curScores,
    followups, improvedCount,
    studentsCount: groupStudents.length,
  }
}

/**
 * Session-scoped stats for the TEACHER session report — everything from the
 * single lesson: attendance, homework, the exam held in that lesson (if any)
 * and same-session follow-up flags (absent / hw not done / exam below 50%).
 */
export function sessionStats({ lesson, attendanceRows = [], groupStudents = [], examScoresByStudent = {}, examsList = [] }) {
  const rows = latestRecordPerStudentSession(
    (attendanceRows || []).filter((r) => r.lesson_session_id === lesson.id),
  )
  const byStudent = new Map(rows.map((r) => [r.student_id, r]))
  let present = 0
  let absent = 0
  let unrecorded = 0
  let hwDone = 0
  let hwApplicable = 0
  const followups = []
  const lessonExams = (examsList || []).filter((e) => e.lesson_session_id === lesson.id)
  const examIds = new Set(lessonExams.map((e) => e.id))

  for (const s of groupStudents) {
    const r = byStudent.get(s.id)
    const status = r?.status || ''
    const hw = r?.homework_status || ''
    if (status === 'حاضر') present++
    else if (status === 'غائب') absent++
    else unrecorded++
    if (HW_APPLICABLE.has(hw)) {
      hwApplicable++
      if (HW_DONE.has(hw)) hwDone++
    }
    const sessionReasons = []
    if (status === 'غائب') sessionReasons.push('غائب')
    if (hw && !HW_DONE.has(hw) && status !== 'غائب') sessionReasons.push(`الواجب ${hw}`)
    if (examIds.size) {
      const sc = (examScoresByStudent[s.id] || []).find((x) => examIds.has(x.exam_id))
      const p = examScorePct(sc)
      if (p != null && p < 50) sessionReasons.push(`الامتحان ${p}%`)
    }
    if (sessionReasons.length) followups.push({ student: s, reasons: sessionReasons })
  }

  let examLine = ''
  if (lessonExams.length) {
    const exam = lessonExams[0]
    let earned = 0
    let max = 0
    let count = 0
    for (const s of groupStudents) {
      const sc = (examScoresByStudent[s.id] || []).find((x) => x.exam_id === exam.id)
      const parts = examScoreParts(sc)
      if (parts) { earned += parts.earned; max += parts.max; count++ }
    }
    if (max) examLine = `الامتحان: «${exam.title}» — متوسط المجموعة ${pctOf(earned, max)}% (${count} طالب)`
  }

  return {
    present, absent, unrecorded,
    hwDone, hwMissing: hwApplicable - hwDone, hwApplicable,
    examLine,
    followups,
    total: groupStudents.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Report kinds + default templates (Egyptian, owner-spec structure)
// ─────────────────────────────────────────────────────────────────────────────

export const REPORT_KINDS = {
  session: {
    section: 'student', icon: '🔔', title: 'تحديث الجلسة',
    desc: 'رسالة بعد انتهاء الحصة — الحضور والواجب والامتحان لكل طالب حسب حالته.',
    settingsKey: null, // present/absent pair (msg_attendance_present / absent)
  },
  weekly: {
    section: 'student', icon: '📊', title: 'التقرير الأسبوعي للطالب',
    desc: 'بدل ١٠ رسائل — ملخص أسبوعي واحد: حضور، امتحانات، واجبات، نقاط.',
    settingsKey: 'msg_student_weekly',
  },
  exam: {
    section: 'student', icon: '📝', title: 'نتيجة اختبار',
    desc: 'تُرسل عند تسجيل نتيجة امتحان — الدرجة والنسبة لكل طالب.',
    settingsKey: 'msg_student_exam',
  },
  'teacher-session': {
    section: 'teacher', icon: '📚', title: 'تقرير الجلسة للمدرس',
    desc: 'أرقام الحصة كاملة: حضور، واجب، امتحان، وطلاب محتاجين متابعة.',
    settingsKey: 'msg_teacher_session',
  },
  'teacher-weekly': {
    section: 'teacher', icon: '📈', title: 'ملخص الأسبوع للمدرس',
    desc: 'الجلسات ومتوسطات الحضور والأداء والواجب ومن تحسن ومحتاج متابعة.',
    settingsKey: 'msg_teacher_weekly',
  },
  followup: {
    section: 'teacher', icon: '⚠️', title: 'تنبيه المتابعة',
    desc: 'أسماء الطلاب المحتاجين متابعة وسبب كل واحد — مرتبط بإجراء مش بس أرقام.',
    settingsKey: 'msg_teacher_followup',
  },
}

export const DEFAULT_TEMPLATES = {
  msg_student_weekly: `📊 التقرير الأسبوعي — {studentName}
الفترة: {weekRange}
الحضور: {present} من {held} جلسات
{examLine}
{hwLine}
النقاط: {points} · الرتبة: {rank}
{noteLine}`,
  msg_student_exam: `📝 تم تسجيل نتيجة اختبار {group}
الاختبار: {examTitle}
الدرجة: {score} من {max}
النسبة: {percentage}%
{noteLine}`,
  msg_teacher_session: `📚 تقرير جلسة {group} — {date}
الحضور: {present} حاضر / {absent} غياب
الواجب: {hwDone} مكتمل / {hwMissing} غير مكتمل
{examLine}
{followupLine}
{lessonNote}`,
  msg_teacher_weekly: `📊 ملخص الأسبوع — {group}
الفترة: {weekRange}
الجلسات: {held}
متوسط الحضور: {attendancePct}%
{examLine}
إكمال الواجب: {hwPct}%
يحتاجون متابعة: {followupCount}
{improvedLine}`,
  msg_teacher_followup: `⚠️ طلاب يحتاجون متابعة — {group}
تم رصد {followupCount} طلاب خلال الفترة الأخيرة:
{followupList}`,
}

/** Template bricks per kind (labels → placeholders), for the line editor. */
export const BRICKS_BY_KIND = {
  weekly: [
    ['اسم الطالب', '{studentName}'], ['المجموعة', '{group}'], ['الفترة', '{weekRange}'],
    ['عدد الجلسات', '{held}'], ['حضر', '{present}'], ['غاب', '{absent}'],
    ['سطر الامتحانات', '{examLine}'], ['سطر الواجب', '{hwLine}'],
    ['النقاط', '{points}'], ['الرتبة', '{rank}'], ['سطر الملاحظة', '{noteLine}'],
  ],
  exam: [
    ['اسم الطالب', '{studentName}'], ['المجموعة', '{group}'], ['اسم الاختبار', '{examTitle}'],
    ['الدرجة', '{score}'], ['من', '{max}'], ['النسبة', '{percentage}'], ['سطر الملاحظة', '{noteLine}'],
  ],
  'teacher-session': [
    ['المجموعة', '{group}'], ['التاريخ', '{date}'], ['حاضر', '{present}'], ['غياب', '{absent}'],
    ['واجب مكتمل', '{hwDone}'], ['واجب ناقص', '{hwMissing}'], ['سطر الامتحان', '{examLine}'],
    ['سطر المتابعة', '{followupLine}'], ['ملاحظات الجلسة', '{lessonNote}'],
  ],
  'teacher-weekly': [
    ['المجموعة', '{group}'], ['الفترة', '{weekRange}'], ['الجلسات', '{held}'],
    ['متوسط الحضور', '{attendancePct}'], ['سطر الامتحانات', '{examLine}'],
    ['نسبة الواجب', '{hwPct}'], ['عدد المتابعة', '{followupCount}'], ['سطر التحسن', '{improvedLine}'],
  ],
  followup: [
    ['المجموعة', '{group}'], ['عدد الطلاب', '{followupCount}'], ['قائمة الأسماء', '{followupList}'],
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Vars builders — one per report kind (all values REAL, optionals collapse)
// ─────────────────────────────────────────────────────────────────────────────

export function studentWeeklyVars({ student, stats, weekLabel, allStudents = [], ranks = [], note = '' }) {
  const position = getStudentRankPosition(student.id, allStudents)
  const rank = getStudentRank(student.points || 0, ranks) || '—'
  return {
    studentName: student.name || '',
    group: student.group_name || '',
    weekRange: weekLabel || '',
    held: stats.held,
    present: stats.present,
    absent: stats.absent,
    examLine: stats.examsCount ? `متوسط الاختبارات: ${stats.examAvg}%` : '',
    hwLine: stats.hwApplicable ? `الواجبات: ${stats.hwDone} مكتملة من ${stats.hwApplicable}` : '',
    points: student.points || 0,
    rank: position !== '-' ? `${rank} (مركز ${position})` : rank,
    noteLine: note || '',
  }
}

export function examResultVars({ student, scoreRow, groupName = '', note = '' }) {
  const parts = examScoreParts(scoreRow)
  const score = parts ? parts.earned : Number(scoreRow?.total_score ?? 0)
  const max = parts ? parts.max : '—'
  const percentage = parts ? `${pctOf(parts.earned, parts.max)}%` : '—'
  return {
    studentName: student?.name || '',
    group: groupName || student?.group_name || '',
    examTitle: scoreRow?.exam_title || 'اختبار',
    score,
    max,
    percentage,
    noteLine: note || '',
  }
}

export function teacherSessionVars({ lesson, stats, groupName = '' }) {
  const followupNames = stats.followups
    .map((f) => `${f.student.name}${f.reasons.length ? ` (${f.reasons[0]})` : ''}`)
    .join('، ')
  return {
    group: groupName || lesson.group_name || '',
    date: arabicDay(lesson.session_date),
    present: stats.present,
    absent: stats.absent,
    hwDone: stats.hwDone,
    hwMissing: stats.hwMissing,
    examLine: stats.examLine,
    followupLine: followupNames ? `يحتاجون متابعة: ${followupNames}` : '',
    lessonNote: lesson.lesson_topic ? `ملاحظات الجلسة: ${lesson.lesson_topic}` : '',
  }
}

export function teacherWeeklyVars({ stats, groupName = '', weekLabel = '' }) {
  return {
    group: groupName,
    weekRange: weekLabel,
    held: stats.held,
    attendancePct: stats.attendancePct != null ? stats.attendancePct : '—',
    examLine: stats.examAvg != null ? `متوسط الأداء: ${stats.examAvg}%` : '',
    hwPct: stats.hwPct != null ? stats.hwPct : '—',
    followupCount: stats.followups.length,
    improvedLine: stats.improvedCount ? `طلاب تحسّن مستواهم: ${stats.improvedCount}` : '',
  }
}

export function followUpVars({ stats, groupName = '' }) {
  const list = stats.followups
    .map((f) => `• ${f.student.name} — ${f.reasons.join('، ')}`)
    .join('\n')
  return {
    group: groupName,
    followupCount: stats.followups.length,
    followupList: list,
  }
}
