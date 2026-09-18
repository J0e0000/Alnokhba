import { Suspense, lazy, useMemo, useState } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { getStudentRank } from '../lib/helpers'
import { downloadCSV, localDateStr } from '../lib/csv'

// PERF (performance round): chart.js/auto (~200 KB minified, zero
// tree-shaking) used to be statically imported here — i.e. in the FIRST
// bundle of every page, even though charts appear on exactly one tab (which
// mobile navigation even hides). Lazy now.
const Charts = lazy(() => import('../components/Charts'))
const ChartsFallback = () => <div className="rounded-2xl border border-subtle p-6 text-center text-fg-subtle text-sm">…</div>

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS AREA (rule 22) — broader trends only, NEVER inside the pipeline.
// Deterministic rules (no fake AI): attendance rate, exam averages,
// absence streaks, homework gaps, leaderboard. Derived from existing data.
// NEW: period filter (30/90/all) on the exam trend + per-student period
// summary with CSV export (UTF-8 BOM so Excel renders Arabic correctly).
// ═══════════════════════════════════════════════════════════════════════════
export default function AnalyticsArea() {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [periodDays, setPeriodDays] = useState(30)

  const sinceDate = useMemo(
    () => (periodDays ? new Date(Date.now() - periodDays * 86400000) : null),
    [periodDays],
  )
  const sinceStr = useMemo(() => (sinceDate ? localDateStr(sinceDate) : null), [sinceDate])

  const counts = useMemo(() => {
    let present = 0, absent = 0, unrecorded = 0
    ws.students.forEach((s) => {
      if (s.attendance_status === 'حاضر') present++
      else if (s.attendance_status === 'غائب') absent++
      else unrecorded++
    })
    return { present, absent, unrecorded }
  }, [ws.students])

  // Exam averages per day — FILTERED by the selected period, and keyed in
  // chronological order (the old version grouped by display string in
  // insertion order, so the line chart could render out of order).
  const examDatesMap = useMemo(() => {
    const map = {}
    ws.students.forEach((s) => {
      ;(ws.examScoresByStudent[s.id] || []).forEach((ex) => {
        const created = ex.created_at ? new Date(ex.created_at) : null
        if (sinceDate && created && created < sinceDate) return
        const max = (ex.max_score_per_section || 0) * Object.keys(ex.section_scores || {}).length
        const day = created ? localDateStr(created) : '—'
        if (!map[day]) map[day] = { earned: 0, max: 0 }
        map[day].earned += ex.total_score || 0
        map[day].max += max
      })
    })
    // chronological rebuild
    const ordered = {}
    Object.keys(map).sort((a, b) => a.localeCompare(b)).forEach((k) => { ordered[k] = map[k] })
    return ordered
  }, [ws.students, ws.examScoresByStudent, sinceDate])

  const avgPerformance = useMemo(() => {
    let earned = 0, max = 0
    Object.values(examDatesMap).forEach((d) => { earned += d.earned; max += d.max })
    return max ? Math.round((earned / max) * 100) : 0
  }, [examDatesMap])

  // Per-student period summary: attendance % over the period (from loaded
  // attendance records) + exam average % over the period.
  const periodRows = useMemo(() => {
    return ws.students.map((s) => {
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

      return {
        student: s,
        presentCount: present,
        recordedCount: recorded.length,
        attPct,
        examCount: exams.length,
        examPct,
        points: s.points || 0,
      }
    })
  }, [ws.students, ws.allAttendance, ws.examScoresByStudent, sinceDate, sinceStr])

  const exportCSV = () => {
    const headers = ['الاسم', 'الكود', 'المجموعة', 'الحضور %', 'حصص مرصودة', 'حاضر', 'متوسط الامتحانات %', 'عدد الامتحانات', 'النقاط']
    const rows = periodRows.map((r) => [
      r.student.name, r.student.code || '', r.student.group_name || '',
      r.attPct === null ? '—' : `${r.attPct}%`,
      r.recordedCount, r.presentCount,
      r.examPct === null ? '—' : `${r.examPct}%`,
      r.examCount, r.points,
    ])
    const label = periodDays ? `last_${periodDays}_days` : 'all_time'
    downloadCSV(`analytics_${label}_${localDateStr()}.csv`, headers, rows)
    ws.showToast?.(isArabic ? 'تم تحميل ملف CSV ✓' : 'CSV downloaded ✓', 'success')
  }

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

  const periodLabel = periodDays === 30 ? 'آخر ٣٠ يوم' : periodDays === 90 ? 'آخر ٩٠ يوم' : 'كل الفترات'

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-lg font-black m-0">{isArabic ? 'التحليلات' : 'Analytics'}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {[30, 90, 0].map((d) => (
            <button
              key={d}
              className="rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold"
              style={periodDays === d
                ? { background: 'var(--brand-navy, #0E2954)', color: '#fff', border: '1px solid var(--brand-navy, #0E2954)' }
                : { background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--surface-border)' }}
              onClick={() => setPeriodDays(d)}
              aria-pressed={periodDays === d}
            >
              {d === 30 ? 'آخر ٣٠ يوم' : d === 90 ? 'آخر ٩٠ يوم' : 'الكل'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[.74rem] text-fg-muted mb-4">{isArabic ? 'اتجاهات عامة من بياناتك — خارج مسار الحصص تمامًا.' : 'Broad trends from your data — entirely outside the session pipeline.'}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="nk-stat"><small>{isArabic ? 'متوسط الأداء' : 'Avg performance'}<span className="block text-[.6rem] font-bold text-fg-muted">{isArabic ? `(${periodLabel})` : `(${periodLabel})`}</span></small><strong>{avgPerformance}%</strong></div>
        <div className="nk-stat"><small>{isArabic ? 'حاضر اليوم' : 'Present today'}</small><strong>{counts.present}</strong></div>
        <div className="nk-stat"><small>{isArabic ? 'غائب اليوم' : 'Absent today'}</small><strong>{counts.absent}</strong></div>
        <div className="nk-stat nk-stat--gold"><small>{isArabic ? 'طلاب' : 'Students'}</small><strong>{ws.students.length}</strong></div>
      </div>

      <div className="glass-card p-4 mb-4">
        <Suspense fallback={<ChartsFallback />}>
          <Charts present={counts.present} absent={counts.absent} unrecorded={counts.unrecorded} examDatesMap={examDatesMap} variant="both" />
        </Suspense>
      </div>

      {/* Per-student period summary + CSV export */}
      <section className="glass-card p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-[.85rem] font-extrabold m-0">{isArabic ? 'ملخص الطلاب' : 'Student summary'} <span className="text-fg-muted text-[.68rem] font-bold">({isArabic ? periodLabel : periodLabel})</span></h3>
          <button className="btn-ghost rounded-lg px-3 py-2 text-[.72rem] font-extrabold" onClick={exportCSV}>
            ⬇ {isArabic ? 'تصدير CSV' : 'Export CSV'}
          </button>
        </div>
        <div className="grid gap-1.5 max-h-96 overflow-y-auto">
          {periodRows.map((r) => (
            <div key={r.student.id} className="flex flex-wrap items-center justify-between gap-2 text-[.75rem] rounded-xl px-3 py-2" style={{ border: '1px solid var(--surface-border)' }}>
              <span className="min-w-0 truncate font-extrabold">{r.student.name}<small className="text-fg-muted font-normal"> {r.student.group_name ? `· ${r.student.group_name}` : ''}</small></span>
              <span className="flex flex-wrap items-center gap-1.5 shrink-0">
                <span className="nk-pill nk-pill-neutral">{isArabic ? 'حضور' : 'Att.'}: {r.attPct === null ? '—' : `${r.attPct}%`}</span>
                <span className="nk-pill nk-pill-neutral">{isArabic ? 'امتحانات' : 'Exams'}: {r.examPct === null ? '—' : `${r.examPct}%`}</span>
                <span className="nk-pill nk-pill-gold">{r.points} {isArabic ? 'ن' : 'pt'}</span>
              </span>
            </div>
          ))}
          {periodRows.length === 0 && <p className="text-[.74rem] text-fg-muted m-0">{isArabic ? 'لا بيانات' : 'No data'}</p>}
        </div>
      </section>

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
