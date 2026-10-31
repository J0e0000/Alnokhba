// ═══════════════════════════════════════════════════════════════════════════
// فريق التحليل — DB STORE (الذاكرة التحليلية الدائمة)
//
// Persists completed analyses (weekly + on-demand) to the analytics_* tables
// (migration_044) and applies the insight lifecycle on every weekly run.
//
// HARD RULES (spec 8/21/22/23):
//   - Only COMPLETED analysis is persisted — live operational data is never
//     cached here.
//   - Every function degrades gracefully: if the tables are not migrated yet
//     (or we're offline / demo mode), everything resolves to null/[] and the
//     area falls back to the localStorage mirror — the product keeps working
//     100% and the DB memory starts on its own once the migration runs.
//   - teacher_id ALWAYS comes from the session (auth-derived). No analytics
//     query accepts a teacher id from user input → no IDOR/BOLA surface.
//   - localStorage keeps only the same data class as the stored report
//     (aggregates + student ids/names the teacher already sees), never
//     credentials.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from '../../lib/supabaseClient'
import { diffInsights, CATEGORY_OF } from './pipeline'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const cacheKey = (teacherId) => `nokhba_insights_v2_${teacherId}`

// Which authoritative tables each insight category is derived from (spec 18).
export const SOURCES_OF = {
  attendance: ['attendance_records', 'lesson_sessions'],
  homework: ['attendance_records', 'lesson_sessions'],
  academic: ['exam_scores', 'exams'],
  behavior: ['students'],
  engagement: ['behavior_logs'],
}

const isoDate = (d) => new Date(d).toISOString().slice(0, 10)

export function analysisDue(lastGeneratedAt, now = new Date()) {
  if (!lastGeneratedAt) return true
  const t = new Date(lastGeneratedAt).getTime()
  if (!Number.isFinite(t)) return true
  return now.getTime() - t >= WEEK_MS
}

// ── localStorage mirror (fast first paint + offline) ────────────────────────
export function readLocalSnapshot(teacherId) {
  if (!teacherId) return null
  try {
    const raw = localStorage.getItem(cacheKey(teacherId))
    if (!raw) return null
    const snap = JSON.parse(raw)
    if (!snap || typeof snap !== 'object') return null
    return snap
  } catch { return null }
}

function writeLocalSnapshot(teacherId, patch) {
  if (!teacherId || !patch) return
  try {
    const next = { ...readLocalSnapshot(teacherId), ...patch, savedAt: new Date().toISOString() }
    localStorage.setItem(cacheKey(teacherId), JSON.stringify(next))
    // legacy v1 cache (pre-restructure) is superseded — clean it once
    try { localStorage.removeItem(`nokhba_insights_v1_${teacherId}`) } catch { /* ignore */ }
  } catch { /* storage blocked — DB memory still works */ }
}

// ── DB row ⇄ UI shape ───────────────────────────────────────────────────────
function rowToInsight(row) {
  if (!row) return null
  const ev = row.evidence || {}
  const meta = row.metadata || {}
  return {
    id: row.dedupe_key,
    dbId: row.id,
    type: meta.type || row.category,
    category: row.category,
    group: meta.group ?? null,
    severity: row.severity,
    title: row.title,
    lines: Array.isArray(row.description) ? row.description : [],
    action: row.impact || '',
    students: Array.isArray(ev.students) ? ev.students : [],
    metrics: ev.metrics || {},
    reasons: Array.isArray(ev.reasons) ? ev.reasons : [],
    sources: Array.isArray(ev.sources) ? ev.sources : [],
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    firstDetectedAt: row.first_detected_at,
    lastUpdatedAt: row.last_updated_at,
  }
}

function insightToRowFields(ins, { teacherId, runId, reportId, periodStart, periodEnd }) {
  const category = CATEGORY_OF[ins.type] || 'behavior'
  return {
    teacher_id: teacherId,
    run_id: runId,
    report_id: reportId,
    dedupe_key: ins.id,
    category,
    title: ins.title,
    description: ins.lines || [],
    evidence: {
      metrics: ins.metrics || {},
      reasons: ins.reasons || [],
      students: ins.students || [],
      sources: SOURCES_OF[category] || [],
      period: { start: periodStart, end: periodEnd },
    },
    impact: ins.action || '',
    severity: ins.severity || 'watch',
    status: ins.status || 'new',
    period_start: periodStart,
    period_end: periodEnd,
    last_updated_at: new Date().toISOString(),
    metadata: { type: ins.type, group: ins.group ?? null },
  }
}

function reportToSnapshot(report, insights, run) {
  return {
    report: {
      id: report?.id || null,
      analysisType: report?.analysis_type || run?.run_type || 'weekly',
      periodStart: report?.period_start,
      periodEnd: report?.period_end,
      generatedAt: report?.generated_at || run?.completed_at,
      summary: report?.summary || '',
      situation: report?.situation || {},
      insights: (insights || []).map(rowToInsight).filter(Boolean),
    },
    run: run
      ? { id: run.id, runType: run.run_type, completedAt: run.completed_at, durationMs: run.duration_ms, findingsTotal: run.findings_total, insightsTotal: run.insights_total }
      : null,
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Full remote state (all-or-nothing graceful): latest weekly snapshot, open
 *  insights and recent history. Resolves null when DB is unavailable. */
export async function fetchRemoteState(teacherId) {
  if (!teacherId) return null
  try {
    const [runsRes, openRes] = await Promise.all([
      supabase.from('analytics_runs')
        .select('*')
        .eq('teacher_id', teacherId)
        .eq('run_type', 'weekly')
        .order('completed_at', { ascending: false })
        .limit(10),
      supabase.from('analytics_insights')
        .select('*')
        .eq('teacher_id', teacherId)
        .in('status', ['new', 'ongoing', 'worsening', 'improving'])
        .order('last_updated_at', { ascending: false })
        .limit(100),
    ])
    if (runsRes.error || openRes.error) return null
    const runs = runsRes.data || []
    const openRows = openRes.data || []

    // dismissed keys (spec 11 DISMISSED): never re-announced by the weekly run
    let dismissedKeys = []
    try {
      const disRes = await supabase.from('analytics_insights')
        .select('dedupe_key')
        .eq('teacher_id', teacherId)
        .eq('status', 'dismissed')
        .limit(200)
      if (!disRes.error) dismissedKeys = (disRes.data || []).map((r) => r.dedupe_key).filter(Boolean)
    } catch { /* suppression list is best-effort */ }

    let latestWeekly = null
    const history = []
    if (runs.length) {
      const reportIds = runs.map((r) => r.id)
      const reportsRes = await supabase.from('analytics_reports')
        .select('*')
        .eq('teacher_id', teacherId)
        .in('run_id', reportIds)
        .order('generated_at', { ascending: false })
      const reports = reportsRes.error ? [] : (reportsRes.data || [])
      const reportByRun = new Map(reports.map((r) => [r.run_id, r]))

      // insights for the visible reports (latest + history entries)
      const reportIdList = reports.map((r) => r.id)
      let insightsByReport = new Map()
      if (reportIdList.length) {
        const insRes = await supabase.from('analytics_insights')
          .select('*')
          .eq('teacher_id', teacherId)
          .in('report_id', reportIdList)
          .order('last_updated_at', { ascending: false })
        if (!insRes.error) {
          insightsByReport = new Map()
          for (const row of insRes.data || []) {
            if (!insightsByReport.has(row.report_id)) insightsByReport.set(row.report_id, [])
            insightsByReport.get(row.report_id).push(row)
          }
        }
      }

      for (const run of runs) {
        const report = reportByRun.get(run.id)
        history.push(reportToSnapshot(report, insightsByReport.get(report?.id) || [], run))
      }
      const latestRun = runs[0]
      const latestReport = reportByRun.get(latestRun.id)
      if (latestReport) {
        latestWeekly = reportToSnapshot(latestReport, insightsByReport.get(latestReport.id) || [], latestRun)
      }
    }

    return { latestWeekly, openInsights: openRows.map(rowToInsight).filter(Boolean), history, dismissedKeys }
  } catch {
    return null
  }
}

/** One historical report with its insights (الفترة selector / التاريخ). */
export async function fetchReportSnapshot(teacherId, reportId) {
  if (!teacherId || !reportId) return null
  try {
    const [repRes, insRes] = await Promise.all([
      supabase.from('analytics_reports').select('*').eq('teacher_id', teacherId).eq('id', reportId).maybeSingle(),
      supabase.from('analytics_insights').select('*').eq('teacher_id', teacherId).eq('report_id', reportId).order('last_updated_at', { ascending: false }),
    ])
    if (repRes.error || !repRes.data) return null
    return reportToSnapshot(repRes.data, insRes.error ? [] : (insRes.data || []), null)
  } catch {
    return null
  }
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Persist a completed WEEKLY analysis and apply the lifecycle.
 * payload: { computed (engine output), domains, currentState, period,
 *            durationMs, meta }
 * previousOpen: open insight rows (UI shape ok — needs dedupe_key + evidence
 *               + first_detected_at) fetched BEFORE this run.
 * Returns the stored snapshot (DB ids) or null if the DB write failed —
 * the caller still keeps its in-memory result either way.
 */
export async function saveWeeklyAnalysis(teacherId, payload, previousOpen = [], dismissedKeys = []) {
  if (!teacherId || !payload?.computed) return null
  const startedAt = new Date()
  const periodStart = payload.period?.start || isoDate(startedAt.getTime() - 28 * 24 * 60 * 60 * 1000)
  const periodEnd = payload.period?.end || isoDate(startedAt)
  try {
    const { computed } = payload
    const { upserts, resolvedKeys } = diffInsights(previousOpen, computed.insights, dismissedKeys)

    const runRow = {
      teacher_id: teacherId,
      run_type: 'weekly',
      status: 'completed',
      period_start: periodStart,
      period_end: periodEnd,
      started_at: startedAt.toISOString(),
      completed_at: startedAt.toISOString(),
      duration_ms: Math.max(0, Math.round(payload.durationMs || 0)),
      findings_total: computed.meta?.findingsTotal ?? 0,
      insights_total: upserts.length,
      meta: { windowDays: computed.meta?.windowDays, studentsAnalyzed: computed.meta?.studentsAnalyzed, ...payload.meta },
    }
    const runRes = await supabase.from('analytics_runs').insert(runRow).select().single()
    if (runRes.error || !runRes.data) return null
    const run = runRes.data

    const reportRow = {
      run_id: run.id,
      teacher_id: teacherId,
      analysis_type: 'weekly',
      period_start: periodStart,
      period_end: periodEnd,
      generated_at: startedAt.toISOString(),
      summary: payload.currentState?.headline || '',
      situation: { domains: payload.domains || {}, currentState: payload.currentState || {} },
      metadata: { findingsTotal: computed.meta?.findingsTotal ?? 0, insightsTotal: upserts.length, config: computed.meta?.config || null },
    }
    const repRes = await supabase.from('analytics_reports').insert(reportRow).select().single()
    if (repRes.error || !repRes.data) return null
    const report = repRes.data

    // lifecycle writes — .select() returns ids so dismiss works immediately
    const newOnes = upserts.filter((u) => u.status === 'new')
    const updatedOnes = upserts.filter((u) => u.status !== 'new')
    const idByKey = new Map()
    if (newOnes.length) {
      const insRes = await supabase.from('analytics_insights').insert(
        newOnes.map((ins) => insightToRowFields(ins, { teacherId, runId: run.id, reportId: report.id, periodStart, periodEnd })),
      ).select('id, dedupe_key')
      if (!insRes.error) {
        for (const row of insRes.data || []) idByKey.set(row.dedupe_key, row.id)
      }
    }
    for (const ins of updatedOnes) {
      if (!ins.dbId) continue
      await supabase.from('analytics_insights').update(
        insightToRowFields(ins, { teacherId, runId: run.id, reportId: report.id, periodStart, periodEnd }),
      ).eq('id', ins.dbId).eq('teacher_id', teacherId)
    }
    for (const key of resolvedKeys) {
      const prev = previousOpen.find((p) => p.dedupe_key === key || p.id === key)
      const dbId = prev?.dbId || prev?.id
      if (!dbId) continue
      await supabase.from('analytics_insights').update({
        status: 'resolved',
        resolved_at: startedAt.toISOString(),
        last_updated_at: startedAt.toISOString(),
      }).eq('id', dbId).eq('teacher_id', teacherId)
    }

    const snapshot = {
      report: {
        id: report.id,
        analysisType: 'weekly',
        periodStart,
        periodEnd,
        generatedAt: report.generated_at,
        summary: reportRow.summary,
        situation: reportRow.situation,
        insights: upserts.map((ins) => ({ ...ins, periodStart, periodEnd, dbId: ins.dbId || idByKey.get(ins.id) || null })),
      },
      run: { id: run.id, runType: 'weekly', completedAt: run.completed_at, durationMs: run.duration_ms, findingsTotal: run.findings_total, insightsTotal: run.insights_total },
    }
    writeLocalSnapshot(teacherId, { weekly: snapshot })
    return { snapshot, upserts, resolvedKeys }
  } catch {
    return null
  }
}

/**
 * Persist an ON-DEMAND «استنتج المستوى الحالي» run (spec 12-14): a focused
 * current-state report — no lifecycle writes, weekly report untouched.
 */
export async function saveOnDemandAnalysis(teacherId, payload) {
  if (!teacherId || !payload?.currentState) return null
  const startedAt = new Date()
  const periodStart = payload.period?.start || isoDate(startedAt.getTime() - 28 * 24 * 60 * 60 * 1000)
  const periodEnd = payload.period?.end || isoDate(startedAt)
  try {
    const runRes = await supabase.from('analytics_runs').insert({
      teacher_id: teacherId,
      run_type: 'on_demand',
      status: 'completed',
      period_start: periodStart,
      period_end: periodEnd,
      started_at: startedAt.toISOString(),
      completed_at: startedAt.toISOString(),
      duration_ms: Math.max(0, Math.round(payload.durationMs || 0)),
      findings_total: payload.computed?.meta?.findingsTotal ?? 0,
      insights_total: 0,
      meta: { trigger: 'button', ...payload.meta },
    }).select().single()
    if (runRes.error || !runRes.data) return null
    const run = runRes.data

    const repRes = await supabase.from('analytics_reports').insert({
      run_id: run.id,
      teacher_id: teacherId,
      analysis_type: 'on_demand',
      period_start: periodStart,
      period_end: periodEnd,
      generated_at: startedAt.toISOString(),
      summary: payload.currentState.headline || '',
      situation: { domains: payload.domains || {}, currentState: payload.currentState || {} },
      metadata: { studentsAnalyzed: payload.computed?.meta?.studentsAnalyzed ?? null },
    }).select().single()
    if (repRes.error || !repRes.data) return null
    const report = repRes.data

    const snapshot = {
      report: {
        id: report.id,
        analysisType: 'on_demand',
        periodStart,
        periodEnd,
        generatedAt: report.generated_at,
        summary: report.summary,
        situation: report.situation,
        insights: [],
      },
      run: { id: run.id, runType: 'on_demand', completedAt: run.completed_at, durationMs: run.duration_ms },
    }
    writeLocalSnapshot(teacherId, { onDemand: snapshot })
    return snapshot
  } catch {
    return null
  }
}

/** Teacher decision (spec 11 DISMISSED) — soft removal from the open list. */
export async function dismissInsight(teacherId, insightDbId) {
  if (!teacherId || !insightDbId) return false
  try {
    const now = new Date().toISOString()
    const { error } = await supabase.from('analytics_insights')
      .update({ status: 'dismissed', resolved_at: now, last_updated_at: now })
      .eq('id', insightDbId)
      .eq('teacher_id', teacherId)
    return !error
  } catch {
    return false
  }
}

/** Fresh targeted pulls for on-demand analysis (spec 24): minimal fields,
 *  bounded ranges, existing filter patterns — never the whole database.
 *  Default range = 2 full analysis windows (56d) so the engine's current-vs-
 *  previous comparison still works on fresh data alone. */
export async function fetchFreshAnalysisData(teacherId, sinceISO) {
  if (!teacherId) return null
  try {
    const since = sinceISO || new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString()
    const [attRes, sessRes, logsRes] = await Promise.all([
      supabase.from('attendance_records')
        .select('student_id, status, homework_status, lesson_session_id, attendance_date, recorded_at')
        .eq('teacher_id', teacherId)
        .gte('recorded_at', since)
        .limit(5000),
      supabase.from('lesson_sessions')
        .select('id, group_name, session_date, status')
        .eq('teacher_id', teacherId)
        .gte('session_date', since.slice(0, 10))
        .limit(300),
      supabase.from('behavior_logs')
        .select('student_id, points_delta, created_at')
        .eq('teacher_id', teacherId)
        .gte('created_at', since)
        .limit(400),
    ])
    // each stream degrades independently — partial data still analyzes
    return {
      attendance: attRes.error ? [] : (attRes.data || []),
      sessions: sessRes.error ? [] : (sessRes.data || []),
      behaviorLogs: logsRes.error ? [] : (logsRes.data || []),
    }
  } catch {
    return null
  }
}

export const ANALYSIS_WEEK_MS = WEEK_MS
