import { Suspense, lazy, useMemo, useState, useEffect } from 'react'
import { useWorkspace, useWorkspaceMeta, normalizeArabicSearch } from '../../store/WorkspaceStore'

// PERF (performance round): html5-qrcode (~230 KB minified) streams in the
// first time the teacher actually opens the scanner — never up front.
const QRSessionScanner = lazy(() => import('../QRSessionScanner'))
const ScannerFallback = () => <div className="nk-row" style={{ opacity: 0.6 }}>…</div>

const STATUS_LABEL = { 'حاضر': 'حاضر', 'غائب': 'غائب', 'لم يرصد': 'لم يُرصد' }

// ═══════════════════════════════════════════════════════════════════════════
// ATTENDANCE TAB — COMPACT LIST (mobile UX restructure, spec 6–13, 30–32)
//
// The sequential student-by-student wizard is REMOVED. Attendance is ONE
// compact list the teacher scans and marks directly:
//
//   [Exit Focus]  Attendance  [status]
//   [🔍 search ……………………]  [⛶ QR]
//   student row  [حاضر] [غائب]
//   student row  [حاضر] [غائب]
//   …
//   ── Complete Attendance ──   ← explicit stage completion (spec 13)
//
// - Search is INTEGRATED: type → the list filters in place → keep the
//   keyboard open → mark directly from the results → clear → next. With
//   `interactive-widget=resizes-content` the whole flow stays above the
//   keyboard (spec 9–10). No separate search screen, no scrolling hunt.
// - Marks persist INSTANTLY through the production RPC (upsert_lesson_attendance)
//   — every tap is already autosave (spec 25–26). Offline marks queue.
// - "Complete Attendance" is an explicit teacher action — task progress is
//   NOT derived from the percentage of marked students (spec 13).
// - Session-level absent answer (spec 30–32): who was absent THIS session +
//   absence reports, shown only when absentees exist (context before capability).
// ═══════════════════════════════════════════════════════════════════════════
export default function AttendanceTab({ groupId, lessonOpen, onCompleteStage, absentIntent }) {
  const ws = useWorkspace()
  const wsMeta = useWorkspaceMeta()
  const { isArabic } = ws
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | present | absent | unrecorded
  const [qrOpen, setQrOpen] = useState(false)

  const students = ws.sessionStudentsFor(groupId)
  const attendanceMap = ws.lessonAttendanceByStudent
  const counts = ws.countsForLesson(groupId)

  const statusOf = (s) => attendanceMap[s.id]?.status || 'لم يرصد'

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

  // "View absent" jump from the Report tab ribbon (teacher request): when the
  // counter changes, pre-filter the list to the absent students and scroll up.
  useEffect(() => {
    if (!absentIntent) return
    setFilter('absent')
    setSearch('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [absentIntent])

  const savingAny = wsMeta.savingIds.size > 0

  // ── Read-only view (completed session) — same compact list, no controls ──
  if (!lessonOpen) {
    return (
      <div>
        <div className="nk-notice mb-4">
          {isArabic
            ? 'هذه الحصة منتهية ومحفوظة — الحضور للعرض فقط. افتح حصة جديدة من التقرير أو الرئيسية للرصد.'
            : 'This session is completed and locked — attendance is read-only. Open a new session to record.'}
        </div>
        <input
          className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full mb-3"
          placeholder={isArabic ? '🔍 بحث بالاسم أو الكود...' : 'Search name / code...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={isArabic ? 'بحث سريع' : 'Quick search'}
        />
        <div className="grid gap-2">
          {visible.map((s) => {
            const status = attendanceMap[s.id]?.status || s.attendance_status
            return (
              <div key={s.id} className="nk-att-row">
                <span className="nk-att-row__name">
                  <b className="truncate">{s.name}</b>
                  <small>{STATUS_LABEL[status] || status}</small>
                </span>
                <span className={`nk-pill ${status === 'حاضر' ? 'nk-pill-live' : status === 'غائب' ? 'nk-pill-danger' : 'nk-pill-neutral'}`}>
                  {STATUS_LABEL[status] || status}
                </span>
              </div>
            )
          })}
          {visible.length === 0 && <p className="text-sm text-fg-muted text-center py-6">{isArabic ? (search ? 'لا نتائج مطابقة' : 'لا يوجد طلاب في هذه المجموعة') : (search ? 'No matching students' : 'No students in this group')}</p>}
        </div>
      </div>
    )
  }


  return (
    <div>
      {/* TOP ACTION — inline-END (top-left AR / top-right EN), teacher request */}
      <div className="flex justify-end mb-2">
        <button
          className="btn-gold rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold !min-h-[2.75rem]"
          onClick={() => onCompleteStage?.()}
        >
          ✓ {isArabic ? 'إتمام الحضور والمتابعة ←' : 'Complete attendance →'}
        </button>
      </div>

      {/* Sticky tools — search stays reachable while the list scrolls; with
          resizes-content the results remain visible ABOVE the keyboard. */}
      <div className="nk-att-tools">
        <input
          className="glass-input rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-0"
          placeholder={isArabic ? '🔍 اكتب اسم الطالب...' : 'Type a student name...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          enterKeyHint="search"
          autoComplete="off"
          aria-label={isArabic ? 'بحث سريع عن طالب' : 'Quick student search'}
        />
        <button className="nk-wf-ghost shrink-0" onClick={() => setQrOpen(true)} title={isArabic ? 'مسح QR الطالب' : 'Scan student QR'}>
          ⛶ QR
        </button>
      </div>

      {/* Filter chips + live counts — compact, horizontally scrollable */}
      <div className="nk-att-chips" role="group" aria-label={isArabic ? 'فلترة القائمة' : 'Filter list'}>
        {[
          ['all', isArabic ? `الكل (${counts.total})` : `All (${counts.total})`],
          ['unrecorded', isArabic ? `لم يُرصد (${counts.unrecorded})` : `Unmarked (${counts.unrecorded})`],
          ['present', isArabic ? `حاضر (${counts.present})` : `Present (${counts.present})`],
          ['absent', isArabic ? `غائب (${counts.absent})` : `Absent (${counts.absent})`],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={filter === key ? 'nk-att-chip nk-att-chip--on' : 'nk-att-chip'}
          >
            {label}
          </button>
        ))}
        {/* Bulk shortcuts (kept from the removed bottom bar, now tiny and
            non-blocking): mark everyone present / mark the unrecorded absent.
            The absence RPC previously failed ('تعذر رصد الغائبين') — the store
            now uses the same per-student path as manual marking. */}
        <button
          className="nk-att-chip shrink-0"
          disabled={savingAny}
          onClick={() => ws.markAllPresent(groupId, ws.activeLessonId)}
          title={isArabic ? 'رصد كل الطلاب حاضر دفعة واحدة' : 'Mark everyone present in one tap'}
        >
          ✓ {isArabic ? 'الكل حاضر' : 'All present'}
        </button>
        <button
          className="nk-att-chip shrink-0"
          disabled={savingAny}
          onClick={() => ws.markGroupAbsences(groupId, ws.activeLessonId)}
          title={isArabic ? 'رصد غير المرصد غائبًا' : 'Mark unmarked students absent'}
        >
          ✗ {isArabic ? 'الباقي غائبًا' : 'Rest absent'}
        </button>
      </div>

      {/* The list — compact rows, direct Present/Absent taps, one tap per mark */}
      <div className="grid gap-1.5 nk-att-list">
        {visible.map((s) => {
          const status = statusOf(s)
          const savingRow = wsMeta.savingIds.has(s.id)
          const savedRow = wsMeta.savedIds.has(s.id)
          return (
            <div key={s.id} className={`nk-att-row${status === 'حاضر' ? ' nk-att-row--present' : status === 'غائب' ? ' nk-att-row--absent' : ''}`}>
              <span className="nk-att-row__name">
                <b className="truncate">
                  {s.name}{savingRow ? ' …' : ''}
                  {status === 'غائب' && (s.warnings || 0) > 0 && (
                    <span className="nk-pill nk-pill-danger !text-[.58rem] ms-1.5 align-middle" title={isArabic ? 'الإنذارات المسجلة' : 'Recorded warnings'}>⚠ {s.warnings}</span>
                  )}
                </b>
                <small>
                  {savedRow ? `✓ ${isArabic ? 'تم الحفظ' : 'Saved'}` : [s.code, s.stage].filter(Boolean).join(' · ') || (STATUS_LABEL[status] || status)}
                </small>
              </span>
              <span className="nk-seg nk-seg--att" role="group" aria-label={`${s.name} attendance`}>
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
                  title={isArabic ? 'مسح الرصد' : 'Clear mark'}
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

      {/* The primary "Complete Attendance" action lives at the TOP of this
          tab (inline-END); the sticky bottom bar no longer exists. */}

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
