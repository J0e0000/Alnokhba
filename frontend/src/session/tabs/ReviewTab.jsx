import { useWorkspace } from '../../store/WorkspaceStore'

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW TAB (rule 13) — lightweight pre-finish checkpoint.
// Detects incomplete work and routes the teacher back to the right tab.
// Does NOT block finishing (the existing finalize RPC is the gate).
// The next-step action sits inline-END at the top of the tab.
// ═══════════════════════════════════════════════════════════════════════════
export default function ReviewTab({ groupId, counts, interactionCount, gradedStudents, sessionExamCount, issues, lessonOpen, onGoTo }) {
  const ws = useWorkspace()
  const { isArabic } = ws

  // TOP ACTION (teacher request): next-step button inline-END at the top —
  // the old sticky bottom bar is removed (it blocked the view on mobile).

  const rows = [
    {
      key: 'attendance', label: isArabic ? 'الحضور' : 'Attendance',
      value: `${counts.present} ${isArabic ? 'حاضر' : 'present'} · ${counts.absent} ${isArabic ? 'غائب' : 'absent'}`,
      progress: counts.total ? (counts.present + counts.absent) / counts.total : 0,
      ok: counts.unrecorded === 0,
      tab: 'attendance',
    },
    {
      key: 'interaction', label: isArabic ? 'التفاعل' : 'Interaction',
      value: `${interactionCount} / ${counts.present}`,
      progress: counts.present ? interactionCount / counts.present : 0,
      ok: interactionCount > 0,
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

  return (
    <div>
      {/* TOP ACTION — inline-END (top-left AR / top-right EN), teacher request */}
      <div className="flex justify-end mb-2">
        <button
          className="btn-gold rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold !min-h-[2.75rem]"
          onClick={() => onGoTo?.('report')}
        >
          {isArabic ? 'التالي — التقرير والإنهاء ←' : 'Next — Report & finish →'}
        </button>
      </div>
      <div className="grid gap-2.5 mb-4">
        {rows.map((r) => (
          <button key={r.key} className="nk-row !items-center w-full text-right" onClick={() => onGoTo(r.tab)}>
            <span className="min-w-0 flex-1">
              <b className="truncate">{r.label}</b>
              <small>{r.value}</small>
              <span className="nk-bar mt-1.5 block"><span style={{ width: `${Math.round(r.progress * 100)}%` }} /></span>
            </span>
            <span className={`nk-pill ${r.ok ? 'nk-pill-live' : 'nk-pill-pending'}`}>{r.ok ? `✓ ${isArabic ? 'مكتمل' : 'Done'}` : `! ${isArabic ? 'ناقص' : 'Incomplete'}`}</span>
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
    </div>
  )
}
