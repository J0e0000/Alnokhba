// ═══════════════════════════════════════════════════════════════════════════
// SMART INSIGHTS STORE — weekly analysis window (spec 5).
//
// The engine is pure and runs only inside فريق التحليل on demand. This module
// persists the generated report per teacher in localStorage and decides when
// the next analysis window is due:
//   - never ran            → due
//   - last run >= 7 days   → due
//   - otherwise            → show the already-generated insights only
// The header always communicates when analysis last ran and when the next
// window opens, so the schedule is transparent without any background work.
// ═══════════════════════════════════════════════════════════════════════════

export const ANALYSIS_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

const insightsKey = (teacherId) => `nokhba_insights_v1_${teacherId}`

export function loadInsightsReport(teacherId) {
  if (!teacherId) return null
  try {
    const raw = localStorage.getItem(insightsKey(teacherId))
    if (!raw) return null
    const report = JSON.parse(raw)
    if (!report || !Array.isArray(report.insights) || !report.meta?.generatedAt) return null
    return report
  } catch { return null }
}

export function saveInsightsReport(teacherId, report) {
  if (!teacherId || !report) return
  try {
    localStorage.setItem(insightsKey(teacherId), JSON.stringify(report))
  } catch { /* storage blocked — analysis still shown for this visit */ }
}

export function clearInsightsReport(teacherId) {
  try { if (teacherId) localStorage.removeItem(insightsKey(teacherId)) } catch { /* ignore */ }
}

/** Is a new analysis window due? (never ran → due) */
export function isAnalysisDue(report, now = new Date()) {
  if (!report?.meta?.generatedAt) return true
  const last = new Date(report.meta.generatedAt).getTime()
  if (!Number.isFinite(last)) return true
  return now.getTime() - last >= ANALYSIS_INTERVAL_MS
}

/** Human-friendly Arabic date/time for the header. */
export function formatAnalysisTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })
    + ' — '
    + d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' })
}
