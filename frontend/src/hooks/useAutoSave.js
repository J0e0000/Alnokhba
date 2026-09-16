import { useCallback, useEffect, useRef, useState } from 'react'
import { addToQueue } from '../lib/offlineQueue'

/**
 * Auto-save hook with debounce, Ctrl+S, and beforeunload warning.
 *
 * @param {object} options
 * @param {Function} options.saveFn          — Async save function
 * @param {object}   options.data            — Tracked data (compared via JSON)
 * @param {boolean}  [options.enabled=true]  — Enable auto-save
 * @param {number}   [options.debounceMs=2000] — Debounce delay
 * @param {Function} [options.onSaveStart]
 * @param {Function} [options.onSaveSuccess]
 * @param {Function} [options.onSaveError]
 */
export default function useAutoSave({
  saveFn,
  data,
  enabled = true,
  debounceMs = 2000,
  onSaveStart,
  onSaveSuccess,
  onSaveError,
}) {
  const [status, setStatus] = useState('idle')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const timerRef = useRef(null)
  const prevDataRef = useRef(JSON.stringify(data))
  const saveFnRef = useRef(saveFn)
  saveFnRef.current = saveFn

  const hasChanged = useCallback(() => {
    return JSON.stringify(data) !== prevDataRef.current
  }, [data])

  const doSave = useCallback(async () => {
    if (!hasChanged()) return
    if (isSaving) return
    setIsSaving(true)
    onSaveStart?.()
    setStatus('saving')

    const online = navigator.onLine

    try {
      if (online) {
        await saveFnRef.current()
        prevDataRef.current = JSON.stringify(data)
        setIsDirty(false)
        setLastSavedAt(new Date())
        setStatus('saved')
        onSaveSuccess?.()
      } else {
        await addToQueue({ table: 'auto_save', method: 'update', data })
        setIsDirty(false)
        setStatus('saved_locally')
        onSaveSuccess?.()
      }
    } catch (err) {
      if (!online) {
        await addToQueue({ table: 'auto_save', method: 'update', data })
        setStatus('saved_locally')
      } else {
        setStatus('error')
        onSaveError?.(err.message)
      }
    } finally {
      setIsSaving(false)
    }
  }, [hasChanged, isSaving, data, onSaveStart, onSaveSuccess, onSaveError])

  const saveNow = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    await doSave()
  }, [doSave])

  useEffect(() => {
    if (!enabled) return
    if (!hasChanged()) return
    setIsDirty(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(doSave, debounceMs)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [data, enabled, debounceMs, doSave, hasChanged])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveNow()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveNow])

  const reset = useCallback(() => {
    prevDataRef.current = JSON.stringify(data)
    setIsDirty(false)
    setStatus('idle')
  }, [data])

  return { status, isDirty, isSaving, lastSavedAt, saveNow, reset }
}
