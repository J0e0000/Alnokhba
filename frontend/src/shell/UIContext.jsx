import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// UIContext — pure UI state of the new shell (rule 35: UI state ≠ server state).
// Server state lives in WorkspaceStore; this only holds view/navigation state,
// the confirm dialog promise bridge, and the WhatsApp message queue UI.
// ═══════════════════════════════════════════════════════════════════════════

const UIContext = createContext(null)

const QUEUE_KEY = (tid) => `nokhba_message_queue_${tid}`
const NAV_KEY = (tid) => `nokhba_nav_state_${tid || 'anon'}`

// WhatsApp send queue — reload-resilience fix: the queue used to live in
// sessionStorage with open:false, so the reload that mobile browsers do when
// the teacher returns from WhatsApp threw the whole batch away and the
// teacher had to rebuild it (re-messaging students who already received the
// report). It now persists to localStorage with the REAL open flag, the
// current index, and a per-item status (sent/skipped/pending), and is
// restored while fresh — the modal reopens exactly where it stopped.
const QUEUE_TTL_MS = 12 * 60 * 60 * 1000

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

function readStoredQueue(teacherId) {
  const empty = { open: false, items: [], index: 0, status: [] }
  if (!teacherId) return empty
  try {
    const raw = localStorage.getItem(QUEUE_KEY(teacherId))
    if (!raw) return empty
    const q = JSON.parse(raw)
    const fresh = q?.savedAt && Date.now() - new Date(q.savedAt).getTime() < QUEUE_TTL_MS
    if (!fresh || !Array.isArray(q.items) || !q.items.length) return empty
    const status = Array.isArray(q.status) && q.status.length === q.items.length ? q.status : q.items.map(() => 'pending')
    // Finished batch → discard. Mid-queue with the modal open → resume it.
    if (q.index >= q.items.length) return empty
    const resumeOpen = q.open === true
    return { open: resumeOpen, items: q.items, index: Math.min(Math.max(0, q.index | 0), q.items.length - 1), status }
  } catch { return empty }
}

export function UIProvider({ teacherId, children }) {
  // area: 'home' | 'session' | 'students' | 'history' | 'reports' | 'analytics' | 'settings'
  const [area, setAreaState] = useState(() => readNavState(teacherId).area)
  const [sessionParams, setSessionParams] = useState(() => readNavState(teacherId).sessionParams)
  const [historyStudentId, setHistoryStudentId] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tourActive, setTourActive] = useState(false)
  const [confirmState, setConfirmState] = useState(null)
  const [queue, setQueue] = useState(() => readStoredQueue(teacherId))

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

  // Persist to localStorage WITH the real open flag: a reload while the modal
  // is up restores the exact position; a deliberate إيقاف keeps the batch so
  // the small resume chip can offer continuation (or full discard).
  const persistQueue = useCallback((next) => {
    setQueue(next)
    try {
      if (!teacherId) return
      const finished = next.index >= next.items.length
      if (finished || !next.items.length) localStorage.removeItem(QUEUE_KEY(teacherId))
      else localStorage.setItem(QUEUE_KEY(teacherId), JSON.stringify({ ...next, savedAt: new Date().toISOString() }))
    } catch { /* ignore */ }
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
    const next = { open: true, items, index: 0, status: items.map(() => 'pending') }
    persistQueue(next)
  }, [persistQueue])

  // onAdvance optionally receives { skipped: true } so the queue records what
  // actually happened per student — the teacher can trust the remaining list.
  const advanceQueue = useCallback((opts) => {
    const skipped = Boolean(opts && typeof opts === 'object' && opts.skipped)
    setQueue((prev) => {
      const status = [...(prev.status || [])]
      if (status[prev.index] === 'pending') status[prev.index] = skipped ? 'skipped' : 'sent'
      const next = { ...prev, index: prev.index + 1, status, open: prev.index + 1 < prev.items.length ? prev.open : false }
      try {
        if (teacherId) {
          if (next.index >= next.items.length) localStorage.removeItem(QUEUE_KEY(teacherId))
          else localStorage.setItem(QUEUE_KEY(teacherId), JSON.stringify({ ...next, savedAt: new Date().toISOString() }))
        }
      } catch { /* ignore */ }
      return next
    })
  }, [teacherId])

  // إيقاف keeps the remaining batch recoverable via the resume chip.
  const closeQueue = useCallback(() => setQueue((prev) => {
    const next = { ...prev, open: false }
    try {
      if (teacherId && prev.index < prev.items.length) {
        localStorage.setItem(QUEUE_KEY(teacherId), JSON.stringify({ ...next, savedAt: new Date().toISOString() }))
      }
    } catch { /* ignore */ }
    return next
  }), [teacherId])

  // Reopen a paused/failed batch at the exact position it stopped.
  const reopenQueue = useCallback(() => setQueue((prev) => (
    prev.index < prev.items.length ? { ...prev, open: true } : prev
  )), [])

  // Discard the remaining batch entirely (✕ on the resume chip).
  const discardQueue = useCallback(() => {
    setQueue({ open: false, items: [], index: 0, status: [] })
    try { if (teacherId) localStorage.removeItem(QUEUE_KEY(teacherId)) } catch { /* ignore */ }
  }, [teacherId])

  const value = useMemo(() => ({
    area, setArea, sessionParams, openSession, closeSession, askConfirm,
    queue, startQueue, advanceQueue, closeQueue, reopenQueue, discardQueue,
    historyStudentId, openStudentHistory, clearHistoryStudent,
    historyOpen, setHistoryOpen,
    tourActive, setTourActive,
  }), [area, sessionParams, openSession, closeSession, askConfirm, queue, startQueue, advanceQueue, closeQueue, reopenQueue, discardQueue, historyStudentId, openStudentHistory, clearHistoryStudent, historyOpen, tourActive])

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
