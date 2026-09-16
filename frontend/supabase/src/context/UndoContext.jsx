/**
 * UndoContext — React context for undo/redo state.
 * Provides reactive history counts and action wrappers around undoManager.js.
 */
import { createContext, useCallback, useContext, useState } from 'react'
import * as undoManager from '../lib/undoManager'

const UndoContext = createContext(null)

export function UndoProvider({ children }) {
  const [undoCount, setUndoCount] = useState(undoManager.getHistoryCount())
  const [redoCount, setRedoCount] = useState(undoManager.getRedoCount())

  const refresh = useCallback(() => {
    setUndoCount(undoManager.getHistoryCount())
    setRedoCount(undoManager.getRedoCount())
  }, [])

  const pushUndo = useCallback((action) => {
    undoManager.pushAction(action)
    refresh()
  }, [refresh])

  const undo = useCallback(async () => {
    const result = await undoManager.undoLast()
    refresh()
    return result
  }, [refresh])

  const redo = useCallback(() => {
    const result = undoManager.redoLast()
    refresh()
    return result
  }, [refresh])

  const undoById = useCallback(async (id) => {
    const result = await undoManager.undoById(id)
    refresh()
    return result
  }, [refresh])

  const pushRedo = useCallback((action) => {
    undoManager.pushRedoAction(action)
    refresh()
  }, [refresh])

  const getHistory = useCallback(() => undoManager.getHistoryMeta(), [])

  const value = {
    undoCount, redoCount,
    canUndo: undoCount > 0,
    canRedo: redoCount > 0,
    pushUndo, undo, redo, undoById, pushRedo, getHistory, refresh,
  }

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>
}

export function useUndo() {
  const ctx = useContext(UndoContext)
  if (!ctx) throw new Error('useUndo must be used inside <UndoProvider>')
  return ctx
}
