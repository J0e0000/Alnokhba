import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { runInsightAnalysis } from '../lib/insights/engine'
import { loadInsightsReport, saveInsightsReport, isAnalysisDue, formatAnalysisTime, ANALYSIS_INTERVAL_MS } from '../lib/insights/store'

// ═══════════════════════════════════════════════════════════════════════════
// فريق التحليل (Smart Insights) — dedicated analytical destination (spec 3).
//
// - Lives ONLY here: no dashboard cards, no floating widgets, no banners,
//   no popups, nothing inside the Session Workspace (spec 3/6). Entry is a
//   deliberate tap in the account (More/⋯) menu.
// - Analysis runs inside a WEEKLY WINDOW: opening this page runs the analysis
//   only if the last one is >= 7 days old; otherwise the stored report is
//   shown as-is (spec 5). A manual "تحليل جديد الآن" is always available as
//   a deliberate action. The computation is pure client-side work over data
//   already in memory — it never touches the daily workflow's performance.
// - Language: Egyptian Arabic with a professional tone (spec 4).
// - The internal materiality reasons are stored with each insight but are
//   NOT rendered as scoring jargon (spec 2).
// ═══════════════════════════════════════════════════════════════════════════

const SEVERITY_STYLE = {
  'needs-attention': { border: 'var(--warn, #f59e0b)', label: 'محتاجة انتباه' },
  watch: { border: 'var(--accent-blue, #60a5fa)', label: 'للمتابعة' },
}

export default function InsightsArea() {
  const ws = useWorkspace()
  const ui = useUI()
  const teacherId = ws.effectiveTeacherId
  const [report, setReport] = useState(() => loadInsightsReport(teacherId))
  const [running, setRunning] = useState(false)
  const autoRanRef = useRef(false)

  const analyze = useCallback(() => {
    setRunning(true)
    try {
      // Pure computation over in-memory data — no network, no side effects.
      const result = runInsightAnalysis({
        students: ws.students,
        allAttendance: ws.allAttendance,
        lessonSessions: ws.lessonSessions,
        examScoresByStudent: ws.examScoresByStudent,
        settings: ws.settings,
      })
      const next = { insights: result.insights, meta: result.meta }
      saveInsightsReport(teacherId, next)
      setReport(next)
    } finally {
      setRunning(false)
    }
  }, [ws.students, ws.allAttendance, ws.lessonSessions, ws.examScoresByStudent, ws.settings, teacherId])

  // Weekly window (spec 5): auto-analyze on open ONLY when the stored report
  // is stale — exactly once per mount, never during render.
  useEffect(() => {
    if (ws.loading || autoRanRef.current) return
    autoRanRef.current = true
    if (isAnalysisDue(loadInsightsReport(teacherId))) analyze()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.loading])

  const due = useMemo(() => isAnalysisDue(report), [report])
  const lastRun = report ? formatAnalysisTime(report.meta.generatedAt) : ''
  const nextRun = report
    ? formatAnalysisTime(new Date(new Date(report.meta.generatedAt).getTime() + ANALYSIS_INTERVAL_MS).toISOString())
    : ''
  const insights = report?.insights || []

  return (
    <div>
      <h1 className="text-lg font-black m-0 mb-1">فريق التحليل</h1>
      <p className="text-[.74rem] text-fg-muted mb-4">
        بيحلل حضور الطلاب والواجبات والامتحانات مرة في الأسبوع، وبيقولك بس على اللي له تأثير حقيقي
        ويستاهل تحرك — من غير إزعاج أثناء الحصص ولا إشعارات على طول اليوم.
      </p>

      {/* Analysis schedule — transparent, no background work (spec 5) */}
      <div className="glass-card p-4 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[.72rem] text-fg-muted">
          {report
            ? <>آخر تحليل: <b className="text-fg">{lastRun}</b></>
            : 'لسه مفيش تحليل — دوس الزر لتشغيل أول تحليل.'}
        </span>
        {report && !due && (
          <span className="text-[.72rem] text-fg-muted">التحليل الجاي: <b className="text-fg">{nextRun}</b></span>
        )}
        <button
          className="btn-ghost rounded-xl px-3.5 py-2 text-[.72rem] font-extrabold ms-auto"
          onClick={analyze}
          disabled={running || ws.loading}
        >
          {running ? '... بيحلل' : due ? 'شغّل التحليل الأسبوعي' : 'تحليل جديد الآن'}
        </button>
      </div>

      {ws.loading && <p className="text-sm text-fg-muted py-8 text-center">جاري تحميل البيانات...</p>}

      {!ws.loading && !running && insights.length === 0 && (
        <div className="glass-card p-6 text-center">
          <b className="block text-[.9rem] mb-2">كل حاجة ماشية تمام — مفيش ملاحظات محتاجة انتباهك دلوقتي</b>
          <p className="text-[.74rem] text-fg-muted m-0">
            الفريق مش بيطلع ملاحظات على أي رقم غريب بيعدي — بس لما يكون فيه تأثير حقيقي على الطلاب
            أو على سير العمل، ساعتها بس هتلاقي ملاحظة هنا مع اقتراح للتعامل معاها.
          </p>
        </div>
      )}

      <div className="grid gap-3">
        {insights.map((ins) => {
          const style = SEVERITY_STYLE[ins.severity] || SEVERITY_STYLE.watch
          return (
            <article
              key={ins.id}
              className="glass-card p-4"
              style={{ borderInlineStart: `4px solid ${style.border}` }}
            >
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <b className="text-[.86rem]">{ins.title}</b>
                <span
                  className="nk-pill !text-[.6rem]"
                  style={{ background: 'var(--surface-container-high)', color: style.border, border: `1px solid ${style.border}` }}
                >
                  {style.label}
                </span>
              </div>
              {ins.lines.map((line, i) => (
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
            </article>
          )
        })}
      </div>
    </div>
  )
}
