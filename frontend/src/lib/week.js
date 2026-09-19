// ═══════════════════════════════════════════════════════════════════════════
// WEEK — the ONE central week rule for the whole app.
//
// The week runs FRIDAY → THURSDAY (spec 17). Every component that needs a
// "week" boundary must use these helpers — never a local getDay() calculation,
// never a different first-day-of-week. One rule, one implementation.
//
// JS getDay(): Sun=0 Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=6.
// Days since Friday: (getDay() + 2) % 7  →  Fri→0, Sat→1, … Thu→6.
//
// WEEKLY ATTENDANCE (spec 18–21) is DERIVED here from session attendance
// records — never stored, never written back. It is a pure read-model:
//   RULE 1: any حاضر record in the week            → ATTENDED
//   RULE 2: records exist but every one is غائب    → ABSENT
//   RULE 3: no records at all in the week          → NOT RECORDED
// Session attendance stays the single source of truth; editing a session
// mark automatically changes the derived weekly status on next read.
// ═══════════════════════════════════════════════════════════════════════════

export function weekStart(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const daysSinceFriday = (d.getDay() + 2) % 7
  d.setDate(d.getDate() - daysSinceFriday)
  return d
}

export function weekEnd(date = new Date()) {
  const s = weekStart(date)
  s.setDate(s.getDate() + 6) // Thursday
  return s
}

export function localISODate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// The attendance day of a record: prefer the explicit attendance_date column,
// fall back to the recorded_at timestamp's local date.
export function attendanceDateOf(record) {
  if (record?.attendance_date) return String(record.attendance_date)
  if (record?.recorded_at) return String(record.recorded_at).slice(0, 10)
  return ''
}

/**
 * Derived weekly attendance for ONE student over the Friday→Thursday week
 * containing refDate. Pure function — no writes, no side effects.
 * @param {Array} records     attendance_records rows (any order)
 * @param {string} studentId
 * @param {Date}   refDate
 * @returns {{status:'attended'|'absent'|'none', present:number, absent:number, recorded:number, weekStart:string, weekEnd:string}}
 */
export function weeklyAttendanceForStudent(records = [], studentId, refDate = new Date()) {
  const start = weekStart(refDate)
  const end = weekEnd(refDate)
  const startStr = localISODate(start)
  const endStr = localISODate(end)
  let present = 0
  let absent = 0
  for (const r of records) {
    if (!r || r.student_id !== studentId) continue
    const ds = attendanceDateOf(r)
    if (!ds || ds < startStr || ds > endStr) continue
    if (r.status === 'حاضر') present++
    else if (r.status === 'غائب') absent++
  }
  const status = present > 0 ? 'attended' : absent > 0 ? 'absent' : 'none'
  return { status, present, absent, recorded: present + absent, weekStart: startStr, weekEnd: endStr }
}

export const WEEKLY_STATUS_LABEL = {
  attended: { ar: 'حضر هذا الأسبوع', en: 'Attended this week' },
  absent: { ar: 'غائب هذا الأسبوع', en: 'Absent this week' },
  none: { ar: 'لم يُرصد هذا الأسبوع', en: 'Not recorded this week' },
}
