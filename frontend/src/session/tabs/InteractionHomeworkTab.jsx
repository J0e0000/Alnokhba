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
// SPEED (user: "ما تعرضش كل الطلاب — أبحث بالاسم أو أمسح الكود"):
// - FOCUS mode is the default: ONE student at a time (same sequential pattern
//   as attendance) — mark interaction/homework → التالي → next student.
//   No scrolling through the whole roster, no wall of buttons.
// - Jump tools inside focus mode: search by name/code (chips, one tap) and
//   QR scan (pick mode — jumps to the scanned student, does NOT mark).
// - The full list stays available (☰ القائمة) as the secondary view —
//   progressive disclosure, nothing removed.
// - Position (studentId + mode) persists in sessionStorage per group, so a
//   reload/crash resumes on the same student.
// ═══════════════════════════════════════════════════════════════════════════
export default function InteractionHomeworkTab({ groupId, lessonOpen, missingFocus, onClearFocus, onBar, onAdvance, missingCount, onGoPrev }) {
  const ws = useWorkspace()
  const wsMeta = useWorkspaceMeta()
  const { isArabic } = ws
  const [mode, setMode] = useState('focus') // focus (sequential) | list
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('present') // present | all | absent
  const [intFilter, setIntFilter] = useState('all') // all | done | missing  (interaction completeness)
  const [hwFilter, setHwFilter] = useState('all') // all | done | partial | missing (homework completeness)
  const [focusSearch, setFocusSearch] = useState('')
  const [qrOpen, setQrOpen] = useState(false)

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

  // Applicable = PRESENT students in roster order — the sequential queue.
  const applicable = useMemo(
    () => groupStudents.filter((s) => flag(s).isPresent),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupStudents, attendanceMap, lessonOpen, ws.todayLogsByStudent],
  )

  // ── Sequential position: restore saved student, else first incomplete ──
  const [idx, setIdx] = useState(0)
  const restoredRef = useRef('')
  useEffect(() => {
    if (!applicable.length) return
    if (restoredRef.current === groupId) return
    restoredRef.current = groupId
    let target = -1
    try {
      const saved = JSON.parse(sessionStorage.getItem('nokhba_ws_int_pos') || 'null')
      if (saved?.groupId === groupId && saved.studentId) target = applicable.findIndex((s) => s.id === saved.studentId)
    } catch { /* ignore */ }
    if (target < 0) target = applicable.findIndex((s) => !flag(s).complete)
    setIdx(target >= 0 ? target : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, applicable.length])

  // Blockers-panel shortcut (missingFocus): jump straight to the first
  // student who still needs something — in focus mode.
  useEffect(() => {
    if (!missingFocus || !applicable.length) return
    const firstMissing = applicable.findIndex((s) => !flag(s).complete)
    if (firstMissing >= 0) setIdx(firstMissing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingFocus])

  // Persist position (studentId — survives roster reshuffles better than index).
  useEffect(() => {
    const currentId = applicable[idx]?.id || null
    try { sessionStorage.setItem('nokhba_ws_int_pos', JSON.stringify({ groupId, studentId: currentId, mode })) } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, idx, mode, applicable.length])

  // Clamp if the queue shrinks (defensive).
  useEffect(() => {
    if (idx > 0 && idx >= applicable.length) setIdx(Math.max(0, applicable.length - 1))
  }, [applicable.length, idx])

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

  const counts = ws.countsForLesson(groupId)

  // ── Read-only view (completed session) — unchanged behavior ──────────────
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

  // ── Sequential (focus) mode ───────────────────────────────────────────────
  const total = applicable.length
  const current = applicable[idx] || null
  const currentFlag = current ? flag(current) : null
  const isLast = idx >= total - 1
  const doneCount = applicable.filter((s) => flag(s).complete).length
  const saving = Boolean(current) && wsMeta.savingIds.has(current.id)

  const goNext = () => { if (!isLast) setIdx((i) => Math.min(total - 1, i + 1)) }
  const goPrev = () => { setIdx((i) => Math.max(0, i - 1)) }
  const jumpToStudent = (studentId) => {
    const i = applicable.findIndex((s) => s.id === studentId)
    if (i >= 0) { setIdx(i); setFocusSearch(''); return true }
    return false
  }

  const focusMatches = useMemo(() => {
    const q = normalizeArabicSearch(focusSearch)
    if (!q) return []
    return applicable
      .filter((s) => normalizeArabicSearch([s.name, s.code].filter(Boolean).join(' ')).includes(q))
      .slice(0, 5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSearch, applicable])

  // ── Bar spec (serializable) + handlers — published to the workspace root
  const progressMeta = missingCount > 0
    ? studentsNeedPhrase(missingCount, isArabic, isArabic ? 'تفاعل / واجب' : 'input')
    : (isArabic ? `مكتمل ${doneCount} من ${total} ✓` : `${doneCount}/${total} complete ✓`)

  const barData = mode === 'focus'
    ? {
        ariaLabel: isArabic ? 'إجراءات التفاعل والواجب' : 'Interaction & homework actions',
        primary: [isLast
          ? { key: 'next', kind: 'gold', label: isArabic ? 'متابعة — الامتحانات ←' : 'Continue — Exams →', disabled: !onAdvance }
          : { key: 'next', kind: 'gold', label: isArabic ? 'التالي ←' : 'Next →', disabled: false }],
        secondary: [
          { key: 'prev', label: isArabic ? '→ السابق' : '← Previous', disabled: idx === 0, title: isArabic ? 'الطالب السابق' : 'Previous student' },
          { key: 'openList', label: isArabic ? '☰ القائمة' : '☰ List', disabled: false, title: isArabic ? 'عرض القائمة الكاملة' : 'Full list view' },
          { key: 'openQR', label: '⛶ QR', disabled: false, title: isArabic ? 'امسح كود الطالب للانتقال إليه' : 'Scan a student QR to jump to them' },
        ],
        meta: `${isArabic ? `الطالب ${idx + 1} من ${total}` : `Student ${idx + 1} of ${total}`} · ${progressMeta}`,
      }
    : {
        ariaLabel: isArabic ? 'إجراءات التفاعل والواجب' : 'Interaction & homework actions',
        primary: [{ key: 'next', kind: 'gold', label: isArabic ? 'التالي — الامتحانات ←' : 'Next — Exams →', disabled: !onAdvance }],
        secondary: [
          { key: 'prev', label: isArabic ? '→ السابق — الحضور' : '← Previous — Attendance', disabled: !onGoPrev },
          { key: 'openFocus', label: `⚡ ${isArabic ? 'الرصد التسلسلي' : 'Sequential mode'}`, disabled: !total, title: isArabic ? 'طالب بطالب — أسرع، مع بحث ومسح QR' : 'Student-by-student — faster, with search & QR' },
        ],
        meta: progressMeta,
      }

  usePublishBar(onBar, barData, {
    next: () => { if (mode === 'focus' && !isLast) goNext(); else onAdvance?.() },
    prev: () => { if (mode === 'focus') goPrev(); else onGoPrev?.() },
    openList: () => setMode('list'),
    openFocus: () => {
      const firstMissing = applicable.findIndex((s) => !flag(s).complete)
      setIdx(firstMissing >= 0 ? firstMissing : 0)
      setMode('focus')
    },
    openQR: () => setQrOpen(true),
  })

  return (
    <div>
      <div className="nk-notice mb-4">
        {isArabic
          ? 'التفاعل والواجب للحاضرين فقط — الغائبون مستثنون تلقائيًا. كل ضغطة بتتحفظ فورًا.'
          : 'Interaction & homework apply to present students only — absentees are excluded automatically. Every click saves instantly.'}
      </div>

      {mode === 'focus' && current && (
        <>
          {/* Focus card — ONE student, ONE goal */}
          <div className="nk-focus-card" aria-live="polite">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="nk-focus-muted text-[.7rem] font-black tracking-wide">
                {isArabic ? `الطالب ${idx + 1} من ${total}` : `Student ${idx + 1} of ${total}`}
              </span>
              <span className="flex items-center gap-1.5 flex-wrap justify-end">
                <span className={`nk-pill !py-0.5 !text-[.62rem] ${currentFlag.hasInteraction ? 'nk-pill-live' : 'nk-pill-neutral'}`}>
                  {currentFlag.hasInteraction ? `✓ ${isArabic ? 'تفاعل' : 'Interaction'}` : (isArabic ? 'تفاعل —' : 'Interaction —')}
                </span>
                <span className={`nk-pill !py-0.5 !text-[.62rem] ${!currentFlag.hwMissing ? (currentFlag.hwDone ? 'nk-pill-live' : 'nk-pill-neutral') : 'nk-pill-pending'}`}>
                  {isArabic ? 'واجب' : 'Homework'}: {HW_LABEL[currentFlag.hw] || (currentFlag.hwMissing ? 'لم يُرصد' : currentFlag.hw)}
                </span>
              </span>
            </div>
            <div className="nk-focus-name">{current.name}</div>
            <small className="nk-focus-muted text-[.72rem] block">
              {[current.code, current.stage].filter(Boolean).join(' · ')}
            </small>

            {/* Interaction quick actions (existing points semantics) */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="nk-seg flex-wrap">
                {interactionButtons.map((b) => (
                  <button
                    key={b.label}
                    disabled={saving}
                    onClick={() => ws.adjustPoints(current.id, b.amount, b.reason)}
                    title={`${b.reason} (${b.amount > 0 ? '+' : ''}${b.amount})`}
                  >
                    {b.label}
                  </button>
                ))}
              </span>
            </div>
            {/* Homework status (existing per-lesson homework semantics) */}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="nk-seg" role="group" aria-label={`${current.name} homework`}>
                {hwOptions.map(([value, label, onClass]) => (
                  <button
                    key={value}
                    className={currentFlag.hw === value ? onClass : ''}
                    aria-pressed={currentFlag.hw === value}
                    disabled={saving}
                    onClick={() => ws.updateHW(current.id, value, ws.activeLessonId)}
                  >
                    {label}
                  </button>
                ))}
              </span>
              <span className="nk-focus-muted text-[.66rem]">
                {saving ? (isArabic ? '… جاري الحفظ' : 'Saving…') : (isArabic ? '✓ الحفظ فوري' : '✓ Saves instantly')}
              </span>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <span className="nk-bar flex-1"><span style={{ width: `${total ? Math.round((doneCount / total) * 100) : 0}%` }} /></span>
              <span className="nk-focus-muted text-[.66rem] font-extrabold shrink-0">
                {isArabic ? `مكتمل ${doneCount}/${total}` : `${doneCount}/${total} complete`}
              </span>
            </div>

            {/* Jump tools: search by name/code — one tap to jump */}
            <div className="mt-3">
              <input
                className="glass-input rounded-xl px-3 py-2 text-[.8rem] w-full"
                placeholder={isArabic ? '🔍 اكتب اسم طالب للانتقال السريع...' : 'Type a student name to jump...'}
                value={focusSearch}
                onChange={(e) => setFocusSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && focusMatches[0]) jumpToStudent(focusMatches[0].id) }}
                aria-label={isArabic ? 'انتقال سريع لطالب' : 'Quick jump to student'}
              />
              {focusMatches.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {focusMatches.map((s) => (
                    <button
                      key={s.id}
                      className="nk-pill nk-pill-gold cursor-pointer border-0 px-3 py-1.5 text-[.7rem] font-extrabold"
                      onClick={() => jumpToStudent(s.id)}
                    >
                      {s.name}{flag(s).complete ? ' ✓' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {mode === 'focus' && !current && (
        <div className="nk-notice">
          {counts.present === 0
            ? (isArabic ? 'سجّل الحضور أولاً — الحاضرون فقط يظهرون هنا.' : 'Record attendance first — present students appear here.')
            : (isArabic ? 'لا يوجد طلاب في هذه المجموعة.' : 'No students in this group.')}
        </div>
      )}

      {mode === 'list' && (
        <>
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

          {/* Toolbar: search + filters + homework counter */}
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
              const row = attendanceMap[s.id]
              const status = row?.status || (lessonOpen ? 'لم يرصد' : s.attendance_status)
              const hw = row?.homework_status || (lessonOpen ? 'لم يرصد' : s.hw_status)
              const isAbsent = status === 'غائب'
              const logs = ws.todayLogsByStudent[s.id] || []
              const lastLog = logs.length ? logs[logs.length - 1] : null
              const listIdx = applicable.findIndex((x) => x.id === s.id)
              return (
                <div key={s.id} className="nk-row !items-start flex-col gap-2.5" style={{ opacity: isAbsent ? 0.75 : 1 }}>
                  <div
                    className={`flex items-center justify-between gap-2 w-full min-w-0 ${!isAbsent && listIdx >= 0 ? 'cursor-pointer' : ''}`}
                    onClick={(e) => {
                      if (e.target.closest('button')) return
                      if (!isAbsent && listIdx >= 0) { setIdx(listIdx); setMode('focus') }
                    }}
                    title={!isAbsent && listIdx >= 0 ? (isArabic ? 'اضغط لفتح هذا الطالب في وضع التسلسل' : 'Open this student in sequential mode') : undefined}
                  >
                    <span className="min-w-0">
                      <b className="truncate">{s.name}</b>
                      <small>
                        {isArabic ? 'الحضور' : 'Attendance'}: {status}
                        {lastLog ? ` · ${lastLog.note}` : ''}
                      </small>
                    </span>
                    {isAbsent && <span className="nk-pill nk-pill-danger">{isArabic ? 'غائب — غير applicable' : 'Absent — excluded'}</span>}
                  </div>

                  {!isAbsent && lessonOpen && (
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
                            className={hw === value ? onClass : ''}
                            aria-pressed={hw === value}
                            disabled={wsMeta.savingIds.has(s.id)}
                            onClick={() => ws.updateHW(s.id, value, ws.activeLessonId)}
                          >
                            {label}
                          </button>
                        ))}
                      </span>
                    </div>
                  )}
                  {!isAbsent && !lessonOpen && (
                    <small className="text-fg-muted">
                      {isArabic ? `الواجب: ${HW_LABEL[hw] || hw}` : `Homework: ${HW_LABEL[hw] || hw}`} — {isArabic ? 'حصة منتهية (عرض فقط)' : 'completed session (read-only)'}
                    </small>
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
        </>
      )}

      {/* QR scanner in PICK mode: scanning jumps to the student (attendance is
          already done at this stage — it never re-marks). */}
      <Suspense fallback={qrOpen ? <ScannerFallback /> : null}>
        <QRSessionScanner
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          students={ws.students}
          pickMode
          onPickStudent={(studentId, studentName) => {
            if (jumpToStudent(studentId)) return
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
