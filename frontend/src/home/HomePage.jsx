import { useMemo } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { useLanguage } from '../context/LanguageContext'
import { SkeletonList } from '../components/Skeleton'
import DayTimeline from '../components/DayTimeline'
import { scheduledGroupsFor, todayLocalISO, weekdayName, weekdayOfISO, formatDayLabel } from '../lib/dateUtils'

const AR_TIME = (t) => {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  if (Number.isNaN(h)) return String(t)
  const period = h < 12 ? 'ص' : 'م'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${period}`
}

// Home = the launchpad of the daily workflow. Exactly 3 stats + the selected
// day's sessions (brief §2). The DayTimeline drives which day is shown; all
// data is already in the store, so switching days costs zero network calls.
export default function HomePage() {
  const { loading, students, lessonSessions, todayGroups, groupMeta, countsForLesson, allAttendance, isArabic } = useWorkspace()
  const ui = useUI()
  const { isArabic: ar } = useLanguage()
  void isArabic

  const selectedDay = ui.selectedDay
  const today = todayLocalISO()

  // Accurate counts for ANY day's lesson from the cached attendance rows
  // (allAttendance is realtime-fed) — no refetch, works for past days too.
  const countsForSession = useMemo(() => {
    const byGroup = new Map()
    students.forEach((s) => {
      if (!byGroup.has(s.group_name)) byGroup.set(s.group_name, [])
      byGroup.get(s.group_name).push(s)
    })
    return (lesson, groupName) => {
      const list = byGroup.get(groupName) || []
      const byStudent = {}
      if (lesson) {
        allAttendance.forEach((r) => {
          if (r.lesson_session_id === lesson.id && !byStudent[r.student_id]) byStudent[r.student_id] = r
        })
      }
      let present = 0, absent = 0, unrecorded = 0, hwDone = 0, hwApplicable = 0
      list.forEach((s) => {
        const att = byStudent[s.id]?.status || 'لم يرصد'
        const hw = byStudent[s.id]?.homework_status || 'لم يرصد'
        if (att === 'حاضر') present++
        else if (att === 'غائب') absent++
        else unrecorded++
        if (att !== 'غائب') {
          hwApplicable++
          if (hw === 'مكتمل' || hw === 'تم') hwDone++
        }
      })
      return { present, absent, unrecorded, total: list.length, hwDone, hwApplicable }
    }
  }, [students, allAttendance])

  const sessions = useMemo(() => {
    const names = new Set()
    // Groups scheduled on the selected weekday (group_meta.day) always show.
    scheduledGroupsFor(groupMeta, selectedDay).forEach((g) => names.add(g))
    // Groups with a lesson on that date but no schedule entry still show.
    lessonSessions.forEach((l) => { if (l.session_date === selectedDay) names.add(l.group_name) })
    return [...names].map((groupName) => {
      const lesson = lessonSessions.find((l) => l.group_name === groupName && l.session_date === selectedDay)
      const scheduled = todayGroups.find((g) => g.group_name === groupName)
      const meta = groupMeta[groupName] || {}
      const groupStudents = students.filter((s) => s.group_name === groupName)
      const counts = lesson ? countsForSession(lesson, groupName) : { present: 0, absent: 0, unrecorded: groupStudents.length, total: groupStudents.length, hwDone: 0, hwApplicable: 0 }
      let status = 'not_started'
      if (lesson?.status === 'open') status = 'in_progress'
      else if (lesson?.status === 'completed') status = 'completed'
      const time = scheduled?.lesson_time || meta.time || lesson?.started_at?.slice(11, 16)
      const marked = counts.present + counts.absent
      return {
        groupName,
        stage: meta.stage || lesson?.stage || groupStudents[0]?.stage || '',
        time,
        studentCount: groupStudents.length,
        status,
        counts,
        marked,
        lessonId: lesson?.id || null,
        lesson,
      }
    }).sort((a, b) => {
      const order = { in_progress: 0, not_started: 1, completed: 2 }
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
      return String(a.time || '').localeCompare(String(b.time || ''))
    })
  }, [todayGroups, lessonSessions, groupMeta, students, countsForSession, selectedDay])

  const stats = useMemo(() => {
    const sessionsToday = sessions.length
    const studentsToday = sessions.reduce((sum, s) => sum + s.studentCount, 0)
    let pending = 0
    sessions.forEach((s) => {
      if (s.status === 'in_progress') pending += s.counts.unrecorded
      else if (s.status === 'not_started') pending += s.studentCount
    })
    return { sessionsToday, studentsToday, pending }
  }, [sessions])

  const statusPill = (status) => {
    if (status === 'in_progress') return <span className="nk-pill nk-pill-live">● {ar ? 'جارية الآن' : 'In progress'}</span>
    if (status === 'completed') return <span className="nk-pill nk-pill-done">✓ {ar ? 'منتهية' : 'Completed'}</span>
    return <span className="nk-pill nk-pill-pending">○ {ar ? 'لم تبدأ' : 'Not started'}</span>
  }

  // Today: open-or-reuse (existing server-authoritative flow). Other days:
  // only saved sessions open (view-only review) — never creates sessions.
  const openDaySession = (s) => {
    if (selectedDay === today) ui.openSession({ groupId: s.groupName })
    else if (s.lessonId) ui.openSession({ groupId: s.groupName, date: selectedDay })
  }

  if (loading) {
    return (
      <div className="pt-2">
        <div className="nk-skeleton h-24 w-full mb-5" />
        <div className="nk-skeleton h-14 w-full mb-4" />
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="nk-skeleton h-24" /><div className="nk-skeleton h-24" /><div className="nk-skeleton h-24" />
        </div>
        <SkeletonList rows={3} />
      </div>
    )
  }

  const dayIsToday = selectedDay === today
  // THE NEXT SESSION (UX round) — the one the teacher is most likely supposed
  // to open: sessions are sorted in_progress -> not_started -> completed (time
  // within each group), so the first non-completed one IS next. Distinct
  // gold treatment + badge - never just a tiny icon. Today only.
  const nextKey = dayIsToday && sessions.length && sessions[0].status !== 'completed' ? sessions[0].groupName : null
  const heading = dayIsToday ? (ar ? 'حصص اليوم' : "Today's sessions") : (ar ? `حصص ${weekdayName(weekdayOfISO(selectedDay), true)}` : `Sessions · ${formatDayLabel(selectedDay, false)}`)

  return (
    <div>
      {/* Hero */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <div className="eyebrow font-black tracking-widest text-[.66rem]" style={{ color: 'var(--brand-gold)' }}>
            {ar ? 'مسار الحصص' : 'SESSION PIPELINE'}
          </div>
          <h1 className="text-[1.55rem] sm:text-[1.8rem] font-black mt-1.5 mb-1 leading-snug">
            {ar ? 'يومك الدراسي في مسار واحد' : 'Your school day in one pipeline'}
          </h1>
          <p className="text-[.8rem] text-fg-muted m-0">
            {ar ? 'اختر اليوم، افتح الحصة، أنجز المطلوب، وأغلقها بدون التنقل بين شاشات كثيرة.' : 'Pick a day, open a session, work through it, finish — without page hopping.'}
          </p>
        </div>
        <span className="nk-pill nk-pill-gold">✦ {ar ? 'تجربة المسار الجديدة' : 'New pipeline'}</span>
      </div>

      {/* Day timeline (brief §2) */}
      <DayTimeline value={selectedDay} onChange={ui.setSelectedDay} isArabic={ar} />

      {/* Exactly 3 stats */}
      <div className="grid grid-cols-3 gap-3 mb-6 mt-4">
        <div className="nk-stat">
          <small>{dayIsToday ? (ar ? 'حصص اليوم' : "Today's sessions") : (ar ? 'حصص اليوم المحدد' : 'Selected-day sessions')}</small>
          <strong>{stats.sessionsToday}</strong>
        </div>
        <div className="nk-stat">
          <small>{dayIsToday ? (ar ? 'طلاب اليوم' : 'Students today') : (ar ? 'طلاب اليوم المحدد' : 'Students that day')}</small>
          <strong>{stats.studentsToday}</strong>
        </div>
        <div className="nk-stat nk-stat--gold">
          <small>{ar ? 'إجراءات معلقة' : 'Pending actions'}</small>
          <strong>{stats.pending}</strong>
        </div>
      </div>

      {/* Selected day's sessions */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[.98rem] font-extrabold m-0">{heading}</h2>
        <span className="text-[.68rem] text-fg-muted">{ar ? 'اضغط على الحصة لفتح مساحة العمل' : 'Tap a session to open its workspace'}</span>
      </div>

      {sessions.length === 0 ? (
        <div className="nk-content text-center py-10">
          <div className="text-3xl mb-2" aria-hidden="true">▦</div>
          <p className="font-extrabold mb-1">
            {dayIsToday ? (ar ? 'لا توجد حصص مجدولة اليوم' : 'No sessions scheduled today') : (ar ? 'لا توجد حصص في هذا اليوم' : 'No sessions on this day')}
          </p>
          <p className="text-[.78rem] text-fg-muted m-0">
            {dayIsToday
              ? (ar ? 'أضف مواعيد المجموعات من الإعدادات ← جدول الأسبوع.' : 'Add group schedules from Settings → weekly schedule.')
              : (ar ? 'اختر يومًا آخر من الشريط الزمني بالأعلى.' : 'Pick another day from the timeline above.')}
          </p>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {sessions.map((s) => {
            const clickable = dayIsToday || Boolean(s.lessonId)
            const noLessonPast = !dayIsToday && !s.lessonId
            return (
              <button
                key={s.groupName}
                className={`nk-session-card ${s.groupName === nextKey ? 'nk-session-card--next' : ''}`}
                onClick={() => openDaySession(s)}
                disabled={noLessonPast}
                style={noLessonPast ? { opacity: 0.62, cursor: 'default' } : undefined}
                aria-label={`${ar ? 'فتح' : 'Open'} ${s.groupName}`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="nk-session-icon" aria-hidden="true">⌂</span>
                  <span className="min-w-0">
                    {s.groupName === nextKey && (
                      <span className="nk-next-badge mb-1.5">
                        {s.status === 'in_progress'
                          ? (ar ? '▶ أكمل هذه الحصة الآن' : '▶ Continue this session now')
                          : (ar ? '★ الحصة القادمة' : '★ Next session')}
                      </span>
                    )}
                    <b className="block text-[.88rem] truncate">{s.groupName}</b>
                    <small className="block text-[.7rem] text-fg-muted mt-1 truncate">
                      {s.stage ? `${s.stage} · ` : ''}{s.time ? AR_TIME(s.time) : ''}{s.studentCount ? ` · ${s.studentCount} ${ar ? 'طالب' : 'students'}` : ''}
                    </small>
                    {(s.status === 'in_progress' || (s.status === 'completed' && s.marked > 0)) && (
                      <span className="flex items-center gap-2 mt-1.5">
                        <span className="nk-bar nk-bar--ok w-24"><span style={{ width: `${s.studentCount ? Math.round((s.marked / s.studentCount) * 100) : 0}%` }} /></span>
                        <span className="text-[.64rem] text-fg-muted">{s.marked}/{s.studentCount} {ar ? 'مرصد' : 'marked'}</span>
                      </span>
                    )}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1.5 shrink-0">
                  {noLessonPast
                    ? <span className="nk-pill nk-pill-neutral">— {ar ? 'لا حصة' : 'No session'}</span>
                    : statusPill(s.status)}
                  <span className="text-[.66rem] font-extrabold" style={{ color: 'var(--brand-gold)' }}>
                    {noLessonPast
                      ? ''
                      : s.status === 'not_started'
                        ? (ar ? 'فتح الحصة ←' : 'Open →')
                        : s.status === 'in_progress'
                          ? (ar ? 'متابعة ←' : 'Resume →')
                          : (ar ? 'عرض ←' : 'View →')}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Attention (automation, rule 18) — today's running sessions only */}
      {dayIsToday && sessions.some((s) => s.status === 'in_progress' && s.counts.unrecorded > 0) && (
        <div className="nk-notice mt-5">
          ⚠ {ar ? 'حصص جارية لديها طلاب لم يُرصد حضورهم بعد — لا يمنع ذلك التقدم، لكن راجعهم قبل الإنهاء.' : 'Running sessions still have unrecorded students — this never blocks progress, but review them before finishing.'}
        </div>
      )}
    </div>
  )
}
