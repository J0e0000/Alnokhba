import { useMemo } from 'react'
import { checkAcademicWarning, getStudentRank } from '../lib/helpers'
import { useLanguage } from '../context/LanguageContext'

export default function DashboardOverview({ students, examScoresByStudent, absenceStreaks, ranks, onOpenStudent }) {
  const { t } = useLanguage()

  const data = useMemo(() => {
    const total = students.length
    const present = students.filter((s) => s.attendance_status === 'حاضر').length
    const absent = students.filter((s) => s.attendance_status === 'غائب').length
    const recorded = present + absent
    const attendanceRate = recorded > 0 ? Math.round((present / recorded) * 100) : null

    let earned = 0, max = 0
    students.forEach((s) => {
      ;(examScoresByStudent[s.id] || []).forEach((ex) => {
        const m = ex.max_score_per_section * Object.keys(ex.section_scores || {}).length
        earned += ex.total_score; max += m
      })
    })
    const avgPerformance = max > 0 ? Math.round((earned / max) * 100) : null

    const critical = []
    const warning = []
    students.forEach((s) => {
      const academicWarning = checkAcademicWarning(examScoresByStudent[s.id] || [])
      const isCritical = s.points < 0 || (s.warnings || 0) >= 3 || academicWarning || absenceStreaks[s.id]
      const isWarning = !isCritical && (s.attendance_status === 'غائب' || s.hw_status === 'لم يتم' || s.hw_status === 'ناقص' || (s.warnings || 0) >= 1)
      if (isCritical) critical.push(s)
      else if (isWarning) warning.push(s)
    })
    const good = total - critical.length - warning.length
    const top = [...students].sort((a, b) => b.points - a.points).slice(0, 3)

    return { total, attendanceRate, avgPerformance, critical, warning, good, top }
  }, [students, examScoresByStudent, absenceStreaks])

  if (data.total === 0) {
    return (
      <div className="glass-card rounded-2xl p-8 text-center">
        <div className="text-4xl mb-3">🎓</div>
        <p className="text-fg font-black text-lg">{t('welcome_nokhba')}</p>
        <p className="text-fg-subtle text-sm mt-1">{t('welcome_desc')}</p>
      </div>
    )
  }

  const overallStatus = data.critical.length > 0 ? 'critical' : data.warning.length > 2 ? 'warning' : 'good'
  const statusMeta = {
    critical: { label: t('needs_intervention'), color: 'text-rose-400', ring: 'ring-rose-500/40' },
    warning: { label: t('needs_followup'), color: 'text-brand-gold-hover', ring: 'ring-amber-500/40' },
    good: { label: t('status_good'), color: 'text-emerald-400', ring: 'ring-emerald-500/40' },
  }[overallStatus]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label={t('total_students')} value={data.total} />
        <SummaryCard label={t('attendance_rate')} value={data.attendanceRate === null ? '—' : `${data.attendanceRate}%`}
          hint={data.attendanceRate === null ? t('no_attendance_today') : undefined} />
        <SummaryCard label={t('avg_performance')} value={data.avgPerformance === null ? '—' : `${data.avgPerformance}%`}
          hint={data.avgPerformance === null ? t('no_exams_yet') : undefined} />
        <div className={`glass-card rounded-xl p-3 text-center ring-1 ${statusMeta.ring}`}>
          <p className={`text-lg font-black ${statusMeta.color}`}>{statusMeta.label}</p>
          <p className="text-fg-subtle text-[11px] mt-1">🔴 {data.critical.length} · 🟡 {data.warning.length} · 🟢 {data.good}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SummaryCard label={t('students_needing_attention')} value={data.critical.length + data.warning.length}
          hint={data.critical.length > 0 ? `🔴 ${data.critical.length}` : undefined} />
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <HighlightCard title={t('urgent_followup')} color="rose" students={data.critical} onOpenStudent={onOpenStudent}
          empty={t('no_critical')} />
        <HighlightCard title={t('followup_needed')} color="amber" students={data.warning} onOpenStudent={onOpenStudent}
          empty={t('no_warning')} />
        <HighlightCard title={t('top_performers')} color="emerald" students={data.top} onOpenStudent={onOpenStudent}
          empty={t('no_points_yet')} subtitle={(s) => `🛡️ ${getStudentRank(s.points, ranks)} · ${s.points} pt`} />
      </div>
    </div>
  )
}

function SummaryCard({ label, value, hint }) {
  return (
    <div className="glass-card rounded-xl p-3 text-center">
      <p className="text-2xl font-black text-brand-gold-hover">{value}</p>
      <p className="text-fg-subtle text-[11px] mt-1">{label}</p>
      {hint && <p className="text-fg-subtle text-[10px] mt-0.5">{hint}</p>}
    </div>
  )
}

function HighlightCard({ title, color, students, empty, subtitle, onOpenStudent }) {
  const { t } = useLanguage()
  const colors = {
    rose: 'border-rose-500/30 text-rose-300',
    amber: 'border-amber-500/30 text-amber-300',
    emerald: 'border-emerald-500/30 text-emerald-300',
  }[color]
  const shown = students.slice(0, 5)
  return (
    <div className={`glass-card rounded-xl p-3 ${colors}`}>
      <p className="font-bold text-sm mb-2">{title}</p>
      {shown.length === 0 ? (
        <p className="text-fg-subtle text-xs">{empty}</p>
      ) : (
        <div className="space-y-1">
          {shown.map((s) => (
            <button key={s.id} onClick={() => onOpenStudent(s)}
              className="w-full flex justify-between items-center glass-input hover:bg-white/10 rounded-lg px-2 py-1 text-xs text-right">
              <span className="text-fg font-bold">{s.name}</span>
              {subtitle && <span className="text-fg-subtle">{subtitle(s)}</span>}
            </button>
          ))}
          {students.length > shown.length && (
            <p className="text-fg-subtle text-[10px] text-center pt-1">+{students.length - shown.length} {t('more_count')}</p>
          )}
        </div>
      )}
    </div>
  )
}
