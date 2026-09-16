/**
 * Student/Parent Portal — /qr/:token
 * No authentication required — access is controlled entirely by the token.
 *
 * Shows: student card (name/rank/points), collapsible QR code, today's
 * session status, announcements feed, recent activity, homework tasks,
 * exam/quiz results, attendance streak, a WhatsApp button to the teacher,
 * and a "download monthly report" button.
 *
 * Auto-refreshes every 45s while open (simple polling — no realtime
 * subscriptions, so there's nothing to reconnect/clean up and far fewer
 * ways for it to silently break).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabaseClient'
import { getStudentRank } from '../lib/helpers'
import { getPalette } from '../lib/palettes'
import { generateStudentReportPDF } from '../lib/qrPdfWhatsApp'
import { registerStudentPush } from '../lib/pushNotifications'

const REFRESH_MS = 10000
const WEEKDAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default function PublicQRPage() {
  const [state, setState] = useState('loading') // loading | ready | not_found | error
  const [errorMsg, setErrorMsg] = useState('')
  const [showQR, setShowQR] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [markingTaskId, setMarkingTaskId] = useState(null)
  const [notifExpanded, setNotifExpanded] = useState(true)
  const [parentPushEnabled, setParentPushEnabled] = useState(false)
  const [parentPushBusy, setParentPushBusy] = useState(false)
  const [parentPushMessage, setParentPushMessage] = useState('')

  const tokenRef = useRef('')
  const [portal, setPortal] = useState(null)
  // portal = { student, teacherId, ranks, whatsappNumber, sessionToday,
  //            upcomingSessions, announcements, activity, homework,
  //            examResults, streak }

  const load = useCallback(async (isBackgroundRefresh = false) => {
    const token = tokenRef.current
    if (!token) return
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
      const { data: payload, error } = await supabase.rpc('get_student_portal_data', { p_token: token })
      if (error) {
        console.error('[PublicQRPage] RPC error:', error.message || error, 'code:', error.code)
        if (!isBackgroundRefresh) {
          setState('error')
          // Show a detailed error so the user can report exactly what went wrong
          setErrorMsg(`خطأ في الخادم: ${error.message || 'خطأ غير معروف'} (كود: ${error.code || '؟'})`)
        }
        return
      }

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
      const { data: access, error: accessError } = await supabase.rpc('get_student_portal_access', { p_token: token })
      if (accessError) console.warn('[PublicQRPage] optional access RPC failed:', accessError.message || accessError)
      const { data: teacherName, error: teacherNameError } = await supabase.rpc('get_portal_teacher_name', { p_token: token })
      if (teacherNameError) console.warn('[PublicQRPage] optional teacher-name RPC failed:', teacherNameError.message || teacherNameError)
      // RPC responses can differ briefly while migrations are being deployed.
      // Only arrays are safe to iterate; treating malformed values as empty
      // keeps the student portal usable and lets the teacher repair the data.
      const ranks = asArray(payload.ranks)
      const whatsappNumber = payload.whatsapp_number || ''
      const attendance = asArray(payload.attendance)
      const behavior = asArray(payload.behavior)
      const announcements = asArray(payload.announcements)
      const examScores = asArray(payload.exam_scores)
      const sessionToday = payload.session_log || access?.sessionToday || null
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
      const scheduledWeekdays = asArray(payload.schedule).map((r) => r.weekday).filter(Number.isInteger).sort((a, b) => a - b)
      const homeworkTasks = asArray(payload.homework_tasks)
      const homeworkStatus = asArray(payload.homework_status)

      // Compute exam results (max score = max_per_section * sections_count)
      const examResults = examScores.map((s) => {
        const sectionsCount = (s.exam_sections || []).length || 1
        const max = (s.exam_max_per_section || 0) * sectionsCount
        return {
          id: s.id,
          title: s.exam_title || 'امتحان',
          total: s.total_score,
          max,
          date: s.created_at,
        }
      })

      // Map homework tasks with their done status
      const homeworkStatusByTask = {}
      for (const hs of homeworkStatus) homeworkStatusByTask[hs.task_id] = hs.done
      const homework = homeworkTasks.map((t) => ({ ...t, done: !!homeworkStatusByTask[t.id] }))

      // Attendance streak: count consecutive 'حاضر' from most recent record
      let streak = 0
      for (const rec of attendance) {
        if (rec.status === 'حاضر') streak++
        else break
      }

      // Upcoming sessions: next occurrences of scheduled weekdays
      const upcomingSessions = buildUpcomingSessions(scheduledWeekdays, 3)

      setPortal({
        student,
        teacherId: student.teacher_id,
        ranks,
        whatsappNumber,
        sessionToday: sessionToday || accessStatus.sessionToday || null,
        upcomingSessions,
        announcements,
        activity: buildActivityFeed(attendance, behavior),
        homework,
        examResults,
        streak,
        tokenSource: payload.token_source || 'db',
        accessStatus,
        paymentSummary: { totalPaid: accessStatus.totalPaid, paymentCount: accessStatus.paymentCount },
        lessonPrice: accessStatus.lessonPrice,
        teacherName: teacherName || '',
        notifications: asArray(payload.notifications),
        unreadNotificationCount: Number(payload.unreadNotificationCount ?? payload.unread_notification_count ?? 0),
        branding: payload.branding && typeof payload.branding === 'object' ? payload.branding : null,
      })
      setState('ready')
    } catch (err) {
      console.error('Portal load error:', err)
      if (!isBackgroundRefresh) {
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
    const interval = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(interval)
  }, [load])

  // Generate QR image lazily, only when the section is expanded
  useEffect(() => {
    if (!showQR || qrDataUrl || !portal?.student?.id) return
    QRCode.toDataURL(portal.student.id, {
      width: 280, margin: 1,
      color: { dark: '#0E2954', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    }).then(setQrDataUrl).catch(() => {})
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
        setPortal((prev) => prev
          ? { ...prev, homework: prev.homework.map((h) => h.id === taskId ? { ...h, done: true } : h) }
          : prev)
      } else {
        console.warn('[PublicQRPage] mark_homework_done RPC failed:', error.message)
        window.alert('تعذّر تحديد الواجب كمكتمل. تواصل مع المدرس عبر زر "تواصل مع المستر".')
      }
    } catch (err) {
      console.error('Mark homework error:', err)
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
          unsupported: 'هذا المتصفح لا يدعم إشعارات Push. جرّب Chrome أو Edge على HTTPS.',
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
  const { student, ranks, sessionToday, upcomingSessions, announcements, activity, homework, examResults, streak, whatsappNumber, paymentSummary, lessonPrice, notifications: portalNotifications, unreadNotificationCount, branding, accessStatus, teacherName } = portal
  const rank = getStudentRank(student.points, ranks)

  // Mark notification as read
  const handleMarkNotifRead = async (notifId) => {
    if (!tokenRef.current) return
    await supabase.rpc('mark_notification_read', { p_notification_id: notifId, p_token: tokenRef.current })
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
    await supabase.rpc('mark_all_notifications_read', { p_token: tokenRef.current })
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
            <button onClick={handleDownloadQR} style={goldBtn} disabled={!qrDataUrl}>تحميل QR Code</button>
          </div>
        )}
      </SectionCard>

      {/* Session status */}
      <SectionCard title="الحصة">
        {sessionToday ? (
          <>
            <InfoLine label="آخر حصة" value={formatDate(sessionToday.session_date)} />
            {sessionToday.lesson_topic && <InfoLine label="موضوع الدرس" value={sessionToday.lesson_topic} />}
            {sessionToday.homework_text && <InfoLine label="الواجب" value={sessionToday.homework_text} />}
            {sessionToday.video_link && (
              <a href={sessionToday.video_link} target="_blank" rel="noreferrer" style={{ ...goldBtn, display: 'inline-block', textDecoration: 'none', textAlign: 'center', marginTop: 8 }}>🎥 مشاهدة فيديو الحصة</a>
            )}
          </>
        ) : (
          <EmptyLine text="لا يوجد سجل حصة حتى الآن" />
        )}
        {upcomingSessions.length > 0 && (
          <>
            <div style={subDivider} />
            <p style={subLabel}>الحصص القادمة</p>
            {upcomingSessions.map((d, i) => <InfoLine key={i} label={WEEKDAY_NAMES[d.getDay()]} value={formatDate(d)} />)}
          </>
        )}
      </SectionCard>

      {/* Announcements */}
      <SectionCard title={`الإعلانات${announcements.length ? ` (${announcements.length})` : ''}`}>
        {announcements.length === 0 && <EmptyLine text="لا توجد إعلانات حالياً" />}
        {announcements.map((a) => (
          <div key={a.id} style={feedItem}>
            <p style={feedTitle}>{a.title}</p>
            <p style={feedMsg}>{a.message}</p>
            <p style={feedDate}>{formatDateTime(a.created_at)}</p>
          </div>
        ))}
      </SectionCard>

      {/* Homework */}
      <SectionCard title="الواجبات">
        {homework.length === 0 && <EmptyLine text="لا توجد واجبات مسجلة" />}
        {homework.map((h) => (
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
        {examResults.length === 0 && <EmptyLine text="لا توجد نتائج امتحانات بعد" />}
        {examResults.map((e) => (
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
                {typeof Notification === 'undefined' && <p style={{ ...feedMsg, color: '#FCA5A5' }}>هذا المتصفح لا يوفر إشعارات Push.</p>}
                {parentPushMessage && <p style={{ ...feedMsg, color: parentPushMessage.startsWith('تم تفعيل') ? '#86EFAC' : GOLD }}>{parentPushMessage}</p>}
              </>
            )}
            {parentPushEnabled && <p style={{ ...feedMsg, color: '#86EFAC', marginBottom: 8 }}>✅ إشعارات المتصفح مفعّلة لهذا الطالب على هذا الجهاز.</p>}
            {unreadNotificationCount > 0 && (
              <button onClick={handleMarkAllRead} style={{ ...goldBtn, fontSize: 12, padding: '6px 12px', marginBottom: 8 }}>
                قراءة الكل
              </button>
            )}
            {(portalNotifications || []).length === 0 && <EmptyLine text="لا توجد تنبيهات" />}
            {(portalNotifications || []).slice(0, 10).map((n) => (
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

function buildActivityFeed(attendance, behavior) {
  const items = [
    ...attendance.map((a) => ({
      date: a.recorded_at,
      text: a.status === 'حاضر' ? '✔️ سجّل حضور' : a.status === 'غائب' ? '✖️ سجّل غياب' : `تحديث الحضور: ${a.status}`,
      color: a.status === 'حاضر' ? '#22C55E' : a.status === 'غائب' ? '#EF4444' : '#94A3B8',
    })),
    ...behavior.map((b) => ({
      date: b.created_at,
      text: `${b.points_delta >= 0 ? '➕' : '➖'} ${Math.abs(b.points_delta)} نقطة${b.note ? ' — ' + b.note : ''}`,
      color: b.points_delta >= 0 ? '#FFD700' : '#F97316',
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

const feedItem = { paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' }
const feedTitle = { fontSize: '13px', fontWeight: 800, color: NAVY, margin: '0 0 2px 0' }
const feedMsg = { fontSize: '13px', color: '#CBD5E1', margin: '0 0 4px 0', lineHeight: 1.5 }
const feedDate = { fontSize: '10.5px', color: GRAY_400, margin: 0 }

const hwRow = { display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' }
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
  display: 'flex', justifyContent: 'center', alignItems: 'center', background: WHITE,
}
const qrImage = { width: '220px', height: '220px', display: 'block' }

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
