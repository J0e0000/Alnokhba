import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

/**
 * ⚠ شريط "وصول الدعم" — يظهر أعلى الشاشة طوال جلسة دعم الأدمن.
 * مستحيل يتلخبط مع الوضع العادي: خلفية كهرمانية صارخة + عدّاد تنازلي
 * + زر خروج دائم. الجلسة تنتهي تلقائياً بعد 30 دقيقة (قابلة للتمديد
 * من الخادم)، وكل عملية كتابة أثناءها مسجّلة في سجل التدقيق.
 */
export default function SupportAccessBanner({ onExit }) {
  const { supportSession, ownerProfile, refreshProfile } = useAuth()
  const { showToast } = useToast()
  const [minutesLeft, setMinutesLeft] = useState(0)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (!supportSession?.expires_at) return
    const update = () => {
      const msLeft = new Date(supportSession.expires_at).getTime() - Date.now()
      setMinutesLeft(Math.max(0, Math.ceil(msLeft / 60000)))
      return msLeft
    }
    update()
    const interval = setInterval(() => {
      const msLeft = update()
      if (msLeft <= 0) clearInterval(interval)
    }, 30000)
    return () => clearInterval(interval)
  }, [supportSession])

  // انتهاء صلاحية الجلسة → إغلاق تلقائي
  useEffect(() => {
    if (!supportSession?.expires_at) return
    const msLeft = new Date(supportSession.expires_at).getTime() - Date.now()
    if (msLeft <= 0) { onExit?.('timeout'); return }
    const timer = setTimeout(() => {
      showToast('انتهت مدة جلسة وصول الدعم — تم الخروج تلقائياً', 'info')
      onExit?.('timeout')
    }, msLeft + 1500)
    return () => clearTimeout(timer)
  }, [supportSession, onExit, showToast])

  if (!supportSession) return null

  const exit = async (reason) => {
    setExiting(true)
    try {
      await supabase.rpc('admin_end_support_session', { p_reason: reason || 'manual' })
    } catch { /* ستُغلق تلقائياً من الخادم عند انتهاء صلاحيتها */ }
    await refreshProfile()
    setExiting(false)
    onExit?.(reason || 'manual')
  }

  const targetName = ownerProfile?.full_name || 'مستخدم'

  return (
    <div dir="rtl" className="sticky top-0 z-[80] w-full bg-gradient-to-l from-rose-600 via-amber-500 to-amber-400 text-white shadow-lg border-b-4 border-rose-700">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl shrink-0" aria-hidden>⚠️</span>
          <div className="min-w-0">
            <p className="font-black text-sm tracking-wide">
              وصول دعم الأدمن — ADMIN SUPPORT ACCESS
            </p>
            <p className="text-xs text-white/90 truncate">
              تعرض الآن حساب: <span className="font-bold">{targetName}</span>
              {supportSession.reason && <span className="hidden sm:inline"> · السبب: {supportSession.reason}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-bold bg-black/25 rounded-full px-2.5 py-1" title="تنتهي الجلسة تلقائياً">
            ⏱ {minutesLeft} دقيقة متبقية
          </span>
          <button
            onClick={() => exit('manual')}
            disabled={exiting}
            className="bg-white text-rose-700 font-black text-xs px-4 py-2 rounded-lg shadow hover:bg-rose-50 disabled:opacity-60 active:scale-95 transition"
          >
            {exiting ? 'جاري الخروج...' : '⏏ خروج من وصول الدعم'}
          </button>
        </div>
      </div>
    </div>
  )
}
