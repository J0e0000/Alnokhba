/**
 * SmartInsights — تنبيهات ذكية (DETERMINISTIC RULES, NOT AI)
 * 
 * Uses configurable thresholds from teacher_settings.insight_config
 * to generate rule-based insights about students.
 * 
 * Rules cover performance, attendance, absence, homework, and warnings only.
 * Pricing and payment status are intentionally kept in Accounts, not Insights.
 */
import { useMemo } from 'react'
import { useLanguage } from '../context/LanguageContext'

export function computeSmartInsights({ students, examScoresByStudent, attendanceRecords, settings, absenceStreaks, paymentStatuses, isArabic = true }) {
  const config = settings?.insight_config || {}
  const attendanceThreshold = config.attendance_warning_threshold ?? 75
  const performanceThreshold = config.performance_warning_threshold ?? 60
  const repeatedAbsenceCount = config.repeated_absence_count ?? 3
  const insights = []

  for (const student of students) {
    const exams = examScoresByStudent[student.id] || []
    const records = attendanceRecords[student.id] || []
    const streak = absenceStreaks[student.id]

    // Rule 1: Attendance below threshold
    if (records.length >= 3) {
      const presentCount = records.filter((r) => r.status === 'حاضر').length
      const pct = (presentCount / records.length) * 100
      if (pct < attendanceThreshold) {
        insights.push({
          studentId: student.id,
          studentName: student.name,
          type: 'attendance',
          severity: 'warning',
          message: `📊 ${isArabic ? 'نسبة الحضور' : 'Attendance'}: ${pct.toFixed(0)}% (< ${attendanceThreshold}%)`,
        })
      }
    }

    // Rule 3: Performance declining (last 2 exams)
    if (exams.length >= 2) {
      const last = exams[exams.length - 1]
      const prev = exams[exams.length - 2]
      const lastSections = Object.keys(last.section_scores || {}).length
      const prevSections = Object.keys(prev.section_scores || {}).length
      if (lastSections > 0 && prevSections > 0) {
        const lastPct = (last.total_score / (last.max_score_per_section * lastSections)) * 100
        const prevPct = (prev.total_score / (prev.max_score_per_section * prevSections)) * 100
        if (lastPct < prevPct && (prevPct - lastPct) >= 10) {
          insights.push({
            studentId: student.id,
            studentName: student.name,
            type: 'performance',
            severity: 'danger',
            message: `📉 ${isArabic ? 'تراجع في الأداء' : 'Performance declining'}: ${prevPct.toFixed(0)}% → ${lastPct.toFixed(0)}%`,
          })
        }
      }
    }

    // Rule 4: Low exam score
    if (exams.length >= 1) {
      const last = exams[exams.length - 1]
      const lastSections = Object.keys(last.section_scores || {}).length
      if (lastSections > 0) {
        const lastPct = (last.total_score / (last.max_score_per_section * lastSections)) * 100
        if (lastPct < performanceThreshold) {
          insights.push({
            studentId: student.id,
            studentName: student.name,
            type: 'performance',
            severity: 'warning',
            message: `📊 ${isArabic ? 'أداء أقل من المطلوب' : 'Below threshold'}: ${lastPct.toFixed(0)}% (< ${performanceThreshold}%)`,
          })
        }
      }
    }

    // Rule 5: Repeated absence
    if (streak && streak >= repeatedAbsenceCount) {
      insights.push({
        studentId: student.id,
        studentName: student.name,
        type: 'absence',
        severity: 'danger',
        message: `🚨 ${isArabic ? 'غياب متكرر' : 'Repeated absence'}: ${streak} ${isArabic ? 'مرات' : 'times'}`,
      })
    }

    // Rule 6: Homework not done
    if (student.hw_status === 'لم يتم') {
      insights.push({
        studentId: student.id,
        studentName: student.name,
        type: 'homework',
        severity: 'info',
        message: `📚 ${isArabic ? 'الواجب لم يتم' : 'Homework not done'}`,
      })
    }

    // Rule 7: Warnings high
    if (student.warnings >= 3) {
      insights.push({
        studentId: student.id,
        studentName: student.name,
        type: 'behavior',
        severity: 'danger',
        message: `🚨 ${student.warnings} ${isArabic ? 'إنذارات' : 'warnings'}`,
      })
    }
  }

  return insights.sort((a, b) => {
    const severityOrder = { danger: 0, warning: 1, info: 2 }
    return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2)
  })
}

export default function SmartInsights({ insights, onOpenStudent }) {
  const { isArabic } = useLanguage()

  if (!insights || insights.length === 0) {
    return (
      <div className="glass-card rounded-xl p-4 text-center">
        <p className="text-fg-subtle text-sm">✅ {isArabic ? 'لا توجد تنبيهات — الوضع مطمئن' : 'No alerts — all good'}</p>
      </div>
    )
  }

  const severityColors = {
    danger: 'border-rose-500/40 bg-rose-500/5',
    warning: 'border-amber-500/40 bg-amber-500/5',
    info: 'border-blue-500/40 bg-blue-500/5',
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-fg">💡 {isArabic ? 'تنبيهات ذكية' : 'Smart Insights'}</h3>
        <span className="text-fg-subtle text-xs">{insights.length}</span>
      </div>
      {insights.slice(0, 10).map((insight, i) => (
        <div
          key={`${insight.studentId}-${insight.type}-${i}`}
          className={`rounded-xl px-4 py-2.5 border cursor-pointer hover:bg-white/5 transition-colors ${severityColors[insight.severity] || severityColors.info}`}
          onClick={() => onOpenStudent && insight.studentId && onOpenStudent(insight.studentId)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg font-bold text-sm">{insight.studentName}</span>
            <span className="text-fg-subtle text-xs">{insight.message}</span>
          </div>
        </div>
      ))}
      {insights.length > 10 && (
        <p className="text-fg-subtle text-xs text-center">+ {insights.length - 10} {isArabic ? 'تنبيهات أخرى' : 'more alerts'}</p>
      )}
    </div>
  )
}