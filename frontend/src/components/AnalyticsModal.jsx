import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { checkAcademicWarning } from '../lib/helpers'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useRef } from 'react'
import { animate, stagger, useAnimeScope } from '../lib/animeMotion'

const safeNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const dateKey = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

const displayDate = (value) => {
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })
}

function MetricCard({ icon, label, value, hint, tone = 'teal' }) {
  return (
    <div className={`analytics-metric analytics-metric-${tone}`}>
      <div className="flex items-center justify-between gap-3"><span className="text-2xl" aria-hidden="true">{icon}</span><span className="text-xs font-bold text-fg-subtle">{label}</span></div>
      <p className="mt-3 text-3xl font-black text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </div>
  )
}

function ProgressBar({ value, color = '#0f766e' }) {
  const width = Math.max(0, Math.min(100, safeNumber(value)))
  return <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full transition-all" style={{ width: `${width}%`, background: color }} /></div>
}

function EmptyState({ title, text }) {
  return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center"><p className="font-black text-fg">{title}</p><p className="mt-1 text-xs leading-6 text-fg-muted">{text}</p></div>
}

export default function AnalyticsModal({ open, onClose, students = [], examScoresByStudent = {} }) {
  const root = useRef(null)
  const { effectiveTeacherId } = useAuth()
  useAnimeScope(root, () => {
    animate('.analytics-metric', { opacity: [0, 1], translateY: [10, 0], delay: stagger(50, { start: 80 }), duration: 420, ease: 'out(3)' })
    animate('.analytics-panel', { opacity: [0, 1], translateY: [12, 0], delay: stagger(60, { start: 180 }), duration: 460, ease: 'out(3)' })
  }, [open])
  const safeStudents = useMemo(() => (Array.isArray(students) ? students : []).filter(Boolean), [students])
  const safeExamScores = examScoresByStudent && typeof examScoresByStudent === 'object' ? examScoresByStudent : {}
  const [attendanceRows, setAttendanceRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    const loadAttendance = async () => {
      setLoading(true)
      setLoadError('')
      const since = new Date()
      since.setDate(since.getDate() - 30)
      try {
        if (!effectiveTeacherId) {
          if (!cancelled) setAttendanceRows([])
          return
        }
        const { data, error } = await supabase
          .from('attendance_records')
          .select('status, recorded_at, student_id')
          .eq('teacher_id', effectiveTeacherId)
          .gte('recorded_at', since.toISOString())
          .order('recorded_at', { ascending: true })
          .limit(5000)
        if (error) throw error
        if (!cancelled) setAttendanceRows(Array.isArray(data) ? data : [])
      } catch (error) {
        console.warn('[AnalyticsModal] attendance query failed:', error?.message || error)
        if (!cancelled) {
          setAttendanceRows([])
          setLoadError('تعذر تحميل سجل الحضور، لكن تم عرض تحليلات الطلاب المتاحة.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadAttendance()
    return () => { cancelled = true }
  }, [open, effectiveTeacherId])

  const metrics = useMemo(() => {
    const present = attendanceRows.filter((row) => row.status === 'حاضر').length
    const absent = attendanceRows.filter((row) => row.status === 'غائب').length
    const recorded = present + absent
    const points = safeStudents.map((student) => safeNumber(student.points))
    const examValues = Object.values(safeExamScores).flatMap((rows) => (Array.isArray(rows) ? rows : [])).map((row) => safeNumber(row.total_score ?? row.total ?? row.score)).filter((value) => value > 0)
    const averagePoints = points.length ? Math.round(points.reduce((sum, value) => sum + value, 0) / points.length) : 0
    const averageExam = examValues.length ? Math.round(examValues.reduce((sum, value) => sum + value, 0) / examValues.length) : 0
    const warnings = safeStudents.filter((student) => safeNumber(student.warnings) > 0).length
    return { present, absent, recorded, attendanceRate: recorded ? Math.round((present / recorded) * 100) : 0, averagePoints, averageExam, warnings }
  }, [attendanceRows, safeStudents, safeExamScores])

  const trend = useMemo(() => {
    const grouped = {}
    attendanceRows.forEach((row) => {
      const key = dateKey(row.recorded_at)
      if (!key) return
      if (!grouped[key]) grouped[key] = { present: 0, absent: 0 }
      if (row.status === 'حاضر') grouped[key].present += 1
      if (row.status === 'غائب') grouped[key].absent += 1
    })
    return Object.entries(grouped).slice(-10).map(([date, values]) => ({ date, ...values, total: values.present + values.absent, rate: values.present + values.absent ? Math.round((values.present / (values.present + values.absent)) * 100) : 0 }))
  }, [attendanceRows])

  const groupStats = useMemo(() => {
    const grouped = {}
    safeStudents.forEach((student) => {
      const name = student.group_name || 'بدون مجموعة'
      if (!grouped[name]) grouped[name] = { name, count: 0, points: 0, warnings: 0 }
      grouped[name].count += 1
      grouped[name].points += safeNumber(student.points)
      grouped[name].warnings += safeNumber(student.warnings)
    })
    return Object.values(grouped).map((group) => ({ ...group, average: group.count ? Math.round(group.points / group.count) : 0 })).sort((a, b) => b.average - a.average)
  }, [safeStudents])

  const stageStats = useMemo(() => {
    const grouped = {}
    safeStudents.forEach((student) => {
      const stage = student.stage || 'غير محدد'
      grouped[stage] = (grouped[stage] || 0) + 1
    })
    return Object.entries(grouped).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [safeStudents])

  const atRisk = useMemo(() => safeStudents.filter((student) => safeNumber(student.points) < 0 || safeNumber(student.warnings) >= 3 || checkAcademicWarning(safeExamScores[student.id] || [])).sort((a, b) => safeNumber(a.points) - safeNumber(b.points)).slice(0, 8), [safeStudents, safeExamScores])
  const topStudents = useMemo(() => [...safeStudents].sort((a, b) => safeNumber(b.points) - safeNumber(a.points)).slice(0, 5), [safeStudents])

  return (
    <Modal open={open} onClose={onClose} title="📊 لوحة التحليل" wide>
      <div ref={root} className="analytics-dashboard" dir="rtl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xl font-black text-fg">صورة واضحة عن أداء الطلاب</p><p className="mt-1 text-sm text-fg-muted">تحليل آخر 30 يومًا، مع ملخص للمجموعات والدرجات والتنبيهات.</p></div>
          <span className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700">{safeStudents.length} طالب</span>
        </div>
        {loadError && <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">{loadError}</div>}
        {loading ? <div className="py-12 text-center text-sm font-bold text-fg-muted">جاري تجهيز التحليل...</div> : safeStudents.length === 0 ? <EmptyState title="لا توجد بيانات طلاب بعد" text="أضف الطلاب وسجّل الحضور أو الدرجات حتى تظهر لوحة التحليل هنا." /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 analytics-metrics">
              <MetricCard icon="👥" label="إجمالي الطلاب" value={safeStudents.length} hint={`${groupStats.length} مجموعة`} />
              <MetricCard icon="✅" label="نسبة الحضور" value={`${metrics.attendanceRate}%`} hint={`${metrics.present} حضور من ${metrics.recorded} تسجيل`} tone="green" />
              <MetricCard icon="🎯" label="متوسط النقاط" value={metrics.averagePoints} hint="من نقاط التفاعل والسلوك" tone="purple" />
              <MetricCard icon="⚠️" label="طلاب يحتاجون متابعة" value={metrics.warnings} hint={atRisk.length ? `أقرب متابعة: ${atRisk[0]?.name || '—'}` : 'الوضع مستقر'} tone="amber" />
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
              <section className="analytics-panel"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black text-fg">اتجاه الحضور</h3><p className="text-xs text-fg-muted">آخر {trend.length || 0} أيام بها تسجيلات</p></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-fg-muted">30 يوم</span></div>{trend.length ? <div className="space-y-3">{trend.map((day) => <div key={day.date} className="grid grid-cols-[58px_1fr_42px] items-center gap-3"><span className="text-[11px] font-bold text-fg-muted">{displayDate(day.date)}</span><div><ProgressBar value={day.rate} color={day.rate >= 75 ? '#15803d' : day.rate >= 50 ? '#d97706' : '#be123c'} /><div className="mt-1 flex justify-between text-[10px] text-fg-subtle"><span>حاضر {day.present}</span><span>غائب {day.absent}</span></div></div><strong className="text-xs text-fg">{day.rate}%</strong></div>)}</div> : <EmptyState title="لا يوجد سجل حضور كافٍ" text="بعد تسجيل الحضور ستظهر لك حركة الحضور اليومية هنا." />}</section>
              <section className="analytics-panel"><h3 className="font-black text-fg">ملخص الدرجات</h3><p className="mt-1 text-xs text-fg-muted">مؤشرات الأداء الأكاديمي</p><div className="mt-5 space-y-4"><div><div className="mb-1 flex justify-between text-xs font-bold"><span>متوسط الامتحانات</span><span>{metrics.averageExam || '—'}</span></div><ProgressBar value={metrics.averageExam} color="#6d28d9" /></div><div><div className="mb-1 flex justify-between text-xs font-bold"><span>متوسط النقاط</span><span>{metrics.averagePoints}</span></div><ProgressBar value={Math.max(0, Math.min(100, metrics.averagePoints))} color="#0f766e" /></div><div className="rounded-xl bg-slate-50 p-3 text-xs leading-6 text-fg-muted">{metrics.averageExam >= 85 ? 'مستوى الامتحانات ممتاز. ركّز على تثبيت الأداء.' : metrics.averageExam >= 60 ? 'المستوى متوسط. حدّد الطلاب الأقل واستعمل المتابعة الفردية.' : metrics.averageExam ? 'هناك فرصة واضحة للتحسين. راجع الطلاب الأقل أداءً أولًا.' : 'أضف نتائج امتحانات حتى يظهر التحليل الأكاديمي.'}</div></div></section>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="analytics-panel"><h3 className="font-black text-fg">أداء المجموعات</h3><p className="mb-4 mt-1 text-xs text-fg-muted">عدد الطلاب ومتوسط النقاط والإنذارات</p>{groupStats.length ? <div className="space-y-3">{groupStats.slice(0, 8).map((group) => <div key={group.name}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="truncate font-bold text-fg">{group.name}</span><span className="shrink-0 text-fg-muted">{group.count} طالب · {group.average} نقطة</span></div><ProgressBar value={Math.max(0, Math.min(100, group.average))} color="#0f766e" /></div>)}</div> : <EmptyState title="لا توجد مجموعات" text="اربط الطلاب بمجموعات لعرض المقارنة." />}</section>
              <section className="analytics-panel"><h3 className="font-black text-fg">توزيع المراحل</h3><p className="mb-4 mt-1 text-xs text-fg-muted">توزيع الطلاب حسب المرحلة الدراسية</p>{stageStats.length ? <div className="space-y-3">{stageStats.slice(0, 8).map((stage) => <div key={stage.name}><div className="mb-1 flex justify-between text-xs"><span className="font-bold text-fg">{stage.name}</span><span className="text-fg-muted">{stage.count}</span></div><ProgressBar value={safeStudents.length ? (stage.count / safeStudents.length) * 100 : 0} color="#d97706" /></div>)}</div> : <EmptyState title="لا توجد مراحل محددة" text="أضف المرحلة في بيانات الطلاب لعرض التوزيع." />}</section>
            </div>

            <div className="grid gap-5 lg:grid-cols-2"><section className="analytics-panel"><h3 className="font-black text-fg">🏆 أعلى الطلاب نقاطًا</h3><div className="mt-3 space-y-2">{topStudents.length ? topStudents.map((student, index) => <div key={student.id || index} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span><b className="ml-2 text-teal-700">#{index + 1}</b>{student.name || 'طالب'}</span><strong className="text-teal-700">{safeNumber(student.points)}</strong></div>) : <EmptyState title="لا توجد نقاط بعد" text="سجّل تفاعلًا أو درجات حتى يظهر الترتيب." />}</div></section><section className="analytics-panel"><h3 className="font-black text-fg">⚠️ قائمة المتابعة</h3><div className="mt-3 space-y-2">{atRisk.length ? atRisk.map((student) => <div key={student.id} className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm"><span>{student.name || 'طالب'}</span><span className="text-xs font-bold text-rose-700">{safeNumber(student.warnings)} إنذار · {safeNumber(student.points)} نقطة</span></div>) : <EmptyState title="لا توجد حالات حرجة" text="لا يوجد حاليًا طالب يحتاج إلى متابعة عاجلة." />}</div></section></div>
          </div>
        )}
      </div>
    </Modal>
  )
}
