/**
 * SaveUndoToolbar — Inline top bar with save status, undo/redo, history, sync.
 * Nebula glass-card styling with Material Symbols.
 * Placed in the top area of the Dashboard, not fixed.
 */
import { useEffect, useState } from 'react'

export default function SaveUndoToolbar({
  saveStatus = 'idle',
  lastSavedAt,
  isDirty,
  onSaveNow,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onReset,
  onOpenHistory,
  onManualSync,
  isOnline,
  pending = 0,
}) {
  const [showExtra, setShowExtra] = useState(false)

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+S
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); onUndo?.() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Z') { e.preventDefault(); onRedo?.() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); onRedo?.() }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); onSaveNow?.() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onUndo, onRedo, onSaveNow])

  const statusConfig = {
    idle: { icon: '', label: '', color: 'text-fg-subtle' },
    saving: { icon: '⏳', label: 'جاري الحفظ...', color: 'text-brand-gold' },
    saved: { icon: '✅', label: 'تم الحفظ', color: 'text-emerald-400' },
    saved_locally: { icon: '📡', label: 'محلي', color: 'text-amber-400' },
    error: { icon: '❌', label: 'فشل', color: 'text-rose-400' },
  }

  const sc = statusConfig[saveStatus] || statusConfig.idle
  const timeStr = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div
      className="glass-card rounded-xl px-3 py-2 flex items-center justify-between gap-2"
      dir="rtl"
    >
      {/* Right side: Save status */}
      <div className="flex items-center gap-2 text-xs min-w-0">
        {sc.icon && <span className="shrink-0">{sc.icon}</span>}
        <span className={sc.color + ' truncate'}>{sc.label}</span>
        {timeStr && <span className="text-fg-subtle shrink-0">· {timeStr}</span>}
        {isDirty && saveStatus !== 'saving' && (
          <button
            onClick={onSaveNow}
            className="text-brand-gold hover:text-brand-gold-hover font-bold underline transition-colors shrink-0"
          >
            حفظ الآن
          </button>
        )}
      </div>

      {/* Left side: Action buttons */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Undo */}
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`p-1.5 rounded-lg text-sm transition-all duration-300 ${canUndo ? 'text-brand-gold hover:text-brand-gold-hover hover:shadow-[0_0_12px_rgba(255,215,0,0.5)] active:scale-95' : 'text-on-surface-variant/30 cursor-not-allowed'}`}
          title="تراجع (Ctrl+Z)"
        >
          <span className="material-symbols-outlined" style={{fontSize:18}}>undo</span>
        </button>

        {/* Redo */}
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`p-1.5 rounded-lg text-sm transition-all duration-300 ${canRedo ? 'text-brand-gold hover:text-brand-gold-hover hover:shadow-[0_0_12px_rgba(255,215,0,0.5)] active:scale-95' : 'text-on-surface-variant/30 cursor-not-allowed'}`}
          title="إعادة (Ctrl+Y)"
        >
          <span className="material-symbols-outlined" style={{fontSize:18}}>redo</span>
        </button>

        <div className="w-px h-4 bg-outline/20 mx-0.5" />

        {/* Save button */}
        <button
          onClick={onSaveNow}
          className="clay-btn-gold text-xs px-3 py-1 rounded-lg font-bold flex items-center gap-1 active:scale-95"
        >
          <span className="material-symbols-outlined" style={{fontSize:14}}>save</span>
          حفظ
        </button>

        {/* More menu */}
        <button
          onClick={() => setShowExtra(!showExtra)}
          className={`p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all ${showExtra ? 'bg-white/10' : ''}`}
        >
          <span className="material-symbols-outlined" style={{fontSize:18}}>more_horiz</span>
        </button>
      </div>

      {/* Expanded extra menu */}
      {showExtra && (
        <div className="absolute top-full left-0 right-0 mt-1 glass-card rounded-xl border border-outline/20 px-3 py-2 flex items-center gap-2 flex-wrap z-50 animate-[fadeIn_0.15s_ease] shadow-lg">
          <button
            onClick={() => { onReset?.(); setShowExtra(false) }}
            className="sunken-input border border-outline/20 rounded-lg px-3 py-1.5 text-xs text-fg-subtle hover:border-brand-gold/50 transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined" style={{fontSize:14}}>restart_alt</span>
            إعادة تعيين
          </button>
          <button
            onClick={() => { onOpenHistory?.(); setShowExtra(false) }}
            className="sunken-input border border-outline/20 rounded-lg px-3 py-1.5 text-xs text-fg-subtle hover:border-brand-gold/50 transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined" style={{fontSize:14}}>history</span>
            السجل
          </button>
          {!isOnline && (
            <button
              onClick={() => { onManualSync?.(); setShowExtra(false) }}
              className="sunken-input border border-amber-500/30 rounded-lg px-3 py-1.5 text-xs text-amber-400 hover:border-amber-400/50 transition-colors flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined" style={{fontSize:14}}>sync</span>
              مزامنة الآن
            </button>
          )}
          {pending > 0 && (
            <span className="text-xs text-amber-400 font-bold flex items-center gap-1">
              <span className="material-symbols-outlined" style={{fontSize:14}}>cloud_off</span>
              {pending} معلّقة
            </span>
          )}
        </div>
      )}
    </div>
  )
}
