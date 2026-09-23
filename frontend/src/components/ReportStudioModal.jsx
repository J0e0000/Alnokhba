import { useMemo, useState } from 'react'
import Modal from './Modal'
import LineTemplateEditor from './LineTemplateEditor'
import {
  buildAttendanceMessage, DEFAULT_PRESENT_TEMPLATE, DEFAULT_ABSENT_TEMPLATE,
} from '../lib/qrPdfWhatsApp'
import { isValidPhone, normalizeEgyptianPhone } from '../lib/helpers'
import {
  REPORT_KINDS, DEFAULT_TEMPLATES, BRICKS_BY_KIND,
  weekWindow, studentWeekStats, groupWeekStats, sessionStats, followUpStudents,
  studentWeeklyVars, examResultVars, teacherSessionVars, teacherWeeklyVars, followUpVars,
  interpolateTemplate, examScorePct, arabicDay,
} from '../lib/reportBuilders'

// ═══════════════════════════════════════════════════════════════════════════
// REPORT STUDIO (استوديو التقارير) — one modal per report kind.
//
// LEFT PANE  = القالب: line-by-line editor (LineTemplateEditor) + bricks +
//              ready Egyptian template + save to teacher_settings.
// RIGHT PANE = المعاينة: the SAME template interpolated with REAL rows from
//              the workspace store (no fake numbers), plus the send / copy /
//              save-to-bell actions.
//
// The parent remounts us per kind (key={kind}) so the template seeds exactly
// once per open — the proven fix for the caret-jump family of bugs.
// ═══════════════════════════════════════════════════════════════════════════

export default function ReportStudioModal({
  open, onClose, kind, ws, onSwitchKind,
  onSaveTemplate, onQueue, onBell,
}) {
  const { isArabic } = ws
  const meta = REPORT_KINDS[kind]
  const settings = ws.settings || {}
  const isSessionKind = kind === 'session'

  // ── Template state (seeded once per mount) ──────────────────────────────
  const initialTemplates = useMemo(() => (isSessionKind
    ? {
        present: settings.msg_attendance_present || DEFAULT_PRESENT_TEMPLATE,
        absent: settings.msg_attendance_absent || DEFAULT_ABSENT_TEMPLATE,
      }
    : { [meta.settingsKey]: settings[meta.settingsKey] || DEFAULT_TEMPLATES[meta.settingsKey] || '' }))
  const [templates, setTemplates] = useState(initialTemplates)

  const [subType, setSubType] = useState('present') // session kind only
  const activeKey = isSessionKind ? (subType === 'present' ? 'msg_attendance_present' : 'msg_attendance_absent') : meta.settingsKey
  const template = isSessionKind ? templates[subType] : templates[meta.settingsKey]

  const setTemplate = (next) => {
    setTemplates((prev) => (isSessionKind
      ? { ...prev, [subType]: next }
      : { ...prev, [meta.settingsKey]: next }))
  }
  const dirty = String(template || '') !== String(initialTemplates[isSessionKind ? subType : meta.settingsKey] || '')

  // ── Data selectors ───────────────────────────────────────────────────────
  const [group, setGroup] = useState(ws.groups[0] || '')
  const [lessonId, setLessonId] = useState('')
  const [examId, setExamId] = useState('')
  const [weekOffset, setWeekOffset] = useState(0)
  const [previewStudentId, setPreviewStudentId] = useState('')

  const groupStudents = useMemo(
    () => ws.students.filter((s) => s.group_name === group),
    [ws.students, group],
  )
  const completedLessons = useMemo(
    () => ws.lessonSessions
      .filter((l) => l.group_name === group && l.status === 'completed')
      .sort((a, b) => String(b.session_date).localeCompare(String(a.session_date)))
      .slice(0, 30),
    [ws.lessonSessions, group],
  )
  const lesson = completedLessons.find((l) => l.id === lessonId) || completedLessons[0] || null
  const week = useMemo(() => weekWindow(new Date(), weekOffset), [weekOffset])

  const examsWithScores = useMemo(() => {
    const hasScores = new Set(Object.values(ws.examScoresByStudent || {}).flat().map((sc) => sc.exam_id))
    return (ws.examsList || [])
      .filter((e) => hasScores.has(e.id))
      .map((e) => ({
        ...e,
        groupName: (ws.lessonSessions.find((l) => l.id === e.lesson_session_id) || {}).group_name || '',
      }))
      .slice(0, 40)
  }, [ws.examsList, ws.examScoresByStudent, ws.lessonSessions])
  const exam = examsWithScores.find((e) => e.id === examId) || examsWithScores[0] || null

  // ── Live preview + queue candidates (all real rows) ─────────────────────
  const sessionData = useMemo(() => {
    if ((kind !== 'session' && kind !== 'teacher-session') || !lesson) return null
    const rows = (ws.allAttendance || []).filter((r) => r.lesson_session_id === lesson.id)
    const byStudent = new Map(rows.map((r) => [r.student_id, r]))
    const stats = sessionStats({ lesson, attendanceRows: rows, groupStudents, examScoresByStudent: ws.examScoresByStudent || {}, examsList: ws.examsList || [] })
    const wanted = subType === 'present' ? 'حاضر' : 'غائب'
    const pick = kind === 'session'
      ? (groupStudents.find((s) => previewStudentId && s.id === previewStudentId)
        || groupStudents.find((s) => (byStudent.get(s.id)?.status) === wanted)
        || groupStudents[0]
        || null)
      : null
    const message = pick
      ? buildAttendanceMessage(
        { ...pick, attendance_status: byStudent.get(pick.id)?.status || pick.attendance_status, hw_status: byStudent.get(pick.id)?.homework_status || pick.hw_status },
        {
          status: byStudent.get(pick.id)?.status || 'لم يرصد',
          lesson,
          settings: { ...settings, msg_attendance_present: templates.present, msg_attendance_absent: templates.absent },
          groupName: group,
          examScores: (ws.examScoresByStudent || {})[pick.id] || [],
        },
      )
      : ''
    return { stats, pick, message, wanted, byStudent }
  }, [kind, lesson, ws.allAttendance, ws.examScoresByStudent, ws.examsList, groupStudents, subType, previewStudentId, settings, templates, group])

  const weeklyData = useMemo(() => {
    if (kind !== 'weekly') return null
    const build = (student) => {
      const stats = studentWeekStats({
        studentId: student.id, groupName: group,
        allAttendance: ws.allAttendance || [], lessonSessions: ws.lessonSessions || [],
        examScores: (ws.examScoresByStudent || {})[student.id] || [],
        startISO: week.startISO, endISO: week.endISO,
      })
      const vars = studentWeeklyVars({ student, stats, weekLabel: week.label, allStudents: ws.students, ranks: ws.ranks || [] })
      return { stats, message: interpolateTemplate(template, vars) }
    }
    const pick = groupStudents.find((s) => s.id === previewStudentId) || groupStudents[0] || null
    const held = groupStudents.reduce((acc, s) => Math.max(acc, build(s).stats.held), 0)
    return { pick, build, held }
  }, [kind, group, groupStudents, previewStudentId, ws.allAttendance, ws.lessonSessions, ws.examScoresByStudent, ws.students, ws.ranks, template, week])

  const examData = useMemo(() => {
    if (kind !== 'exam' || !exam) return null
    const scoreOf = (student) => ((ws.examScoresByStudent || {})[student.id] || [])
      .filter((sc) => sc.exam_id === exam.id)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null
    // Recipients = EVERY student holding a score for this exam (the exam's
    // group is derived from its linked session — no selector needed).
    const studentsWithScores = ws.students.filter((s) => scoreOf(s))
    const build = (student) => {
      const scoreRow = scoreOf(student)
      const vars = examResultVars({ student, scoreRow, groupName: exam.groupName || student.group_name })
      return { scoreRow, message: scoreRow ? interpolateTemplate(template, vars) : '' }
    }
    const pick = studentsWithScores.find((s) => s.id === previewStudentId) || studentsWithScores[0] || null
    return { exam, build, studentsWithScores, pick }
  }, [kind, exam, ws.examScoresByStudent, ws.students, template, previewStudentId])

  const teacherSessionText = useMemo(() => {
    if (kind !== 'teacher-session' || !lesson) return ''
    const rows = (ws.allAttendance || []).filter((r) => r.lesson_session_id === lesson.id)
    const stats = sessionStats({ lesson, attendanceRows: rows, groupStudents, examScoresByStudent: ws.examScoresByStudent || {}, examsList: ws.examsList || [] })
    return interpolateTemplate(template, teacherSessionVars({ lesson, stats, groupName: group }))
  }, [kind, lesson, ws.allAttendance, ws.examScoresByStudent, ws.examsList, groupStudents, group, template])

  const teacherWeeklyData = useMemo(() => {
    if (kind !== 'teacher-weekly') return null
    const stats = groupWeekStats({
      groupName: group, students: ws.students,
      allAttendance: ws.allAttendance || [], lessonSessions: ws.lessonSessions || [],
      examScoresByStudent: ws.examScoresByStudent || {},
      startISO: week.startISO, endISO: week.endISO,
      warningsThreshold: settings.insight_config?.max_warnings,
    })
    return { stats, text: interpolateTemplate(template, teacherWeeklyVars({ stats, groupName: group, weekLabel: week.label })) }
  }, [kind, group, ws.students, ws.allAttendance, ws.lessonSessions, ws.examScoresByStudent, week, settings, template])

  const followUpData = useMemo(() => {
    if (kind !== 'followup') return null
    const followups = followUpStudents({
      groupName: group, students: ws.students,
      allAttendance: ws.allAttendance || [], lessonSessions: ws.lessonSessions || [],
      examScoresByStudent: ws.examScoresByStudent || {},
      warningsThreshold: settings.insight_config?.max_warnings,
    })
    const stats = { followups }
    return { stats, text: interpolateTemplate(template, followUpVars({ stats, groupName: group })) }
  }, [kind, group, ws.students, ws.allAttendance, ws.lessonSessions, ws.examScoresByStudent, settings, template])

  // ── Actions ──────────────────────────────────────────────────────────────
  const save = () => {
    if (isSessionKind) onSaveTemplate({ msg_attendance_present: templates.present, msg_attendance_absent: templates.absent })
    else onSaveTemplate({ [meta.settingsKey]: template })
  }

  const queueWeekly = () => {
    const candidates = groupStudents.map((s) => {
      const hasPhone = Boolean(s.phone && isValidPhone(s.phone))
      const { stats, message } = weeklyData.build(s)
      return {
        key: s.id, kind: 'weekly_report', student: s,
        phone: hasPhone ? normalizeEgyptianPhone(s.phone) : '',
        message, statusLabel: stats.present > 0 ? 'حضر' : stats.absent > 0 ? 'غاب' : 'لا سجل',
        statusType: 'none', disabled: !hasPhone,
      }
    })
    if (!weeklyData.held) { ws.showToast?.(isArabic ? 'مفيش حصص مكتملة للجروب ده في الفترة دي — مفيش حاجة تتبعت.' : 'No completed sessions for this group in the period.', 'error'); return }
    if (!candidates.some((c) => !c.disabled)) { ws.showToast?.(isArabic ? 'لا يوجد طلاب بأرقام صحيحة' : 'No students with valid phones', 'error'); return }
    onQueue(candidates, {
      title: isArabic ? `التقرير الأسبوعي — ${group}` : `Weekly report — ${group}`,
      subtitle: isArabic ? 'الرسالة بتتبني من بيانات كل طالب الحقيقية في الأسبوع. عدّل التحديد براحتك — مفيش حاجة تتبعت غير لما تضغط متابعة.' : 'Each message is built from the student\'s real week data. Nothing sends until you continue.',
      preselect: 'hasphone',
    })
  }

  const queueExam = () => {
    const candidates = (examData.studentsWithScores || []).map((s) => {
      const hasPhone = Boolean(s.phone && isValidPhone(s.phone))
      const { scoreRow, message } = examData.build(s)
      const pct = scoreRow ? examScorePct(scoreRow) : null
      return {
        key: s.id, kind: 'exam_result', student: s,
        phone: hasPhone ? normalizeEgyptianPhone(s.phone) : '',
        message: scoreRow ? message : '',
        statusLabel: scoreRow ? (pct != null ? `${pct}%` : 'مسجل') : 'لا نتيجة',
        statusType: 'none',
        disabled: !hasPhone || !scoreRow,
      }
    })
    if (!candidates.some((c) => !c.disabled)) {
      ws.showToast?.(isArabic ? 'مفيش طلاب لهم نتيجة في الاختبار ده (أو أرقام صحيحة).' : 'No students with a recorded score (or a valid phone) for this exam.', 'error')
      return
    }
    onQueue(candidates, {
      title: isArabic ? `نتيجة اختبار — ${exam.title}` : `Exam result — ${exam.title}`,
      subtitle: isArabic ? 'المقترح: كل من عنده نتيجة ورقم صحيح. عدّل التحديد — مفيش حاجة تتبعت غير لما تضغط متابعة.' : 'Suggested: everyone with a score and a valid phone. Nothing sends until you continue.',
      preselect: 'hasphone',
    })
  }

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      ws.showToast?.(isArabic ? 'تم نسخ التقرير ✓ الصقه في واتساب أو أي مكان' : 'Report copied ✓', 'success')
    } catch {
      ws.showToast?.(isArabic ? 'المتصفح رفض النسخ — حدد النص وانسخه يدويًا.' : 'Copy was blocked — select the text and copy manually.', 'error')
    }
  }

  const saveToBell = (text) => {
    const lines = String(text || '').split('\n')
    const title = (lines[0] || meta.title).slice(0, 90)
    const body = lines.slice(1).join('\n').trim()
    onBell({ title, body })
  }

  // Session reports: send straight from here (was: “go press the other
  // button above” — that indirection was the #1 confusion). Same builder as
  // the quick queue, using the template currently in the editor.
  const buildSessionCandidates = () => {
    if (!lesson || !sessionData?.byStudent) return []
    return groupStudents.map((s) => {
      const hasPhone = Boolean(s.phone && isValidPhone(s.phone))
      const row = sessionData.byStudent.get(s.id)
      const status = row?.status || 'لم يرصد'
      const reportStudent = { ...s, attendance_status: row?.status || s.attendance_status, hw_status: row?.homework_status || s.hw_status }
      return {
        key: s.id, kind: 'session_report', student: reportStudent,
        phone: hasPhone ? normalizeEgyptianPhone(s.phone) : '',
        message: buildAttendanceMessage(reportStudent, {
          status, lesson,
          settings: { ...settings, msg_attendance_present: templates.present, msg_attendance_absent: templates.absent },
          groupName: group,
          examScores: (ws.examScoresByStudent || {})[s.id] || [],
        }),
        lessonId: lesson.id, statusLabel: status,
        statusType: status === 'حاضر' ? 'present' : status === 'غائب' ? 'absent' : 'none',
        disabled: !hasPhone,
      }
    })
  }

  // ── Render helpers ───────────────────────────────────────────────────────
  const sel = 'glass-input rounded-xl px-3 py-2.5 text-[.78rem] min-w-[150px] flex-1'
  const label = (t) => <span className="block text-[.7rem] font-extrabold text-fg-subtle mb-1">{t}</span>

  const previewBox = (text, note) => (
    <div>
      <div className="rounded-2xl p-3.5 whitespace-pre-line text-[.8rem] leading-relaxed" style={{ background: 'var(--surface-container-high)', border: '1px solid var(--surface-border)' }}>
        {text || <span className="text-fg-subtle text-[.75rem]">{note || '—'}</span>}
      </div>
      <p className="text-[10px] text-fg-subtle mt-1.5 mb-0">{note}</p>
    </div>
  )

  const emptyWeekNote = isArabic
    ? 'مفيش حصص مكتملة للجروب ده في الأسبوع المختار — التقرير هيفضى تلقائيًا. جرّب أسبوع تاني.'
    : 'No completed sessions for this group in the selected week.'

  return (
    <Modal open={open} onClose={onClose} title={`${meta.icon} ${meta.title}`} wide>
      <p className="text-fg-subtle text-xs mb-3">{isArabic ? 'عدّل الأسطر أو سيبه زي ما هو — المعاينة بأرقام حقيقية من بياناتك.' : 'Edit the lines or send as-is — the preview uses your real data.'}</p>

      {/* تبديل نوع التقرير من جوه — بدون الرجوع للشاشة */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {Object.entries(REPORT_KINDS).map(([k, m]) => (
          <button key={k} type="button" onClick={() => k !== kind && onSwitchKind?.(k)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold border transition-colors ${k === kind ? 'bg-brand-gold/15 text-brand-gold-hover border-brand-gold/40' : 'border-subtle text-fg-subtle hover:text-fg'}`}>
            {m.icon} {SHORT_KIND_LABELS[k] || m.title}
          </button>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-5">

        {/* ── القالب ── */}
        <div>
          {isSessionKind && (
            <div className="flex gap-1.5 mb-3">
              {[['present', 'رسالة الحاضر ✓'], ['absent', 'رسالة الغائب ✗']].map(([key, lbl]) => (
                <button key={key} type="button" onClick={() => setSubType(key)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold border transition-colors ${subType === key ? 'bg-brand-gold/15 text-brand-gold-hover border-brand-gold/40' : 'border-subtle text-fg-subtle hover:text-fg'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          )}
          <label className="block mb-3">
            {label(isArabic ? 'سطر بسطر — عدّل، ضيف، امسح، أو رتّب' : 'Line by line')}
            <LineTemplateEditor
              key={activeKey}
              value={template}
              onChange={setTemplate}
              bricks={isSessionKind ? (subType === 'present' ? BRICKS.sessionPresent : BRICKS.sessionAbsent) : (BRICKS_BY_KIND[kind] || [])}
              readyTemplate={isSessionKind ? undefined : DEFAULT_TEMPLATES[meta.settingsKey]}
              hint={isArabic
                ? 'السطر الفاضي بيختفي من الرسالة تلقائيًا، ولو مكانه فاضي هيتحط في مكان المؤشر. لو مفيش بيانات للحبة (زي ما فيش امتحان) السطر كله بيختفي.'
                : 'Empty lines disappear from the message; a brick with no data removes its whole line.'}
            />
          </label>
          <button type="button" className="btn-navy action-button !min-h-[2.9rem] w-full" disabled={!dirty} onClick={save}>
            💾 {isArabic ? 'حفظ القالب' : 'Save template'}
          </button>
        </div>

        {/* ── المعاينة + الأفعال ── */}
        <div>
          {label(isArabic ? 'المعاينة ببيانات حقيقية' : 'Live preview with real data')}
          <div className="flex flex-wrap gap-2 mb-3">
            {kind !== 'exam' && (
              <select className={sel} value={group} onChange={(e) => { setGroup(e.target.value); setLessonId(''); setPreviewStudentId('') }} aria-label={isArabic ? 'المجموعة' : 'Group'}>
                {ws.groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            {isSessionKind && (
              <select className={sel} value={lesson?.id || ''} onChange={(e) => setLessonId(e.target.value)} aria-label={isArabic ? 'الحصة' : 'Session'}>
                {completedLessons.length === 0 && <option value="">{isArabic ? 'مفيش حصص منتهية' : 'No completed sessions'}</option>}
                {completedLessons.map((l) => <option key={l.id} value={l.id}>{l.session_date}{l.lesson_topic ? ` — ${l.lesson_topic.slice(0, 20)}` : ''}</option>)}
              </select>
            )}
            {kind === 'exam' && (
              <select className={sel} value={exam?.id || ''} onChange={(e) => setExamId(e.target.value)} aria-label={isArabic ? 'الاختبار' : 'Exam'}>
                {examsWithScores.length === 0 && <option value="">{isArabic ? 'مفيش اختبارات مسجلة النتائج' : 'No exams with scores'}</option>}
                {examsWithScores.map((e) => <option key={e.id} value={e.id}>{e.title}{e.groupName ? ` — ${e.groupName}` : ''}</option>)}
              </select>
            )}
            {(kind === 'weekly' || kind === 'teacher-weekly') && (
              <select className={sel} value={weekOffset} onChange={(e) => setWeekOffset(Number(e.target.value))} aria-label={isArabic ? 'الأسبوع' : 'Week'}>
                <option value={0}>{isArabic ? 'الأسبوع الحالي' : 'This week'}</option>
                <option value={1}>{isArabic ? 'الأسبوع اللي فات' : 'Last week'}</option>
              </select>
            )}
            {(kind === 'session' || kind === 'weekly') && (
              <select className={sel} value={previewStudentId} onChange={(e) => setPreviewStudentId(e.target.value)} aria-label={isArabic ? 'طالب المعاينة' : 'Preview student'}>
                <option value="">{isArabic ? 'معاينة: اختيار تلقائي' : 'Preview: auto'}</option>
                {groupStudents.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {kind === 'exam' && (
              <select className={sel} value={previewStudentId} onChange={(e) => setPreviewStudentId(e.target.value)} aria-label={isArabic ? 'طالب المعاينة' : 'Preview student'}>
                <option value="">{isArabic ? 'معاينة: اختيار تلقائي' : 'Preview: auto'}</option>
                {(examData?.studentsWithScores || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>

          {kind === 'session' && previewBox(sessionData?.message, sessionData?.pick
            ? (isArabic ? `معاينة رسالة: ${sessionData.pick.name} — الحالة الفعلية «${sessionData.wanted}»` : `Preview: ${sessionData.pick.name}`)
            : (isArabic ? 'مفيش حصة مختارة أو مفيش طلاب.' : 'No session or students selected.'))}

          {kind === 'weekly' && (weeklyData?.held
            ? previewBox(weeklyData.pick ? weeklyData.build(weeklyData.pick).message : '', weeklyData.pick ? (isArabic ? `معاينة رسالة: ${weeklyData.pick.name} — بيانات ${week.label}` : `Preview: ${weeklyData.pick.name}`) : (isArabic ? 'مفيش طلاب في الجروب.' : 'No students in group.'))
            : previewBox('', emptyWeekNote))}

          {kind === 'exam' && (examData?.pick
            ? previewBox(examData.build(examData.pick).message, isArabic ? `معاينة رسالة: ${examData.pick.name} — نتيجته الفعلية في «${examData.exam.title}»` : `Preview: ${examData.pick.name}`)
            : previewBox('', isArabic ? 'مفيش طلاب لهم نتيجة في الاختبار ده لسه.' : 'No students have a score for this exam yet.'))}

          {kind === 'teacher-session' && previewBox(teacherSessionText, lesson
            ? (isArabic ? `تقرير حصة ${arabicDay(lesson.session_date)} — ${statsLine(sessionData)}` : 'Session report preview')
            : (isArabic ? 'اختار حصة منتهية الأول.' : 'Pick a completed session first.'))}

          {kind === 'teacher-weekly' && previewBox(teacherWeeklyData?.text, teacherWeeklyData?.stats.held
            ? (isArabic ? `ملخص ${week.label} — ${teacherWeeklyData.stats.held} حصة مكتملة` : 'Weekly summary')
            : emptyWeekNote)}

          {kind === 'followup' && previewBox(followUpData?.text, followUpData?.stats.followups.length
            ? (isArabic ? `${followUpData.stats.followups.length} طلاب اتكشفوا من القواعد الحقيقية (غياب متكرر / واجب / تراجع درجات / إنذارات).` : 'Detected by real rules only.')
            : (isArabic ? 'مفيش حد محتاج متابعة حاليًا حسب نفس القواعد 👍' : 'Nobody needs follow-up right now 👍'))}

          {/* الأفعال */}
          <div className="flex flex-wrap gap-2 mt-3">
            {kind === 'weekly' && (
              <button type="button" className="btn-gold action-button !min-h-[2.9rem] flex-1" onClick={queueWeekly} disabled={!weeklyData?.held}>
                ↗ {isArabic ? 'اختيار المستلمين والإرسال' : 'Pick recipients & send'}
              </button>
            )}
            {kind === 'exam' && (
              <button type="button" className="btn-gold action-button !min-h-[2.9rem] flex-1" onClick={queueExam} disabled={!examData}>
                ↗ {isArabic ? 'اختيار المستلمين والإرسال' : 'Pick recipients & send'}
              </button>
            )}
            {kind === 'session' && (() => {
              const candidates = buildSessionCandidates()
              const canSend = Boolean(sessionData?.stats && candidates.some((c) => !c.disabled))
              return (
                <button type="button" className="btn-gold action-button !min-h-[2.9rem] flex-1" disabled={!canSend}
                  onClick={() => onQueue(candidates, {
                    title: isArabic ? `تقارير الحصة — ${lesson.session_date}` : `Session reports — ${lesson.session_date}`,
                    subtitle: isArabic ? 'المقترح: كل الطلاب — رسالة حسب حالة كل طالب. عدّل التحديد كما تحب — مفيش حاجة تتبعت غير لما تضغط متابعة.' : 'Suggested: everyone — message matches each student\'s status. Nothing sends until you continue.',
                    preselect: 'all',
                  })}>
                  ↗ {isArabic ? 'اختيار المستلمين والإرسال' : 'Pick recipients & send'}
                </button>
              )
            })()}
            {(kind === 'teacher-session' || kind === 'teacher-weekly' || kind === 'followup') && (() => {
              const out = kind === 'teacher-session' ? teacherSessionText : kind === 'teacher-weekly' ? teacherWeeklyData?.text : followUpData?.text
              const hasContent = Boolean((out || '').trim())
              return (
                <>
                  <button type="button" className="btn-ghost action-button !min-h-[2.9rem] flex-1" disabled={!hasContent} onClick={() => copyText(out)}>
                    ⧉ {isArabic ? 'نسخ التقرير' : 'Copy report'}
                  </button>
                  <button type="button" className="btn-ghost action-button !min-h-[2.9rem] flex-1" disabled={!hasContent} onClick={() => saveToBell(out)}>
                    🔔 {isArabic ? 'حفظ في التنبيهات' : 'Save to notifications'}
                  </button>
                </>
              )
            })()}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// Small helper for the teacher-session preview note.
function statsLine(sessionData) {
  if (!sessionData?.stats) return ''
  const s = sessionData.stats
  return `حاضر ${s.present} / غياب ${s.absent}`
}

// Short labels for the kind-switcher chips (full titles stay in REPORT_KINDS).
const SHORT_KIND_LABELS = {
  session: 'تقرير الحصة',
  weekly: 'الأسبوعي',
  exam: 'الاختبار',
  'teacher-session': 'حصة للمدرس',
  'teacher-weekly': 'أسبوع للمدرس',
  followup: 'المتابعة',
}

// Session bricks are static — defined once (present/absent share the base set).
const BRICKS = {
  sessionPresent: [
    ['اسم الطالب', '{studentName}'], ['المجموعة', '{group}'], ['التاريخ', '{date}'],
    ['موضوع الحصة', '{lessonLine}'], ['سطر الواجب', '{homeworkLine}'], ['سطر الامتحان', '{examLine}'],
    ['النقاط', '{pointsLine}'],
  ],
  sessionAbsent: [
    ['اسم الطالب', '{studentName}'], ['المجموعة', '{group}'], ['التاريخ', '{date}'],
    ['موضوع الحصة', '{lessonLine}'], ['رابط الفيديو', '{videoLink}'], ['سطر الواجب', '{homeworkLine}'],
    ['الإنذارات الحالية', '{warnings}'], ['الإنذارات المتبقية', '{remainingWarnings}'],
  ],
}
