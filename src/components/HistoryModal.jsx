import Modal from './Modal'
import { getHistoryMeta, getRedoStack } from '../lib/undoManager'

/**
 * Shows the last 10 actions with timestamps.
 * Uses existing Modal + glass-card design system.
 * Optionally shows a redo section for undone actions.
 */
export default function HistoryModal({ open, onClose, onRestore, onRedo, canRedo, redoCount }) {
  const rawEntries = getHistoryMeta()
  const rawRedoEntries = getRedoStack()
  const entries = (Array.isArray(rawEntries) ? rawEntries : []).filter(Boolean).slice().reverse() // newest first
  const redoEntries = (Array.isArray(rawRedoEntries) ? rawRedoEntries : []).filter(Boolean).slice().reverse() // newest redo first

  const typeIcons = {
    attendance: '📋',
    homework: '📚',
    points: '⭐',
    warning: '🚨',
    student_create: '👤',
    student_update: '✏️',
    student_delete: '🗑️',
    session: '📝',
    exam: '📊',
    edit: '🔧',
  }

  const formatTime = (iso) => {
    try {
      const d = new Date(iso)
      return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    } catch { return '' }
  }

  const formatDate = (iso) => {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
    } catch { return '' }
  }

  return (
    <Modal open={open} onClose={onClose} title='🕐 سجل العمليات'>
      {entries.length === 0 && redoCount <= 0 ? (
        <div className='text-center py-8'>
          <div className='text-3xl mb-2'>📋</div>
          <p className='text-fg-subtle text-sm'>مفيش عمليات مسجلة</p>
        </div>
      ) : (
        <div className='max-h-96 overflow-y-auto space-y-4'>
          {/* ── History (undo) entries ── */}
          {entries.length > 0 && (
            <div className='space-y-2'>
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className='glass-card rounded-xl p-3 flex items-center gap-3'
                >
                  <span className='text-lg'>
                    {typeIcons[entry.type] || '🔧'}
                  </span>
                  <div className='flex-1 min-w-0'>
                    <p className='text-sm font-bold text-fg truncate'>
                      {entry.description || 'تعديل غير مسمى'}
                    </p>
                    <p className='text-[11px] text-fg-subtle'>
                      {formatDate(entry.timestamp || new Date().toISOString())} — {formatTime(entry.timestamp || new Date().toISOString())}
                    </p>
                  </div>
                  {onRestore && entry.type !== 'student_delete' && (
                    <button
                      onClick={() => onRestore(entry.id)}
                      className='text-xs text-brand-gold-hover hover:text-brand-gold font-bold border border-brand-gold/40 rounded-lg px-2.5 py-1 transition-colors'
                    >
                      تراجع
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Redo section ── */}
          {redoCount > 0 && (
            <>
              {entries.length > 0 && (
                <div className='border-t border-subtle' />
              )}
              <div>
                <p className='text-xs font-bold text-fg-subtle mb-2'>↪ إجراءات يمكن إعادتها</p>
                <div className='space-y-2'>
                  {redoEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className='glass-card rounded-xl p-3 flex items-center gap-3'
                    >
                      <span className='text-lg'>
                        {typeIcons[entry.type] || '🔧'}
                      </span>
                      <div className='flex-1 min-w-0'>
                        <p className='text-sm font-bold text-fg truncate'>
                          {entry.description || 'تعديل غير مسمى'}
                        </p>
                        <p className='text-[11px] text-fg-subtle'>
                          {formatDate(entry.timestamp || new Date().toISOString())} — {formatTime(entry.timestamp || new Date().toISOString())}
                        </p>
                      </div>
                      {onRedo && (
                        <button
                          onClick={() => onRedo(entry.id)}
                          className='text-xs text-brand-gold-hover hover:text-brand-gold font-bold border border-brand-gold/40 rounded-lg px-2.5 py-1 transition-colors'
                        >
                          إعادة
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}