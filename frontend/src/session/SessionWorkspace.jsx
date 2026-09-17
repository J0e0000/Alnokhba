import { useEffect, useMemo, useState, useCallback } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { useAuth } from '../context/AuthContext'
import { todayLocalISO } from '../lib/dateUtils'
import FirstHint from '../components/FirstHint'
import AttendanceTab from './tabs/AttendanceTab'
import InteractionHomeworkTab from './tabs/InteractionHomeworkTab'
import ExamsTab from './tabs/ExamsTab'
import ReviewTab from './tabs/ReviewTab'
import ReportTab from './tabs/ReportTab'

// ═══════════════════════════════════════════════════════════════════════════
// SESSION WORKSPACE — the core experience (rules 5–14 + update brief §4–6).
// ONE unified workspace per session: persistent summary + pipeline tabs.
// The pipeline is NOT a wizard: any tab can be visited in any order, work is
// saved explicitly (SAVE) and the session is closed explicitly (FINISH).
//
// GATING (brief §4–5, §30–31): the CONTINUE action validates completeness of
// the current stage before advancing. ATTENDANCE IS EXEMPT — unrecorded
// students never block progress (the finalize RPC applies the existing
// unrecorded→absent server rule). Interaction / homework / exams DO block
// with an explicit "N students still need …" panel + a one-click shortcut
// that filters the list to exactly those students. No data is ever written
// automatically — the teacher performs every required action explicitly.
// ═══════════════════════════════════════════════════════════════════════════

const TABS = [
  { key: 'attendance', n: 1, title: 'الحضور', sub: 'سجّل حاضر وغائب', titleEn: 'Attendance', subEn: 'Mark present / absent' },
  { key: 'interaction', n: 2, title: 'التفاعل والواجب', sub: 'للحاضرين فقط', titleEn: 'Interaction + Homework', subEn: 'Present students only' },
  { key: 'exams', n: 3, title: 'الامتحانات', sub: 'الدرجات والتصحيح', titleEn: 'Exams', subEn: 'Grades' },
  { key: 'review', n: 4, title: 'المراجعة', sub: 'راجع قبل الإغلاق', titleEn: 'Review', subEn: 'Check before closing' },
  { key: 'report', n: 5, title: 'التقرير', sub: 'التقرير وإنهاء الحصة', titleEn: 'Report', subEn: 'Report & finish' },
]

const NEXT_TAB = { attendance: 'interaction', interaction: 'exams', exams: 'review', review: 'report' }

export default function SessionWorkspace({ params }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const { profile } = useAuth()
  const groupId = params?.groupId || ''
  const openedForDate = params?.date || null // set when reviewing a past day

  const [tab, setTab] = useState(params?.tab || 'attendance')
  const [opening, setOpening] = useState(true)
  const [missingFocus, setMissingFocus] = useState(null) // 'interaction' | 'exams' | null → pre-filters a tab to missing students
  const [showBlockers, setShowBlockers] = useState({})   // per-tab blocking panel visibility

  // Resolve the session for this group — server-authoritative open-or-reuse.
  // Past-day review resolves the lesson for THAT date (view-only via existing
  // completed-lesson write guards — no new permissions).
  useEffect(() => {
    let alive = true
    setOpening(true)
    if (!groupId) { setOpening(false); return }
    const done = () => { if (alive) setOpening(false) }
    if (openedForDate) {
      ws.openLessonForDate(groupId, openedForDate, { silent: true }).finally(done)
    } else {
      ws.openLessonForGroup(groupId, { silent: true }).finally(done)
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, openedForDate])

  const lesson = ws.activeLesson
  const lessonOpen = lesson?.status === 'open'
  const lessonCompleted = lesson?.status === 'completed'

  const counts = ws.countsForLesson(groupId)
  const groupStudents = ws.sessionStudentsFor(groupId)

  const sessionExamIds = useMemo(
    () => ws.examsList.filter((e) => e.lesson_session_id === ws.activeLessonId).map((e) => e.id),
    [ws.examsList, ws.activeLessonId],
  )
  const gradedSet = useMemo(() => {
    const set = new Set()
    if (!sessionExamIds.length) return set
    Object.values(ws.examScoresByStudent).forEach((list) => list.forEach((s) => { if (sessionExamIds.includes(s.exam_id)) set.add(s.student_id) }))
    return set
  }, [sessionExamIds, ws.examScoresByStudent])
  const gradedStudents = gradedSet.size

  // ── Completeness per required stage (brief §4/§6) ────────────────────────
  // Interaction = positive interaction log for PRESENT students.
  // Homework = explicit homework state for every applicable (non-absent) student.
  // Exams = only required when an exam is actually linked to this session.
  const missingInteraction = useMemo(() => (
    lessonOpen
      ? groupStudents.filter((s) => s.attendance_status === 'حاضر'
        && !(ws.todayLogsByStudent[s.id] || []).some((l) => l.points_delta > 0 && /تفاعل|ذهبية|مساعدة|نقاط/.test(l.note || '')))
      : []
  ), [lessonOpen, groupStudents, ws.todayLogsByStudent])

  const missingHW = useMemo(() => (
    lessonOpen
      ? groupStudents.filter((s) => s.attendance_status !== 'غائب' && (s.hw_status === 'لم يرصد' || !s.hw_status))
      : []
  ), [lessonOpen, groupStudents])

  const missingExams = useMemo(() => (
    lessonOpen && sessionExamIds.length
      ? groupStudents.filter((s) => s.attendance_status === 'حاضر' && !gradedSet.has(s.id))
      : []
  ), [lessonOpen, sessionExamIds, groupStudents, gradedSet])

  // Stage fractions from REAL saved records (never arbitrary numbers).
  const progress = useMemo(() => {
    const attendancePct = counts.total ? (counts.present + counts.absent) / counts.total : 0
    const interactionPct = counts.present ? (counts.present - missingInteraction.length) / counts.present : 0
    const hwPct = counts.hwApplicable ? counts.hwDone / counts.hwApplicable : 0
    const examPct = sessionExamIds.length ? (counts.present ? gradedSet.size / counts.present : 0) : null
    const required = examPct === null ? [interactionPct, hwPct] : [interactionPct, hwPct, examPct]
    const overall = required.reduce((a, b) => a + b, 0) / required.length
    return { attendancePct, interactionPct, hwPct, examPct, overall }
  }, [counts, missingInteraction, sessionExamIds, gradedSet])

  // Blockers for the CONTINUE action of each source tab (attendance exempt).
  const blockersFor = useCallback((fromTab) => {
    if (!lessonOpen) return []
    if (fromTab === 'attendance') return [] // attendance NEVER blocks (brief §4)
    if (fromTab === 'interaction') {
      return [
        ...missingInteraction.map((s) => ({ student: s, kind: 'interaction' })),
        ...missingHW.map((s) => ({ student: s, kind: 'hw' })),
      ]
    }
    if (fromTab === 'exams') return missingExams.map((s) => ({ student: s, kind: 'exam' }))
    if (fromTab === 'review') {
      return [
        ...missingInteraction.map((s) => ({ student: s, kind: 'interaction' })),
        ...missingHW.map((s) => ({ student: s, kind: 'hw' })),
        ...missingExams.map((s) => ({ student: s, kind: 'exam' })),
      ]
    }
    return []
  }, [lessonOpen, missingInteraction, missingHW, missingExams])

  const goToTab = useCallback((key, focus = null) => {
    setMissingFocus(focus)
    setTab(key)
    setShowBlockers({})
  }, [])

  const issues = useMemo(() => {
    const list = []
    if (lessonOpen && counts.unrecorded > 0) list.push(isArabic ? `${counts.unrecorded} طالب لم يُرصد حضورهم (مسموح — لا يمنع التقدم)` : `${counts.unrecorded} students unrecorded (allowed — does not block)`)
    if (lessonOpen && counts.hwApplicable > counts.hwDone) list.push(isArabic ? `الواجب مكتمل لـ ${counts.hwDone} من ${counts.hwApplicable}` : `Homework done for ${counts.hwDone}/${counts.hwApplicable}`)
    if (!sessionExamIds.length) list.push(isArabic ? 'لا يوجد امتحان مرتبط بهذه الحصة (اختياري)' : 'No exam linked to this session (optional)')
    return list
  }, [lessonOpen, counts, sessionExamIds, isArabic])

  const stepState = useCallback((key) => {
    if (lessonCompleted && key !== 'review') {
      if (key === 'attendance' || key === 'report') return 'done'
      if (key === 'interaction') return 'done'
      if (key === 'exams') return sessionExamIds.length ? 'done' : 'active'
    }
    if (key === 'attendance') {
      if (counts.unrecorded > 0 && (counts.present || counts.absent)) return 'attention'
      if (counts.unrecorded === 0 && counts.total > 0) return 'done'
      return 'active'
    }
    if (key === 'interaction') {
      if (counts.hwApplicable === 0) return missingInteraction.length ? 'attention' : 'active'
      if (missingInteraction.length === 0 && missingHW.length === 0) return 'done'
      if (counts.hwDone > 0 || counts.present > missingInteraction.length) return 'attention'
      return 'active'
    }
    if (key === 'exams') return sessionExamIds.length ? (missingExams.length === 0 ? 'done' : 'attention') : 'active'
    if (key === 'review') return 'active'
    if (key === 'report') return lessonCompleted ? 'done' : 'active'
    return 'active'
  }, [lessonCompleted, counts, sessionExamIds, missingInteraction, missingHW, missingExams])

  // Tab badge: real fractions per stage (brief §6).
  const tabBadge = useCallback((key) => {
    if (key === 'attendance') return `${counts.present + counts.absent}/${counts.total}`
    if (key === 'interaction') return `${counts.present - missingInteraction.length}/${counts.present}`
    if (key === 'exams') return sessionExamIds.length ? `${gradedSet.size}/${counts.present}` : null
    if (key === 'review') return null
    if (key === 'report') return null
    return null
  }, [counts, missingInteraction, sessionExamIds, gradedSet])

  const activeTab = TABS.find((t) => t.key === tab) || TABS[0]

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

  const isPastReview = Boolean(openedForDate) && openedForDate !== todayLocalISO()
  const overallPct = Math.round(progress.overall * 100)

  // ── Advance bar (Continue validation, brief §5) — attendance/exams/interaction tabs.
  // The review tab gates its own continue via the blockers prop (no double bar).
  const renderAdvanceBar = (fromTab) => {
    const next = NEXT_TAB[fromTab]
    if (!next || !lessonOpen || fromTab === 'review') return null
    const blockers = blockersFor(fromTab)
    const panelOpen = showBlockers[fromTab]
    const nextMeta = TABS.find((t) => t.key === next)
    const kindLabel = (kind) => kind === 'interaction'
      ? (isArabic ? 'تفاعل' : 'interaction')
      : kind === 'hw' ? (isArabic ? 'رصد واجب' : 'homework') : (isArabic ? 'إدخال درجة' : 'grade')
    return (
      <div className="nk-advance">
        {fromTab === 'attendance' && counts.unrecorded > 0 && (
          <small className="nk-advance__note">
            ⓘ {isArabic ? 'الحضور اختياري — عدم رصد بعض الطلاب لا يمنع التقدم.' : 'Attendance is optional — unrecorded students never block progress.'}
          </small>
        )}
        <button
          className="btn-navy action-button !min-h-[3rem]"
          onClick={() => {
            if (blockers.length > 0) { setShowBlockers((p) => ({ ...p, [fromTab]: true })); return }
            goToTab(next)
          }}
        >
          {isArabic ? `التالي — ${nextMeta.title} ←` : `Next — ${nextMeta.titleEn} →`}
        </button>
        {panelOpen && blockers.length > 0 && (
          <div className="nk-block" role="alert">
            <b>
              {blockers.length} {isArabic ? 'طلاب ما زالوا بحاجة إلى' : 'students still need'}
              {' '}{[...new Set(blockers.map((b) => kindLabel(b.kind)))].join(isArabic ? ' / ' : ' / ')}.
            </b>
            <ul className="nk-block__list">
              {blockers.slice(0, 6).map(({ student, kind }) => (
                <li key={`${student.id}-${kind}`}>
                  <b>{student.name}</b> — {kindLabel(kind)}
                </li>
              ))}
              {blockers.length > 6 && <li>{isArabic ? `و ${blockers.length - 6} آخرون…` : `and ${blockers.length - 6} more…`}</li>}
            </ul>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                className="btn-gold rounded-xl px-4 py-2 text-[.74rem] font-extrabold"
                onClick={() => {
                  const targetTab = blockers.some((b) => b.kind === 'interaction') ? 'interaction'
                    : blockers.some((b) => b.kind === 'exam') ? 'exams' : 'interaction'
                  goToTab(targetTab, blockers.some((b) => b.kind === 'exam') && targetTab === 'exams' ? 'exams' : 'missing')
                }}
              >
                {isArabic ? `عرض الطلاب الناقصين (${blockers.length})` : `Show missing students (${blockers.length})`}
              </button>
              <button className="btn-ghost rounded-xl px-4 py-2 text-[.74rem] font-extrabold" onClick={() => setShowBlockers((p) => ({ ...p, [fromTab]: false }))}>
                {isArabic ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Workspace header: navy band + PERSISTENT summary ─────────── */}
      <section className="nk-ws-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              className="nk-pill nk-pill-gold mb-2 cursor-pointer border-0"
              onClick={ui.closeSession}
              aria-label={isArabic ? 'عودة للرئيسية' : 'Back'}
            >
              → {isArabic ? 'الرئيسية' : 'Home'}
            </button>
            <div className="nk-ws-muted text-[.62rem] font-black tracking-widest mb-1">
              {isPastReview ? (isArabic ? 'مراجعة حصة سابقة' : 'PAST SESSION REVIEW') : 'SESSION WORKSPACE'}
            </div>
            <h2 className="text-[1.15rem] sm:text-[1.3rem] font-black m-0 leading-snug break-words">{groupId}</h2>
            <p className="nk-ws-muted text-[.72rem] mt-1 mb-0">
              {lesson?.stage ? `${lesson.stage} · ` : ''}{timeLabel ? `${timeLabel} · ` : ''}
              {isPastReview ? `${openedForDate} · ` : ''}
              {lessonOpen ? (isArabic ? 'جارية الآن · الحصة الحالية' : 'In progress') : lessonCompleted ? (isArabic ? 'منتهية · محفوظة في السجل' : 'Completed & logged') : (isArabic ? 'لم تبدأ' : 'Not started')}
            </p>
          </div>
          <span className={`nk-pill ${lessonOpen ? 'nk-pill-live' : lessonCompleted ? 'nk-pill-done' : 'nk-pill-pending'}`}>
            {lessonOpen ? `● ${isArabic ? 'جارية الآن' : 'In progress'}` : lessonCompleted ? `✓ ${isArabic ? 'منتهية' : 'Completed'}` : `○ ${isArabic ? 'لم تبدأ' : 'Not started'}`}
          </span>
        </div>
        {lessonCompleted && !isPastReview && (
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

      {/* ── Sticky progress strip (brief §6 + §10) — slim, always visible ── */}
      <section className="nk-ws-sticky" aria-label={isArabic ? 'تقدم الحصة' : 'Session progress'}>
        <span className="nk-ws-sticky__name truncate">{groupId}</span>
        <span className="nk-ws-sticky__bar" aria-hidden="true">
          <span style={{ width: `${overallPct}%` }} />
        </span>
        <b className="nk-ws-sticky__pct" aria-label={`${isArabic ? 'الإنجاز' : 'Progress'}: ${overallPct}%`}>{overallPct}%</b>
        <span className="nk-ws-sticky__chips" aria-hidden="true">
          <span className="nk-chip">{isArabic ? 'حضور' : 'Att.'} {counts.present + counts.absent}/{counts.total}</span>
          <span className={`nk-chip ${missingInteraction.length === 0 ? 'nk-chip--ok' : missingInteraction.length ? 'nk-chip--warn' : ''}`}>{isArabic ? 'تفاعل' : 'Int.'} {counts.present - missingInteraction.length}/{counts.present}</span>
          <span className={`nk-chip ${counts.hwApplicable && missingHW.length === 0 ? 'nk-chip--ok' : missingHW.length ? 'nk-chip--warn' : ''}`}>{isArabic ? 'واجب' : 'HW'} {counts.hwDone}/{counts.hwApplicable}</span>
          <span className={`nk-chip ${sessionExamIds.length ? (missingExams.length === 0 ? 'nk-chip--ok' : 'nk-chip--warn') : ''}`}>{isArabic ? 'امتحان' : 'Exam'} {sessionExamIds.length ? `${gradedSet.size}/${counts.present}` : '—'}</span>
        </span>
      </section>

      {/* ── Pipeline tabs (not a wizard — free movement, gated advance) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" role="tablist" aria-label={isArabic ? 'مراحل الحصة' : 'Session pipeline'}>
        {TABS.map((t) => {
          const state = t.key === tab ? 'active' : stepState(t.key)
          const mark = state === 'done' ? '✓' : state === 'attention' ? '!' : t.key === tab ? '●' : '○'
          const badge = tabBadge(t.key)
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.key === tab}
              className={`nk-step ${t.key === tab ? 'nk-step--active' : state === 'done' ? 'nk-step--done' : state === 'attention' ? 'nk-step--attention' : ''}`}
              onClick={() => goToTab(t.key)}
            >
              <b>
                <span aria-hidden="true" className={state === 'attention' ? 'text-[.9rem]' : ''}>{mark}</span>
                <span className="truncate">{t.n} · {isArabic ? t.title : t.titleEn}</span>
                {badge && <span className="nk-step__badge">{badge}</span>}
                <span className="nk-step__state" />
              </b>
              <small className="truncate">{isArabic ? t.sub : t.subEn}</small>
            </button>
          )
        })}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <section className="nk-content" role="tabpanel" aria-label={isArabic ? activeTab.title : activeTab.titleEn}>
        <h3 className="text-[1rem] font-extrabold mt-0 mb-1">{isArabic ? activeTab.title : activeTab.titleEn}</h3>
        <p className="text-[.74rem] text-fg-muted mt-0 mb-4">{isArabic ? activeTab.sub : activeTab.subEn}</p>

        <FirstHint
          id="ws-overview"
          isArabic={isArabic}
          title={isArabic ? 'هنا تدير الحصة من البداية للنهاية' : 'This is where you manage the session'}
          body={isArabic
            ? 'كل مرحلة في تبويب، والحفظ فوري مع كل ضغطة. تذكّر: الحفظ لا ينهي الحصة — الإنهاء من تبويب التقرير فقط. والحضور اختياري: عدم رصد طالب لا يمنعك من المتابعة.'
            : 'Each stage is a tab; every click saves instantly. Remember: Save does not finish the session — finish from the Report tab. Attendance is optional: unrecorded students never block you.'}
        />

        {tab === 'attendance' && <AttendanceTab groupId={groupId} lessonOpen={lessonOpen} />}
        {tab === 'interaction' && (
          <InteractionHomeworkTab groupId={groupId} lessonOpen={lessonOpen} missingFocus={missingFocus} onClearFocus={() => setMissingFocus(null)} />
        )}
        {tab === 'exams' && <ExamsTab groupId={groupId} lessonId={ws.activeLessonId} lessonOpen={lessonOpen} missingFocus={missingFocus === 'exams'} />}
        {tab === 'review' && (
          <ReviewTab
            groupId={groupId}
            counts={counts}
            interactionCount={counts.present - missingInteraction.length}
            gradedStudents={gradedStudents}
            sessionExamCount={sessionExamIds.length}
            issues={issues}
            lessonOpen={lessonOpen}
            onGoTo={(k, focus) => goToTab(k, focus)}
            blockers={blockersFor('review')}
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
          />
        )}

        {renderAdvanceBar(tab)}
      </section>

      {/* Mobile sticky save hint: attendance marks persist instantly; the
          explicit Save lives inside each tab, Finish inside the Report tab. */}
    </div>
  )
}
