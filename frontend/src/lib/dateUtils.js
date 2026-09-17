// ═══════════════════════════════════════════════════════════════════════════
// DATE UTILITIES — local-date helpers for the day timeline.
// The legacy code used `new Date().toISOString().slice(0,10)` (UTC) which
// disagrees with the teacher's local day in any non-UTC timezone. All NEW
// day-selection code uses LOCAL dates; lesson rows keep 'YYYY-MM-DD'.
// ═══════════════════════════════════════════════════════════════════════════

export const localISODate = (d = new Date()) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const addDaysISO = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return localISODate(dt)
}

// Weekday 0–6 (JS getDay convention — matches group_schedule.weekday)
export const weekdayOfISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

export const todayLocalISO = () => localISODate(new Date())

const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const AR_WEEKDAYS_SHORT = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const EN_WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const weekdayName = (weekdayIndex, isArabic = true, short = false) => {
  const i = ((weekdayIndex % 7) + 7) % 7
  if (isArabic) return short ? AR_WEEKDAYS_SHORT[i] : AR_WEEKDAYS[i]
  return short ? EN_WEEKDAYS_SHORT[i] : EN_WEEKDAYS[i]
}

// "الاثنين 15 سبتمبر" / "Mon 15 Sep"
export const formatDayLabel = (iso, isArabic = true) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const w = weekdayName(dt.getDay(), isArabic, true)
  const month = isArabic
    ? dt.toLocaleDateString('ar-EG', { month: 'short' })
    : dt.toLocaleDateString('en-GB', { month: 'short' })
  return `${w} ${d} ${month}`
}

export const isToday = (iso) => iso === todayLocalISO()

// Which groups are scheduled on a given ISO date (from group_meta.day)
export const scheduledGroupsFor = (groupMeta, iso) => {
  const wd = weekdayOfISO(iso)
  return Object.entries(groupMeta || {})
    .filter(([, meta]) => meta && meta.day === wd)
    .map(([name]) => name)
}
