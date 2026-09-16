import { useState, useEffect, useCallback } from 'react'

/**
 * Undo snackbar that appears after a save action.
 * Shows "✅ تم الحفظ — تراجع" with undo, optional redo, and optional history buttons.
 * Auto-dismisses after 5 seconds.
 */
export default function UndoSnackbar({ visible, message, onUndo, onRedo, canRedo = true, onDismiss, onHistory, historyCount, duration = 5000 }) {
  const [show, setShow] = useState(false)
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    if (visible) {
      setShow(true)
      setAnimating(false)
      const timer = setTimeout(() => {
        setAnimating(true)
        setTimeout(() => { setShow(false); onDismiss?.() }, 300)
      }, duration)
      return () => clearTimeout(timer)
    } else {
      setAnimating(true)
      const t = setTimeout(() => setShow(false), 300)
      return () => clearTimeout(t)
    }
  }, [visible, duration, onDismiss])

  const handleUndo = useCallback(() => {
    onUndo?.()
    setAnimating(true)
    setTimeout(() => setShow(false), 300)
  }, [onUndo])

  const handleRedo = useCallback(() => {
    if (!canRedo) return
    onRedo?.()
    setAnimating(true)
    setTimeout(() => setShow(false), 300)
  }, [onRedo, canRedo])

  if (!show) return null

  return (
    <div
      className={`fixed bottom-16 md:bottom-8 left-1/2 -translate-x-1/2 z-[90] transition-all duration-300 ${
        animating ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
      }`}
      dir="rtl"
    >
      <div className="glass-card border-emerald-500/30 rounded-xl shadow-lg px-5 py-3 flex items-center gap-3 min-w-[280px]">
        <span className="text-emerald-300">✅</span>
        <span className="flex-1 text-sm font-semibold text-fg">{message || 'تم الحفظ'}</span>
        {onHistory && historyCount > 0 && (
          <button
            onClick={() => { onHistory(); onDismiss?.() }}
            className="text-fg-subtle hover:text-fg text-xs font-bold border-r border-subtle pr-3 transition-colors"
            title="سجل العمليات"
          >
            🕐 ({historyCount})
          </button>
        )}
        {onRedo && (
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="text-brand-gold-hover hover:text-brand-gold font-bold text-sm border-r border-subtle pr-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ↪ إعادة
          </button>
        )}
        <button
          onClick={handleUndo}
          className="text-brand-gold-hover hover:text-brand-gold font-bold text-sm border-r border-subtle pr-3 transition-colors"
        >
          تراجع
        </button>
      </div>
    </div>
  )
}
