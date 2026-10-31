// ─── Arabic Helpers ──────────────────────────────────────────────────────────

export const WEEKDAY_NAMES = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
] as const

export const WEEKDAY_SHORT = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"] as const

/** Today's date as yyyy-mm-dd in local time (Africa/Cairo). */
export function todayStr(now: Date = new Date()): string {
  // Use local date components to avoid UTC off-by-one
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Weekday index 0..6 (0=Sunday). */
export function weekdayOf(dateStr: string): number {
  // parse as local date to avoid TZ shift
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** Parse a schedule-days JSON string into a number array. */
export function parseScheduleDays(s: string): number[] {
  try {
    const arr = JSON.parse(s)
    if (Array.isArray(arr)) return arr.filter((n) => typeof n === "number" && n >= 0 && n <= 6)
  } catch {}
  return []
}

/** Format an ISO date for display in Arabic (e.g. "الإثنين 18 أغسطس 2025"). */
export function formatArabicDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split("-").map(Number)
    const dt = new Date(y, m - 1, d)
    const wd = WEEKDAY_NAMES[dt.getDay()]
    const months = [
      "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
      "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
    ]
    return `${wd} ${d} ${months[m - 1]} ${y}`
  } catch {
    return dateStr
  }
}

/** Attendance status → Arabic label + icon hint. */
export const ATTENDANCE_LABEL: Record<string, string> = {
  present: "حاضر",
  absent: "غائب",
  late: "متأخر",
  excused: "بعذر",
}

export const ATTENDANCE_COLOR: Record<string, string> = {
  present: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400",
  absent: "text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400",
  late: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400",
  excused: "text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-400",
}

export const EXAM_STATUS_LABEL: Record<string, string> = {
  draft: "مسودة",
  published: "منشور",
  closed: "مغلق",
}

export const EXAM_RESULT_STATUS_LABEL: Record<string, string> = {
  pending: "لم يبدأ",
  submitted: "تم التسليم",
  graded: "تم التصحيح",
}

/** Compute a percentage with one decimal. */
export function pct(score: number, max: number): number {
  if (!max) return 0
  return Math.round((score / max) * 1000) / 10
}

/** Compute attendance summary for a student given attendance records. */
export function attendanceSummary(records: { status: string }[]) {
  let present = 0
  let absent = 0
  let late = 0
  let excused = 0
  for (const r of records) {
    if (r.status === "present") present++
    else if (r.status === "absent") absent++
    else if (r.status === "late") late++
    else if (r.status === "excused") excused++
  }
  const total = records.length
  return { present, absent, late, excused, total, rate: total ? Math.round((present / total) * 100) : 0 }
}

/** Determine warning status based on absences vs threshold. */
export function warningStatus(absent: number, threshold: number) {
  if (absent >= threshold) return { warn: true, label: "إنذار", level: absent >= threshold * 2 ? "danger" : "warning" }
  if (absent >= threshold - 1) return { warn: false, label: "قارب الإنذار", level: "notice" }
  return { warn: false, label: "طبيعي", level: "ok" }
}

/** Format a timestamp for Arabic display. */
export function timeAgo(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "الآن"
  if (mins < 60) return `منذ ${mins} دقيقة`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `منذ ${hrs} ساعة`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `منذ ${days} يوم`
  return formatArabicDate(todayStr(d))
}
