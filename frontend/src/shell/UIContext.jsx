import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { todayLocalISO } from '../lib/dateUtils'

// ═══════════════════════════════════════════════════════════════════════════
// UIContext — pure UI state of the new shell (rule 35: UI state ≠ server state).
// Server state lives in WorkspaceStore; this only holds view/navigation state,
// the confirm dialog promise bridge, and the WhatsApp message queue UI.
//
// RELOAD RESILIENCE ("لو الصفحة اتعملتها reload سيبني مكاني"): the route
// (area + session params + selected day) persists in sessionStorage keyed by
// teacher id. A refresh or crash reopens the SAME view — for teachers that
// means the session workspace they were standing in, on the same tab (the
// workspace itself persists its tab/position separately). Explicit logout
// clears it (see AppShell). sessionStorage survives reloads and tab-crash
// restore, but never leaks across browser restarts into a stale day.
// ═══════════════════════════════════════════════════════════════════════════

const UIContext = createContext(null)

const QUEUE_KEY = (tid) => `nokhba_message_queue_${tid}`
const ROUTE_KEY = (tid) => `nokhba_ui_route_${tid || 'anon'}`
const ROUTE_AREAS = ['home', 'session', 'students', 'history', 'reports', 'analytics', 'settings', 'help']

function readSavedRoute(teacherId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ROUTE_KEY(teacherId)) || 'null')
    if (!saved || !ROUTE_AREAS.includes(saved.area)) return null
    if (saved.area === 'session' && !saved.sessionParams?.groupId) return null
    return saved
  } catch { return null }
}

export function UIProvider({ teacherId, children }) {
  // area: 'home' | 'session' | 'students' | 'history' | 'reports' | 'analytics' | 'settings' | 'help'
  const savedRoute = useMemo(() => readSavedRoute(teacherId), [teacherId])
  const [area, setArea] = useState(() => savedRoute?.area || 'home')
  const [sessionParams, setSessionParams] = useState(() => savedRoute?.sessionParams || null)
  const [confirmState, setConfirmState] = useState(null)
  // Day timeline: the selected day persists across navigation so returning from
  // a session keeps the teacher's context (brief §2 "preserve current route").
  const [selectedDay, setSelectedDay] = useState(() => savedRoute?.selectedDay || todayLocalISO())
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

  // Persist the route whenever it changes (reload → same place).
  useEffect(() => {
    try { sessionStorage.setItem(ROUTE_KEY(teacherId), JSON.stringify({ area, sessionParams, selectedDay })) } catch { /* ignore */ }
  }, [teacherId, area, sessionParams, selectedDay])

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
