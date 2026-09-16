import { useEffect, useState, useCallback } from 'react'

/**
 * Small save status indicator with optional reset button.
 * States: idle | saving | saved | saved_locally | error
 * Uses existing brand classes.
 *
 * Props:
 *   status        – 'idle' | 'saving' | 'saved' | 'saved_locally' | 'error'
 *   hasChanges    – boolean
 *   onReset       – function  (session reset)
 *   lastSavedAt   – Date|null  (shows time next to "تم الحفظ")
 *   pendingCount  – number     (shows pending operations count)
 *   onUndo        – function   (undo handler)
 *   onRedo        – function   (redo handler)
 *   canUndo       – boolean    (enables/disables undo)
 *   canRedo       – boolean    (enables/disables redo)
 */
export default function SaveStatusBar({
  status,
  hasChanges,
  onReset,
  lastSavedAt = null,
  pendingCount = 0,
  onUndo = null,
  onRedo = null,
  canUndo = false,
  canRedo = false,
}) {
  const [visible, setVisible] = useState(false)
  const [prevStatus, setPrevStatus] = useState('idle')

  useEffect(() => {
    if (status !== 'idle') {
      setVisible(true)
      if (status === 'saving') setPrevStatus('saving')
      else if (status === 'saved' || status === 'saved_locally') setPrevStatus(status)
    } else if (prevStatus === 'saved' || prevStatus === 'saved_locally') {
      const t = setTimeout(() => setVisible(false), 2000)
      return () => clearTimeout(t)
    } else if (!hasChanges) {
      setVisible(false)
    }
  }, [status, prevStatus, hasChanges])

  // Force visibility when there are pending operations
  useEffect(() => {
    if (pendingCount > 0 && (status === 'idle' || status === 'saving')) {
      setVisible(true)
    }
  }, [pendingCount, status])

  if (!visible && !hasChanges && pendingCount === 0) return null

  // Format saved time if provided
  const savedTimeStr =
    status === 'saved' && lastSavedAt
      ? ` — ${lastSavedAt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`
      : ''

  const config = {
    idle: hasChanges
      ? { icon: '•', text: 'تغييرات غير محفوظة', cls: 'text-amber-400' }
      : null,
    saving: { icon: '⏳', text: 'جاري الحفظ...', cls: 'text-fg-subtle' },
    saved: {
      icon: '✅',
      text: `تم الحفظ${savedTimeStr}`,
      cls: 'text-emerald-300',
    },
    saved_locally: { icon: '⚠️', text: 'محفوظ محليًا', cls: 'text-amber-400' },
    error: {
      icon: '❌',
      text: 'فشل الحفظ — سيتم إعادة المحاولة',
      cls: 'text-rose-300',
    },
  }

  const c = config[status] || (hasChanges ? config.idle : null)
  if (!c && !(pendingCount > 0 && (status === 'idle' || status === 'saving'))) return null

  const isSaving = status === 'saving'

  // Pending count badge (shown when > 0 and status is idle or saving)
  const showPending = pendingCount > 0 && (status === 'idle' || status === 'saving')

  return (
    <div
      className={`flex items-center gap-2 text-[11px] font-bold transition-all duration-300 px-4 py-1.5 ${c ? c.cls : 'text-fg-subtle'} ${isSaving ? 'animate-pulse' : ''}`}
    >
      {/* Undo / Redo buttons at the START of the bar */}
      {onUndo && (
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`transition-colors ${canUndo ? 'text-fg-subtle hover:text-fg brand-gold-hover btn-glow' : 'text-fg-muted cursor-not-allowed opacity-50'}`}
        >
          ↩ تراجع
        </button>
      )}
      {onRedo && (
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`transition-colors border-r border-subtle pr-2 ${canRedo ? 'text-fg-subtle hover:text-fg brand-gold-hover btn-glow' : 'text-fg-muted cursor-not-allowed opacity-50'}`}
        >
          ↪ إعادة
        </button>
      )}

      {/* Status text */}
      {c && (
        <>
          <span>{c.icon}</span>
          <span>{c.text}</span>
        </>
      )}

      {/* Pending count badge */}
      {showPending && (
        <span className='text-amber-400'>
          ⏳ {pendingCount} عملية معلّقة
        </span>
      )}

      {/* Session reset button (original) */}
      {hasChanges && onReset && status !== 'saving' && (
        <button
          onClick={onReset}
          className='text-fg-subtle hover:text-fg font-bold border-r border-subtle pr-2 transition-colors'
        >
          🔄 تراجع عن التغييرات
        </button>
      )}
    </div>
  )
}
