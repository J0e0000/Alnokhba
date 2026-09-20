/**
 * TeacherNotificationCenter — مركز تنبيهات المدرّس
 * 
 * Shows events like: student submission, exam completion, payment recorded,
 * assistant request, student insight triggers.
 * 
 * Reuses the existing NotificationBell pattern but extends it with
 * teacher-specific events from teacher_notification_events table.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { registerTeacherPush, hasTeacherPushSubscription } from '../lib/pushNotifications'

// Swipeable notification row (teacher request): drag a notification sideways
// (either direction, ~80px threshold) to remove it from the list. The inner
// button keeps its normal tap behavior — only horizontal intent swipes.
function SwipeRow({ onRemove, children }) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [gone, setGone] = useState(false)
  const start = useRef(null)

  const onTouchStart = (e) => {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY }
    setDragging(true)
  }
  const onTouchMove = (e) => {
    if (!start.current) return
    const t = e.touches[0]
    const dxNow = t.clientX - start.current.x
    const dyNow = t.clientY - start.current.y
    // Horizontal intent only — vertical drags keep scrolling the list.
    if (Math.abs(dxNow) > Math.abs(dyNow)) setDx(Math.max(-140, Math.min(140, dxNow)))
  }
  const onTouchEnd = () => {
    setDragging(false)
    start.current = null
    if (Math.abs(dx) > 80) {
      setGone(true)
      setTimeout(onRemove, 180)
    } else {
      setDx(0)
    }
  }

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        transform: gone ? `translateX(${dx >= 0 ? '' : '-'}110%)` : `translateX(${dx}px)`,
        opacity: gone ? 0 : Math.max(0.35, 1 - Math.abs(dx) / 180),
        transition: dragging ? 'none' : 'transform .18s ease, opacity .18s ease',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}

export default function TeacherNotificationCenter({ onSelectStudent }) {
  const { effectiveTeacherId } = useAuth()
  const { isArabic } = useLanguage()
  const { showToast } = useToast()
  const [events, setEvents] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [pushPermission, setPushPermission] = useState(() => typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  const [pushReady, setPushReady] = useState(false)

  const loadEvents = useCallback(async () => {
    if (!effectiveTeacherId) return
    try {
      const { data } = await supabase
        .from('teacher_notification_events')
        .select('*')
        .eq('teacher_id', effectiveTeacherId)
        .order('created_at', { ascending: false })
        .limit(30)
      setEvents(data || [])
      setUnreadCount((data || []).filter((e) => !e.is_read).length)
    } catch {
      // table may not exist yet — silently ignore
    }
  }, [effectiveTeacherId])

  useEffect(() => { loadEvents() }, [loadEvents])

  useEffect(() => {
    let active = true
    hasTeacherPushSubscription(effectiveTeacherId).then((ready) => { if (active) setPushReady(ready) }).catch(() => { if (active) setPushReady(false) })
    return () => { active = false }
  }, [effectiveTeacherId])

  const notifyIncoming = (event) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (AudioCtx) { const ctx = new AudioCtx(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.frequency.value = 880; gain.gain.value = 0.045; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.16) }
    } catch {}
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(event.title || 'تنبيه جديد', { body: event.body || '', icon: '/nokhba-mark.svg' })
    showToast(`🔔 ${event.title || (isArabic ? 'تنبيه جديد' : 'New notification')}`, 'info', 4500)
  }

  const enableBrowserNotifications = async () => {
    try {
      const result = await registerTeacherPush(effectiveTeacherId)
      if (!result.ok) { const message = result.reason === 'missing_vapid_key' ? (isArabic ? 'أضف VITE_VAPID_PUBLIC_KEY في إعدادات النشر أولاً' : 'Add VITE_VAPID_PUBLIC_KEY to deployment settings first') : result.reason === 'invalid_vapid_key' ? (isArabic ? 'مفتاح VAPID العام غير صحيح أو لا يطابق المفتاح الموجود في Supabase' : 'The VAPID public key is invalid or does not match Supabase') : result.reason === 'insecure_context' ? (isArabic ? 'الإشعارات الخارجية تحتاج HTTPS. استخدم رابط Vercel أو localhost الآمن أثناء الاختبار.' : 'External notifications require HTTPS. Use the deployed HTTPS URL or a secure local context.') : (isArabic ? 'تعذر تفعيل الإشعارات' : 'Could not enable notifications'); showToast(message, 'error'); return }
      setPushPermission('granted')
      setPushReady(true)
      showToast(isArabic ? 'تم تفعيل الإشعارات على هذا الجهاز' : 'Notifications enabled on this device', 'success')
    } catch (err) { console.error('Push registration failed:', err); showToast(isArabic ? 'تعذر حفظ اشتراك الإشعارات' : 'Could not save push subscription', 'error') }
  }

  // Realtime subscription for new events
  useEffect(() => {
    if (!effectiveTeacherId) return
    const channelName = `teacher-notif-${effectiveTeacherId}`
    let channel
    try {
      channel = supabase
        .channel(channelName)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'teacher_notification_events',
          filter: `teacher_id=eq.${effectiveTeacherId}`,
        }, (payload) => {
          setEvents((prev) => [payload.new, ...prev].slice(0, 30))
          setUnreadCount((prev) => prev + 1)
          notifyIncoming(payload.new)
        })
        .subscribe()
    } catch {
      // realtime not available — silently ignore
    }
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [effectiveTeacherId, isArabic, showToast])

  const markRead = async (id) => {
    await supabase.from('teacher_notification_events').update({ is_read: true }).eq('id', id)
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, is_read: true } : e)))
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }

  const markAllRead = async () => {
    if (!effectiveTeacherId) return
    await supabase
      .from('teacher_notification_events')
      .update({ is_read: true })
      .eq('teacher_id', effectiveTeacherId)
      .eq('is_read', false)
    setEvents((prev) => prev.map((e) => ({ ...e, is_read: true })))
    setUnreadCount(0)
  }

  // Swipe-to-remove (teacher request): optimistic local removal first so the
  // gesture feels instant, then delete on the server; if RLS forbids delete,
  // fall back to marking read so the unread state still clears.
  const removeEvent = async (event) => {
    setEvents((prev) => prev.filter((e) => e.id !== event.id))
    setUnreadCount((prev) => Math.max(0, prev - (event.is_read ? 0 : 1)))
    try {
      const { error } = await supabase.from('teacher_notification_events').delete().eq('id', event.id)
      if (error) {
        await supabase.from('teacher_notification_events').update({ is_read: true }).eq('id', event.id)
      }
    } catch { /* offline — stays removed locally for this session */ }
  }

  const eventTypeToCategory = {
    payment_recorded: 'payment',
    student_submission: 'performance',
    exam_completion: 'performance',
    student_insight: 'performance',
    assistant_request: 'general',
    other: 'general',
  }

  const filteredEvents = categoryFilter === 'all'
    ? events
    : events.filter((e) => eventTypeToCategory[e.event_type] === categoryFilter)

  const eventIcons = {
    student_submission: '📤',
    exam_completion: '📝',
    payment_recorded: '💰',
    assistant_request: '👤',
    student_insight: '💡',
    other: '📌',
  }

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="relative p-1 rounded text-fg-subtle hover:text-fg hover:bg-white/5 transition-colors"
        title={isArabic ? 'التنبيهات' : 'Notifications'}
      >
        {/* PERF: inline SVG bell — replaces the Material Symbols web font
            that used to be loaded (full variable font) for this ONE icon. */}
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {expanded && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} />
          <div className="absolute top-full mt-2 left-0 w-80 glass-card rounded-xl shadow-2xl border border-subtle z-50 max-h-[60vh] flex flex-col" dir={isArabic ? 'rtl' : 'ltr'}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-subtle">
              <h3 className="text-sm font-bold text-fg">{isArabic ? '🔔 التنبيهات' : '🔔 Notifications'}</h3>
              <div className="flex items-center gap-2">
                {pushPermission !== 'unsupported' && !pushReady && <button onClick={enableBrowserNotifications} className="action-button min-h-12 min-w-0 rounded-xl border border-brand-gold/30 px-3 py-2 text-xs font-bold text-brand-gold-hover">🔔 {isArabic ? 'تفعيل إشعارات المتصفح' : 'Enable browser alerts'}</button>}
                {unreadCount > 0 && <button onClick={markAllRead} className="text-brand-gold-hover text-xs font-bold">{isArabic ? 'قراءة الكل' : 'Read all'}</button>}
              </div>
            </div>
            <div className="flex gap-1 px-4 pt-3 overflow-x-auto">
              {[
                ['all', isArabic ? 'الكل' : 'All'],
                ['payment', isArabic ? '💰 مدفوعات' : '💰 Payment'],
                ['attendance', isArabic ? '📋 حضور' : '📋 Attendance'],
                ['performance', isArabic ? '📊 أداء' : '📊 Performance'],
                ['general', isArabic ? '📌 عام' : '📌 General'],
              ].map(([key, label]) => (
                <button key={key} onClick={() => setCategoryFilter(key)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors ${categoryFilter === key ? 'bg-brand-gold/15 text-brand-gold-hover border-brand-gold/40 font-bold' : 'text-fg-subtle border-subtle hover:text-fg'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="px-4 pt-1.5 pb-1 flex items-center justify-between gap-2">
              <span className="text-fg-subtle text-[10px]">{filteredEvents.length} {isArabic ? 'تنبيه' : 'notifications'}</span>
              <span className="text-fg-subtle/70 text-[10px]">{isArabic ? 'اسحب التنبيه جانبًا لإزالته ⇄' : 'Swipe a notification away to remove ⇄'}</span>
            </div>
            <div className="overflow-y-auto flex-1">
              {filteredEvents.length === 0 ? (
                <p className="text-fg-subtle text-sm text-center py-8">{isArabic ? 'لا توجد تنبيهات' : 'No notifications'}</p>
              ) : (
                filteredEvents.map((event) => (
                  <SwipeRow key={event.id} onRemove={() => removeEvent(event)}>
                  <button
                    onClick={() => {
                      if (!event.is_read) markRead(event.id)
                      if (event.related_student_id && onSelectStudent) {
                        onSelectStudent(event.related_student_id, event.event_type)
                        setExpanded(false)
                      }
                    }}
                    className={`w-full text-right px-4 py-3 border-b border-subtle hover:bg-white/5 transition-colors ${!event.is_read ? 'bg-brand-gold/5' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm mt-0.5">{eventIcons[event.event_type] || eventIcons.other}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${!event.is_read ? 'text-fg font-bold' : 'text-fg-subtle'}`}>{event.title}</p>
                        {event.body && <p className="text-fg-subtle text-xs mt-0.5 truncate">{event.body}</p>}
                        <p className="text-fg-subtle/50 text-[10px] mt-1">
                          {new Date(event.created_at).toLocaleString(isArabic ? 'ar-EG' : 'en', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      {!event.is_read && <span className="w-2 h-2 rounded-full bg-brand-gold shrink-0 mt-1.5" />}
                    </div>
                  </button>
                  </SwipeRow>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
