import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { weekStart } from '../lib/week'
import {
  readLocalSnapshot, fetchRemoteState, fetchFreshAnalysisData,
  saveOnDemandAnalysis, fetchReportSnapshot, dismissInsight,
  analysisDue,
} from '../lib/insights/dbStore'
import { runWeeklyPipeline, openShape, buildInsightInputs } from '../lib/insights/runWeekly'
import { computeDomainMetrics, buildCurrentState } from '../lib/insights/pipeline'
import { downloadCSV, localDateStr } from '../lib/csv'

// PERF: chart.js stays a lazy chunk (only when the exam trend opens).
const Charts = lazy(() => import('./Charts'))
const ChartsFallback = () => <div className="rounded-2xl border border-subtle p-6 text-center text-fg-subtle text-sm">…</div>

// ═══════════════════════════════════════════════════════════════════════════
// فريق التحليل — ONE simple infographic report (owner request).
//
// Lives INSIDE الإعدادات (SettingsArea renders this lazily). The whole product
// is a single card anyone can read:
//   verdict chip → one-line headline → 4 stat tiles (attendance / homework /
//   exams / held sessions, each with its trend arrow) → «اللي يستاهل انتباهك»
//   (max 3 material insights, one tap each).
// Everything deeper (weekly report, exam trend chart, CSV tools, history)
// collapses into ONE <details> so the default view stays a single report.
//
// Analysis systems are unchanged (spec 8-14):
//   WEEKLY    — lazy scheduled window (auto when due, once per 7 days), full
//               engine + materiality + lifecycle, stored in analytics_* (044)
//               + localStorage mirror.
//   ON-DEMAND — «استنتج المستوى الحالي»: fresh bounded pulls, current state
//               only, never touches the weekly lifecycle.
// EXAM RULE: an exam tests its lesson + the lessons before it — the engine
// receives the exams list (lesson_session_id) and scopes its cause-check to
// that covered window (see engine.js EXAM COVERAGE RULE).
// ═══════════════════════════════════════════════════════════════════════════

const VERDICT = {
  stable: { icon: '✓', label: 'الوضع تمام', color: 'var(--ok, #22c55e)', bg: 'rgba(34,197,94,.12)' },
  watch: { icon: '◐', label: 'خلي بالك', color: 'var(--warn, #f59e0b)', bg: 'rgba(245,158,11,.12)' },
  attention: { icon: '✗', label: 'محتاج اهتمام', color: 'var(--danger, #ef4444)', bg: 'rgba(239,68,68,.12)' },
}
const SEVERITY_COLOR = {
  'needs-attention': 'var(--danger, #ef4444)',
  watch: 'var(--accent-blue, #60a5fa)',
}
// spec 11: lifecycle shown subtly — ongoing stays unlabeled
const STATUS_BADGE = {
  new: { label: 'جديد', bg: 'rgba(96,165,250,.14)' },
  worsening: { label: 'بيسوء', bg: 'rgba(239,68,68,.14)' },
  improving: { label: 'بيتحسن', bg: 'rgba(34,197,94,.14)' },
}
// spec 18: provenance in plain Arabic (inside the «ليه؟» disclosure)
const SOURCE_LABEL = {
  attendance_records: 'سجل الحضور',
  lesson_sessions: 'الحصص',
  exam_scores: 'درجات الامتحانات',
  exams: 'الامتحانات',
  students: 'ملفات الطلاب',
  behavior_logs: 'ملاحظات السلوك',
}
const arNum = (n) => String(n)

function formatWhen(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })
    + ' — '
    + d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' })
}

// ── infographic building blocks ─────────────────────────────────────────────

function StatTile({ icon, label, value, delta, positiveIsGood = true, children }) {
  const good = 'var(--ok, #22c55e)'
  const bad = 'var(--danger, #ef4444)'
  const deltaStyle = delta == null || delta === 0
    ? { color: 'var(--fg-muted)' }
    : (delta > 0) === positiveIsGood ? { color: good } : { color: bad }
  const deltaText = delta == null
    ? ''
    : delta === 0
      ? 'زي ما هو'
      : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}`
  return (
    <div className="rounded-2xl p-3.5" style={{ border: '1px solid var(--surface-border)', background: 'var(--surface-container)' }}>
      <div className="flex items-center gap-1.5 text-[.68rem] font-extrabold text-fg-muted">
        <span aria-hidden="true">{icon}</span>{label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5 flex-wrap">
        <b className="text-[1.35rem] leading-none font-black">{value}</b>
        {deltaText && <small className="text-[.66rem] font-black" style={deltaStyle}>{deltaText}</small>}
      </div>
      {children}
    </div>
  )
}

// 8-week presence bars (Friday→Thursday) — taller = better attendance.
function MiniWeekBars({ weekly }) {
  if (!Array.isArray(weekly) || !weekly.length) return null
  return (
    <div className="flex items-end gap-1.5 mt-2" dir="rtl" title="نسبة الحضور أسبوع بأسبوع (الجمعة ← الخميس)">
      {weekly.map((w) => {
        const presence = w.rate == null ? null : Math.max(0, 100 - w.rate)
        return (
          <div key={w.weekStart} className="flex flex-col items-center gap-1">
            <div
              className="rounded-t-md"
              style={{
                width: 9,
                height: `${presence == null ? 3 : Math.max(3, presence * 0.3)}px`,
                background: presence == null ? 'var(--surface-container-high)' : (presence >= 70 ? 'var(--ok, #22c55e)' : 'var(--warn, #f59e0b)'),
              }}
              title={presence == null ? 'أسبوع بدون رصد كفاية' : `الحضور ${presence}% — أسبوع ${w.weekStart}`}
            />
          </div>
        )
      })}
    </div>
  )
}

// One material insight — collapsed by default: dot + title (+ lifecycle badge).
// One tap opens the plain-Arabic lines, the suggested action, the «ليه؟»
// provenance, the student pills, and the dismiss (DB memory only).
function InsightRow({ ins, onDismiss, canDismiss }) {
  const ui = useUI()
  const [openWhy, setOpenWhy] = useState(false)
  const color = SEVERITY_COLOR[ins.severity] || SEVERITY_COLOR.watch
  const badge = STATUS_BADGE[ins.status]
  const sources = ins.sources || ins.evidence?.sources || []
  return (
    <details className="rounded-2xl" style={{ border: '1px solid var(--surface-border)', background: 'var(--surface-container)' }}>
      <summary className="flex items-center gap-2 p-3 cursor-pointer select-none">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
        <b className="text-[.78rem] leading-6 flex-1 min-w-0">{ins.title}</b>
        {badge && (
          <span className="nk-pill !text-[.6rem] shrink-0" style={{ background: badge.bg, color, border: `1px solid ${color}` }}>
            {badge.label}
          </span>
        )}
      </summary>
      <div className="px-3 pb-3">
        {(ins.lines || []).map((line, i) => (
          <p key={i} className="text-[.74rem] text-fg-muted m-0 mb-1.5 leading-6">{line}</p>
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
          <p className="text-[.72rem] m-0 mt-2 font-bold" style={{ color: 'var(--fg)' }}>
            اقتراح: {ins.action}
          </p>
        )}
        {((ins.reasons?.length) || sources.length > 0) && (
          <div className="mt-2">
            <button
              type="button"
              className="text-[.66rem] font-extrabold underline decoration-dotted"
              style={{ color: 'var(--fg-muted)' }}
              onClick={() => setOpenWhy((v) => !v)}
            >
              {openWhy ? 'إخفاء التفسير' : 'ليه؟'}
            </button>
            {openWhy && (
              <ul className="mt-2 m-0 pe-4 text-[.68rem] leading-6 text-fg-muted">
                {(ins.reasons || []).map((r, i) => <li key={i}>{r}</li>)}
                {ins.periodStart && <li>فترة التحليل: {ins.periodStart} ← {ins.periodEnd}</li>}
                {sources.length > 0 && (
                  <li>
                    المصدر: {sources.map((s) => SOURCE_LABEL[s] || s).join('، ')} — نفس البيانات اللي بيرصدها النظام، مفيش تقديرات.
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
        {canDismiss && ins.dbId && (
          <button
            type="button"
            className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.64rem] font-bold mt-2"
            onClick={() => onDismiss(ins)}
          >
            مش مهم دلوقتي
          </button>
        )}
      </div>
    </details>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
export default function InsightsReport() {
  const ws = useWorkspace()
  const ui = useUI()
  const teacherId = ws.effectiveTeacherId

  const [weekly, setWeekly] = useState(() => readLocalSnapshot(teacherId)?.weekly || null)
  const [onDemand, setOnDemand] = useState(() => readLocalSnapshot(teacherId)?.onDemand || null)
  const [openInsights, setOpenInsights] = useState([])
  const [historyList, setHistoryList] = useState([])
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set())
  const [viewSnap, setViewSnap] = useState(null) // an older report being viewed
  const [dbReady, setDbReady] = useState(null) // null=unknown · true=DB memory · false=local-only
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

  // DB reconciliation: stored analytical memory wins over the cache
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

  // Same input contract as before, now shared with InsightsNotifier (one
  // pipeline for both surfaces — see lib/insights/runWeekly.js).
  const buildInputs = useCallback((fresh) => buildInsightInputs(ws, fresh),
    [ws.students, ws.allAttendance, ws.lessonSessions, ws.examScoresByStudent, ws.examsList, ws.settings])

  // ── WEEKLY: full pipeline + lifecycle + storage ────────────────────────────
  const analyzeWeekly = useCallback(async () => {
    setRunning(true)
    try {
      const snapshot = await runWeeklyPipeline({
        teacherId,
        ws,
        prevOpen: openShape(remoteRef.current?.openInsights || []),
        dismissedKeys,
      })
      setWeekly(snapshot)
      setViewSnap(null)
      setOpenInsights(snapshot.report.insights.filter((i) => i.status !== 'resolved'))
    } finally {
      setRunning(false)
    }
  }, [teacherId, ws, dismissedKeys])

  // Weekly window: auto-run ONCE per mount when due (never during render)
  useEffect(() => {
    if (ws.loading || autoRanRef.current || !teacherId) return
    autoRanRef.current = true
    const lastAt = remoteRef.current?.latestWeekly?.report?.generatedAt || weekly?.report?.generatedAt
    if (analysisDue(lastAt)) analyzeWeekly()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.loading, teacherId])

  // ── ON-DEMAND «استنتج المستوى الحالي»: fresh, focused, current state only ──
  const runOnDemand = useCallback(async () => {
    setProbing(true)
    try {
      const t0 = performance.now()
      const fresh = await fetchFreshAnalysisData(teacherId)
      const inputs = buildInputs(fresh)
      const domains = computeDomainMetrics(inputs)
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
  }, [teacherId, buildInputs, ws.students, openInsights])

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
  }, [teacherId])

  // ── derived: the ONE report ────────────────────────────────────────────────
  const currentCard = useMemo(() => {
    const wT = weekly?.report?.generatedAt ? new Date(weekly.report.generatedAt).getTime() : 0
    const oT = onDemand?.report?.generatedAt ? new Date(onDemand.report.generatedAt).getTime() : 0
    return oT >= wT ? onDemand : weekly
  }, [weekly, onDemand])
  const situation = currentCard?.report?.situation || {}
  const currentState = situation.currentState || null
  const domains = situation.domains || null
  const lastRun = weekly?.report?.generatedAt || ''
  const due = analysisDue(lastRun)

  const at = domains?.attendance
  const hw = domains?.homework
  const ac = domains?.academic
  const ops = domains?.operations
  const attRate = at?.absRateCur != null ? Math.round((1 - at.absRateCur) * 100) : null
  const attPrev = at?.absRatePrev != null ? Math.round((1 - at.absRatePrev) * 100) : null
  const hwRate = hw?.hwRateCur != null ? Math.round(hw.hwRateCur * 100) : null
  const hwPrev = hw?.hwRatePrev != null ? Math.round(hw.hwRatePrev * 100) : null

  // ── advanced tools (inside the collapsed details) ─────────────────────────
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

  const engagementD = domains?.engagement
  const reportView = viewSnap || weekly
  const verdict = VERDICT[currentState?.overall] || VERDICT.stable

  return (
    <div id="nk-insights-report">
      {/* ── action row (title lives in the SettingsArea section band) ── */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-1">
        <button
          type="button"
          className="btn-navy rounded-xl px-3.5 py-2 text-[.72rem] font-extrabold disabled:opacity-50"
          onClick={runOnDemand}
          disabled={probing || ws.loading}
        >
          {probing ? 'جاري تحليل البيانات الحالية...' : 'استنتج المستوى الحالي'}
        </button>
      </div>
      <p className="text-[.7rem] text-fg-muted mb-3">
        تقرير واحد مبسط من بيانات حصصك — بيقولك الوضع عامل إزاي، واللي بس يستاهل انتباهك.
        {lastRun && <> آخر تحليل أسبوعي: <b className="text-fg">{formatWhen(lastRun)}</b>{!due ? ' — والتالي بيشتغل لوحده أول ما يحل موعده.' : ' — التحليل الأسبوعي هيتشغل تلقائيًا دلوقتي.'}</>}
      </p>
      {probeDoneAt && !probing && (
        <p className="text-[.7rem] mb-2 font-bold" style={{ color: 'var(--ok, #22c55e)' }}>
          تم تحديث التحليل ✓ — {formatWhen(probeDoneAt)}
        </p>
      )}

      {/* ── THE ONE REPORT (infographic) ── */}
      <section className="glass-card p-4 sm:p-5">
        {currentState ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[.78rem] font-black"
                style={{ background: verdict.bg, color: verdict.color, border: `1.5px solid ${verdict.color}` }}
              >
                <span aria-hidden="true">{verdict.icon}</span> {verdict.label}
              </span>
              {currentCard?.report?.generatedAt && (
                <small className="text-[.62rem] text-fg-subtle">
                  {currentCard.report.analysisType === 'on_demand' ? 'استنتاج لحظي' : 'التقرير الأسبوعي'} · {formatWhen(currentCard.report.generatedAt)}
                </small>
              )}
            </div>
            <p className="text-[.86rem] font-bold m-0 mt-2.5">{currentState.headline}</p>
            <small className="text-[.62rem] text-fg-subtle block mt-1">
              الفترة: {currentCard?.report?.periodStart || '—'} ← {currentCard?.report?.periodEnd || '—'}
            </small>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-4">
              <StatTile icon="◔" label="الحضور" value={attRate == null ? '—' : `${attRate}%`} delta={attRate != null && attPrev != null ? attRate - attPrev : null} positiveIsGood>
                <MiniWeekBars weekly={at?.weekly} />
              </StatTile>
              <StatTile icon="▤" label="تسليم الواجبات" value={hwRate == null ? '—' : `${hwRate}%`} delta={hwRate != null && hwPrev != null ? hwRate - hwPrev : null} positiveIsGood />
              <StatTile icon="✎" label="متوسط الامتحانات" value={ac?.examAvgCur != null ? `${ac.examAvgCur}%` : '—'} delta={ac?.examAvgCur != null && ac?.examAvgPrev != null ? ac.examAvgCur - ac.examAvgPrev : null} positiveIsGood />
              <StatTile icon="◷" label="حصص مكتملة" value={ops ? arNum(ops.heldCur) : '—'} delta={ops ? ops.heldCur - ops.heldPrev : null} positiveIsGood />
            </div>

            <div className="mt-4">
              <h3 className="text-[.8rem] font-extrabold m-0 mb-2">اللي يستاهل انتباهك</h3>
              {openInsights.length === 0 ? (
                <p className="text-[.74rem] font-bold m-0" style={{ color: 'var(--ok, #22c55e)' }}>
                  ✓ كل حاجة ماشية تمام — مفيش ملاحظة تستاهل انتباهك دلوقتي.
                </p>
              ) : (
                <div className="grid gap-2">
                  {openInsights.slice(0, 3).map((ins) => (
                    <InsightRow key={ins.id} ins={ins} canDismiss={dbReady === true} onDismiss={handleDismiss} />
                  ))}
                  {openInsights.length > 3 && (
                    <details>
                      <summary className="text-[.7rem] font-extrabold cursor-pointer text-fg-muted">
                        عرض الباقي ({arNum(openInsights.length - 3)})
                      </summary>
                      <div className="grid gap-2 mt-2">
                        {openInsights.slice(3).map((ins) => (
                          <InsightRow key={ins.id} ins={ins} canDismiss={dbReady === true} onDismiss={handleDismiss} />
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          </>
        ) : ws.loading ? (
          <p className="text-sm text-fg-muted py-4 text-center m-0">جاري تحميل البيانات...</p>
        ) : (
          <div className="text-center py-2">
            <p className="text-[.78rem] text-fg-muted m-0 mb-2">
              لسه مفيش تقرير — اضغط «استنتج المستوى الحالي» وهيبني صورة الوضع من آخر البيانات المرصودة،
              والتقرير الأسبوعي بيشتغل لوحده كل أسبوع.
            </p>
          </div>
        )}
      </section>

      {/* ── everything deeper collapses here ── */}
      <details className="glass-card p-4 mt-3">
        <summary className="text-[.8rem] font-extrabold cursor-pointer">التفاصيل الكاملة والأدوات</summary>
        <div className="mt-4 grid gap-5">

          {/* التقرير الأسبوعي / فترة مختارة */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-[.8rem] font-extrabold m-0">{viewSnap ? 'تقرير فترة سابقة' : 'التقرير الأسبوعي'}</h3>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-ghost rounded-lg px-3 py-1.5 text-[.66rem] font-bold disabled:opacity-50"
                  onClick={analyzeWeekly}
                  disabled={running || ws.loading}
                >
                  {running ? '... الفريق بيحلل' : due ? 'شغّل التحليل الأسبوعي' : 'تحليل جديد الآن'}
                </button>
                {viewSnap && (
                  <button type="button" className="btn-ghost rounded-lg px-3 py-1.5 text-[.66rem] font-bold" onClick={() => setViewSnap(null)}>
                    رجوع لآخر تقرير
                  </button>
                )}
                {historyList.length > 0 && (
                  <select
                    className="btn-ghost rounded-xl px-2.5 py-2 text-[.68rem] font-extrabold"
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
            {reportView?.report ? (
              <div className="rounded-2xl p-3.5" style={{ border: '1px solid var(--surface-border)', background: 'var(--surface-container)' }}>
                <p className="text-[.76rem] m-0 mb-2 font-bold">{reportView.report.summary || '—'}</p>
                <small className="text-[.62rem] text-fg-subtle block mb-1">
                  الفترة: {reportView.report.periodStart || '—'} ← {reportView.report.periodEnd || '—'}
                  {reportView.run?.durationMs != null ? ` · زمن التحليل: ${arNum(Math.round((reportView.run.durationMs / 1000) * 10) / 10)} ث` : ''}
                </small>
                {reportView.report.insights?.length > 0 && (
                  <div className="grid gap-2 mt-2">
                    {reportView.report.insights.map((ins) => (
                      <InsightRow key={`${ins.id}-${ins.dbId || ins.generatedAt || 'x'}`} ins={ins} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[.72rem] text-fg-muted m-0">أول تقرير أسبوعي هيظهر هنا أول ما التحليل يشتغل.</p>
            )}
          </section>

          {/* المجالات التكميلية (what the tiles don't show) */}
          <section>
            <h3 className="text-[.8rem] font-extrabold m-0 mb-2">مجالات إضافية</h3>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-2xl px-3.5 py-3" style={{ border: '1px solid var(--surface-border)' }}>
                <span className="text-[.74rem] font-extrabold">اتجاه الدرجات (آخر ٩٠ يوم)</span>
                {ac?.examSeries?.length > 0 ? (
                  <details className="mt-2">
                    <summary className="text-[.68rem] font-bold cursor-pointer text-fg-muted">افتح الرسم</summary>
                    <div className="mt-2 h-[180px]">
                      <Suspense fallback={<ChartsFallback />}>
                        <Charts present={0} absent={0} unrecorded={0} examDatesMap={(() => {
                          const ordered = {}
                          for (const point of ac.examSeries) ordered[point.date] = { earned: point.avg || 0, max: 100 }
                          return ordered
                        })()} variant="scores" />
                      </Suspense>
                    </div>
                  </details>
                ) : (
                  <p className="text-[.7rem] text-fg-muted m-0 mt-1">مفيش امتحانات كفاية</p>
                )}
              </div>
              {engagementD?.provided ? (
                <div className="rounded-2xl px-3.5 py-3" style={{ border: '1px solid var(--surface-border)' }}>
                  <span className="text-[.74rem] font-extrabold">السلوك والتفاعل</span>
                  <p className="text-[.72rem] text-fg-muted m-0 mt-1">
                    {engagementD.negativeNotes
                      ? `${arNum(engagementD.negativeNotes)} ملاحظات سلبية على ${arNum(engagementD.flaggedStudents)} طالب في الفترة.`
                      : 'مفيش ملاحظات سلبية مسجلة في الفترة.'}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl px-3.5 py-3" style={{ border: '1px solid var(--surface-border)' }}>
                  <span className="text-[.74rem] font-extrabold">المؤشرات المالية</span>
                  <p className="text-[.68rem] text-fg-muted m-0 mt-1">
                    النظام مفيهوش بيانات مصاريف أو مدفوعات لحد ما — لما تتضيف، الفريق هيحللها بنفس المعيار بدون أرقام فاضية.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* أدوات متقدمة (CSV) */}
          <section>
            <h3 className="text-[.8rem] font-extrabold m-0 mb-2">أدوات متقدمة</h3>
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {['week', 30, 90, 0].map((d) => (
                <button
                  key={String(d)}
                  type="button"
                  className="rounded-lg px-3 py-1.5 text-[.68rem] font-extrabold"
                  style={periodDays === d
                    ? { background: 'var(--brand-navy, #142D62)', color: '#fff', border: '1px solid var(--brand-navy, #142D62)' }
                    : { background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--surface-border)' }}
                  onClick={() => setPeriodDays(d)}
                  aria-pressed={periodDays === d}
                >
                  {d === 'week' ? 'هذا الأسبوع' : d === 30 ? 'آخر ٣٠ يوم' : d === 90 ? 'آخر ٩٠ يوم' : 'الكل'}
                </button>
              ))}
              <button type="button" className="btn-ghost rounded-lg px-3 py-2 text-[.68rem] font-extrabold ms-auto" onClick={exportCSV}>
                ⬇ تصدير CSV
              </button>
            </div>
            <div className="grid gap-1.5 max-h-72 overflow-y-auto">
              {periodRows.map((r) => (
                <button
                  key={r.student.id}
                  type="button"
                  className="flex flex-wrap items-center justify-between gap-2 text-[.74rem] rounded-xl px-3 py-2 text-start"
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
          </section>

          {/* التاريخ التحليلي */}
          <section>
            <h3 className="text-[.8rem] font-extrabold m-0 mb-2">التاريخ التحليلي</h3>
            {historyList.length ? (
              <div className="grid gap-2">
                {historyList.map((h) => (
                  <button
                    key={h.report?.id || h.run?.id}
                    type="button"
                    className="rounded-2xl px-3.5 py-2.5 text-start transition hover:opacity-90"
                    style={{ border: '1px solid var(--surface-border)' }}
                    onClick={() => openReportFromHistory(h)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b className="text-[.72rem]">
                        {h.report?.analysisType === 'on_demand' ? 'استنتاج لحظي' : 'تقرير أسبوعي'} · {formatWhen(h.run?.completedAt || h.report?.generatedAt)}
                      </b>
                      <span className="nk-pill nk-pill-neutral !text-[.6rem]">استنتاجات: {arNum(h.report?.insights?.length || 0)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[.7rem] text-fg-muted m-0">
                {dbReady === false
                  ? 'التاريخ بيتخزن محليًا على الجهاز ده لحد ما جداول التحليل تتعمل في قاعدة البيانات (migration 044) — بعدها الذاكرة التحليلية بتشتغل لوحدها.'
                  : 'لسه مفيش تاريخ تحليلي — أول تحليل هيبدأ السجل.'}
              </p>
            )}
          </section>
        </div>
      </details>
    </div>
  )
}
