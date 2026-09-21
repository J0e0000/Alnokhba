import { fetchFreshAnalysisData, saveWeeklyAnalysis } from './dbStore'
import { runInsightAnalysis } from './engine'
import { computeDomainMetrics, buildCurrentState, diffInsights } from './pipeline'

// ═══════════════════════════════════════════════════════════════════════════
// SHARED WEEKLY RUN (spec 8–14 unchanged) — ONE implementation of the weekly
// analysis pipeline, used by BOTH surfaces that may trigger it:
//   • InsightsReport (the فريق التحليل tab in Settings — on-demand re-run)
//   • InsightsNotifier (site-open window: runs when due, then notifies)
// Keeping the pipeline in one module guarantees the two surfaces store the
// SAME snapshot shape and the weekly due-window advances exactly once.
// ═══════════════════════════════════════════════════════════════════════════

// Normalizes an insights list into the {dedupe_key, evidence, ...} shape the
// lifecycle diff (diffInsights) expects — works with engine output rows and
// with stored DB rows alike.
export function openShape(list) {
  return (list || []).map((i) => ({
    dedupe_key: i.id || i.dedupe_key,
    evidence: { metrics: i.metrics || i.evidence?.metrics || {} },
    first_detected_at: i.firstDetectedAt || i.first_detected_at,
    dbId: i.dbId || i.id,
  }))
}

// Same input contract InsightsReport always used: cached store state, upgraded
// with fresh bounded pulls when the fresh payload has them.
export function buildInsightInputs(ws, fresh, now = new Date()) {
  return {
    students: ws.students,
    allAttendance: fresh?.attendance?.length ? fresh.attendance : (ws.allAttendance || []),
    lessonSessions: fresh?.sessions?.length ? fresh.sessions : (ws.lessonSessions || []),
    examScoresByStudent: ws.examScoresByStudent,
    exams: ws.examsList || [],
    settings: ws.settings,
    behaviorLogs: fresh?.behaviorLogs || [],
    now,
  }
}

/**
 * Full weekly pass: fresh pulls → engine → domains → lifecycle diff → save.
 * prevOpen/dismissedKeys come from the caller's remote state (dbStore).
 * Returns the same snapshot object InsightsReport keeps in `weekly`.
 */
export async function runWeeklyPipeline({ teacherId, ws, prevOpen = [], dismissedKeys = [] }) {
  const t0 = performance.now()
  const fresh = await fetchFreshAnalysisData(teacherId)
  const inputs = buildInsightInputs(ws, fresh)
  const computed = runInsightAnalysis(inputs)
  const domains = computeDomainMetrics(inputs)
  const currentState = buildCurrentState({ students: ws.students, domains, insights: computed.insights })
  const dismissedList = dismissedKeys instanceof Set ? [...dismissedKeys] : (dismissedKeys || [])
  const saved = await saveWeeklyAnalysis(teacherId, {
    computed,
    domains,
    currentState,
    period: { start: domains.periodStart, end: domains.periodEnd },
    durationMs: performance.now() - t0,
  }, prevOpen, dismissedList)
  const snapshot = saved?.snapshot || {
    report: {
      id: null,
      analysisType: 'weekly',
      periodStart: domains.periodStart,
      periodEnd: domains.periodEnd,
      generatedAt: new Date().toISOString(),
      summary: currentState.headline,
      situation: { domains, currentState },
      insights: diffInsights(prevOpen, computed.insights, dismissedList).upserts,
    },
    run: { id: null, runType: 'weekly', completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - t0), findingsTotal: computed.meta?.findingsTotal ?? 0, insightsTotal: computed.insights.length },
  }
  return snapshot
}
