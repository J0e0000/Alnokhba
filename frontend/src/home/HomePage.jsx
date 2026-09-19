import { useMemo } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { useLanguage } from '../context/LanguageContext'
import { SkeletonList } from '../components/Skeleton'

const AR_TIME = (t) => {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  if (Number.isNaN(h)) return String(t)
  const period = h < 12 ? 'ص' : 'م'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${period}`
}

// Home = the launchpad of the daily workflow. Exactly 3 stats + Today's
// Sessions (rule 4). Each session card → ONE Session Workspace.
export default function HomePage() {
  const { loading, students, lessonSessions, todayGroups, groupMeta, countsForLesson, isArabic } = useWorkspace()
  const ui = useUI()
  const { isArabic: ar } = useLanguage()
  void isArabic

  const today = new Date().toISOString().slice(0, 10)

  const sessions = useMemo(() => {
    const names = new Set(todayGroups.map((g) => g.group_name))
    // groups scheduled today always show; groups with a lesson today but no
    // schedule entry still show (defensive: session opened manually).
    lessonSessions.forEach((l) => { if (l.session_date === today) names.add(l.group_name) })
    return [...names].map((groupName) => {
      const lesson = lessonSessions.find((l) => l.group_name === groupName && l.session_date === today)
      const scheduled = todayGroups.find((g) => g.group_name === groupName)
      const meta = groupMeta[groupName] || {}
      const groupStudents = students.filter((s) => s.group_name === groupName)
      const counts = countsForLesson(groupName)
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
  }, [todayGroups, lessonSessions, groupMeta, students, countsForLesson, today])

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

  // THE NEXT SESSION — the one the teacher is most likely supposed to open.
  // Sessions are already sorted in_progress → not_started → completed (time
  // within each group), so the first non-completed session IS the next one.
  // It gets a distinct visual treatment (gold card + badge), never just an
  // icon — the hierarchy must be recognizable at a glance.
  const nextKey = sessions.length && sessions[0].status !== 'completed' ? sessions[0].groupName : null

  if (loading) {
    return (
      <div className="pt-2">
        <div className="nk-skeleton h-24 w-full mb-5" />
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="nk-skeleton h-24" /><div className="nk-skeleton h-24" /><div className="nk-skeleton h-24" />
        </div>
        <SkeletonList rows={3} />
      </div>
    )
  }

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
            {ar ? 'افتح الحصة، أنجز المطلوب، وأغلقها بدون التنقل بين شاشات كثيرة.' : 'Open a session, work through it, finish — without page hopping.'}
          </p>
        </div>
        <span className="nk-pill nk-pill-gold">✦ {ar ? 'تجربة المسار الجديدة' : 'New pipeline'}</span>
      </div>

      {/* Exactly 3 stats */}
      <div className="grid grid-cols-3 gap-3 mb-6" data-tour="stats">
        <div className="nk-stat">
          <small>{ar ? 'حصص اليوم' : "Today's sessions"}</small>
          <strong>{stats.sessionsToday}</strong>
        </div>
        <div className="nk-stat">
          <small>{ar ? 'طلاب اليوم' : "Students today"}</small>
          <strong>{stats.studentsToday}</strong>
        </div>
        <div className="nk-stat nk-stat--gold">
          <small>{ar ? 'إجراءات معلقة' : 'Pending actions'}</small>
          <strong>{stats.pending}</strong>
        </div>
      </div>

      {/* Today's Sessions */}
      <div className="flex items-center justify-between mb-3" data-tour="today-sessions">
        <h2 className="text-[.98rem] font-extrabold m-0">{ar ? 'حصص اليوم' : "Today's sessions"}</h2>
        <span className="text-[.68rem] text-fg-muted">{ar ? 'اضغط على الحصة لفتح مساحة العمل' : 'Tap a session to open its workspace'}</span>
      </div>

      {sessions.length === 0 ? (
        <div className="nk-content text-center py-10">
          <div className="text-3xl mb-2" aria-hidden="true">▦</div>
          <p className="font-extrabold mb-1">{ar ? 'لا توجد حصص مجدولة اليوم' : 'No sessions scheduled today'}</p>
          <p className="text-[.78rem] text-fg-muted m-0">{ar ? 'أضف مواعيد المجموعات من الإعدادات ← جدول الأسبوع.' : 'Add group schedules from Settings → weekly schedule.'}</p>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {sessions.map((s) => {
            const isNext = s.groupName === nextKey
            return (
              <button
                key={s.groupName}
                className={`nk-session-card ${isNext ? 'nk-session-card--next' : ''}`}
                onClick={() => ui.openSession({ groupId: s.groupName })}
                aria-label={`${ar ? 'فتح' : 'Open'} ${s.groupName}`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="nk-session-icon" aria-hidden="true">⌂</span>
                  <span className="min-w-0">
                    {isNext && (
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
                    {s.status === 'in_progress' && (
                      <span className="flex items-center gap-2 mt-1.5">
                        <span className="nk-bar nk-bar--ok w-24"><span style={{ width: `${s.studentCount ? Math.round((s.marked / s.studentCount) * 100) : 0}%` }} /></span>
                        <span className="text-[.64rem] text-fg-muted">{s.marked}/{s.studentCount} {ar ? 'مرصد' : 'marked'}</span>
                      </span>
                    )}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1.5 shrink-0">
                  {statusPill(s.status)}
                  <span className="text-[.66rem] font-extrabold" style={{ color: 'var(--brand-gold)' }}>
                    {s.status === 'not_started' ? (ar ? 'فتح الحصة ←' : 'Open →') : s.status === 'in_progress' ? (ar ? 'متابعة ←' : 'Resume →') : (ar ? 'عرض ←' : 'View →')}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Attention (automation, rule 18) */}
      {sessions.some((s) => s.status === 'in_progress' && s.counts.unrecorded > 0) && (
        <div className="nk-notice mt-5">
          ⚠ {ar ? 'حصص جارية لديها طلاب لم يُرصد حضورهم بعد — افتح الحصة وأكمل الرصد قبل الإنهاء.' : 'Running sessions still have unrecorded students — finish marking before finalizing.'}
        </div>
      )}
    </div>
  )
}
