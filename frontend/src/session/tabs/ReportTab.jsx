import { useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../../store/WorkspaceStore'
import { useUI } from '../../shell/UIContext'
import { buildTextReport } from '../../lib/qrPdfWhatsApp'
import { isValidPhone } from '../../lib/helpers'
import { getStudentRank, getStudentRankPosition } from '../../lib/helpers'

// ═══════════════════════════════════════════════════════════════════════════
// REPORT TAB (rule 14) — the report belongs to THIS session only.
// Pipeline ends here: Review → Session Report → FINISH SESSION → Home.
// SAVE (lesson details) and FINISH SESSION are two separate actions, and
// finishing uses the production finalize RPC + final notifications, unchanged.
// ═══════════════════════════════════════════════════════════════════════════
export default function ReportTab({ groupId, lesson, lessonOpen, lessonCompleted, counts, teacherName }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [draft, setDraft] = useState(() => ({
    lesson_topic: lesson?.lesson_topic || '', homework_text: lesson?.homework_text || '', video_link: lesson?.video_link || '',
  }))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    setDraft({ lesson_topic: lesson?.lesson_topic || '', homework_text: lesson?.homework_text || '', video_link: lesson?.video_link || '' })
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id])

  const groupStudents = ws.sessionStudentsFor(groupId)
  const attendanceMap = ws.lessonAttendanceByStudent

  const save = async () => {
    setSaving(true)
    const ok = await ws.saveSessionContent(lesson?.id, draft)
    setSaving(false)
    if (ok) setDirty(false)
  }

  // Report queue (existing production flow): requires a COMPLETED session.
  const buildQueue = async () => {
    const ranks = ws.ranks
    const all = ws.students
    const items = []
    for (const s of groupStudents) {
      const row = attendanceMap[s.id]
      const finalAttendance = row?.status || 'لم يرصد'
      const session = {
        lesson_topic: lesson?.lesson_topic || '',
        homework_text: lesson?.homework_text || '',
        video_link: lesson?.video_link || '',
        attendance: finalAttendance,
      }
      const reportStudent = { ...s, attendance_status: finalAttendance, hw_status: row?.homework_status || s.hw_status }
      const examScores = ws.examScoresByStudent[s.id] || []
      const text = buildTextReport(reportStudent, { ranks, allStudents: all, session, examScores })
      if (s.phone && isValidPhone(s.phone)) items.push({ student: reportStudent, phone: s.phone, message: text, lessonId: lesson?.id })
    }
    if (items.length === 0) {
      ws.showToast?.(isArabic ? 'لا يوجد طلاب لديهم أرقام صحيحة في هذه المجموعة' : 'No students with valid phone numbers', 'error')
      return
    }
    ui.startQueue(items)
  }

  const finish = async () => {
    const ok = await ui.askConfirm(
      isArabic
        ? 'إنهاء الحصة يقفل مسار العمل ويحوّل غير المرصد إلى غائب ويرسل التحديث النهائي لأولياء الأمور. هل تريد الإنهاء؟'
        : 'Finishing closes the workflow, converts unrecorded students to absent, and sends the final update to parents. Finish now?',
      { title: isArabic ? 'إنهاء الحصة' : 'Finish session', confirmLabel: isArabic ? 'إنهاء الحصة' : 'Finish session', danger: false },
    )
    if (!ok) return
    // Save any pending lesson details first (explicit save, still not the same as finish).
    if (dirty) await save()
    setFinishing(true)
    const done = await ws.finishLesson(lesson?.id, groupId)
    setFinishing(false)
    if (done) setDirty(false)
  }

  const topStudents = useMemo(() => {
    return [...groupStudents].sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 3)
  }, [groupStudents])

  return (
    <div>
      {/* Session summary block */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--surface-container)', border: '1px solid var(--surface-border)' }}>
        <b className="block mb-2 text-[.8rem]">{isArabic ? 'ملخص الحصة' : 'Session summary'}</b>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[.72rem]">
          <span className="nk-pill nk-pill-neutral">{isArabic ? 'الطلاب' : 'Students'}: {counts.total}</span>
          <span className="nk-pill nk-pill-live">{isArabic ? 'حاضر' : 'Present'}: {counts.present}</span>
          <span className="nk-pill nk-pill-danger">{isArabic ? 'غائب' : 'Absent'}: {counts.absent}</span>
          <span className="nk-pill nk-pill-gold">{isArabic ? 'الواجب مكتمل' : 'Homework done'}: {counts.hwDone}/{counts.hwApplicable}</span>
        </div>
        {topStudents.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {topStudents.map((s, i) => (
              <span key={s.id} className="nk-pill nk-pill-gold">
                {['🥇', '🥈', '🥉'][i]} {s.name} · {s.points} {isArabic ? 'نقطة' : 'pts'}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Lesson details — SAVE (not finish) */}
      {lessonOpen ? (
        <div className="grid gap-3 mb-5">
          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'درس اليوم' : "Today's lesson"}</span>
            <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={draft.lesson_topic} onChange={(e) => { setDraft({ ...draft, lesson_topic: e.target.value }); setDirty(true) }} placeholder={isArabic ? 'موضوع الحصة...' : 'Lesson topic...'} />
          </label>
          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'تفاصيل الواجب' : 'Homework details'}</span>
            <textarea className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full min-h-[64px]" value={draft.homework_text} onChange={(e) => { setDraft({ ...draft, homework_text: e.target.value }); setDirty(true) }} placeholder={isArabic ? 'الواجب المطلوب...' : 'Homework...'} />
          </label>
          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'رابط فيديو الشرح' : 'Lesson video link'}</span>
            <input dir="ltr" className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={draft.video_link} onChange={(e) => { setDraft({ ...draft, video_link: e.target.value }); setDirty(true) }} placeholder="https://..." />
          </label>
          <div className="flex flex-wrap gap-2 items-center">
            <button className="btn-gold action-button !min-h-[3rem]" disabled={saving || !dirty} onClick={save}>
              💾 {saving ? (isArabic ? 'جاري الحفظ...' : 'Saving...') : isArabic ? 'حفظ بيانات الحصة' : 'Save session data'}
            </button>
            {dirty && <span className="text-[.68rem] font-extrabold" style={{ color: 'var(--warn)' }}>{isArabic ? 'تغييرات غير محفوظة' : 'Unsaved changes'}</span>}
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-3.5 mb-5 text-[.74rem]" style={{ background: 'var(--surface-container-high)', border: '1px solid var(--surface-border)' }}>
          <b className="block">{isArabic ? 'درس اليوم' : 'Lesson'}</b>
          <p className="m-0 text-fg-muted">{lesson?.lesson_topic || (isArabic ? '—' : '—')}</p>
          <b className="block mt-2">{isArabic ? 'الواجب' : 'Homework'}</b>
          <p className="m-0 text-fg-muted">{lesson?.homework_text || (isArabic ? 'لا يوجد' : 'None')}</p>
          {lesson?.video_link && (
            <>
              <b className="block mt-2">{isArabic ? 'الفيديو' : 'Video'}</b>
              <a dir="ltr" href={lesson.video_link} target="_blank" rel="noreferrer" className="text-[.72rem] underline" style={{ color: 'var(--accent-blue)' }}>{lesson.video_link}</a>
            </>
          )}
        </div>
      )}

      {/* Reports queue — completed sessions only (existing business rule) */}
      <div className="rounded-2xl p-4 mb-5" style={{ background: 'var(--surface-container)', border: '1px solid var(--surface-border)' }}>
        <b className="block mb-1 text-[.8rem]">{isArabic ? 'تقارير أولياء الأمور (WhatsApp)' : 'Parent reports (WhatsApp)'}</b>
        <p className="text-[.7rem] text-fg-muted m-0 mb-3">
          {lessonCompleted
            ? (isArabic ? 'ابنِ قائمة الإرسال لطلاب المجموعة — يفتح واتساب لكل طالب على حدة كما هو متاح دائمًا.' : 'Build the send queue — WhatsApp opens per student exactly like production.')
            : (isArabic ? 'أنهِ الحصة أولًا لتفعيل التقارير (قاعدة النظام الحالية).' : 'Finish the session first to enable reports (existing rule).')}
        </p>
        <button
          className="btn-navy action-button !min-h-[3rem]"
          disabled={!lessonCompleted}
          onClick={buildQueue}
        >
          ↗ {isArabic ? 'قائمة التقارير' : 'Build report queue'}
        </button>
      </div>

      {/* FINISH SESSION — separate from SAVE (rule 7) */}
      {lessonOpen ? (
        <div className="rounded-2xl p-4" style={{ background: 'var(--ok-bg)', border: '1px solid var(--ok-border)' }}>
          <b className="block mb-1 text-[.85rem]" style={{ color: 'var(--ok-strong)' }}>{isArabic ? 'إنهاء الحصة' : 'Finish session'}</b>
          <p className="text-[.72rem] m-0 mb-3" style={{ color: 'var(--ok-strong)' }}>
            {isArabic
              ? 'الإنهاء يحوّل غير المرصد إلى غائب، يغلق الحصة، ويرسل التحديث النهائي لأولياء الأمور. الحفظ شيء والإنهاء شيء آخر.'
              : 'Finishing converts unrecorded to absent, closes the session, and sends the final parent update. Save and Finish are separate.'}
          </p>
          <button className="action-button !min-h-[3rem]" style={{ background: 'var(--ok)', borderColor: 'var(--ok)', color: '#fff' }} disabled={finishing} onClick={finish}>
            {finishing ? (isArabic ? 'جاري الإنهاء...' : 'Finishing...') : `✓ ${isArabic ? 'إنهاء الحصة' : 'Finish session'}`}
          </button>
        </div>
      ) : lessonCompleted ? (
        <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--info-bg)', border: '1px solid var(--info-border)' }}>
          <p className="m-0 text-[.8rem] font-extrabold" style={{ color: 'var(--info-strong)' }}>
            ✓ {isArabic ? 'الحصة منتهية ومحفوظة في السجل — يمكن للطالب رؤيتها في بوابته.' : 'Session completed and logged — visible in the student portal.'}
          </p>
          <button className="btn-navy action-button !min-h-[3rem] mt-3" onClick={ui.closeSession}>
            {isArabic ? 'العودة للرئيسية' : 'Back to Home'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

