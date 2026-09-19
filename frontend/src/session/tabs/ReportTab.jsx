import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../../store/WorkspaceStore'
import { useUI } from '../../shell/UIContext'
import { buildAttendanceMessage } from '../../lib/qrPdfWhatsApp'
import { isValidPhone, normalizeEgyptianPhone } from '../../lib/helpers'
import { getStudentRank, getStudentRankPosition } from '../../lib/helpers'
import RecipientPickerModal from '../../components/RecipientPickerModal'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [picker, setPicker] = useState(null) // { candidates, title, subtitle, preselect }

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
  // Recipient targeting (spec 10–11, 15): ONE primary action opens a menu
  // (absent / present / all / manual) — unequal actions never get equal
  // weight. The picker opens prefilled per scope; the PRESENT template goes
  // to present students and the ABSENT template to absent ones (spec 12),
  // with warning balances from real data (spec 13).
  const buildCandidates = () => {
    const items = []
    for (const s of groupStudents) {
      const row = attendanceMap[s.id]
      const finalAttendance = row?.status || 'لم يرصد'
      const hasPhone = Boolean(s.phone && isValidPhone(s.phone))
      const reportStudent = { ...s, attendance_status: finalAttendance, hw_status: row?.homework_status || s.hw_status }
      items.push({
        key: s.id,
        student: reportStudent,
        phone: hasPhone ? normalizeEgyptianPhone(s.phone) : '',
        message: buildAttendanceMessage(reportStudent, { status: finalAttendance, lesson, settings: ws.settings, groupName: groupId }),
        lessonId: lesson?.id,
        statusLabel: finalAttendance,
        statusType: finalAttendance === 'حاضر' ? 'present' : finalAttendance === 'غائب' ? 'absent' : 'none',
        disabled: !hasPhone,
      })
    }
    return items
  }

  const openQueue = (scope) => {
    setMenuOpen(false)
    const candidates = buildCandidates()
    if (!candidates.some((c) => !c.disabled)) {
      ws.showToast?.(isArabic ? 'لا يوجد طلاب لديهم أرقام صحيحة' : 'No students with valid phone numbers', 'error')
      return
    }
    const titles = {
      absent: isArabic ? `تقرير الغياب — ${counts.absent} غائب` : `Absence report — ${counts.absent} absent`,
      present: isArabic ? `تقرير الحضور — ${counts.present} حاضر` : `Attendance report — ${counts.present} present`,
      all: isArabic ? `تقرير الحصة — ${counts.total} طالب` : `Session report — ${counts.total} students`,
      manual: isArabic ? 'تقرير الحصة — تحديد يدوي' : 'Session report — manual selection',
    }
    const subtitles = {
      absent: isArabic ? 'المقترح: الغائبون فقط. عدّل التحديد إن أردت — لن يُرسل شيء حتى تضغط متابعة.' : 'Suggested: absent only. Adjust freely — nothing sends until you continue.',
      present: isArabic ? 'المقترح: الحاضرون فقط. عدّل التحديد إن أردت — لن يُرسل شيء حتى تضغط متابعة.' : 'Suggested: present only. Adjust freely — nothing sends until you continue.',
      all: isArabic ? 'المقترح: كل الطلاب. عدّل التحديد إن أردت — لن يُرسل شيء حتى تضغط متابعة.' : 'Suggested: all students. Adjust freely — nothing sends until you continue.',
      manual: isArabic ? 'اختر المستلمين يدويًا — لن يُرسل شيء حتى تضغط متابعة.' : 'Pick recipients manually — nothing sends until you continue.',
    }
    setPicker({ candidates, title: titles[scope], subtitle: subtitles[scope], preselect: scope })
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
          Recipient targeting (spec 15): ONE primary action + menu — unequal
          actions never get equal visual weight. */}
      <div className="rounded-2xl p-4 mb-5" style={{ background: 'var(--surface-container)', border: '1px solid var(--surface-border)' }}>
        <b className="block mb-1 text-[.8rem]">{isArabic ? 'تقارير أولياء الأمور (WhatsApp)' : 'Parent reports (WhatsApp)'}</b>
        <p className="text-[.7rem] text-fg-muted m-0 mb-3">
          {lessonCompleted
            ? (isArabic ? 'اختر المستلمين — رسالة الحاضر تختلف عن رسالة الغائب ورصيد الإنذارات يُحسب تلقائيًا.' : 'Pick recipients — present and absent students get different messages, warning balances are computed live.')
            : (isArabic ? 'أنهِ الحصة أولًا لتفعيل التقارير (قاعدة النظام الحالية).' : 'Finish the session first to enable reports (existing rule).')}
        </p>
        <div className="nk-menu-wrap">
          <button
            className="btn-navy action-button !min-h-[3rem]"
            disabled={!lessonCompleted}
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
          >
            ↗ {isArabic ? 'إرسال التقرير' : 'Send report'} ▼
          </button>
          {menuOpen && lessonCompleted && (
            <>
              <div className="nk-menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div className="nk-menu-sheet" role="menu" aria-label={isArabic ? 'مستلمو التقرير' : 'Report recipients'}>
                <b className="nk-menu-sheet__title">{isArabic ? 'اختر المستلمين' : 'Choose recipients'}</b>
                <button role="menuitem" className={counts.absent === 0 ? 'opacity-40' : ''} disabled={counts.absent === 0} onClick={() => openQueue('absent')}>
                  <span>✗ {isArabic ? 'الغائبون فقط' : 'Absent students'}</span>
                  <small>{counts.absent} · {isArabic ? 'رسالة الغياب' : 'absence message'}</small>
                </button>
                <button role="menuitem" className={counts.present === 0 ? 'opacity-40' : ''} disabled={counts.present === 0} onClick={() => openQueue('present')}>
                  <span>✓ {isArabic ? 'الحاضرون فقط' : 'Present students'}</span>
                  <small>{counts.present} · {isArabic ? 'رسالة الحضور' : 'attendance message'}</small>
                </button>
                <button role="menuitem" disabled={counts.total === 0} onClick={() => openQueue('all')}>
                  <span>◉ {isArabic ? 'كل الطلاب' : 'All students'}</span>
                  <small>{counts.total} · {isArabic ? 'رسالة حسب حالة كل طالب' : 'message per student status'}</small>
                </button>
                <button role="menuitem" disabled={counts.total === 0} onClick={() => openQueue('manual')}>
                  <span>☰ {isArabic ? 'تحديد يدوي' : 'Manual selection'}</span>
                  <small>{isArabic ? 'اخترهم واحدًا واحدًا' : 'Pick students one by one'}</small>
                </button>
              </div>
            </>
          )}
        </div>
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

      {/* Recipient picker (spec 10–11): preselection follows the chosen scope;
          per-student toggles cover the "selected students" case. */}
      {picker && (
        <RecipientPickerModal
          open
          onClose={() => setPicker(null)}
          candidates={picker.candidates}
          title={picker.title}
          subtitle={picker.subtitle}
          preselected={(c) => {
            if (picker.preselect === 'all') return true
            if (picker.preselect === 'manual') return false
            return c.statusType === picker.preselect
          }}
          onStart={(items) => { setPicker(null); ui.startQueue(items) }}
        />
      )}
    </div>
  )
}

