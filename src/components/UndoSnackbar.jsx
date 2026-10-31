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
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-[90] transition-all duration-300 ${
        animating ? 'opacity-0 -translate-y-3' : 'opacity-100 translate-y-0'
      }`}
      dir="rtl"
    >
      {/* TOP placement (teacher request): the bottom edge hosts the workflow
          bar / mobile nav — the undo popup must never cover it. Compact
          pill, centered at the very top. */}
      <div className="glass-card border-emerald-500/30 rounded-full shadow-lg ps-3 pe-2 py-1.5 flex items-center gap-2 max-w-[92vw]">
        <span className="text-emerald-300 text-sm">✅</span>
        <span className="flex-1 min-w-0 truncate text-xs font-semibold text-fg">{message || 'تم الحفظ'}</span>
        {onHistory && historyCount > 0 && (
          <button
            onClick={() => { onHistory(); onDismiss?.() }}
            className="text-fg-subtle hover:text-fg text-[.7rem] font-bold border-r border-subtle ps-2 transition-colors whitespace-nowrap"
            title="سجل العمليات"
          >
            🕐 ({historyCount})
          </button>
        )}
        {onRedo && (
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="text-brand-gold-hover hover:text-brand-gold font-bold text-[.72rem] border-r border-subtle ps-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
          >
            ↪ إعادة
          </button>
        )}
        <button
          onClick={handleUndo}
          className="text-brand-gold-hover hover:text-brand-gold font-bold text-[.72rem] border-r border-subtle ps-2 transition-colors whitespace-nowrap"
        >
          تراجع
        </button>
      </div>
    </div>
  )
}
