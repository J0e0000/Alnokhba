import { useEffect, useMemo, useState, useCallback, useRef, useDeferredValue } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { useLanguage } from '../context/LanguageContext'
import {
  generateStudentCode, getStudentRank, getStudentRankPosition,
  checkAcademicWarning, parseTemplate, sendWhatsApp, isValidPhone, STAGE_CATEGORIES, GRADES_BY_STAGE, CORE_GRADE_OPTIONS,
} from '../lib/helpers'
import * as XLSX from 'xlsx'

import StudentModal from '../components/StudentModal'
import ProfileModal from '../components/ProfileModal'
import QRScannerModal from '../components/QRScannerModal'
import LeaderboardModal from '../components/LeaderboardModal'
import SettingsModal from '../components/SettingsModal'
import TemplatesModal from '../components/TemplatesModal'
import ExamModal from '../components/ExamModal'
import ExamsListModal from '../components/ExamsListModal'
import AnalyticsModal from '../components/AnalyticsModal'
import AnnouncementsModal from '../components/AnnouncementsModal'
import DashboardOverview from '../components/DashboardOverview'
import ConfirmDialog from '../components/ConfirmDialog'
import { SkeletonTableRows } from '../components/Skeleton'
import NotificationBell from '../components/NotificationBell'
import { useToast } from '../context/ToastContext'
import { useTheme } from '../context/ThemeContext'
import MessageQueueModal from '../components/MessageQueueModal'
import SessionHistoryModal from '../components/SessionHistoryModal'
import Charts from '../components/Charts'
import UndoSnackbar from '../components/UndoSnackbar'
import HistoryModal from '../components/HistoryModal'
import SaveStatusBar from '../components/SaveStatusBar'
import OfflineBanner from '../components/OfflineBanner'
import SaveUndoToolbar from '../components/SaveUndoToolbar'
import InteractiveTutorial from '../components/InteractiveTutorial'
import SendQrButton from '../components/SendQrButton'
import BrandingModal from '../components/BrandingModal'
import { useBranding } from '../context/BrandingContext'
import { useUndo } from '../context/UndoContext'
import useOfflineSync from '../hooks/useOfflineSync'
import { pushAction, undoLast, undoById, getHistoryCount, redoLast, getRedoCount } from '../lib/undoManager'
import { addToQueue, syncQueue, getQueueCount, saveQueue } from '../lib/offlineQueue'
import { sendQRViaWhatsApp, openWhatsAppPlaceholder, getOrCreateStudentToken, buildStudentQRLink, generateStudentReportPDF, buildTextReport, sendReportWhatsApp, getReportTemplateValues } from '../lib/qrPdfWhatsApp'
import { pingPortalRefresh } from '../lib/portalRealtime'
import { lastWhatsAppHandoffInfo } from '../lib/helpers'

const STAGES = ['الكل', ...STAGE_CATEGORIES]
const WEEKDAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const TIME_OPTIONS = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00']
const STAGE_OPTIONS = CORE_GRADE_OPTIONS
const normalizeArabicSearch = (value) => String(value || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/الصف/g, '').replace(/\s+/g, ' ').trim()
const normalizeStageSearch = (value) => normalizeArabicSearch(value)
  .replace(/تالته/g, 'الثالث').replace(/تانيه/g, 'الثاني').replace(/تاني/g, 'الثاني').replace(/ثانيه/g, 'الثاني')
  .replace(/تاني/g, 'الثاني').replace(/اولى/g, 'الاول').replace(/اولي/g, 'الاول').replace(/اول/g, 'الاول')
  .replace(/تالته/g, 'الثالث').replace(/تالت/g, 'الثالث').replace(/اعدادي/g, 'الاعدادي').replace(/ابتدايي/g, 'الابتدائي').replace(/ثانوي/g, 'الثانوي')

// Per-student "saved" feedback — tracks which student rows should show checkmark
const SAVE_FEEDBACK_MS = 1200

export default function Dashboard({ onOpenAdmin }) {
  const { profile, ownerProfile, isAssistant, effectiveTeacherId, unlockedFeatures, user, signOut } = useAuth()
  const { showToast } = useToast()
  const { isLight, toggleTheme } = useTheme()
  const { lang, t, isArabic, toggleLang } = useLanguage()
  const dir = isArabic ? 'rtl' : 'ltr'
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [fabOpen, setFabOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile drawer
  const sidebarRef = useRef(null)
  const askConfirm = (message, opts = {}) => new Promise((resolve) => setConfirmDialog({ message, ...opts, resolve }))
  const { isOnline, pending: offlinePendingCount, syncing: offlineSyncing, manualSync } = useOfflineSync(supabase, showToast)
  const { canUndo: ctxCanUndo, canRedo: ctxCanRedo, refresh: refreshUndo } = useUndo()
  const { settings, updateSettings, refresh: refreshSettings } = useSettings()

  const [students, setStudents] = useState([])
  const [examScoresByStudent, setExamScoresByStudent] = useState({})
  const [todayLogsByStudent, setTodayLogsByStudent] = useState({})
  const [sessionLogsByGroup, setSessionLogsByGroup] = useState({})
  const [lessonSessions, setLessonSessions] = useState([])
  const [activeLessonId, setActiveLessonId] = useState('')
  const [lessonAttendanceByStudent, setLessonAttendanceByStudent] = useState({})
  const [reportGroup, setReportGroup] = useState('')
  const [reportLessonId, setReportLessonId] = useState('')
  const [reportAttendanceByStudent, setReportAttendanceByStudent] = useState({})
  const [absenceStreaks, setAbsenceStreaks] = useState({})
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('الكل')
  const [groupFilter, setGroupFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const [studentModal, setStudentModal] = useState({ open: false, student: null })
  const [profileModal, setProfileModal] = useState({ open: false, student: null })
  const [qrOpen, setQrOpen] = useState(false)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [examOpen, setExamOpen] = useState(false)
  const [examsListOpen, setExamsListOpen] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [announcementsOpen, setAnnouncementsOpen] = useState(false)
  const [gameModal, setGameModal] = useState({ open: false, studentId: null })
  const [broadcasts, setBroadcasts] = useState([])
  const [dismissedBroadcasts, setDismissedBroadcasts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dismissedBroadcasts') || '[]') } catch { return [] }
  })
  const queueStorageKey = effectiveTeacherId ? `nokhba_message_queue_${effectiveTeacherId}` : ''
  const [queue, setQueue] = useState({ open: false, items: [], index: 0 })
  const updateQueue = useCallback((nextQueue) => {
    setQueue((previous) => {
      const next = typeof nextQueue === 'function' ? nextQueue(previous) : nextQueue
      try {
        if (queueStorageKey && next?.open && Array.isArray(next.items) && next.items.length > 0) {
          sessionStorage.setItem(queueStorageKey, JSON.stringify(next))
        } else if (queueStorageKey) {
          sessionStorage.removeItem(queueStorageKey)
        }
      } catch { /* storage can be unavailable in private browsing */ }
      return next
    })
  }, [queueStorageKey])
  const [sessionGroup, setSessionGroup] = useState('')
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [editGroupOpen, setEditGroupOpen] = useState(false)
  const [editGroupForm, setEditGroupForm] = useState({ original: '', stage: '', day: '', time: '' })
  const [newGroupForm, setNewGroupForm] = useState({ name: '', stage: '', day: '', time: '' })
  const [sessionDraft, setSessionDraft] = useState({ lesson_topic: '', homework_text: '', video_link: '' })
  const [sessionGuestSearch, setSessionGuestSearch] = useState('')
  const [historyModal, setHistoryModal] = useState({ open: false, group: null })
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null)
  const [bulkGroupOpen, setBulkGroupOpen] = useState(false)
  const [bulkGroupName, setBulkGroupName] = useState('')
  const [todayGroups, setTodayGroups] = useState([])
  const [activeSection, setActiveSection] = useState('dashboard')
  const [saveStatus, setSaveStatus] = useState('idle')
  const [lessonSaveStatus, setLessonSaveStatus] = useState('idle')
  const [undoSnackbar, setUndoSnackbar] = useState({ visible: false, message: '' })
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [sessionHasChanges, setSessionHasChanges] = useState(false)
  const [pendingQRStudent, setPendingQRStudent] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [savingIds, setSavingIds] = useState(new Set())
  const [savedIds, setSavedIds] = useState(new Set()) // per-student saved feedback
  const [pdfGenerating, setPdfGenerating] = useState(null)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [queuePendingCount, setQueuePendingCount] = useState(0)
  const [canRedo, setCanRedo] = useState(false)
  const [sessionDraftOriginal, setSessionDraftOriginal] = useState({ lesson_topic: '', homework_text: '', video_link: '' })
  const [pendingOpsCount, setPendingOpsCount] = useState(0)
  const [brandingOpen, setBrandingOpen] = useState(false)
  const [tourMenuOpen, setTourMenuOpen] = useState(false) // platform guide dialog (opened from sidebar menu)
  const { branding, displayName: brandDisplayName, logoUrl: brandLogoUrl } = useBranding()

  // Restore an interrupted WhatsApp queue after a page refresh. The queue is
  // teacher-scoped and intentionally stored only in this browser tab.
  useEffect(() => {
    if (!queueStorageKey) return
    try {
      const saved = JSON.parse(sessionStorage.getItem(queueStorageKey) || 'null')
      if (saved?.open && Array.isArray(saved.items) && saved.items.length > 0 && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < saved.items.length) {
        setQueue(saved)
      } else if (saved) {
        sessionStorage.removeItem(queueStorageKey)
      }
    } catch { /* ignore malformed or unavailable storage */ }
  }, [queueStorageKey])

  // Show saved feedback briefly then clear
  const flashSaved = useCallback((id) => {
    setSavedIds((prev) => new Set([...prev, id]))
    setTimeout(() => setSavedIds((prev) => { const n = new Set(prev); n.delete(id); return n }), SAVE_FEEDBACK_MS)
  }, [])

  // Close mobile sidebar on click outside
  useEffect(() => {
    if (!sidebarOpen) return
    const handler = (e) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setSidebarOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [sidebarOpen])

  // Close sidebar when section changes (mobile)
  useEffect(() => { setSidebarOpen(false) }, [activeSection])

  useEffect(() => {
    getQueueCount().then(setPendingOpsCount)
  }, [offlinePendingCount, saveStatus, isOnline])

  useEffect(() => {
    const unsub = saveQueue.onStatusChange((saving, saved, error, lsat) => {
      if (saved) { setSaveStatus('saved'); if (lsat) setLastSavedAt(new Date(lsat)); setQueuePendingCount(saveQueue.pendingCount) }
      else if (saving) { setSaveStatus('saving'); setQueuePendingCount(saveQueue.pendingCount) }
      else if (error) { setSaveStatus('error'); setQueuePendingCount(saveQueue.pendingCount) }
    })
    return unsub
  }, [])

  useEffect(() => { saveQueue.offline = !isOnline }, [isOnline])
  useEffect(() => { refreshUndo() }, [undoSnackbar, refreshUndo])
  useEffect(() => { setCanRedo(getRedoCount() > 0) }, [undoSnackbar])

  // -------------------- Data loading --------------------
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      const todayDateStr = new Date().toISOString().slice(0, 10)
      // DEFENSE-IN-DEPTH (migration_019): apply an explicit teacher_id filter
      // on every query in addition to the RLS policies. RLS is the primary
      // enforcement layer; this frontend filter prevents accidental
      // cross-tenant rows from showing up in the UI if RLS is ever weakened
      // or misconfigured again. If effectiveTeacherId is null (not signed
      // in as a normal teacher), we return nothing instead of falling back
      // to an unscoped query.
      const tid = effectiveTeacherId
      const scoped = tid
        ? [
            supabase.from('students').select('*').eq('teacher_id', tid).order('created_at'),
            supabase.from('exam_scores').select('*, exams(title, max_score_per_section)').eq('teacher_id', tid).order('created_at'),
            supabase.from('behavior_logs').select('*').eq('teacher_id', tid).gte('created_at', todayStart.toISOString()).order('created_at'),
            supabase.from('session_logs').select('*').eq('teacher_id', tid).eq('session_date', todayDateStr),
            supabase.from('attendance_records').select('student_id, status, recorded_at, lesson_session_id, homework_status').eq('teacher_id', tid).order('recorded_at', { ascending: false }).limit(5000),
            supabase.from('lesson_sessions').select('*').eq('teacher_id', tid).order('session_date', { ascending: false }).order('started_at', { ascending: false }).limit(500),
          ]
        : [
            Promise.resolve({ data: [] }),
            Promise.resolve({ data: [] }),
            Promise.resolve({ data: [] }),
            Promise.resolve({ data: [] }),
            Promise.resolve({ data: [] }),
            Promise.resolve({ data: [] }),
          ]
      const [stR, scoresR, logsR, sessionsR, attendanceR, lessonSessionsR] = await Promise.all(scoped)
      const st = stR.data ?? []
      const scores = scoresR.data ?? []
      const logs = logsR.data ?? []
      const sessions = sessionsR.data ?? []
      const attendance = attendanceR.data ?? []
      const loadedLessonSessions = lessonSessionsR.data ?? []
      setLessonSessions(loadedLessonSessions)
      setStudents(st)
      const byStudent = {}
      ;(attendance).forEach((r) => { (byStudent[r.student_id] ||= []).push(r) })
      const streaks = {}
      Object.entries(byStudent).forEach(([sid, records]) => {
        let streak = 0
        for (const r of records) { if (r.status === 'غائب') streak++; else break }
        if (streak >= 3) streaks[sid] = streak
      })
      setAbsenceStreaks(streaks)
      const scoresMap = {}
      ;(scores).forEach((row) => {
        if (!scoresMap[row.student_id]) scoresMap[row.student_id] = []
        scoresMap[row.student_id].push({ id: row.id, exam_id: row.exam_id, exam_title: row.exams?.title, max_score_per_section: row.exams?.max_score_per_section, section_scores: row.section_scores, total_score: row.total_score, version: row.version, created_at: row.created_at })
      })
      setExamScoresByStudent(scoresMap)
      const logsMap = {}
      ;(logs).forEach((row) => { if (!logsMap[row.student_id]) logsMap[row.student_id] = []; logsMap[row.student_id].push(row) })
      setTodayLogsByStudent(logsMap)
      const sessionMap = {}
      ;(sessions).forEach((row) => { sessionMap[row.group_name] = row })
      setSessionLogsByGroup(sessionMap)
      setActiveLessonId((current) => {
        if (current && loadedLessonSessions.some((lesson) => lesson.id === current)) return current
        const today = new Date().toISOString().slice(0, 10)
        const latestOpen = loadedLessonSessions.find((lesson) => lesson.status === 'open' && lesson.session_date === today)
        return latestOpen?.id || ''
      })
    } catch (err) {
      console.error('Failed to load data:', err)
      showToast(isArabic ? 'فشل تحميل البيانات' : 'Failed to load data', 'error')
    } finally { setLoading(false) }
  }, [showToast, isArabic, effectiveTeacherId])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    supabase.from('broadcast_messages').select('*').order('created_at', { ascending: false }).limit(3).then(({ data }) => setBroadcasts(data ?? []))
  }, [])

  const dismissBroadcast = (id) => {
    const next = [...dismissedBroadcasts, id]
    setDismissedBroadcasts(next)
    localStorage.setItem('dismissedBroadcasts', JSON.stringify(next))
  }

  // Realtime updates (Round 7): full instant sync. The old channel only covered
  // students / behavior_logs / session_logs, so الحصص (lesson_sessions), الحضور
  // (attendance_records), الدرجات (exam_scores), الجدول (group_schedule),
  // الإعدادات (teacher_settings) and الرسائل العامة (broadcast_messages) went
  // stale until a manual refresh — that is exactly "السجل مش متزامن مع الحصص".
  // Now every table drives a local state update AND a portal refresh ping so
  // the student portal reflects the change within ~a second.
  const sessionGroupRef = useRef('')
  sessionGroupRef.current = sessionGroup
  const activeLessonIdRef = useRef('')
  activeLessonIdRef.current = activeLessonId
  // Per-student debounced absence-streak recompute (burst of marks → one query).
  const streakTimersRef = useRef(new Map())
  const refreshAbsenceStreak = useCallback((studentId) => {
    if (!studentId || !effectiveTeacherId) return
    const timers = streakTimersRef.current
    if (timers.has(studentId)) clearTimeout(timers.get(studentId))
    timers.set(studentId, setTimeout(async () => {
      timers.delete(studentId)
      try {
        const { data } = await supabase.from('attendance_records').select('student_id, status, recorded_at').eq('teacher_id', effectiveTeacherId).eq('student_id', studentId).order('recorded_at', { ascending: false }).limit(60)
        const records = data || []
        let streak = 0
        for (const r of records) { if (r.status === 'غائب') streak++; else break }
        setAbsenceStreaks((prev) => {
          const next = { ...prev }
          if (streak >= 3) next[studentId] = streak
          else delete next[studentId]
          return next
        })
      } catch { /* streak stays as-is until the next full load */ }
    }, 400))
  }, [effectiveTeacherId])
  useEffect(() => {
    const timers = streakTimersRef.current
    return () => { timers.forEach((t) => clearTimeout(t)); timers.clear() }
  }, [])
  // Today's group list re-fetch helper (group_schedule realtime + day flip).
  const refreshTodayGroups = useCallback(() => {
    if (!effectiveTeacherId) return
    const todayWeekday = new Date().getDay()
    supabase.from('group_schedule').select('group_name').eq('teacher_id', effectiveTeacherId).eq('weekday', todayWeekday).then(({ data }) => {
      const list = (data ?? []).map((r) => r.group_name)
      setTodayGroups(list)
    }).catch(() => {})
  }, [effectiveTeacherId])
  useEffect(() => {
    if (!effectiveTeacherId) return
    let channel
    const ping = (source) => { try { pingPortalRefresh(effectiveTeacherId, source) } catch { /* portal falls back to polling */ } }
    try {
      channel = supabase.channel(`realtime-${effectiveTeacherId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'students', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          if (payload.eventType === 'INSERT') setStudents((prev) => (prev.some((s) => s.id === payload.new.id) ? prev : [...prev, payload.new]))
          else if (payload.eventType === 'UPDATE') setStudents((prev) => prev.map((s) => (s.id === payload.new.id ? payload.new : s)))
          else if (payload.eventType === 'DELETE') setStudents((prev) => prev.filter((s) => s.id !== payload.old.id))
          ping('students')
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'behavior_logs', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          const row = payload.new; const rowDate = new Date(row.created_at); const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
          if (rowDate < todayStart) return
          setTodayLogsByStudent((prev) => { const list = prev[row.student_id] || []; if (list.some((l) => l.id === row.id)) return prev; return { ...prev, [row.student_id]: [...list, row] } })
          ping('behavior_logs')
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'session_logs', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const removed = payload.old
            setSessionLogsByGroup((prev) => (prev[removed.group_name]?.id === removed.id ? { ...prev, [removed.group_name]: undefined } : prev))
            ping('session_logs')
            return
          }
          const row = payload.new
          const today = new Date().toISOString().slice(0, 10)
          setSessionLogsByGroup((prev) => {
            const current = prev[row.group_name]
            // Keep the freshest row per group; an older date must never shadow
            // today's entry in دفتر اليوم.
            if (current && current.id !== row.id && current.session_date === today && row.session_date !== today) return prev
            return { ...prev, [row.group_name]: row }
          })
          ping('session_logs')
        })
        // ── الحصص (lesson_sessions) — was missing: lessons opened/finalized on
        // another device (or by the offline-queue flush) never appeared here.
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
            const today = new Date().toISOString().slice(0, 10)
            // Adopt a lesson opened elsewhere when nothing is selected (mirrors
            // openLessonForGroup's auto-selection; unsaved typing is protected
            // by the sessionHasChanges draft guard below).
            setActiveLessonId((cur) => {
              if (cur) return cur
              if (row.status === 'open' && row.session_date === today && row.group_name === sessionGroupRef.current) return row.id
              return cur
            })
          }
          ping('lesson_sessions')
        })
        // ── الحضور (attendance_records) — was missing: marks from the offline
        // queue flush, a second teacher device, or an undo landed silently.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const removed = payload.old
            setLessonAttendanceByStudent((prev) => ((removed.lesson_session_id === activeLessonIdRef.current && prev[removed.student_id]?.id === removed.id) ? { ...prev, [removed.student_id]: undefined } : prev))
          } else {
            const row = payload.new
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
        // ── الدرجات (exam_scores) — was missing: new exam results only showed
        // up after a full reload (Charts + academic-warning indicators).
        .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_scores', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          setExamScoresByStudent((prev) => {
            if (payload.eventType === 'DELETE') {
              const sid = payload.old.student_id
              const list = prev[sid] || []
              return { ...prev, [sid]: list.filter((r) => r.id !== payload.old.id) }
            }
            const row = payload.new
            const mapped = { id: row.id, exam_id: row.exam_id, exam_title: row.exams?.title || row.exam_title, max_score_per_section: row.exams?.max_score_per_section || row.max_score_per_section, section_scores: row.section_scores, total_score: row.total_score, version: row.version, created_at: row.created_at }
            const list = prev[row.student_id] || []
            const idx = list.findIndex((r) => r.id === row.id)
            if (idx === -1) return { ...prev, [row.student_id]: [...list, mapped] }
            const next = [...list]; next[idx] = mapped
            return { ...prev, [row.student_id]: next }
          })
          ping('exam_scores')
        })
        // ── الجدول (group_schedule) — was missing.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'group_schedule', filter: `teacher_id=eq.${effectiveTeacherId}` }, () => {
          refreshTodayGroups()
          ping('group_schedule')
        })
        // ── الإعدادات (teacher_settings) — groups/ranks/settings edits on
        // another device now apply instantly.
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teacher_settings', filter: `teacher_id=eq.${effectiveTeacherId}` }, () => {
          refreshSettings?.()
          ping('teacher_settings')
        })
        // ── الرسائل العامة (broadcast_messages) — the NotificationBell.
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast_messages' }, (payload) => {
          setBroadcasts((prev) => [payload.new, ...prev].slice(0, 3))
          ping('broadcast_messages')
        })
        .subscribe()
    } catch (err) { console.warn('Realtime subscription failed:', err) }
    return () => { try { supabase.removeChannel(channel) } catch {} }
  }, [effectiveTeacherId, refreshAbsenceStreak, refreshTodayGroups, refreshSettings])

  const groups = settings?.groups || []
  const groupMeta = settings?.group_meta || {}
  const activeLesson = useMemo(() => lessonSessions.find((lesson) => lesson.id === activeLessonId) || null, [lessonSessions, activeLessonId])
  const ranks = settings?.ranks || []

  useEffect(() => {
    if (!effectiveTeacherId) return
    const todayWeekday = new Date().getDay()
    // Defense-in-depth (migration_019): scope by teacher_id
    supabase.from('group_schedule').select('group_name').eq('teacher_id', effectiveTeacherId).eq('weekday', todayWeekday).then(({ data }) => {
      const list = (data ?? []).map((r) => r.group_name)
      setTodayGroups(list)
      if (list.length === 1) setSessionGroup((prev) => prev || list[0])
    })
  }, [effectiveTeacherId])

  // Round 7: keep today's groups in sync when the day flips while the app
  // stays open (الحصص groups list shouldn't show yesterday's groups forever).
  useEffect(() => {
    const check = () => { refreshTodayGroups() }
    document.addEventListener('visibilitychange', check)
    const timer = window.setInterval(check, 10 * 60 * 1000)
    return () => { document.removeEventListener('visibilitychange', check); window.clearInterval(timer) }
  }, [refreshTodayGroups])

  // Keep a ref of unsaved draft state so the reset effect below can protect the
  // teacher's typing without adding sessionHasChanges to its dependencies (which
  // would re-run the reset on every keystroke reset cycle).
  const sessionHasChangesRef = useRef(false)
  sessionHasChangesRef.current = sessionHasChanges
  const prevSessionGroupRef = useRef('')

  useEffect(() => {
    if (!sessionGroup) { setSessionDraft({ lesson_topic: '', homework_text: '', video_link: '' }); setSessionDraftOriginal({ lesson_topic: '', homework_text: '', video_link: '' }); setSessionHasChanges(false); prevSessionGroupRef.current = sessionGroup; return }
    // FIX (draft wipe): never overwrite the teacher's unsaved typing with server
    // values. This effect also runs when `sessionLogsByGroup` gets a new object from
    // ANY realtime session_logs event (even for other groups) or after loadAll()
    // (undo/redo/history restore) — previously those wiped unsaved input.
    const isSameGroup = prevSessionGroupRef.current === sessionGroup
    prevSessionGroupRef.current = sessionGroup
    if (isSameGroup && sessionHasChangesRef.current) return
    const existing = activeLesson || sessionLogsByGroup[sessionGroup]
    const draft = { lesson_topic: existing?.lesson_topic || '', homework_text: existing?.homework_text || '', video_link: existing?.video_link || '' }
    setSessionDraft(draft); setSessionDraftOriginal(draft); setSessionHasChanges(false)
  }, [sessionGroup, activeLesson, sessionLogsByGroup])

  useEffect(() => {
    if (!sessionGroup) return
    setSessionHasChanges(sessionDraft.lesson_topic !== sessionDraftOriginal.lesson_topic || sessionDraft.homework_text !== sessionDraftOriginal.homework_text || sessionDraft.video_link !== sessionDraftOriginal.video_link)
  }, [sessionDraft, sessionDraftOriginal, sessionGroup])

  const saveSessionLogWithUndo = async () => {
    if (!sessionGroup) return false
    if (!activeLessonId) { showToast(isArabic ? 'اختار المجموعة وانتظر فتح الحصة قبل الحفظ' : 'Choose a group and wait for its lesson to open before saving', 'error'); return false }
    if (activeLesson?.status === 'completed') { showToast(isArabic ? 'الحصة منتهية ولا يمكن تعديلها' : 'This lesson is completed and cannot be edited', 'error'); return false }
    // The content is already persisted when there are no draft changes. Do not
    // issue a needless update that can fail after a realtime refresh.
    if (!sessionHasChanges) {
      setLessonSaveStatus('saved')
      return true
    }
    const payload = { lesson_topic: sessionDraft.lesson_topic || '', homework_text: sessionDraft.homework_text || '', video_link: sessionDraft.video_link || '', updated_at: new Date().toISOString() }
    const prev = activeLesson
    if (!isOnline) {
      await addToQueue({ table: 'lesson_sessions', method: 'update', data: payload, match: { id: activeLessonId } })
      const localLesson = { ...activeLesson, ...payload }
      setLessonSessions((items) => items.map((lesson) => lesson.id === activeLessonId ? localLesson : lesson))
      setSessionDraftOriginal({ ...sessionDraft }); setSessionHasChanges(false); setLessonSaveStatus('saved_locally')
      showToast(isArabic ? 'تم حفظ بيانات الحصة محليًا' : 'Lesson data saved locally', 'info')
      return true
    }
    setLessonSaveStatus('saving'); setIsSaving(true)
    try {
      // Do not use update().select().single(): PostgREST can return a single-row
      // parsing error even when the update itself succeeded after an RLS/realtime refresh.
      const { error: updateError, count } = await supabase
        .from('lesson_sessions')
        .update(payload, { count: 'exact' })
        .eq('id', activeLessonId)
        .eq('teacher_id', effectiveTeacherId)
      if (updateError) throw updateError
      if (count === 0) throw new Error(isArabic ? 'الحصة غير موجودة أو انتهت صلاحية الوصول إليها. أعد اختيار المجموعة.' : 'The lesson was not found or is no longer accessible. Re-select the group.')
      const updatedLesson = { ...activeLesson, ...payload }
      setLessonSessions((items) => items.map((lesson) => lesson.id === activeLessonId ? updatedLesson : lesson))
      setSessionDraftOriginal({ ...sessionDraft }); setSessionHasChanges(false); setLessonSaveStatus('saved'); setLastSavedAt(new Date())
      pushAction({ type: 'lesson_content', description: `حفظ بيانات حصة: ${sessionGroup}`, undoFn: async () => {
        if (!prev) return
        const restorePayload = { lesson_topic: prev.lesson_topic || '', homework_text: prev.homework_text || '', video_link: prev.video_link || '', updated_at: new Date().toISOString() }
        const { error: restoreError } = await supabase.from('lesson_sessions').update(restorePayload).eq('id', activeLessonId).eq('teacher_id', effectiveTeacherId)
        if (restoreError) throw restoreError
        const restored = { ...prev, ...restorePayload }
        setLessonSessions((items) => items.map((lesson) => lesson.id === activeLessonId ? restored : lesson))
        setSessionDraft({ lesson_topic: restored.lesson_topic || '', homework_text: restored.homework_text || '', video_link: restored.video_link || '' })
        setSessionDraftOriginal({ lesson_topic: restored.lesson_topic || '', homework_text: restored.homework_text || '', video_link: restored.video_link || '' })
        setSessionHasChanges(false)
      } })
      return true
    } catch (error) {
      console.error('Save lesson data error:', error)
      setLessonSaveStatus('error')
      const detail = String(error?.message || '').trim()
      const safeDetail = detail && !/stack|supabase|postgres|permission denied|row-level security/i.test(detail) ? `: ${detail}` : ''
      showToast(`${isArabic ? 'تعذر حفظ تقدم الحصة' : 'Could not save lesson progress'}${safeDetail}`, 'error')
      return false
    } finally { setIsSaving(false) }
  }

  // FIX (Ctrl+S stale snapshot): keep finishLesson in a ref that is refreshed on
  // every render. Previously the keydown handler captured the version of
  // finishLesson (and the sessionDraft closure) from when the group/lesson was
  // selected — pressing Ctrl+S after typing finalized the lesson with the OLD
  // empty draft and permanently discarded the typed topic/homework.
  // (Assignment happens right after finishLesson is defined below.)
  const finishLessonRef = useRef(null)
  useEffect(() => {
    const handler = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (sessionGroup && activeLessonId) finishLessonRef.current?.() } }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [sessionGroup, activeLessonId])

  // -------------------- Derived / filtered --------------------
  const deferredSearch = useDeferredValue(search)
  const filteredStudents = useMemo(() => {
    const q = normalizeArabicSearch(deferredSearch)
    return students.filter((s) => {
      const searchable = normalizeArabicSearch([s.name, s.phone, s.code, s.stage, s.group_name].filter(Boolean).join(' '))
      const matchSearch = !q || searchable.includes(q)
      const matchStage = stageFilter === 'الكل' || normalizeStageSearch(s.stage).includes(normalizeStageSearch(stageFilter))
      const matchGroup = groupFilter === 'all' || s.group_name === groupFilter
      let matchStatus = true
      if (statusFilter === 'absent') matchStatus = s.attendance_status === 'غائب'
      else if (statusFilter === 'present') matchStatus = s.attendance_status === 'حاضر'
      else if (statusFilter === 'warning') matchStatus = checkAcademicWarning(examScoresByStudent[s.id] || [])
      else if (statusFilter === 'hw_missing') matchStatus = s.hw_status === 'لم يتم' || s.hw_status === 'ناقص'
      return matchSearch && matchStage && matchGroup && matchStatus
    })
  }, [students, deferredSearch, stageFilter, groupFilter, statusFilter, examScoresByStudent])

  const sessionStudents = useMemo(() => {
    if (!sessionGroup) return []
    // FIX (attendance not showing): when a lesson is actually open, the
    // per-lesson map is the source of truth (a new lesson correctly starts
    // every student unrecorded, even if they had an old status). But when
    // there is NO open lesson, setAttendance() saves straight onto the
    // student record (the day-fallback path) and never touches this map —
    // so falling back to 'لم يرصد' unconditionally made a successfully
    // saved mark disappear on this exact screen. Without an open lesson,
    // trust the student's own recorded status instead.
    return students.filter((s) => s.group_name === sessionGroup).map((s) => ({
      ...s,
      attendance_status: activeLessonId ? (lessonAttendanceByStudent[s.id]?.status || 'لم يرصد') : s.attendance_status,
      hw_status: activeLessonId ? (lessonAttendanceByStudent[s.id]?.homework_status || 'لم يرصد') : s.hw_status,
    }))
  }, [students, sessionGroup, lessonAttendanceByStudent, activeLessonId])

  const reportLessons = useMemo(() => lessonSessions.filter((lesson) => !reportGroup || lesson.group_name === reportGroup).sort((a, b) => new Date(b.session_date) - new Date(a.session_date) || new Date(b.started_at || b.created_at || 0) - new Date(a.started_at || a.created_at || 0)), [lessonSessions, reportGroup])
  const reportLesson = useMemo(() => lessonSessions.find((lesson) => lesson.id === reportLessonId) || null, [lessonSessions, reportLessonId])
  const reportLessonIsFinal = reportLesson?.status === 'completed'
  useEffect(() => {
    if (reportLessonId && reportLesson && reportLesson.status !== 'completed') setReportLessonId('')
  }, [reportLessonId, reportLesson])
  const reportStudents = useMemo(() => {
    if (!reportGroup) return []
    return students.filter((s) => s.group_name === reportGroup)
  }, [students, reportGroup])

  const selectedStudents = useMemo(() => students.filter((s) => selectedIds.has(s.id)), [students, selectedIds])
  const absenceSummary = useMemo(() => students.filter((s) => absenceStreaks[s.id]).map((s) => `${s.name} (${absenceStreaks[s.id]} ${t('times')})`).join('، '), [students, absenceStreaks, t])
  useEffect(() => {
    if (!sessionGroup) { setActiveLessonId(''); setLessonAttendanceByStudent({}); return }
    const candidates = lessonSessions.filter((lesson) => lesson.group_name === sessionGroup)
    const today = new Date().toISOString().slice(0, 10)
    const preferred = candidates.find((lesson) => lesson.status === 'open' && lesson.session_date === today) || candidates.find((lesson) => lesson.session_date === today)
    setActiveLessonId(preferred?.id || '')
  }, [sessionGroup, lessonSessions])

  useEffect(() => {
    let cancelled = false
    const loadLessonAttendance = async () => {
      if (!activeLessonId || !effectiveTeacherId) { setLessonAttendanceByStudent({}); return }
      const { data, error } = await supabase.from('attendance_records').select('student_id, status, homework_status, recorded_at').eq('teacher_id', effectiveTeacherId).eq('lesson_session_id', activeLessonId).order('recorded_at', { ascending: false })
      if (cancelled) return
      if (error) { console.warn('Lesson attendance query failed:', error.message); setLessonAttendanceByStudent({}); return }
      const map = {}
      ;(data || []).forEach((row) => { if (!map[row.student_id]) map[row.student_id] = row })
      setLessonAttendanceByStudent(map)
    }
    loadLessonAttendance()
    return () => { cancelled = true }
  }, [activeLessonId, effectiveTeacherId])

  // (Round 8) خريطة الحضور لرصد الامتحانات: الغايبين مبيظهروش في قائمة الرصد
  // ولا بياخدوا درجة عادية. المصدر: حضور الحصة النشطة (لو مفتوحة) وإلا آخر
  // حالة حضور مسجلة للطالب.
  const examAttendanceByStudent = useMemo(() => {
    const map = {}
    students.forEach((s) => {
      const lessonStatus = activeLessonId ? lessonAttendanceByStudent[s.id]?.status : undefined
      map[s.id] = lessonStatus || s.attendance_status
    })
    return map
  }, [students, activeLessonId, lessonAttendanceByStudent])

  const sessionAttendanceCounts = useMemo(() => sessionStudents.reduce((counts, student) => {
    if (student.attendance_status === 'حاضر') counts.present++
    if (student.attendance_status === 'غائب') counts.absent++
    return counts
  }, { present: 0, absent: 0 }), [sessionStudents])
  const guestStudents = useMemo(() => {
    const query = sessionGuestSearch.trim().toLowerCase()
    if (!query || !sessionGroup) return []
    return students.filter((s) => s.group_name !== sessionGroup && `${s.name} ${s.code || ''} ${s.phone || ''}`.toLowerCase().includes(query)).slice(0, 8)
  }, [students, sessionGroup, sessionGuestSearch])

  const stats = useMemo(() => {
    let present = 0, absent = 0, unrecorded = 0
    filteredStudents.forEach((s) => { if (s.attendance_status === 'حاضر') present++; else if (s.attendance_status === 'غائب') absent++; else unrecorded++ })
    let totalEarned = 0, totalMax = 0; const examDatesMap = {}
    filteredStudents.forEach((s) => { ;(examScoresByStudent[s.id] || []).forEach((ex) => { const mMax = ex.max_score_per_section * Object.keys(ex.section_scores || {}).length; totalEarned += ex.total_score; totalMax += mMax; const d = new Date(ex.created_at).toLocaleDateString('ar-EG'); if (!examDatesMap[d]) examDatesMap[d] = { earned: 0, max: 0 }; examDatesMap[d].earned += ex.total_score; examDatesMap[d].max += mMax }) })
    const avg = totalMax > 0 ? Math.round((totalEarned / totalMax) * 100) : 0
    return { present, absent, unrecorded, avg, examDatesMap }
  }, [filteredStudents, examScoresByStudent])

  // -------------------- Actions --------------------
  const patchStudent = (id, patch, actionMeta) => {
    const prevStudent = students.find((s) => s.id === id)
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    if (actionMeta && prevStudent) {
      pushAction({ type: actionMeta.type || 'edit', description: actionMeta.description || 'تعديل بيانات طالب', undoFn: async () => { if (!isOnline) return; const reverted = {}; for (const k of Object.keys(patch)) reverted[k] = prevStudent[k]; reverted.updated_at = new Date().toISOString(); await supabase.from('students').update(reverted).eq('id', id); setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, ...reverted } : s))) } })
    }
  }

  const logAction = async (studentId, note, pointsDelta = 0) => {
    const { data } = await supabase.from('behavior_logs').insert({ teacher_id: effectiveTeacherId, student_id: studentId, note, points_delta: pointsDelta }).select().single()
    if (data) setTodayLogsByStudent((prev) => ({ ...prev, [studentId]: [...(prev[studentId] || []), data] }))
  }

  // ═══════════════════════════════════════════════════
  // FIX #4 — AUTOSAVE: All Supabase calls are AWAITED
  // + per-student savingIds to prevent duplicates
  // + flashSaved() for visible "Saved" feedback
  // ═══════════════════════════════════════════════════

  const adjustPoints = async (id, amount, reason = 'تعديل يدوي') => {
    const s = students.find((x) => x.id === id); if (!s) return
    if (savingIds.has(id)) return
    setSavingIds((p) => new Set([...p, id]))
    const newPoints = s.points + amount
    const prevPoints = s.points
    try {
      if (!isOnline) {
        patchStudent(id, { points: newPoints }, { type: 'points', description: `${reason}: ${s.name}` })
        await addToQueue({ table: 'students', method: 'update', data: { points: newPoints, updated_at: new Date().toISOString() }, match: { id } })
        setSaveStatus('saved_locally')
      } else {
        patchStudent(id, { points: newPoints }, { type: 'points', description: `${reason}: ${s.name}` })
        // FIX (silent failures): check the update result — previously the error was ignored,
        // the UI kept the new points, and the undo snackbar claimed success even when
        // nothing was saved.
        const { error } = await supabase.from('students').update({ points: newPoints, updated_at: new Date().toISOString() }).eq('id', id)
        if (error) throw error
        await logAction(id, `${reason} (${amount > 0 ? '+' + amount : amount} نقطة)`, amount)
        flashSaved(id)
      }
      setUndoSnackbar({ visible: true, message: `${reason}: ${s.name}` })
    } catch (error) {
      // Roll back the optimistic points so the UI matches the database again.
      patchStudent(id, { points: prevPoints })
      showToast(isArabic ? `تعذر حفظ نقاط ${s.name}. حاول مرة أخرى.` : `Could not save points for ${s.name}. Please try again.`, 'error')
    } finally { setSavingIds((p) => { const n = new Set(p); n.delete(id); return n }) }
  }

  const setAttendance = async (id, status, lessonIdOverride) => {
    const s = students.find((x) => x.id === id); if (!s) return
    if (savingIds.has(id)) return
    // ── Target-lesson resolution (FIX: wrong-lesson routing) ──
    // Previously EVERY quick mark from the students list defaulted to whatever
    // lesson happened to be active — often ANOTHER group's lesson — so the save
    // either landed in the wrong lesson or failed while the UI kept showing it
    // as saved. Now:
    //   • an explicit override (الحصص page, QR scanner, group tools) is honored;
    //   • without an override the mark is routed to the student's OWN group
    //     lesson that is open TODAY, so quick marks from the students list show
    //     up inside الحصص and in the student portal;
    //   • when no such lesson exists it falls back to the day-record path.
    let lessonId = null
    if (lessonIdOverride !== undefined) {
      lessonId = lessonIdOverride || null
    } else {
      const today = new Date().toISOString().slice(0, 10)
      lessonId = lessonSessions.find((lesson) => lesson.group_name === s.group_name && lesson.session_date === today && lesson.status === 'open')?.id || null
    }
    const targetLesson = lessonId ? lessonSessions.find((lesson) => lesson.id === lessonId) : null
    if (lessonId && targetLesson?.status === 'completed') {
      showToast(isArabic ? 'الحصة دي منتهية بالفعل — افتح حصة جديدة عشان تسجل الحضور.' : 'This lesson is already completed — open a new lesson to record attendance.', 'error')
      return
    }
    // Idempotency guard: repeated clicks/scans for the same lesson/status do nothing.
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
    // FIX (stale السجل): the lesson path used to touch only `points`, so the
    // students list, dashboard stats, filters, and the portal kept showing an
    // old attendance_status forever. Keep the global student fields in sync
    // with the latest mark in BOTH paths.
    const studentPatch = { attendance_status: status, points: newPoints }
    try {
      if (!isOnline) {
        patchStudent(id, studentPatch, { type: 'attendance', description: `حضور ${s.name}: ${status}` })
        if (lessonId) {
          await addToQueue({ method: 'rpc', rpcName: 'upsert_lesson_attendance', rpcArgs: { p_lesson_session_id: lessonId, p_student_id: id, p_status: status } })
        } else {
          await addToQueue({ table: 'students', method: 'update', data: { attendance_status: status, points: newPoints, updated_at: new Date().toISOString() }, match: { id } })
          await addToQueue({ table: 'attendance_records', method: 'upsert', data: { teacher_id: effectiveTeacherId, student_id: id, status, homework_status: s.hw_status || 'لم يرصد' }, upsertOpts: { onConflict: 'teacher_id,student_id' } })
        }
        setSaveStatus('saved_locally')
      } else {
        // Optimistic update first (no undo meta here — one undo entry is pushed
        // below on success; previously both patchStudent and pushAction pushed
        // an entry, so a single click needed TWO undos).
        patchStudent(id, studentPatch)
        try {
          const { error: studentUpdateError } = await supabase.from('students').update({ ...studentPatch, updated_at: new Date().toISOString() }).eq('id', id)
          if (studentUpdateError) throw studentUpdateError
          if (lessonId) {
            // For a lesson, the backend RPC is the source of truth and performs an atomic upsert.
            const { data, error: attendanceError } = await supabase.rpc('upsert_lesson_attendance', { p_lesson_session_id: lessonId, p_student_id: id, p_status: status })
            if (attendanceError) throw attendanceError
            // Some RPC builds return void; keep the UI in sync regardless.
            setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data || { student_id: id, lesson_session_id: lessonId, status, homework_status: prev[id]?.homework_status || 'لم يرصد', recorded_at: new Date().toISOString() } }))
          } else {
            const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0); const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
            const { data: existingAttendance, error: attendanceLookupError } = await supabase.from('attendance_records').select('id').eq('teacher_id', effectiveTeacherId).eq('student_id', id).is('lesson_session_id', null).gte('recorded_at', dayStart.toISOString()).lt('recorded_at', dayEnd.toISOString()).order('recorded_at', { ascending: false }).limit(1).maybeSingle()
            if (attendanceLookupError) throw attendanceLookupError
            if (existingAttendance?.id) {
              const { error } = await supabase.from('attendance_records').update({ status, recorded_at: new Date().toISOString() }).eq('id', existingAttendance.id); if (error) throw error
              // FIX (double notifications): the on_attendance_recorded_notify
              // trigger already sends the parent notification for fresh INSERTs
              // (previously the app inserted its own copy too → duplicates).
              // A same-day status UPDATE does not fire the trigger, so the
              // notification is sent here and only here.
              const { error: notificationError } = await supabase.from('student_notifications').insert({ teacher_id: effectiveTeacherId, student_id: id, title: 'تحديث الحضور', body: `تم تحديث حضور الطالب ${s.name}: ${status}.`, category: 'attendance', deep_link: '/' })
              if (notificationError) console.warn('Attendance-change notification failed:', notificationError.message)
            } else {
              // Fresh insert — the DB trigger notifies the parent server-side.
              const { error } = await supabase.from('attendance_records').insert({ teacher_id: effectiveTeacherId, student_id: id, status }); if (error) throw error
            }
          }
          await logAction(id, `تسجيل الحضور: ${status}`, pointsDiff)
          flashSaved(id)
        } catch (error) {
          // FIX (silent failures): a failed save used to escape as an unhandled
          // rejection while the optimistic patch kept the UI looking saved —
          // the attendance then "vanished" on reload and the parent was never
          // notified. Roll the optimistic state back and say so.
          patchStudent(id, { attendance_status: prevState.attendance_status, points: prevState.points })
          console.error('Save attendance failed:', error)
          showToast(isArabic ? `تعذر حفظ حضور ${s.name} (${status}). حاول مرة تانية.` : `Could not save attendance for ${s.name} (${status}). Please try again.`, 'error')
          return
        }
      }
      pushAction({ type: 'attendance', description: `حضور ${s.name}: ${status}`, undoFn: async () => {
        if (lessonId) {
          const { data, error } = await supabase.rpc('upsert_lesson_attendance', { p_lesson_session_id: lessonId, p_student_id: id, p_status: previousAttendanceStatus })
          if (error) throw error
          if (data) setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data }))
        }
        const { error } = await supabase.from('students').update({ ...prevState, updated_at: new Date().toISOString() }).eq('id', id)
        if (error) throw error
        setStudents((prev) => prev.map((st) => (st.id === id ? { ...st, ...prevState } : st)))
      }, redoFn: async () => {
        if (lessonId) {
          const { data, error } = await supabase.rpc('upsert_lesson_attendance', { p_lesson_session_id: lessonId, p_student_id: id, p_status: status })
          if (error) throw error
          if (data) setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data }))
        }
        const { error } = await supabase.from('students').update({ attendance_status: status, points: newPoints, updated_at: new Date().toISOString() }).eq('id', id)
        if (error) throw error
        setStudents((prev) => prev.map((st) => (st.id === id ? { ...st, attendance_status: status, points: newPoints } : st)))
      } })
    } finally { setSavingIds((p) => { const n = new Set(p); n.delete(id); return n }) }
  }

  const updateHW = async (id, status, lessonIdOverride) => {
    const s = students.find((x) => x.id === id); if (!s) return
    if (savingIds.has(id)) return
    // ── Target-lesson resolution (FIX: wrong-lesson routing, mirrors setAttendance) ──
    // Quick homework marks from the students list previously defaulted to the
    // currently-active lesson (possibly another group's). Route to the student's
    // OWN group lesson open today instead; fall back to the student record.
    let lessonId = null
    if (lessonIdOverride !== undefined) {
      lessonId = lessonIdOverride || null
    } else {
      const today = new Date().toISOString().slice(0, 10)
      lessonId = lessonSessions.find((lesson) => lesson.group_name === s.group_name && lesson.session_date === today && lesson.status === 'open')?.id || null
    }
    const targetLesson = lessonId ? lessonSessions.find((lesson) => lesson.id === lessonId) : null
    if (lessonId && targetLesson?.status === 'completed') {
      showToast(isArabic ? 'الحصة دي منتهية بالفعل — افتح حصة جديدة عشان تسجل الواجب.' : 'This lesson is already completed — open a new lesson to record homework.', 'error')
      return
    }
    setSavingIds((p) => new Set([...p, id]))
    const prevStatus = lessonId ? (lessonAttendanceByStudent[id]?.homework_status || 'لم يرصد') : (s.hw_status || 'لم يرصد')
    // FIX (stale السجل): keep students.hw_status in sync in the lesson path too
    // so the students list and the portal always show the latest homework state.
    const studentPatch = { hw_status: status }
    try {
      if (!isOnline) {
        patchStudent(id, studentPatch, { type: 'homework', description: `واجب ${s.name}: ${status}` })
        await addToQueue({ table: 'students', method: 'update', data: { hw_status: status, updated_at: new Date().toISOString() }, match: { id } })
        if (lessonId) await addToQueue({ method: 'rpc', rpcName: 'upsert_lesson_homework', rpcArgs: { p_lesson_session_id: lessonId, p_student_id: id, p_homework_status: status } })
        setSaveStatus('saved_locally')
      } else {
        // Optimistic update (single undo entry is pushed on success below).
        patchStudent(id, studentPatch)
        try {
          const { error: studentUpdateError } = await supabase.from('students').update({ hw_status: status, updated_at: new Date().toISOString() }).eq('id', id)
          if (studentUpdateError) throw studentUpdateError
          if (lessonId) {
            const { data: savedRow, error: homeworkError } = await supabase.rpc('upsert_lesson_homework', { p_lesson_session_id: lessonId, p_student_id: id, p_homework_status: status })
            if (homeworkError) throw homeworkError
            // Some RPC builds return void; keep the UI in sync regardless.
            setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: savedRow || { ...(prev[id] || {}), student_id: id, lesson_session_id: lessonId, homework_status: status, status: prev[id]?.status || 'لم يرصد', recorded_at: new Date().toISOString() } }))
            // Lesson homework is delivered with the single final notification after save-and-finish.
          }
          await logAction(id, `تقييم الواجب: ${status}`)
          flashSaved(id)
        } catch (error) {
          // FIX (silent failures): roll the optimistic state back and surface the
          // error instead of losing the mark while the UI claims it is saved.
          patchStudent(id, { hw_status: prevStatus })
          console.error('Save homework failed:', error)
          showToast(isArabic ? `تعذر حفظ واجب ${s.name} (${status}). حاول مرة تانية.` : `Could not save homework for ${s.name} (${status}). Please try again.`, 'error')
          return
        }
      }
      pushAction({ type: 'homework', description: `واجب ${s.name}: ${status}`, undoFn: async () => {
        if (lessonId) {
          const { data, error } = await supabase.rpc('upsert_lesson_homework', { p_lesson_session_id: lessonId, p_student_id: id, p_homework_status: prevStatus })
          if (error) throw error
          if (data) setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data }))
        }
        const { error } = await supabase.from('students').update({ hw_status: prevStatus, updated_at: new Date().toISOString() }).eq('id', id)
        if (error) throw error
        setStudents((prev) => prev.map((st) => (st.id === id ? { ...st, hw_status: prevStatus } : st)))
      }, redoFn: async () => {
        if (lessonId) {
          const { data, error } = await supabase.rpc('upsert_lesson_homework', { p_lesson_session_id: lessonId, p_student_id: id, p_homework_status: status })
          if (error) throw error
          if (data) setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data }))
        }
        const { error } = await supabase.from('students').update({ hw_status: status, updated_at: new Date().toISOString() }).eq('id', id)
        if (error) throw error
        setStudents((prev) => prev.map((st) => (st.id === id ? { ...st, hw_status: status } : st)))
      } })
    } finally { setSavingIds((p) => { const n = new Set(p); n.delete(id); return n }) }
  }

  const removeWarning = async (id) => {
    const s = students.find((x) => x.id === id); if (!s || !(s.warnings > 0)) return
    if (savingIds.has(id)) return
    setSavingIds((p) => new Set([...p, id]))
    const nextWarnings = Math.max(0, (s.warnings || 0) - 1)
    try {
      patchStudent(id, { warnings: nextWarnings }, { type: 'warning_remove', description: `إزالة إنذار: ${s.name}` })
      if (!isOnline) await addToQueue({ table: 'students', method: 'update', data: { warnings: nextWarnings, updated_at: new Date().toISOString() }, match: { id } })
      else { const { error } = await supabase.from('students').update({ warnings: nextWarnings, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; await logAction(id, `تمت إزالة إنذار. المتبقي: ${nextWarnings}`) }
      flashSaved(id); showToast(isArabic ? 'تمت إزالة إنذار' : 'Warning removed', 'success')
    } catch { showToast(isArabic ? 'فشل إزالة الإنذار' : 'Could not remove warning', 'error') }
    finally { setSavingIds((p) => { const n = new Set(p); n.delete(id); return n }) }
  }

  const editPoints = async (id) => {
    const s = students.find((x) => x.id === id); if (!s) return
    const value = window.prompt(isArabic ? `النقاط الحالية: ${s.points}\nاكتب النقاط الجديدة:` : `Current points: ${s.points}\nEnter new points:` , String(s.points))
    if (value === null || value.trim() === '') return
    const next = Number(value)
    if (!Number.isFinite(next) || next < 0) { showToast(isArabic ? 'أدخل عدد نقاط صحيح' : 'Enter a valid points number', 'error'); return }
    await adjustPoints(id, Math.round(next) - Number(s.points || 0), 'تعديل يدوي للنقاط')
  }

  const addWarning = async (id) => {
    const s = students.find((x) => x.id === id); if (!s) return
    if (savingIds.has(id)) return
    setSavingIds((p) => new Set([...p, id]))
    const nextWarnings = (s.warnings || 0) + 1
    const newPoints = s.points - 5
    const prevVals = { warnings: s.warnings || 0, points: s.points }
    try {
      if (!isOnline) {
        patchStudent(id, { warnings: nextWarnings, points: newPoints }, { type: 'warning', description: `إنذار ${s.name}: رقم ${nextWarnings}` })
        await addToQueue({ table: 'students', method: 'update', data: { warnings: nextWarnings, points: newPoints, updated_at: new Date().toISOString() }, match: { id } })
        setSaveStatus('saved_locally')
      } else {
        patchStudent(id, { warnings: nextWarnings, points: newPoints }, { type: 'warning', description: `إنذار ${s.name}: رقم ${nextWarnings}` })
        // ★ FIX: AWAIT the Supabase call
        await supabase.from('students').update({ warnings: nextWarnings, points: newPoints, updated_at: new Date().toISOString() }).eq('id', id)
        await logAction(id, `تم تسجيل إنذار سلوكي (رقم ${nextWarnings}) (-5 نقطة)`, -5)
        flashSaved(id) // visible feedback
      }
      pushAction({ type: 'warning', description: `إنذار ${s.name}: رقم ${nextWarnings}`, undoFn: async () => { const { error } = await supabase.from('students').update({ ...prevVals, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; setStudents((prev) => prev.map((st) => (st.id === id ? { ...st, ...prevVals } : st))) }, redoFn: async () => { const { error } = await supabase.from('students').update({ warnings: nextWarnings, points: newPoints, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; setStudents((prev) => prev.map((st) => (st.id === id ? { ...st, warnings: nextWarnings, points: newPoints } : st))) } })
    } finally { setSavingIds((p) => { const n = new Set(p); n.delete(id); return n }) }
  }

  // ═══════════════════════════════════════════════════
  // END AUTOSAVE FIX
  // ═══════════════════════════════════════════════════

  const markAllPresent = async () => { const targetStudents = activeLessonId ? sessionStudents : filteredStudents; for (const s of targetStudents) { if ((activeLessonId ? lessonAttendanceByStudent[s.id]?.status : s.attendance_status) !== 'حاضر') await setAttendance(s.id, 'حاضر', activeLessonId) } }
  const toggleSelect = (id, index, withRange = false) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (withRange && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, index); const end = Math.max(lastSelectedIndex, index)
        filteredStudents.slice(start, end + 1).forEach((s) => next.add(s.id))
      } else if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setLastSelectedIndex(index)
  }
  const clearSelection = () => { setSelectedIds(new Set()); setLastSelectedIndex(null) }
  const toggleSelectAllFiltered = () => { setSelectedIds((prev) => { const allSelected = filteredStudents.length > 0 && filteredStudents.every((s) => prev.has(s.id)); if (allSelected) return new Set(); return new Set(filteredStudents.map((s) => s.id)) }) }
  const bulkSetAttendance = (status) => { selectedStudents.forEach((s) => setAttendance(s.id, status)) }
  const bulkAdjustPoints = (amount, reason) => { selectedStudents.forEach((s) => adjustPoints(s.id, amount, reason)) }
  const bulkMessage = () => {
    if (selectedStudents.length === 0) return
    const text = prompt(isArabic ? 'نص الرسالة للمحددين:' : 'Message for selected:', settings.msg_welcome)
    if (!text || !text.trim()) return
    const queueStudents = selectedStudents.filter((s) => isValidPhone(s.phone))
    const skippedCount = selectedStudents.length - queueStudents.length
    if (skippedCount > 0) showToast(isArabic ? `تم تخطي ${skippedCount} طالبًا لرقم غير صالح` : `Skipped ${skippedCount} student(s) with an invalid phone`, 'info')
    if (queueStudents.length === 0) { showToast(t('no_phone'), 'error'); return }
    const items = queueStudents.map((s) => ({ student: s, phone: s.phone, message: parseTemplate(text.trim(), s, ranks) }))
    updateQueue({ open: true, items, index: 0 })
  }

  const assignSelectedToGroup = async () => {
    const targetGroup = bulkGroupName.trim()
    if (!targetGroup || selectedStudents.length === 0) return
    const previous = selectedStudents.map((s) => ({ id: s.id, group_name: s.group_name || '' }))
    setIsSaving(true)
    try {
      const { error } = await supabase.from('students').update({ group_name: targetGroup, updated_at: new Date().toISOString() }).in('id', selectedStudents.map((s) => s.id)).eq('teacher_id', effectiveTeacherId)
      if (error) throw error
      setStudents((prev) => prev.map((s) => selectedIds.has(s.id) ? { ...s, group_name: targetGroup } : s))
      pushAction({
        type: 'bulk_group_assign',
        description: `${selectedStudents.length} طالب إلى ${targetGroup}`,
        undoFn: async () => {
          for (const p of previous) {
            const { error: undoError } = await supabase.from('students').update({ group_name: p.group_name, updated_at: new Date().toISOString() }).eq('id', p.id).eq('teacher_id', effectiveTeacherId)
            if (undoError) throw undoError
          }
          setStudents((prev) => prev.map((s) => { const p = previous.find((x) => x.id === s.id); return p ? { ...s, group_name: p.group_name } : s }))
        },
        redoFn: async () => {
          const { error: redoError } = await supabase.from('students').update({ group_name: targetGroup, updated_at: new Date().toISOString() }).in('id', previous.map((p) => p.id)).eq('teacher_id', effectiveTeacherId)
          if (redoError) throw redoError
          setStudents((prev) => prev.map((s) => selectedIds.has(s.id) ? { ...s, group_name: targetGroup } : s))
        },
      })
      clearSelection(); setBulkGroupName(''); setBulkGroupOpen(false)
      showToast(isArabic ? `تم نقل ${previous.length} طالب إلى ${targetGroup}` : `Assigned ${previous.length} students to ${targetGroup}`, 'success')
    } catch (error) {
      showToast(isArabic ? `فشل نقل الطلاب: ${error.message || ''}` : `Could not assign students: ${error.message || ''}`, 'error')
    } finally { setIsSaving(false) }
  }

  const openLessonForGroup = async (groupName, { silent = false, forceNew = false } = {}) => {
    if (!groupName || !effectiveTeacherId) return null
    const today = new Date().toISOString().slice(0, 10)
    const existingOpen = lessonSessions.find((lesson) => lesson.group_name === groupName && lesson.session_date === today && lesson.status === 'open')
    if (existingOpen) {
      setSessionGroup(groupName); setActiveLessonId(existingOpen.id); return existingOpen
    }
    // FIX (ghost lessons): selecting a group whose lesson for today is already
    // completed used to silently create a SECOND, empty, open lesson. That stub
    // hid the saved attendance/topic everywhere ("my data disappeared"), stayed
    // open forever, blocked final notifications, and the student portal showed
    // it as the current lesson. Show the completed lesson instead — a new one
    // is only created deliberately via "فتح حصة جديدة" (forceNew).
    if (!forceNew) {
      const existingToday = lessonSessions.find((lesson) => lesson.group_name === groupName && lesson.session_date === today)
      if (existingToday) {
        setSessionGroup(groupName); setActiveLessonId(existingToday.id)
        if (!silent) showToast(isArabic ? 'حصة النهارده محفوظة ومنتهية بالفعل — بياناتها ظاهرة دلوقتي. لو محتاج حصة تانية اضغط «فتح حصة جديدة».' : 'Today\'s lesson is already saved and completed — its data is shown now. Use "Open new lesson" if you need another one.', 'info')
        return existingToday
      }
    }
    const meta = groupMeta[groupName] || {}
    const { data, error } = await supabase.from('lesson_sessions').insert({ teacher_id: effectiveTeacherId, group_name: groupName, stage: meta.stage || null, session_date: today, status: 'open', lesson_topic: '', homework_text: '', video_link: '' }).select().single()
    if (error || !data) { showToast(isArabic ? 'لم نقدر نفتح الحصة. تأكد من اتصال الإنترنت.' : 'Could not open the lesson. Check your connection.', 'error'); return null }
    setLessonSessions((prev) => [data, ...prev]); setSessionGroup(groupName); setActiveLessonId(data.id); setLessonAttendanceByStudent({}); setSessionDraft({ lesson_topic: '', homework_text: '', video_link: '' }); setSessionDraftOriginal({ lesson_topic: '', homework_text: '', video_link: '' }); setSessionHasChanges(false)
    if (!silent) showToast(isArabic ? 'اتفتحت الحصة. سجّل الحضور واكتب الدرس والواجب ثم اضغط إنهاء الحصة.' : 'Lesson opened. Record attendance, add the lesson and homework, then finish.', 'success')
    return data
  }

  const chooseSessionGroup = (groupName) => { setSessionGroup(groupName); if (groupName) openLessonForGroup(groupName, { silent: true }) }

  const startNewLesson = async () => {
    if (!sessionGroup) { showToast(isArabic ? 'اختار المجموعة أولاً' : 'Choose a group first', 'error'); return }
    const groupStudents = students.filter((s) => s.group_name === sessionGroup)
    if (groupStudents.length === 0) { showToast(isArabic ? 'لا يوجد طلاب في المجموعة المحددة' : 'No students in the selected group', 'error'); return }
    const ok = await askConfirm(isArabic ? `فتح حصة جديدة لمجموعة ${sessionGroup}؟` : `Open a new lesson for ${sessionGroup}?`, { title: isArabic ? 'فتح الحصة' : 'Open lesson', confirmLabel: isArabic ? 'فتح الحصة' : 'Open lesson' })
    if (!ok) return
    await openLessonForGroup(sessionGroup, { forceNew: true })
  }

  const validateLessonState = async (lessonId) => {
    const validAttendance = new Set(['حاضر', 'غائب', 'لم يرصد'])
    const localRows = Object.values(lessonAttendanceByStudent).filter(Boolean)
    const localInvalid = localRows.find((row) => !validAttendance.has(row.status))
    if (localInvalid) throw new Error(isArabic ? 'تم اكتشاف حالة حضور غير صحيحة. راجع الطالب قبل الحفظ.' : 'An invalid attendance state was detected. Review the student before saving.')
    if (!isOnline) return { rows: localRows }
    const { data: rows, error } = await supabase.from('attendance_records').select('student_id, status, homework_status, recorded_at, lesson_session_id').eq('teacher_id', effectiveTeacherId).eq('lesson_session_id', lessonId).order('recorded_at', { ascending: false }).limit(5000)
    if (error) throw error
    const seen = new Set()
    const duplicate = (rows || []).find((row) => { if (seen.has(row.student_id)) return true; seen.add(row.student_id); return false })
    if (duplicate) throw new Error(isArabic ? 'تم اكتشاف أكثر من سجل لنفس الطالب داخل الحصة. لم يتم إنهاء الحصة.' : 'Duplicate attendance rows were detected. The lesson was not finalized.')
    const invalid = (rows || []).find((row) => !validAttendance.has(row.status))
    if (invalid) throw new Error(isArabic ? 'تم اكتشاف حالة حضور غير صحيحة. لم يتم إنهاء الحصة.' : 'An invalid attendance state was detected. The lesson was not finalized.')
    return { rows: rows || [] }
  }

  const finishLesson = async () => {
    if (!activeLessonId || !activeLesson) { showToast(isArabic ? 'اختار المجموعة لفتح الحصة تلقائيًا' : 'Choose a group to open its lesson', 'error'); return }
    if (activeLesson.status === 'completed') { showToast(isArabic ? 'الحصة دي منتهية بالفعل' : 'This lesson is already completed', 'info'); return }
    setLessonSaveStatus('saving')
    const saved = await saveSessionLogWithUndo()
    if (saved === false) return
    try {
      // Self-check before finalization. Unrecorded students are intentionally not written here;
      // the database finalizer is the only place that converts them to absent.
      await validateLessonState(activeLessonId)
      if (!isOnline) {
        await addToQueue({ method: 'rpc', rpcName: 'finalize_lesson_session', rpcArgs: { p_lesson_session_id: activeLessonId } })
        const endedAt = new Date().toISOString()
        setLessonSessions((prev) => prev.map((lesson) => lesson.id === activeLessonId ? { ...lesson, status: 'completed', ended_at: endedAt, updated_at: endedAt } : lesson))
        setLessonSaveStatus('finalized')
        showToast(isArabic ? 'تم حفظ البيانات وتجهيز إنهاء الحصة للمزامنة عند عودة الاتصال.' : 'Lesson data saved and finalization queued until you are back online.', 'info')
        return
      }
      const { data: finalizeResult, error: finalizeError } = await supabase.rpc('finalize_lesson_session', { p_lesson_session_id: activeLessonId })
      if (finalizeError) throw finalizeError
      const endedAt = new Date().toISOString()
      const finalizedLesson = { ...activeLesson, status: 'completed', ended_at: endedAt, updated_at: endedAt }
      setLessonSessions((prev) => prev.map((lesson) => lesson.id === activeLessonId ? finalizedLesson : lesson))
      const { data: finalRows, error: rowsError } = await supabase.from('attendance_records').select('student_id, status, homework_status, recorded_at, lesson_session_id').eq('teacher_id', effectiveTeacherId).eq('lesson_session_id', activeLessonId).order('recorded_at', { ascending: false }).limit(5000)
      if (rowsError) throw rowsError
      const finalMap = (finalRows || []).reduce((map, row) => { if (!map[row.student_id] || new Date(row.recorded_at) > new Date(map[row.student_id].recorded_at)) map[row.student_id] = row; return map }, {})
      const missingFinalState = sessionStudents.some((student) => !finalMap[student.id] || !['حاضر', 'غائب'].includes(finalMap[student.id].status))
      if (missingFinalState) throw new Error(isArabic ? 'لم يكتمل سجل الحضور لكل طلاب المجموعة. لم يتم إرسال التحديث.' : 'The final attendance state is incomplete. The portal update was not sent.')
      setLessonAttendanceByStudent(finalMap)
      const notifications = sessionStudents.map((student) => {
        const finalState = finalMap[student.id]
        const finalAttendance = finalState?.status || 'لم يرصد'
        const finalHomework = finalState?.homework_status || 'لم يرصد'
        return { teacher_id: effectiveTeacherId, student_id: student.id, title: 'تحديث الحصة النهائي', body: `تم حفظ وإنهاء حصة ${finalizedLesson.group_name}. الحالة النهائية: ${finalAttendance}. الواجب: ${finalHomework}. ${finalizedLesson.lesson_topic ? `الدرس: ${finalizedLesson.lesson_topic}. ` : ''}${finalizedLesson.homework_text ? `تفاصيل الواجب: ${finalizedLesson.homework_text}` : 'لا يوجد واجب مسجل.'}`.trim(), category: 'attendance', deep_link: '/' }
      })
      if (notifications.length) { const { error: notificationError } = await supabase.from('student_notifications').insert(notifications); if (notificationError) throw notificationError }
      setLessonSaveStatus('finalized')
      const summary = finalizeResult?.present_count !== undefined ? ` حاضر: ${finalizeResult.present_count} · غائب: ${finalizeResult.absent_count}` : ''
      showToast(isArabic ? `تم حفظ البيانات وإنهاء الحصة وتسجيلها في السجل.${summary}` : `Lesson data saved, finalized, and logged.${summary}`, 'success')
    } catch (error) {
      setLessonSaveStatus('error')
      showToast(isArabic ? `لم يتم إنهاء الحصة: ${error.message || 'راجع البيانات وحاول مرة أخرى'}` : `Lesson was not finalized: ${error.message || 'Review the data and try again'}`, 'error')
    }
  }
  // Always-forwarding ref so the Ctrl+S shortcut uses the latest finishLesson
  // (and the freshest sessionDraft) instead of a stale snapshot.
  finishLessonRef.current = finishLesson

  const markSelectedGroupAbsences = async () => {
    if (!sessionGroup) return
    const pending = students.filter((s) => {
      const status = lessonAttendanceByStudent[s.id]?.status
      return s.group_name === sessionGroup && (!status || status === 'لم يرصد')
    })
    if (!pending.length) { showToast(isArabic ? 'لا يوجد طالب غير مرصود في هذه المجموعة' : 'No unrecorded students in this group', 'info'); return }
    const ok = await askConfirm(isArabic ? `سيتم تسجيل غياب ${pending.length} طالبًا من مجموعة ${sessionGroup} فقط. أي طالب حضر مع مجموعة أخرى لن يتأثر.` : `Mark ${pending.length} unrecorded students absent in ${sessionGroup} only? Students attending another group will not be affected.`, { title: isArabic ? 'تسجيل غياب المجموعة' : 'Mark group absences', danger: true, confirmLabel: isArabic ? 'تسجيل الغياب' : 'Mark absent' })
    if (!ok) return
    for (const s of pending) await setAttendance(s.id, 'غائب', activeLessonId)
    showToast(isArabic ? `تم تسجيل غياب ${pending.length} طالبًا من المجموعة فقط` : `Marked ${pending.length} students absent in this group only`, 'success')
  }

  const markGuestPresent = async (studentId) => {
    await setAttendance(studentId, 'حاضر', activeLessonId)
    showToast(isArabic ? 'تم تسجيل الطالب حاضرًا مع هذه المجموعة' : 'Student marked present with this group', 'success')
  }

  const saveStudent = async (form) => {
    if (isSaving) return
    const cleanName = String(form?.name || '').trim()
    if (!cleanName) { showToast(isArabic ? 'اكتب اسم الطالب أولاً' : 'Enter the student name first', 'error'); return }
    if (!effectiveTeacherId) { showToast(isArabic ? 'لم يتم تحميل حساب المدرس بعد، أعد المحاولة' : 'Teacher account is still loading; please try again', 'error'); return }
    setIsSaving(true)
    try {
      if (studentModal.student) {
        const id = studentModal.student.id; const prev = students.find((s) => s.id === id)
        if (!isOnline) {
          patchStudent(id, { name: form.name, phone: form.phone, stage: form.stage, group_name: form.group }, { type: 'student_update', description: `تعديل: ${form.name}` })
          await addToQueue({ table: 'students', method: 'update', data: { name: form.name, phone: form.phone, stage: form.stage, group_name: form.group, updated_at: new Date().toISOString() }, match: { id } })
          showToast(t('saved_locally_toast'), 'info')
        } else {
          patchStudent(id, { name: form.name, phone: form.phone, stage: form.stage, group_name: form.group }, { type: 'student_update', description: `تعديل: ${form.name}` })
          const { error } = await supabase.from('students').update({ name: form.name, phone: form.phone, stage: form.stage, group_name: form.group, updated_at: new Date().toISOString() }).eq('id', id)
          if (error) throw error
          pushAction({ type: 'student_update', description: `تعديل: ${form.name}`, undoFn: async () => { if (!prev) return; await supabase.from('students').update({ name: prev.name, phone: prev.phone, stage: prev.stage, group_name: prev.group_name, updated_at: new Date().toISOString() }).eq('id', id); setStudents((p) => p.map((s) => (s.id === id ? prev : s))) } })
          setUndoSnackbar({ visible: true, message: `${t('data_loaded')} ${form.name}` })
        }
        showToast(t('data_loaded'), 'success')
      } else {
        const normalizedName = cleanName.toLowerCase()
        const possibleDupe = students.find((s) => { const sameName = s.name.trim().toLowerCase() === normalizedName; const samePhone = form.phone && s.phone && s.phone === form.phone; return sameName || samePhone })
        if (possibleDupe) {
          const reason = possibleDupe.name.trim().toLowerCase() === normalizedName ? t('same_name') : t('same_phone')
          const proceed = await askConfirm(`${t('duplicate_student')} (${reason}: ${possibleDupe.name}).`, { title: t('duplicate_student'), confirmLabel: t('add_anyway') })
          if (!proceed) { setIsSaving(false); return }
        }
        const payload = { teacher_id: effectiveTeacherId, code: generateStudentCode(), name: cleanName, phone: String(form.phone || '').trim(), stage: form.stage || null, group_name: form.group || null, points: 0, warnings: 0, attendance_status: 'لم يرصد', hw_status: 'لم يرصد' }
        if (!isOnline) {
          // FIX (offline add): append an optimistic row with a temporary id so the
          // student actually appears in the list while offline. Previously nothing
          // was shown, so the teacher would typically re-add the same student and
          // both queued rows would insert on sync (duplicates).
          const optimisticId = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          setStudents((prev) => [...prev, { id: optimisticId, ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _pendingSync: true }])
          await addToQueue({ table: 'students', method: 'insert', data: payload })
          showToast(t('saved_locally_sync'), 'info')
          setStudentModal({ open: false, student: null })
          setIsSaving(false)
          return
        }
        const { data, error } = await supabase.from('students').insert(payload).select().single()
        if (error) throw error
        if (data) { setStudents((prev) => [...prev, data]); showToast(`${t('student_added')} ${data.name}`, 'success'); if (data.phone) setPendingQRStudent(data) }
      }
      setStudentModal({ open: false, student: null })
    } catch (err) {
      console.error('Save student error:', err)
      const detail = String(err?.message || '').trim()
      const safeDetail = detail && !/stack|supabase|postgres|permission denied|row-level security/i.test(detail) ? `: ${detail}` : ''
      showToast(`${t('save_failed_toast')}${safeDetail}`, 'error')
    }
    finally { setIsSaving(false) }
  }

  const deleteStudent = async (id) => {
    const student = students.find((s) => s.id === id)
    const ok = await askConfirm(`${t('delete_student_confirm')}${student?.name}${t('delete_student_confirm_suffix')}`, { title: t('delete_student_title'), danger: true, confirmLabel: t('delete_permanently') })
    if (!ok) return
    const backup = { ...student }
    setStudents((prev) => prev.filter((s) => s.id !== id))
    if (!isOnline) { await addToQueue({ table: 'students', method: 'delete', match: { id } }); showToast(t('saved_locally_toast'), 'info') }
    else {
      // FIX (silent failures): check the delete result. Previously the error was
      // ignored — the student vanished from the UI but reappeared on reload, and
      // the undo action would insert a duplicate row.
      const { error: deleteError } = await supabase.from('students').delete().eq('id', id)
      if (deleteError) {
        setStudents((prev) => [student, ...prev].filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i))
        showToast(isArabic ? `تعذر حذف ${backup.name}. حاول مرة أخرى.` : `Could not delete ${backup.name}. Please try again.`, 'error')
        return
      }
      pushAction({ type: 'student_delete', description: `حذف: ${backup.name}`, undoFn: async () => { const { data } = await supabase.from('students').insert({ ...backup }).select().single(); if (data) setStudents((prev) => [...prev, data]) } })
      setUndoSnackbar({ visible: true, message: `${t('student_deleted')} ${backup.name}` })
    }
    showToast(t('student_deleted'), 'success')
  }

  // FIX (silent failures): keep the modal open and report the error when the
  // settings update fails — previously it closed silently and the teacher believed
  // points values / templates were saved.
  const saveSettings = async (patch) => {
    const result = await updateSettings(patch)
    if (result?.error) { showToast(isArabic ? `تعذر حفظ الإعدادات: ${result.error.message || ''}` : `Could not save settings: ${result.error?.message || ''}`, 'error'); return }
    setSettingsOpen(false)
  }
  const addGroupFromLessons = async (e) => {
    e.preventDefault()
    const name = newGroupForm.name.trim()
    if (!name || !newGroupForm.stage || newGroupForm.day === '' || !newGroupForm.time) { showToast(isArabic ? 'أدخل اسم المجموعة والمرحلة واليوم والميعاد' : 'Enter group name, stage, day, and time', 'error'); return }
    if (groups.includes(name)) { showToast(isArabic ? 'المجموعة موجودة بالفعل' : 'Group already exists', 'error'); return }
    const previousSettings = { groups: [...groups], group_meta: { ...groupMeta } }
    const nextSettings = { groups: [...groups, name], group_meta: { ...groupMeta, [name]: { stage: newGroupForm.stage, day: Number(newGroupForm.day), time: newGroupForm.time } } }
    const settingsResult = await updateSettings(nextSettings)
    if (settingsResult?.error) { showToast(`${isArabic ? 'فشل حفظ المجموعة: ' : 'Could not save group: '}${settingsResult.error.message || ''}`, 'error'); return }
    const { data: scheduleRow, error: scheduleError } = await supabase.from('group_schedule').insert({ teacher_id: effectiveTeacherId, group_name: name, weekday: Number(newGroupForm.day), lesson_time: newGroupForm.time }).select('id, group_name, weekday, lesson_time').single()
    if (scheduleError || !scheduleRow) {
      await updateSettings(previousSettings)
      showToast(isArabic ? 'فشل حفظ موعد المجموعة، تم التراجع عن الإضافة' : 'Could not save the schedule; group addition was rolled back', 'error')
      return
    }
    await loadAll()
    setSessionGroup(name)
    setNewGroupForm({ name: '', stage: '', day: '', time: '' })
    setGroupModalOpen(false)
    showToast(isArabic ? 'تمت إضافة المجموعة وحفظ موعدها' : 'Group and schedule saved', 'success')
  }
  const openGroupEditor = (groupName) => {
    const meta = groupMeta[groupName] || {}
    setEditGroupForm({ original: groupName, stage: meta.stage || '', day: meta.day ?? '', time: meta.time || '' })
    setEditGroupOpen(true)
  }

  const saveGroupEdit = async (event) => {
    event?.preventDefault()
    const { original, stage, day, time } = editGroupForm
    if (!original || !stage || day === '' || !time) { showToast(isArabic ? 'أكمل بيانات المجموعة' : 'Complete the group details', 'error'); return }
    const nextMeta = { ...groupMeta, [original]: { stage, day: Number(day), time } }
    try {
      const settingsResult = await updateSettings({ group_meta: nextMeta })
      if (!settingsResult?.ok) throw new Error(settingsResult?.error?.message || 'group_meta_save_failed')
      const { error } = await supabase.from('group_schedule').upsert({ teacher_id: effectiveTeacherId, group_name: original, weekday: Number(day), lesson_time: time }, { onConflict: 'teacher_id,group_name,weekday' })
      if (error) throw error
      setEditGroupOpen(false)
      showToast(isArabic ? 'تم تحديث المجموعة والميعاد' : 'Group schedule updated', 'success')
    } catch (error) {
      showToast(isArabic ? `تعذر تحديث المجموعة: ${error.message || ''}` : `Could not update group: ${error.message || ''}`, 'error')
    }
  }

  const deleteGroupFromLessons = async (groupName) => {
    const ok = await askConfirm(isArabic ? `سيتم حذف المجموعة ${groupName} من قائمة الحصص فقط، ولن يتم حذف الطلاب أو سجلاتهم.` : `Remove ${groupName} from Lessons only? Students and their records will not be deleted.`, { title: isArabic ? 'حذف المجموعة؟' : 'Delete group?', danger: true, confirmLabel: isArabic ? 'حذف المجموعة' : 'Delete group' })
    if (!ok) return
    const previousSettings = { groups: [...groups], group_meta: { ...groupMeta } }
    const nextMeta = { ...groupMeta }; delete nextMeta[groupName]
    const settingsResult = await updateSettings({ groups: groups.filter((g) => g !== groupName), group_meta: nextMeta })
    if (settingsResult?.error) { showToast(isArabic ? 'فشل حذف المجموعة من الإعدادات' : 'Could not remove the group from settings', 'error'); return }
    const { error: scheduleError } = await supabase.from('group_schedule').delete().eq('teacher_id', effectiveTeacherId).eq('group_name', groupName)
    if (scheduleError) {
      await updateSettings(previousSettings)
      showToast(isArabic ? 'فشل حذف موعد المجموعة، تم التراجع عن الحذف' : 'Could not delete the schedule; deletion was rolled back', 'error')
      return
    }
    if (sessionGroup === groupName) setSessionGroup('')
    await loadAll()
    showToast(isArabic ? 'تم حذف المجموعة فعليًا من الحصص' : 'Group was actually removed from Lessons', 'success')
  }
  const saveTemplates = async (patch) => {
    const result = await updateSettings(patch)
    if (result?.error) { showToast(isArabic ? `تعذر حفظ القوالب: ${result.error.message || ''}` : `Could not save templates: ${result.error?.message || ''}`, 'error'); return }
    setTemplatesOpen(false)
  }
  const resetAllData = async () => { await supabase.from('exams').delete().eq('teacher_id', effectiveTeacherId); await supabase.from('students').delete().eq('teacher_id', effectiveTeacherId); setSettingsOpen(false); loadAll() }

  const saveExam = async ({ title, sections, maxScorePerSection, records }) => {
    if (isSaving) return; setIsSaving(true)
    try {
      if (!isOnline) { showToast(t('no_internet_exam'), 'error'); setIsSaving(false); return }
      const { data: exam, error: examErr } = await supabase.from('exams').insert({ teacher_id: effectiveTeacherId, title, sections, max_score_per_section: maxScorePerSection, lesson_session_id: activeLessonId || null }).select().single()
      if (examErr) throw examErr; if (!exam) return
      const passingMark = (maxScorePerSection * sections.length) / 2; const studentPointDiffs = {}
      for (const r of records) {
        // FIX (silent failures): check per-record insert/update results — previously
        // errors were ignored and points could be awarded with no score rows saved.
        const { error: scoreError } = await supabase.from('exam_scores').insert({ teacher_id: effectiveTeacherId, exam_id: exam.id, student_id: r.studentId, lesson_session_id: activeLessonId || null, section_scores: r.sectionScores, total_score: r.total })
        if (scoreError) throw scoreError
        const s = students.find((x) => x.id === r.studentId); const pointDiff = Math.round(r.total - passingMark); studentPointDiffs[r.studentId] = (studentPointDiffs[r.studentId] || 0) + pointDiff
        if (s) {
          const { error: pointsError } = await supabase.from('students').update({ points: s.points + pointDiff, updated_at: new Date().toISOString() }).eq('id', r.studentId)
          if (pointsError) throw pointsError
          await logAction(r.studentId, `امتحان (${title}): الدرجة ${r.total} | تأثير النقاط: ${pointDiff > 0 ? '+' + pointDiff : pointDiff}`, pointDiff)
        }
      }
      pushAction({ type: 'exam', description: `امتحان: ${title}`, undoFn: async () => { await supabase.from('exams').delete().eq('id', exam.id); await supabase.from('exam_scores').delete().eq('exam_id', exam.id); for (const [sid, diff] of Object.entries(studentPointDiffs)) { const s = students.find((x) => x.id === sid); if (s) await supabase.from('students').update({ points: s.points - diff }).eq('id', sid) }; loadAll() } })
      setExamOpen(false); setUndoSnackbar({ visible: true, message: `${t('exam_saved')} ${title}` }); loadAll()
    } catch (err) { console.error('Save exam error:', err); showToast(t('exam_failed'), 'error') }
    finally { setIsSaving(false) }
  }

  const handleUndo = async () => { const result = await undoLast(); refreshUndo(); if (result.undone) { showToast(`${t('undo_done')} ${result.description}`, 'info'); setCanRedo(getRedoCount() > 0); loadAll() } else showToast(t('nothing_to_undo'), 'info') }
  const handleRedo = async () => { const result = await redoLast(); refreshUndo(); if (result.redone) { showToast(`${t('redo_done')} ${result.description}`, 'info'); setCanRedo(getRedoCount() > 0); loadAll() } else showToast(t('nothing_to_redo'), 'info') }
  const handleSaveAll = async () => {
    // The top save control must save the active lesson draft too; previously it
    // only flushed the offline queue, which made the lesson appear unsaved.
    if (sessionGroup && activeLessonId && activeLesson?.status === 'open' && sessionHasChanges) {
      await finishLesson()
      return
    }
    setSaveStatus('saving')
    try { await syncQueue(supabase, showToast); setSaveStatus('saved'); setLastSavedAt(new Date()); refreshUndo() }
    catch (error) { console.error('Sync pending saves error:', error); setSaveStatus('error'); showToast(isArabic ? 'تعذر مزامنة الحفظ المعلّق. حاول مرة أخرى.' : 'Could not sync pending saves. Try again.', 'error') }
  }
  const handleHistoryRestore = async (id) => { const result = await undoById(id); if (result.undone) { showToast(`${t('undo_done')} ${result.description}`, 'info'); loadAll() } else showToast(t('undo_failed'), 'error') }
  const handleResetSession = () => { setSessionDraft({ ...sessionDraftOriginal }); setSessionHasChanges(false) }

  const handleSendQR = async () => {
    if (!pendingQRStudent) return
    const reservedWindow = openWhatsAppPlaceholder()
    try {
      const token = await getOrCreateStudentToken(pendingQRStudent.id)
      if (token) {
        const studentLink = buildStudentQRLink(token)
        const opened = await sendQRViaWhatsApp(pendingQRStudent.phone, pendingQRStudent.name, studentLink, settings.qr_message_template, reservedWindow)
        if (!opened) throw new Error('whatsapp_handoff_failed')
        showToast(t('qr_sent'), 'success', 5000)
      } else {
        try { reservedWindow?.close?.() } catch {}
        showToast(navigator.onLine === false ? 'لا يوجد اتصال. أنشئ الرابط أول مرة مع الإنترنت ثم أعد المحاولة.' : t('qr_failed'), 'error')
      }
    } catch (err) {
      try { reservedWindow?.close?.() } catch {}
      console.error('QR flow error:', err)
      showToast(t('qr_failed'), 'error')
    }
    setPendingQRStudent(null)
  }

  const startDailyQRQueue = async () => {
    const withPhone = filteredStudents.filter((s) => isValidPhone(s.phone))
    const skippedPhoneCount = filteredStudents.length - withPhone.length
    if (skippedPhoneCount > 0) showToast(isArabic ? `تم تخطي ${skippedPhoneCount} طالبًا لرقم غير صالح` : `Skipped ${skippedPhoneCount} student(s) with an invalid phone`, 'info')
    if (withPhone.length === 0) { showToast(t('no_phone'), 'error'); return }

    // Fetch tokens for all students in parallel. Students whose token
    // could not be created are SKIPPED — we never send a bare site URL
    // (that would just confuse the parent with a broken link).
    const tokenMap = {}
    const failedStudents = []
    await Promise.all(withPhone.map(async (s) => {
      const token = await getOrCreateStudentToken(s.id)
      if (token) tokenMap[s.id] = token
      else failedStudents.push(s.name)
    }))

    const items = withPhone
      .filter((s) => tokenMap[s.id]) // skip students with no resolvable token
      .map((s) => {
        const link = buildStudentQRLink(tokenMap[s.id])
        const template = settings.qr_message_template || `${isArabic ? 'مرحباً 👋\nده رابط Student Portal للطالب' : 'Hello 👋\nStudent Portal link for'} {studentName}: {link}`
        const message = template.replaceAll('{studentName}', s.name).replaceAll('{link}', link)
        return { student: s, phone: s.phone, message, qrUrl: link, template }
      })

    if (items.length === 0) {
      showToast(
        isArabic
          ? 'تعذّر إنشاء روابط الطلاب. تأكد إنك داخل بحسابك وحاول تاني.'
          : 'Could not create student links. Make sure you are signed in and try again.',
        'error'
      )
      return
    }
    if (failedStudents.length > 0) {
      showToast(
        isArabic
          ? `تم تخطّي ${failedStudents.length} طالب لتعذّر إنشاء الرابط`
          : `Skipped ${failedStudents.length} student(s) — could not create link`,
        'info'
      )
    }
    updateQueue({ open: true, items, index: 0 })
  }

  // ═══════════════════════════════════════════════════
  // FIX #5 — SMART REPORT: Fetch fresh data from DB before generating
  // ═══════════════════════════════════════════════════
  const getLessonAttendanceMap = async (lessonId) => {
    if (!lessonId || !effectiveTeacherId) return {}
    const { data, error } = await supabase.from('attendance_records').select('student_id, status, homework_status').eq('teacher_id', effectiveTeacherId).eq('lesson_session_id', lessonId).limit(5000)
    if (error) throw error
    return (data || []).reduce((map, row) => { map[row.student_id] = row; return map }, {})
  }

  const reportStudentView = (student, lesson, attendanceMap = {}) => {
    const row = attendanceMap[student.id]
    return { ...student, group_name: lesson?.group_name || student.group_name, stage: lesson?.stage || student.stage, attendance_status: row?.status || 'لم يرصد', hw_status: row?.homework_status || 'لم يرصد' }
  }

  const sendStudentReportPDF = async (s, lessonOverride = null) => {
    if (!s.phone) { showToast(t('no_phone'), 'error'); return }
    setPdfGenerating(s.id)
    try {
      // Fetch FRESH student data from DB (not cached UI state).
      // Defense-in-depth: select by both id AND teacher_id so that even if
      // a stale student_id from a different teacher somehow ended up in the
      // UI state, we never load data we don't own (migration_019).
      const { data: freshStudent } = effectiveTeacherId
        ? await supabase.from('students').select('*').eq('id', s.id).eq('teacher_id', effectiveTeacherId).single()
        : { data: null }
      const studentToReport = freshStudent || s
      // Fetch latest exam scores from DB (also scoped by teacher_id)
      const { data: freshScores } = effectiveTeacherId
        ? await supabase.from('exam_scores').select('*, exams(title, max_score_per_section)').eq('student_id', s.id).eq('teacher_id', effectiveTeacherId).order('created_at', { ascending: false })
        : { data: [] }
      const reportScores = (freshScores || []).map((row) => ({
        ...row,
        max_score_per_section: row.max_score_per_section || row.exams?.max_score_per_section,
        exam_title: row.exam_title || row.exams?.title,
      }))
      const scopedLesson = lessonOverride || lessonSessions.find((lesson) => lesson.id === reportLessonId) || null
      if (scopedLesson && scopedLesson.status !== 'completed') {
        showToast(isArabic ? 'أنهِ الحصة أولًا عشان تقدر تبعت التقرير.' : 'Finish the lesson before sending this report.', 'error')
        return
      }
      const scopedAttendance = scopedLesson ? await getLessonAttendanceMap(scopedLesson.id) : {}
      const scopedStudent = reportStudentView(studentToReport, scopedLesson, scopedAttendance)
      const reportScoresForMessage = reportScores.length ? reportScores : (examScoresByStudent[studentToReport.id] || [])
      const fullReport = buildTextReport(scopedStudent, {
        ranks,
        allStudents: students,
        examScores: reportScoresForMessage,
        session: scopedLesson || sessionLogsByGroup[scopedStudent.group_name],
      })
      const templateValues = getReportTemplateValues(reportScoresForMessage, scopedStudent, scopedLesson || sessionLogsByGroup[scopedStudent.group_name])
      const textRpt = settings.msg_report_template?.trim()
        ? parseTemplate(settings.msg_report_template, scopedStudent, ranks, { ...templateValues, report: fullReport })
        : fullReport
      const waOpened = sendReportWhatsApp(studentToReport.phone, textRpt)
      if (waOpened) {
        // Round 7 (honest toasts): on iPhone an async report flow can lose the
        // user gesture, so the ONLY path that actually opened WhatsApp is the
        // tappable handoff bar — say that instead of a false "تم الإرسال".
        const handoff = lastWhatsAppHandoffInfo()
        if (handoff.needsTap) showToast(isArabic ? 'التقرير جاهز — لو واتساب ما اتفتحش لوحده، اضغط زر «فتح واتساب» اللي ظهر تحت' : 'Report ready — if WhatsApp didn\'t open by itself, tap the green button below', 'info')
        else showToast(t('report_sent'), 'success')
      }
      else showToast(t('report_failed'), 'error')
    } catch (err) { console.error('Report PDF error:', err); showToast(t('report_failed'), 'error') }
    setPdfGenerating(null)
  }
  const handleDismissQR = () => { setPendingQRStudent(null) }

  // -------------------- WhatsApp --------------------
  const sessionTextFor = (student) => {
    const sess = sessionLogsByGroup[student.group_name]
    if (!sess || (!sess.lesson_topic && !sess.homework_text)) return ''
    let txt = '\n\n'
    if (sess.lesson_topic) txt += `📚 *${isArabic ? 'درس اليوم' : 'Today\'s lesson'}:* ${sess.lesson_topic}\n`
    if (sess.homework_text) txt += `📝 *${t('homework')}:* ${sess.homework_text}`
    return txt
  }

  const buildReport = (s, title, lessonOverride = null, attendanceMap = {}) => {
    const lesson = lessonOverride || lessonSessions.find((item) => item.group_name === s.group_name && item.session_date === new Date().toISOString().slice(0, 10)) || null
    const reportStudent = reportStudentView(s, lesson, attendanceMap)
    return buildTextReport(reportStudent, { ranks, allStudents: students, examScores: examScoresByStudent[s.id] || [], session: lesson || sessionLogsByGroup[s.group_name] })
  }

  const buildReportMessage = (s, lessonOverride = null, attendanceMap = {}) => {
    const lesson = lessonOverride || lessonSessions.find((item) => item.group_name === s.group_name && item.session_date === new Date().toISOString().slice(0, 10)) || null
    const reportStudent = reportStudentView(s, lesson, attendanceMap)
    const scores = examScoresByStudent[s.id] || []
    const fullReport = buildTextReport(reportStudent, { ranks, allStudents: students, examScores: scores, session: lesson || sessionLogsByGroup[s.group_name] })
    return settings.msg_report_template?.trim()
      ? parseTemplate(settings.msg_report_template, reportStudent, ranks, { ...getReportTemplateValues(scores, reportStudent, lesson || sessionLogsByGroup[s.group_name]), report: fullReport })
      : fullReport
  }

  // Round 4: sendWhatsApp now shows the WhatsAppHandoffBar (guaranteed tappable
  // link) on every send. A false return means the phone/message failed
  // validation — surface it instead of failing silently.
  const sendIndividualReport = (s) => {
    const opened = sendWhatsApp(s.phone, buildReport(s, isArabic ? 'تقرير متابعة الطالب' : 'Student Follow-up Report'))
    if (!opened) showToast(isArabic ? 'رقم الهاتف غير صالح للإرسال على واتساب' : 'Phone number is not valid for WhatsApp', 'error')
    else if (lastWhatsAppHandoffInfo().needsTap) showToast(isArabic ? 'الرسالة جاهزة — لو واتساب ما اتفتحش لوحده، اضغط زر «فتح واتساب» اللي ظهر تحت' : 'Message ready — if WhatsApp didn\'t open by itself, tap the green button below', 'info')
  }
  const sendTemplateMessage = (s, type) => {
    const tpl = type === 'warning' ? settings.msg_warning : settings.msg_promotion
    const opened = sendWhatsApp(s.phone, parseTemplate(tpl, s, ranks))
    if (!opened) showToast(isArabic ? 'رقم الهاتف غير صالح للإرسال على واتساب' : 'Phone number is not valid for WhatsApp', 'error')
    else if (lastWhatsAppHandoffInfo().needsTap) showToast(isArabic ? 'الرسالة جاهزة — لو واتساب ما اتفتحش لوحده، اضغط زر «فتح واتساب» اللي ظهر تحت' : 'Message ready — if WhatsApp didn\'t open by itself, tap the green button below', 'info')
  }
  const startDailyReportsQueue = async () => {
    if (!reportGroup || !reportLessonId) { showToast(isArabic ? 'اختار المجموعة والحصة من الفلاتر أولاً؛ التقارير لن تُرسل لكل الطلاب تلقائيًا.' : 'Choose a group and lesson first; reports will never target all students automatically.', 'error'); return }
    const lesson = lessonSessions.find((item) => item.id === reportLessonId)
    if (!lesson) { showToast(isArabic ? 'الحصة المحددة غير موجودة' : 'Selected lesson was not found', 'error'); return }
    if (lesson.status !== 'completed') { showToast(isArabic ? 'أنهِ الحصة أولًا عشان تقدر تبعت التقارير.' : 'Finish the lesson before sending reports.', 'error'); return }
    const attendanceMap = await getLessonAttendanceMap(lesson.id)
    setReportAttendanceByStudent(attendanceMap)
    const queueStudents = reportStudents.filter((s) => isValidPhone(s.phone))
    const skippedPhoneCount = reportStudents.length - queueStudents.length
    if (skippedPhoneCount > 0) showToast(isArabic ? `تم تخطي ${skippedPhoneCount} طالبًا لرقم غير صالح` : `Skipped ${skippedPhoneCount} student(s) with an invalid phone`, 'info')
    if (queueStudents.length === 0) { showToast(t('no_phone'), 'error'); return }
    const items = queueStudents.map((s) => {
      const report = `${buildReportMessage(s, lesson, attendanceMap)}\n\n💡 ${isArabic ? 'نشكر متابعتكم.' : 'Thank you for your attention.'}`
      return { student: s, phone: s.phone, message: report, lessonId: lesson.id }
    })
    updateQueue({ open: true, items, index: 0 })
  }
  const startBulkMessageQueue = () => {
    const text = prompt(isArabic ? 'نص الرسالة الجماعية:' : 'Bulk message:', settings.msg_welcome)
    if (!text || !text.trim() || filteredStudents.length === 0) return
    const queueStudents = filteredStudents.filter((s) => isValidPhone(s.phone))
    const skippedPhoneCount = filteredStudents.length - queueStudents.length
    if (skippedPhoneCount > 0) showToast(isArabic ? `تم تخطي ${skippedPhoneCount} طالبًا لرقم غير صالح` : `Skipped ${skippedPhoneCount} student(s) with an invalid phone`, 'info')
    if (queueStudents.length === 0) { showToast(t('no_phone'), 'error'); return }
    const items = queueStudents.map((s) => ({ student: s, phone: s.phone, message: parseTemplate(text.trim(), s, ranks) }))
    updateQueue({ open: true, items, index: 0 })
  }

  // -------------------- Excel --------------------
  const exportExcel = async () => {
    const flat = students.map((s) => ({ 'كود الطالب': s.code, 'الاسم': s.name, 'الهاتف': s.phone, 'المرحلة': s.stage, 'المجموعة': s.group_name, 'النقاط': s.points, 'الإنذارات': s.warnings || 0, 'الحضور': s.attendance_status, 'الواجب': s.hw_status }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flat), 'Students')
    // Defense-in-depth: scope session_logs by teacher_id (migration_019)
    const { data: sessions } = effectiveTeacherId
      ? await supabase.from('session_logs').select('*').eq('teacher_id', effectiveTeacherId).order('session_date', { ascending: false })
      : { data: [] }
    const sessionsFlat = (sessions ?? []).map((r) => ({ 'التاريخ': r.session_date, 'المجموعة': r.group_name, 'الدرس': r.lesson_topic || '', 'الواجب': r.homework_text || '' }))
    if (sessionsFlat.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sessionsFlat), 'Sessions')
    XLSX.writeFile(wb, `AlNokhba_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const importExcel = async (e) => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = async (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'binary' }); const ws = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(ws)
      const existingByCode = new Map(students.filter((s) => s.code).map((s) => [s.code, s]))
      const existingByNamePhone = new Map(students.map((s) => [`${s.name}|${s.phone || ''}`, s]))
      let updated = 0, inserted = 0
      for (const r of rows) {
        const name = String(r['الاسم'] || '').trim(); if (!name) continue
        const code = String(r['كود الطالب'] || '').trim(); const phone = String(r['الهاتف'] || '').trim()
        const match = (code && existingByCode.get(code)) || existingByNamePhone.get(`${name}|${phone}`)
        const payload = { name, phone: phone || null, stage: r['المرحلة'] || null, group_name: r['المجموعة'] || null, points: parseInt(r['النقاط']) || 0, warnings: parseInt(r['الإنذارات']) || 0, attendance_status: r['الحضور'] || 'لم يرصد', hw_status: r['الواجب'] || 'لم يرصد' }
        if (match) { await supabase.from('students').update(payload).eq('id', match.id); updated++ }
        else { await supabase.from('students').insert({ teacher_id: effectiveTeacherId, code: code || generateStudentCode(), ...payload }); inserted++ }
      }
      showToast(`${t('import_done')} ${inserted} ${t('new_students')} ${updated} ${t('updated_students')}`, 'success', 5000)
      loadAll()
    }
    reader.readAsBinaryString(file); e.target.value = ''
  }

  if (!settings) return <div className="min-h-screen flex items-center justify-center bg-brand-bg text-fg-subtle text-sm">{t('loading')}</div>

  const daysLeft = profile?.subscription_expires_at ? Math.max(0, Math.ceil((new Date(profile.subscription_expires_at) - new Date()) / 86400000)) : null
  const showExpiryBanner = daysLeft !== null && daysLeft <= 5
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('good_morning') : hour < 17 ? t('good_afternoon') : t('good_evening')
  const firstName = (profile?.full_name || '').trim().split(' ')[0]

  const SECTIONS = [
    ['dashboard', '🏠', t('nav_dashboard')],
    ['students', '👥', t('nav_students')],
    ['sessions', '📋', t('nav_sessions')],
    ['exams', '📝', t('nav_exams')],
    ['reports', '📊', t('nav_reports')],
  ]

  return (
    <div className="h-[100dvh] min-h-screen flex overflow-hidden bg-brand-bg text-fg" dir={dir}>
      {/* ═══════════════════════════════════════════════════
          FIX #1 + #3 — SIDEBAR: Works on ALL devices
          Desktop: always visible, collapsible
          Mobile: overlay drawer with click-outside-to-close
      ═══════════════════════════════════════════════════ */}
      {/* Mobile overlay backdrop */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside
        ref={sidebarRef}
        className={`fixed md:sticky top-0 h-screen shrink-0 z-40 md:z-auto
          bg-[var(--surface)] backdrop-blur-xl border-l border-subtle
          flex flex-col transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : (isArabic ? 'translate-x-full' : '-translate-x-full')}
          md:translate-x-0 w-64
        `}
      >
        <div className="p-5 flex items-center gap-3 border-b border-subtle">
          <img src={brandLogoUrl || '/nokhba-mark.svg'} alt={brandDisplayName || t('app_name')} className="w-10 h-10 rounded-lg object-cover" onError={(e) => { e.target.src = '/nokhba-mark.svg' }} />
          <div className="min-w-0 flex-1">
            <h1 className="font-black text-base text-fg truncate">{brandDisplayName || t('app_name')}</h1>
            <p className="text-[11px] text-fg-subtle">{t('app_subtitle')}</p>
          </div>
          {/* Close button — mobile only */}
          <button onClick={() => setSidebarOpen(false)} className="md:hidden ml-auto text-fg-subtle text-xl leading-none">✕</button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {SECTIONS.map(([key, icon, label]) => (
            <button
              key={key}
              data-tour={`nav-${key}`}
              onClick={() => { setActiveSection(key); setSidebarOpen(false) }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold border-r-[3px] transition-all ${
                activeSection === key
                  ? 'bg-brand-gold/10 text-fg border-brand-gold'
                  : 'text-fg-subtle border-transparent hover:bg-white/10 hover:text-fg'
              }`}
            >
              <span className="text-lg">{icon}</span>{label}
            </button>
          ))}

          {/* Platform guide — extra menu tab (was a floating button that overlapped other elements) */}
          <button
            data-tour="tutorial-launcher"
            onClick={() => { setTourMenuOpen(true); setSidebarOpen(false) }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold border-r-[3px] border-transparent text-fg-subtle hover:bg-white/10 hover:text-fg transition-all"
          >
            <span className="text-lg">🎓</span>
            {isArabic ? 'شرح المنصة' : 'Platform guide'}
          </button>
        </nav>

        <div className="p-3 border-t border-subtle space-y-1">
          <button data-tour="settings-btn" onClick={() => { setSettingsOpen(true); setSidebarOpen(false) }}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-fg-subtle hover:bg-white/10 hover:text-fg">
            <span className="text-lg">⚙️</span> {t('settings')}
          </button>
          <button data-tour="operations-log-btn" onClick={() => { setHistoryModalOpen(true); setSidebarOpen(false) }}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-fg-subtle hover:bg-white/10 hover:text-fg">
            <span className="text-lg">🕐</span> {t('operations_log')}
          </button>
          {profile?.is_admin && onOpenAdmin && (
            <button onClick={() => { onOpenAdmin(); setSidebarOpen(false) }}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-violet-400 hover:bg-violet-500/10">
              <span className="text-lg">🛡️</span> {t('admin_panel')}
            </button>
          )}
          <div className="flex items-center gap-3 px-4 py-3 mt-2 border-t border-subtle pt-3">
            <div className="w-9 h-9 rounded-full bg-brand-navy flex items-center justify-center text-brand-gold font-bold text-sm shrink-0">
              {(profile?.full_name || '؟').trim()[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-fg truncate">{profile?.full_name}</p>
              <button onClick={signOut} className="text-[11px] text-fg-subtle hover:text-rose-400">{t('sign_out')}</button>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Mobile header */}
        <header className="md:hidden border-b border-subtle bg-[var(--surface)] backdrop-blur-xl sticky top-0 z-10">
          <div className="px-4 py-3 flex justify-between items-center gap-2">
            <div className="flex items-center gap-2">
              <button onClick={() => setSidebarOpen(true)} className="text-fg text-2xl leading-none">☰</button>
              <img src="/nokhba-mark.svg" alt={t('app_name')} className="w-8 h-8" />
              <h1 className="font-black text-base text-fg">{t('app_name')}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleUndo} disabled={!ctxCanUndo && getHistoryCount() === 0} title={t('undo')} className={ctxCanUndo || getHistoryCount() > 0 ? 'text-fg-subtle active:scale-90' : 'text-fg-subtle/30'}>
                <span className="material-symbols-outlined" style={{fontSize:20}}>undo</span>
              </button>
              <button onClick={handleRedo} disabled={!ctxCanRedo && !canRedo} title={t('redo')} className={ctxCanRedo || canRedo ? 'text-fg-subtle active:scale-90' : 'text-fg-subtle/30'}>
                <span className="material-symbols-outlined" style={{fontSize:20}}>redo</span>
              </button>
              {saveStatus === 'saving' && <span className="text-brand-gold text-xs animate-pulse">⏳</span>}
              {saveStatus === 'saved' && <span className="text-emerald-400 text-xs">✅</span>}
              <NotificationBell broadcasts={broadcasts} dismissedBroadcasts={dismissedBroadcasts} onDismiss={dismissBroadcast} />
              <button onClick={() => setSettingsOpen(true)} title={t('settings')} className="text-fg-subtle text-lg">⚙️</button>
              {profile?.is_admin && onOpenAdmin && <button onClick={onOpenAdmin} className="text-violet-400 text-sm font-bold">{t('admin')}</button>}
              <button onClick={signOut} className="text-fg-subtle hover:text-rose-400 text-sm">{t('exit')}</button>
            </div>
          </div>
        </header>

        {/* Desktop top bar */}
        <div className="hidden md:flex items-center justify-between px-6 py-2 border-b border-subtle bg-[var(--surface)] backdrop-blur-xl text-xs text-fg-subtle">
          <div className="flex items-center gap-4">
            <span>{profile?.full_name}</span>
            <span>{profile?.subscription_status === 'trial' ? `${t('free_trial')} ${daysLeft} ${daysLeft === 1 ? t('days') : t('days_plural')}` : t('subscription_active')}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={saveStatus === 'saving' ? 'text-brand-gold animate-pulse' : saveStatus === 'saved' ? 'text-emerald-400' : saveStatus === 'error' ? 'text-rose-400' : 'text-fg-subtle'}>
              {saveStatus === 'saving' ? `⏳ ${t('saving')}` : saveStatus === 'saved' ? `✅ ${t('saved')}` : saveStatus === 'saved_locally' ? `📡 ${t('saved_locally')}` : saveStatus === 'error' ? `❌ ${t('save_failed')}` : ''}
            </span>
            {lastSavedAt && <span className="text-fg-muted">· {new Date(lastSavedAt).toLocaleTimeString(isArabic ? 'ar-EG' : 'en', { hour: '2-digit', minute: '2-digit' })}</span>}
            <div className="w-px h-4 bg-subtle" />
            <button onClick={handleUndo} disabled={!ctxCanUndo && getHistoryCount() === 0} title={t('undo')} className={`p-1 rounded transition-colors ${ctxCanUndo || getHistoryCount() > 0 ? 'text-fg-subtle hover:text-fg hover:bg-white/5' : 'text-fg-subtle/30 cursor-not-allowed'}`}>
              <span className="material-symbols-outlined" style={{fontSize:18}}>undo</span>
            </button>
            <button onClick={handleRedo} disabled={!ctxCanRedo && !canRedo} title={t('redo')} className={`p-1 rounded transition-colors ${ctxCanRedo || canRedo ? 'text-fg-subtle hover:text-fg hover:bg-white/5' : 'text-fg-subtle/30 cursor-not-allowed'}`}>
              <span className="material-symbols-outlined" style={{fontSize:18}}>redo</span>
            </button>
            <div className="w-px h-4 bg-subtle" />
            <button onClick={handleSaveAll} disabled={!sessionHasChanges} title={`${t('save')} (Ctrl+S)`} className={`clay-btn-gold text-[11px] px-3 py-1 rounded-lg font-bold flex items-center gap-1 ${!sessionHasChanges ? 'opacity-40 cursor-not-allowed' : ''}`}>
              <span className="material-symbols-outlined" style={{fontSize:14}}>save</span> {t('save')}
            </button>
            <button onClick={() => setHistoryModalOpen(true)} title={t('operations_log')} className="flex items-center gap-2 rounded-xl border border-subtle bg-[var(--surface-container)] px-3 py-2 text-xs font-bold text-fg-subtle transition hover:border-brand-gold/50 hover:bg-white/70 hover:text-fg">
              <span className="material-symbols-outlined" style={{fontSize:18}}>history</span><span>{t('operations_log')}</span>
            </button>
            {offlinePendingCount > 0 && (
              <button onClick={manualSync} title={`${offlinePendingCount} ${t('pending')}`} className="text-amber-400 hover:text-amber-300 flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500/30 text-[11px] font-bold">📡 {offlinePendingCount}</button>
            )}
            <NotificationBell broadcasts={broadcasts} dismissedBroadcasts={dismissedBroadcasts} onDismiss={dismissBroadcast} />
          </div>
        </div>

        <OfflineBanner isOnline={isOnline} pending={offlinePendingCount} syncing={offlineSyncing} onManualSync={manualSync} />

        {showExpiryBanner && (
          <div className="bg-brand-gold/10 border-b border-brand-gold/30 text-brand-gold-hover text-xs sm:text-sm text-center py-2 px-4">
            ⏳ {daysLeft === 0 ? t('expires_today') : `${t('expires_in')} ${daysLeft} ${daysLeft === 1 ? t('days') : t('days_plural')} ${t('renew_now')}`}
          </div>
        )}

      <main className="dashboard-scroll-surface flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-auto max-w-7xl w-full mx-auto px-4 py-6 space-y-4 pb-20 md:pb-6">
        {broadcasts.filter((b) => !dismissedBroadcasts.includes(b.id)).map((b) => (
          <div key={b.id} className="bg-violet-500/10 border border-violet-500/30 rounded-xl px-4 py-2.5 flex justify-between items-center gap-3 text-sm">
            <span className="text-violet-300">📢 {b.message}</span>
            <button onClick={() => dismissBroadcast(b.id)} className="text-violet-400 hover:text-violet-300 shrink-0">✕</button>
          </div>
        ))}

        {absenceSummary && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-2.5 text-sm text-rose-300">
            🚨 {t('repeated_absence')} {absenceSummary}
          </div>
        )}

        {/* ═══ DASHBOARD ═══ */}
        {activeSection === 'dashboard' && (
          <>
            <h2 className="text-lg font-bold text-fg">
              👋 {greeting}{firstName ? `، أ. ${firstName}` : ''} — {t('youHave')} {students.length} {t('students_count')} {groups.length} {t('groups_count')}
              {isAssistant && <span className="text-xs text-violet-400 font-normal"> · {t('workingAsAssistant')} {ownerProfile?.full_name}</span>}
            </h2>
            <div data-tour="dashboard-overview"><DashboardOverview students={students} examScoresByStudent={examScoresByStudent} absenceStreaks={absenceStreaks} ranks={ranks} onOpenStudent={(s) => setProfileModal({ open: true, student: s })} /></div>
            <div className="flex flex-wrap gap-2">
              <ToolBtn dataTour="add-student-btn" onClick={() => setStudentModal({ open: true, student: null })} color="blue">{t('add_student')}</ToolBtn>
              <ToolBtn dataTour="qr-attendance-btn" onClick={() => setQrOpen(true)} color="emerald">{t('qr_attendance')}</ToolBtn>
              <ToolBtn dataTour="record-exam-btn" onClick={() => setExamOpen(true)} color="purple">{t('record_exam')}</ToolBtn>
            </div>
          </>
        )}

        {/* ═══ STUDENTS ═══ */}
        {activeSection === 'students' && (
          <>
            <div className="flex flex-wrap gap-2">
              <ToolBtn dataTour="add-student-btn" onClick={() => setStudentModal({ open: true, student: null })} color="blue">{t('add_student')}</ToolBtn>
              <ToolBtn onClick={() => setLeaderboardOpen(true)} color="amber">{t('leaderboard')}</ToolBtn>
              <ToolBtn onClick={exportExcel} color="slate">{t('export_excel')}</ToolBtn>
              <label className="cursor-pointer">
                <span className="tool-action-button inline-flex glass-input hover:bg-white/10 text-fg-subtle font-bold border border-subtle">{t('import_excel')}</span>
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={importExcel} />
              </label>
            </div>
            <div className="grid sm:grid-cols-4 gap-2">
              <input data-tour="student-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search_placeholder')} className="glass-card rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold" />
              <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="glass-card rounded-lg px-3 py-2 text-sm outline-none">
                <option value="الكل">الكل</option>
                {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="glass-card rounded-lg px-3 py-2 text-sm outline-none">
                <option value="all">{t('all_groups')}</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="glass-card rounded-lg px-3 py-2 text-sm outline-none">
                <option value="all">{t('all_status')}</option>
                <option value="present">{t('present_filter')}</option>
                <option value="absent">{t('absent_filter')}</option>
                <option value="warning">{t('academic_decline')}</option>
                <option value="hw_missing">{t('hw_missing')}</option>
              </select>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label={t('total_students')} value={filteredStudents.length} />
              <StatCard label={t('present_students')} value={stats.present} />
              <StatCard label={t('absent_students')} value={stats.absent} />
              <StatCard label={t('exam_avg')} value={`${stats.avg}%`} />
            </div>
            {selectedIds.size > 0 && (
              <div data-tour="bulk-selection" className="bg-brand-gold/10 border border-brand-gold/40 rounded-xl p-3 flex flex-wrap items-center gap-2">
                <span className="text-brand-gold-hover text-xs font-bold">✅ {selectedIds.size} {t('selected_count')}</span>
                <ToolBtn onClick={toggleSelectAllFiltered} color="gold">{filteredStudents.every((s) => selectedIds.has(s.id)) ? 'إلغاء تحديد النتائج' : 'تحديد كل النتائج'}</ToolBtn>
                <ToolBtn onClick={() => bulkSetAttendance('حاضر')} color="emerald">{t('mark_selected_present')}</ToolBtn>
                <ToolBtn onClick={() => bulkSetAttendance('غائب')} color="rose">{t('mark_selected_absent')}</ToolBtn>
                <ToolBtn onClick={() => bulkAdjustPoints(settings.points_interact, 'تفاعل جماعي')} color="blue">{t('points_selected')}</ToolBtn>
                <ToolBtn onClick={bulkMessage} color="green">{t('message_selected')}</ToolBtn>
                <ToolBtn onClick={() => { setBulkGroupName(''); setBulkGroupOpen(true) }} color="blue">نقل إلى مجموعة</ToolBtn>
                <ToolBtn onClick={clearSelection} color="slate">{t('clear_selection')}</ToolBtn>
              </div>
            )}
            {/* ★ FIX #3: Removed clay-btn from table container — no more fake bounce */}
            <div data-tour="student-list" className="students-table-wrapper glass-card rounded-2xl overflow-x-auto">
              {loading ? (
                <SkeletonTableRows rows={5} cols={7} />
              ) : filteredStudents.length === 0 ? (
                students.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <div className="text-4xl mb-2">👥</div>
                    <p className="text-fg-muted font-bold">{t('no_students_yet')}</p>
                    <p className="text-fg-subtle text-sm mt-1 mb-4">{t('add_first_student')}</p>
                    <button onClick={() => setStudentModal({ open: true, student: null })} className="tool-action-button btn-glow font-bold">{t('add_student_btn')}</button>
                  </div>
                ) : (
                  <div className="text-center py-12 px-4">
                    <div className="text-4xl mb-2">🔍</div>
                    <p className="text-fg-muted font-bold">{t('no_results')}</p>
                    <button onClick={() => { setSearch(''); setStageFilter('الكل'); setGroupFilter('all'); setStatusFilter('all') }} className="text-brand-gold-hover hover:text-fg text-sm font-bold mt-2">{t('clear_filters')}</button>
                  </div>
                )
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-[1] glass-input">
                    <tr className="border-b border-subtle text-fg-muted text-xs font-bold">
                      <th className="p-3"><input data-tour="student-select-all" type="checkbox" title={t('all_status')} checked={filteredStudents.length > 0 && filteredStudents.every((s) => selectedIds.has(s.id))} onChange={toggleSelectAllFiltered} className="w-4 h-4 accent-[#D4A373]" /></th>
                      <th className="p-3">{t('th_index')}</th><th className="p-3 text-right">{t('th_student')}</th><th className="p-3">{t('th_stage_group')}</th>
                      <th className="p-3">{t('th_points')}</th><th className="p-3">{t('th_attendance')}</th><th className="p-3">{t('th_homework')}</th>
                      <th className="p-3">{t('th_quick_actions')}</th><th className="p-3">{t('th_messages')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s, i) => (
                      // FIX (wrong-lesson routing) — see setAttendance: the students
                      // list records a general day mark; smart routing may redirect it
                      // to the student's own group lesson open today (never into
                      // another group's active lesson).
                      <StudentRow
                        key={s.id} student={s} index={i} ranks={ranks} points={settings}
                        hasWarning={checkAcademicWarning(examScoresByStudent[s.id] || [])}
                        absenceStreak={absenceStreaks[s.id]}
                        isSaving={savingIds.has(s.id)} pdfGenerating={pdfGenerating === s.id}
                        showSaved={savedIds.has(s.id)}
                        selected={selectedIds.has(s.id)} onToggleSelect={(event) => toggleSelect(s.id, i, event?.shiftKey)}
                        onOpenProfile={() => setProfileModal({ open: true, student: s })}
                        onSetAttendance={(sid, status) => setAttendance(sid, status, undefined)} onUpdateHW={(sid, status) => updateHW(sid, status, undefined)} onAdjustPoints={adjustPoints} onEditPoints={editPoints}
                        onAddWarning={addWarning} onRemoveWarning={removeWarning} onEdit={() => setStudentModal({ open: true, student: s })}
                        onDelete={() => deleteStudent(s.id)}
                        onReport={() => sendStudentReportPDF(s, activeLesson)}
                        onWarningMsg={() => sendTemplateMessage(s, 'warning')}
                        onPromotionMsg={() => sendTemplateMessage(s, 'promotion')}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* ═══ SESSIONS ═══ */}
        {activeSection === 'sessions' && (
          <>
              <div className="flex flex-wrap gap-2">
              <ToolBtn onClick={() => setGroupModalOpen(true)} color="blue">＋ {isArabic ? 'إضافة مجموعة' : 'Add group'}</ToolBtn>
              <ToolBtn onClick={() => setQrOpen(true)} color="emerald" disabled={!activeLessonId}>{t('scan_qr')}</ToolBtn>
            </div>
            <div data-tour="sessions-workspace" className="glass-card rounded-xl p-3">
              {groups.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-fg-subtle text-sm">{t('no_groups_yet')}</p>
                  <button onClick={() => setSettingsOpen(true)} className="text-brand-gold-hover hover:text-fg text-sm font-bold mt-2">{t('open_settings')}</button>
                </div>
              ) : (
              <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mb-3">
                {groups.map((g) => <div key={g} className={`rounded-2xl border p-3 transition-all ${sessionGroup === g ? 'border-brand-gold bg-brand-gold/10' : 'border-subtle glass-input'}`}><div className="flex items-start gap-2"><button type="button" onClick={() => chooseSessionGroup(g)} className="min-w-0 flex-1 text-start"><div className="font-black text-sm truncate">{g}</div><div className="mt-1 text-[11px] text-fg-subtle">{groupMeta[g]?.stage || (isArabic ? 'مرحلة غير محددة' : 'Stage not set')} · {groupMeta[g]?.day !== undefined ? WEEKDAY_NAMES[groupMeta[g].day] : (isArabic ? 'يوم غير محدد' : 'Day not set')} · {groupMeta[g]?.time || (isArabic ? 'ميعاد غير محدد' : 'Time not set')}</div></button><button type="button" onClick={() => openGroupEditor(g)} className="shrink-0 rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:border-emerald-300">تعديل</button></div></div>)}
              </div>
              {todayGroups.length > 0 && (
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[11px] text-fg-subtle">{t('today_groups')}</span>
                  {todayGroups.map((g) => (
                    <button key={g} type="button" onClick={() => chooseSessionGroup(g)} className={`text-[11px] px-2.5 py-1 rounded-full border ${sessionGroup === g ? 'bg-brand-navy border-brand-gold text-white font-bold' : 'glass-input border-subtle text-fg-subtle'}`}>{g}</button>
                  ))}
                </div>
              )}
              <div className="mb-3 rounded-2xl border border-brand-gold/20 bg-brand-gold/5 px-4 py-3 text-xs text-fg-subtle flex flex-wrap items-center justify-between gap-3">
                <div><span className="font-black text-fg">{activeLesson ? `📚 ${activeLesson.group_name}` : '📚 الحصة الذكية'}</span><span className="mr-2">{activeLesson ? `· ${new Date(activeLesson.session_date).toLocaleDateString(isArabic ? 'ar-EG' : 'en-US')}` : '· اختار المجموعة للبدء تلقائيًا'}</span></div>
                <div className="flex flex-col items-stretch gap-1.5 min-w-[220px]">
                  <span className="text-[11px] leading-4 text-fg-subtle">{isArabic ? 'زر حفظ البيانات يحفظ الدرس والواجب والرابط، يثبت الحضور والغياب، يسجل الغياب غير المرصود عند الحاجة، ثم ينهي الحصة ويسجلها في دفتر اليوم.' : 'Save Data stores the lesson, homework, and link, validates attendance, marks only unrecorded students absent at finalization, then closes and logs the lesson.'}</span>
                  <div className="flex items-center gap-2">
                    {activeLesson && <span className={`rounded-full px-2 py-1 font-bold ${activeLesson.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-brand-gold/10 text-brand-gold-hover'}`}>{activeLesson.status === 'completed' ? 'منتهية' : 'مفتوحة'}</span>}
                  </div>
                </div>
              </div>
              <div className="grid sm:grid-cols-[160px_1fr_1fr_auto_auto_auto] gap-2 items-center">
                <select data-tour="session-group-select" value={sessionGroup} onChange={(e) => chooseSessionGroup(e.target.value)} className="glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none">
                  <option value="">{t('choose_group')}</option>
                  {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <input value={sessionDraft.lesson_topic} onChange={(e) => setSessionDraft({ ...sessionDraft, lesson_topic: e.target.value })} placeholder={isArabic ? 'اسم الدرس / المادة' : 'Lesson / subject'} disabled={!activeLessonId || activeLesson?.status === 'completed'} className="glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold disabled:opacity-50" />
                <input value={sessionDraft.homework_text} onChange={(e) => setSessionDraft({ ...sessionDraft, homework_text: e.target.value })} placeholder={t('homework')} disabled={!activeLessonId || activeLesson?.status === 'completed'} className="glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold disabled:opacity-50" />
                <input value={sessionDraft.video_link} onChange={(e) => setSessionDraft({ ...sessionDraft, video_link: e.target.value })} placeholder={isArabic ? 'رابط الحصة / الفيديو (اختياري)' : 'Lesson or video link (optional)'} disabled={!activeLessonId || activeLesson?.status === 'completed'} className="glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold disabled:opacity-50 sm:col-span-2" />
                  <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
                    <button data-tour="finish-session-btn" type="button" onClick={finishLesson} disabled={!activeLessonId || activeLesson?.status === 'completed' || lessonSaveStatus === 'saving'} className="btn-glow disabled:opacity-40 text-xs font-black px-4 py-2.5 rounded-xl">{lessonSaveStatus === 'saving' ? '⏳ جاري الحفظ وإنهاء الحصة...' : '💾 حفظ البيانات وإنهاء الحصة'}</button>
                    {/* FIX (dead action): "فتح حصة جديدة" existed in code but was never
                        rendered — after finishing today's lesson there was NO way to open
                        a second one (e.g. الحصة التانية) without the ghost-lesson bug. */}
                    {sessionGroup && (!activeLessonId || activeLesson?.status === 'completed') && (
                      <button type="button" onClick={startNewLesson} className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-black text-emerald-300 hover:bg-emerald-500/20">➕ {isArabic ? 'فتح حصة جديدة' : 'Open new lesson'}</button>
                    )}
                    <span className={`text-[11px] ${lessonSaveStatus === 'finalized' || lessonSaveStatus === 'saved' ? 'text-emerald-400' : lessonSaveStatus === 'error' ? 'text-rose-400' : 'text-fg-subtle'}`}>{lessonSaveStatus === 'finalized' ? `✓ تم حفظ وإنهاء الحصة${lastSavedAt ? ` · ${lastSavedAt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}` : ''}` : lessonSaveStatus === 'saved' ? 'تم حفظ بيانات الحصة' : lessonSaveStatus === 'error' ? 'تعذر حفظ أو إنهاء الحصة' : sessionHasChanges ? 'تعديلات غير محفوظة' : 'اضغط حفظ البيانات لإنهاء الحصة'}</span>
                  </div>
                  <button onClick={() => sessionGroup && setHistoryModal({ open: true, group: sessionGroup })} disabled={!sessionGroup} className="glass-input hover:bg-white/10 disabled:opacity-40 text-fg-subtle text-xs font-bold px-4 py-2 rounded-lg">{t('session_history')}</button>
              </div>
              </>
              )}
            </div>
            <Charts variant="attendance" present={stats.present} absent={stats.absent} unrecorded={stats.unrecorded} examDatesMap={stats.examDatesMap} />
            {/* ★ FIX #3: No clay-btn on this table either */}
            {sessionGroup && sessionStudents.length > 0 && (
              <div className="students-table-wrapper glass-card rounded-2xl overflow-x-auto">
                <div className="px-4 py-2 border-b border-subtle flex items-center justify-between">
                  <span className="text-xs font-bold text-fg-subtle">📋 {t('group_students')} «{sessionGroup}» — {sessionStudents.length}</span>
                  <div className="flex items-center gap-2 text-xs text-fg-subtle">
                    <span className="text-emerald-400">✅ {sessionAttendanceCounts.present}</span>
                    <span className="text-rose-400">❌ {sessionAttendanceCounts.absent}</span>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-[1] glass-input">
                    <tr className="border-b border-subtle text-fg-muted text-xs font-bold">
                      <th className="p-3">#</th><th className="p-3 text-right">{t('th_student')}</th><th className="p-3">{t('th_points')}</th>
                      <th className="p-3">{t('th_attendance')}</th><th className="p-3">{t('th_homework')}</th><th className="p-3">{t('th_quick_actions')}</th><th className="p-3">{t('th_messages')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionStudents.map((s, i) => (
                      <StudentRow key={s.id} student={s} index={i} ranks={ranks} points={settings} hasWarning={checkAcademicWarning(examScoresByStudent[s.id] || [])} absenceStreak={absenceStreaks[s.id]} isSaving={savingIds.has(s.id)} pdfGenerating={pdfGenerating === s.id} showSaved={savedIds.has(s.id)} selected={selectedIds.has(s.id)} onToggleSelect={(event) => toggleSelect(s.id, i, event?.shiftKey)} onOpenProfile={() => setProfileModal({ open: true, student: s })} onSetAttendance={(sid, status) => setAttendance(sid, status, activeLessonId || undefined)} onUpdateHW={(sid, status) => updateHW(sid, status, activeLessonId || undefined)} onAdjustPoints={adjustPoints} onEditPoints={editPoints} onAddWarning={addWarning} onRemoveWarning={removeWarning} onEdit={() => setStudentModal({ open: true, student: s })} onDelete={() => deleteStudent(s.id)} onReport={() => sendStudentReportPDF(s, activeLesson)} onWarningMsg={() => sendTemplateMessage(s, 'warning')} onPromotionMsg={() => sendTemplateMessage(s, 'promotion')} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sessionGroup && sessionStudents.length > 0 && (
              <div className="glass-card rounded-2xl p-3 mt-3 border border-emerald-500/20">
                <div className="flex flex-wrap items-center gap-2 mb-2"><span className="text-xs font-black text-emerald-300">حضر من مجموعة أخرى؟</span><span className="text-[11px] text-fg-subtle">ابحث عن الطالب وسجله حاضرًا هنا بدون تغيير مجموعته.</span></div>
                <input value={sessionGuestSearch} onChange={(e) => setSessionGuestSearch(e.target.value)} placeholder="اسم الطالب أو الكود أو الهاتف" className="glass-input border border-subtle rounded-lg px-3 py-2 text-sm w-full" />
                {guestStudents.length > 0 && <div className="mt-2 grid gap-2 sm:grid-cols-2">{guestStudents.map((s) => <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-subtle px-3 py-2"><span className="text-xs font-bold truncate">{s.name} <span className="text-fg-subtle">· {s.group_name || 'بدون مجموعة'}</span></span><button type="button" onClick={() => markGuestPresent(s.id)} className="rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-3 py-1.5 text-xs font-black">✓ حاضر هنا</button></div>)}</div>}
              </div>
            )}
            {sessionGroup && sessionStudents.length === 0 && (
              <div className="glass-card rounded-2xl p-8 text-center">
                <div className="text-4xl mb-2">👥</div>
                <p className="text-fg-muted font-bold">{t('no_students_in_group')}</p>
              </div>
            )}
            {sessionGroup && (
              <div className="flex justify-end mt-3">
                <button type="button" onClick={() => deleteGroupFromLessons(sessionGroup)} className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-black text-rose-300 hover:bg-rose-500/20">🗑️ {isArabic ? 'حذف هذه المجموعة' : 'Delete this group'}</button>
              </div>
            )}
          </>
        )}

        {/* ═══ EXAMS ═══ */}
        {activeSection === 'exams' && (
          <>
            <div className="flex flex-wrap gap-2">
              <ToolBtn onClick={() => setExamOpen(true)} color="purple"><span data-tour="create-exam-btn">{t('record_exam')}</span></ToolBtn>
              <ToolBtn onClick={() => setExamsListOpen(true)} color="purple">{t('all_exams')}</ToolBtn>
            </div>
            <p className="text-fg-subtle text-xs">{isArabic ? '💡 اسحب القوالب الجاهزة أو اعمل قالب جديد خاص بيك' : '💡 Drag existing templates or create a new custom one'}</p>
            {Object.keys(stats.examDatesMap).length === 0 && students.length > 0 && <p className="text-fg-subtle text-sm">{t('no_exams_recorded')}</p>}
            <Charts variant="scores" present={stats.present} absent={stats.absent} unrecorded={stats.unrecorded} examDatesMap={stats.examDatesMap} />
          </>
        )}

        {/* ═══ REPORTS ═══ */}
        {activeSection === 'reports' && (
          <div className="space-y-4">
            {students.length === 0 ? (
              <div className="glass-card rounded-2xl p-8 text-center">
                <div className="text-4xl mb-2">📊</div>
                <p className="text-fg-muted font-bold">{t('no_students_for_reports')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div data-tour="reports-scope" className="glass-card rounded-2xl p-4 border border-brand-gold/20">
                  <div className="text-sm font-black mb-2">{isArabic ? 'تحديد نطاق التقارير' : 'Choose report scope'}</div>
                  <p className="text-xs text-fg-subtle mb-3">{isArabic ? 'التقارير لن تُرسل لكل الطلاب. لازم تختار المجموعة والحصة المقصودة.' : 'Reports are never sent to everyone. Choose the exact group and lesson.'}</p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <select value={reportGroup} onChange={(e) => { setReportGroup(e.target.value); setReportLessonId('') }} className="glass-input border border-subtle rounded-lg px-3 py-2 text-sm">
                      <option value="">{isArabic ? 'اختر المجموعة' : 'Choose group'}</option>
                      {groups.map((group) => <option key={group} value={group}>{group}</option>)}
                    </select>
                    <select value={reportLessonId} onChange={(e) => setReportLessonId(e.target.value)} disabled={!reportGroup} className="glass-input border border-subtle rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                      <option value="">{isArabic ? 'اختر الحصة والتاريخ' : 'Choose lesson/date'}</option>
                      {reportLessons.map((lesson) => <option key={lesson.id} value={lesson.id} disabled={lesson.status !== 'completed'}>{new Date(lesson.session_date).toLocaleDateString(isArabic ? 'ar-EG' : 'en-US')} · {lesson.lesson_topic || (isArabic ? 'بدون عنوان' : 'Untitled')} · {lesson.status === 'completed' ? (isArabic ? 'منتهية - قابلة للإرسال' : 'Completed - ready to send') : (isArabic ? 'مفتوحة - أنهي الحصة أولًا' : 'Open - finish lesson first')}</option>)}
                    </select>
                  </div>
                  {reportGroup && reportLessons.some((lesson) => lesson.status !== 'completed') && <p className="mt-2 text-xs text-amber-300">{isArabic ? 'الحصص المفتوحة ظاهرة للتوضيح فقط ولا يمكن اختيارها أو إرسال تقارير عنها. اضغط إنهاء الحصة أولًا.' : 'Open lessons are shown for information only. Finish the lesson before selecting or sending reports.'}</p>}
                  {reportGroup && reportLessonId && <p className={`mt-2 text-xs ${reportLessonIsFinal ? 'text-emerald-300' : 'text-amber-300'}`}>{reportLessonIsFinal ? (isArabic ? `سيتم تجهيز ${reportStudents.length} تقريرًا لمجموعة ${reportGroup} لهذه الحصة المنتهية فقط.` : `${reportStudents.length} reports will be prepared for ${reportGroup} and this finalized lesson only.`) : (isArabic ? 'أنهِ الحصة أولًا عشان تقدر تبعت التقارير.' : 'Finish the lesson before sending reports.')}</p>}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                <ReportCard dataTour="reports-download-btn" icon="📊" title={t('daily_reports')} desc={t('daily_reports_desc')} action={t('send_daily_reports')} onClick={startDailyReportsQueue} />
                <ReportCard icon="📢" title={t('bulk_message')} desc={t('bulk_message_desc')} action={t('write_message')} onClick={startBulkMessageQueue} />
                <ReportCard icon="📈" title={t('full_analytics')} desc={t('full_analytics_desc')} action={t('open_analytics')} onClick={() => setAnalyticsOpen(true)} />
                <ReportCard icon="✉️" title={t('message_templates')} desc={t('message_templates_desc')} action={t('edit_templates')} onClick={() => setTemplatesOpen(true)} />
                <ReportCard icon="📱" title={t('qr_bulk_title')} desc={t('qr_bulk_desc')} action={t('qr_bulk_action')} onClick={startDailyQRQueue} />
                <ReportCard dataTour="reports-announcements-btn" icon="📣" title={t('announcements_board')} desc={t('announcements_board_desc')} action={t('open_announcements_board')} onClick={() => setAnnouncementsOpen(true)} />
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      </div>

      {/* FAB */}
      <div className="fixed bottom-20 md:bottom-6 left-4 z-30">
        {fabOpen && (
          <div className="mb-2 space-y-2 flex flex-col items-start">
            <FabAction icon="+" label={t('new_student')} onClick={() => { setStudentModal({ open: true, student: null }); setFabOpen(false) }} />
            <FabAction icon="📷" label={t('scan_qr_short')} onClick={() => { setQrOpen(true); setFabOpen(false) }} />
            <FabAction icon="📝" label={t('record_exam_short')} onClick={() => { setExamOpen(true); setFabOpen(false) }} />
          </div>
        )}
        <button onClick={() => setFabOpen((o) => !o)} className="w-14 h-14 rounded-full btn-glow shadow-lg flex items-center justify-center text-2xl font-black transition-transform" style={{ transform: fabOpen ? 'rotate(45deg)' : 'none' }} title={t('quick_actions')}>+</button>
      </div>

      {/* Bottom nav — mobile */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-[var(--surface)] backdrop-blur-xl border-t border-subtle flex justify-around items-center py-1.5 z-20">
        {SECTIONS.map(([key, icon, label]) => (
          <button key={key} onClick={() => { setActiveSection(key) }} className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] font-bold ${activeSection === key ? 'text-brand-gold-hover' : 'text-fg-subtle'}`}>
            <span className="text-lg leading-none">{icon}</span>
            <span className="truncate max-w-[56px]">{label.split(' ')[0]}</span>
          </button>
        ))}
      </nav>

      {/* Modals */}
      <StudentModal open={studentModal.open} student={studentModal.student} groups={groups} onClose={() => setStudentModal({ open: false, student: null })} onSave={saveStudent} isSaving={isSaving} />
      <ProfileModal onRemoveWarning={removeWarning} onEditPoints={editPoints} open={profileModal.open} student={profileModal.student} allStudents={students} exams={examScoresByStudent[profileModal.student?.id] || []} dailyLogs={todayLogsByStudent[profileModal.student?.id] || []} session={sessionLogsByGroup[profileModal.student?.group_name]} ranks={ranks} onClose={() => setProfileModal({ open: false, student: null })} onEdit={(s) => { setProfileModal({ open: false, student: null }); setStudentModal({ open: true, student: s }) }} onPlayGame={(s) => { setProfileModal({ open: false, student: null }); setGameModal({ open: true, studentId: s.id }) }} />
      <QRScannerModal open={qrOpen} onClose={() => setQrOpen(false)} students={students} onMarkPresent={(id) => { if (!activeLessonId) { showToast(isArabic ? 'افتح الحصة أولاً قبل مسح QR' : 'Open a lesson before scanning QR', 'error'); return }; setAttendance(id, 'حاضر', activeLessonId) }} />
      <LeaderboardModal open={leaderboardOpen} onClose={() => setLeaderboardOpen(false)} students={students} ranks={ranks} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onSave={saveSettings} onResetAllData={resetAllData} teacherId={effectiveTeacherId} teacherEmail={profile?.email || user?.email} isAssistant={isAssistant} />
      <TemplatesModal open={templatesOpen} onClose={() => setTemplatesOpen(false)} settings={settings} onSave={saveTemplates} />
      <ExamModal open={examOpen} onClose={() => setExamOpen(false)} students={students} groups={groups} onSave={saveExam} isSaving={isSaving} attendanceByStudent={examAttendanceByStudent} />
      <ExamsListModal open={examsListOpen} onClose={() => setExamsListOpen(false)} />
      <AnalyticsModal open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} students={students} examScoresByStudent={examScoresByStudent} />
      <AnnouncementsModal open={announcementsOpen} onClose={() => setAnnouncementsOpen(false)} teacherId={effectiveTeacherId} studentCount={students.length} showToast={showToast} />
      {!isAssistant && <BrandingModal open={brandingOpen} onClose={() => setBrandingOpen(false)} />}
      <MessageQueueModal open={queue.open} queue={queue.items} index={queue.index} onClose={() => updateQueue({ open: false, items: [], index: 0 })} onAdvance={() => updateQueue((q) => (q.index + 1 >= q.items.length ? { open: false, items: [], index: 0 } : { ...q, index: q.index + 1 }))} />
      <SessionHistoryModal open={historyModal.open} groupName={historyModal.group} onClose={() => setHistoryModal({ open: false, group: null })} />
      <UndoSnackbar visible={undoSnackbar.visible} message={undoSnackbar.message} onUndo={handleUndo} onRedo={handleRedo} canRedo={canRedo} onHistory={() => setHistoryModalOpen(true)} historyCount={getHistoryCount()} onDismiss={() => setUndoSnackbar({ visible: false, message: '' })} />
      <HistoryModal open={historyModalOpen} onClose={() => setHistoryModalOpen(false)} onRestore={handleHistoryRestore} onRedo={handleRedo} canRedo={canRedo} redoCount={getRedoCount()} />

      {/* QR Prompt */}
      {pendingQRStudent && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-card rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center space-y-4">
            <div className="text-4xl">📱</div>
            <h3 className="text-lg font-bold text-fg">{t('send_qr_title')} {pendingQRStudent.name}؟</h3>
            <p className="text-sm text-fg-subtle">{t('send_qr_desc')}</p>
            <div className="flex flex-col gap-3 items-center">
              <SendQrButton student={pendingQRStudent} template={settings.qr_message_template} className="w-full justify-center" />
              <button onClick={handleDismissQR} className="glass-input px-4 py-2 rounded-xl text-sm font-bold text-fg-subtle hover:bg-white/10 w-full">{t('no_thanks')}</button>
            </div>
          </div>
        </div>
      )}

      {editGroupOpen && <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl" dir={dir}><div className="flex items-center justify-between mb-4"><h3 className="text-lg font-black">{isArabic ? `تعديل ${editGroupForm.original}` : `Edit ${editGroupForm.original}`}</h3><button type="button" onClick={() => setEditGroupOpen(false)} className="text-slate-400 text-xl">×</button></div><form onSubmit={saveGroupEdit} className="space-y-3"><select required value={editGroupForm.stage} onChange={(e) => setEditGroupForm({ ...editGroupForm, stage: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm"><option value="">{isArabic ? 'اختر المرحلة الدراسية' : 'Choose stage'}</option>{STAGE_OPTIONS.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select><select required value={editGroupForm.day} onChange={(e) => setEditGroupForm({ ...editGroupForm, day: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm"><option value="">{isArabic ? 'اختر اليوم' : 'Choose weekday'}</option>{WEEKDAY_NAMES.map((day, index) => <option key={day} value={index}>{day}</option>)}</select><label className="block text-sm font-bold text-slate-600">{isArabic ? 'ساعة الحصة' : 'Lesson time'}<input type="time" required value={editGroupForm.time} onChange={(e) => setEditGroupForm({ ...editGroupForm, time: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm" /></label><button className="w-full rounded-xl bg-slate-900 py-3 font-black text-white">{isArabic ? 'حفظ التعديل' : 'Save changes'}</button></form></div></div>}
      {groupModalOpen && <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl"><div className="flex items-center justify-between mb-4"><h3 className="text-lg font-black">{isArabic ? 'إضافة مجموعة للحصص' : 'Add lesson group'}</h3><button onClick={() => setGroupModalOpen(false)} className="text-slate-400 text-xl">×</button></div><form onSubmit={addGroupFromLessons} className="space-y-3"><input required value={newGroupForm.name} onChange={(e) => setNewGroupForm({ ...newGroupForm, name: e.target.value })} placeholder={isArabic ? 'اسم المجموعة' : 'Group name'} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm" /><select required value={newGroupForm.stage} onChange={(e) => setNewGroupForm({ ...newGroupForm, stage: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm"><option value="">{isArabic ? 'اختر المرحلة الدراسية' : 'Choose stage'}</option>{STAGE_OPTIONS.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select><select required value={newGroupForm.day} onChange={(e) => setNewGroupForm({ ...newGroupForm, day: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm"><option value="">{isArabic ? 'اختر يوم الحصة' : 'Choose weekday'}</option>{WEEKDAY_NAMES.map((day, index) => <option key={day} value={index}>{day}</option>)}</select><label className="block text-sm font-bold text-slate-600">{isArabic ? 'ساعة الحصة' : 'Lesson time'}<input type="time" required value={newGroupForm.time} onChange={(e) => setNewGroupForm({ ...newGroupForm, time: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm" /></label><button className="w-full rounded-xl bg-slate-900 py-3 font-black text-white">{isArabic ? 'إضافة المجموعة' : 'Add group'}</button></form></div></div>}
      {bulkGroupOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="glass-card w-full max-w-md rounded-2xl p-5" dir={dir}><div className="flex items-center justify-between mb-4"><h3 className="text-lg font-black">{isArabic ? `نقل ${selectedStudents.length} طالب إلى مجموعة` : `Assign ${selectedStudents.length} students to a group`}</h3><button onClick={() => setBulkGroupOpen(false)} className="text-fg-subtle text-xl">×</button></div><p className="text-sm text-fg-muted mb-3">{isArabic ? 'اختر مجموعة موجودة بالفعل. لن يتم إنشاء مجموعة جديدة.' : 'Choose an existing group. No new group will be created.'}</p><select value={bulkGroupName} onChange={(e) => setBulkGroupName(e.target.value)} className="w-full glass-input rounded-xl px-3 py-3 text-sm mb-4"><option value="">{isArabic ? 'اختر المجموعة' : 'Choose group'}</option>{groups.filter((g) => g !== 'المجموعة الافتراضية' || groups.length === 1).map((g) => <option key={g} value={g}>{g}</option>)}</select><div className="flex gap-2"><button onClick={() => setBulkGroupOpen(false)} className="flex-1 rounded-xl py-3 glass-input font-bold">{isArabic ? 'إلغاء' : 'Cancel'}</button><button onClick={assignSelectedToGroup} disabled={!bulkGroupName || isSaving} className="flex-1 rounded-xl py-3 btn-glow font-black disabled:opacity-50">{isArabic ? 'تأكيد النقل' : 'Assign students'}</button></div></div></div>}
      <ConfirmDialog open={!!confirmDialog} title={confirmDialog?.title} message={confirmDialog?.message} danger={confirmDialog?.danger} confirmLabel={confirmDialog?.confirmLabel} onConfirm={() => { confirmDialog.resolve(true); setConfirmDialog(null) }} onCancel={() => { confirmDialog.resolve(false); setConfirmDialog(null) }} />
      <InteractiveTutorial activeSection={activeSection} onNavigate={setActiveSection} onOpenSettings={() => setSettingsOpen(true)} menuOpen={tourMenuOpen} onMenuClose={() => setTourMenuOpen(false)} />

    </div>
  )
}

function ToolBtn({ onClick, color, children, dataTour, disabled }) {
  const colors = { blue: 'bg-brand-gold/15 text-brand-gold-hover border-brand-gold/40 hover:bg-brand-gold/25', emerald: 'bg-neon-success/10 text-neon-success border-emerald-500/30 hover:bg-emerald-500/20', purple: 'bg-violet-500/10 text-violet-400 border-violet-500/30 hover:bg-violet-500/20', amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20', green: 'bg-[#25D366]/10 text-[#25D366] border-[#25D366]/50 hover:bg-[#25D366]/20', rose: 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20', gold: 'bg-brand-gold/15 text-brand-gold-hover border-brand-gold/40 hover:bg-brand-gold/25', slate: 'glass-input text-fg-muted border-subtle hover:bg-white/10' }
  return <button type="button" data-tour={dataTour} onClick={onClick} disabled={disabled} className={`tool-action-button border transition-all ${colors[color] || colors.slate} disabled:cursor-not-allowed disabled:opacity-40`}>{children}</button>
}

function FabAction({ icon, label, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 glass-card shadow-lg rounded-full pl-4 pr-2 py-2 text-sm font-bold text-fg hover:border-brand-gold/50">
      {label}
      <span className="w-8 h-8 rounded-full bg-brand-navy text-brand-gold flex items-center justify-center text-sm">{icon}</span>
    </button>
  )
}

function ReportCard({ icon, title, desc, action, onClick, dataTour }) {
  return (
    <article data-tour={dataTour} className="glass-card group flex min-h-[220px] flex-col rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-brand-gold/50 hover:shadow-lg sm:p-7">
      <div className="flex items-start justify-between gap-4"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-2xl text-white shadow-sm">{icon}</div><span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-fg-subtle">إجراء سريع</span></div>
      <p className="mt-6 text-lg font-black text-fg">{title}</p>
      <p className="mt-3 flex-1 text-sm leading-7 text-fg-muted">{desc}</p>
      <button onClick={onClick} type="button" className="mt-6 flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400">{action} <span className="mr-2" aria-hidden="true">←</span></button>
    </article>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="glass-card rounded-xl p-3 text-center">
      <p className="text-2xl font-black text-fg">{value}</p>
      <p className="text-fg-subtle text-xs mt-1">{label}</p>
    </div>
  )
}

function StudentRow({ student: s, index, ranks, points, hasWarning, absenceStreak, isSaving, pdfGenerating, showSaved, selected, onToggleSelect, onOpenProfile, onSetAttendance, onUpdateHW, onAdjustPoints, onEditPoints, onAddWarning, onRemoveWarning, onEdit, onDelete, onReport, onWarningMsg, onPromotionMsg }) {
  const rank = getStudentRank(s.points, ranks)
  return (
    <tr className={`student-table-row border-b border-subtle hover:bg-brand-gold/5 transition-colors ${selected ? 'bg-brand-gold/10' : index % 2 === 1 ? 'bg-white/[0.03]' : 'bg-transparent'}`}>
      <td className="p-3 text-center">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} onClick={(e) => e.stopPropagation()} className="w-4 h-4 accent-[#D4A373]" />
      </td>
      <td className="p-3 text-center text-fg-subtle font-bold">{index + 1}</td>
      <td className="p-3">
        <div className="flex items-center gap-1">
          {hasWarning && <span className="text-rose-400 text-sm" title="تراجع أكاديمي">📉</span>}
          {absenceStreak && <span className="text-rose-400 text-sm" title={`غياب متكرر (${absenceStreak} مرات)`}>🚨</span>}
          {s.warnings > 0 && <span className="text-rose-400 font-black text-[10px] bg-rose-500/20 px-1 rounded border border-rose-500/30">{s.warnings} 🚨</span>}
          <button onClick={onOpenProfile} className="font-black text-brand-gold-hover hover:text-brand-gold-hover">{s.name}</button>
        </div>
        <span className="text-[10px] text-fg-subtle font-mono glass-input px-1 rounded" dir="ltr">{s.code || 'N/A'}</span>
      </td>
      <td className="p-3 text-center text-xs">
        <div className="font-semibold text-fg">{s.stage}</div>
        <div className="text-fg-subtle">{s.group_name}</div>
      </td>
      <td className="p-3 text-center">
        <div className="text-lg font-black text-brand-gold-hover">{s.points} pt</div>
        <div className="text-[10px] text-brand-gold-hover/80 font-bold">🛡️ {rank}</div>
      </td>
      <td className="p-3 text-center">
        <div className="flex glass-input rounded p-0.5 border border-subtle w-fit mx-auto">
          <button onClick={() => onSetAttendance(s.id, 'حاضر')} className={`px-2 py-1 rounded text-xs font-bold ${s.attendance_status === 'حاضر' ? 'bg-emerald-600 text-fg' : 'text-fg-subtle'}`}>ح</button>
          <button onClick={() => onSetAttendance(s.id, 'غائب')} className={`px-2 py-1 rounded text-xs font-bold ${s.attendance_status === 'غائب' ? 'bg-rose-600 text-fg' : 'text-fg-subtle'}`}>غ</button>
        </div>
      </td>
      <td className="p-3 text-center">
        <select value={s.hw_status} onChange={(e) => onUpdateHW(s.id, e.target.value)} className="text-xs rounded p-1.5 font-bold border outline-none glass-input border-subtle text-fg-muted">
          <option value="لم يرصد">- الواجب -</option>
          <option value="مكتمل">✅ مكتمل</option>
          <option value="ناقص">⚠️ ناقص</option>
          <option value="لم يتم">❌ لم يتم</option>
        </select>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-1 justify-center flex-wrap max-w-[160px] mx-auto">
          {isSaving ? (
            <span className="text-brand-gold text-xs animate-pulse">⏳</span>
          ) : (
            <>
              <button onClick={() => onAdjustPoints(s.id, points.points_interact, 'إجابة وتفاعل')} title="تفاعل +" className="bg-neon-success/10 text-neon-success border border-emerald-500/30 px-1.5 py-1 rounded text-xs">🌟</button>
              <button onClick={() => onAdjustPoints(s.id, 5, 'إجابة ذهبية')} title="إجابة ذهبية" className="bg-brand-gold/10 text-brand-gold-hover border border-brand-gold/40 px-1.5 py-1 rounded text-xs">🧠</button>
              <button onClick={() => onAdjustPoints(s.id, 3, 'مساعدة زميل')} title="مساعدة زميل" className="bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/40 px-1.5 py-1 rounded text-xs">🤝</button>
              <button onClick={() => onAdjustPoints(s.id, points.points_interrupt, 'مخالفة سلوكية')} title="مشاغبة" className="bg-violet-500/10 text-violet-400 border border-violet-500/30 px-1.5 py-1 rounded text-xs">⚠️</button>
              <button onClick={() => onAddWarning(s.id)} title="إضافة إنذار" className="bg-red-600/20 text-neon-error border border-red-500/50 px-1.5 py-1 rounded text-xs">🚨+</button>
              {s.warnings > 0 && <button onClick={() => onRemoveWarning(s.id)} title="إزالة إنذار" className="bg-emerald-600/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-1 rounded text-xs">🚨−</button>}
              <button onClick={() => onEditPoints(s.id)} title="تعديل النقاط يدويًا" className="bg-sky-500/10 text-sky-300 border border-sky-500/30 px-1.5 py-1 rounded text-xs">✎</button>
            </>
          )}
          {/* FIX #6 — Visible Saved Feedback */}
          {showSaved && <span className="text-emerald-400 text-xs font-bold animate-pulse">✓</span>}
        </div>
      </td>
      <td className="p-3">
        <div className="flex flex-col items-center gap-1">
          <div className="flex gap-1">
            <button onClick={onReport} title="إرسال تقرير واتساب" disabled={pdfGenerating} className="bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/50 p-1.5 rounded-lg disabled:opacity-50">📊</button>
            <button onClick={onWarningMsg} title="إرسال إنذار" className="bg-rose-500/10 text-rose-400 border border-rose-500/30 p-1.5 rounded-lg">⚠️</button>
            <button onClick={onPromotionMsg} title="رسالة ترقية" className="bg-brand-gold/10 text-brand-gold-hover border border-brand-gold/40 p-1.5 rounded-lg">🎉</button>
          </div>
          <div className="flex gap-2 text-sm">
            <button onClick={onEdit} title="تعديل" className="text-brand-gold-hover hover:text-brand-gold-hover">✏️</button>
            <button onClick={onDelete} title="حذف" className="text-rose-400 hover:text-rose-300">🗑️</button>
          </div>
        </div>
      </td>
    </tr>
  )
}
