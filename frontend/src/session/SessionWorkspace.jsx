import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useWorkspace, useWorkspaceMeta } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { useAuth } from '../context/AuthContext'
import useIsMobile from '../shell/useIsMobile'
import { useStageState, readStageState } from './useStageState'
import AttendanceTab from './tabs/AttendanceTab'
import InteractionHomeworkTab from './tabs/InteractionHomeworkTab'
import ExamsTab from './tabs/ExamsTab'
import ReviewTab from './tabs/ReviewTab'
import ReportTab from './tabs/ReportTab'
import WorkflowBar from './WorkflowBar'

// ═══════════════════════════════════════════════════════════════════════════
// SESSION WORKSPACE — the core experience (rules 5–14).
// ONE unified workspace per session: persistent summary + pipeline tabs.
// The pipeline is NOT a wizard: any tab can be visited in any order, work is
// saved explicitly (SAVE) and the session is closed explicitly (FINISH).
// Session state is always server-authoritative — resume = refetch.
// ═══════════════════════════════════════════════════════════════════════════

const TABS = [
  { key: 'attendance', n: 1, title: 'الحضور', sub: 'سجّل حاضر وغائب', titleEn: 'Attendance', subEn: 'Mark present / absent' },
  { key: 'interaction', n: 2, title: 'التفاعل والواجب', sub: 'للحاضرين فقط', titleEn: 'Interaction + Homework', subEn: 'Present students only' },
  { key: 'exams', n: 3, title: 'الامتحانات', sub: 'الدرجات والتصحيح', titleEn: 'Exams', subEn: 'Grades' },
  { key: 'review', n: 4, title: 'المراجعة', sub: 'راجع قبل الإغلاق', titleEn: 'Review', subEn: 'Check before closing' },
  { key: 'report', n: 5, title: 'التقرير', sub: 'التقرير وإنهاء الحصة', titleEn: 'Report', subEn: 'Report & finish' },
]

export default function SessionWorkspace({ params }) {
  const ws = useWorkspace()
  const wsMeta = useWorkspaceMeta()
  const ui = useUI()
  const { isArabic } = ws
  const { profile } = useAuth()
  const isMobile = useIsMobile()
  const groupId = params?.groupId || ''

  const [tab, setTab] = useState('attendance')
  const [opening, setOpening] = useState(true)

  // TASK STATE (spec 13 + reload-resilience): which stage the teacher
  // EXPLICITLY completed and which tab they were on — persisted per lesson so
  // a reload/backgrounding returns them exactly where they were. Server data
  // (attendance rows, homework, grades) is NOT stored here — refetch wins.
  const [stageState, markStageComplete, setStageTab] = useStageState(ws.activeLessonId)

  // Tab restore + publish. RESTORE uses the render-phase adjustment pattern
  // (React docs: "adjusting state when a prop changes"): the moment the
  // lesson id appears/changes, the tab is set synchronously DURING RENDER —
  // before any effect runs, so no publish can clobber the stored value
  // (StrictMode's double effect pass included). The publish effect then only
  // mirrors USER-initiated tab switches (it skips the restore commit).
  const VALID_TABS = ['attendance', 'interaction', 'exams', 'review', 'report']
  const [restoredLesson, setRestoredLesson] = useState('')
  if (ws.activeLessonId !== restoredLesson) {
    setRestoredLesson(ws.activeLessonId)
    const saved = readStageState(ws.activeLessonId).tab
    setTab(saved && VALID_TABS.includes(saved) ? saved : 'attendance')
  }
  const skipPublishRef = useRef(true)
  useEffect(() => {
    if (skipPublishRef.current) { skipPublishRef.current = false; return }
    if (ws.activeLessonId) setStageTab(tab)
  }, [tab, ws.activeLessonId, setStageTab])

  // PERSISTENT WORKFLOW BAR — rendered HERE at the workspace root (not inside
  // the tab panel) on purpose: a sticky element can never rise above the top
  // of its containing block, so the bar must live in a container that starts
  // near the top of the page. Tabs publish a serializable bar spec + handlers
  // (published only when the spec actually changes — no re-render loops).
  const [bar, setBar] = useState(null) // { data, handlers }
  const publishBar = useCallback((spec) => setBar(spec), [])

  // Resolve the session for this group — server-authoritative open-or-reuse.
  // MUST wait for the store's initial load: calling openLessonForGroup with
  // an empty lessonSessions cache would create a DUPLICATE lesson for the
  // group (open-or-create sees "no lesson today" while the fetch is still
  // in flight). Reload-restore depends on this being correct.
  useEffect(() => {
    let alive = true
    if (!groupId) { setOpening(false); return }
    if (ws.loading) return undefined
    setOpening(true)
    ws.openLessonForGroup(groupId, { silent: true }).finally(() => { if (alive) setOpening(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, ws.loading])

  const lesson = ws.activeLesson
  const lessonOpen = lesson?.status === 'open'
  const lessonCompleted = lesson?.status === 'completed'

  const counts = ws.countsForLesson(groupId)
  const groupStudents = ws.sessionStudentsFor(groupId)

  const sessionExamIds = useMemo(
    () => ws.examsList.filter((e) => e.lesson_session_id === ws.activeLessonId).map((e) => e.id),
    [ws.examsList, ws.activeLessonId],
  )
  const gradedStudents = useMemo(() => {
    if (!sessionExamIds.length) return 0
    const set = new Set()
    Object.values(ws.examScoresByStudent).forEach((list) => list.forEach((s) => { if (sessionExamIds.includes(s.exam_id)) set.add(s.student_id) }))
    return set.size
  }, [sessionExamIds, ws.examScoresByStudent])

  const interactionCount = useMemo(() => {
    let n = 0
    groupStudents.forEach((s) => {
      const logs = ws.todayLogsByStudent[s.id] || []
      if (logs.some((l) => l.points_delta > 0 && /تفاعل|مساعدة|نقاط/.test(l.note || ''))) n++
    })
    return n
  }, [groupStudents, ws.todayLogsByStudent])

  const issues = useMemo(() => {
    const list = []
    if (lessonOpen && counts.unrecorded > 0) list.push(isArabic ? `${counts.unrecorded} طالب لم يُرصد حضورهم` : `${counts.unrecorded} students unrecorded`)
    if (lessonOpen && counts.hwApplicable > counts.hwDone) list.push(isArabic ? `الواجب مكتمل لـ ${counts.hwDone} من ${counts.hwApplicable}` : `Homework done for ${counts.hwDone}/${counts.hwApplicable}`)
    if (!sessionExamIds.length) list.push(isArabic ? 'لا يوجد امتحان مرتبط بهذه الحصة (اختياري)' : 'No exam linked to this session (optional)')
    return list
  }, [lessonOpen, counts, sessionExamIds, isArabic])

  const stepState = useCallback((key) => {
    if (lessonCompleted && key !== 'review') {
      if (key === 'attendance' || key === 'report') return 'done'
      if (key === 'interaction') return counts.hwApplicable > 0 && counts.hwDone >= counts.hwApplicable ? 'done' : 'done'
      if (key === 'exams') return sessionExamIds.length ? 'done' : 'active'
    }
    if (key === 'attendance') {
      // EXPLICIT stage completion (spec 13) — completing the stage is a
      // teacher action, not a percentage of marked students.
      if (stageState.attendanceComplete) return 'done'
      if (counts.unrecorded > 0 && (counts.present || counts.absent)) return 'attention'
      if (counts.unrecorded === 0 && counts.total > 0) return 'done'
      return 'active'
    }
    if (key === 'interaction') {
      if (counts.hwApplicable === 0) return 'active'
      if (counts.hwDone >= counts.hwApplicable) return 'done'
      if (counts.hwDone > 0) return 'attention'
      return 'active'
    }
    if (key === 'exams') return sessionExamIds.length ? 'done' : 'active'
    if (key === 'review') return 'active'
    if (key === 'report') return lessonCompleted ? 'done' : 'active'
    return 'active'
  }, [lessonCompleted, counts, sessionExamIds, stageState.attendanceComplete])

  const activeTab = TABS.find((t) => t.key === tab) || TABS[0]

  // EXPLICIT stage completion (spec 13): the teacher decides — "complete" is
  // an action, never a percentage. Marks the stage done, then advances to the
  // natural next stage (interaction when someone is present).
  // (Hook MUST live above the early returns below — unconditional hooks.)
  const completeAttendanceStage = useCallback(() => {
    markStageComplete('attendance')
    setTab(counts.present > 0 ? 'interaction' : 'review')
  }, [markStageComplete, counts.present])

  if (opening) {
    return (
      <div className="nk-content">
        <div className="nk-skeleton h-24 w-full mb-4" />
        <div className="nk-skeleton h-14 w-full mb-3" />
        <div className="nk-skeleton h-40 w-full" />
      </div>
    )
  }

  if (!groupId) {
    return (
      <div className="nk-content text-center py-12">
        <p className="font-extrabold mb-3">{isArabic ? 'لا توجد حصة محددة' : 'No session selected'}</p>
        <button className="btn-navy action-button !min-h-[3rem]" onClick={ui.closeSession}>{isArabic ? 'العودة للرئيسية' : 'Back home'}</button>
      </div>
    )
  }

  const timeLabel = (() => {
    const meta = ws.groupMeta[groupId] || {}
    const scheduled = ws.todayGroups.find((g) => g.group_name === groupId)
    const t = scheduled?.lesson_time || meta.time
    if (!t) return ''
    const [h, m] = String(t).split(':').map(Number)
    if (Number.isNaN(h)) return String(t)
    const period = h < 12 ? (isArabic ? 'ص' : 'AM') : (isArabic ? 'م' : 'PM')
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${String(m || 0).padStart(2, '0')} ${period}`
  })()

  // Focus-header save indicator (spec 27 — subtle, no popups): the MetaCtx
  // savingIds set tells us if any per-student write is in flight.
  const savingNow = wsMeta.savingIds.size > 0 || wsMeta.isSaving

  return (
    <div className="flex flex-col gap-3">
      {/* ── FOCUS HEADER (mobile only) — the compact task header. Exit = leave
          the task (back to Home), NEVER logout. Replaces the full app chrome. */}
      {isMobile && (
        <div className="nk-focus-head" role="banner">
          <button className="nk-focus-head__exit" onClick={ui.closeSession} aria-label={isArabic ? 'الخروج من المهمة والعودة للرئيسية' : 'Exit task, back to Home'}>
            → {isArabic ? 'الرئيسية' : 'Home'}
          </button>
          <span className="nk-focus-head__task">
            <b className="truncate">{isArabic ? activeTab.title : activeTab.titleEn}</b>
            <small className="truncate">{groupId}</small>
          </span>
          <span className="nk-focus-head__status">
            {savingNow && <small className="nk-focus-head__save">… {isArabic ? 'جاري الحفظ' : 'Saving'}</small>}
            {!savingNow && <small className="nk-focus-head__save nk-focus-head__save--ok">✓ {isArabic ? 'محفوظ' : 'Saved'}</small>}
            <span className={`nk-pill ${lessonOpen ? 'nk-pill-live' : lessonCompleted ? 'nk-pill-done' : 'nk-pill-pending'}`}>
              {lessonOpen ? '●' : lessonCompleted ? '✓' : '○'}
            </span>
          </span>
        </div>
      )}

      {/* ── Workspace header: navy band + PERSISTENT summary ─────────── */}
      <section className="nk-ws-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {!isMobile && (
              <button
                className="nk-pill nk-pill-gold mb-2 cursor-pointer border-0"
                onClick={ui.closeSession}
                aria-label={isArabic ? 'عودة للرئيسية' : 'Back'}
              >
                → {isArabic ? 'الرئيسية' : 'Home'}
              </button>
            )}
            <div className="nk-ws-muted text-[.62rem] font-black tracking-widest mb-1">SESSION WORKSPACE</div>
            <h2 className="text-[1.15rem] sm:text-[1.3rem] font-black m-0 leading-snug break-words">{groupId}</h2>
            <p className="nk-ws-muted text-[.72rem] mt-1 mb-0">
              {lesson?.stage ? `${lesson.stage} · ` : ''}{timeLabel ? `${timeLabel} · ` : ''}
              {lessonOpen ? (isArabic ? 'جارية الآن · الحصة الحالية' : 'In progress') : lessonCompleted ? (isArabic ? 'منتهية · محفوظة في السجل' : 'Completed & logged') : (isArabic ? 'لم تبدأ' : 'Not started')}
            </p>
          </div>
          <span className={`nk-pill ${lessonOpen ? 'nk-pill-live' : lessonCompleted ? 'nk-pill-done' : 'nk-pill-pending'}`}>
            {lessonOpen ? `● ${isArabic ? 'جارية الآن' : 'In progress'}` : lessonCompleted ? `✓ ${isArabic ? 'منتهية' : 'Completed'}` : `○ ${isArabic ? 'لم تبدأ' : 'Not started'}`}
          </span>
        </div>
        {lessonCompleted && (
          <div className="mt-3">
            <button
              className="btn-ghost rounded-xl px-4 py-2 text-[.72rem] font-extrabold"
              onClick={async () => {
                const ok = await ui.askConfirm(
                  isArabic ? `فتح حصة جديدة لمجموعة ${groupId}؟ الحصة المنتهية تبقى محفوظة في السجل.` : `Open a new session for ${groupId}? The completed one stays logged.`,
                  { title: isArabic ? 'فتح حصة جديدة' : 'New session', confirmLabel: isArabic ? 'فتح' : 'Open' },
                )
                if (ok) ws.openLessonForGroup(groupId, { forceNew: true })
              }}
            >
              ＋ {isArabic ? 'فتح حصة جديدة لنفس المجموعة' : 'Open a new session for this group'}
            </button>
          </div>
        )}

        {/* Persistent mini-summary — never disappears when switching tabs */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-4">
          <div className="nk-mini"><small>{isArabic ? 'الطلاب' : 'Students'}</small><b>{counts.total}</b></div>
          <div className="nk-mini nk-mini--ok"><small>{isArabic ? 'الحضور' : 'Present'}</small><b>{counts.present} / {counts.total}</b></div>
          <div className="nk-mini" style={{ color: undefined }}><small>{isArabic ? 'الغائب' : 'Absent'}</small><b>{counts.absent}</b></div>
          <div className="nk-mini nk-mini--gold"><small>{isArabic ? 'الواجب' : 'Homework'}</small><b>{counts.hwDone} / {counts.hwApplicable}</b></div>
          <div className="nk-mini nk-mini--info"><small>{isArabic ? 'الدرجات' : 'Graded'}</small><b>{gradedStudents ? `${gradedStudents} / ${counts.present}` : '—'}</b></div>
        </div>
      </section>

      {/* ── Pipeline tabs (not a wizard — free movement) ──────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" role="tablist" aria-label={isArabic ? 'مراحل الحصة' : 'Session pipeline'}>
        {TABS.map((t) => {
          const state = t.key === tab ? 'active' : stepState(t.key)
          const mark = state === 'done' ? '✓' : state === 'attention' ? '!' : t.key === tab ? '●' : '○'
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.key === tab}
              className={`nk-step ${t.key === tab ? 'nk-step--active' : state === 'done' ? 'nk-step--done' : state === 'attention' ? 'nk-step--attention' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <b>
                <span aria-hidden="true" className={state === 'attention' ? 'text-[.9rem]' : ''}>{mark}</span>
                <span className="truncate">{t.n} · {isArabic ? t.title : t.titleEn}</span>
                <span className="nk-step__state" />
              </b>
              <small className="truncate">{isArabic ? t.sub : t.subEn}</small>
            </button>
          )
        })}
      </div>

      {/* ── Tab content — the persistent workflow bar lives inside each tab
          (contextual per state); this container just holds the panel. ──── */}
      <section className="nk-content pb-2" role="tabpanel" aria-label={isArabic ? activeTab.title : activeTab.titleEn}>
        <h3 className="text-[1rem] font-extrabold mt-0 mb-1">{isArabic ? activeTab.title : activeTab.titleEn}</h3>
        <p className="text-[.74rem] text-fg-muted mt-0 mb-4">{isArabic ? activeTab.sub : activeTab.subEn}</p>

        {tab === 'attendance' && (
          <AttendanceTab
            groupId={groupId}
            lessonOpen={lessonOpen}
            onCompleteStage={completeAttendanceStage}
            onGoNext={() => setTab(counts.present > 0 ? 'interaction' : 'review')}
            onBar={publishBar}
          />
        )}
        {tab === 'interaction' && (
          <InteractionHomeworkTab
            groupId={groupId}
            lessonOpen={lessonOpen}
            onGoNext={() => setTab(counts.present > 0 ? 'exams' : 'review')}
            onGoPrev={() => setTab('attendance')}
            onBar={publishBar}
          />
        )}
        {tab === 'exams' && (
          <ExamsTab
            groupId={groupId}
            lessonId={ws.activeLessonId}
            lessonOpen={lessonOpen}
            onGoNext={() => setTab('review')}
            onGoPrev={() => setTab('interaction')}
            onBar={publishBar}
          />
        )}
        {tab === 'review' && (
          <ReviewTab
            groupId={groupId}
            counts={counts}
            interactionCount={interactionCount}
            gradedStudents={gradedStudents}
            sessionExamCount={sessionExamIds.length}
            issues={issues}
            lessonOpen={lessonOpen}
            onGoTo={(k) => setTab(k)}
            onGoPrev={() => setTab('exams')}
            onBar={publishBar}
          />
        )}
        {tab === 'report' && (
          <ReportTab
            groupId={groupId}
            lesson={lesson}
            lessonOpen={lessonOpen}
            lessonCompleted={lessonCompleted}
            counts={counts}
            teacherName={profile?.full_name || ''}
            onBar={publishBar}
          />
        )}
      </section>

      {/* ── Persistent contextual workflow bar (workspace root level) ─────── */}
      {bar && (
        <WorkflowBar
          ariaLabel={bar.data.ariaLabel}
          primary={bar.data.primary.map((b) => ({ ...b, onClick: () => bar.handlers[b.key]?.() }))}
          secondary={(bar.data.secondary || []).map((b) => ({ ...b, onClick: () => bar.handlers[b.key]?.() }))}
          meta={bar.data.meta}
        />
      )}
    </div>
  )
}
