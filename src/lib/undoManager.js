/**
 * Undo Manager — tracks last 20 state-changing actions with redo support.
 * Each entry stores the previous state and an undo function.
 * Metadata (without undoFn) is persisted to localStorage for display after reload.
 * History is SCOPED PER USER to prevent cross-account leaking.
 */

const MAX_HISTORY = 20
let LS_HISTORY_KEY = 'alnukhba_undo_history'
let REDO_LS_KEY = 'alnukhba_redo_history'

/** @type {{ id: number, type: string, description: string, timestamp: string, undoFn: () => Promise<void>, redoFn?: () => Promise<void>, prevState?: object, newState?: object }[]} */
let history = []
let idCounter = 0

/** @type {{ id: number, type: string, description: string, prevState: object, newState: object, timestamp: string }[]} */
let redoStack = []

// --- Init: load persisted redo stack ---
try {
  const saved = JSON.parse(localStorage.getItem(REDO_LS_KEY) || '[]')
  if (Array.isArray(saved)) redoStack = saved
} catch { /* ignore */ }

/**
 * Initialize the undo manager for a specific user.
 * Call this after login with the user ID to scope history.
 */
export function initUndoManager(userId) {
  if (!userId) return
  LS_HISTORY_KEY = `alnukhba_undo_history_${userId}`
  REDO_LS_KEY = `alnukhba_redo_history_${userId}`
  // Reload history for this user
  history = []
  redoStack = []
  try {
    const saved = JSON.parse(localStorage.getItem(REDO_LS_KEY) || '[]')
    if (Array.isArray(saved)) redoStack = saved
  } catch { /* ignore */ }
}

/** Clear history (e.g., on logout) */
export function resetUndoManager() {
  history = []
  redoStack = []
  LS_HISTORY_KEY = 'alnukhba_undo_history'
  REDO_LS_KEY = 'alnukhba_redo_history'
}

function persistHistory() {
  const meta = history.map((h) => ({
    id: h.id, type: h.type, description: h.description, timestamp: h.timestamp,
    prevState: h.prevState || null,
    newState: h.newState || null,
  }))
  try { localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(meta)) } catch { /* ignore */ }
}

function persistRedo() {
  const toSave = redoStack.slice(-MAX_HISTORY)
  try { localStorage.setItem(REDO_LS_KEY, JSON.stringify(toSave)) } catch { /* ignore */ }
}

export function getHistory() {
  return [...history]
}

export function getHistoryMeta() {
  try {
    return JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || '[]')
  } catch { return [] }
}

/**
 * Push a new action onto the undo stack.
 */
export function pushAction({ type, description, undoFn, redoFn, prevState, newState }) {
  idCounter++
  history.push({
    id: idCounter,
    type: type || 'edit',
    description: description || 'تعديل',
    timestamp: new Date().toISOString(),
    undoFn,
    redoFn: typeof redoFn === 'function' ? redoFn : undefined,
    prevState: prevState || undefined,
    newState: newState || undefined,
  })
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY)
  }
  redoStack = []
  persistRedo()
  persistHistory()
  return history[history.length - 1]
}

export async function undoLast() {
  if (history.length === 0) return { undone: false, description: '' }
  const last = history[history.length - 1]
  try {
    if (last.undoFn) await last.undoFn()
    history.pop()
      if (typeof last.redoFn === 'function') {
      redoStack.push({
        id: last.id, type: last.type, description: last.description,
        redoFn: last.redoFn, undoFn: last.undoFn,
        prevState: last.prevState || {}, newState: last.newState || {}, timestamp: last.timestamp,
      })
      if (redoStack.length > MAX_HISTORY) redoStack = redoStack.slice(-MAX_HISTORY)
    }
    persistRedo()
    persistHistory()
    return { undone: true, description: last.description }
  } catch (err) {
    console.error('Undo failed:', err)
    return { undone: false, description: last.description }
  }
}

export async function undoById(id) {
  const idx = history.findIndex((h) => h.id === id)
  if (idx === -1) return { undone: false, description: '' }
  const action = history[idx]
  try {
    if (action.undoFn) await action.undoFn()
    const removed = history.slice(idx)
    for (let i = removed.length - 1; i >= 0; i--) {
      const a = removed[i]
      redoStack.push({
        id: a.id, type: a.type, description: a.description,
        prevState: a.prevState || {}, newState: a.newState || {}, timestamp: a.timestamp,
      })
    }
    if (redoStack.length > MAX_HISTORY) redoStack = redoStack.slice(-MAX_HISTORY)
    history = history.slice(0, idx)
    persistRedo()
    persistHistory()
    return { undone: true, description: action.description }
  } catch (err) {
    console.error('Undo failed:', err)
    return { undone: false, description: action.description }
  }
}

export function clearHistory() {
  history = []
  persistHistory()
}

export function getHistoryCount() { return history.length }

export function pushRedoAction(action) {
  redoStack.push({
    id: action.id || ++idCounter, type: action.type || 'edit',
    description: action.description || 'إعادة', prevState: action.prevState || {},
    newState: action.newState || {}, timestamp: action.timestamp || new Date().toISOString(),
  })
  if (redoStack.length > MAX_HISTORY) redoStack = redoStack.slice(-MAX_HISTORY)
  persistRedo()
  return redoStack[redoStack.length - 1]
}

export async function redoLast() {
  if (redoStack.length === 0) return { redone: false, description: '', prevState: {}, newState: {}, type: '' }
  const last = redoStack[redoStack.length - 1]
  if (typeof last.redoFn !== 'function') return { redone: false, description: last.description, prevState: last.prevState || {}, newState: last.newState || {}, type: last.type || 'edit' }
  try {
    await last.redoFn()
    redoStack.pop()
    history.push({ ...last, id: ++idCounter, timestamp: new Date().toISOString(), undoFn: last.undoFn, redoFn: last.redoFn })
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY)
    persistRedo()
    persistHistory()
    return { redone: true, description: last.description, prevState: last.prevState || {}, newState: last.newState || {}, type: last.type || 'edit' }
  } catch (err) {
    console.error('Redo failed:', err)
    return { redone: false, description: last.description, prevState: last.prevState || {}, newState: last.newState || {}, type: last.type || 'edit' }
  }
}

export function getRedoCount() { return redoStack.length }
export function getRedoStack() { return [...redoStack] }
export function clearRedo() { redoStack = []; persistRedo() }
