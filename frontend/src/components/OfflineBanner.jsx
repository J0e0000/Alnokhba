/**
 * Offline banner — appears at the top when disconnected or syncing.
 * Uses Nebula glass-card styling.
 */
import { useState, useEffect } from 'react'

export default function OfflineBanner({ isOnline, pending, syncing, onManualSync }) {
  const [dismissed, setDismissed] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isOnline || pending > 0 || syncing) {
      setDismissed(false)
      setVisible(true)
    } else if (dismissed) {
      setVisible(false)
    } else {
      const t = setTimeout(() => setVisible(false), 1000)
      return () => clearTimeout(t)
    }
  }, [isOnline, pending, syncing, dismissed])

  if (!visible) return null

  let bgClass, text, icon

  if (!isOnline) {
    bgClass = 'bg-rose-600/90 border-rose-500/60'
    text = 'أنت غير متصل بالإنترنت — التغييرات هتتزامن لما الرجوع أونلاين'
    icon = '⚠️'
  } else if (syncing) {
    bgClass = 'bg-brand-gold/90 border-brand-gold/60 text-brand-navy'
    text = 'جاري مزامنة البيانات...'
    icon = '🔄'
  } else if (pending > 0) {
    bgClass = 'bg-amber-500/90 border-amber-400/60 text-brand-navy'
    text = `${pending} عمليات معلّقة — اضغط للمزامنة الآن`
    icon = '📡'
  } else return null

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[200] ${bgClass} border-b backdrop-blur-md px-4 py-2.5 text-center text-sm font-bold animate-[fadeIn_0.2s_ease]`}
      dir="rtl"
      role="alert"
    >
      <span className="mr-2">{icon}</span>
      <span>{text}</span>
      {pending > 0 && !syncing && (
        <button
          onClick={onManualSync}
          className="mr-3 underline hover:no-underline font-black transition-colors"
        >
          مزامنة الآن
        </button>
      )}
    </div>
  )
}
