// ═══════════════════════════════════════════════════════════════════════════
// EL NO5BA CENTERS — workspace store
// Holds center state + autosave + Undo/Redo (10 meaningful actions) +
// persistent success bar. Undo entries carry real inverse operations, so undo
// restores BOTH the UI state and the backend row; the audit trail is never
// destroyed (center_audit_logs keeps every DB write via triggers).
// ═══════════════════════════════════════════════════════════════════════════
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadWorkspace, saveAttendanceRow, saveSessionNotes, setSessionStatus,
  setSessionTeacher, setSessionRoom, api, listMyCenters,
} from './centersApi'

const CentersContext = createContext(null)
const UNDO_LIMIT = 10

export function CentersProvider({ children }) {
  const [centers, setCenters] = useState([])
  const [centerId, setCenterId] = useState(null)
  const [data, setData] = useState({ rooms: [], teachers: [], students: [], groups: [], enrollments: [], sessions: [], attendance: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [successBar, setSuccessBar] = useState(null) // { message, onPrint, undoId } — persistent until dismissed
  const [focusSessionId, setFocusSessionId] = useState(null)

  // ── undo/redo stacks ──
  const undoStack = useRef([])
  const redoStack = useRef([])
  const [historyInfo, setHistoryInfo] = useState({ canUndo: false, canRedo: false, lastLabel: '' })
  const syncHistory = () => setHistoryInfo({
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    lastLabel: undoStack.current[undoStack.current.length - 1]?.label || '',
  })

  const pushAction = useCallback((action) => {
    undoStack.current.push(action)
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift()
    redoStack.current = []
    syncHistory()
  }, [])

  const undo = useCallback(async () => {
    const action = undoStack.current.pop()
    if (!action) return
    setSaveState('saving')
    try { await action.undo() } catch (err) { setSaveState('error'); throw err }
    redoStack.current.push(action)
    syncHistory()
    setSaveState('saved')
    setSuccessBar(null)
  }, [])

  const redo = useCallback(async () => {
    const action = redoStack.current.pop()
    if (!action) return
    setSaveState('saving')
    try { await action.redo() } catch (err) { setSaveState('error'); throw err }
    undoStack.current.push(action)
    syncHistory()
    setSaveState('saved')
  }, [])

  // ── local row patchers (optimistic UI, DB already saved by caller) ──
  const patchRow = useCallback((table, id, patch) => {
    setData((prev) => ({
      ...prev,
      [table]: (prev[table] || []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }))
  }, [])

  const addRow = useCallback((table, row) => {
    setData((prev) => ({ ...prev, [table]: [...(prev[table] || []), row] }))
  }, [])

  const removeRow = useCallback((table, id) => {
    setData((prev) => ({ ...prev, [table]: (prev[table] || []).filter((r) => r.id !== id) }))
  }, [])

  // ── initial load + center switch ──
  const refresh = useCallback(async (cid = centerId) => {
    if (!cid) return
    setLoading(true)
    setError(null)
    try {
      const ws = await loadWorkspace(cid)
      setData(ws)
    } catch (err) {
      setError(err?.message || 'تعذر تحميل بيانات المركز')
    } finally {
      setLoading(false)
    }
  }, [centerId])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const list = await listMyCenters()
        if (!alive) return
        setCenters(list)
        const first = list[0]?.id || null
        setCenterId(first)
        if (first) {
          const ws = await loadWorkspace(first)
          if (!alive) return
          setData(ws)
        }
      } catch (err) {
        if (alive) setError(err?.message || 'تعذر تحميل مراكزك')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // ── meaningful ops (each = optimistic UI + await DB + undo entry) ──

  // Attendance: tap → instant save. Undo restores the previous status.
  const markAttendance = useCallback(async (sessionId, studentId, status) => {
    if (!centerId) return
    const before = data.attendance.find((a) => a.session_id === sessionId && a.student_id === studentId)
    const prevStatus = before?.status || null
    const rowId = before?.id || null
    // optimistic
    setData((prev) => {
      const others = prev.attendance.filter((a) => !(a.session_id === sessionId && a.student_id === studentId))
      return { ...prev, attendance: [...others, { id: rowId || `tmp-${studentId}`, session_id: sessionId, student_id: studentId, status, note: before?.note || null, updated_at: new Date().toISOString() }] }
    })
    setSaveState('saving')
    try {
      const id = await saveAttendanceRow(centerId, sessionId, studentId, status, before?.note || null)
      setData((prev) => ({
        ...prev,
        attendance: prev.attendance.map((a) => (a.session_id === sessionId && a.student_id === studentId ? { ...a, id } : a)),
      }))
      setSaveState('saved')
      pushAction({
        label: 'رصد حضور',
        undo: async () => {
          if (prevStatus) await saveAttendanceRow(centerId, sessionId, studentId, prevStatus, before?.note || null)
          else if (rowId) await api.deleteRow('center_attendance', rowId)
          patchRow('attendance', id, prevStatus ? { status: prevStatus } : { status: 'present' })
          setData((prev) => ({
            ...prev,
            attendance: prevStatus ? prev.attendance.map((a) => (a.session_id === sessionId && a.student_id === studentId ? { ...a, status: prevStatus } : a))
              : prev.attendance.filter((a) => !(a.session_id === sessionId && a.student_id === studentId)),
          }))
        },
        redo: async () => {
          await saveAttendanceRow(centerId, sessionId, studentId, status, before?.note || null)
          setData((prev) => ({
            ...prev,
            attendance: prev.attendance.map((a) => (a.session_id === sessionId && a.student_id === studentId ? { ...a, status } : a)),
          }))
        },
      })
    } catch (err) {
      setSaveState('error')
      // roll back the optimistic row
      setData((prev) => ({
        ...prev,
        attendance: before ? prev.attendance.map((a) => (a.session_id === sessionId && a.student_id === studentId ? before : a))
          : prev.attendance.filter((a) => !(a.session_id === sessionId && a.student_id === studentId)),
      }))
      throw err
    }
  }, [centerId, data.attendance, patchRow, pushAction])

  // Notes: debounced autosave from Focus Mode (commit after 900ms idle)
  const notesTimer = useRef(null)
  const saveNotes = useCallback((sessionId, notes, topic) => {
    setSaveState('saving')
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(async () => {
      try {
        await saveSessionNotes(sessionId, notes, topic)
        setSaveState('saved')
        patchRow('sessions', sessionId, { notes, topic })
      } catch { setSaveState('error') }
    }, 900)
  }, [patchRow])

  const changeStatus = useCallback(async (sessionId, status, successMessage) => {
    const before = data.sessions.find((s) => s.id === sessionId)
    if (!before) return
    patchRow('sessions', sessionId, { status, completed_at: status === 'completed' ? new Date().toISOString() : null })
    setSaveState('saving')
    try {
      await setSessionStatus(sessionId, status)
      setSaveState('saved')
      pushAction({
        label: 'تغيير حالة الحصة',
        undo: async () => { await setSessionStatus(sessionId, before.status); patchRow('sessions', sessionId, { status: before.status, completed_at: before.completed_at }) },
        redo: async () => { await setSessionStatus(sessionId, status); patchRow('sessions', sessionId, { status }) },
      })
      if (successMessage) {
        setSuccessBar({
          message: successMessage,
          sessionId,
          undoId: 'status',
        })
      }
    } catch (err) {
      patchRow('sessions', sessionId, { status: before.status })
      setSaveState('error')
      throw err
    }
  }, [data.sessions, patchRow, pushAction])

  const changeTeacher = useCallback(async (sessionId, teacherId) => {
    const before = data.sessions.find((s) => s.id === sessionId)
    if (!before) return
    patchRow('sessions', sessionId, { teacher_id: teacherId })
    setSaveState('saving')
    try {
      await setSessionTeacher(sessionId, teacherId)
      setSaveState('saved')
      pushAction({
        label: 'تغيير معلم الحصة',
        undo: async () => { await setSessionTeacher(sessionId, before.teacher_id); patchRow('sessions', sessionId, { teacher_id: before.teacher_id }) },
        redo: async () => { await setSessionTeacher(sessionId, teacherId); patchRow('sessions', sessionId, { teacher_id: teacherId }) },
      })
    } catch (err) { patchRow('sessions', sessionId, { teacher_id: before.teacher_id }); setSaveState('error'); throw err }
  }, [data.sessions, patchRow, pushAction])

  const changeRoom = useCallback(async (sessionId, roomId) => {
    const before = data.sessions.find((s) => s.id === sessionId)
    if (!before) return
    patchRow('sessions', sessionId, { room_id: roomId })
    setSaveState('saving')
    try {
      await setSessionRoom(sessionId, roomId)
      setSaveState('saved')
      pushAction({
        label: 'تغيير قاعة الحصة',
        undo: async () => { await setSessionRoom(sessionId, before.room_id); patchRow('sessions', sessionId, { room_id: before.room_id }) },
        redo: async () => { await setSessionRoom(sessionId, roomId); patchRow('sessions', sessionId, { room_id: roomId }) },
      })
    } catch (err) { patchRow('sessions', sessionId, { room_id: before.room_id }); setSaveState('error'); throw err }
  }, [data.sessions, patchRow, pushAction])

  // generic create/remove with undo (students/teachers/rooms/groups/enrollment)
  const createRow = useCallback(async (table, row, label) => {
    setSaveState('saving')
    try {
      const created = await api.insertInto(table, row)
      addRow(table, created)
      setSaveState('saved')
      pushAction({
        label,
        undo: async () => { await api.deleteRow(table, created.id); removeRow(table, created.id) },
        redo: async () => { const again = await api.insertInto(table, row); addRow(table, again) },
      })
      return created
    } catch (err) { setSaveState('error'); throw err }
  }, [addRow, pushAction, removeRow])

  const deleteRowWithUndo = useCallback(async (table, row, label) => {
    setSaveState('saving')
    try {
      await api.deleteRow(table, row.id)
      removeRow(table, row.id)
      setSaveState('saved')
      pushAction({
        label,
        undo: async () => { const restored = await api.insertInto(table, { ...row, id: row.id }); addRow(table, restored) },
        redo: async () => { await api.deleteRow(table, row.id); removeRow(table, row.id) },
      })
    } catch (err) { setSaveState('error'); throw err }
  }, [pushAction, removeRow])

  const enrollStudent = useCallback(async (groupId, studentId) => {
    if (!centerId) return
    const dup = data.enrollments.find((e) => e.group_id === groupId && e.student_id === studentId)
    if (dup) return
    setSaveState('saving')
    try {
      const created = await api.enroll(centerId, groupId, studentId)
      addRow('enrollments', created)
      setSaveState('saved')
      pushAction({
        label: 'إضافة طالب لمجموعة',
        undo: async () => { await api.unenroll(created.id); removeRow('enrollments', created.id) },
        redo: async () => { const again = await api.enroll(centerId, groupId, studentId); addRow('enrollments', again) },
      })
    } catch (err) { setSaveState('error'); throw err }
  }, [centerId, data.enrollments, addRow, pushAction, removeRow])

  const value = useMemo(() => ({
    centers, centerId, setCenterId: (cid) => { setCenterId(cid); refresh(cid) },
    data, loading, error, refresh,
    saveState, setSaveState,
    successBar, setSuccessBar,
    focusSessionId, setFocusSessionId,
    markAttendance, saveNotes, changeStatus, changeTeacher, changeRoom,
    createRow, deleteRowWithUndo, enrollStudent,
    undo, redo, historyInfo,
  }), [centers, centerId, data, loading, error, refresh, saveState, successBar, focusSessionId,
    markAttendance, saveNotes, changeStatus, changeTeacher, changeRoom, createRow, deleteRowWithUndo,
    enrollStudent, undo, redo, historyInfo])

  return <CentersContext.Provider value={value}>{children}</CentersContext.Provider>
}

export function useCenters() {
  const ctx = useContext(CentersContext)
  if (!ctx) throw new Error('useCenters must be used inside CentersProvider')
  return ctx
}
