import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { todayLocalISO } from '../lib/dateUtils'

// ═══════════════════════════════════════════════════════════════════════════
// UIContext — pure UI state of the new shell (rule 35: UI state ≠ server state).
// Server state lives in WorkspaceStore; this only holds view/navigation state,
// the confirm dialog promise bridge, and the WhatsApp message queue UI.
// ═══════════════════════════════════════════════════════════════════════════

const UIContext = createContext(null)

const QUEUE_KEY = (tid) => `nokhba_message_queue_${tid}`

export function UIProvider({ teacherId, children }) {
  // area: 'home' | 'session' | 'students' | 'history' | 'reports' | 'analytics' | 'settings' | 'help'
  const [area, setArea] = useState('home')
  const [sessionParams, setSessionParams] = useState(null)
  const [confirmState, setConfirmState] = useState(null)
  // Day timeline: the selected day persists across navigation so returning from
  // a session keeps the teacher's context (brief §2 "preserve current route").
  const [selectedDay, setSelectedDay] = useState(todayLocalISO)
  // Global search (Ctrl/⌘+K) — modal state here so any surface can open it.
  const [searchOpen, setSearchOpen] = useState(false)
  // Cross-area focus targets (search/FAQ deep links).
  const [focusStudentId, setFocusStudentId] = useState(null)
  const [helpTopicId, setHelpTopicId] = useState(null)
  const [queue, setQueue] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(QUEUE_KEY(teacherId)) || 'null') || { open: false, items: [], index: 0 } } catch { return { open: false, items: [], index: 0 } }
  })

  const persistQueue = useCallback((next) => {
    setQueue(next)
    try { sessionStorage.setItem(QUEUE_KEY(teacherId), JSON.stringify({ ...next, open: false })) } catch { /* ignore */ }
  }, [teacherId])

  const openSession = useCallback((params) => {
    setSessionParams(params)
    setArea('session')
  }, [])

  const closeSession = useCallback(() => {
    setSessionParams(null)
    setArea('home')
  }, [])

  const askConfirm = useCallback((message, opts = {}) => new Promise((resolve) => {
    setConfirmState({ message, ...opts, resolve })
  }), [])

  const startQueue = useCallback((items) => {
    const next = { open: true, items, index: 0 }
    setQueue(next)
    try { sessionStorage.setItem(QUEUE_KEY(teacherId), JSON.stringify({ ...next, open: false })) } catch { /* ignore */ }
  }, [teacherId])

  const advanceQueue = useCallback((nextIndex) => {
    setQueue((prev) => {
      const next = { ...prev, index: typeof nextIndex === 'number' ? nextIndex : prev.index + 1 }
      try { sessionStorage.setItem(QUEUE_KEY(teacherId), JSON.stringify({ ...next, open: false })) } catch { /* ignore */ }
      return next
    })
  }, [teacherId])

  const closeQueue = useCallback(() => setQueue((prev) => ({ ...prev, open: false })), [])

  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  const openHelp = useCallback((topicId = null) => { setHelpTopicId(topicId); setArea('help') }, [])
  const goToStudent = useCallback((id) => { setFocusStudentId(id); setArea('students') }, [])

  const value = useMemo(() => ({
    area, setArea, sessionParams, openSession, closeSession, askConfirm,
    queue, startQueue, advanceQueue, closeQueue,
    selectedDay, setSelectedDay,
    searchOpen, openSearch, closeSearch,
    focusStudentId, setFocusStudentId, goToStudent,
    helpTopicId, setHelpTopicId, openHelp,
  }), [area, sessionParams, openSession, closeSession, askConfirm, queue, startQueue, advanceQueue, closeQueue,
    selectedDay, searchOpen, openSearch, closeSearch, focusStudentId, goToStudent, helpTopicId, openHelp])

  return (
    <UIContext.Provider value={value}>
      {children}
      {confirmState && (
        <ConfirmHost state={confirmState} onDone={(ok) => { confirmState.resolve(ok); setConfirmState(null) }} />
      )}
    </UIContext.Provider>
  )
}

function ConfirmHost({ state, onDone }) {
  const danger = Boolean(state.danger)
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onClick={() => onDone(false)}>
      <div className="glass-card w-full max-w-md p-5 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-extrabold mb-2" style={{ color: danger ? 'var(--danger-strong)' : 'var(--fg)' }}>{state.title || 'تأكيد'}</h3>
        <p className="text-sm leading-7 text-fg-muted mb-5">{state.message}</p>
        <div className="flex gap-2 justify-start">
          <button
            className={danger ? 'btn-danger action-button !min-h-[3rem]' : 'btn-navy action-button !min-h-[3rem]'}
            onClick={() => onDone(true)}
          >
            {state.confirmLabel || 'تأكيد'}
          </button>
          <button className="btn-ghost action-button !min-h-[3rem]" onClick={() => onDone(false)}>
            {state.cancelLabel || 'إلغاء'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used inside UIProvider')
  return ctx
}
