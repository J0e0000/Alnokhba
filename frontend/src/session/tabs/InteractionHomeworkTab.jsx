import { useMemo, useState } from 'react'
import { useWorkspace, normalizeArabicSearch } from '../../store/WorkspaceStore'

const HW_LABEL = { 'مكتمل': 'مكتمل', 'تم': 'مكتمل', 'ناقص': 'ناقص', 'لم يتم': 'لم يتم', 'لم يرصد': 'لم يُرصد' }

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTION + HOMEWORK TAB (rule 11)
// - One pipeline tab. Interaction = the existing points system (behavior_logs
//   + students.points — same writes as production). Homework = the existing
//   per-lesson homework status (upsert_lesson_homework RPC).
// - Only APPLICABLE students appear: default view excludes absent students
//   (they cannot interact and receive no homework).
// - 'completed' homework must persist as مكتمل — the mirror field and the
//   lesson row are written together, exactly like production.
// ═══════════════════════════════════════════════════════════════════════════
export default function InteractionHomeworkTab({ groupId, lessonOpen }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('present') // present | all | absent

  const attendanceMap = ws.lessonAttendanceByStudent
  const groupStudents = ws.sessionStudentsFor(groupId)

  const rows = useMemo(() => {
    const q = normalizeArabicSearch(search)
    return groupStudents.filter((s) => {
      const status = attendanceMap[s.id]?.status || (lessonOpen ? 'لم يرصد' : s.attendance_status)
      if (filter === 'present' && status !== 'حاضر') return false
      if (filter === 'absent' && status !== 'غائب') return false
      if (!q) return true
      return normalizeArabicSearch([s.name, s.code].filter(Boolean).join(' ')).includes(q)
    })
  }, [groupStudents, search, filter, attendanceMap, lessonOpen])

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

  return (
    <div>
      <div className="nk-notice mb-4">
        {isArabic
          ? 'التفاعل والواجب يظهران للحاضرين — الغائبون مستثنون تلقائيًا. الواجب المكتمل يتخزن فورًا مع كل ضغطة حفظ.'
          : 'Interaction & homework apply to present students — absentees are excluded automatically. Completed homework persists with each save.'}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
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

      <div className="grid gap-2.5">
        {rows.map((s) => {
          const row = attendanceMap[s.id]
          const status = row?.status || (lessonOpen ? 'لم يرصد' : s.attendance_status)
          const hw = row?.homework_status || (lessonOpen ? 'لم يرصد' : s.hw_status)
          const isAbsent = status === 'غائب'
          const logs = ws.todayLogsByStudent[s.id] || []
          const lastLog = logs.length ? logs[logs.length - 1] : null
          return (
            <div key={s.id} className="nk-row !items-start flex-col gap-2.5" style={{ opacity: isAbsent ? 0.75 : 1 }}>
              <div className="flex items-center justify-between gap-2 w-full min-w-0">
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
                        disabled={ws.savingIds.has(s.id)}
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
                        disabled={ws.savingIds.has(s.id)}
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
    </div>
  )
}
