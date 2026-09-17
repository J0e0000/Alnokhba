import { useMemo, useState } from 'react'
import { useWorkspace, normalizeArabicSearch } from '../../store/WorkspaceStore'
import { useUI } from '../../shell/UIContext'
import QRSessionScanner from '../QRSessionScanner'

const STATUS_LABEL = { 'حاضر': 'حاضر', 'غائب': 'غائب', 'لم يرصد': 'لم يُرصد' }

// ═══════════════════════════════════════════════════════════════════════════
// ATTENDANCE TAB (rules 9–10)
// - Attendance is SESSION-specific (lesson_session_id): two sessions of the
//   same group in one week are two independent attendance events.
// - Current input (neutral/present/absent) is UI state; the server row is
//   historical truth. A new session always starts NEUTRAL — no prefill from
//   previous sessions, no stale realtime restore.
// - Marks persist through the same RPC as production (upsert_lesson_attendance).
// ═══════════════════════════════════════════════════════════════════════════
export default function AttendanceTab({ groupId, lessonOpen }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | present | absent | unrecorded
  const [qrOpen, setQrOpen] = useState(false)

  const students = ws.sessionStudentsFor(groupId)
  const attendanceMap = ws.lessonAttendanceByStudent

  const visible = useMemo(() => {
    const q = normalizeArabicSearch(search)
    return students.filter((s) => {
      const status = attendanceMap[s.id]?.status || 'لم يرصد'
      if (filter === 'present' && status !== 'حاضر') return false
      if (filter === 'absent' && status !== 'غائب') return false
      if (filter === 'unrecorded' && status !== 'لم يرصد') return false
      if (!q) return true
      return normalizeArabicSearch([s.name, s.code, s.phone].filter(Boolean).join(' ')).includes(q)
    })
  }, [students, search, filter, attendanceMap])

  const counts = ws.countsForLesson(groupId)

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

  return (
    <div>
      <div className="nk-notice mb-4">
        {isArabic
          ? 'الحضور مستقل لكل حصة — حصة الأحد وحصة الأربعاء حدثان منفصلان. الغائبون لا يظهرون في مرحلة الدرجات ولا يحصلون على صفر تلقائيًا.'
          : 'Attendance is session-specific — Sunday and Wednesday are independent events. Absent students are excluded from grading and never auto-zeroed.'}
      </div>

      {/* Toolbar: search + filters + bulk + QR */}
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
        <button className="btn-gold rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold" onClick={() => ws.markAllPresent(groupId, ws.activeLessonId)}>
          ✓ {isArabic ? 'الكل حاضر' : 'All present'}
        </button>
        <button className="btn-ghost rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold" onClick={() => ws.markGroupAbsences(ws.activeLessonId)}>
          ✗ {isArabic ? 'رصد الغائبين' : 'Mark absences'}
        </button>
        <button className="btn-navy rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold" onClick={() => setQrOpen(true)}>
          ⛶ {isArabic ? 'مسح QR' : 'Scan QR'}
        </button>
      </div>

      {/* Counts strip */}
      <div className="flex flex-wrap gap-2 mb-4 text-[.7rem] font-extrabold">
        <span className="nk-pill nk-pill-neutral">{isArabic ? 'الطلاب' : 'Students'}: {counts.total}</span>
        <span className="nk-pill nk-pill-live">{isArabic ? 'حاضر' : 'Present'}: {counts.present}</span>
        <span className="nk-pill nk-pill-danger">{isArabic ? 'غائب' : 'Absent'}: {counts.absent}</span>
        <span className="nk-pill nk-pill-pending">{isArabic ? 'لم يُرصد' : 'Unrecorded'}: {counts.unrecorded}</span>
      </div>

      {/* Rows — Present / Absent / Clear(neutral) */}
      <div className="grid gap-2">
        {visible.map((s) => {
          const row = attendanceMap[s.id]
          const status = row?.status || 'لم يرصد'
          const saving = ws.savingIds.has(s.id)
          const saved = ws.savedIds.has(s.id)
          return (
            <div key={s.id} className="nk-row">
              <span className="min-w-0">
                <b className="truncate">{s.name}{saving ? ' …' : ''}</b>
                <small>
                  حالة الحضور: {STATUS_LABEL[status] || status}
                  {saved ? ' · ✓ تم الحفظ' : ''}
                </small>
              </span>
              <span className="nk-seg" role="group" aria-label={`${s.name} attendance`}>
                <button
                  className={status === 'حاضر' ? 'nk-on-present' : ''}
                  aria-pressed={status === 'حاضر'}
                  disabled={saving}
                  onClick={() => ws.setAttendance(s.id, 'حاضر', ws.activeLessonId)}
                >
                  {isArabic ? 'حاضر' : 'Present'}
                </button>
                <button
                  className={status === 'غائب' ? 'nk-on-absent' : ''}
                  aria-pressed={status === 'غائب'}
                  disabled={saving}
                  onClick={() => ws.setAttendance(s.id, 'غائب', ws.activeLessonId)}
                >
                  {isArabic ? 'غائب' : 'Absent'}
                </button>
                <button
                  className={status === 'لم يرصد' ? 'nk-on-neutral' : ''}
                  aria-pressed={status === 'لم يرصد'}
                  title={isArabic ? 'مسح الرصد (neutral)' : 'Clear to neutral'}
                  disabled={saving || status === 'لم يرصد'}
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

      {/* Explicit SAVE (persists pending offline ops + confirms server sync).
          FINISH lives in the Report tab — the two are never the same action. */}
      <div className="flex flex-wrap gap-2 mt-5 pt-4" style={{ borderTop: '1px solid var(--surface-border)' }}>
        <button
          className="btn-gold action-button !min-h-[3rem]"
          onClick={() => ws.syncPendingSaves()}
        >
          💾 {isArabic ? 'حفظ' : 'Save'}
        </button>
        <button className="btn-ghost action-button !min-h-[3rem]" onClick={() => ui.setArea('home')}>
          {isArabic ? 'حفظ والخروج' : 'Save & exit'}
        </button>
        <span className="text-[.68rem] text-fg-muted self-center">
          {isArabic ? 'كل علامة بتتحفظ فورًا — الحفظ يؤكد المزامنة. الإنهاء من تبويب التقرير.' : 'Every mark persists instantly — Save confirms sync. Finish lives in the Report tab.'}
        </span>
      </div>

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
    </div>
  )
}
