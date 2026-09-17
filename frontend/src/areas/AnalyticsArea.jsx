import { useMemo } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import Charts from '../components/Charts'
import { getStudentRank, checkAcademicWarning } from '../lib/helpers'

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS AREA (rule 22) — broader trends only, NEVER inside the pipeline.
// Deterministic rules (no fake AI): attendance rate, exam averages,
// absence streaks, homework gaps, leaderboard. Derived from existing data.
// ═══════════════════════════════════════════════════════════════════════════
export default function AnalyticsArea() {
  const ws = useWorkspace()
  const { isArabic } = ws

  const counts = useMemo(() => {
    let present = 0, absent = 0, unrecorded = 0
    ws.students.forEach((s) => {
      if (s.attendance_status === 'حاضر') present++
      else if (s.attendance_status === 'غائب') absent++
      else unrecorded++
    })
    return { present, absent, unrecorded }
  }, [ws.students])

  const examDatesMap = useMemo(() => {
    const map = {}
    ws.students.forEach((s) => {
      ;(ws.examScoresByStudent[s.id] || []).forEach((ex) => {
        const max = (ex.max_score_per_section || 0) * Object.keys(ex.section_scores || {}).length
        const d = new Date(ex.created_at).toLocaleDateString('ar-EG')
        if (!map[d]) map[d] = { earned: 0, max: 0 }
        map[d].earned += ex.total_score || 0
        map[d].max += max
      })
    })
    return map
  }, [ws.students, ws.examScoresByStudent])

  const avgPerformance = useMemo(() => {
    let earned = 0, max = 0
    Object.values(examDatesMap).forEach((d) => { earned += d.earned; max += d.max })
    return max ? Math.round((earned / max) * 100) : 0
  }, [examDatesMap])

  const leaderboard = useMemo(
    () => [...ws.students].sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 10),
    [ws.students],
  )

  const insights = useMemo(() => {
    const list = []
    const cfg = ws.settings?.insight_config || {}
    const attendanceThreshold = cfg.attendance_warning_threshold ?? 75
    const perfThreshold = cfg.performance_warning_threshold ?? 60
    const repeatedAbsence = cfg.repeated_absence_count ?? 3
    ws.students.forEach((s) => {
      const exams = ws.examScoresByStudent[s.id] || []
      const max = exams.length ? (exams[exams.length - 1].max_score_per_section || 0) * Object.keys(exams[exams.length - 1].section_scores || {}).length : 0
      const lastPct = max ? Math.round(((exams[exams.length - 1].total_score || 0) / max) * 100) : null
      if (lastPct !== null && lastPct < perfThreshold) list.push({ severity: 'danger', name: s.name, text: isArabic ? `آخر امتحان ${lastPct}% — تحت الحد (${perfThreshold}%)` : `Last exam ${lastPct}% — below threshold (${perfThreshold}%)` })
      if (exams.length >= 2) {
        const maxPrev = (exams[exams.length - 2].max_score_per_section || 0) * Object.keys(exams[exams.length - 2].section_scores || {}).length
        const prevPct = maxPrev ? Math.round(((exams[exams.length - 2].total_score || 0) / maxPrev) * 100) : null
        if (prevPct !== null && lastPct !== null && prevPct - lastPct >= 10) list.push({ severity: 'warning', name: s.name, text: isArabic ? `تراجع ${prevPct - lastPct} نقاط مئوية عن آخر امتحان` : `Dropped ${prevPct - lastPct} points vs last exam` })
      }
      const streak = ws.absenceStreaks[s.id]
      if (streak >= repeatedAbsence) list.push({ severity: 'danger', name: s.name, text: isArabic ? `غياب متكرر: ${streak} مرات متتالية` : `Repeated absence: ${streak} in a row` })
      if (s.hw_status === 'لم يتم' || s.hw_status === 'ناقص') list.push({ severity: 'info', name: s.name, text: isArabic ? `الواجب الحالي: ${s.hw_status}` : `Current homework: ${s.hw_status}` })
      if ((s.warnings || 0) >= 3) list.push({ severity: 'warning', name: s.name, text: isArabic ? `${s.warnings} إنذارات سلوكية` : `${s.warnings} behavior warnings` })
    })
    const order = { danger: 0, warning: 1, info: 2 }
    return list.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 12)
  }, [ws.students, ws.examScoresByStudent, ws.absenceStreaks, ws.settings, isArabic])

  return (
    <div>
      <h1 className="text-lg font-black m-0 mb-1">{isArabic ? 'التحليلات' : 'Analytics'}</h1>
      <p className="text-[.74rem] text-fg-muted mb-4">{isArabic ? 'اتجاهات عامة من بياناتك — خارج مسار الحصص تمامًا.' : 'Broad trends from your data — entirely outside the session pipeline.'}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="nk-stat"><small>{isArabic ? 'متوسط الأداء' : 'Avg performance'}</small><strong>{avgPerformance}%</strong></div>
        <div className="nk-stat"><small>{isArabic ? 'حاضر اليوم' : 'Present today'}</small><strong>{counts.present}</strong></div>
        <div className="nk-stat"><small>{isArabic ? 'غائب اليوم' : 'Absent today'}</small><strong>{counts.absent}</strong></div>
        <div className="nk-stat nk-stat--gold"><small>{isArabic ? 'طلاب' : 'Students'}</small><strong>{ws.students.length}</strong></div>
      </div>

      <div className="glass-card p-4 mb-4">
        <Charts present={counts.present} absent={counts.absent} unrecorded={counts.unrecorded} examDatesMap={examDatesMap} variant="both" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="glass-card p-4">
          <h3 className="text-[.85rem] font-extrabold mt-0 mb-3">{isArabic ? 'لوحة الصدارة' : 'Leaderboard'}</h3>
          <div className="grid gap-1.5">
            {leaderboard.map((s, i) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-[.76rem]">
                <span className="truncate"><span aria-hidden="true">{['🥇', '🥈', '🥉'][i] || `${i + 1}.`}</span> {s.name}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <small className="text-fg-muted">{getStudentRank(s.points || 0, ws.ranks)}</small>
                  <span className="nk-pill nk-pill-gold">{s.points || 0}</span>
                </span>
              </div>
            ))}
            {leaderboard.length === 0 && <p className="text-[.74rem] text-fg-muted m-0">{isArabic ? 'لا بيانات' : 'No data'}</p>}
          </div>
        </section>

        <section className="glass-card p-4">
          <h3 className="text-[.85rem] font-extrabold mt-0 mb-1">{isArabic ? 'رؤى تلقائية' : 'Smart insights'}</h3>
          <p className="text-[.66rem] text-fg-muted mt-0 mb-3">{isArabic ? 'قواعد حسابية من بياناتك — بدون ذكاء اصطناعي.' : 'Deterministic rules over your data — no AI.'}</p>
          <div className="grid gap-1.5 max-h-80 overflow-y-auto">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2 text-[.74rem]">
                <span className={`nk-pill shrink-0 ${ins.severity === 'danger' ? 'nk-pill-danger' : ins.severity === 'warning' ? 'nk-pill-pending' : 'nk-pill-neutral'}`}>
                  {ins.severity === 'danger' ? '⚠' : ins.severity === 'warning' ? '!' : 'ℹ'}
                </span>
                <span><b>{ins.name}</b> — {ins.text}</span>
              </div>
            ))}
            {insights.length === 0 && <p className="text-[.74rem] text-fg-muted m-0">{isArabic ? 'لا ملاحظات حالياً 👌' : 'Nothing flagged 👌'}</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
