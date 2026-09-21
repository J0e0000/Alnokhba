import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { runInsightAnalysis } from '../lib/insights/engine'
import { computeDomainMetrics, buildCurrentState, diffInsights } from '../lib/insights/pipeline'
import { weekStart } from '../lib/week'
import {
  readLocalSnapshot, fetchRemoteState, fetchFreshAnalysisData,
  saveWeeklyAnalysis, saveOnDemandAnalysis, fetchReportSnapshot, dismissInsight,
  analysisDue, ANALYSIS_WEEK_MS,
} from '../lib/insights/dbStore'
import { downloadCSV, localDateStr } from '../lib/csv'

// PERF: chart.js stays a lazy chunk (only when the academic domain expands).
const Charts = lazy(() => import('../components/Charts'))
const ChartsFallback = () => <div className="rounded-2xl border border-subtle p-6 text-center text-fg-subtle text-sm">…</div>

// ═══════════════════════════════════════════════════════════════════════════
// فريق التحليل — the restructured analytics product (spec 16).
//
// ONE dedicated destination (account menu → فريق التحليل). Structure:
//   الحالة الحالية → أهم الاستنتاجات → التقرير الأسبوعي → المجالات
//   → أدوات متقدمة (collapsed) → التاريخ التحليلي
//
// Two DIFFERENT analysis systems (spec 12–14):
//   WEEKLY    — lazy scheduled window (once per 7 days, auto on open when
//               due): full engine + materiality + insight lifecycle, stored
//               in analytics_* (migration_044) with a localStorage mirror.
//   ON-DEMAND — «استنتج المستوى الحالي» button: fresh targeted pulls
//               (bounded ranges, minimal fields), domains + current-state
//               narrative only. Never regenerates the weekly system.
//
// The page READS stored results; heavy computation happens only inside the
// weekly window or on an explicit button press (spec 21/22). No dashboard
// grids, no decorative charts — every number shown answers a question.
// ═══════════════════════════════════════════════════════════════════════════

const SEVERITY_STYLE = {
  'needs-attention': { border: 'var(--warn, #f59e0b)', label: 'محتاجة انتباه' },
  watch: { border: 'var(--accent-blue, #60a5fa)', label: 'للمتابعة' },
}
// spec 11: lifecycle shown subtly — ongoing stays unlabeled
const STATUS_BADGE = {
  new: { label: 'جديد', bg: 'rgba(96,165,250,.14)' },
  worsening: { label: 'بيسوء', bg: 'rgba(239,68,68,.14)' },
  improving: { label: 'بيتحسن', bg: 'rgba(34,197,94,.14)' },
}
// spec 18: provenance in plain Arabic (inside the «ليه بنقول ده؟» disclosure)
const SOURCE_LABEL = {
  attendance_records: 'سجل الحضور',
  lesson_sessions: 'الحصص',
  exam_scores: 'درجات الامتحانات',
  exams: 'الامتحانات',
  students: 'ملفات الطلاب',
  behavior_logs: 'ملاحظات السلوك',
}
const pctText = (x) => `${Math.round((Number(x) || 0) * 100)}%`
const arNum = (n) => String(n)

function formatWhen(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })
    + ' — '
    + d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' })
}

function openShape(list) {
  return (list || []).map((i) => ({
    dedupe_key: i.id || i.dedupe_key,
    evidence: { metrics: i.metrics || i.evidence?.metrics || {} },
    first_detected_at: i.firstDetectedAt || i.first_detected_at,
    dbId: i.dbId || i.id,
  }))
}

// ── small presentational bits ───────────────────────────────────────────────

function InsightCard({ ins, onDismiss, canDismiss }) {
  const ui = useUI()
  const [openWhy, setOpenWhy] = useState(false)
  const style = SEVERITY_STYLE[ins.severity] || SEVERITY_STYLE.watch
  const badge = STATUS_BADGE[ins.status]
  const sources = ins.sources || ins.evidence?.sources || []
  return (
    <article className="glass-card p-4" style={{ borderInlineStart: `4px solid ${style.border}` }}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <b className="text-[.86rem]">{ins.title}</b>
        {badge && (
          <span className="nk-pill !text-[.6rem]" style={{ background: badge.bg, color: style.border, border: `1px solid ${style.border}` }}>
            {badge.label}
          </span>
        )}
        <span
          className="nk-pill !text-[.6rem]"
          style={{ background: 'var(--surface-container-high)', color: style.border, border: `1px solid ${style.border}` }}
        >
          {style.label}
        </span>
      </div>
      {(ins.lines || []).map((line, i) => (
        <p key={i} className="text-[.76rem] text-fg-muted m-0 mb-1.5 leading-6">{line}</p>
      ))}
      {ins.students?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 my-2">
          {ins.students.map((s) => (
            <button
              key={s.id}
              className="nk-pill nk-pill-neutral cursor-pointer"
              onClick={() => s.id && ui.openStudentHistory(s.id)}
              title={s.id ? 'فتح ملف الطالب' : undefined}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {ins.action && (
        <p className="text-[.74rem] m-0 mt-2 font-bold" style={{ color: 'var(--fg)' }}>
          اقتراح: {ins.action}
        </p>
      )}
      {/* Progressive disclosure (spec 28): the materiality evidence stays one
          tap away, never shouted by default. */}
      {((ins.reasons?.length) || sources.length > 0) && (
        <div className="mt-2">
          <button
            type="button"
            className="text-[.68rem] font-extrabold underline decoration-dotted"
            style={{ color: 'var(--fg-muted)' }}
            onClick={() => setOpenWhy((v) => !v)}
          >
            {openWhy ? 'إخفاء التفسير' : 'ليه بنقول ده؟'}
          </button>
          {openWhy && (
            <div className="mt-2 rounded-xl p-3" style={{ background: 'var(--surface-container)' }}>
              <ul className="m-0 pe-4 text-[.7rem] leading-6 text-fg-muted">
                {(ins.reasons || []).map((r, i) => <li key={i}>{r}</li>)}
                {ins.periodStart && <li>فترة التحليل: {ins.periodStart} ← {ins.periodEnd}</li>}
                {sources.length > 0 && (
                  <li>
                    المصدر: {sources.map((s) => SOURCE_LABEL[s] || s).join('، ')} — نفس البيانات اللي بيرصدها النظام، مفيش تقديرات.
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
      {canDismiss && ins.dbId && (
        <button
          type="button"
          className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.66rem] font-bold mt-2"
          onClick={() => onDismiss(ins)}
        >
          مش مهم دلوقتي
        </button>
      )}
    </article>
  )
}

function AttendanceBars({ weekly }) {
  if (!Array.isArray(weekly) || !weekly.length) return null
  return (
    <div className="flex items-end gap-1.5" dir="rtl" title="نسبة الغياب أسبوع بأسبوع (الجمعة ← الخميس)">
      {weekly.map((w) => (
        <div key={w.weekStart} className="flex flex-col items-center gap-1">
          <div
            className="rounded-t-md"
            style={{
              width: 10,
              height: `${Math.max(4, (w.rate || 0) * 0.36)}px`,
              background: w.rate == null ? 'var(--surface-container-high)' : (w.rate >= 30 ? 'var(--warn, #f59e0b)' : 'var(--accent-blue, #60a5fa)'),
            }}
            title={w.rate == null ? 'أسبوع بدون رصد كفاية' : `الغياب ${w.rate}% — أسبوع ${w.weekStart}`}
          />
          <span className="text-[.52rem] text-fg-subtle">{w.rate == null ? '—' : w.rate}</span>
        </div>
      ))}
    </div>
  )
}

function DomainRow({ label, value, delta, positiveIsGood = true, children }) {
  const badColor = 'var(--danger, #ef4444)'
  const goodColor = 'var(--ok, #22c55e)'
  const deltaStyle = delta == null || delta === 0
    ? { color: 'var(--fg-muted)' }
    : (delta > 0) === positiveIsGood ? { color: goodColor } : { color: badColor }
  const deltaText = delta == null
    ? ''
    : delta === 0
      ? 'زي ما هو'
      : `${delta > 0 ? '+' : ''}${delta}`
  return (
    <div className="rounded-2xl px-3.5 py-3" style={{ border: '1px solid var(--surface-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[.74rem] font-extrabold">{label}</span>
        <span className="flex items-center gap-2 text-[.72rem]">
          <b>{value}</b>
          {deltaText && <small className="font-bold" style={deltaStyle}>{deltaText}</small>}
        </span>
      </div>
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN — فريق التحليل
// ═══════════════════════════════════════════════════════════════════════════
export default function InsightsArea() {
  const ws = useWorkspace()
  const ui = useUI()
  const teacherId = ws.effectiveTeacherId

  const [weekly, setWeekly] = useState(() => readLocalSnapshot(teacherId)?.weekly || null)
  const [onDemand, setOnDemand] = useState(() => readLocalSnapshot(teacherId)?.onDemand || null)
  const [openInsights, setOpenInsights] = useState([])
  const [historyList, setHistoryList] = useState([])
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set())
  const [viewSnap, setViewSnap] = useState(null) // الفترة: an older report is being viewed
  const [dbReady, setDbReady] = useState(null) // null=unknown · true=DB memory on · false=local-only
  const [running, setRunning] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeDoneAt, setProbeDoneAt] = useState('')
  const autoRanRef = useRef(false)
  const remoteRef = useRef(null)

  // localStorage cache lands with the teacher id (first paint, offline-safe)
  useEffect(() => {
    if (!teacherId) return
    const snap = readLocalSnapshot(teacherId)
    if (snap?.weekly) setWeekly((cur) => cur || snap.weekly)
    if (snap?.onDemand) setOnDemand((cur) => cur || snap.onDemand)
  }, [teacherId])

  // DB reconciliation (spec 10): stored analytical memory wins over the cache
  useEffect(() => {
    if (!teacherId) return undefined
    let alive = true
    fetchRemoteState(teacherId).then((remote) => {
      if (!alive) return
      if (!remote) { setDbReady(false); return }
      setDbReady(true)
      remoteRef.current = remote
      if (remote.latestWeekly) setWeekly(remote.latestWeekly)
      if (remote.history?.length) setHistoryList(remote.history)
      setOpenInsights(remote.openInsights || [])
      setDismissedKeys(new Set(remote.dismissedKeys || []))
    }).catch(() => { if (alive) setDbReady(false) })
    return () => { alive = false }
  }, [teacherId])

  const buildInputs = useCallback((fresh) => ({
    students: ws.students,
    allAttendance: fresh?.attendance?.length ? fresh.attendance : (ws.allAttendance || []),
    lessonSessions: fresh?.sessions?.length ? fresh.sessions : (ws.lessonSessions || []),
    examScoresByStudent: ws.examScoresByStudent,
    settings: ws.settings,
    behaviorLogs: fresh?.behaviorLogs || [],
    now: new Date(),
  }), [ws.students, ws.allAttendance, ws.lessonSessions, ws.examScoresByStudent, ws.settings])

  // ── WEEKLY (spec 8/14): full pipeline + lifecycle + storage ────────────────
  const analyzeWeekly = useCallback(async () => {
    setRunning(true)
    try {
      const t0 = performance.now()
      const fresh = await fetchFreshAnalysisData(teacherId)
      const inputs = buildInputs(fresh)
      const computed = runInsightAnalysis(inputs)
      const domains = computeDomainMetrics(inputs)
      const currentState = buildCurrentState({ students: ws.students, domains, insights: computed.insights })
      const prevOpen = openShape(remoteRef.current?.openInsights || [])
      const dismissedList = [...dismissedKeys]
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
      setWeekly(snapshot)
      setViewSnap(null)
      setOpenInsights(snapshot.report.insights.filter((i) => i.status !== 'resolved'))
    } finally {
      setRunning(false)
    }
  }, [teacherId, buildInputs, ws.students, dismissedKeys])

  // Weekly window: auto-run ONCE per mount when due (never during render)
  useEffect(() => {
    if (ws.loading || autoRanRef.current || !teacherId) return
    autoRanRef.current = true
    const lastAt = remoteRef.current?.latestWeekly?.report?.generatedAt || weekly?.report?.generatedAt
    if (analysisDue(lastAt)) analyzeWeekly()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.loading, teacherId])

  // ── ON-DEMAND (spec 12-14): fresh, focused, current state only ────────────
  const runOnDemand = useCallback(async () => {
    setProbing(true)
    try {
      const t0 = performance.now()
      const fresh = await fetchFreshAnalysisData(teacherId)
      const domains = computeDomainMetrics({
        students: ws.students,
        allAttendance: fresh?.attendance?.length ? fresh.attendance : (ws.allAttendance || []),
        lessonSessions: fresh?.sessions?.length ? fresh.sessions : (ws.lessonSessions || []),
        examScoresByStudent: ws.examScoresByStudent,
        behaviorLogs: fresh?.behaviorLogs || [],
        now: new Date(),
      })
      const currentState = buildCurrentState({ students: ws.students, domains, insights: openInsights })
      const saved = await saveOnDemandAnalysis(teacherId, {
        domains,
        currentState,
        computed: { meta: { studentsAnalyzed: ws.students.length, findingsTotal: 0 } },
        period: { start: domains.periodStart, end: domains.periodEnd },
        durationMs: performance.now() - t0,
      })
      const snapshot = saved || {
        report: {
          id: null, analysisType: 'on_demand', periodStart: domains.periodStart, periodEnd: domains.periodEnd,
          generatedAt: new Date().toISOString(), summary: currentState.headline,
          situation: { domains, currentState }, insights: [],
        },
        run: { id: null, runType: 'on_demand', completedAt: new Date().toISOString() },
      }
      setOnDemand(snapshot)
      setProbeDoneAt(snapshot.report.generatedAt)
    } finally {
      setProbing(false)
    }
  }, [teacherId, ws.students, ws.allAttendance, ws.lessonSessions, ws.examScoresByStudent, openInsights])

  const handleDismiss = useCallback(async (ins) => {
    setOpenInsights((cur) => cur.filter((i) => i.dbId !== ins.dbId))
    setDismissedKeys((cur) => new Set(cur).add(ins.id))
    if (ins.dbId) await dismissInsight(teacherId, ins.dbId)
  }, [teacherId])

  const openReportFromHistory = useCallback(async (snap) => {
    if (snap?.report?.id) {
      const full = await fetchReportSnapshot(teacherId, snap.report.id)
      setViewSnap(full || snap)
    } else {
      setViewSnap(snap)
    }
    try { document.getElementById('nk-weekly-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* ignore */ }
  }, [teacherId])

  // ── derived ────────────────────────────────────────────────────────────────
  const currentCard = useMemo(() => {
    const wT = weekly?.report?.generatedAt ? new Date(weekly.report.generatedAt).getTime() : 0
    const oT = onDemand?.report?.generatedAt ? new Date(onDemand.report.generatedAt).getTime() : 0
    return oT >= wT ? onDemand : weekly
  }, [weekly, onDemand])
  const currentSituation = currentCard?.report?.situation || {}
  const currentState = currentSituation.currentState || null
  const domains = currentSituation.domains || null
  const reportView = viewSnap || weekly
  const lastRun = weekly?.report?.generatedAt || ''
  const due = analysisDue(lastRun)
  const nextRun = lastRun
    ? formatWhen(new Date(new Date(lastRun).getTime() + ANALYSIS_WEEK_MS).toISOString())
    : ''

  // ── advanced tools (preserved from the retired analytics dashboard) ───────
  const [periodDays, setPeriodDays] = useState(30)
  const sinceDate = useMemo(
    () => (periodDays === 'week' ? weekStart(new Date()) : periodDays ? new Date(Date.now() - periodDays * 86400000) : null),
    [periodDays],
  )
  const sinceStr = useMemo(() => (sinceDate ? localDateStr(sinceDate) : null), [sinceDate])
  const periodRows = useMemo(() => ws.students.map((s) => {
    const records = (ws.allAttendance || []).filter((r) => {
      if (r.student_id !== s.id) return false
      if (sinceStr && String(r.attendance_date || '') < sinceStr) return false
      return true
    })
    const recorded = records.filter((r) => r.status === 'حاضر' || r.status === 'غائب')
    const present = records.filter((r) => r.status === 'حاضر').length
    const attPct = recorded.length ? Math.round((present / recorded.length) * 100) : null
    const exams = (ws.examScoresByStudent[s.id] || []).filter((ex) => {
      const created = ex.created_at ? new Date(ex.created_at) : null
      return !(sinceDate && created && created < sinceDate)
    })
    let earned = 0, max = 0
    exams.forEach((ex) => {
      earned += ex.total_score || 0
      max += (ex.max_score_per_section || 0) * Object.keys(ex.section_scores || {}).length
    })
    const examPct = max ? Math.round((earned / max) * 100) : null
    return { student: s, attPct, examPct, examCount: exams.length, points: s.points || 0 }
  }), [ws.students, ws.allAttendance, ws.examScoresByStudent, sinceDate, sinceStr])

  // 90-day exam trend for the academic chart (supporting evidence only)
  const examDatesMap90 = useMemo(() => {
    const cutoff = Date.now() - 90 * 86400000
    const map = {}
    ws.students.forEach((s) => {
      ;(ws.examScoresByStudent[s.id] || []).forEach((ex) => {
        const created = ex.created_at ? new Date(ex.created_at) : null
        if (!created || created.getTime() < cutoff) return
        const max = (ex.max_score_per_section || 0) * Object.keys(ex.section_scores || {}).length
        const day = localDateStr(created)
        if (!map[day]) map[day] = { earned: 0, max: 0 }
        map[day].earned += ex.total_score || 0
        map[day].max += max
      })
    })
    const ordered = {}
    Object.keys(map).sort((a, b) => a.localeCompare(b)).forEach((k) => { ordered[k] = map[k] })
    return ordered
  }, [ws.students, ws.examScoresByStudent])

  const exportCSV = () => {
    const headers = ['الاسم', 'الكود', 'المجموعة', 'الحضور %', 'متوسط الامتحانات %', 'عدد الامتحانات', 'النقاط']
    const rows = periodRows.map((r) => [
      r.student.name, r.student.code || '', r.student.group_name || '',
      r.attPct === null ? '—' : `${r.attPct}%`,
      r.examPct === null ? '—' : `${r.examPct}%`,
      r.examCount, r.points,
    ])
    const label = periodDays === 'week' ? 'this_week_fri_thu' : periodDays ? `last_${periodDays}_days` : 'all_time'
    downloadCSV(`analytics_${label}_${localDateStr()}.csv`, headers, rows)
    ws.showToast?.('تم تحميل ملف CSV ✓', 'success')
  }

  const periodLabel = periodDays === 'week' ? 'هذا الأسبوع (الجمعة ← الخميس)' : periodDays === 30 ? 'آخر ٣٠ يوم' : periodDays === 90 ? 'آخر ٩٠ يوم' : 'كل الفترات'
  const academicD = domains?.academic
  const attendanceD = domains?.attendance
  const homeworkD = domains?.homework
  const operationsD = domains?.operations
  const engagementD = domains?.engagement

  return (
    <div>
      {/* ── header + primary action (spec 16/28: one primary action) ── */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <h1 className="text-lg font-black m-0">فريق التحليل</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="rounded-xl px-3.5 py-2 text-[.72rem] font-extrabold disabled:opacity-50"
            style={{ background: 'var(--brand-navy, #142D62)', color: '#fff' }}
            onClick={runOnDemand}
            disabled={probing || ws.loading}
          >
            {probing ? 'جاري تحليل البيانات الحالية...' : 'استنتج المستوى الحالي'}
          </button>
          {historyList.length > 0 && (
            <select
              className="btn-ghost rounded-xl px-2.5 py-2 text-[.7rem] font-extrabold"
              value={viewSnap?.report?.id || ''}
              onChange={(e) => {
                const id = e.target.value
                if (!id) { setViewSnap(null); return }
                const snap = historyList.find((h) => h.report?.id === id)
                if (snap) openReportFromHistory(snap)
              }}
              aria-label="الفترة"
            >
              <option value="">الفترة: آخر تقرير</option>
              {historyList.map((h) => (
                <option key={h.report.id} value={h.report.id}>
                  {formatWhen(h.report.generatedAt)}{h.report.analysisType === 'on_demand' ? ' (لحظي)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <p className="text-[.74rem] text-fg-muted mb-4">
        ملخص وتحليل مبني على بيانات النخبة وتقاريرها — بنقولك اللي اتغيّر، ولو الموضوع يستاهل انتباهك ولا لأ.
      </p>

      {/* ── schedule strip (transparent weekly window, spec 8) ── */}
      <div className="glass-card p-4 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[.72rem] text-fg-muted">
          {lastRun
            ? <>آخر تحليل أسبوعي: <b className="text-fg">{formatWhen(lastRun)}</b></>
            : 'لسه مفيش تحليل أسبوعي — هيتشغل تلقائي أول ما البيانات تبقى جاهزة.'}
        </span>
        {lastRun && !due && <span className="text-[.72rem] text-fg-muted">التحليل الجاي: <b className="text-fg">{nextRun}</b></span>}
        <button
          type="button"
          className="btn-ghost rounded-xl px-3.5 py-2 text-[.72rem] font-extrabold ms-auto"
          onClick={analyzeWeekly}
          disabled={running || ws.loading}
        >
          {running ? '... الفريق بيحلل' : due ? 'شغّل التحليل الأسبوعي' : 'تحليل جديد الآن'}
        </button>
      </div>

      {probing && <p className="text-[.72rem] text-fg-muted mb-3">جاري تحليل البيانات الحالية…</p>}
      {probeDoneAt && !probing && (
        <p className="text-[.72rem] mb-3 font-bold" style={{ color: 'var(--ok, #22c55e)' }}>
          تم تحديث التحليل ✓ — {formatWhen(probeDoneAt)}
        </p>
      )}

      {/* ── الحالة الحالية (spec 15) ── */}
      <section className="glass-card p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h2 className="text-[.85rem] font-extrabold m-0">الحالة الحالية</h2>
          {currentCard?.report?.generatedAt && (
            <small className="text-[.62rem] text-fg-subtle">
              {currentCard.report.analysisType === 'on_demand' ? 'استنتاج لحظي' : 'من التقرير الأسبوعي'} · {formatWhen(currentCard.report.generatedAt)}
            </small>
          )}
        </div>
        {currentState ? (
          <>
            <p className="text-[.84rem] font-bold m-0 mb-2">{currentState.headline}</p>
            <ul className="m-0 pe-4 text-[.73rem] leading-6 text-fg-muted">
              {(currentState.bullets || []).map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </>
        ) : ws.loading ? (
          <p className="text-sm text-fg-muted py-4 text-center m-0">جاري تحميل البيانات...</p>
        ) : (
          <p className="text-[.74rem] text-fg-muted m-0">
            اضغط «استنتج المستوى الحالي» — الفريق هيبني صورة الوضع دلوقتي من آخر البيانات المرصودة.
          </p>
        )}
      </section>

      {/* ── أهم الاستنتاجات (material only — spec 5/6) ── */}
      <section className="mb-4">
        <h2 className="text-[.85rem] font-extrabold mt-0 mb-2">أهم الاستنتاجات</h2>
        {openInsights.length === 0 ? (
          <div className="glass-card p-6 text-center">
            <b className="block text-[.9rem] mb-2">كل حاجة ماشية تمام — مفيش ملاحظات محتاجة انتباهك دلوقتي</b>
            <p className="text-[.74rem] text-fg-muted m-0">
              الفريق مش بيطلع ملاحظة على أي رقم غريب بيعدي — بس لما يكون فيه تأثير حقيقي على الطلاب
              أو على سير العمل، ساعتها بس هتلاقي ملاحظة هنا مع اقتراح للتعامل معاها.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {openInsights.map((ins) => (
              <InsightCard key={ins.id} ins={ins} canDismiss={dbReady === true} onDismiss={handleDismiss} />
            ))}
          </div>
        )}
      </section>

      {/* ── التقرير الأسبوعي / فترة مختارة (spec 9) ── */}
      <section className="mb-4" id="nk-weekly-report">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h2 className="text-[.85rem] font-extrabold m-0">{viewSnap ? 'تقرير فترة سابقة' : 'التقرير الأسبوعي'}</h2>
          {viewSnap && (
            <button type="button" className="btn-ghost rounded-lg px-3 py-1.5 text-[.68rem] font-bold" onClick={() => setViewSnap(null)}>
              رجوع لآخر تقرير
            </button>
          )}
        </div>
        {reportView?.report ? (
          <div className="glass-card p-4">
            <p className="text-[.76rem] m-0 mb-2 font-bold">{reportView.report.summary || '—'}</p>
            <small className="text-[.64rem] text-fg-subtle block mb-1">
              الفترة: {reportView.report.periodStart || '—'} ← {reportView.report.periodEnd || '—'}
              {reportView.run?.durationMs != null ? ` · زمن التحليل: ${arNum(Math.round((reportView.run.durationMs / 1000) * 10) / 10)} ث` : ''}
            </small>
            {reportView.report.insights?.length > 0 && (
              <details className="mt-2">
                <summary className="text-[.72rem] font-extrabold cursor-pointer">
                  استنتاجات التقرير ({arNum(reportView.report.insights.length)})
                </summary>
                <div className="grid gap-3 mt-3">
                  {reportView.report.insights.map((ins) => (
                    <InsightCard key={`${ins.id}-${ins.dbId || ins.generatedAt || 'x'}`} ins={ins} />
                  ))}
                </div>
              </details>
            )}
          </div>
        ) : (
          <div className="glass-card p-4 text-[.74rem] text-fg-muted">أول تقرير أسبوعي هيظهر هنا أول ما التحليل يشتغل.</div>
        )}
      </section>

      {/* ── المجالات (spec 16/17: one line per domain, charts as evidence) ── */}
      <section className="mb-4">
        <h2 className="text-[.85rem] font-extrabold mt-0 mb-2">المجالات</h2>
        {domains ? (
          <div className="grid gap-2 md:grid-cols-2">
            <DomainRow
              label="الأكاديمي"
              value={academicD?.examAvgCur != null ? `متوسط الامتحانات ${arNum(academicD.examAvgCur)}%` : 'مفيش امتحانات كفاية'}
              delta={academicD?.examAvgCur != null && academicD?.examAvgPrev != null ? academicD.examAvgCur - academicD.examAvgPrev : null}
              positiveIsGood
            >
              {academicD?.examSeries?.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[.68rem] font-bold cursor-pointer text-fg-muted">اتجاه الدرجات (آخر ٩٠ يوم)</summary>
                  <div className="mt-2 h-[180px]">
                    <Suspense fallback={<ChartsFallback />}>
                      <Charts present={0} absent={0} unrecorded={0} examDatesMap={examDatesMap90} variant="scores" />
                    </Suspense>
                  </div>
                </details>
              )}
            </DomainRow>
            <DomainRow
              label="الحضور"
              value={attendanceD?.absRateCur != null ? `الغياب ${pctText(attendanceD.absRateCur)}` : 'مفيش رصد كفاية'}
              delta={attendanceD?.absRateCur != null && attendanceD?.absRatePrev != null ? Math.round((attendanceD.absRateCur - attendanceD.absRatePrev) * 100) : null}
              positiveIsGood={false}
            >
              <div className="mt-2"><AttendanceBars weekly={attendanceD?.weekly} /></div>
            </DomainRow>
            <DomainRow
              label="الواجبات"
              value={homeworkD?.hwRateCur != null ? `التسليم ${pctText(homeworkD.hwRateCur)}` : 'مفيش علامات كفاية'}
              delta={homeworkD?.hwRateCur != null && homeworkD?.hwRatePrev != null ? Math.round((homeworkD.hwRateCur - homeworkD.hwRatePrev) * 100) : null}
              positiveIsGood
            />
            <DomainRow
              label="التشغيل"
              value={`حصص مكتملة: ${arNum(operationsD?.heldCur ?? 0)}`}
              delta={operationsD ? operationsD.heldCur - operationsD.heldPrev : null}
              positiveIsGood
            />
            {engagementD?.provided && (
              <DomainRow
                label="السلوك والتفاعل"
                value={engagementD.negativeNotes ? `${arNum(engagementD.negativeNotes)} ملاحظات سلبية على ${arNum(engagementD.flaggedStudents)} طالب` : 'مفيش ملاحظات سلبية'}
              />
            )}
            <DomainRow label="المؤشرات المالية" value="غير متاح حاليًا">
              <p className="text-[.68rem] text-fg-muted m-0 mt-1">
                النظام مفيهوش بيانات مصاريف أو مدفوعات لحد ما — لما تتضيف، الفريق هيحللها بنفس معيار المادية بدون مايزعجك بالأرقام الفاضية.
              </p>
            </DomainRow>
          </div>
        ) : (
          <div className="glass-card p-4 text-[.74rem] text-fg-muted">المجالات هتظهر مع أول تحليل.</div>
        )}
      </section>

      {/* ── أدوات متقدمة (preserved from the retired analytics dashboard) ── */}
      <details className="glass-card p-4 mb-4">
        <summary className="text-[.85rem] font-extrabold cursor-pointer">أدوات متقدمة</summary>
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {['week', 30, 90, 0].map((d) => (
              <button
                key={String(d)}
                type="button"
                className="rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold"
                style={periodDays === d
                  ? { background: 'var(--brand-navy, #142D62)', color: '#fff', border: '1px solid var(--brand-navy, #142D62)' }
                  : { background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--surface-border)' }}
                onClick={() => setPeriodDays(d)}
                aria-pressed={periodDays === d}
              >
                {d === 'week' ? 'هذا الأسبوع' : d === 30 ? 'آخر ٣٠ يوم' : d === 90 ? 'آخر ٩٠ يوم' : 'الكل'}
              </button>
            ))}
            <button type="button" className="btn-ghost rounded-lg px-3 py-2 text-[.7rem] font-extrabold ms-auto" onClick={exportCSV}>
              ⬇ تصدير CSV
            </button>
          </div>
          <p className="text-[.68rem] text-fg-muted mt-0 mb-2">
            ملخص لكل طالب في الفترة المختارة ({periodLabel}) — نفس تعريفات الحضور والدرجات المستخدمة في باقي التطبيق.
          </p>
          <div className="grid gap-1.5 max-h-80 overflow-y-auto">
            {periodRows.map((r) => (
              <button
                key={r.student.id}
                type="button"
                className="flex flex-wrap items-center justify-between gap-2 text-[.75rem] rounded-xl px-3 py-2 text-start"
                style={{ border: '1px solid var(--surface-border)' }}
                onClick={() => ui.openStudentHistory(r.student.id)}
                title="فتح ملف الطالب"
              >
                <span className="min-w-0 truncate font-extrabold">
                  {r.student.name}
                  <small className="text-fg-muted font-normal"> {r.student.group_name ? `· ${r.student.group_name}` : ''}</small>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <span className="nk-pill nk-pill-neutral">حضور: {r.attPct === null ? '—' : `${r.attPct}%`}</span>
                  <span className="nk-pill nk-pill-neutral">امتحانات: {r.examPct === null ? '—' : `${r.examPct}%`}</span>
                  <span className="nk-pill nk-pill-gold">{r.points} ن</span>
                </span>
              </button>
            ))}
            {periodRows.length === 0 && <p className="text-[.74rem] text-fg-muted m-0">لا بيانات</p>}
          </div>
        </div>
      </details>

      {/* ── التاريخ التحليلي (spec 10/26) ── */}
      <section>
        <h2 className="text-[.85rem] font-extrabold mt-0 mb-2">التاريخ التحليلي</h2>
        {historyList.length ? (
          <div className="grid gap-2">
            {historyList.map((h) => (
              <button
                key={h.report?.id || h.run?.id}
                type="button"
                className="rounded-2xl px-3.5 py-3 text-start transition hover:opacity-90"
                style={{ border: '1px solid var(--surface-border)' }}
                onClick={() => openReportFromHistory(h)}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b className="text-[.74rem]">
                    {h.report?.analysisType === 'on_demand' ? 'استنتاج لحظي' : 'تقرير أسبوعي'} · {formatWhen(h.run?.completedAt || h.report?.generatedAt)}
                  </b>
                  <span className="nk-pill nk-pill-neutral !text-[.62rem]">استنتاجات: {arNum(h.report?.insights?.length || 0)}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[.72rem] text-fg-muted">
            {dbReady === false
              ? 'التاريخ بيتخزن محليًا على الجهاز ده لحد ما جداول التحليل تتعمل في قاعدة البيانات (migration 044) — بعدها الذاكرة التحليلية بتشتغل لوحدها.'
              : 'لسه مفيش تاريخ تحليلي — أول تحليل هيبدأ السجل.'}
          </p>
        )}
      </section>
    </div>
  )
}
