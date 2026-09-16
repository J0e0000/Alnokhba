import { useMemo } from 'react'

const STAGES = [
  { key: 'attendance', label: 'الحضور', icon: 'how_to_reg', section: 'sessions' },
  { key: 'interaction', label: 'التفاعل والواجب', icon: 'edit_note', section: 'students' },
  { key: 'exams', label: 'الامتحانات', icon: 'grading', section: 'exams' },
  { key: 'review', label: 'المراجعة', icon: 'fact_check', section: 'sessions' },
  { key: 'reports', label: 'التقرير', icon: 'summarize', section: 'reports' },
]

function lessonForGroup(lessons, group) {
  const today = new Date().toISOString().slice(0, 10)
  return lessons.find((lesson) => lesson.group_name === group && lesson.session_date === today && lesson.status === 'open')
    || lessons.find((lesson) => lesson.group_name === group && lesson.session_date === today)
}

function statusForLesson(lesson) {
  if (!lesson) return { label: 'لم تبدأ', tone: 'pending' }
  if (lesson.status === 'completed') return { label: 'منتهية', tone: 'done' }
  return { label: 'جارية الآن', tone: 'live' }
}

export default function SessionPipeline({
  mode = 'home',
  groups = [],
  todayGroups = [],
  groupMeta = {},
  lessonSessions = [],
  students = [],
  sessionGroup = '',
  activeLesson = null,
  activeSection = 'dashboard',
  sessionStudents = [],
  sessionAttendanceCounts = { present: 0, absent: 0 },
  lessonAttendanceByStudent = {},
  examScoresByStudent = {},
  onOpenGroup,
  onStage,
}) {
  const visibleGroups = useMemo(() => {
    const scheduled = todayGroups.length ? todayGroups : groups
    return scheduled.filter((group, index, list) => group && list.indexOf(group) === index)
  }, [todayGroups, groups])

  const currentStatus = statusForLesson(activeLesson)
  const attended = sessionAttendanceCounts.present + sessionAttendanceCounts.absent
  const homeworkDone = sessionStudents.filter((student) => ['تم', 'مكتمل', 'مكتملة', 'complete', 'completed'].includes(student.hw_status)).length
  const examCount = sessionStudents.reduce((total, student) => total + (examScoresByStudent[student.id] || []).length, 0)
  const currentStage = activeSection === 'students' ? 'interaction' : activeSection === 'exams' ? 'exams' : activeSection === 'reports' ? 'reports' : 'attendance'

  if (mode === 'home') {
    const totalToday = visibleGroups.reduce((sum, group) => sum + students.filter((student) => student.group_name === group).length, 0)
    const active = visibleGroups.find((group) => lessonForGroup(lessonSessions, group)?.status === 'open')
    const next = visibleGroups.find((group) => group !== active)
    const pending = visibleGroups.filter((group) => !lessonForGroup(lessonSessions, group) || lessonForGroup(lessonSessions, group)?.status !== 'completed').length
    return (
      <section className="space-y-4" dir="rtl">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-gold-hover">NOKHBA SESSION OS</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-fg">يومك الدراسي في مسار واحد</h2>
            <p className="mt-1 text-xs text-fg-subtle">افتح الحصة، أنجز المطلوب، وأغلقها بدون التنقل بين شاشات كثيرة.</p>
          </div>
          <span className="hidden rounded-full border border-brand-gold/30 bg-brand-gold/10 px-3 py-1 text-[11px] font-bold text-brand-gold-hover sm:inline-flex">{new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Metric label="حصص اليوم" value={visibleGroups.length} icon="calendar_today" />
          <Metric label="طلاب اليوم" value={totalToday} icon="groups" />
          <Metric label="إجراءات معلقة" value={pending} icon="pending_actions" tone="gold" />
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-fg">حصص اليوم</h3>
          {active && <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400"><i className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> حصة جارية</span>}
        </div>
        <div className="space-y-2">
          {visibleGroups.length === 0 && <div className="rounded-2xl border border-dashed border-subtle bg-surface/50 p-6 text-center text-sm text-fg-subtle">لا توجد حصص مجدولة لليوم. يمكنك اختيار مجموعة من تبويب الحصص.</div>}
          {visibleGroups.map((group) => {
            const lesson = lessonForGroup(lessonSessions, group)
            const status = statusForLesson(lesson)
            const count = students.filter((student) => student.group_name === group).length
            const meta = groupMeta[group] || {}
            return <button key={group} type="button" onClick={() => onOpenGroup(group)} className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-subtle bg-surface/80 p-4 text-start transition hover:-translate-y-0.5 hover:border-brand-gold/50 hover:bg-brand-gold/5">
              <span className="flex min-w-0 items-center gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${status.tone === 'live' ? 'bg-emerald-500/15 text-emerald-300' : status.tone === 'done' ? 'bg-sky-500/15 text-sky-300' : 'bg-brand-gold/10 text-brand-gold-hover'}`}><span className="material-symbols-outlined">school</span></span>
                <span className="min-w-0"><strong className="block truncate text-sm font-black text-fg">{group}</strong><small className="mt-1 block truncate text-[11px] text-fg-subtle">{meta.time || 'موعد غير محدد'} · {count} طالب</small></span>
              </span>
              <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${status.tone === 'live' ? 'bg-emerald-500/15 text-emerald-300' : status.tone === 'done' ? 'bg-sky-500/15 text-sky-300' : 'bg-brand-gold/10 text-brand-gold-hover'}`}>{status.label}</span>
            </button>
          })}
        </div>
        {next && !active && <p className="text-center text-[11px] text-fg-subtle">اضغط على أي حصة لفتح الـ workspace والبدء.</p>}
      </section>
    )
  }

  return (
    <section className="space-y-4" dir="rtl">
      <div className="rounded-3xl border border-brand-gold/20 bg-gradient-to-br from-brand-navy/80 via-surface to-brand-gold/5 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3"><button type="button" onClick={() => onStage('dashboard')} className="flex h-9 w-9 items-center justify-center rounded-xl border border-subtle bg-surface/70 text-fg-subtle hover:border-brand-gold/50"><span className="material-symbols-outlined">arrow_forward</span></button><div><p className="text-[11px] font-bold tracking-[0.15em] text-brand-gold-hover">SESSION WORKSPACE</p><h2 className="mt-1 text-xl font-black text-fg">{sessionGroup || 'اختر مجموعة لبدء الحصة'}</h2><p className="mt-1 text-xs text-fg-subtle">{activeLesson ? `${currentStatus.label} · ${new Date(activeLesson.session_date).toLocaleDateString('ar-EG')}` : 'كل خطوات الحصة في مساحة واحدة'}</p></div></div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-black ${currentStatus.tone === 'live' ? 'bg-emerald-500/15 text-emerald-300' : currentStatus.tone === 'done' ? 'bg-sky-500/15 text-sky-300' : 'bg-brand-gold/10 text-brand-gold-hover'}`}>{currentStatus.label}</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5"><MiniMetric label="الطلاب" value={sessionStudents.length} /><MiniMetric label="الحضور" value={`${attended}/${sessionStudents.length}`} /><MiniMetric label="الواجب" value={`${homeworkDone}/${sessionAttendanceCounts.present}`} /><MiniMetric label="الدرجات" value={examCount || '—'} /><MiniMetric label="الحالة" value={activeLesson?.status === 'completed' ? 'مغلقة' : 'مفتوحة'} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{STAGES.map((stage, index) => { const active = currentStage === stage.key; const filled = index === 0 ? attended > 0 : stage.key === 'interaction' ? homeworkDone > 0 : stage.key === 'exams' ? examCount > 0 : stage.key === 'reports' ? activeLesson?.status === 'completed' : activeLesson?.status === 'completed'; return <button type="button" key={stage.key} onClick={() => onStage(stage.section)} className={`relative flex items-center gap-2 rounded-2xl border px-3 py-3 text-start transition ${active ? 'border-brand-gold bg-brand-gold/15 text-brand-gold-hover shadow-sm' : filled ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-subtle bg-surface/70 text-fg-subtle hover:border-brand-gold/40'}`}><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/10 text-xs font-black">{filled && !active ? '✓' : index + 1}</span><span className="min-w-0"><span className="block truncate text-xs font-black">{stage.label}</span><span className="mt-0.5 block truncate text-[10px] opacity-70">{active ? 'أنت هنا' : filled ? 'مكتمل جزئيًا' : 'جاهز'}</span></span></button> })}</div>
    </section>
  )
}

function Metric({ label, value, icon, tone = 'default' }) { return <div className={`rounded-2xl border p-3 ${tone === 'gold' ? 'border-brand-gold/35 bg-brand-gold/10' : 'border-subtle bg-surface/80'}`}><span className="material-symbols-outlined text-lg text-brand-gold-hover">{icon}</span><strong className="mt-1 block text-xl font-black text-fg">{value}</strong><small className="mt-0.5 block text-[10px] font-bold text-fg-subtle">{label}</small></div> }
function MiniMetric({ label, value }) { return <div className="rounded-xl border border-subtle bg-black/5 px-3 py-2"><small className="block text-[10px] font-bold text-fg-subtle">{label}</small><strong className="mt-1 block truncate text-sm font-black text-fg">{value}</strong></div> }

export { STAGES }
