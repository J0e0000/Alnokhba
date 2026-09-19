import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace, useWorkspaceMeta, normalizeArabicSearch } from '../../store/WorkspaceStore'
import { usePublishBar } from '../WorkflowBar'
import { studentsNeedPhrase } from '../../lib/helpers'

const QRSessionScanner = lazy(() => import('../QRSessionScanner'))
const ScannerFallback = () => <div className="nk-row" style={{ opacity: 0.6 }}>…</div>

const HW_LABEL = { 'مكتمل': 'مكتمل', 'تم': 'مكتمل', 'ناقص': 'ناقص', 'لم يتم': 'لم يتم', 'لم يرصد': 'لم يُرصد' }

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTION + HOMEWORK TAB (rule 11 + speed round)
// - One pipeline tab. Interaction = the existing points system (behavior_logs
//   + students.points — same writes as production). Homework = the existing
//   per-lesson homework status (upsert_lesson_homework RPC).
// - Only APPLICABLE students appear: default view excludes absent students
//   (they cannot interact and receive no homework).
// - 'completed' homework must persist as مكتمل — the mirror field and the
//   lesson row are written together, exactly like production.
//
// LIST MODE (user round: "شيل موضوع ان كل طالب اختار حاجته و ادوس next —
// خليها قائمة و اقدر اخش علي اللي بعدها من زرار next"):
// - The SEQUENTIAL one-student focus card is REMOVED. The tab is ONE LIST:
//   every student is a row with their interaction + homework controls inline
//   — everything visible, every click saves instantly (same writes).
// - The bar's gold «التالي» WALKS the visible list: highlights the next row
//   and scrolls to it. At the end of the list it advances to Exams (gated
//   like every advance — blockers panel, never silent).
// - Jump tools stay: search by name/code, completeness filters, tapping a
//   row sets the walk position, and QR scan (pick mode — jumps to the
//   scanned row, never writes attendance).
// - Position (studentId) persists in sessionStorage per group — a reload or
//   crash resumes on the same row (highlight + scroll).
// ═══════════════════════════════════════════════════════════════════════════
export default function InteractionHomeworkTab({ groupId, lessonOpen, missingFocus, onClearFocus, onBar, onAdvance, missingCount, onGoPrev }) {
  const ws = useWorkspace()
  const wsMeta = useWorkspaceMeta()
  const { isArabic } = ws
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('present') // present | all | absent
  const [intFilter, setIntFilter] = useState('all') // all | done | missing  (interaction completeness)
  const [hwFilter, setHwFilter] = useState('all') // all | done | partial | missing (homework completeness)
  const [qrOpen, setQrOpen] = useState(false)
  const [currentId, setCurrentId] = useState(null) // highlighted walk position

  const attendanceMap = ws.lessonAttendanceByStudent
  const groupStudents = ws.sessionStudentsFor(groupId)

  // Per-student completeness flags — same rules as the workspace gating:
  // interaction = positive interaction log (present students only);
  // homework = explicit homework state (applicable = non-absent students).
  const flag = (s) => {
    const status = attendanceMap[s.id]?.status || (lessonOpen ? 'لم يرصد' : s.attendance_status)
    const hw = attendanceMap[s.id]?.homework_status || (lessonOpen ? 'لم يرصد' : s.hw_status)
    const isPresent = status === 'حاضر'
    const isAbsent = status === 'غائب'
    const hasInteraction = isPresent && (ws.todayLogsByStudent[s.id] || []).some((l) => l.points_delta > 0 && /تفاعل|ذهبية|مساعدة|نقاط/.test(l.note || ''))
    const hwDone = hw === 'مكتمل' || hw === 'تم'
    const hwPartial = hw === 'ناقص'
    const hwMissing = !isAbsent && (hw === 'لم يرصد' || !hw)
    const complete = hasInteraction && !hwMissing
    return { status, hw, isPresent, isAbsent, hasInteraction, hwDone, hwPartial, hwMissing, complete }
  }

  // Applicable = PRESENT students — completion math + empty-state copy.
  const applicable = useMemo(
    () => groupStudents.filter((s) => flag(s).isPresent),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupStudents, attendanceMap, lessonOpen, ws.todayLogsByStudent],
  )

  const counts = ws.countsForLesson(groupId)

  const rows = useMemo(() => {
    const q = normalizeArabicSearch(search)
    return groupStudents.filter((s) => {
      const f = flag(s)
      // Shortcut from the advance bar: ONLY students who still need handling.
      if (missingFocus) {
        const needsAttention = (f.isPresent && !f.hasInteraction) || f.hwMissing
        if (!needsAttention) return false
      } else {
        if (filter === 'present' && !f.isPresent) return false
        if (filter === 'absent' && !f.isAbsent) return false
        if (intFilter === 'done' && !f.hasInteraction) return false
        if (intFilter === 'missing' && (f.isAbsent || f.hasInteraction)) return false
        if (hwFilter === 'done' && !f.hwDone) return false
        if (hwFilter === 'partial' && !f.hwPartial) return false
        if (hwFilter === 'missing' && !f.hwMissing) return false
      }
      if (!q) return true
      return normalizeArabicSearch([s.name, s.code].filter(Boolean).join(' ')).includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupStudents, search, filter, intFilter, hwFilter, attendanceMap, lessonOpen, missingFocus, ws.todayLogsByStudent])

  // ── Walk position: restore the saved row, else the first incomplete one ──
  const restoredRef = useRef('')
  useEffect(() => {
    if (!rows.length || restoredRef.current === groupId) return
    restoredRef.current = groupId
    let target = -1
    try {
      const saved = JSON.parse(sessionStorage.getItem('nokhba_ws_int_pos') || 'null')
      if (saved?.groupId === groupId && saved.studentId) target = rows.findIndex((s) => s.id === saved.studentId)
    } catch { /* ignore */ }
    if (target < 0) target = rows.findIndex((s) => !flag(s).complete)
    setCurrentId(target >= 0 ? rows[target].id : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, rows.length])

  // Blockers-panel shortcut (missingFocus): start the walk at the first
  // filtered (missing) row.
  useEffect(() => {
    if (!missingFocus) return
    setCurrentId(rows[0]?.id || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingFocus])

  // Persist position (studentId — survives roster reshuffles better than index).
  useEffect(() => {
    try { sessionStorage.setItem('nokhba_ws_int_pos', JSON.stringify({ groupId, studentId: currentId })) } catch { /* ignore */ }
  }, [groupId, currentId])

  // Keep the current row in view — walk steps, jumps, AND reload restore
  // ("سيبني مكاني"): after a refresh the teacher lands on the same row,
  // highlighted and scrolled into view.
  useEffect(() => {
    if (!currentId) return
    const el = document.getElementById(`nk-int-row-${currentId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentId])

  // ── Walk the visible list ─────────────────────────────────────────────────
  const currentIdx = rows.findIndex((s) => s.id === currentId)
  const hasNext = rows.length > 0 && currentIdx < rows.length - 1
  const goNextRow = () => {
    if (!rows.length) { onAdvance?.(); return }
    if (currentIdx < 0) setCurrentId(rows[0].id)
    else if (currentIdx < rows.length - 1) setCurrentId(rows[currentIdx + 1].id)
    else onAdvance?.() // end of the list → continue to Exams (gated)
  }
  const goPrevRow = () => { if (currentIdx > 0) setCurrentId(rows[currentIdx - 1].id) }
  const jumpToStudent = (studentId) => {
    if (!rows.some((s) => s.id === studentId)) {
      // Filtered out — reset the filters (and the missing-only shortcut) so
      // the row is visible, then highlight it.
      if (missingFocus) onClearFocus?.()
      setSearch(''); setIntFilter('all'); setHwFilter('all'); setFilter('present')
    }
    setCurrentId(studentId)
  }

  const interactionButtons = [
    { label: '🌟 ' + (isArabic ? 'تفاعل' : 'Interact'), amount: ws.settings?.points_interact ?? 3, reason: isArabic ? 'إجابة وتفاعل' : 'Interaction' },
    { label: '🧠 ' + (isArabic ? 'إجابة ذهبية' : 'Golden answer'), amount: 5, reason: isArabic ? 'إجابة ذهبية' : 'Golden answer' },
    { label: '🤝 ' + (isArabic ? 'مساعدة زميل' : 'Helped peer'), amount: 3, reason: isArabic ? 'مساعدة زميل' : 'Helped a peer' },
    { label: '⚠ ' + (isArabic ? 'مخالفة' : 'Violation'), amount: ws.settings?.points_interrupt ?? -3, reason: isArabic ? 'مخالفة سلوكية' : 'Behavior violation' },
  ]

  const hwOptions = [
    ['مكتمل', isArabic ? 'مكتمل' : 'Done', 'nk-on-hw-done'],
    ['ناقص', isArabic ? 'ناقص' : 'Partial', 'nk-on-hw-partial'],
    ['لم يتم', isArabic ? 'لم يتم' : 'Missing', 'nk-on-hw-missing'],
  ]

  // ── Bar spec (serializable) + handlers — published to the workspace root.
  // ALWAYS called (stable hook order) — null in the read-only completed view.
  const total = applicable.length
  const doneCount = applicable.filter((s) => flag(s).complete).length
  const progressMeta = missingCount > 0
    ? studentsNeedPhrase(missingCount, isArabic, isArabic ? 'تفاعل / واجب' : 'input')
    : (isArabic ? `مكتمل ${doneCount} من ${total} ✓` : `${doneCount}/${total} complete ✓`)

  const barData = !lessonOpen ? null : {
    ariaLabel: isArabic ? 'إجراءات التفاعل والواجب' : 'Interaction & homework actions',
    primary: [hasNext
      ? { key: 'next', kind: 'gold', label: isArabic ? 'التالي ←' : 'Next →', disabled: false }
      : { key: 'next', kind: 'gold', label: isArabic ? 'متابعة — الامتحانات ←' : 'Continue — Exams →', disabled: !onAdvance }],
    secondary: [
      { key: 'prevRow', label: isArabic ? '↑ السابق' : '↑ Previous', disabled: currentIdx <= 0, title: isArabic ? 'الطالب اللي قبله في القائمة' : 'Previous student in the list' },
      { key: 'prevTab', label: isArabic ? '→ السابق — الحضور' : '← Previous — Attendance', disabled: !onGoPrev },
      { key: 'openQR', label: '⛶ QR', disabled: false, title: isArabic ? 'امسح كود الطالب للانتقال إليه في القائمة' : 'Scan a student QR to jump to them in the list' },
    ],
    meta: progressMeta,
  }

  usePublishBar(onBar, barData, {
    next: goNextRow,
    prevRow: goPrevRow,
    prevTab: () => onGoPrev?.(),
    openQR: () => setQrOpen(true),
  })

  // ── Read-only view (completed session) ────────────────────────────────────
  if (!lessonOpen) {
    return (
      <div>
        <div className="nk-notice mb-4">
          {isArabic
            ? 'التفاعل والواجب يظهران للحاضرين — الغائبون مستثنون تلقائيًا. هذه الحصة منتهية — للعرض فقط.'
            : 'Interaction & homework apply to present students — absentees are excluded automatically. This session is completed — read-only.'}
        </div>
        <div className="grid gap-2.5">
          {groupStudents.map((s) => {
            const row = attendanceMap[s.id]
            const status = row?.status || s.attendance_status
            const hw = row?.homework_status || s.hw_status
            const isAbsent = status === 'غائب'
            return (
              <div key={s.id} className="nk-row !items-start flex-col gap-2.5" style={{ opacity: isAbsent ? 0.75 : 1 }}>
                <div className="flex items-center justify-between gap-2 w-full min-w-0">
                  <span className="min-w-0">
                    <b className="truncate">{s.name}</b>
                    <small>{isArabic ? 'الحضور' : 'Attendance'}: {status}</small>
                  </span>
                  {isAbsent && <span className="nk-pill nk-pill-danger">{isArabic ? 'غائب — غير applicable' : 'Absent — excluded'}</span>}
                </div>
                <small className="text-fg-muted">
                  {isArabic ? `الواجب: ${HW_LABEL[hw] || hw}` : `Homework: ${HW_LABEL[hw] || hw}`} — {isArabic ? 'حصة منتهية (عرض فقط)' : 'completed session (read-only)'}
                </small>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="nk-notice mb-4">
        {isArabic
          ? 'قائمة الحاضرين — تفاعل وواجب كل طالب في صفه، وكل ضغطة بتتحفظ فورًا. زر «التالي» بينقلك للطالب اللي بعده.'
          : 'Present students as one list — interaction & homework per row, every click saves instantly. «Next» walks to the following student.'}
      </div>

      {missingFocus && (
        <div className="nk-block mb-3" role="status">
          <b>{isArabic ? 'يُعرض الطلاب الناقصون فقط — أكملهم ليصبح التقدم متاحًا.' : 'Showing only missing students — complete them to unlock progress.'}</b>
          {onClearFocus && (
            <button className="btn-ghost rounded-xl px-3 py-1.5 text-[.7rem] font-extrabold" onClick={onClearFocus}>
              {isArabic ? 'إلغاء التصفية' : 'Clear filter'}
            </button>
          )}
        </div>
      )}

      {/* Toolbar: search + presence filter + homework counter */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          className="glass-input rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-[180px]"
          placeholder={isArabic ? '🔍 بحث بالاسم أو الكود...' : 'Search name / code...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={isArabic ? 'بحث' : 'Search'}
        />
        <div className="flex rounded-xl overflow-hidden border border-subtle">
          {[
            ['present', isArabic ? 'الحاضرون' : 'Present'],
            ['all', isArabic ? 'الكل' : 'All'],
            ['absent', isArabic ? 'الغائبون' : 'Absent'],
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
        <span className="nk-pill nk-pill-gold">{isArabic ? 'الواجب' : 'Homework'}: {counts.hwDone} / {counts.hwApplicable}</span>
      </div>

      {/* Stage completeness filters (brief §7): Interaction All/Done/Missing ·
          Homework All/Done/Partial/Missing — same segmented UX as everywhere. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[.68rem] font-extrabold text-fg-muted">{isArabic ? 'التفاعل:' : 'Interaction:'}</span>
        <div className="flex rounded-xl overflow-hidden border border-subtle">
          {[
            ['all', isArabic ? 'الكل' : 'All'],
            ['done', isArabic ? 'تم' : 'Done'],
            ['missing', isArabic ? 'ناقص' : 'Missing'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setIntFilter(key)}
              className="px-3 py-1.5 text-[.68rem] font-extrabold"
              style={intFilter === key
                ? { background: 'var(--brand-navy)', color: '#fff' }
                : { background: 'var(--surface-container)', color: 'var(--fg-muted)' }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[.68rem] font-extrabold text-fg-muted ms-2">{isArabic ? 'الواجب:' : 'Homework:'}</span>
        <div className="flex rounded-xl overflow-hidden border border-subtle">
          {[
            ['all', isArabic ? 'الكل' : 'All'],
            ['done', isArabic ? 'مكتمل' : 'Done'],
            ['partial', isArabic ? 'ناقص' : 'Partial'],
            ['missing', isArabic ? 'لم يُرصد' : 'Missing'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setHwFilter(key)}
              className="px-3 py-1.5 text-[.68rem] font-extrabold"
              style={hwFilter === key
                ? { background: 'var(--brand-navy)', color: '#fff' }
                : { background: 'var(--surface-container)', color: 'var(--fg-muted)' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2.5">
        {rows.map((s) => {
          const lf = flag(s)
          const isAbsent = lf.isAbsent
          const logs = ws.todayLogsByStudent[s.id] || []
          const lastLog = logs.length ? logs[logs.length - 1] : null
          return (
            <div
              key={s.id}
              id={`nk-int-row-${s.id}`}
              className={`nk-row !items-start flex-col gap-2.5 ${currentId === s.id ? 'nk-row--current' : ''}`}
              style={{ opacity: isAbsent ? 0.75 : 1 }}
            >
              <div
                className="flex items-center justify-between gap-2 w-full min-w-0 cursor-pointer"
                onClick={(e) => { if (e.target.closest('button')) return; setCurrentId(s.id) }}
                title={isArabic ? 'اضغط هنا عشان زر «التالي» يبدأ من هذا الصف' : 'Set «Next» to start from this row'}
              >
                <span className="min-w-0">
                  <b className="truncate">{s.name}</b>
                  <small>
                    {isArabic ? 'الحضور' : 'Attendance'}: {lf.status}
                    {lastLog ? ` · ${lastLog.note}` : ''}
                  </small>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {!isAbsent && lf.complete && <span className="nk-pill nk-pill-live !py-0.5 !text-[.62rem]">✓ {isArabic ? 'تم' : 'Done'}</span>}
                  {isAbsent && <span className="nk-pill nk-pill-danger">{isArabic ? 'غائب — غير applicable' : 'Absent — excluded'}</span>}
                </span>
              </div>

              {!isAbsent && (
                <div className="flex flex-wrap items-center gap-2 w-full">
                  {/* Interaction quick actions (existing points semantics) */}
                  <span className="nk-seg flex-wrap">
                    {interactionButtons.map((b) => (
                      <button
                        key={b.label}
                        disabled={wsMeta.savingIds.has(s.id)}
                        onClick={() => ws.adjustPoints(s.id, b.amount, b.reason)}
                        title={`${b.reason} (${b.amount > 0 ? '+' : ''}${b.amount})`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </span>
                  {/* Homework status (existing per-lesson homework semantics) */}
                  <span className="nk-seg ms-auto" role="group" aria-label={`${s.name} homework`}>
                    {hwOptions.map(([value, label, onClass]) => (
                      <button
                        key={value}
                        className={lf.hw === value ? onClass : ''}
                        aria-pressed={lf.hw === value}
                        disabled={wsMeta.savingIds.has(s.id)}
                        onClick={() => ws.updateHW(s.id, value, ws.activeLessonId)}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-center py-6 text-sm text-fg-muted">
            {filter === 'present' && counts.present === 0
              ? (isArabic ? 'سجّل الحضور أولاً ليظهروا هنا' : 'Record attendance first — present students appear here')
              : (isArabic ? 'لا نتائج مطابقة' : 'No matching students')}
          </p>
        )}
      </div>

      {/* QR scanner in PICK mode: scanning jumps to the student's row in the
          list (attendance is already done at this stage — it never re-marks). */}
      <Suspense fallback={qrOpen ? <ScannerFallback /> : null}>
        <QRSessionScanner
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          students={ws.students}
          pickMode
          onPickStudent={(studentId, studentName) => {
            const target = studentId ? groupStudents.find((s) => s.id === studentId) : null
            if (target && flag(target).isPresent) { jumpToStudent(studentId); return }
            ws.showToast(
              isArabic
                ? `${studentName || 'الطالب'} غير حاضر في هذه الحصة — لا يحتاج تفاعل أو واجب.`
                : `${studentName || 'Student'} is not present in this session.`,
              'info',
            )
          }}
        />
      </Suspense>
    </div>
  )
}
