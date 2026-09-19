import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useWorkspace, useWorkspaceMeta, normalizeArabicSearch } from '../../store/WorkspaceStore'
import { useUI } from '../../shell/UIContext'
import { usePublishBar } from '../WorkflowBar'

// PERF (performance round): html5-qrcode (~230 KB minified) used to ship in
// the first bundle on every page even though the scanner sits behind one
// button. It is code-split now and streams in the first time the teacher
// opens the scanner.
const QRSessionScanner = lazy(() => import('../QRSessionScanner'))
const ScannerFallback = () => <div className="nk-row" style={{ opacity: 0.6 }}>…</div>

const STATUS_LABEL = { 'حاضر': 'حاضر', 'غائب': 'غائب', 'لم يرصد': 'لم يُرصد' }

// ═══════════════════════════════════════════════════════════════════════════
// ATTENDANCE TAB (rules 9–10 + UX restructure round)
// - Attendance is SESSION-specific (lesson_session_id): two sessions of the
//   same group in one week are two independent attendance events.
// - Marks persist instantly through the same RPC as production
//   (upsert_lesson_attendance) — no Save-then-continue step.
// - SEQUENTIAL WORKFLOW (default): one student in focus, mark → التالي →
//   next student. The persistent bottom bar is contextual:
//     · unrecorded  → primary = حاضر / غائب
//     · recorded    → primary = التالي (activated by recording)
//     · last student→ primary = متابعة إلى المرحلة التالية
//   Position and progress ("٧ من ٢٤") stay visible at all times.
// - LIST VIEW stays available (search / filters / bulk / QR) as the
//   secondary view — progressive disclosure, nothing removed.
// ═══════════════════════════════════════════════════════════════════════════
export default function AttendanceTab({ groupId, lessonOpen, onGoNext, onBar }) {
  const ws = useWorkspace()
  const wsMeta = useWorkspaceMeta()
  const ui = useUI()
  const { isArabic } = ws
  const [mode, setMode] = useState('focus') // focus (sequential) | list
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | present | absent | unrecorded
  const [qrOpen, setQrOpen] = useState(false)

  const students = ws.sessionStudentsFor(groupId)
  const attendanceMap = ws.lessonAttendanceByStudent

  // Sequential position: resume at the first unrecorded student.
  const statusOf = (s) => attendanceMap[s.id]?.status || 'لم يرصد'
  const [idx, setIdx] = useState(() => {
    const first = students.findIndex((s) => statusOf(s) === 'لم يرصد')
    return first >= 0 ? first : 0
  })

  // Group switched → restart the sequential flow at the first unrecorded.
  useEffect(() => {
    const first = students.findIndex((s) => statusOf(s) === 'لم يرصد')
    setIdx(first >= 0 ? first : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  // Clamp if the roster shrinks (defensive).
  useEffect(() => {
    if (idx > 0 && idx >= students.length) setIdx(Math.max(0, students.length - 1))
  }, [students.length, idx])

  const visible = useMemo(() => {
    const q = normalizeArabicSearch(search)
    return students.filter((s) => {
      const status = statusOf(s)
      if (filter === 'present' && status !== 'حاضر') return false
      if (filter === 'absent' && status !== 'غائب') return false
      if (filter === 'unrecorded' && status !== 'لم يرصد') return false
      if (!q) return true
      return normalizeArabicSearch([s.name, s.code, s.phone].filter(Boolean).join(' ')).includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, search, filter, attendanceMap])

  const counts = ws.countsForLesson(groupId)
  const markedCount = counts.present + counts.absent

  // ── Read-only view (completed session) — unchanged behavior ──────────────
  if (!lessonOpen) {
    return (
      <div>
        <div className="nk-notice mb-4">
          {isArabic
            ? 'هذه الحصة منتهية ومحفوظة — الحضور للعرض فقط. افتح حصة جديدة من التقرير أو الرئيسية للرصد.'
            : 'This session is completed and locked — attendance is read-only. Open a new session to record.'}
        </div>
        <div className="grid gap-2">
          {students.map((s) => {
            const status = attendanceMap[s.id]?.status || s.attendance_status
            return (
              <div key={s.id} className="nk-row">
                <span className="min-w-0">
                  <b className="truncate">{s.name}</b>
                  <small>حالة الحضور: {STATUS_LABEL[status] || status}</small>
                </span>
                <span className={`nk-pill ${status === 'حاضر' ? 'nk-pill-live' : status === 'غائب' ? 'nk-pill-danger' : 'nk-pill-neutral'}`}>
                  {STATUS_LABEL[status] || status}
                </span>
              </div>
            )
          })}
          {students.length === 0 && <p className="text-sm text-fg-muted text-center py-6">{isArabic ? 'لا يوجد طلاب في هذه المجموعة' : 'No students in this group'}</p>}
        </div>
      </div>
    )
  }

  // ── Sequential (focus) mode ───────────────────────────────────────────────
  const total = students.length
  const current = students[idx] || null
  const currentStatus = current ? statusOf(current) : null
  const recorded = Boolean(current) && currentStatus !== 'لم يرصد'
  const saving = Boolean(current) && wsMeta.savingIds.has(current.id)
  const saved = Boolean(current) && wsMeta.savedIds.has(current.id)
  const isLast = idx >= total - 1

  const mark = (st) => { if (current) ws.setAttendance(current.id, st, ws.activeLessonId) }
  const goNext = () => { if (!isLast) setIdx((i) => Math.min(total - 1, i + 1)) }
  const goPrev = () => { setIdx((i) => Math.max(0, i - 1)) }

  const progressMeta = `${isArabic ? `الطالب ${idx + 1} من ${total}` : `Student ${idx + 1} of ${total}`} · ${
    saving
      ? (isArabic ? '… جاري الحفظ' : 'Saving…')
      : saved || recorded
        ? `✓ ${isArabic ? 'محفوظ تلقائيًا' : 'Saved'}`
        : (isArabic ? 'الحفظ فوري بعد الرصد' : 'Auto-saves on mark')
  }`

  // ── Bar spec (serializable) + handlers — published to the workspace root
  const barData = mode === 'focus'
    ? {
        ariaLabel: isArabic ? 'إجراءات الحضور' : 'Attendance actions',
        primary: !recorded
          ? [
              { key: 'present', kind: 'present', label: `✓ ${isArabic ? 'حاضر' : 'Present'}`, disabled: !current || saving },
              { key: 'absent', kind: 'absent', label: `✗ ${isArabic ? 'غائب' : 'Absent'}`, disabled: !current || saving },
            ]
          : isLast
            ? [{ key: 'nextStep', kind: 'gold', label: isArabic ? 'متابعة — التفاعل والواجب ←' : 'Continue — Interaction & homework →', disabled: !onGoNext }]
            : [{ key: 'nextStudent', kind: 'gold', label: isArabic ? 'التالي ←' : 'Next →', disabled: false }],
        secondary: [
          { key: 'prevStudent', label: isArabic ? '→ السابق' : '← Previous', disabled: idx === 0, title: isArabic ? 'الطالب السابق' : 'Previous student' },
          ...(recorded && !isLast
            ? [{ key: 'clear', label: `⟲ ${isArabic ? 'مسح' : 'Clear'}`, disabled: saving, title: isArabic ? 'مسح الرصد' : 'Clear mark' }]
            : []),
          { key: 'openList', label: isArabic ? '☰ القائمة' : '☰ List', disabled: false, title: isArabic ? 'عرض القائمة الكاملة — بحث وفلترة وأدوات جماعية' : 'Full list — search, filters, bulk tools' },
          { key: 'openQR', label: '⛶ QR', disabled: false, title: isArabic ? 'مسح QR الطالب' : 'Scan student QR' },
        ],
        meta: progressMeta,
      }
    : {
        ariaLabel: isArabic ? 'إجراءات الحضور' : 'Attendance actions',
        primary: [{ key: 'nextStep', kind: 'gold', label: isArabic ? 'متابعة — التفاعل والواجب ←' : 'Continue — Interaction & homework →', disabled: !onGoNext }],
        secondary: [
          { key: 'saveSync', label: `💾 ${isArabic ? 'حفظ' : 'Save'}`, disabled: false, title: isArabic ? 'تأكيد المزامنة — كل علامة بتتحفظ فورًا' : 'Confirm sync — every mark persists instantly' },
          { key: 'openFocus', label: `⚡ ${isArabic ? 'الرصد التسلسلي' : 'Sequential mode'}`, disabled: false, title: isArabic ? 'رصد طالب بطالب — أسرع للمجموعات الكبيرة' : 'Student-by-student entry — faster for big groups' },
        ],
        meta: progressMeta,
      }

  const barHandlers = {
    present: () => mark('حاضر'),
    absent: () => mark('غائب'),
    clear: () => mark('لم يرصد'),
    nextStudent: goNext,
    prevStudent: goPrev,
    openList: () => setMode('list'),
    openFocus: () => {
      const first = students.findIndex((s) => statusOf(s) === 'لم يرصد')
      setIdx(first >= 0 ? first : 0)
      setMode('focus')
    },
    openQR: () => setQrOpen(true),
    saveSync: () => ws.syncPendingSaves(),
    nextStep: () => onGoNext?.(),
  }
  usePublishBar(lessonOpen ? onBar : null, lessonOpen ? barData : null, barHandlers)

  return (
    <div>
      {mode === 'focus' && current && (
        <>
          {/* Focus card — ONE student, ONE goal */}
          <div className="nk-focus-card" aria-live="polite">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="nk-focus-muted text-[.7rem] font-black tracking-wide">
                {isArabic ? `الطالب ${idx + 1} من ${total}` : `Student ${idx + 1} of ${total}`}
              </span>
              <span className={`nk-focus-state ${currentStatus === 'حاضر' ? 'nk-focus-state--present' : currentStatus === 'غائب' ? 'nk-focus-state--absent' : 'nk-focus-state--none'}`}>
                {currentStatus === 'حاضر' ? `✓ ${isArabic ? 'حاضر' : 'Present'}` : currentStatus === 'غائب' ? `✗ ${isArabic ? 'غائب' : 'Absent'}` : (isArabic ? 'لم يُرصد بعد' : 'Not marked yet')}
              </span>
            </div>
            <div className="nk-focus-name">{current.name}</div>
            <small className="nk-focus-muted text-[.72rem] block">
              {[current.code, current.stage].filter(Boolean).join(' · ')}
            </small>
            <div className="flex items-center gap-2 mt-3">
              <span className="nk-bar flex-1"><span style={{ width: `${total ? Math.round((markedCount / total) * 100) : 0}%` }} /></span>
              <span className="nk-focus-muted text-[.66rem] font-extrabold shrink-0">
                {isArabic ? `تم رصد ${markedCount}/${total}` : `${markedCount}/${total} marked`}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-2 min-h-[1.1rem]">
              {saving && <span className="nk-focus-muted text-[.68rem] font-extrabold">{isArabic ? '… جاري الحفظ' : 'Saving…'}</span>}
              {!saving && saved && <span className="nk-focus-saved">✓ {isArabic ? 'تم الحفظ' : 'Saved'}</span>}
              {!saving && !saved && recorded && <span className="nk-focus-saved">✓ {isArabic ? `تم الرصد: ${STATUS_LABEL[currentStatus] || currentStatus}` : `Recorded: ${STATUS_LABEL[currentStatus] || currentStatus}`}</span>}
              {!recorded && <span className="nk-focus-muted text-[.68rem]">{isArabic ? 'رصد الحالة يُفعّل زر «التالي»' : 'Marking activates Next'}</span>}
            </div>
          </div>

          {/* Counters — live, small, non-interactive */}
          <div className="flex flex-wrap gap-2 mt-3 text-[.68rem] font-extrabold">
            <span className="nk-pill nk-pill-live">{isArabic ? 'حاضر' : 'Present'}: {counts.present}</span>
            <span className="nk-pill nk-pill-danger">{isArabic ? 'غائب' : 'Absent'}: {counts.absent}</span>
            <span className="nk-pill nk-pill-pending">{isArabic ? 'لم يُرصد' : 'Unrecorded'}: {counts.unrecorded}</span>
          </div>
        </>
      )}

      {mode === 'list' && (
        <>
          <div className="nk-notice mb-4">
            {isArabic
              ? 'الحضور مستقل لكل حصة — حصة الأحد وحصة الأربعاء حدثان منفصلان. الغائبون لا يظهرون في مرحلة الدرجات ولا يحصلون على صفر تلقائيًا. رصد كل طالب ليس إلزاميًا: عدم رصد طالب لا يمنع التقدم.'
              : 'Attendance is session-specific — Sunday and Wednesday are independent events. Absent students are excluded from grading and never auto-zeroed. Marking every student is not required: unrecorded students never block progress.'}
          </div>

          {/* Toolbar: search + filters + bulk + QR + sequential toggle */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              className="glass-input rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-[180px]"
              placeholder={isArabic ? '🔍 بحث بالاسم أو الكود أو الهاتف...' : 'Search name / code / phone...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={isArabic ? 'بحث سريع' : 'Quick search'}
            />
            <div className="flex rounded-xl overflow-hidden border border-subtle">
              {[
                ['all', isArabic ? 'الكل' : 'All'],
                ['unrecorded', isArabic ? 'لم يُرصد' : 'Unrecorded'],
                ['present', isArabic ? 'حاضر' : 'Present'],
                ['absent', isArabic ? 'غائب' : 'Absent'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className="px-3 py-2 text-[.72rem] font-extrabold"
                  style={filter === key
                    ? { background: 'var(--brand-navy)', color: '#fff' }
                    : { background: 'var(--surface-container)', color: 'var(--fg-muted)' }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="btn-ghost rounded-xl px-3 py-2.5 text-[.78rem] font-extrabold" onClick={() => setQrOpen(true)}>
              ⛶ {isArabic ? 'مسح QR' : 'Scan QR'}
            </button>
            <button className="btn-gold rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold" onClick={() => ws.markAllPresent(groupId, ws.activeLessonId)}>
              ✓ {isArabic ? 'الكل حاضر' : 'All present'}
            </button>
            <button className="btn-ghost rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold" onClick={() => ws.markGroupAbsences(ws.activeLessonId)}>
              ✗ {isArabic ? 'رصد الغائبين' : 'Mark absences'}
            </button>
          </div>

          {/* Counts strip */}
          <div className="flex flex-wrap gap-2 mb-4 text-[.7rem] font-extrabold">
            <span className="nk-pill nk-pill-neutral">{isArabic ? 'الطلاب' : 'Students'}: {counts.total}</span>
            <span className="nk-pill nk-pill-live">{isArabic ? 'حاضر' : 'Present'}: {counts.present}</span>
            <span className="nk-pill nk-pill-danger">{isArabic ? 'غائب' : 'Absent'}: {counts.absent}</span>
            <span className="nk-pill nk-pill-pending">{isArabic ? 'لم يُرصد' : 'Unrecorded'}: {counts.unrecorded}</span>
          </div>

          {/* Rows — Present / Absent / Clear(neutral). Tap the row (not a button)
              to jump into the sequential flow at that student. */}
          <div className="grid gap-2">
            {visible.map((s) => {
              const row = attendanceMap[s.id]
              const status = row?.status || 'لم يرصد'
              const savingRow = wsMeta.savingIds.has(s.id)
              const savedRow = wsMeta.savedIds.has(s.id)
              const listIdx = students.findIndex((x) => x.id === s.id)
              return (
                <div
                  key={s.id}
                  className="nk-row cursor-pointer"
                  onClick={(e) => {
                    if (e.target.closest('button')) return
                    setIdx(listIdx >= 0 ? listIdx : 0)
                    setMode('focus')
                  }}
                  title={isArabic ? 'اضغط لرصد هذا الطالب بالتسلسل' : 'Open this student in sequential mode'}
                >
                  <span className="min-w-0">
                    <b className="truncate">{s.name}{savingRow ? ' …' : ''}</b>
                    <small>
                      حالة الحضور: {STATUS_LABEL[status] || status}
                      {savedRow ? ' · ✓ تم الحفظ' : ''}
                    </small>
                  </span>
                  <span className="nk-seg" role="group" aria-label={`${s.name} attendance`}>
                    <button
                      className={status === 'حاضر' ? 'nk-on-present' : ''}
                      aria-pressed={status === 'حاضر'}
                      disabled={savingRow}
                      onClick={() => ws.setAttendance(s.id, 'حاضر', ws.activeLessonId)}
                    >
                      {isArabic ? 'حاضر' : 'Present'}
                    </button>
                    <button
                      className={status === 'غائب' ? 'nk-on-absent' : ''}
                      aria-pressed={status === 'غائب'}
                      disabled={savingRow}
                      onClick={() => ws.setAttendance(s.id, 'غائب', ws.activeLessonId)}
                    >
                      {isArabic ? 'غائب' : 'Absent'}
                    </button>
                    <button
                      className={status === 'لم يرصد' ? 'nk-on-neutral' : ''}
                      aria-pressed={status === 'لم يرصد'}
                      title={isArabic ? 'مسح الرصد (neutral)' : 'Clear to neutral'}
                      disabled={savingRow || status === 'لم يرصد'}
                      onClick={() => ws.setAttendance(s.id, 'لم يرصد', ws.activeLessonId)}
                    >
                      ⟲
                    </button>
                  </span>
                </div>
              )
            })}
            {visible.length === 0 && (
              <p className="text-center py-6 text-sm text-fg-muted">{isArabic ? 'لا نتائج مطابقة' : 'No matching students'}</p>
            )}
          </div>
        </>
      )}

      {/* The persistent contextual workflow bar is published to the workspace
          root (see usePublishBar) — one primary action per state. */}

      <Suspense fallback={qrOpen ? <ScannerFallback /> : null}>
        <QRSessionScanner
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          students={ws.students}
          activeLessonId={ws.activeLessonId}
        markPresent={async (studentId) => {
          try {
            await ws.setAttendance(studentId, 'حاضر', ws.activeLessonId)
            return true
          } catch { return false }
        }}
        />
      </Suspense>
    </div>
  )
}
