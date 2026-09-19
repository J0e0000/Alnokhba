import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../../store/WorkspaceStore'
import { useUI } from '../../shell/UIContext'
import { buildTextReport } from '../../lib/qrPdfWhatsApp'
import { isValidPhone } from '../../lib/helpers'
import { getStudentRank, getStudentRankPosition } from '../../lib/helpers'
import { usePublishBar } from '../WorkflowBar'

// ═══════════════════════════════════════════════════════════════════════════
// REPORT TAB (rule 14) — the report belongs to THIS session only.
// Pipeline ends here: Review → Session Report → FINISH SESSION → Home.
// SAVE (lesson details) and FINISH SESSION are two separate actions, and
// finishing uses the production finalize RPC + final notifications, unchanged.
//
// REPORT AUTOSAVE: every field edit mirrors to localStorage immediately
// (crash-safe) and pushes to the server with a 900ms debounce. Recovery is
// deterministic: the local mirror is used ONLY when newer than the server
// row (savedAt > lesson.updated_at) — the server stays source of truth.
//
// REPORT SCOPING: the parent-report queue can be built for ALL students,
// PRESENT students only, or ABSENT students only (spec 30).
// ═══════════════════════════════════════════════════════════════════════════
const reportDraftKey = (lessonId) => `nokhba_report_draft_v1_${lessonId || 'none'}`

export default function ReportTab({ groupId, lesson, lessonOpen, lessonCompleted, counts, teacherName, onBar }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const restoredRef = useRef(false)
  const [draft, setDraft] = useState(() => {
    const base = { lesson_topic: lesson?.lesson_topic || '', homework_text: lesson?.homework_text || '', video_link: lesson?.video_link || '' }
    try {
      const raw = lesson?.id ? localStorage.getItem(reportDraftKey(lesson.id)) : null
      if (raw) {
        const stored = JSON.parse(raw)
        const serverUpdatedAt = lesson?.updated_at ? new Date(lesson.updated_at).getTime() : 0
        // Deterministic reconciliation: local mirror wins ONLY when newer.
        if (stored?.draft && stored?.savedAt && new Date(stored.savedAt).getTime() > serverUpdatedAt) {
          restoredRef.current = true
          return { ...base, ...stored.draft }
        }
      }
    } catch { /* storage blocked */ }
    return base
  })
  const [dirty, setDirty] = useState(restoredRef.current)
  const [saving, setSaving] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [queueScope, setQueueScope] = useState('all') // all | present | absent

  useEffect(() => {
    restoredRef.current = false
    setDraft({ lesson_topic: lesson?.lesson_topic || '', homework_text: lesson?.homework_text || '', video_link: lesson?.video_link || '' })
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id])

  // Mutation-mirrored draft: local mirror FIRST (crash-safe), then a debounced
  // server save — text-heavy fields get a reasonable debounce (spec 26).
  const updateDraft = (patch) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setDirty(true)
    try { if (lesson?.id) localStorage.setItem(reportDraftKey(lesson.id), JSON.stringify({ draft: next, savedAt: new Date().toISOString() })) } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!dirty || !lessonOpen || !lesson?.id) return undefined
    const t = setTimeout(async () => {
      const ok = await ws.saveSessionContent(lesson.id, draft)
      if (ok) {
        setDirty(false)
        try { localStorage.removeItem(reportDraftKey(lesson.id)) } catch { /* ignore */ }
      }
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, lessonOpen, lesson?.id])

  const groupStudents = ws.sessionStudentsFor(groupId)
  const attendanceMap = ws.lessonAttendanceByStudent

  const save = async () => {
    setSaving(true)
    const ok = await ws.saveSessionContent(lesson?.id, draft)
    setSaving(false)
    if (ok) {
      setDirty(false)
      try { if (lesson?.id) localStorage.removeItem(reportDraftKey(lesson.id)) } catch { /* ignore */ }
    }
  }

  // Report queue (existing production flow): requires a COMPLETED session.
  const buildQueue = async () => {
    const ranks = ws.ranks
    const all = ws.students
    const items = []
    for (const s of groupStudents) {
      const row = attendanceMap[s.id]
      const finalAttendance = row?.status || 'لم يرصد'
      if (queueScope === 'present' && finalAttendance !== 'حاضر') continue
      if (queueScope === 'absent' && finalAttendance !== 'غائب') continue
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
      ws.showToast?.(isArabic ? 'لا يوجد طلاب مطابقون للنطاق المحدد لديهم أرقام صحيحة' : 'No matching students with valid phone numbers', 'error')
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

  // Persistent workflow bar — the session pipeline ends here.
  const barData = lessonOpen
    ? {
        ariaLabel: isArabic ? 'إجراءات التقرير' : 'Report actions',
        primary: [{
          key: 'finish',
          kind: 'ok',
          label: finishing ? (isArabic ? '… جاري الإنهاء' : 'Finishing…') : `✓ ${isArabic ? 'إنهاء الحصة' : 'Finish session'}`,
          disabled: finishing,
        }],
        secondary: dirty
          ? [{ key: 'save', label: `💾 ${isArabic ? 'حفظ البيانات أولًا' : 'Save first'}`, disabled: saving }]
          : [],
        meta: dirty
          ? (isArabic ? 'تغييرات غير محفوظة — الإنهاء يحفظها تلقائيًا' : 'Unsaved changes — finishing saves them')
          : (isArabic ? 'الإنهاء يغلق الحصة نهائيًا' : 'Finishing closes the session for good'),
      }
    : {
        ariaLabel: isArabic ? 'إجراءات التقرير' : 'Report actions',
        primary: [{ key: 'home', kind: 'gold', label: isArabic ? 'العودة للرئيسية ←' : 'Back to Home →', disabled: false }],
        secondary: [],
        meta: '',
      }
  usePublishBar(onBar, barData, {
    finish: () => finish(),
    save: () => save(),
    home: () => ui.closeSession(),
  })

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
            <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={draft.lesson_topic} onChange={(e) => updateDraft({ lesson_topic: e.target.value })} placeholder={isArabic ? 'موضوع الحصة...' : 'Lesson topic...'} />
          </label>
          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'تفاصيل الواجب' : 'Homework details'}</span>
            <textarea className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full min-h-[64px]" value={draft.homework_text} onChange={(e) => updateDraft({ homework_text: e.target.value })} placeholder={isArabic ? 'الواجب المطلوب...' : 'Homework...'} />
          </label>
          <label className="block">
            <span className="block text-[.75rem] font-extrabold mb-1.5">{isArabic ? 'رابط فيديو الشرح' : 'Lesson video link'}</span>
            <input dir="ltr" className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full" value={draft.video_link} onChange={(e) => updateDraft({ video_link: e.target.value })} placeholder="https://..." />
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

      {/* Reports queue — completed sessions only (existing business rule).
          Scope selector (spec 30): all / present-only / absent-only. */}
      <div className="rounded-2xl p-4 mb-5" style={{ background: 'var(--surface-container)', border: '1px solid var(--surface-border)' }}>
        <b className="block mb-1 text-[.8rem]">{isArabic ? 'تقارير أولياء الأمور (WhatsApp)' : 'Parent reports (WhatsApp)'}</b>
        <p className="text-[.7rem] text-fg-muted m-0 mb-3">
          {lessonCompleted
            ? (isArabic ? 'اختر نطاق التقارير ثم ابنِ قائمة الإرسال — يفتح واتساب لكل طالب على حدة.' : 'Pick the report scope, then build the send queue — WhatsApp opens per student.')
            : (isArabic ? 'أنهِ الحصة أولًا لتفعيل التقارير (قاعدة النظام الحالية).' : 'Finish the session first to enable reports (existing rule).')}
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {[
            ['all', isArabic ? `الكل (${counts.total})` : `All (${counts.total})`],
            ['present', isArabic ? `الحاضرون (${counts.present})` : `Present (${counts.present})`],
            ['absent', isArabic ? `الغائبون (${counts.absent})` : `Absent (${counts.absent})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setQueueScope(key)}
              aria-pressed={queueScope === key}
              className={queueScope === key ? 'nk-att-chip nk-att-chip--on' : 'nk-att-chip'}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="btn-navy action-button !min-h-[3rem]"
          disabled={!lessonCompleted}
          onClick={buildQueue}
        >
          ↗ {isArabic ? 'قائمة التقارير' : 'Build report queue'}
        </button>
      </div>

      {/* FINISH SESSION — the action lives in the persistent workflow bar;
          this card explains what finishing does (rule 7: SAVE ≠ FINISH). */}
      {lessonOpen ? (
        <div className="rounded-2xl p-4" style={{ background: 'var(--ok-bg)', border: '1px solid var(--ok-border)' }}>
          <b className="block mb-1 text-[.85rem]" style={{ color: 'var(--ok-strong)' }}>{isArabic ? 'إنهاء الحصة' : 'Finish session'}</b>
          <p className="text-[.72rem] m-0" style={{ color: 'var(--ok-strong)' }}>
            {isArabic
              ? 'الإنهاء يحوّل غير المرصد إلى غائب، يغلق الحصة، ويرسل التحديث النهائي لأولياء الأمور. الحفظ شيء والإنهاء شيء آخر — زر الإنهاء في الشريط بالأسفل.'
              : 'Finishing converts unrecorded to absent, closes the session, and sends the final parent update. Save and Finish are separate — the Finish button is in the bar below.'}
          </p>
        </div>
      ) : lessonCompleted ? (
        <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--info-bg)', border: '1px solid var(--info-border)' }}>
          <p className="m-0 text-[.8rem] font-extrabold" style={{ color: 'var(--info-strong)' }}>
            ✓ {isArabic ? 'الحصة منتهية ومحفوظة في السجل — يمكن للطالب رؤيتها في بوابته.' : 'Session completed and logged — visible in the student portal.'}
          </p>
        </div>
      ) : null}
    </div>
  )
}

