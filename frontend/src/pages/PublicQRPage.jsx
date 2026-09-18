/**
 * Student/Parent Portal — /qr/:token
 * No authentication required — access is controlled entirely by the token.
 *
 * Shows: student card (name/rank/points), collapsible QR code, today's
 * session status, announcements feed, recent activity, homework tasks,
 * exam/quiz results, attendance streak, a WhatsApp button to the teacher,
 * and a "download monthly report" button.
 *
 * Auto-refreshes every 10s while open (safety-net polling) PLUS instantly
 * whenever the teacher's dashboard broadcasts a refresh ping (Round 7) —
 * the teacher marks attendance / finalizes a lesson / sends an announcement
 * and the portal updates within ~a second without any user action. The
 * page also refreshes the moment it becomes visible again after being
 * backgrounded (user switched back to the tab / app).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getStudentRank, isIOSBrowser, copyToClipboard } from '../lib/helpers'
import { getPalette } from '../lib/palettes'
import { generateStudentReportPDF } from '../lib/qrPdfWhatsApp'
import { registerStudentPush } from '../lib/pushNotifications'
import { subscribePortalRefresh } from '../lib/portalRealtime'

const REFRESH_MS = 10000
// PERF (performance round): the teacher's display name is quasi-static — it
// only changes if the teacher renames the account. Re-fetching it every 10s
// alongside the live data is pure waste, so background ticks reuse a cached
// value for up to 10 minutes. Initial load and tab-return always re-fetch.
const TEACHER_NAME_TTL_MS = 10 * 60 * 1000
const WEEKDAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default function PublicQRPage() {
  const [state, setState] = useState('loading') // loading | ready | not_found | error
  const [errorMsg, setErrorMsg] = useState('')
  const [showQR, setShowQR] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  // Portal search — one box that filters sessions, homework, exams,
  // announcements and notifications. Purely client-side, zero extra requests.
  const [query, setQuery] = useState('')
  const [markingTaskId, setMarkingTaskId] = useState(null)
  const [notifExpanded, setNotifExpanded] = useState(true)
  const [parentPushEnabled, setParentPushEnabled] = useState(false)
  const [parentPushBusy, setParentPushBusy] = useState(false)
  const [parentPushMessage, setParentPushMessage] = useState('')

  const tokenRef = useRef('')
  // FIX (refresh race): a background poll that started BEFORE the parent tapped a
  // button can resolve AFTER the optimistic update and silently revert it
  // ("interaction looks like it failed"). A monotonic request id ensures only the
  // latest response is applied, and the optimistic merge below keeps just-made
  // interaction state visible until the next successful refresh confirms it.
  const loadSeqRef = useRef(0)
  const optimisticRef = useRef({ homeworkDoneIds: new Set(), readNotifIds: new Set(), allRead: false })
  // FIX (iOS transient-network error page): a background tab resuming on iOS
  // Safari, or a brief cellular drop, can make the very first request fail
  // even though the token/RPC are fine — this used to go straight to the
  // "حدث خطأ" screen on one bad round-trip. Retry once automatically before
  // showing the error state; only a second consecutive failure counts.
  const retryCountRef = useRef(0)
  // PERF (performance round): cached teacher display name (quasi-static data)
  // and a stable JSON snapshot of the last applied portal object. A background
  // refresh that produces IDENTICAL data must not re-render the whole page
  // every 10 seconds — the snapshot comparison makes the refresh a true no-op
  // until something actually changes on the server.
  const teacherNameCacheRef = useRef({ name: null, at: 0 })
  const portalSnapshotRef = useRef('')

  const [portal, setPortal] = useState(null)
  // portal = { student, teacherId, ranks, whatsappNumber, sessionToday,
  //            upcomingSessions, announcements, activity, homework,
  //            examResults, streak }

  const load = useCallback(async (isBackgroundRefresh = false, reason = '') => {
    const token = tokenRef.current
    if (!token) return
    const seq = ++loadSeqRef.current
    try {
      // ── SECURITY + BACKWARD COMPAT (migration_019 + 020 + 021) ──
      // The portal uses a single SECURITY DEFINER RPC. The RPC:
      //   1) Tries to validate the token against student_qr_tokens (revoked_at is null)
      //   2) If not found, tries to interpret the token as a student_id (UUID)
      //      — this is the "backward compat" path that keeps old QR links
      //      (generated before migration_019) working forever.
      //   3) Returns ONLY the data that this specific token/student is authorized
      //      to see — one student + that student's related records, filtered by
      //      the student's teacher_id on the server.
      //   4) Returns null only if BOTH paths fail (genuine invalid input).
      //
      // This eliminates the cross-tenant data leak (migration_019) while keeping
      // every existing QR link working (migration_020 + 021).
      // PERF (performance round): the three RPCs used to run SEQUENTIALLY
      // (data → access → teacher-name): 3 serial round-trips per 10s poll.
      // They are independent of each other, so they now run in ONE parallel
      // batch — same error semantics (data RPC gates validity; the other two
      // are optional and individually tolerated).
      const tnCachePre = teacherNameCacheRef.current
      const tnCacheFreshPre = tnCachePre.name !== null && (Date.now() - tnCachePre.at) < TEACHER_NAME_TTL_MS
      const needTeacherName = !isBackgroundRefresh || reason === 'visible' || !tnCacheFreshPre
      const [dataRes, accessRes, teacherNameRes] = await Promise.all([
        supabase.rpc('get_student_portal_data', { p_token: token }),
        supabase.rpc('get_student_portal_access', { p_token: token }),
        needTeacherName ? supabase.rpc('get_portal_teacher_name', { p_token: token }) : Promise.resolve(null),
      ])
      const { data: payload, error } = dataRes
      if (error) {
        console.error('[PublicQRPage] RPC error:', error.message || error, 'code:', error.code)
        if (!isBackgroundRefresh) {
          if (retryCountRef.current < 1) {
            // First failure on a foreground load: assume a transient blip
            // (common right after iOS wakes a backgrounded tab) and retry
            // once, silently, before showing the error screen.
            retryCountRef.current += 1
            setTimeout(() => { if (seq === loadSeqRef.current) load(false, 'retry') }, 900)
            return
          }
          setState('error')
          // Show a detailed error so the user can report exactly what went wrong
          setErrorMsg(`خطأ في الخادم: ${error.message || 'خطأ غير معروف'} (كود: ${error.code || '؟'})`)
        }
        return
      }
      retryCountRef.current = 0
      // A newer load started — discard this stale response so it cannot
      // overwrite interaction state that was applied after this request began.
      if (seq !== loadSeqRef.current) return

      if (!payload) {
        // Both paths failed — token is neither in student_qr_tokens nor a valid
        // student UUID. This is a genuine "invalid link" case.
        console.warn('[PublicQRPage] RPC returned null for token:', token)
        if (!isBackgroundRefresh) setState('not_found')
        return
      }

      // Validate that payload has the expected shape before using it
      if (!payload.student || !payload.student.id) {
        console.error('[PublicQRPage] RPC returned malformed payload:', payload)
        if (!isBackgroundRefresh) {
          setState('error')
          setErrorMsg('البيانات المرتجعة من الخادم غير صحيحة. تواصل مع الدعم.')
        }
        return
      }

      const student = payload.student
      const access = accessRes?.data ?? null
      if (accessRes?.error) console.warn('[PublicQRPage] optional access RPC failed:', accessRes.error.message || accessRes.error)
      // The teacher NAME is quasi-static: reuse the cache on background ticks
      // (within the TTL), and always re-fetch on the initial load or when the
      // tab just became visible again (reason === 'visible').
      let teacherName = teacherNameCacheRef.current.name
      if (teacherNameRes) {
        if (teacherNameRes.error) {
          console.warn('[PublicQRPage] optional teacher-name RPC failed:', teacherNameRes.error.message || teacherNameRes.error)
        } else {
          teacherName = teacherNameRes.data
          teacherNameCacheRef.current = { name: teacherNameRes.data, at: Date.now() }
        }
      }
      // Re-check after the optional RPCs: if a newer load started while these
      // were in flight, drop this response.
      if (seq !== loadSeqRef.current) return
      const ranks = asArray(payload.ranks)
      // Tolerate both field-name styles (older RPC returns whatsapp_number,
      // a newer variant returns whatsappNumber).
      const whatsappNumber = payload.whatsapp_number || payload.whatsappNumber || ''
      const attendance = asArray(payload.attendance).filter((r) => r && typeof r === 'object')
      const lessonAttendance = asArray(payload.lesson_attendance).filter((r) => r && typeof r === 'object')
      const behavior = asArray(payload.behavior).filter((r) => r && typeof r === 'object')
      // Announcements: older RPC exposes `message`, a newer variant `body`.
      const announcements = asArray(payload.announcements).filter((a) => a && typeof a === 'object').map((a) => ({ ...a, title: asText(a.title), message: asText(a.message ?? a.body) }))
      const examScores = asArray(payload.exam_scores || payload.examResults).filter((s) => s && typeof s === 'object')
      // FIX (ghost lesson shadowing): an auto-created empty OPEN lesson used to
      // win over the real saved lesson. If the lesson row from the data RPC is an
      // empty stub, enrich it with the teacher's saved topic/homework/video from
      // the access RPC copy (sourced from the finalized session log) so the
      // portal keeps showing the latest REAL lesson content.
      const rawSessionToday = payload.session_today || payload.session_log || null
      const accessSessionToday = rawAccessFallbackSession(access)
      const isLessonStub = (row) => Boolean(row) && (row.status === 'open' || !row.status) && !row.lesson_topic && !row.homework_text && (!row.attendance_status || row.attendance_status === 'لم يرصد')
      const sessionToday = (rawSessionToday && isLessonStub(rawSessionToday) && accessSessionToday && (accessSessionToday.lesson_topic || accessSessionToday.homework_text))
        ? {
            ...rawSessionToday,
            lesson_topic: accessSessionToday.lesson_topic || rawSessionToday.lesson_topic,
            homework_text: accessSessionToday.homework_text || rawSessionToday.homework_text,
            video_link: accessSessionToday.video_link || rawSessionToday.video_link,
            session_date: accessSessionToday.session_date || rawSessionToday.session_date,
          }
        : (rawSessionToday || accessSessionToday)
      // The portal shows one source of truth: the latest lesson state. An open lesson with no record is neutral, not absent.
      // FIX ('لم يرصد' shadowing): 'لم يرصد' means "no record yet" but it is a
      // truthy string, so it used to block the fallback to the student's most
      // recent real attendance record — the portal then showed "unrecorded"
      // forever even when attendance existed. Treat it as missing.
      const rawAtt = sessionToday?.attendance_status
      const finalAttendanceStatus = (rawAtt && rawAtt !== 'لم يرصد') ? rawAtt : (attendance[0]?.status || lessonAttendance[0]?.status || 'لم يرصد')
      const rawHw = sessionToday?.homework_status
      const finalHomeworkStatus = (rawHw && rawHw !== 'لم يرصد') ? rawHw : (lessonAttendance[0]?.homework_status || 'لم يرصد')
      // FIX (portal crash): name must be a string for .trim(), and points must
      // be renderable (an object value would crash React's child rendering).
      const safePoints = Number(student.points)
      const finalStudent = {
        ...student,
        name: asText(student.name),
        points: Number.isFinite(safePoints) ? safePoints : 0,
        attendance_status: finalAttendanceStatus,
        hw_status: finalHomeworkStatus,
      }
      const finalActivity = finalAttendanceStatus === 'لم يرصد' ? [] : buildActivityFeed([{ status: finalAttendanceStatus, recorded_at: sessionToday?.updated_at || sessionToday?.ended_at || attendance[0]?.recorded_at }], [])
      const rawAccess = access && typeof access === 'object' ? access : {}
      const accessStatus = {
        paymentStatus: rawAccess.paymentStatus || rawAccess.payment_status || 'unpaid',
        entryAllowed: rawAccess.entryAllowed ?? rawAccess.entry_allowed ?? true,
        blockedByWarnings: rawAccess.blockedByWarnings ?? rawAccess.blocked_by_warnings ?? false,
        warnings: Number(rawAccess.warnings ?? student.warnings ?? 0),
        maxWarnings: Number(rawAccess.maxWarnings ?? rawAccess.max_warnings ?? 3),
        lessonPrice: Number(rawAccess.lessonPrice ?? rawAccess.lesson_price ?? 0),
        totalPaid: Number(rawAccess.totalPaid ?? rawAccess.total_paid ?? 0),
        paymentCount: Number(rawAccess.paymentCount ?? rawAccess.payment_count ?? 0),
        sessionToday: rawAccess.sessionToday || rawAccess.session_today || null,
      }
      const scheduledWeekdays = asArray(payload.schedule).filter((r) => r && typeof r === 'object').map((r) => r.weekday).filter(Number.isInteger).sort((a, b) => a - b)
      // Tolerate both homework shapes: the split homework_tasks + homework_status
      // pair, or a single combined homework array with an is_done flag per row.
      const homeworkTasks = asArray(payload.homework_tasks || payload.homework).filter((t) => t && typeof t === 'object')
      const homeworkStatus = asArray(payload.homework_status).filter((t) => t && typeof t === 'object')

      // Compute exam results (max score = max_per_section * sections_count)
      const examResults = examScores.map((s) => {
        const sectionsCount = (s.exam_sections || (Array.isArray(s.sections) ? s.sections : []) || []).length || 1
        const perSection = s.exam_max_per_section ?? s.max_score_per_section ?? s.max_score ?? 0
        const max = typeof perSection === 'number' && Number.isFinite(s.max) && s.max > 0 ? s.max : perSection * sectionsCount
        return {
          id: s.id ?? s.exam_id,
          title: asText(s.exam_title || s.title || 'امتحان'),
          total: asNum(s.total_score ?? s.total),
          max,
          date: s.created_at,
        }
      })

      // Map homework tasks with their done status
      const homeworkStatusByTask = {}
      for (const hs of homeworkStatus) homeworkStatusByTask[hs.task_id] = hs.done
      const homework = homeworkTasks.map((t) => ({ ...t, title: asText(t.title), done: !!(homeworkStatusByTask[t.id] ?? t.is_done) }))
      // FIX (refresh race): keep the just-made interaction state visible — a
      // background refresh that raced the tap would otherwise flip a "done"
      // homework row back to the unchecked state for up to 10 seconds.
      const optimistic = optimisticRef.current
      if (optimistic.homeworkDoneIds.size > 0) {
        for (const task of homework) if (optimistic.homeworkDoneIds.has(task.id)) task.done = true
      }

      // Attendance streak: count consecutive 'حاضر' from most recent record
      let streak = 0
      for (const rec of attendance) {
        if (!rec || rec.status !== 'حاضر') break
        streak++
      }

      // Upcoming sessions: next occurrences of scheduled weekdays
      const upcomingSessions = buildUpcomingSessions(scheduledWeekdays, 3)

      // Apply the optimistic notification-read state over the fresh server data
      // so a background refresh can't revert a just-tapped "mark as read".
      const freshNotifications = asArray(payload.notifications).filter((n) => n && typeof n === 'object')
      const mergedNotifications = freshNotifications.map((n) => ({
        ...n,
        title: asText(n.title),
        body: asText(n.body),
        ...(((optimistic.allRead || optimistic.readNotifIds.has(n.id)) && { is_read: true }) || {}),
      }))
      const serverUnread = Number(payload.unreadNotificationCount ?? payload.unread_notification_count ?? 0)
      const optimisticUnread = freshNotifications.filter((n) => !n.is_read && !optimistic.readNotifIds.has(n.id)).length
      const unreadNotificationCount = optimistic.allRead ? 0 : Math.min(serverUnread, Math.max(optimisticUnread, serverUnread - optimistic.readNotifIds.size))

      const nextPortal = {
        student: finalStudent,
        teacherId: student.teacher_id,
        ranks,
        whatsappNumber,
        sessionToday: sessionToday || accessStatus.sessionToday || null,
        lessonSessions: asArray(payload.lesson_sessions),
        lessonAttendance,
        upcomingSessions,
        announcements,
        activity: [...finalActivity, ...buildActivityFeed([], behavior)],
        homework,
        examResults,
        streak,
        tokenSource: payload.token_source || 'db',
        accessStatus,
        paymentSummary: { totalPaid: accessStatus.totalPaid, paymentCount: accessStatus.paymentCount },
        lessonPrice: accessStatus.lessonPrice,
        teacherName: teacherName || '',
        notifications: mergedNotifications,
        unreadNotificationCount: Math.max(0, unreadNotificationCount),
        branding: payload.branding || null,
      }
      // PERF (performance round): skip the state update when a BACKGROUND
      // refresh produced data identical to what is already on screen — the
      // portal used to re-render every 10 seconds even when nothing changed.
      // Fresh loads and instant refreshes always apply.
      if (isBackgroundRefresh) {
        let snapshot = ''
        try { snapshot = JSON.stringify(nextPortal) } catch { snapshot = '' }
        if (snapshot && snapshot === portalSnapshotRef.current) {
          setState('ready')
          return
        }
        portalSnapshotRef.current = snapshot
      }
      setPortal(nextPortal)
      setState('ready')
    } catch (err) {
      console.error('Portal load error:', err)
      if (!isBackgroundRefresh) {
        // Same one-shot retry as the RPC-error path above — a thrown fetch
        // exception (e.g. the network request itself failing right after an
        // iOS tab resumes) is just as likely to be a transient blip.
        if (retryCountRef.current < 1) {
          retryCountRef.current += 1
          setTimeout(() => { if (seq === loadSeqRef.current) load(false, 'retry') }, 900)
          return
        }
        setState('error')
        setErrorMsg('حدث خطأ أثناء التحميل')
      }
    }
  }, [])

  useEffect(() => {
    const token = window.location.pathname.replace(/^\/qr\//, '').split('?')[0]
    tokenRef.current = token
    if (!token) { setState('not_found'); return }

    load()
    const interval = setInterval(() => {
      // PERF (performance round): a hidden tab renders nothing, and the
      // visibilitychange handler below refreshes the instant the tab comes
      // back — so polling while hidden is pure waste (a backgrounded portal
      // used to burn ~18 requests/minute for hours). Mobile browsers already
      // throttle hidden timers; this makes the skip explicit and immediate.
      if (document.visibilityState === 'visible') load(true)
    }, REFRESH_MS)
    return () => clearInterval(interval)
  }, [load])

  // ── Instant refresh (Round 7) ────────────────────────────────────────────
  // a) Teacher broadcast pings: the dashboard broadcasts "data changed" the
  //    moment the teacher saves anything; re-fetch immediately (debounced
  //    so a burst of marks doesn't spam the RPC).
  const instantRefreshTimerRef = useRef(null)
  const lastInstantRefreshAtRef = useRef(0)
  const scheduleInstantRefresh = useCallback((reason = 'ping') => {
    if (instantRefreshTimerRef.current) return // already scheduled — debounce
    instantRefreshTimerRef.current = setTimeout(() => {
      instantRefreshTimerRef.current = null
      // The 10s poll may have JUST run — don't double-fetch within 1.5s.
      if (Date.now() - lastInstantRefreshAtRef.current < 1500) return
      lastInstantRefreshAtRef.current = Date.now()
      load(true, reason)
    }, 450)
  }, [load])
  useEffect(() => () => { if (instantRefreshTimerRef.current) clearTimeout(instantRefreshTimerRef.current) }, [])

  const portalTeacherId = portal?.teacherId || null
  useEffect(() => {
    if (!portalTeacherId) return undefined
    const unsubscribe = subscribePortalRefresh(portalTeacherId, () => {
      scheduleInstantRefresh('teacher-ping')
    })
    return unsubscribe
  }, [portalTeacherId, scheduleInstantRefresh])

  // b) Returning to the tab/app: refresh immediately — the student switched
  //    away, the teacher changed something, and the poll timer was frozen
  //    while the page was hidden (mobile browsers pause timers in background
  //    tabs, so without this the page could show stale data for a long time).
  useEffect(() => {
    const onVisibility = () => {
      // scheduleInstantRefresh('visible') routes into load(true, 'visible'),
      // which also force-refreshes the cached teacher name on tab return.
      if (document.visibilityState === 'visible') scheduleInstantRefresh('visible')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [scheduleInstantRefresh])

  // Generate QR image lazily, only when the section is expanded.
  // FIX (QR content): the QR encodes the ACTUAL portal link (the current page
  // URL, which already carries the token) — scanning it opens the portal.
  // SCANNABILITY (must survive download / screenshot / on-screen scan):
  //  • errorCorrectionLevel 'H' — tolerates 30% damage (glare, compression,
  //    crumpled printouts, screenshots of screens)
  //  • 640px source + 3-module quiet zone — the download stays razor-sharp
  //    for print, and on-screen display scales down without blur
  //  • near-black on pure white — maximum contrast for cheap scanners
  useEffect(() => {
    if (!showQR || qrDataUrl || !portal?.student?.id) return
    const portalLink = `${window.location.origin}${window.location.pathname}`
    // PERF: qrcode loads on demand — only when the parent expands the QR
    // section (it used to be a static import on the portal page).
    import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(portalLink, {
      width: 640, margin: 3,
      color: { dark: '#111111', light: '#FFFFFF' },
      errorCorrectionLevel: 'H',
    })).then(setQrDataUrl).catch(() => {})
  }, [showQR, qrDataUrl, portal])

  const handleDownloadQR = () => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `QR_${portal?.student?.name || 'student'}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // The canonical portal URL — shown as selectable text and shareable via
  // the Web Share API (falls back to copy on browsers without it).
  const portalUrl = `${window.location.origin}${window.location.pathname}`

  const handleSharePortalLink = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'بوابة الطالب — النخبة', url: portalUrl }); return } catch (e) { if (e?.name === 'AbortError') return }
    }
    const ok = await copyToClipboard(portalUrl)
    setCopiedLink(ok)
    if (ok) setTimeout(() => setCopiedLink(false), 2200)
  }

  // The parent/teacher can copy the raw portal link from HERE too —
  // previously the link was impossible to copy from the student's portal.
  const handleCopyPortalLink = async () => {
    const ok = await copyToClipboard(portalUrl)
    setCopiedLink(ok)
    setTimeout(() => setCopiedLink(false), 2200)
  }

  const handleDownloadReport = async () => {
    if (!portal?.student || downloading) return
    setDownloading(true)
    try {
      await generateStudentReportPDF(portal.student, {
        ranks: portal.ranks,
        session: portal.sessionToday,
        today: new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }),
        download: true,
      })
    } catch (err) {
      console.error('Report generation error:', err)
    } finally {
      setDownloading(false)
    }
  }

  const handleMarkHomeworkDone = async (taskId) => {
    if (!tokenRef.current || markingTaskId) return

    // The mark_homework_done RPC verifies the token server-side and only
    // marks the task as done if the task belongs to the same teacher as
    // the student identified by the token. The previous "stateless mode"
    // fallback (where the token was a raw student_id) is gone — see
    // migration_019. We no longer need a special branch for it.
    setMarkingTaskId(taskId)
    try {
      const { error } = await supabase.rpc('mark_homework_done', {
        p_task_id: taskId,
        p_student_token: tokenRef.current,
      })
      if (!error) {
        // Record the optimistic state so a background refresh that raced this
        // tap cannot flip the row back to unchecked.
        optimisticRef.current.homeworkDoneIds.add(taskId)
        setPortal((prev) => prev
          ? { ...prev, homework: prev.homework.map((h) => h.id === taskId ? { ...h, done: true } : h) }
          : prev)
      } else {
        console.warn('[PublicQRPage] mark_homework_done RPC failed:', error.message)
        window.alert('تعذّر تحديد الواجب كمكتمل. تواصل مع المدرس عبر زر "تواصل مع المستر".')
      }
    } catch (err) {
      // FIX (silent failures): a network exception used to leave the button
      // spinner with no explanation.
      console.error('Mark homework error:', err)
      window.alert('تعذّر تحديد الواجب كمكتمل (مشكلة اتصال). تحقق من الإنترنت وحاول مرة أخرى.')
    } finally {
      setMarkingTaskId(null)
    }
  }

  const handleWhatsAppTeacher = () => {
    if (!portal?.whatsappNumber) return
    const digits = String(portal.whatsappNumber).replace(/\D/g, '')
    const text = encodeURIComponent(`أهلاً، أنا ولي أمر الطالب/ـة ${portal.student.name}`)
    window.open(`https://wa.me/${digits}?text=${text}`, '_blank')
  }

  const handleEnableParentPush = async () => {
    if (parentPushBusy) return
    if (!tokenRef.current) {
      setParentPushMessage('رابط الطالب لم يجهز بعد. أعد تحميل الصفحة وانتظر اكتمال التحميل ثم حاول مرة أخرى.')
      return
    }
    setParentPushBusy(true)
    setParentPushMessage('جاري طلب إذن الإشعارات وحفظ هذا الجهاز...')
    try {
      const result = await registerStudentPush(tokenRef.current)
      if (result.ok) {
        setParentPushEnabled(true)
        setParentPushMessage('تم تفعيل إشعارات هذا الطالب على هذا الجهاز. ستصل التنبيهات حتى عند إغلاق الموقع.')
      } else {
        const messages = {
          denied: 'تم رفض الإذن. افتح إعدادات الموقع في المتصفح، اسمح بالإشعارات، ثم أعد المحاولة.',
          default: 'لم يكتمل تفعيل الإشعارات. تأكد من السماح بالإشعارات لهذا الموقع ثم أعد المحاولة.',
          unsupported: isIOSBrowser()
            ? 'على الآيفون: اضغط زر المشاركة فوق ثم «إضافة إلى الشاشة الرئيسية»، افتح الموقع من الأيقونة الجديدة ثم فعّل الإشعارات.'
            : 'هذا المتصفح لا يدعم إشعارات Push. جرّب Chrome أو Edge على HTTPS.',
          insecure_context: 'يجب فتح الرابط من HTTPS حتى تعمل إشعارات المتصفح.',
          missing_vapid_key: 'لم يتم إعداد مفتاح الإشعارات العام في نسخة الموقع بعد. يحتاج المدرس إلى إضافته في إعدادات النشر.',
          invalid_vapid_key: 'مفتاح الإشعارات العام غير صحيح أو لا يطابق إعدادات الخادم. يحتاج المدرس إلى مراجعة إعدادات VAPID.',
          service_worker_timeout: 'خدمة الموقع لم تجهز بعد. أعد تحميل الصفحة وانتظر ثواني ثم أعد المحاولة.',
          invalid_token: 'رابط الطالب غير صالح أو منتهي. اطلب رابط QR جديدًا من المدرس.',
        }
        setParentPushMessage(messages[result.reason] || messages.default)
      }
    } catch (err) {
      console.error('[PublicQRPage] parent push registration failed:', err)
      setParentPushMessage(String(err?.message || '').includes('subscription_rpc_failed')
        ? 'تم السماح بالإشعارات، لكن لم يتم حفظ الاشتراك. أعد تحميل الصفحة وحاول مرة أخرى.'
        : 'حدث خطأ أثناء تفعيل الإشعارات. أعد تحميل الصفحة وحاول مرة أخرى.')
    } finally { setParentPushBusy(false) }
  }

  // ─── Loading ───
  if (state === 'loading') {
    return (
      <Shell>
        <div style={spinner}><div style={spinnerRing} /></div>
        <p style={loadingText}>جاري التحميل...</p>
      </Shell>
    )
  }

  // ─── Not Found / Revoked ───
  if (state === 'not_found') {
    return (
      <Shell>
        <div style={errorCard}>
          <div style={errorIcon}>🔒</div>
          <h2 style={errorTitle}>الرابط غير متاح</h2>
          <p style={errorDesc}>هذا الرابط غير صالح أو تم إلغاؤه. تواصل مع المدرس للحصول على رابط جديد.</p>
        </div>
        <p style={footerText}>Powered by النخبة</p>
      </Shell>
    )
  }

  // ─── Error ───
  if (state === 'error') {
    return (
      <Shell>
        <div style={errorCard}>
          <div style={errorIcon}>⚠️</div>
          <h2 style={errorTitle}>حدث خطأ</h2>
          <p style={errorDesc}>{errorMsg || 'حدث خطأ أثناء التحميل. حاول مرة أخرى.'}</p>
        </div>
        <p style={footerText}>Powered by النخبة</p>
      </Shell>
    )
  }

  // ─── Ready — Full Portal ───
  // FIX (defensive): 'ready' must always co-occur with a portal object; if a
  // race ever leaves portal null, render the loading shell instead of letting
  // the destructure throw into the error boundary.
  if (!portal) {
    return (
      <Shell>
        <div style={spinner}><div style={spinnerRing} /></div>
        <p style={loadingText}>جاري التحميل...</p>
      </Shell>
    )
  }
  const { student, ranks, sessionToday, lessonSessions, lessonAttendance, announcements, activity, homework, examResults, streak, whatsappNumber, paymentSummary, lessonPrice, notifications: portalNotifications, unreadNotificationCount, branding, accessStatus, teacherName } = portal
  const rank = getStudentRank(student.points, ranks)
  // Every session as its own separate card, newest first (no more 3-slot
  // current/previous/next collapse — the parent sees the FULL history).
  const sessionList = buildSessionList(lessonSessions, sessionToday, lessonAttendance)
  // Client-side search across every list — one query, all sections.
  const q = normalizePortalQuery(query)
  const matches = (text) => !q || normalizePortalQuery(String(text || '')).includes(q)
  const visibleSessions = sessionList.filter((l) => matches([l.lesson_topic, l.homework_text, formatDate(l.session_date), l.attendance_status, l.homework_status].join(' ')))
  const visibleHomework = homework.filter((h) => matches(h.title))
  const visibleExams = examResults.filter((e) => matches(e.title))
  const visibleAnnouncements = announcements.filter((a) => matches([a.title, a.message].join(' ')))
  const visibleNotifications = (portalNotifications || []).filter((n) => matches([n.title, n.body].join(' ')))
  const searching = q.length > 0

  // Mark notification as read
  const handleMarkNotifRead = async (notifId) => {
    if (!tokenRef.current) return
    // FIX (silent failures): check the RPC result. Previously the error was ignored
    // and the UI flipped to "read" only to be reverted by the next 10s refresh.
    const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: notifId, p_token: tokenRef.current })
    if (error) {
      console.warn('[PublicQRPage] mark_notification_read failed:', error.message)
      return
    }
    // Record optimistic state so a racing background refresh cannot revert it.
    optimisticRef.current.readNotifIds.add(notifId)
    // Update local state
    setPortal(prev => ({
      ...prev,
      notifications: (prev.notifications || []).map(n => n.id === notifId ? { ...n, is_read: true } : n),
      unreadNotificationCount: Math.max(0, Number(prev.unreadNotificationCount || 0) - 1),
    }))
  }

  // Mark all notifications as read
  const handleMarkAllRead = async () => {
    if (!tokenRef.current) return
    const { error } = await supabase.rpc('mark_all_notifications_read', { p_token: tokenRef.current })
    if (error) {
      console.warn('[PublicQRPage] mark_all_notifications_read failed:', error.message)
      return
    }
    optimisticRef.current.allRead = true
    setPortal(prev => ({
      ...prev,
      notifications: (prev.notifications || []).map(n => ({ ...n, is_read: true })),
      unreadNotificationCount: 0,
    }))
  }

  return (
    <Shell wide teacherName={teacherName} branding={branding}>
      {/* Student Card */}
      <div style={studentCard}>
        <div style={avatarCircle}>{(student.name || '؟').trim().charAt(0)}</div>
        <p style={studentNameText}>{student.name}</p>
        <p style={rankText}>🛡️ {rank || '—'}</p>
        <div style={statRow}>
          <StatPill label="النقاط" value={student.points ?? 0} />
          <StatPill label="الحضور" value={student.attendance_status || 'لم يرصد'} />
          {streak > 0 && <StatPill label="تتابع الحضور" value={`${streak} حصص 🔥`} />}
        </div>
        {accessStatus && (
          <div style={{
            marginTop: 8,
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: 800,
            display: 'inline-block',
            background: accessStatus.paymentStatus === 'partial' ? 'rgba(255,215,0,0.15)' : accessStatus.paymentStatus === 'paid' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            color: accessStatus.paymentStatus === 'partial' ? GOLD : accessStatus.paymentStatus === 'paid' ? '#86EFAC' : '#FCA5A5',
          }}>
            {accessStatus.blockedByWarnings ? `⛔ ممنوع الدخول بعد ${accessStatus.warnings} إنذارات` : accessStatus.entryAllowed ? `✅ مسموح بالدخول` : `⚠ الدفع مطلوب — المتبقي ${Math.max(0, Number(accessStatus.lessonPrice || 0) - Number(accessStatus.totalPaid || 0))} ج.م`}
          </div>
        )}
      </div>

      {/* QR Code — collapsible */}
      <SectionCard title="QR Code الطالب" collapsible expanded={showQR} onToggle={() => setShowQR((v) => !v)}>
        {showQR && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={qrBorder}>
              {qrDataUrl ? <img src={qrDataUrl} alt="Student QR Code" style={qrImage} /> : <div style={{ width: 220, height: 220 }} />}
            </div>
            <input
              readOnly
              dir="ltr"
              value={portalUrl}
              onFocus={(e) => e.target.select()}
              style={{
                width: '100%', maxWidth: 420, padding: '10px 12px', textAlign: 'center',
                fontSize: 13, borderRadius: 12, border: '1px solid rgba(148,163,184,0.45)',
                background: 'rgba(255,255,255,0.9)', color: '#0F172A', userSelect: 'all', direction: 'ltr',
              }}
              aria-label="رابط البوابة"
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              <button onClick={handleCopyPortalLink} style={{ ...outlineBtn, padding: '10px' }}>
                {copiedLink ? '✅ تم نسخ رابط البوابة' : '📋 نسخ رابط البوابة'}
              </button>
              <button onClick={handleSharePortalLink} style={{ ...goldBtn, padding: '10px' }}>مشاركة الرابط</button>
            </div>
            <button onClick={handleDownloadQR} style={goldBtn} disabled={!qrDataUrl}>تحميل QR Code</button>
          </div>
        )}
      </SectionCard>

      {/* Search — filters sessions, homework, exams, announcements, notifications */}
      <div style={{ width: '100%' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 ابحث في الحصص والواجبات والنتائج..."
          style={searchInput}
          aria-label="بحث في البوابة"
        />
      </div>

      {/* Sessions — each session is its own separate, self-contained card */}
      <SectionCard title={`الحصص${sessionList.length ? ` (${sessionList.length})` : ''}`}>
        {visibleSessions.length === 0 && <EmptyLine text={searching ? 'لا توجد حصص مطابقة للبحث' : 'لا يوجد سجل حصة حتى الآن'} />}
        {visibleSessions.map((lesson, idx) => (
          <div key={lesson.id || `${lesson.session_date}-${idx}`} style={sessionCard}>
            <div style={sessionCardHead}>
              <strong style={{ color: NAVY, fontSize: 13.5 }}>
                {lesson._isToday ? '📌 حصة اليوم' : `حصة ${formatDate(lesson.session_date)}`}
              </strong>
              <span style={{ ...statusBadge, ...attendanceBadgeStyle(lesson.attendance_status) }}>
                {lesson.attendance_status || 'لم يرصد'}
              </span>
            </div>
            <div style={sessionCardRow}>
              <span style={{ ...statusBadge, ...homeworkBadgeStyle(lesson.homework_status) }}>
                الواجب: {lesson.homework_status || 'لم يرصد'}
              </span>
            </div>
            {lesson.lesson_topic && <p style={sessionTopic}><b>الدرس:</b> {lesson.lesson_topic}</p>}
            {lesson.homework_text && <p style={sessionTopic}><b>الواجب المطلوب:</b> {lesson.homework_text}</p>}
            {lesson.video_link && (
              <a href={lesson.video_link} target="_blank" rel="noreferrer" style={{ ...goldBtn, display: 'inline-block', textDecoration: 'none', textAlign: 'center', marginTop: 8, padding: '9px 20px' }}>🎥 مشاهدة فيديو الحصة</a>
            )}
          </div>
        ))}
      </SectionCard>

      {/* Announcements */}
      <SectionCard title={`الإعلانات${visibleAnnouncements.length ? ` (${visibleAnnouncements.length})` : ''}`}>
        {visibleAnnouncements.length === 0 && <EmptyLine text={searching ? 'لا توجد إعلانات مطابقة' : 'لا توجد إعلانات حالياً'} />}
        {visibleAnnouncements.map((a) => (
          <div key={a.id} style={feedItem}>
            <p style={feedTitle}>{a.title}</p>
            <p style={feedMsg}>{a.message}</p>
            <p style={feedDate}>{formatDateTime(a.created_at)}</p>
          </div>
        ))}
      </SectionCard>

      {/* Homework */}
      <SectionCard title="الواجبات">
        {visibleHomework.length === 0 && <EmptyLine text={searching ? 'لا توجد واجبات مطابقة' : 'لا توجد واجبات مسجلة'} />}
        {visibleHomework.map((h) => (
          <div key={h.id} style={hwRow}>
            <div style={{ flex: 1 }}>
              <p style={hwTitle}>{h.title}</p>
              {h.due_date && <p style={hwDue}>تسليم: {formatDate(h.due_date)}</p>}
            </div>
            {h.done ? (
              <span style={hwDoneBadge}>✓ تم</span>
            ) : (
              <button
                style={hwDoneBtn}
                disabled={markingTaskId === h.id}
                onClick={() => handleMarkHomeworkDone(h.id)}
              >
                {markingTaskId === h.id ? '...' : 'تحديد كمكتمل'}
              </button>
            )}
          </div>
        ))}
      </SectionCard>

      {/* Exam results */}
      <SectionCard title="نتائج الامتحانات">
        {visibleExams.length === 0 && <EmptyLine text={searching ? 'لا توجد نتائج مطابقة' : 'لا توجد نتائج امتحانات بعد'} />}
        {visibleExams.map((e) => (
          <div key={e.id} style={feedItem}>
            <p style={feedTitle}>{e.title}</p>
            <p style={feedMsg}>{e.total} / {e.max}</p>
            <p style={feedDate}>{formatDateTime(e.date)}</p>
          </div>
        ))}
      </SectionCard>

      {/* Recent activity */}
      <SectionCard title="آخر النشاطات">
        {activity.length === 0 && <EmptyLine text="لا يوجد نشاط مسجل بعد" />}
        {activity.map((item, i) => (
          <div key={i} style={activityRow}>
            <span style={{ ...activityDot, background: item.color }} />
            <div style={{ flex: 1 }}>
              <p style={activityText}>{item.text}</p>
              <p style={feedDate}>{formatDateTime(item.date)}</p>
            </div>
          </div>
        ))}
      </SectionCard>

      {/* Payment Status */}
      <SectionCard title="حالة المدفوعات">
        {lessonPrice ? (
          <>
            <InfoLine label="سعر الحصة" value={`${lessonPrice} ج.م`} />
            <InfoLine label="إجمالي المدفوع" value={`${paymentSummary?.totalPaid || 0} ج.م`} />
            <InfoLine label="عدد الدفعات" value={String(paymentSummary?.paymentCount || 0)} />
          </>
        ) : (
          <EmptyLine text="لم يتم تحديد سعر الحصة بعد" />
        )}
      </SectionCard>

      {/* Notifications */}
      <SectionCard
        title={`التنبيهات${unreadNotificationCount > 0 ? ` (${unreadNotificationCount} جديد)` : ''}`}
        collapsible expanded={notifExpanded} onToggle={() => setNotifExpanded(v => !v)}
      >
            {notifExpanded && (
          <>
            {!parentPushEnabled && (
              <>
                <button type="button" onClick={handleEnableParentPush} disabled={parentPushBusy} style={{ ...goldBtn, fontSize: 12, padding: '7px 12px', marginBottom: 6 }}>
                  {parentPushBusy ? 'جاري التفعيل...' : '🔔 تفعيل إشعارات ولي الأمر على هذا الجهاز'}
                </button>
                {typeof Notification === 'undefined' && (
                  <p style={{ ...feedMsg, color: '#FCA5A5' }}>
                    {isIOSBrowser()
                      ? 'على الآيفون: اضغط زر المشاركة (Share) فوق ↑ ثم «إضافة إلى الشاشة الرئيسية»، افتح الموقع من الأيقونة الجديدة ثم فعّل الإشعارات من الزر.'
                      : 'هذا المتصفح لا يوفر إشعارات Push. جرّب Chrome أو Edge على HTTPS.'}
                  </p>
                )}
                {parentPushMessage && <p style={{ ...feedMsg, color: parentPushMessage.startsWith('تم تفعيل') ? '#86EFAC' : GOLD }}>{parentPushMessage}</p>}
              </>
            )}
            {parentPushEnabled && <p style={{ ...feedMsg, color: '#86EFAC', marginBottom: 8 }}>✅ إشعارات المتصفح مفعّلة لهذا الطالب على هذا الجهاز.</p>}
            {unreadNotificationCount > 0 && (
              <button onClick={handleMarkAllRead} style={{ ...goldBtn, fontSize: 12, padding: '6px 12px', marginBottom: 8 }}>
                قراءة الكل
              </button>
            )}
            {(visibleNotifications).length === 0 && <EmptyLine text={searching ? 'لا توجد تنبيهات مطابقة' : 'لا توجد تنبيهات'} />}
            {(visibleNotifications).slice(0, 10).map((n) => (
              <div
                key={n.id}
                onClick={() => !n.is_read && handleMarkNotifRead(n.id)}
                style={{
                  ...feedItem,
                  backgroundColor: n.is_read ? 'transparent' : 'rgba(255,215,0,0.06)',
                  borderLeft: n.is_read ? 'none' : `3px solid ${GOLD}`,
                  cursor: n.is_read ? 'default' : 'pointer',
                }}
              >
                <p style={{ ...feedTitle, fontSize: 13, fontWeight: n.is_read ? 400 : 700 }}>{n.title}</p>
                {n.body && <p style={feedMsg}>{n.body}</p>}
                <p style={feedDate}>{formatDateTime(n.created_at)}</p>
                {n.deep_link && n.deep_link.startsWith('http') && <a href={n.deep_link} target="_blank" rel="noreferrer" style={{ ...goldBtn, display: 'inline-block', textDecoration: 'none', marginTop: 6 }}>فتح الرابط</a>}
              </div>
            ))}
          </>
        )}
      </SectionCard>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        {whatsappNumber && (
          <button onClick={handleWhatsAppTeacher} style={whatsappBtn}>
            💬 تواصل مع المستر
          </button>
        )}
        <button onClick={handleDownloadReport} style={outlineBtn} disabled={downloading}>
          {downloading ? 'جاري التحضير...' : '📄 تحميل تقرير الشهر'}
        </button>
      </div>

      {/* Portal notifications are shown in the in-portal notifications section above. */}

      <p style={footerText}>Powered by النخبة</p>
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function asArray(value) {
  return Array.isArray(value) ? value : []
}

// FIX (portal crash): display fields coming from the RPC must never be raw
// objects — React throws "Objects are not valid as a React child" and the
// whole portal falls into the error-boundary screen. Non-objects are coerced
// to String (display-identical to what React would render anyway) so calls
// like student.name.trim() can never throw. null/undefined pass through
// untouched so existing empty-state rendering stays identical.
function asText(value) {
  if (value === null || value === undefined) return value
  if (typeof value === 'object') return ''
  return String(value)
}
function asNum(value) {
  if (value === null || value === undefined) return value
  if (typeof value === 'object') return 0
  return value
}

// Safely extract the optional session copy returned by get_student_portal_access
// (sourced from the finalized session log — it carries the teacher's saved
// topic/homework/video even when the lesson_sessions row is an empty stub).
function rawAccessFallbackSession(access) {
  if (!access || typeof access !== 'object') return null
  return access.sessionToday || access.session_today || null
}

/**
 * Normalize an Arabic/English search string for the portal search box:
 * lowercase, strip tashkeel/tatweel, unify alef/yaa/taa-marbuta variants.
 */
function normalizePortalQuery(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
}

/**
 * Build the FULL session list shown on the portal: one entry per session,
 * newest first, with today's session flagged. Replaces the old 3-slot
 * (current/previous/next) timeline so every session is visible separately.
 */
function buildSessionList(lessonSessions, sessionToday, lessonAttendance = []) {
  const dateKey = (value) => {
    if (!value) return ''
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
    const d = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const today = dateKey(new Date())
  // FIX (portal crash): a null/invalid row inside lesson_sessions used to throw
  // (reading .session_date/.id of null) and crash the whole portal render.
  const records = (Array.isArray(lessonSessions) ? lessonSessions : []).filter((l) => l && typeof l === 'object')
  // FIX (timeline completeness): real lesson-attendance rows carry the lesson
  // they belong to (topic, homework, video, final status). Merge them in so a
  // "ghost" empty lesson cannot hide the lesson where the student's marks
  // actually live.
  for (const row of (Array.isArray(lessonAttendance) ? lessonAttendance : [])) {
    const lessonId = row?.lesson_session_id || row?.id
    if (!lessonId) continue
    if (records.some((lesson) => lesson.id === lessonId)) continue
    records.push({
      id: lessonId,
      session_date: row.session_date,
      status: row.session_status || 'open',
      lesson_topic: row.lesson_topic,
      homework_text: row.homework_text,
      video_link: row.video_link,
      attendance_status: row.status,
      homework_status: row.homework_status,
      started_at: row.recorded_at,
    })
  }
  if (sessionToday?.session_date && !records.some((lesson) => lesson.id === sessionToday.id)) records.push(sessionToday)
  // Deduplicate by id (a lesson can arrive from both lists).
  const seen = new Set()
  const unique = records.filter((lesson) => {
    const key = lesson.id || lesson.session_date
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  // A lesson with real content (topic/homework/marks) outranks an empty stub
  // inside the same day; otherwise strictly newest first.
  const hasData = (lesson) => Boolean(lesson.lesson_topic || lesson.homework_text || (lesson.attendance_status && lesson.attendance_status !== 'لم يرصد') || (lesson.homework_status && lesson.homework_status !== 'لم يرصد'))
  unique.sort((a, b) => {
    const byDate = dateKey(b.session_date).localeCompare(dateKey(a.session_date))
    if (byDate !== 0) return byDate
    return Number(hasData(b)) - Number(hasData(a)) || new Date(b.started_at || b.created_at || 0) - new Date(a.started_at || a.created_at || 0)
  })
  for (const lesson of unique) lesson._isToday = dateKey(lesson.session_date) === today
  return unique
}

function buildActivityFeed(attendance, behavior) {
  // Keep one final attendance state per lesson/day; never render a present/absent trail for the same day.
  const latestByDay = new Map()
  for (const record of attendance || []) {
    if (!record?.recorded_at || !record.status || record.status === 'لم يرصد') continue
    const dayKey = record.lesson_session_id || new Date(record.recorded_at).toISOString().slice(0, 10)
    const previous = latestByDay.get(dayKey)
    if (!previous || new Date(record.recorded_at) > new Date(previous.recorded_at)) latestByDay.set(dayKey, record)
  }
  const items = [
    ...Array.from(latestByDay.values()).map((a) => ({
      date: a.recorded_at,
      text: a.status === 'حاضر' ? '✔️ سجّل حضور' : a.status === 'غائب' ? '✖️ سجّل غياب' : `تحديث الحضور: ${a.status}`,
      color: a.status === 'حاضر' ? '#22C55E' : a.status === 'غائب' ? '#EF4444' : '#94A3B8',
    })),
    ...(behavior || []).map((b) => ({
      date: b.created_at,
      text: `${b.points_delta >= 0 ? '➕' : '➖'} ${Math.abs(b.points_delta)} نقطة${b.note ? ' — ' + b.note : ''}`,
      color: b.points_delta >= 0 ? '#22C55E' : '#F97316',
    })),
  ]
  items.sort((a, b) => new Date(b.date) - new Date(a.date))
  return items.slice(0, 10)
}

function buildUpcomingSessions(weekdays, count) {
  if (!weekdays || weekdays.length === 0) return []
  const result = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  cursor.setDate(cursor.getDate() + 1) // start from tomorrow
  let safety = 0
  while (result.length < count && safety < 30) {
    if (weekdays.includes(cursor.getDay())) result.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
    safety++
  }
  return result
}

function formatDate(d) {
  try {
    return new Date(d).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
  } catch { return String(d) }
}

function formatDateTime(d) {
  try {
    return new Date(d).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return String(d) }
}

// ═══════════════════════════════════════════════════════════════
// Small presentational components
// ═══════════════════════════════════════════════════════════════

function Shell({ children, wide, teacherName, branding }) {
  const palette = getPalette(branding?.palette_key)
  const displayName = branding?.display_name || teacherName || 'النخبة'
  const welcomeText = branding?.portal_header_text || branding?.portal_welcome_message || 'إدارة الحصص الذكية'
  const logoUrl = branding?.logo_url || '/nokhba-mark.svg'
  const shellStyle = { ...pageBg, '--portal-primary': palette.primary, '--portal-accent': palette.accent, '--portal-accent-hover': palette.accentHover }
  return (
    <div style={shellStyle}>
      <div style={{ ...container, maxWidth: wide ? '460px' : '380px' }}>
        <div style={logoArea}>
          <img src={logoUrl} alt="" style={portalLogo} />
          {teacherName && <div style={{ ...logoSub, color: palette.primary, fontWeight: 800 }}>— {teacherName}</div>}
          <div style={logoText}>{displayName}</div>
          <div style={logoSub}>{welcomeText}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

function SectionCard({ title, children, collapsible, expanded, onToggle }) {
  return (
    <div style={sectionCard}>
      <div
        style={{ ...sectionHeader, cursor: collapsible ? 'pointer' : 'default' }}
        onClick={collapsible ? onToggle : undefined}
      >
        <span>{title}</span>
        {collapsible && <span style={{ fontSize: 13, color: GRAY_400 }}>{expanded ? '▲' : '▼'}</span>}
      </div>
      {(!collapsible || expanded !== undefined) && (
        <div style={{ display: collapsible && !expanded ? 'none' : 'block' }}>
          <div style={sectionBody}>{children}</div>
        </div>
      )}
    </div>
  )
}

function StatPill({ label, value }) {
  return (
    <div style={statPill}>
      <span style={statPillValue}>{value}</span>
      <span style={statPillLabel}>{label}</span>
    </div>
  )
}

function InfoLine({ label, value }) {
  return (
    <div style={infoLine}>
      <span style={infoLineLabel}>{label}</span>
      <span style={infoLineValue}>{value}</span>
    </div>
  )
}

function EmptyLine({ text }) {
  return <p style={emptyText}>{text}</p>
}

// ═══════════════════════════════════════════════════════════════
// Design tokens — El No5ba: navy #001f43, gold #FFD700
// ═══════════════════════════════════════════════════════════════

const NAVY = '#172033'
const NAVY_LIGHT = '#f8fafc'
const GOLD = '#0f766e'
const GOLD_HOVER = '#0d9488'
const WHITE = '#172033'
const GRAY_400 = '#718096'
const GREEN = '#25D366'

const pageBg = {
  minHeight: '100vh',
  display: 'flex',
  justifyContent: 'center',
  background: 'linear-gradient(160deg, #f4f7fb 0%, #ffffff 52%, #eef3f7 100%)',
  padding: '20px 16px 40px',
  fontFamily: "'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif",
  direction: 'rtl',
}

const container = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '14px',
}

const logoArea = {
  textAlign: 'center',
  paddingBottom: '16px',
  marginBottom: '4px',
  borderBottom: `2px solid ${GOLD}`,
  width: '100%',
}

const portalLogo = { width: 52, height: 52, borderRadius: 14, objectFit: 'cover', marginBottom: 6 }
const logoText = { fontSize: '30px', fontWeight: 900, color: NAVY, margin: 0, lineHeight: 1.2 }
const logoSub = { fontSize: '12px', color: GRAY_400, marginTop: '4px' }

const studentCard = {
  width: '100%',
  background: 'rgba(255,255,255,0.9)',
  border: '1px solid rgba(148,163,184,0.26)',
  borderRadius: '20px',
  padding: '22px 18px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
}

const avatarCircle = {
  width: 56, height: 56, borderRadius: '50%',
  background: `linear-gradient(135deg, ${GOLD} 0%, ${GOLD_HOVER} 100%)`,
  color: NAVY, fontSize: 24, fontWeight: 900,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  marginBottom: 4,
}

const studentNameText = { fontSize: '19px', fontWeight: 800, color: NAVY, margin: 0, textAlign: 'center' }
const rankText = { fontSize: '13px', color: GOLD, margin: 0, fontWeight: 700 }

const statRow = { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }
const statPill = {
  background: '#f8fafc', borderRadius: '12px', padding: '8px 14px',
  display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70,
}
const statPillValue = { fontSize: '15px', fontWeight: 800, color: NAVY }
const statPillLabel = { fontSize: '10px', color: GRAY_400, marginTop: 2 }

const sectionCard = {
  width: '100%',
  background: 'rgba(255,255,255,0.9)',
  border: '1px solid rgba(148,163,184,0.26)',
  borderRadius: '16px',
  overflow: 'hidden',
}

const sectionHeader = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '14px 16px', fontSize: '14px', fontWeight: 800, color: GOLD,
  borderBottom: '1px solid rgba(148,163,184,0.2)',
}

const sectionBody = { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }

const infoLine = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '13px' }
const infoLineLabel = { color: GRAY_400 }
const infoLineValue = { color: NAVY, fontWeight: 600, textAlign: 'left' }

const subDivider = { height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }
const subLabel = { fontSize: '12px', color: GRAY_400, fontWeight: 700, margin: '0 0 4px 0' }

const emptyText = { fontSize: '13px', color: GRAY_400, margin: 0, textAlign: 'center', padding: '4px 0' }

// FIX (contrast): message text was #CBD5E1 (very light) on white/near-white
// cards — practically invisible. Switched to a readable slate gray, and the
// dividers used a white alpha that was invisible on the light background.
const feedItem = { paddingBottom: 10, borderBottom: '1px solid rgba(148,163,184,0.25)' }
const feedTitle = { fontSize: '13px', fontWeight: 800, color: NAVY, margin: '0 0 2px 0' }
const feedMsg = { fontSize: '13px', color: '#475569', margin: '0 0 4px 0', lineHeight: 1.5 }
const feedDate = { fontSize: '10.5px', color: GRAY_400, margin: 0 }

const hwRow = { display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottom: '1px solid rgba(148,163,184,0.25)' }
const hwTitle = { fontSize: '13px', fontWeight: 700, color: NAVY, margin: 0 }
const hwDue = { fontSize: '11px', color: GRAY_400, margin: '2px 0 0 0' }
const hwDoneBadge = { fontSize: '12px', fontWeight: 800, color: '#22C55E', whiteSpace: 'nowrap' }
const hwDoneBtn = {
  fontSize: '11px', fontWeight: 700, color: NAVY, background: GOLD, border: 'none',
  borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
}

const activityRow = { display: 'flex', gap: 10, alignItems: 'flex-start' }
const activityDot = { width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0 }
const activityText = { fontSize: '13px', color: NAVY, margin: 0 }

const qrBorder = {
  border: `3px solid ${GOLD}`, borderRadius: '14px', padding: '12px',
  display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#FFFFFF',
}
// imageRendering 'pixelated' keeps QR module edges razor-sharp when the
// 640px source is displayed at ~220px — sharper edges = faster, more
// reliable scans from every screen/camera.
const qrImage = { width: '220px', height: '220px', display: 'block', imageRendering: 'pixelated' }

// ── Portal search + per-session cards ─────────────────────────
const searchInput = {
  width: '100%', padding: '12px 16px', fontSize: '14px', fontWeight: 600,
  borderRadius: '14px', border: '1.5px solid rgba(148,163,184,0.35)',
  background: '#FFFFFF', color: NAVY, fontFamily: "'Cairo', sans-serif",
  outline: 'none', boxSizing: 'border-box',
}

const sessionCard = {
  border: '1px solid rgba(148,163,184,0.3)', borderRadius: '14px',
  padding: '12px 14px', background: '#FBFDFE',
  display: 'flex', flexDirection: 'column', gap: 6,
}
const sessionCardHead = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 8, flexWrap: 'wrap', paddingBottom: 6, borderBottom: '1px dashed rgba(148,163,184,0.35)',
}
const sessionCardRow = { display: 'flex', gap: 6, flexWrap: 'wrap' }
const sessionTopic = { fontSize: '12.5px', color: '#334155', margin: 0, lineHeight: 1.55 }

const statusBadge = {
  display: 'inline-block', fontSize: '11px', fontWeight: 800,
  padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap',
}
function attendanceBadgeStyle(status) {
  if (status === 'حاضر') return { background: 'rgba(34,197,94,0.14)', color: '#15803D' }
  if (status === 'غائب') return { background: 'rgba(239,68,68,0.12)', color: '#B91C1C' }
  return { background: 'rgba(148,163,184,0.16)', color: '#475569' }
}
function homeworkBadgeStyle(status) {
  if (status === 'تم' || status === 'تم تمامًا') return { background: 'rgba(34,197,94,0.14)', color: '#15803D' }
  if (status === 'ناقص' || status === 'جزئي') return { background: 'rgba(245,158,11,0.16)', color: '#B45309' }
  if (status === 'لم يتم') return { background: 'rgba(239,68,68,0.12)', color: '#B91C1C' }
  return { background: 'rgba(148,163,184,0.16)', color: '#475569' }
}

const goldBtn = {
  background: `linear-gradient(135deg, ${GOLD} 0%, ${GOLD_HOVER} 100%)`,
  color: NAVY, border: 'none', borderRadius: '14px', padding: '12px 32px',
  fontSize: '14px', fontWeight: 800, cursor: 'pointer', fontFamily: "'Cairo', sans-serif",
  width: '100%', maxWidth: '260px',
}

const whatsappBtn = {
  background: GREEN, color: WHITE, border: 'none', borderRadius: '14px', padding: '14px',
  fontSize: '14px', fontWeight: 800, cursor: 'pointer', fontFamily: "'Cairo', sans-serif", width: '100%',
}

const outlineBtn = {
  background: 'transparent', color: GOLD, border: `1.5px solid ${GOLD}`, borderRadius: '14px', padding: '14px',
  fontSize: '14px', fontWeight: 800, cursor: 'pointer', fontFamily: "'Cairo', sans-serif", width: '100%',
}

const footerText = { fontSize: '11px', color: GRAY_400, margin: '8px 0 0 0' }

const spinner = { width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const spinnerRing = {
  width: '36px', height: '36px', border: `4px solid rgba(255,215,0,0.2)`,
  borderTopColor: GOLD, borderRadius: '50%', animation: 'spin 0.8s linear infinite',
}
const loadingText = { color: GRAY_400, fontSize: '14px', margin: 0 }

const errorCard = {
  background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(148,163,184,0.26)',
  borderRadius: '20px', padding: '32px 24px', textAlign: 'center', width: '100%',
}
const errorIcon = { fontSize: '48px', marginBottom: '12px' }
const errorTitle = { fontSize: '20px', fontWeight: 800, color: NAVY, margin: '0 0 8px 0' }
const errorDesc = { fontSize: '13px', color: GRAY_400, lineHeight: 1.6, margin: 0 }
