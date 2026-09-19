import { useState } from 'react'
import { useWorkspace } from '../../store/WorkspaceStore'
import { usePublishBar } from '../WorkflowBar'
import { studentsNeedPhrase } from '../../lib/helpers'

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW TAB (rule 13 + update brief §4/§5) — pre-finish checkpoint.
// Rows reflect REAL saved records. Attendance is informational: unrecorded
// students never block (server-side finalize applies the existing
// unrecorded→absent rule). Interaction / homework / exams DO block advancing
// to the report, with a one-click jump to the responsible stage.
// ═══════════════════════════════════════════════════════════════════════════
export default function ReviewTab({ groupId, counts, interactionCount, gradedStudents, sessionExamCount, issues, lessonOpen, onGoTo, blockers = [], onBar }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [showBlockers, setShowBlockers] = useState(false)

  // Persistent workflow bar (UX round): the pre-finish continue action lives
  // here, always visible without scrolling. Blocked advances open the
  // missing-students panel (same gating as production).
  // `blockers` arrives DEDUPED: [{student, kinds: [...]}] — unique students.
  const barData = {
    ariaLabel: isArabic ? 'إجراءات المراجعة' : 'Review actions',
    primary: [{ key: 'next', kind: 'gold', label: isArabic ? 'التالي — التقرير والإنهاء ←' : 'Next — Report & finish →', disabled: false }],
    secondary: [
      { key: 'exams', label: isArabic ? '→ الامتحانات' : '← Exams', disabled: false },
      { key: 'attendance', label: isArabic ? '→ الحضور' : '← Attendance', disabled: false },
    ],
    meta: blockers.length
      ? studentsNeedPhrase(blockers.length, isArabic, 'إكمال')
      : (isArabic ? 'كل شيء مكتمل ✓' : 'All complete ✓'),
  }
  usePublishBar(onBar, barData, {
    next: () => { if (blockers.length > 0) setShowBlockers(true); else onGoTo?.('report') },
    exams: () => onGoTo?.('exams'),
    attendance: () => onGoTo?.('attendance'),
  })

  const rows = [
    {
      key: 'attendance', label: isArabic ? 'الحضور' : 'Attendance',
      value: `${counts.present} ${isArabic ? 'حاضر' : 'present'} · ${counts.absent} ${isArabic ? 'غائب' : 'absent'}${counts.unrecorded ? ` · ${counts.unrecorded} ${isArabic ? 'لم يُرصد (مسموح)' : 'unrecorded (allowed)'}` : ''}`,
      progress: counts.total ? (counts.present + counts.absent) / counts.total : 0,
      ok: true, // attendance NEVER blocks the workflow (brief §4)
      optional: counts.unrecorded > 0,
      tab: 'attendance',
    },
    {
      key: 'interaction', label: isArabic ? 'التفاعل' : 'Interaction',
      value: `${interactionCount} / ${counts.present}`,
      progress: counts.present ? interactionCount / counts.present : 0,
      ok: interactionCount >= counts.present,
      tab: 'interaction',
    },
    {
      key: 'homework', label: isArabic ? 'الواجب' : 'Homework',
      value: `${counts.hwDone} / ${counts.hwApplicable}`,
      progress: counts.hwApplicable ? counts.hwDone / counts.hwApplicable : 0,
      ok: counts.hwDone >= counts.hwApplicable,
      tab: 'interaction',
    },
    {
      key: 'exams', label: isArabic ? 'الامتحانات' : 'Exams',
      value: sessionExamCount ? `${gradedStudents} / ${counts.present}` : (isArabic ? 'لا يوجد' : 'None'),
      progress: sessionExamCount && counts.present ? gradedStudents / counts.present : 0,
      ok: sessionExamCount > 0 ? gradedStudents >= counts.present : true, // exams optional
      tab: 'exams',
    },
  ]

  const kindLabel = (kind) => kind === 'interaction'
    ? (isArabic ? 'تفاعل' : 'interaction')
    : kind === 'hw' ? (isArabic ? 'رصد واجب' : 'homework') : (isArabic ? 'إدخال درجة' : 'grade')

  return (
    <div>
      <div className="grid gap-2.5 mb-4">
        {rows.map((r) => (
          <button key={r.key} className="nk-row !items-center w-full text-right" onClick={() => onGoTo(r.tab)}>
            <span className="min-w-0 flex-1">
              <b className="truncate">{r.label}</b>
              <small>{r.value}</small>
              <span className="nk-bar mt-1.5 block"><span style={{ width: `${Math.round(r.progress * 100)}%` }} /></span>
            </span>
            <span className={`nk-pill ${r.ok ? (r.optional ? 'nk-pill-neutral' : 'nk-pill-live') : 'nk-pill-pending'}`}>
              {r.ok
                ? (r.optional ? `◌ ${isArabic ? 'اختياري' : 'Optional'}` : `✓ ${isArabic ? 'مكتمل' : 'Done'}`)
                : `! ${isArabic ? 'ناقص' : 'Incomplete'}`}
            </span>
          </button>
        ))}
      </div>

      {issues.length > 0 && (
        <div className="nk-notice mb-4">
          <b className="block mb-1">{isArabic ? 'ملاحظات قبل الإنهاء' : 'Before finishing'}</b>
          <ul className="list-disc ps-5 m-0">
            {issues.map((issue, i) => <li key={i}>{issue}</li>)}
          </ul>
        </div>
      )}

      <div className="rounded-xl p-3.5 text-[.74rem]" style={{ background: 'var(--surface-container-high)', border: '1px solid var(--surface-border)' }}>
        <b className="block mb-1">{isArabic ? 'حالة الحصة' : 'Session status'}</b>
        <span className={`nk-pill ${lessonOpen ? 'nk-pill-live' : 'nk-pill-done'}`}>
          {lessonOpen ? `● ${isArabic ? 'قيد التنفيذ — التقرير هو مكان الإنهاء' : 'In progress — finish from the Report tab'}` : `✓ ${isArabic ? 'منتهية ومحفوظة' : 'Completed & saved'}`}
        </span>
      </div>

      {showBlockers && blockers.length > 0 && (
        <div className="nk-block mt-3" role="alert">
          <b>
            {studentsNeedPhrase(blockers.length, isArabic, blockers.flatMap((b) => b.kinds).map(kindLabel).join(' / '))}.
          </b>
          <ul className="nk-block__list">
            {blockers.slice(0, 6).map(({ student, kinds }) => (
              <li key={student.id}><b>{student.name}</b> — {kinds.map(kindLabel).join(' + ')}</li>
            ))}
            {blockers.length > 6 && <li>{isArabic ? `و ${blockers.length - 6} آخرون…` : `and ${blockers.length - 6} more…`}</li>}
          </ul>
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              className="btn-gold rounded-xl px-4 py-2 text-[.74rem] font-extrabold"
              onClick={() => {
                const target = blockers.some((b) => b.kinds.includes('exam')) ? 'exams' : 'interaction'
                onGoTo(target, target === 'exams' ? 'exams' : 'missing')
              }}
            >
              {isArabic ? `عرض الطلاب الناقصين (${blockers.length})` : `Show missing students (${blockers.length})`}
            </button>
            <button className="btn-ghost rounded-xl px-4 py-2 text-[.74rem] font-extrabold" onClick={() => setShowBlockers(false)}>
              {isArabic ? 'إغلاق' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
