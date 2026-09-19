import { useEffect, useMemo, useState, useCallback, useRef, createContext, useContext } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { useLanguage } from '../context/LanguageContext'
import { useToast } from '../context/ToastContext'
import useOfflineSync from '../hooks/useOfflineSync'
import { pushAction, undoLast, redoLast, undoById, getRedoCount } from '../lib/undoManager'
import { addToQueue, syncQueue } from '../lib/offlineQueue'
import { pingPortalRefresh, disposeOtherPortalRefreshSenders } from '../lib/portalRealtime'
import { generateStudentCode, checkAcademicWarning } from '../lib/helpers'
import { markRender } from '../lib/devPerf'

// ═══════════════════════════════════════════════════════════════════════════
// WorkspaceStore — the single server-state layer of the new pipeline UI.
//
// SERVER STATE lives here (students, lesson_sessions, attendance_records,
// exam_scores, behavior_logs, broadcasts + realtime sync).
// UI STATE (active area, open pipeline tab, unsaved drafts) stays in the
// components that own it — the two are never mixed.
//
// All write paths are ported 1:1 from the battle-tested legacy Dashboard:
// same RPCs, same points math, same notification writes, same undo/redo
// closures, same offline queue semantics.
// ═══════════════════════════════════════════════════════════════════════════

const Ctx = createContext(null)
const MetaCtx = createContext(null)

export function useWorkspace() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
}

// PERF (performance round): save-feedback state (saving/saved flashes, undo
// snackbar) used to live in the same context as server data, so EVERY save
// flash re-rendered the entire authed tree — 2 extra full-tree renders per
// tap on top of the data change. It now lives in a separate context that
// only the small indicator components consume.
export function useWorkspaceMeta() {
  const ctx = useContext(MetaCtx)
  if (!ctx) throw new Error('useWorkspaceMeta must be used inside WorkspaceProvider')
  return ctx
}

export const normalizeArabicSearch = (value) => String(value || '').toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, ' ').trim()

const todayISO = () => new Date().toISOString().slice(0, 10)

export function WorkspaceProvider({ children }) {
  markRender('WorkspaceProvider')
  const { effectiveTeacherId } = useAuth()
  const { settings, updateSettings, refresh: refreshSettings } = useSettings()
  const { isArabic, t } = useLanguage()
  const { showToast } = useToast()

  // ── server state ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState([])
  const [examScoresByStudent, setExamScoresByStudent] = useState({})
  const [todayLogsByStudent, setTodayLogsByStudent] = useState({})
  const [lessonSessions, setLessonSessions] = useState([])
  const [allAttendance, setAllAttendance] = useState([]) // recent records (streaks + history)
  const [absenceStreaks, setAbsenceStreaks] = useState({})
  const [todayGroups, setTodayGroups] = useState([])
  const [broadcasts, setBroadcasts] = useState([])
  const [examsList, setExamsList] = useState([])

  // ── session-scoped server state (shared across pipeline tabs) ─────────────
  const [activeLessonId, setActiveLessonId] = useState('')
  const [lessonAttendanceByStudent, setLessonAttendanceByStudent] = useState({})

  // ── save/feedback state ───────────────────────────────────────────────────
  const [savingIds, setSavingIds] = useState(new Set())
  const [savedIds, setSavedIds] = useState(new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [undoSnackbar, setUndoSnackbar] = useState({ visible: false, message: '' })
  const [canRedoState, setCanRedoState] = useState(false)
  // pendingOps/opsSyncing: real offline-queue state (crash-safety UX) — the
  // offline banner shows the TRUTH ("N changes saved on this device") instead
  // of a hardcoded 0, and teachers can trigger/see the auto-sync.
  const { isOnline, pending: pendingOps, syncing: opsSyncing, manualSync: syncPendingOps } = useOfflineSync(supabase, showToast)

  // PERF (performance round): refs mirroring the latest render's state, so
  // every action below can read live state WITHOUT being recreated. This
  // lets the context value be useMemo'd on data deps only — consumers no
  // longer re-render unless server data actually changed. Reading
  // ref.current inside an action is semantically identical to reading the
  // render-scoped variable (refs are synced during every render).
  const studentsRef = useRef(students); studentsRef.current = students
  const lessonSessionsRef = useRef(lessonSessions); lessonSessionsRef.current = lessonSessions
  const lessonAttendanceRef = useRef(lessonAttendanceByStudent); lessonAttendanceRef.current = lessonAttendanceByStudent
  const savingIdsRef = useRef(savingIds); savingIdsRef.current = savingIds
  const settingsRef = useRef(settings); settingsRef.current = settings
  const isOnlineRef = useRef(isOnline); isOnlineRef.current = isOnline
  const isArabicRef = useRef(isArabic); isArabicRef.current = isArabic
  const isSavingRef = useRef(isSaving); isSavingRef.current = isSaving
  const teacherIdRef = useRef(effectiveTeacherId); teacherIdRef.current = effectiveTeacherId
  const updateSettingsRef = useRef(updateSettings); updateSettingsRef.current = updateSettings
  const tRef = useRef(t); tRef.current = t

  const flashSaved = useCallback((id) => {
    setSavedIds((p) => new Set([...p, id]))
    setTimeout(() => setSavedIds((p) => { const n = new Set(p); n.delete(id); return n }), 1200)
  }, [])

  const refreshUndo = useCallback(() => setUndoSnackbar((s) => ({ ...s })), [])
  useEffect(() => { setCanRedoState(getRedoCount() > 0) }, [undoSnackbar])

  // ══════════════════════════ DATA LOADING ═══════════════════════════════════
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      const tid = effectiveTeacherId
      const empty = Promise.resolve({ data: [] })
      const [stR, scoresR, logsR, attendanceR, lessonSessionsR, examsR] = await Promise.all(tid ? [
        supabase.from('students').select('*').eq('teacher_id', tid).order('created_at'),
        supabase.from('exam_scores').select('*, exams(title, max_score_per_section)').eq('teacher_id', tid).order('created_at'),
        supabase.from('behavior_logs').select('*').eq('teacher_id', tid).gte('created_at', todayStart.toISOString()).order('created_at'),
        // PERF + FIX: attendance_date is required by the Analytics 30/90-day
        // filters (AnalyticsArea) — it used to be missing from this select,
        // which silently made every period-filtered attendance percentage
        // null. Selecting it costs nothing.
        supabase.from('attendance_records').select('student_id, status, recorded_at, lesson_session_id, homework_status, attendance_date').eq('teacher_id', tid).order('recorded_at', { ascending: false }).limit(5000),
        supabase.from('lesson_sessions').select('*').eq('teacher_id', tid).order('session_date', { ascending: false }).order('started_at', { ascending: false }).limit(500),
        supabase.from('exams').select('*').eq('teacher_id', tid).order('created_at', { ascending: false }).limit(200),
      ] : [empty, empty, empty, empty, empty, empty])
      const st = stR.data ?? []
      setStudents(st)
      const attendance = attendanceR.data ?? []
      setAllAttendance(attendance)
      const byStudent = {}
      attendance.forEach((r) => { (byStudent[r.student_id] ||= []).push(r) })
      const streaks = {}
      Object.entries(byStudent).forEach(([sid, records]) => {
        let streak = 0
        for (const r of records) { if (r.status === 'غائب') streak++; else break }
        if (streak >= 3) streaks[sid] = streak
      })
      setAbsenceStreaks(streaks)
      const scoresMap = {}
      ;(scoresR.data ?? []).forEach((row) => {
        if (!scoresMap[row.student_id]) scoresMap[row.student_id] = []
        scoresMap[row.student_id].push({
          id: row.id, exam_id: row.exam_id, student_id: row.student_id, exam_title: row.exams?.title,
          max_score_per_section: row.exams?.max_score_per_section, section_scores: row.section_scores,
          total_score: row.total_score, version: row.version, created_at: row.created_at,
        })
      })
      setExamScoresByStudent(scoresMap)
      const logsMap = {}
      ;(logsR.data ?? []).forEach((row) => { if (!logsMap[row.student_id]) logsMap[row.student_id] = []; logsMap[row.student_id].push(row) })
      setTodayLogsByStudent(logsMap)
      const loaded = lessonSessionsR.data ?? []
      setLessonSessions(loaded)
      setExamsList(examsR.data ?? [])
      setActiveLessonId((current) => {
        if (current && loaded.some((lesson) => lesson.id === current)) return current
        const today = todayISO()
        const latestOpen = loaded.find((lesson) => lesson.status === 'open' && lesson.session_date === today)
        return latestOpen?.id || ''
      })
    } catch (err) {
      console.error('Failed to load data:', err)
      showToast(isArabicRef.current ? 'فشل تحميل البيانات' : 'Failed to load data', 'error')
    } finally { setLoading(false) }
  }, [showToast, effectiveTeacherId])

  useEffect(() => { loadAll() }, [loadAll])

  // PERF (performance round): exam writes used to trigger loadAll() — a full
  // 6-table refetch (students + ALL exam scores + 5,000 attendance + 500
  // sessions + 200 exams) — from up to THREE places at once (the realtime
  // echo, the save path itself, and single-cell edits in ExamsTab). Only the
  // two exam tables actually change, so this targeted refresh refetches just
  // those, in parallel. A 500ms trailing throttle coalesces bursts (e.g. the
  // realtime echo arriving right after the explicit refresh).
  const examRefreshTimerRef = useRef(null)
  const refreshExamData = useCallback(async ({ immediate = false } = {}) => {
    const run = async () => {
      examRefreshTimerRef.current = null
      const tid = teacherIdRef.current
      if (!tid) return
      const [examsR, scoresR] = await Promise.all([
        supabase.from('exams').select('*').eq('teacher_id', tid).order('created_at', { ascending: false }).limit(200),
        supabase.from('exam_scores').select('*, exams(title, max_score_per_section)').eq('teacher_id', tid).order('created_at'),
      ])
      setExamsList(examsR.data ?? [])
      const scoresMap = {}
      ;(scoresR.data ?? []).forEach((row) => {
        if (!scoresMap[row.student_id]) scoresMap[row.student_id] = []
        scoresMap[row.student_id].push({
          id: row.id, exam_id: row.exam_id, student_id: row.student_id, exam_title: row.exams?.title,
          max_score_per_section: row.exams?.max_score_per_section, section_scores: row.section_scores,
          total_score: row.total_score, version: row.version, created_at: row.created_at,
        })
      })
      setExamScoresByStudent(scoresMap)
    }
    if (immediate) {
      if (examRefreshTimerRef.current) { clearTimeout(examRefreshTimerRef.current); examRefreshTimerRef.current = null }
      await run()
      return
    }
    if (examRefreshTimerRef.current) clearTimeout(examRefreshTimerRef.current)
    examRefreshTimerRef.current = setTimeout(run, 500)
  }, [])

  useEffect(() => {
    supabase.from('broadcast_messages').select('*').order('created_at', { ascending: false }).limit(3)
      .then(({ data }) => setBroadcasts(data ?? []))
  }, [])

  const refreshTodayGroups = useCallback(() => {
    if (!effectiveTeacherId) return
    const todayWeekday = new Date().getDay()
    supabase.from('group_schedule').select('group_name, lesson_time').eq('teacher_id', effectiveTeacherId).eq('weekday', todayWeekday)
      .then(({ data }) => setTodayGroups(data ?? [])).catch(() => {})
  }, [effectiveTeacherId])

  useEffect(() => { refreshTodayGroups() }, [refreshTodayGroups])

  // Day flip + tab visibility re-sync.
  useEffect(() => {
    const check = () => refreshTodayGroups()
    document.addEventListener('visibilitychange', check)
    const timer = window.setInterval(check, 10 * 60 * 1000)
    return () => { document.removeEventListener('visibilitychange', check); window.clearInterval(timer) }
  }, [refreshTodayGroups])

  // ══════════════════════════ REALTIME (single channel) ══════════════════════
  const activeLessonIdRef = useRef('')
  activeLessonIdRef.current = activeLessonId
  const streakTimersRef = useRef(new Map())
  const refreshAbsenceStreak = useCallback((studentId) => {
    if (!studentId || !effectiveTeacherId) return
    const timers = streakTimersRef.current
    if (timers.has(studentId)) clearTimeout(timers.get(studentId))
    timers.set(studentId, setTimeout(async () => {
      timers.delete(studentId)
      try {
        const { data } = await supabase.from('attendance_records').select('student_id, status, recorded_at')
          .eq('teacher_id', effectiveTeacherId).eq('student_id', studentId).order('recorded_at', { ascending: false }).limit(60)
        const records = data || []
        let streak = 0
        for (const r of records) { if (r.status === 'غائب') streak++; else break }
        setAbsenceStreaks((prev) => {
          const next = { ...prev }
          if (streak >= 3) next[studentId] = streak
          else delete next[studentId]
          return next
        })
      } catch { /* streak stays until next full load */ }
    }, 400))
  }, [effectiveTeacherId])
  useEffect(() => {
    const timers = streakTimersRef.current
    return () => { timers.forEach((tm) => clearTimeout(tm)); timers.clear() }
  }, [])

  useEffect(() => {
    if (!effectiveTeacherId) return
    // PERF: account switch cleanup — drop any broadcast sender channels
    // cached for a DIFFERENT teacher id (they used to leak for the tab's
    // lifetime after logout/login as another user).
    try { disposeOtherPortalRefreshSenders(effectiveTeacherId) } catch { /* best-effort */ }
    let channel
    const ping = (source) => { try { pingPortalRefresh(effectiveTeacherId, source) } catch { /* portal polls */ } }
    try {
      channel = supabase.channel(`realtime-${effectiveTeacherId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'students', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          if (payload.eventType === 'INSERT') setStudents((prev) => (prev.some((s) => s.id === payload.new.id) ? prev : [...prev, payload.new]))
          else if (payload.eventType === 'UPDATE') setStudents((prev) => prev.map((s) => (s.id === payload.new.id ? payload.new : s)))
          else if (payload.eventType === 'DELETE') setStudents((prev) => prev.filter((s) => s.id !== payload.old.id))
          ping('students')
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'behavior_logs', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          const row = payload.new
          const rowDate = new Date(row.created_at)
          const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
          if (rowDate < todayStart) return
          setTodayLogsByStudent((prev) => { const list = prev[row.student_id] || []; if (list.some((l) => l.id === row.id)) return prev; return { ...prev, [row.student_id]: [...list, row] } })
          ping('behavior_logs')
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_sessions', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id
            setLessonSessions((prev) => prev.filter((lesson) => lesson.id !== deletedId))
            setActiveLessonId((cur) => (cur === deletedId ? '' : cur))
          } else {
            const row = payload.new
            setLessonSessions((prev) => {
              const idx = prev.findIndex((lesson) => lesson.id === row.id)
              if (idx === -1) return [row, ...prev]
              const next = [...prev]; next[idx] = row; return next
            })
          }
          ping('lesson_sessions')
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const removed = payload.old
            setLessonAttendanceByStudent((prev) => ((removed.lesson_session_id === activeLessonIdRef.current && prev[removed.student_id]?.id === removed.id) ? { ...prev, [removed.student_id]: undefined } : prev))
          } else {
            const row = payload.new
            // Guard: only true attendance rows (a wrong-table payload would
            // otherwise poison the map with an undefined student key).
            if (!row?.student_id) return
            setAllAttendance((prev) => [row, ...prev].slice(0, 5000))
            setLessonAttendanceByStudent((prev) => {
              if ((row.lesson_session_id || null) !== (activeLessonIdRef.current || null)) return prev
              const current = prev[row.student_id]
              if (current && current.id !== row.id && new Date(current.recorded_at || 0) > new Date(row.recorded_at || 0)) return prev
              return { ...prev, [row.student_id]: row }
            })
          }
          refreshAbsenceStreak(payload.new?.student_id || payload.old?.student_id)
          ping('attendance_records')
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_scores', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          setExamScoresByStudent((prev) => {
            if (payload.eventType === 'DELETE') {
              const sid = payload.old.student_id
              const list = prev[sid] || []
              return { ...prev, [sid]: list.filter((r) => r.id !== payload.old.id) }
            }
            const row = payload.new
            const mapped = { id: row.id, exam_id: row.exam_id, student_id: row.student_id, exam_title: row.exams?.title || row.exam_title, max_score_per_section: row.exams?.max_score_per_section || row.max_score_per_section, section_scores: row.section_scores, total_score: row.total_score, version: row.version, created_at: row.created_at }
            const list = prev[row.student_id] || []
            const idx = list.findIndex((r) => r.id === row.id)
            if (idx === -1) return { ...prev, [row.student_id]: [...list, mapped] }
            const next = [...list]; next[idx] = mapped
            return { ...prev, [row.student_id]: next }
          })
          ping('exam_scores')
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'exams', filter: `teacher_id=eq.${effectiveTeacherId}` }, () => {
          // PERF: targeted exam-tables refresh instead of full loadAll().
          refreshExamData()
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'group_schedule', filter: `teacher_id=eq.${effectiveTeacherId}` }, () => {
          refreshTodayGroups()
          ping('group_schedule')
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teacher_settings', filter: `teacher_id=eq.${effectiveTeacherId}` }, () => {
          refreshSettings?.()
          ping('teacher_settings')
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast_messages' }, (payload) => {
          setBroadcasts((prev) => [payload.new, ...prev].slice(0, 3))
          ping('broadcast_messages')
        })
        .subscribe()
    } catch (err) { console.warn('Realtime subscription failed:', err) }
    return () => { try { supabase.removeChannel(channel) } catch {} }
  }, [effectiveTeacherId, refreshAbsenceStreak, refreshTodayGroups, refreshSettings, loadAll, refreshExamData])

  // Reconnect → refetch authoritative state (rule 23).
  useEffect(() => {
    const onOnline = () => { if (isOnline) { loadAll(); refreshTodayGroups() } }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [isOnline, loadAll, refreshTodayGroups])

  // ══════════════════════════ DERIVED ═════════════════════════════════════════
  const groups = settings?.groups || []
  const groupMeta = settings?.group_meta || {}
  const ranks = settings?.ranks || []
  const activeLesson = useMemo(() => lessonSessions.find((lesson) => lesson.id === activeLessonId) || null, [lessonSessions, activeLessonId])

  // Load the per-lesson attendance map whenever the active lesson changes.
  useEffect(() => {
    let cancelled = false
    const loadLessonAttendance = async () => {
      if (!activeLessonId || !effectiveTeacherId) { setLessonAttendanceByStudent({}); return }
      const { data, error } = await supabase.from('attendance_records')
        .select('student_id, status, homework_status, recorded_at, id, lesson_session_id')
        .eq('teacher_id', effectiveTeacherId).eq('lesson_session_id', activeLessonId)
        .order('recorded_at', { ascending: false })
      if (cancelled) return
      if (error) { console.warn('Lesson attendance query failed:', error.message); setLessonAttendanceByStudent({}); return }
      const map = {}
      ;(data || []).forEach((row) => { if (!map[row.student_id]) map[row.student_id] = row })
      setLessonAttendanceByStudent(map)
    }
    loadLessonAttendance()
    return () => { cancelled = true }
  }, [activeLessonId, effectiveTeacherId])

  // PERF (performance round): this selector used to map FRESH student objects
  // on every call — and it's called in render bodies of 4 tabs, so downstream
  // useMemo deps invalidated every render and children could never be
  // memoized. Results are now cached per (students, lessonAttendance,
  // activeLesson) triple: same inputs → same array identity.
  const ssfCacheRef = useRef({ s: null, a: null, l: '', map: new Map() })
  const sessionStudentsFor = useCallback((groupName) => {
    if (!groupName) return []
    const cache = ssfCacheRef.current
    if (cache.s !== studentsRef.current || cache.a !== lessonAttendanceRef.current || cache.l !== activeLessonIdRef.current) {
      cache.s = studentsRef.current
      cache.a = lessonAttendanceRef.current
      cache.l = activeLessonIdRef.current
      cache.map = new Map()
    }
    if (cache.map.has(groupName)) return cache.map.get(groupName)
    const result = studentsRef.current.filter((s) => s.group_name === groupName).map((s) => ({
      ...s,
      attendance_status: activeLessonIdRef.current ? (lessonAttendanceRef.current[s.id]?.status || 'لم يرصد') : s.attendance_status,
      hw_status: activeLessonIdRef.current ? (lessonAttendanceRef.current[s.id]?.homework_status || 'لم يرصد') : s.hw_status,
    }))
    cache.map.set(groupName, result)
    return result
  }, [])

  const countsForLesson = useCallback((groupName, overrides = {}) => {
    const list = sessionStudentsFor(groupName)
    let present = 0, absent = 0, unrecorded = 0, hwDone = 0, hwApplicable = 0
    list.forEach((s) => {
      const att = overrides[s.id]?.attendance_status ?? s.attendance_status
      const hw = overrides[s.id]?.hw_status ?? s.hw_status
      if (att === 'حاضر') present++
      else if (att === 'غائب') absent++
      else unrecorded++
      if (att !== 'غائب') {
        hwApplicable++
        if (hw === 'مكتمل' || hw === 'تم') hwDone++
      }
    })
    return { present, absent, unrecorded, total: list.length, hwDone, hwApplicable }
  }, [sessionStudentsFor])

  // ══════════════════════════ ACTIONS ═════════════════════════════════════════
  const patchStudent = (id, patch, actionMeta) => {
    const prevStudent = studentsRef.current.find((s) => s.id === id)
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    if (actionMeta && prevStudent) {
      pushAction({
        type: actionMeta.type || 'edit', description: actionMeta.description || 'تعديل بيانات طالب',
        undoFn: async () => {
          if (!isOnline) return
          const reverted = {}
          for (const k of Object.keys(patch)) reverted[k] = prevStudent[k]
          reverted.updated_at = new Date().toISOString()
          await supabase.from('students').update(reverted).eq('id', id)
          setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, ...reverted } : s)))
        },
      })
    }
  }

  const logAction = async (studentId, note, pointsDelta = 0) => {
    const { data } = await supabase.from('behavior_logs').insert({ teacher_id: teacherIdRef.current, student_id: studentId, note, points_delta: pointsDelta }).select().single()
    if (data) setTodayLogsByStudent((prev) => ({ ...prev, [studentId]: [...(prev[studentId] || []), data] }))
  }

  const adjustPoints = async (id, amount, reason = 'تعديل يدوي') => {
    const s = studentsRef.current.find((x) => x.id === id); if (!s) return
    if (savingIdsRef.current.has(id)) return
    const isOnline = isOnlineRef.current
    const isArabic = isArabicRef.current
    setSavingIds((p) => new Set([...p, id]))
    const newPoints = s.points + amount
    const prevPoints = s.points
    try {
      if (!isOnline) {
        patchStudent(id, { points: newPoints }, { type: 'points', description: `${reason}: ${s.name}` })
        await addToQueue({ table: 'students', method: 'update', data: { points: newPoints, updated_at: new Date().toISOString() }, match: { id } })
        // behavior_logs drive the interaction counter — offline must queue the
        // insert AND mirror it locally so the interaction chip flips immediately.
        await addToQueue({ table: 'behavior_logs', method: 'insert', data: { teacher_id: effectiveTeacherId, student_id: id, note: `${reason} (${amount > 0 ? '+' + amount : amount} نقطة)`, points_delta: amount } })
        setTodayLogsByStudent((prev) => ({ ...prev, [id]: [...(prev[id] || []), { id: `local-${Date.now()}`, student_id: id, note: `${reason} (${amount > 0 ? '+' + amount : amount} نقطة)`, points_delta: amount, created_at: new Date().toISOString() }] }))
        setSaveStatus('saved_locally')
      } else {
        patchStudent(id, { points: newPoints }, { type: 'points', description: `${reason}: ${s.name}` })
        const { error } = await supabase.from('students').update({ points: newPoints, updated_at: new Date().toISOString() }).eq('id', id)
        if (error) throw error
        await logAction(id, `${reason} (${amount > 0 ? '+' + amount : amount} نقطة)`, amount)
        flashSaved(id)
      }
      setUndoSnackbar({ visible: true, message: `${reason}: ${s.name}` })
    } catch (error) {
      patchStudent(id, { points: prevPoints })
      showToast(isArabic ? `تعذر حفظ نقاط ${s.name}. حاول مرة أخرى.` : `Could not save points for ${s.name}. Please try again.`, 'error')
    } finally { setSavingIds((p) => { const n = new Set(p); n.delete(id); return n }) }
  }

  const setAttendance = async (id, status, lessonIdOverride) => {
    const s = studentsRef.current.find((x) => x.id === id); if (!s) return
    if (savingIdsRef.current.has(id)) return
    const lessonSessions = lessonSessionsRef.current
    const lessonAttendanceByStudent = lessonAttendanceRef.current
    const settings = settingsRef.current
    const isOnline = isOnlineRef.current
    const isArabic = isArabicRef.current
    const effectiveTeacherId = teacherIdRef.current
    let lessonId = null
    if (lessonIdOverride !== undefined) {
      lessonId = lessonIdOverride || null
    } else {
      const today = todayISO()
      lessonId = lessonSessions.find((lesson) => lesson.group_name === s.group_name && lesson.session_date === today && lesson.status === 'open')?.id || null
    }
    const targetLesson = lessonId ? lessonSessions.find((lesson) => lesson.id === lessonId) : null
    if (lessonId && targetLesson?.status === 'completed') {
      showToast(isArabic ? 'الحصة دي منتهية بالفعل — افتح حصة جديدة عشان تسجل الحضور.' : 'This lesson is already completed — open a new lesson to record attendance.', 'error')
      return
    }
    if (lessonId && lessonAttendanceByStudent[id]?.status === status) return
    if (!lessonId && s.attendance_status === status) return
    setSavingIds((p) => new Set([...p, id]))
    let pointsDiff = 0
    const previousAttendanceStatus = lessonId ? (lessonAttendanceByStudent[id]?.status || 'لم يرصد') : s.attendance_status
    if (previousAttendanceStatus === 'حاضر') pointsDiff -= settings.points_present
    if (previousAttendanceStatus === 'غائب') pointsDiff -= settings.points_absent
    if (status === 'حاضر') pointsDiff += settings.points_present
    else if (status === 'غائب') pointsDiff += settings.points_absent
    const newPoints = s.points + pointsDiff
    const prevState = { attendance_status: s.attendance_status, points: s.points }
    const studentPatch = { attendance_status: status, points: newPoints }
    try {
      if (!isOnline) {
        patchStudent(id, studentPatch, { type: 'attendance', description: `حضور ${s.name}: ${status}` })
        if (lessonId) {
          await addToQueue({ method: 'rpc', rpcName: 'upsert_lesson_attendance', rpcArgs: { p_lesson_session_id: lessonId, p_student_id: id, p_status: status } })
          // Optimistic mirror of the RPC result — offline marks must show in
          // the session focus card immediately (feedback rule: the teacher
          // never wonders "did it record?"). Synced by the offline queue.
          setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), student_id: id, lesson_session_id: lessonId, status, homework_status: prev[id]?.homework_status || 'لم يرصد', recorded_at: new Date().toISOString() } }))
        } else {
          await addToQueue({ table: 'students', method: 'update', data: { attendance_status: status, points: newPoints, updated_at: new Date().toISOString() }, match: { id } })
          await addToQueue({ table: 'attendance_records', method: 'upsert', data: { teacher_id: effectiveTeacherId, student_id: id, status, homework_status: s.hw_status || 'لم يرصد' }, upsertOpts: { onConflict: 'teacher_id,student_id' } })
        }
        setSaveStatus('saved_locally')
      } else {
        patchStudent(id, studentPatch)
        try {
          const { error: studentUpdateError } = await supabase.from('students').update({ ...studentPatch, updated_at: new Date().toISOString() }).eq('id', id)
          if (studentUpdateError) throw studentUpdateError
          if (lessonId) {
            const { data, error: attendanceError } = await supabase.rpc('upsert_lesson_attendance', { p_lesson_session_id: lessonId, p_student_id: id, p_status: status })
            if (attendanceError) throw attendanceError
            setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data || { student_id: id, lesson_session_id: lessonId, status, homework_status: prev[id]?.homework_status || 'لم يرصد', recorded_at: new Date().toISOString() } }))
          } else {
            const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
            const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
            const { data: existingAttendance, error: attendanceLookupError } = await supabase.from('attendance_records').select('id')
              .eq('teacher_id', effectiveTeacherId).eq('student_id', id).is('lesson_session_id', null)
              .gte('recorded_at', dayStart.toISOString()).lt('recorded_at', dayEnd.toISOString())
              .order('recorded_at', { ascending: false }).limit(1).maybeSingle()
            if (attendanceLookupError) throw attendanceLookupError
            if (existingAttendance?.id) {
              const { error } = await supabase.from('attendance_records').update({ status, recorded_at: new Date().toISOString() }).eq('id', existingAttendance.id)
              if (error) throw error
              const { error: notificationError } = await supabase.from('student_notifications').insert({ teacher_id: effectiveTeacherId, student_id: id, title: 'تحديث الحضور', body: `تم تحديث حضور الطالب ${s.name}: ${status}.`, category: 'attendance', deep_link: '/' })
              if (notificationError) console.warn('Attendance-change notification failed:', notificationError.message)
            } else {
              const { error } = await supabase.from('attendance_records').insert({ teacher_id: effectiveTeacherId, student_id: id, status })
              if (error) throw error
            }
          }
          await logAction(id, `تسجيل الحضور: ${status}`, pointsDiff)
          flashSaved(id)
        } catch (error) {
          patchStudent(id, { attendance_status: prevState.attendance_status, points: prevState.points })
          console.error('Save attendance failed:', error)
          showToast(isArabic ? `تعذر حفظ حضور ${s.name} (${status}). حاول مرة تانية.` : `Could not save attendance for ${s.name} (${status}). Please try again.`, 'error')
          return
        }
      }
      pushAction({
        type: 'attendance', description: `حضور ${s.name}: ${status}`,
        undoFn: async () => {
          if (lessonId) {
            const { data, error } = await supabase.rpc('upsert_lesson_attendance', { p_lesson_session_id: lessonId, p_student_id: id, p_status: previousAttendanceStatus })
            if (error) throw error
            if (data) setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data }))
          }
          const { error } = await supabase.from('students').update({ ...prevState, updated_at: new Date().toISOString() }).eq('id', id)
          if (error) throw error
          setStudents((prev) => prev.map((st) => (st.id === id ? { ...st, ...prevState } : st)))
        },
        redoFn: async () => {
          if (lessonId) {
            const { data, error } = await supabase.rpc('upsert_lesson_attendance', { p_lesson_session_id: lessonId, p_student_id: id, p_status: status })
            if (error) throw error
            if (data) setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data }))
          }
          const { error } = await supabase.from('students').update({ attendance_status: status, points: newPoints, updated_at: new Date().toISOString() }).eq('id', id)
          if (error) throw error
          setStudents((prev) => prev.map((st) => (st.id === id ? { ...st, attendance_status: status, points: newPoints } : st)))
        },
      })
      setUndoSnackbar({ visible: true, message: `حضور ${s.name}: ${status}` })
    } finally { setSavingIds((p) => { const n = new Set(p); n.delete(id); return n }) }
  }

  const updateHW = async (id, status, lessonIdOverride) => {
    const s = studentsRef.current.find((x) => x.id === id); if (!s) return
    if (savingIdsRef.current.has(id)) return
    const lessonSessions = lessonSessionsRef.current
    const lessonAttendanceByStudent = lessonAttendanceRef.current
    const isOnline = isOnlineRef.current
    const isArabic = isArabicRef.current
    const effectiveTeacherId = teacherIdRef.current
    let lessonId = null
    if (lessonIdOverride !== undefined) {
      lessonId = lessonIdOverride || null
    } else {
      const today = todayISO()
      lessonId = lessonSessions.find((lesson) => lesson.group_name === s.group_name && lesson.session_date === today && lesson.status === 'open')?.id || null
    }
    const targetLesson = lessonId ? lessonSessions.find((lesson) => lesson.id === lessonId) : null
    if (lessonId && targetLesson?.status === 'completed') {
      showToast(isArabic ? 'الحصة دي منتهية بالفعل — افتح حصة جديدة عشان تسجل الواجب.' : 'This lesson is already completed — open a new lesson to record homework.', 'error')
      return
    }
    setSavingIds((p) => new Set([...p, id]))
    const prevStatus = lessonId ? (lessonAttendanceByStudent[id]?.homework_status || 'لم يرصد') : (s.hw_status || 'لم يرصد')
    const studentPatch = { hw_status: status }
    try {
      if (!isOnline) {
        patchStudent(id, studentPatch, { type: 'homework', description: `واجب ${s.name}: ${status}` })
        await addToQueue({ table: 'students', method: 'update', data: { hw_status: status, updated_at: new Date().toISOString() }, match: { id } })
        if (lessonId) {
          await addToQueue({ method: 'rpc', rpcName: 'upsert_lesson_homework', rpcArgs: { p_lesson_session_id: lessonId, p_student_id: id, p_homework_status: status } })
          // Optimistic mirror of the RPC result — same feedback rule as attendance.
          setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), student_id: id, lesson_session_id: lessonId, homework_status: status, status: prev[id]?.status || 'لم يرصد', recorded_at: new Date().toISOString() } }))
        }
        setSaveStatus('saved_locally')
      } else {
        patchStudent(id, studentPatch)
        try {
          const { error: studentUpdateError } = await supabase.from('students').update({ hw_status: status, updated_at: new Date().toISOString() }).eq('id', id)
          if (studentUpdateError) throw studentUpdateError
          if (lessonId) {
            const { data: savedRow, error: homeworkError } = await supabase.rpc('upsert_lesson_homework', { p_lesson_session_id: lessonId, p_student_id: id, p_homework_status: status })
            if (homeworkError) throw homeworkError
            setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: savedRow || { ...(prev[id] || {}), student_id: id, lesson_session_id: lessonId, homework_status: status, status: prev[id]?.status || 'لم يرصد', recorded_at: new Date().toISOString() } }))
          }
          await logAction(id, `تقييم الواجب: ${status}`)
          flashSaved(id)
        } catch (error) {
          patchStudent(id, { hw_status: prevStatus })
          console.error('Save homework failed:', error)
          showToast(isArabic ? `تعذر حفظ واجب ${s.name} (${status}). حاول مرة تانية.` : `Could not save homework for ${s.name} (${status}). Please try again.`, 'error')
          return
        }
      }
      pushAction({
        type: 'homework', description: `واجب ${s.name}: ${status}`,
        undoFn: async () => {
          if (lessonId) {
            const { data, error } = await supabase.rpc('upsert_lesson_homework', { p_lesson_session_id: lessonId, p_student_id: id, p_homework_status: prevStatus })
            if (error) throw error
            if (data) setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data }))
          }
          const { error } = await supabase.from('students').update({ hw_status: prevStatus, updated_at: new Date().toISOString() }).eq('id', id)
          if (error) throw error
          setStudents((prev) => prev.map((st) => (st.id === id ? { ...st, hw_status: prevStatus } : st)))
        },
        redoFn: async () => {
          if (lessonId) {
            const { data, error } = await supabase.rpc('upsert_lesson_homework', { p_lesson_session_id: lessonId, p_student_id: id, p_homework_status: status })
            if (error) throw error
            if (data) setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data }))
          }
          const { error } = await supabase.from('students').update({ hw_status: status, updated_at: new Date().toISOString() }).eq('id', id)
          if (error) throw error
          setStudents((prev) => prev.map((st) => (st.id === id ? { ...st, hw_status: status } : st)))
        },
      })
      setUndoSnackbar({ visible: true, message: `واجب ${s.name}: ${status}` })
    } finally { setSavingIds((p) => { const n = new Set(p); n.delete(id); return n }) }
  }

  // ══════════════════════════ LESSON LIFECYCLE ════════════════════════════════
  const openLessonForGroup = useCallback(async (groupName, { silent = false, forceNew = false } = {}) => {
    if (!groupName || !teacherIdRef.current) return null
    const lessonSessions = lessonSessionsRef.current
    const groupMeta = settingsRef.current?.group_meta || {}
    const isArabic = isArabicRef.current
    const today = todayISO()
    const existingOpen = lessonSessions.find((lesson) => lesson.group_name === groupName && lesson.session_date === today && lesson.status === 'open')
    if (existingOpen) { setActiveLessonId(existingOpen.id); return existingOpen }
    if (!forceNew) {
      const existingToday = lessonSessions.find((lesson) => lesson.group_name === groupName && lesson.session_date === today)
      if (existingToday) {
        setActiveLessonId(existingToday.id)
        if (!silent) showToast(isArabic ? 'حصة النهارده محفوظة ومنتهية بالفعل — بياناتها ظاهرة دلوقتي. لو محتاج حصة تانية اضغط «فتح حصة جديدة».' : 'Today\'s lesson is already saved and completed — its data is shown now. Use "Open new session" if you need another one.', 'info')
        return existingToday
      }
    }
    const meta = groupMeta[groupName] || {}
    const { data, error } = await supabase.from('lesson_sessions').insert({
      teacher_id: effectiveTeacherId, group_name: groupName, stage: meta.stage || null,
      session_date: today, status: 'open', lesson_topic: '', homework_text: '', video_link: '',
    }).select().single()
    if (error || !data) { showToast(isArabic ? 'لم نقدر نفتح الحصة. تأكد من اتصال الإنترنت.' : 'Could not open the session. Check your connection.', 'error'); return null }
    setLessonSessions((prev) => [data, ...prev])
    setActiveLessonId(data.id)
    setLessonAttendanceByStudent({})
    if (!silent) showToast(isArabic ? 'اتفتحت الحصة. سجّل الحضور واكتب الدرس والواجب ثم اضغط إنهاء الحصة.' : 'Session opened. Record attendance, add the lesson and homework, then finish.', 'success')
    return data
  }, [showToast])

  // Open a session for a SPECIFIC date (day timeline). Purely client-side:
  // lessonSessions already holds every teacher session — no new fetch needed.
  // Reuses an open lesson first, else any lesson for that group+date. Creates
  // NOTHING (only openLessonForGroup / forceNew creates sessions).
  const openLessonForDate = useCallback(async (groupName, dateISO, { silent = false } = {}) => {
    if (!groupName || !effectiveTeacherId || !dateISO) return null
    const list = lessonSessions.filter((l) => l.group_name === groupName && l.session_date === dateISO)
    const target = list.find((l) => l.status === 'open') || list[0]
    if (target) {
      setActiveLessonId(target.id)
      if (!silent && target.status === 'completed') showToast(isArabic ? 'حصة محفوظة ومنتهية — البيانات للعرض والمراجعة.' : 'A saved, completed session — data is view-only.', 'info')
      return target
    }
    if (!silent) showToast(isArabic ? 'لا توجد حصة مسجّلة لهذه المجموعة في هذا اليوم.' : 'No session recorded for this group on that day.', 'info')
    return null
  }, [effectiveTeacherId, lessonSessions, isArabic, showToast])

  const saveSessionContent = async (lessonId, draft) => {
    if (!lessonId) return false
    const lesson = lessonSessionsRef.current.find((l) => l.id === lessonId)
    if (lesson?.status === 'completed') { showToast(isArabicRef.current ? 'الحصة منتهية ولا يمكن تعديلها' : 'This session is completed and cannot be edited', 'error'); return false }
    const payload = {
      lesson_topic: draft.lesson_topic || '', homework_text: draft.homework_text || '',
      video_link: draft.video_link || '', updated_at: new Date().toISOString(),
    }
    const prev = lesson
    const isOnline = isOnlineRef.current
    const isArabic = isArabicRef.current
    const effectiveTeacherId = teacherIdRef.current
    if (!isOnline) {
      await addToQueue({ table: 'lesson_sessions', method: 'update', data: payload, match: { id: lessonId } })
      setLessonSessions((items) => items.map((lesson) => (lesson.id === lessonId ? { ...lesson, ...payload } : lesson)))
      setSaveStatus('saved_locally')
      showToast(isArabic ? 'تم حفظ بيانات الحصة محليًا' : 'Session data saved locally', 'info')
      return true
    }
    setSaveStatus('saving'); setIsSaving(true)
    try {
      const { error: updateError, count } = await supabase
        .from('lesson_sessions').update(payload, { count: 'exact' })
        .eq('id', lessonId).eq('teacher_id', effectiveTeacherId)
      if (updateError) throw updateError
      if (count === 0) throw new Error(isArabic ? 'الحصة غير موجودة أو انتهت صلاحية الوصول إليها.' : 'The session was not found or is no longer accessible.')
      setLessonSessions((items) => items.map((lesson) => (lesson.id === lessonId ? { ...lesson, ...payload } : lesson)))
      setSaveStatus('saved'); setLastSavedAt(new Date())
      pushAction({
        type: 'lesson_content', description: `حفظ بيانات حصة: ${lesson?.group_name || ''}`,
        undoFn: async () => {
          if (!prev) return
          const restorePayload = { lesson_topic: prev.lesson_topic || '', homework_text: prev.homework_text || '', video_link: prev.video_link || '', updated_at: new Date().toISOString() }
          const { error: restoreError } = await supabase.from('lesson_sessions').update(restorePayload).eq('id', lessonId).eq('teacher_id', effectiveTeacherId)
          if (restoreError) throw restoreError
          setLessonSessions((items) => items.map((lesson) => (lesson.id === lessonId ? { ...lesson, ...restorePayload } : lesson)))
        },
      })
      return true
    } catch (error) {
      console.error('Save lesson data error:', error)
      setSaveStatus('error')
      const detail = String(error?.message || '').trim()
      const safeDetail = detail && !/stack|supabase|postgres|permission denied|row-level security/i.test(detail) ? `: ${detail}` : ''
      showToast(`${isArabic ? 'تعذر حفظ تقدم الحصة' : 'Could not save session progress'}${safeDetail}`, 'error')
      return false
    } finally { setIsSaving(false) }
  }

  const validateLessonState = async (lessonId) => {
    const validAttendance = new Set(['حاضر', 'غائب', 'لم يرصد'])
    const lessonAttendanceByStudent = lessonAttendanceRef.current
    const isOnline = isOnlineRef.current
    const isArabic = isArabicRef.current
    const effectiveTeacherId = teacherIdRef.current
    const localRows = Object.values(lessonAttendanceByStudent).filter(Boolean)
    const localInvalid = localRows.find((row) => !validAttendance.has(row.status))
    if (localInvalid) throw new Error(isArabic ? 'تم اكتشاف حالة حضور غير صحيحة. راجع الطالب قبل الحفظ.' : 'An invalid attendance state was detected. Review the student before saving.')
    if (!isOnline) return { rows: localRows }
    const { data: rows, error } = await supabase.from('attendance_records')
      .select('student_id, status, homework_status, recorded_at, lesson_session_id')
      .eq('teacher_id', effectiveTeacherId).eq('lesson_session_id', lessonId).order('recorded_at', { ascending: false }).limit(5000)
    if (error) throw error
    const seen = new Set()
    const duplicate = (rows || []).find((row) => { if (seen.has(row.student_id)) return true; seen.add(row.student_id); return false })
    if (duplicate) throw new Error(isArabic ? 'تم اكتشاف أكثر من سجل لنفس الطالب داخل الحصة. لم يتم إنهاء الحصة.' : 'Duplicate attendance rows were detected. The session was not finalized.')
    const invalid = (rows || []).find((row) => !validAttendance.has(row.status))
    if (invalid) throw new Error(isArabic ? 'تم اكتشاف حالة حضور غير صحيحة. لم يتم إنهاء الحصة.' : 'An invalid attendance state was detected. The session was not finalized.')
    return { rows: rows || [] }
  }

  const finishLesson = useCallback(async (lessonId, groupName) => {
    const lesson = lessonSessionsRef.current.find((l) => l.id === lessonId) || (lessonId ? { id: lessonId } : null)
    const targetGroup = groupName || lesson?.group_name
    const isArabic = isArabicRef.current
    const isOnline = isOnlineRef.current
    const students = studentsRef.current
    const effectiveTeacherId = teacherIdRef.current
    if (!lessonId) { showToast(isArabic ? 'افتح الحصة أولاً' : 'Open a session first', 'error'); return false }
    if (lesson?.status === 'completed') { showToast(isArabic ? 'الحصة دي منتهية بالفعل' : 'This session is already completed', 'info'); return false }
    setSaveStatus('saving')
    try {
      await validateLessonState(lessonId)
      if (!isOnline) {
        await addToQueue({ method: 'rpc', rpcName: 'finalize_lesson_session', rpcArgs: { p_lesson_session_id: lessonId } })
        const endedAt = new Date().toISOString()
        setLessonSessions((prev) => prev.map((l) => (l.id === lessonId ? { ...l, status: 'completed', ended_at: endedAt, updated_at: endedAt } : l)))
        setSaveStatus('finalized')
        showToast(isArabic ? 'تم حفظ البيانات وتجهيز إنهاء الحصة للمزامنة عند عودة الاتصال.' : 'Session data saved and finalization queued until you are back online.', 'info')
        return true
      }
      const { data: finalizeResult, error: finalizeError } = await supabase.rpc('finalize_lesson_session', { p_lesson_session_id: lessonId })
      if (finalizeError) throw finalizeError
      const endedAt = new Date().toISOString()
      setLessonSessions((prev) => prev.map((l) => (l.id === lessonId ? { ...l, status: 'completed', ended_at: endedAt, updated_at: endedAt } : l)))
      const { data: finalRows, error: rowsError } = await supabase.from('attendance_records')
        .select('student_id, status, homework_status, recorded_at, lesson_session_id')
        .eq('teacher_id', effectiveTeacherId).eq('lesson_session_id', lessonId).order('recorded_at', { ascending: false }).limit(5000)
      if (rowsError) throw rowsError
      const finalMap = (finalRows || []).reduce((map, row) => { if (!map[row.student_id] || new Date(row.recorded_at) > new Date(map[row.student_id].recorded_at)) map[row.student_id] = row; return map }, {})
      const groupStudents = students.filter((s) => s.group_name === targetGroup)
      const missingFinalState = groupStudents.some((student) => !finalMap[student.id] || !['حاضر', 'غائب'].includes(finalMap[student.id].status))
      if (missingFinalState) throw new Error(isArabic ? 'لم يكتمل سجل الحضور لكل طلاب المجموعة. لم يتم إرسال التحديث.' : 'The final attendance state is incomplete. The portal update was not sent.')
      setLessonAttendanceByStudent(finalMap)
      const notifications = groupStudents.map((student) => {
        const finalState = finalMap[student.id]
        const finalAttendance = finalState?.status || 'لم يرصد'
        const finalHomework = finalState?.homework_status || 'لم يرصد'
        return { teacher_id: effectiveTeacherId, student_id: student.id, title: 'تحديث الحصة النهائي', body: `تم حفظ وإنهاء حصة ${targetGroup}. الحالة النهائية: ${finalAttendance}. الواجب: ${finalHomework}. ${lesson?.lesson_topic ? `الدرس: ${lesson.lesson_topic}. ` : ''}${lesson?.homework_text ? `تفاصيل الواجب: ${lesson.homework_text}` : 'لا يوجد واجب مسجل.'}`.trim(), category: 'attendance', deep_link: '/' }
      })
      if (notifications.length) {
        const { error: notificationError } = await supabase.from('student_notifications').insert(notifications)
        if (notificationError) throw notificationError
      }
      setSaveStatus('finalized')
      const summary = finalizeResult?.present_count !== undefined ? ` حاضر: ${finalizeResult.present_count} · غائب: ${finalizeResult.absent_count}` : ''
      showToast(isArabic ? `تم حفظ البيانات وإنهاء الحصة وتسجيلها في السجل.${summary}` : `Session data saved, finalized, and logged.${summary}`, 'success')
      return true
    } catch (error) {
      setSaveStatus('error')
      showToast(isArabic ? `لم يتم إنهاء الحصة: ${error.message || 'راجع البيانات وحاول مرة أخرى'}` : `Session was not finalized: ${error.message || 'Review the data and try again'}`, 'error')
      return false
    } finally { setSaveStatus('idle') }
  }, [showToast, validateLessonState])

  const markGroupAbsences = useCallback(async (lessonId) => {
    const effectiveTeacherId = teacherIdRef.current
    const isOnline = isOnlineRef.current
    const isArabic = isArabicRef.current
    if (!lessonId || !isOnline) return 0
    const { data, error } = await supabase.rpc('mark_group_absences', { p_lesson_session_id: lessonId })
    if (error) { showToast(isArabic ? 'تعذر رصد الغائبين' : 'Could not mark absences', 'error'); return 0 }
    // Re-read the lesson map so the UI reflects the server-side upserts.
    const { data: rows } = await supabase.from('attendance_records')
      .select('student_id, status, homework_status, recorded_at, id, lesson_session_id')
      .eq('teacher_id', effectiveTeacherId).eq('lesson_session_id', lessonId)
      .order('recorded_at', { ascending: false })
    const map = {}
    ;(rows || []).forEach((row) => { if (!map[row.student_id]) map[row.student_id] = row })
    setLessonAttendanceByStudent(map)
    const marked = data?.marked || 0
    if (marked > 0) showToast(isArabic ? `تم رصد ${marked} طالب غائب` : `Marked ${marked} students absent`, 'success')
    return marked
  }, [showToast])

  // PERF (performance round): the loop used to `await setAttendance` per
  // student — N sequential write chains (3 writes each) meant marking a
  // 30-student group present took 90 serialized round-trips. Each student's
  // write is fully independent (per-student RPC + per-student points row),
  // so they now run in parallel: wall-clock ≈ 1 round-trip.
  const markAllPresent = async (groupName, lessonIdOverride) => {
    const list = studentsRef.current.filter((s) => s.group_name === groupName)
    const lessonAttendanceByStudent = lessonAttendanceRef.current
    const pending = list.filter((s) => {
      const current = lessonIdOverride ? lessonAttendanceByStudent[s.id]?.status : s.attendance_status
      return current !== 'حاضر'
    })
    await Promise.all(pending.map((s) => setAttendance(s.id, 'حاضر', lessonIdOverride)))
    const count = pending.length
    if (count > 0) showToast(isArabicRef.current ? `تم تسجيل ${count} طالب حاضر` : `Marked ${count} students present`, 'success')
    else showToast(isArabicRef.current ? 'الكل مسجل حاضر بالفعل' : 'Everyone is already marked present', 'info')
    return count
  }

  // ══════════════════════════ STUDENTS CRUD ═══════════════════════════════════
  const saveStudent = async (form, editing) => {
    if (isSavingRef.current) return { ok: false }
    const isArabic = isArabicRef.current
    const students = studentsRef.current
    const effectiveTeacherId = teacherIdRef.current
    const cleanName = String(form?.name || '').trim()
    if (!cleanName) { showToast(isArabic ? 'اكتب اسم الطالب أولاً' : 'Enter the student name first', 'error'); return { ok: false } }
    if (!effectiveTeacherId) { showToast(isArabic ? 'لم يتم تحميل حساب المدرس بعد، أعد المحاولة' : 'Teacher account is still loading; please try again', 'error'); return { ok: false } }
    setIsSaving(true)
    try {
      if (editing) {
        const id = editing.id
        const prev = students.find((s) => s.id === id)
        const patch = { name: form.name, phone: form.phone, stage: form.stage, group_name: form.group }
        patchStudent(id, patch, { type: 'student_update', description: `تعديل: ${form.name}` })
        const { error } = await supabase.from('students').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
        if (error) throw error
        pushAction({
          type: 'student_update', description: `تعديل: ${form.name}`,
          undoFn: async () => {
            if (!prev) return
            await supabase.from('students').update({ name: prev.name, phone: prev.phone, stage: prev.stage, group_name: prev.group_name, updated_at: new Date().toISOString() }).eq('id', id)
            setStudents((p) => p.map((s) => (s.id === id ? prev : s)))
          },
        })
        showToast(t('data_loaded'), 'success')
        return { ok: true }
      }
      const normalizedName = cleanName.toLowerCase()
      const possibleDupe = students.find((s) => { const sameName = s.name.trim().toLowerCase() === normalizedName; const samePhone = form.phone && s.phone && s.phone === form.phone; return sameName || samePhone })
      if (possibleDupe) {
        const reason = possibleDupe.name.trim().toLowerCase() === normalizedName ? (t('same_name') || 'نفس الاسم') : (t('same_phone') || 'نفس الهاتف')
        showToast(`${t('duplicate_student') || 'يوجد طالب بنفس البيانات'} (${reason}: ${possibleDupe.name})`, 'error')
        return { ok: false, duplicate: possibleDupe }
      }
      const payload = { teacher_id: effectiveTeacherId, code: generateStudentCode(), name: cleanName, phone: String(form.phone || '').trim(), stage: form.stage || null, group_name: form.group || null, points: 0, warnings: 0, attendance_status: 'لم يرصد', hw_status: 'لم يرصد' }
      const { data, error } = await supabase.from('students').insert(payload).select().single()
      if (error) throw error
      setStudents((prev) => [...prev, data])
      pushAction({
        type: 'student_add', description: `إضافة: ${cleanName}`,
        undoFn: async () => {
          await supabase.from('students').delete().eq('id', data.id)
          setStudents((prev) => prev.filter((s) => s.id !== data.id))
        },
      })
      setUndoSnackbar({ visible: true, message: `إضافة: ${cleanName}` })
      showToast(t('data_loaded'), 'success')
      return { ok: true, student: data }
    } catch (error) {
      console.error('Save student error:', error)
      showToast(error?.message || 'تعذر حفظ الطالب', 'error')
      return { ok: false }
    } finally { setIsSaving(false) }
  }

  // Bulk multi-row add — validates all rows first, then saves all (rule 19).
  // validateBulkRows is PURE (never writes); bulkAddStudents commits only
  // after the caller has shown the review step.
  const validateBulkRows = useCallback((rows) => {
    const students = studentsRef.current
    const problems = []
    const seenNames = new Set()
    const seenPhones = new Set()
    rows.forEach((row, i) => {
      const label = `طالب ${i + 1}`
      if (!String(row.name || '').trim()) problems.push({ index: i, label, field: 'name', reason: 'الاسم مفقود' })
      const phone = String(row.phone || '').trim()
      if (phone && !/^(01[0125]\d{8}|\+?201[0125]\d{8}|00201[0125]\d{8})$/.test(phone.replace(/\s/g, ''))) {
        problems.push({ index: i, label, field: 'phone', reason: 'رقم الهاتف غير صحيح' })
      }
      const normalized = String(row.name || '').trim().toLowerCase()
      if (normalized && seenNames.has(normalized)) problems.push({ index: i, label, field: 'name', reason: 'اسم مكرر داخل القائمة' })
      if (phone && seenPhones.has(phone)) problems.push({ index: i, label, field: 'phone', reason: 'هاتف مكرر داخل القائمة' })
      if (phone) {
        const existing = students.find((s) => s.phone && s.phone === phone)
        if (existing) problems.push({ index: i, label, field: 'phone', reason: `الهاتف مسجل للطالب ${existing.name}` })
      }
      if (normalized) {
        const existingName = students.find((s) => s.name.trim().toLowerCase() === normalized)
        if (existingName) problems.push({ index: i, label, field: 'name', reason: `الاسم مسجل للطالب ${existingName.name}` })
      }
      if (normalized) seenNames.add(normalized)
      if (phone) seenPhones.add(phone)
    })
    return problems
  }, [])

  const bulkAddStudents = async (rows, onProgress) => {
    const problems = validateBulkRows(rows)
    if (problems.length) return { ok: false, problems }
    const effectiveTeacherId = teacherIdRef.current
    const payload = rows.map((row) => ({
      teacher_id: effectiveTeacherId, code: generateStudentCode(),
      name: String(row.name).trim(), phone: String(row.phone || '').trim() || null,
      stage: row.stage || null, group_name: row.group || null,
      points: 0, warnings: 0, attendance_status: 'لم يرصد', hw_status: 'لم يرصد',
    }))
    const { data, error } = await supabase.from('students').insert(payload).select()
    if (error) { showToast(`تعذر حفظ الطلاب: ${error.message}`, 'error'); return { ok: false, problems: [] } }
    setStudents((prev) => [...prev, ...(data || [])])
    pushAction({
      type: 'bulk_add', description: `إضافة ${data.length} طالب`,
      undoFn: async () => {
        // PERF: one .in() delete instead of N sequential deletes.
        await supabase.from('students').delete().in('id', data.map((d) => d.id))
        setStudents((prev) => prev.filter((s) => !data.some((d) => d.id === s.id)))
      },
    })
    showToast(`تمت إضافة ${data.length} طالب`, 'success')
    return { ok: true, students: data }
  }

  const deleteStudent = async (student) => {
    const isArabic = isArabicRef.current
    const backup = { ...student }
    setStudents((prev) => prev.filter((s) => s.id !== student.id))
    const { error } = await supabase.from('students').delete().eq('id', student.id)
    if (error) {
      setStudents((prev) => [...prev, backup].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))))
      showToast(isArabic ? 'تعذر حذف الطالب' : 'Could not delete the student', 'error')
      return false
    }
    pushAction({
      type: 'student_delete', description: `حذف: ${student.name}`,
      undoFn: async () => {
        const { id, ...rest } = backup
        const { data } = await supabase.from('students').insert(rest).select().single()
        if (data) setStudents((prev) => [...prev, data])
      },
    })
    setUndoSnackbar({ visible: true, message: `حذف: ${student.name}` })
    return true
  }

  const addWarning = async (id) => {
    const s = studentsRef.current.find((x) => x.id === id); if (!s) return
    const isArabic = isArabicRef.current
    const newWarnings = (s.warnings || 0) + 1
    const newPoints = s.points - 5
    patchStudent(id, { warnings: newWarnings, points: newPoints }, { type: 'warning', description: `إنذار: ${s.name}` })
    try {
      await supabase.from('students').update({ warnings: newWarnings, points: newPoints, updated_at: new Date().toISOString() }).eq('id', id)
      await logAction(id, 'إنذار سلوكي (-5 نقاط)', -5)
      setUndoSnackbar({ visible: true, message: `إنذار: ${s.name}` })
    } catch {
      patchStudent(id, { warnings: s.warnings || 0, points: s.points })
      showToast(isArabic ? 'تعذر حفظ الإنذار' : 'Could not save the warning', 'error')
    }
  }

  const removeWarning = async (id) => {
    const s = studentsRef.current.find((x) => x.id === id); if (!s) return
    const isArabic = isArabicRef.current
    if (!s.warnings) { showToast(isArabic ? 'لا توجد إنذارات' : 'No warnings', 'info'); return }
    const newWarnings = s.warnings - 1
    const newPoints = s.points + 5
    patchStudent(id, { warnings: newWarnings, points: newPoints })
    try {
      await supabase.from('students').update({ warnings: newWarnings, points: newPoints, updated_at: new Date().toISOString() }).eq('id', id)
      await logAction(id, 'إزالة إنذار (+5 نقاط)', 5)
      showToast(isArabic ? 'تم إزالة الإنذار' : 'Warning removed', 'success')
    } catch {
      patchStudent(id, { warnings: s.warnings, points: s.points })
      showToast(isArabic ? 'تعذر إزالة الإنذار' : 'Could not remove the warning', 'error')
    }
  }

  // ══════════════════════════ EXAMS ═══════════════════════════════════════════
  const saveExam = async ({ title, sections, maxScorePerSection, records, lessonId }) => {
    if (isSavingRef.current) return false
    const effectiveTeacherId = teacherIdRef.current
    const isOnline = isOnlineRef.current
    const isArabic = isArabicRef.current
    setIsSaving(true)
    try {
      if (!isOnline) { showToast(tRef.current('no_internet_exam') || 'لا يوجد اتصال — تعذر حفظ الامتحان', 'error'); return false }
      const { data: exam, error: examErr } = await supabase.from('exams').insert({
        teacher_id: effectiveTeacherId, title, sections, max_score_per_section: maxScorePerSection, lesson_session_id: lessonId || null,
      }).select().single()
      if (examErr) throw examErr
      if (!exam) return false
      const passingMark = (maxScorePerSection * sections.length) / 2
      const students = studentsRef.current
      const studentPointDiffs = {}
      // PERF (performance round): the old loop did 3 SEQUENTIAL writes per
      // graded student (score insert → points update → log insert): a
      // 30-student exam took ~90 serialized round-trips. Now:
      //   1. ONE batched insert for all exam_scores rows
      //   2. ONE batched insert for all behavior_logs rows
      //   3. per-student points updates run in PARALLEL (points depend on the
      //      current per-student value; batching them needs a DB function,
      //      which is out of scope for a frontend-only change)
      const scoreRows = records.map((r) => ({
        teacher_id: effectiveTeacherId, exam_id: exam.id, student_id: r.studentId,
        lesson_session_id: lessonId || null, section_scores: r.sectionScores, total_score: r.total,
      }))
      const { error: scoresError } = await supabase.from('exam_scores').insert(scoreRows)
      if (scoresError) throw scoresError
      const logRows = []
      const pointsJobs = []
      for (const r of records) {
        const s = students.find((x) => x.id === r.studentId)
        const pointDiff = Math.round(r.total - passingMark)
        studentPointDiffs[r.studentId] = (studentPointDiffs[r.studentId] || 0) + pointDiff
        if (s) {
          const newPoints = s.points + pointDiff
          pointsJobs.push(
            supabase.from('students').update({ points: newPoints, updated_at: new Date().toISOString() }).eq('id', r.studentId)
              .then(({ error: pointsError }) => { if (pointsError) throw pointsError })
          )
          logRows.push({ teacher_id: effectiveTeacherId, student_id: r.studentId, note: `امتحان (${title}): الدرجة ${r.total} | تأثير النقاط: ${pointDiff > 0 ? '+' + pointDiff : pointDiff}`, points_delta: pointDiff })
          // Optimistic local patch — one combined state update for the whole class.
          setStudents((prev) => prev.map((st) => (st.id === r.studentId ? { ...st, points: newPoints } : st)))
        }
      }
      await Promise.all(pointsJobs)
      if (logRows.length) {
        const { error: logsError } = await supabase.from('behavior_logs').insert(logRows)
        if (logsError) console.warn('Exam behavior-log insert failed (scores already saved):', logsError.message)
      }
      pushAction({
        type: 'exam', description: `امتحان: ${title}`,
        undoFn: async () => {
          await supabase.from('exams').delete().eq('id', exam.id)
          await supabase.from('exam_scores').delete().eq('exam_id', exam.id)
          for (const [sid, diff] of Object.entries(studentPointDiffs)) {
            const s = studentsRef.current.find((x) => x.id === sid)
            if (s) await supabase.from('students').update({ points: s.points - diff }).eq('id', sid)
          }
          loadAll()
        },
      })
      setUndoSnackbar({ visible: true, message: `امتحان: ${title}` })
      // Targeted refresh (exams + scores only) — the realtime echo is
      // coalesced by the throttle inside refreshExamData.
      await refreshExamData({ immediate: true })
      return true
    } catch (err) {
      console.error('Save exam error:', err)
      showToast(tRef.current('exam_failed') || 'تعذر حفظ الامتحان', 'error')
      return false
    } finally { setIsSaving(false) }
  }

  // ══════════════════════════ UNDO/REDO BRIDGE ════════════════════════════════
  const handleUndo = async () => {
    const result = await undoLast()
    refreshUndo()
    if (result.undone) { showToast(`${tRef.current('undo_done') || 'تم التراجع عن'} ${result.description}`, 'info'); setCanRedoState(getRedoCount() > 0); loadAll() }
    else showToast(tRef.current('nothing_to_undo') || 'لا يوجد ما يتم التراجع عنه', 'info')
  }
  const handleRedo = async () => {
    const result = await redoLast()
    refreshUndo()
    if (result.redone) { showToast(`${tRef.current('redo_done') || 'تم الإعادة'} ${result.description}`, 'info'); setCanRedoState(getRedoCount() > 0); loadAll() }
    else showToast(tRef.current('nothing_to_redo') || 'لا يوجد ما يتم إعادته', 'info')
  }
  const handleHistoryRestore = async (id) => {
    const result = await undoById(id)
    if (result.undone) { showToast(`${tRef.current('undo_done') || 'تم التراجع عن'} ${result.description}`, 'info'); loadAll() }
    else showToast(tRef.current('undo_failed') || 'تعذر التراجع', 'error')
  }

  const syncPendingSaves = async () => {
    setSaveStatus('saving')
    try {
      await syncQueue(supabase, showToast)
      setSaveStatus('saved'); setLastSavedAt(new Date()); refreshUndo()
    } catch (error) {
      console.error('Sync pending saves error:', error)
      setSaveStatus('error')
      showToast(isArabic ? 'تعذر مزامنة الحفظ المعلّق. حاول مرة أخرى.' : 'Could not sync pending saves. Try again.', 'error')
    }
  }

  // ══════════════════════════ GROUPS CRUD ═════════════════════════════════════
  const addGroup = async ({ name, stage, day, time }) => {
    const groups = settingsRef.current?.groups || []
    const groupMeta = settingsRef.current?.group_meta || {}
    const isArabic = isArabicRef.current
    if (!name || !stage || day === '' || !time) { showToast(isArabic ? 'أدخل اسم المجموعة والمرحلة واليوم والميعاد' : 'Enter group name, stage, day, and time', 'error'); return false }
    if (groups.includes(name)) { showToast(isArabic ? 'المجموعة موجودة بالفعل' : 'Group already exists', 'error'); return false }
    const previousSettings = { groups: [...groups], group_meta: { ...groupMeta } }
    const nextSettings = { groups: [...groups, name], group_meta: { ...groupMeta, [name]: { stage, day: Number(day), time } } }
    const settingsResult = await updateSettingsRef.current(nextSettings)
    if (settingsResult?.error) { showToast(`${isArabic ? 'فشل حفظ المجموعة: ' : 'Could not save group: '}${settingsResult.error.message || ''}`, 'error'); return false }
    const { data: scheduleRow, error: scheduleError } = await supabase.from('group_schedule')
      .insert({ teacher_id: teacherIdRef.current, group_name: name, weekday: Number(day), lesson_time: time })
      .select('id, group_name, weekday, lesson_time').single()
    if (scheduleError || !scheduleRow) {
      await updateSettingsRef.current(previousSettings)
      showToast(isArabic ? 'فشل حفظ موعد المجموعة، تم التراجع عن الإضافة' : 'Could not save the schedule; group addition was rolled back', 'error')
      return false
    }
    await loadAll()
    refreshTodayGroups()
    showToast(isArabic ? 'تمت إضافة المجموعة وحفظ موعدها' : 'Group and schedule saved', 'success')
    return true
  }

  const updateGroup = async (groupName, { stage, day, time }) => {
    const groupMeta = settingsRef.current?.group_meta || {}
    const isArabic = isArabicRef.current
    if (!stage || day === '' || !time) { showToast(isArabic ? 'أكمل بيانات المجموعة' : 'Complete the group details', 'error'); return false }
    const nextMeta = { ...groupMeta, [groupName]: { stage, day: Number(day), time } }
    try {
      const settingsResult = await updateSettingsRef.current({ group_meta: nextMeta })
      if (settingsResult?.error) throw settingsResult.error
      const { error } = await supabase.from('group_schedule').upsert(
        { teacher_id: teacherIdRef.current, group_name: groupName, weekday: Number(day), lesson_time: time },
        { onConflict: 'teacher_id,group_name,weekday' },
      )
      if (error) throw error
      showToast(isArabic ? 'تم تحديث المجموعة والميعاد' : 'Group schedule updated', 'success')
      return true
    } catch (error) {
      showToast(isArabic ? `تعذر تحديث المجموعة: ${error.message || ''}` : `Could not update group: ${error.message || ''}`, 'error')
      return false
    }
  }

  const deleteGroup = async (groupName) => {
    const groups = settingsRef.current?.groups || []
    const groupMeta = settingsRef.current?.group_meta || {}
    const isArabic = isArabicRef.current
    const previousSettings = { groups: [...groups], group_meta: { ...groupMeta } }
    const nextMeta = { ...groupMeta }; delete nextMeta[groupName]
    const settingsResult = await updateSettingsRef.current({ groups: groups.filter((g) => g !== groupName), group_meta: nextMeta })
    if (settingsResult?.error) { showToast(isArabic ? 'فشل حذف المجموعة من الإعدادات' : 'Could not remove the group from settings', 'error'); return false }
    const { error: scheduleError } = await supabase.from('group_schedule').delete().eq('teacher_id', teacherIdRef.current).eq('group_name', groupName)
    if (scheduleError) {
      await updateSettingsRef.current(previousSettings)
      showToast(isArabic ? 'فشل حذف موعد المجموعة، تم التراجع عن الحذف' : 'Could not delete the schedule; deletion was rolled back', 'error')
      return false
    }
    await loadAll()
    refreshTodayGroups()
    showToast(isArabic ? 'تم حذف المجموعة من الحصص' : 'Group removed from sessions', 'success')
    return true
  }

  // ══════════════════════════ CONTEXT VALUES ═══════════════════════════════
  // PERF: the giant value object used to be recreated on EVERY provider
  // render — any of ~20 state atoms re-rendered every useWorkspace()
  // consumer in the app. The value is now memoized on the data deps only
  // (all actions read refs, so they stay correct while frozen), and the
  // save-feedback state lives in a separate MetaCtx consumed only by the
  // small indicator components.
  const metaValue = useMemo(() => ({
    savingIds, savedIds, isSaving, saveStatus, lastSavedAt,
    undoSnackbar, setUndoSnackbar, canRedo: canRedoState,
    pendingOps, opsSyncing, syncPendingOps,
  }), [savingIds, savedIds, isSaving, saveStatus, lastSavedAt, undoSnackbar, canRedoState, pendingOps, opsSyncing, syncPendingOps])

  const value = useMemo(() => ({
    // server state
    loading, students, examScoresByStudent, todayLogsByStudent, lessonSessions, allAttendance,
    absenceStreaks, todayGroups, broadcasts, examsList, activeLessonId, activeLesson,
    lessonAttendanceByStudent, groups, groupMeta, ranks, settings, effectiveTeacherId,
    // network state — REGRESSION FIX (perf round dropped this field when the
    // value became memoized): ws.isOnline was undefined → every write took
    // the offline queue branch, behavior_logs were never written (interaction
    // never counted), the offline banner showed permanently, and auto-sync
    // never ran (queued marks never reached the server → lost on reload).
    isOnline,
    // actions (stable — read refs internally)
    loadAll, refreshTodayGroups, refreshSettings, refreshExamData, setActiveLessonId,
    setAttendance, updateHW, adjustPoints, logAction, patchStudent,
    openLessonForGroup, openLessonForDate, saveSessionContent, finishLesson, markAllPresent, markGroupAbsences,
    saveStudent, bulkAddStudents, validateBulkRows, deleteStudent, addWarning, removeWarning,
    saveExam, addGroup, updateGroup, deleteGroup,
    handleUndo, handleRedo, handleHistoryRestore, syncPendingSaves,
    // derived helpers
    sessionStudentsFor, countsForLesson, showToast,
    checkAcademicWarning: (sid) => checkAcademicWarning(examScoresByStudent[sid] || []),
    isArabic, t,
  }), [loading, students, examScoresByStudent, todayLogsByStudent, lessonSessions, allAttendance,
    absenceStreaks, todayGroups, broadcasts, examsList, activeLessonId, activeLesson,
    lessonAttendanceByStudent, groups, groupMeta, ranks, settings, effectiveTeacherId, isOnline,
    loadAll, refreshTodayGroups, refreshSettings, refreshExamData,
    openLessonForGroup, finishLesson, markGroupAbsences, validateBulkRows,
    sessionStudentsFor, countsForLesson, showToast, isArabic, t])

  // Dev/diagnostics handle: lets support tooling and E2E tests inspect live
  // server state without prop drilling. Not used by business logic.
  if (typeof window !== 'undefined') window.__NOKHBA_WS = { ...value, ...metaValue }

  return (
    <MetaCtx.Provider value={metaValue}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </MetaCtx.Provider>
  )
}
