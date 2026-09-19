import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// UIContext — pure UI state of the new shell (rule 35: UI state ≠ server state).
// Server state lives in WorkspaceStore; this only holds view/navigation state,
// the confirm dialog promise bridge, and the WhatsApp message queue UI.
// ═══════════════════════════════════════════════════════════════════════════

const UIContext = createContext(null)

const QUEUE_KEY = (tid) => `nokhba_message_queue_${tid}`
const NAV_KEY = (tid) => `nokhba_nav_state_${tid || 'anon'}`

// Reload-resilience (spec: "if the page reloaded make it leave me wherever I
// am"): the active area + open session context persist in localStorage. A
// stored SESSION context is only restored while fresh (12h) — never revive
// yesterday's workspace into today, and never let it CREATE a new lesson.
const SESSION_CONTEXT_TTL_MS = 12 * 60 * 60 * 1000

function readNavState(teacherId) {
  try {
    const raw = localStorage.getItem(NAV_KEY(teacherId))
    if (!raw) return { area: 'home', sessionParams: null }
    const s = JSON.parse(raw)
    if (s?.area === 'session') {
      const fresh = s.savedAt && (Date.now() - new Date(s.savedAt).getTime()) < SESSION_CONTEXT_TTL_MS
      if (!fresh || !s.sessionParams?.groupId) return { area: 'home', sessionParams: null }
    }
    return { area: s?.area || 'home', sessionParams: s?.sessionParams || null }
  } catch { return { area: 'home', sessionParams: null } }
}

export function UIProvider({ teacherId, children }) {
  // area: 'home' | 'session' | 'students' | 'history' | 'reports' | 'analytics' | 'settings'
  const [area, setAreaState] = useState(() => readNavState(teacherId).area)
  const [sessionParams, setSessionParams] = useState(() => readNavState(teacherId).sessionParams)
  const [historyStudentId, setHistoryStudentId] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tourActive, setTourActive] = useState(false)
  const [confirmState, setConfirmState] = useState(null)
  const [queue, setQueue] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(QUEUE_KEY(teacherId)) || 'null') || { open: false, items: [], index: 0 } } catch { return { open: false, items: [], index: 0 } }
  })

  const persistNav = useCallback((a, sp) => {
    try { localStorage.setItem(NAV_KEY(teacherId), JSON.stringify({ area: a, sessionParams: sp, savedAt: new Date().toISOString() })) } catch { /* ignore */ }
  }, [teacherId])

  const setArea = useCallback((a) => {
    setAreaState(a)
    if (a !== 'session') {
      setSessionParams(null)
      persistNav(a, null)
    }
  }, [persistNav])

  const persistQueue = useCallback((next) => {
    setQueue(next)
    try { sessionStorage.setItem(QUEUE_KEY(teacherId), JSON.stringify({ ...next, open: false })) } catch { /* ignore */ }
  }, [teacherId])

  const openSession = useCallback((params) => {
    setSessionParams(params)
    setAreaState('session')
    persistNav('session', params)
  }, [persistNav])

  const closeSession = useCallback(() => {
    setSessionParams(null)
    setAreaState('home')
    persistNav('home', null)
  }, [persistNav])

  // Name-click on a student row jumps straight to their history profile.
  // HistoryArea consumes the id once, then clears it (null = normal search view).
  const openStudentHistory = useCallback((studentId) => {
    setHistoryStudentId(studentId)
    setArea('history')
  }, [])

  const clearHistoryStudent = useCallback(() => setHistoryStudentId(null), [])

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

  const value = useMemo(() => ({
    area, setArea, sessionParams, openSession, closeSession, askConfirm,
    queue, startQueue, advanceQueue, closeQueue,
    historyStudentId, openStudentHistory, clearHistoryStudent,
    historyOpen, setHistoryOpen,
    tourActive, setTourActive,
  }), [area, sessionParams, openSession, closeSession, askConfirm, queue, startQueue, advanceQueue, closeQueue, historyStudentId, openStudentHistory, clearHistoryStudent, historyOpen, tourActive])

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
