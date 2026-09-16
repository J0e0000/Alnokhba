/**
 * Enhanced Save Queue — request dedup, retry with exponential backoff, offline pause/resume.
 * Used by Dashboard for instant auto-save with optimistic UI.
 */
class EnhancedSaveQueue {
  constructor() {
    /** @type {Array<{key: string, fn: Function, retries: number, onError?: Function}>} */
    this.queue = []
    /** @type {boolean} */
    this.running = false
    /** @type {Set<string>} */
    this.lastKeys = new Set()
    /** @type {boolean} */
    this._isOffline = false
    /** @type {number} */
    this._pendingCount = 0
    /** @type {Set<Function>} */
    this._statusListeners = new Set()
    /** @type {Date|null} */
    this._lastSavedAt = null
  }

  /** Number of items currently queued (not yet completed or failed) */
  get pendingCount() {
    return this._pendingCount
  }

  /** Whether the queue is currently paused due to offline status */
  get isOffline() {
    return this._isOffline
  }

  /** Timestamp of the most recent successful save, or null */
  get lastSavedAt() {
    return this._lastSavedAt
  }

  /**
   * Pause or resume the queue. When set to true the queue stops processing;
   * when set to false it resumes automatically if items are pending.
   */
  set offline(val) {
    this._isOffline = !!val
    if (!this._isOffline && this._pendingCount > 0 && !this.running) {
      this.process()
    }
    this._emit(false, false, null, this._lastSavedAt)
  }

  /**
   * Subscribe to status changes.
   * @param {(saving: boolean, saved: boolean, error: Error|null, lastSavedAt: Date|null) => void} cb
   * @returns {Function} Unsubscribe function
   */
  onStatusChange(cb) {
    this._statusListeners.add(cb)
    return () => this._statusListeners.delete(cb)
  }

  /**
   * Enqueue a save operation. If an entry with the same key already exists it is
   * removed first (cancel-override semantics) so only the latest fn runs.
   *
   * @param {string} key  Unique identifier for deduplication (e.g. row id)
   * @param {Function} fn  Async function that performs the actual save
   * @param {Function} [onError] Optional per-item error callback
   */
  enqueue(key, fn, onError) {
    // Cancel-override: remove any previous entry with the same key
    const idx = this.queue.findIndex((item) => item.key === key)
    if (idx !== -1) {
      this.queue.splice(idx, 1)
      this._pendingCount = Math.max(0, this._pendingCount - 1)
    }

    this.queue.push({ key, fn, retries: 0, onError })
    this._pendingCount++
    this._emit(true, false, null, this._lastSavedAt)

    // Kick off processing if idle and online
    if (!this.running && !this._isOffline) {
      this.process()
    }
  }

  // ---- Private ----

  /**
   * Process the queue sequentially with exponential backoff.
   * Max 3 retries per item with 800ms * 2^attempt delay.
   * @private
   */
  async process() {
    if (this.running) return
    this.running = true

    try {
      while (this.queue.length > 0) {
        if (this._isOffline) break

        const item = this.queue.shift()
        if (!item) break

        let success = false
        let lastError = null

        while (item.retries <= 3) {
          try {
            await item.fn()
            success = true
            break
          } catch (err) {
            lastError = err
            item.retries++
            if (item.retries > 3) break
            // Exponential backoff: 800ms, 1600ms, 3200ms
            await this._delay(800 * Math.pow(2, item.retries - 1))
          }
        }

        this._pendingCount = Math.max(0, this._pendingCount - 1)

        if (success) {
          this._lastSavedAt = new Date()
          this.lastKeys.delete(item.key)
          this._emit(false, true, null, this._lastSavedAt)
        } else {
          this.lastKeys.delete(item.key)
          this._emit(false, false, lastError, this._lastSavedAt)
          try { item.onError?.(lastError) } catch { /* swallow handler errors */ }
        }
      }
    } finally {
      this.running = false
      // If items were enqueued while we were running, loop again
      if (this.queue.length > 0 && !this._isOffline) {
        this.process()
      }
    }
  }

  /**
   * Notify all status listeners.
   * @private
   */
  _emit(saving, saved, error, lastSavedAt) {
    for (const cb of this._statusListeners) {
      try { cb(saving, saved, error, lastSavedAt) } catch { /* swallow */ }
    }
  }

  /**
   * @private
   * @param {number} ms
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/** Pre-wired singleton for Dashboard auto-save usage */
export const saveQueue = new EnhancedSaveQueue()

// ---------------------------------------------------------------------------
// Offline Queue — stores pending operations in IndexedDB and syncs when back
// online. Fallback to localStorage if IndexedDB unavailable.
// ---------------------------------------------------------------------------

const DB_NAME = 'alnukhba_offline'
const DB_VERSION = 1
const STORE_NAME = 'pending_ops'
const LS_KEY = 'alnukhba_offline_queue'

// ---- IndexedDB helpers ----
function openDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } catch {
      reject(new Error('IndexedDB not available'))
    }
  })
}

async function idbAdd(op) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.add(op)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGetAll() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbDelete(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function idbClear() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ---- localStorage fallback ----
function lsGetAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function lsSave(ops) {
  localStorage.setItem(LS_KEY, JSON.stringify(ops))
}

// ---- Unified API ----
let useIDB = true
// Test IndexedDB availability
try { indexedDB } catch { useIDB = false }

/**
 * Add an operation to the offline queue.
 * @param {{ table: string, method: 'insert'|'update'|'upsert'|'delete', data: object, id?: string, match?: object }} op
 */
export async function addToQueue(op) {
  const entry = {
    ...op,
    queued_at: new Date().toISOString(),
  }

  try {
    if (useIDB) {
      await idbAdd(entry)
    } else {
      const ops = lsGetAll()
      ops.push(entry)
      lsSave(ops)
    }
    return true
  } catch {
    // Final fallback: localStorage
    const ops = lsGetAll()
    ops.push(entry)
    lsSave(ops)
    useIDB = false
    return true
  }
}

/** Get all pending operations */
export async function getPendingOps() {
  try {
    if (useIDB) return await idbGetAll()
  } catch { useIDB = false }
  return lsGetAll()
}

/** Remove a specific operation by its store ID */
export async function removeFromQueue(id) {
  try {
    if (useIDB) { await idbDelete(id); return }
  } catch { useIDB = false }
  const ops = lsGetAll().filter((o) => o.id !== id)
  lsSave(ops)
}

/** Clear all pending operations */
export async function clearQueue() {
  try {
    if (useIDB) { await idbClear(); return }
  } catch { useIDB = false }
  lsSave([])
}

/** Get count of pending operations */
export async function getQueueCount() {
  const ops = await getPendingOps()
  return ops.length
}

/**
 * Sync all pending operations with Supabase.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @param {(msg: string, type: string) => void} showToast
 * @returns {{ synced: number, failed: number }}
 */
export async function syncQueue(supabaseClient, showToast) {
  const ops = await getPendingOps()
  if (ops.length === 0) return { synced: 0, failed: 0 }

  let synced = 0
  let failed = 0

  for (const op of ops) {
    try {
      let query
      if (op.method === 'insert') {
        query = supabaseClient.from(op.table).insert(op.data).select().single()
      } else if (op.method === 'update') {
        query = supabaseClient.from(op.table).update(op.data).eq('id', op.match?.id).select().single()
      } else if (op.method === 'upsert') {
        query = supabaseClient.from(op.table).upsert(op.data, op.upsertOpts).select().single()
      } else if (op.method === 'delete') {
        query = supabaseClient.from(op.table).delete().eq('id', op.match?.id)
      }

      if (!query) { failed++; continue }

      const { error } = await query
      if (error) {
        console.warn('Sync failed for op:', op, error)
        failed++
      } else {
        await removeFromQueue(op.id)
        synced++
      }
    } catch (err) {
      console.warn('Sync error for op:', op, err)
      failed++
    }
  }

  if (synced > 0) {
    showToast?.(`تم مزامنة ${synced} عملية محفوظة محليًا`, 'success', 4000)
  }
  if (failed > 0) {
    showToast?.(`${failed} عملية لم يتم مزامنتها`, 'error', 4000)
  }

  return { synced, failed }
}
