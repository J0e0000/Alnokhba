import { useMemo, useState } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import TemplatesModal from '../components/TemplatesModal'
import AnnouncementsModal from '../components/AnnouncementsModal'
import RecipientPickerModal from '../components/RecipientPickerModal'
import ReportStudioModal from '../components/ReportStudioModal'
import CustomMessageModal from '../components/CustomMessageModal'
import { buildAttendanceMessage, getOrCreateStudentToken, buildStudentQRLink, buildQRMessage } from '../lib/qrPdfWhatsApp'
import { isValidPhone } from '../lib/helpers'
import { normalizeEgyptianPhone } from '../lib/helpers'
import { downloadCSV } from '../lib/csv'
import { supabase } from '../lib/supabaseClient'
import { friendlySaveErrorText } from '../lib/friendlyError'
import { track } from '../lib/posthog'

// ═══════════════════════════════════════════════════════════════════════════
// REPORTS AREA (rule 14/22) — broader, batch reporting lives OUTSIDE the
// session pipeline. The in-session report (current session only) is in the
// Session Workspace's Report tab. Templates + announcements live here too.
// ═══════════════════════════════════════════════════════════════════════════
export default function ReportsArea() {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [group, setGroup] = useState(ws.groups[0] || '')
  const [lessonId, setLessonId] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [announcementsOpen, setAnnouncementsOpen] = useState(false)
  const [studioKind, setStudioKind] = useState(null) // REPORT_KINDS key
  const [busy, setBusy] = useState('')
  const [picker, setPicker] = useState(null) // { candidates, title, subtitle, preselect, custom? }
  const [composer, setComposer] = useState(null) // CustomMessageModal students

  const completedLessons = useMemo(
    () => ws.lessonSessions.filter((l) => l.group_name === group && l.status === 'completed')
      .sort((a, b) => String(b.session_date).localeCompare(String(a.session_date))).slice(0, 30),
    [ws.lessonSessions, group],
  )
  const lesson = ws.lessonSessions.find((l) => l.id === lessonId) || null

  // Session report queue → recipient picker (spec 10/11): default = every
  // student of the group; present vs absent get their own message template.
  const buildDailyReports = async () => {
    if (!lesson) return
    setBusy('reports')
    try {
      const { data: rows } = await supabaseLessonAttendance(lesson.id)
      const attendanceMap = Object.fromEntries((rows || []).map((r) => [r.student_id, r]))
      const groupStudents = ws.students.filter((s) => s.group_name === group)
      const candidates = groupStudents.map((s) => {
        const row = attendanceMap[s.id]
        const status = row?.status || 'لم يرصد'
        const hasPhone = Boolean(s.phone && isValidPhone(s.phone))
        const reportStudent = { ...s, attendance_status: row?.status || s.attendance_status, hw_status: row?.homework_status || s.hw_status }
        return {
          key: s.id,
          kind: 'session_report',
          student: reportStudent,
          phone: hasPhone ? normalizeEgyptianPhone(s.phone) : '',
          message: buildAttendanceMessage(reportStudent, { status, lesson, settings: ws.settings, examScores: ws.examScoresByStudent?.[s.id] || [] }),
          lessonId: lesson.id,
          statusLabel: status,
          statusType: status === 'حاضر' ? 'present' : status === 'غائب' ? 'absent' : 'none',
          disabled: !hasPhone,
        }
      })
      if (!candidates.some((c) => !c.disabled)) { ws.showToast?.(isArabic ? 'لا يوجد طلاب بأرقام صحيحة' : 'No students with valid phones', 'error'); return }
      setPicker({
        candidates,
        title: isArabic ? `تقارير الحصة — ${lesson.session_date}` : `Session reports — ${lesson.session_date}`,
        subtitle: isArabic ? 'المقترح: كل الطلاب — رسالة حسب حالة كل طالب. عدّل التحديد كما تحب.' : 'Suggested: everyone — message matches each student\'s status. Adjust freely.',
        preselect: 'all',
      })
    } finally { setBusy('') }
  }

  // QR links queue → recipient picker, links generated for valid phones only.
  // PERF: token creation used to be a sequential await per student (N network
  // round-trips); the per-student token ops are independent row upserts, so
  // they run in parallel — one round-trip latency for the whole group.
  const buildQRQueue = async () => {
    setBusy('qr')
    try {
      const groupStudents = ws.students.filter((s) => s.group_name === group)
      const template = ws.settings?.qr_message_template || ''
      const results = await Promise.all(groupStudents.map(async (s) => {
        const hasPhone = Boolean(s.phone && isValidPhone(s.phone))
        if (!hasPhone) {
          return { key: s.id, kind: 'qr_link', student: s, phone: '', message: '', qrUrl: '', template, statusLabel: '', statusType: 'none', disabled: true }
        }
        const token = await getOrCreateStudentToken(s.id)
        if (!token) return null
        const qrUrl = buildStudentQRLink(token)
        // buildQRMessage ALWAYS appends the link when the template lacks {link}
        const message = buildQRMessage(s.name, qrUrl, template)
        return {
          key: s.id, kind: 'qr_link', student: s, phone: normalizeEgyptianPhone(s.phone),
          message, qrUrl, template, statusLabel: '', statusType: 'none', disabled: false,
        }
      }))
      const candidates = results.filter(Boolean)
      if (!candidates.some((c) => !c.disabled)) { ws.showToast?.(isArabic ? 'لا يوجد طلاب بأرقام صحيحة' : 'No students with valid phones', 'error'); return }
      setPicker({
        candidates,
        title: isArabic ? 'روابط البوابة (QR)' : 'Portal links (QR)',
        subtitle: isArabic ? 'المقترح: كل من لديه رقم صحيح. لن يُرسل شيء حتى تضغط متابعة.' : 'Suggested: everyone with a valid phone. Nothing sends until you continue.',
        preselect: 'hasphone',
      })
    } finally { setBusy('') }
  }

  // CSV export of the picked completed session: attendance + homework per student.
  const exportSessionCSV = async () => {
    if (!lesson || busy === 'csv') return
    setBusy('csv')
    try {
      const { data: rows } = await supabase
        .from('attendance_records')
        .select('student_id, status, homework_status')
        .eq('lesson_session_id', lesson.id)
      const attendanceMap = Object.fromEntries((rows || []).map((r) => [r.student_id, r]))
      const groupStudents = ws.students.filter((s) => s.group_name === group)
      const csvRows = groupStudents.map((s) => {
        const r = attendanceMap[s.id]
        return [s.name, s.code || '', s.phone || '', r?.status || 'لم يرصد', r?.homework_status || 'لم يرصد']
      })
      downloadCSV(
        `session_${lesson.session_date}_${group.replace(/\s+/g, '_')}.csv`,
        ['الاسم', 'الكود', 'الهاتف', 'الحضور', 'الواجب'],
        csvRows,
      )
      ws.showToast?.(isArabic ? 'تم تحميل ملف CSV ✓' : 'CSV downloaded ✓', 'success')
    } catch {
      ws.showToast?.(isArabic ? 'تعذر تجهيز الملف' : 'Could not build the file', 'error')
    } finally { setBusy('') }
  }

  const bulkWelcome = () => {
    const groupStudents = ws.students.filter((s) => s.group_name === group)
    const candidates = groupStudents.map((s) => {
      const hasPhone = Boolean(s.phone && isValidPhone(s.phone))
      return {
        key: s.id, kind: 'welcome', student: s,
        phone: hasPhone ? normalizeEgyptianPhone(s.phone) : '',
        message: hasPhone ? (ws.settings?.msg_welcome || 'مرحبًا {studentName}').replace('{studentName}', s.name) : '',
        statusLabel: '', statusType: 'none', disabled: !hasPhone,
      }
    })
    if (!candidates.some((c) => !c.disabled)) { ws.showToast?.(isArabic ? 'لا يوجد طلاب بأرقام صحيحة' : 'No students with valid phones', 'error'); return }
    setPicker({
      candidates,
      title: isArabic ? 'رسالة ترحيب جماعية' : 'Bulk welcome message',
      subtitle: isArabic ? 'المقترح: كل من لديه رقم صحيح. لن يُرسل شيء حتى تضغط متابعة.' : 'Suggested: everyone with a valid phone. Nothing sends until you continue.',
      preselect: 'hasphone',
    })
  }

  // Custom message → SPECIFIC people (owner request): pick a group (the
  // select above), pick the exact students, write the text once, and the
  // send queue personalizes it per student ({studentName} {group} {date}).
  const openCustomMessagePicker = () => {
    const groupStudents = ws.students.filter((s) => s.group_name === group)
    if (!groupStudents.length) { ws.showToast?.(isArabic ? 'مفيش طلاب في المجموعة دي' : 'No students in this group', 'error'); return }
    const candidates = groupStudents.map((s) => {
      const hasPhone = Boolean(s.phone && isValidPhone(s.phone))
      return {
        key: s.id, kind: 'custom', student: s,
        phone: hasPhone ? normalizeEgyptianPhone(s.phone) : '',
        message: '',
        statusLabel: '', statusType: 'none', disabled: !hasPhone,
      }
    })
    setPicker({
      candidates,
      custom: true,
      title: isArabic ? `رسالة لمحددين — ${group}` : `Message specific people — ${group}`,
      subtitle: isArabic ? 'اختار الطلاب المطلوبين، وبعدها اكتب الرسالة مرة واحدة وتبعت لكل واحد باسمه.' : 'Pick the students, then write the message once — each gets a personalized copy.',
      preselect: 'manual',
    })
  }

  // ── استوديو التقارير handlers ──────────────────────────────────────────
  // Template persistence: one teacher_settings.update per save. A failure is
  // NEVER silent — friendlySaveErrorText maps missing-column (migration not
  // applied yet) / auth / network families to an exact next step.
  const saveStudioTemplate = async (patch) => {
    const { error } = await import('../lib/supabaseClient').then(({ supabase }) =>
      supabase.from('teacher_settings').update(patch).eq('teacher_id', ws.effectiveTeacherId),
    )
    if (!error) {
      ws.refreshSettings?.()
      ws.showToast?.(isArabic ? 'تم حفظ القالب ✓ هيُستخدم في كل التقارير الجاية' : 'Template saved ✓', 'success')
      track('report_templates_saved', { kinds: Object.keys(patch).join(',') })
    } else {
      ws.showToast?.(friendlySaveErrorText(error, isArabic), 'error')
    }
  }

  // Teacher reports → the persistent bell (Notification Center): the report
  // stays in the account instead of disappearing after being read.
  const saveStudioBell = async ({ title, body }) => {
    const { error } = await import('../lib/supabaseClient').then(({ supabase }) =>
      supabase.from('teacher_notification_events').insert({
        teacher_id: ws.effectiveTeacherId,
        event_type: 'other',
        title,
        body: body || '',
      }),
    )
    if (!error) ws.showToast?.(isArabic ? 'اتحفظ في مركز التنبيهات 🔔' : 'Saved to notifications 🔔', 'success')
    else ws.showToast?.(friendlySaveErrorText(error, isArabic), 'error')
  }

  return (
    <div>
      <h1 className="text-lg font-black m-0 mb-1">{isArabic ? 'التقارير' : 'Reports'}</h1>
      <p className="text-[.74rem] text-fg-muted mb-4">
        {isArabic ? 'ابعت تقارير الحصة والأسبوع، روابط البوابة، ورسائل لأي حد — كله من هنا.' : 'Session and weekly reports, portal links, and messages — all from here.'}
      </p>

      <div className="glass-card p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          <select className="glass-input rounded-xl px-3 py-2.5 text-[.78rem] min-w-[180px]" value={group} onChange={(e) => { setGroup(e.target.value); setLessonId('') }} aria-label={isArabic ? 'المجموعة' : 'Group'}>
            {ws.groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select className="glass-input rounded-xl px-3 py-2.5 text-[.78rem] min-w-[200px]" value={lessonId} onChange={(e) => setLessonId(e.target.value)} aria-label={isArabic ? 'الحصة' : 'Lesson'}>
            <option value="">{isArabic ? 'اختر حصة منتهية...' : 'Pick a completed session...'}</option>
            {completedLessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.session_date}{l.lesson_topic ? ` — ${l.lesson_topic.slice(0, 24)}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-navy action-button !min-h-[3rem]" disabled={!lesson || busy === 'reports'} onClick={buildDailyReports}>
            ↗ {isArabic ? 'قائمة تقارير الحصة' : 'Session report queue'}
          </button>
          <button className="btn-ghost action-button !min-h-[3rem]" disabled={busy === 'qr'} onClick={buildQRQueue}>
            ⛶ {isArabic ? 'قائمة روابط البوابة (QR)' : 'QR links queue'}
          </button>
          <button className="btn-ghost action-button !min-h-[3rem]" onClick={bulkWelcome}>
            ✆ {isArabic ? 'رسالة ترحيب جماعية' : 'Bulk welcome message'}
          </button>
          <button className="btn-gold action-button !min-h-[3rem]" onClick={openCustomMessagePicker}>
            ✆ {isArabic ? 'رسالة لمحددين…' : 'Message specific people…'}
          </button>
          {lesson && (
            <button
              className="btn-ghost action-button !min-h-[3rem]"
              onClick={() => ui.openSession({ groupId: group, date: lesson.session_date })}
              title={isArabic ? 'افتح الحصة في مساحة الحصة لتعديل بياناتها' : 'Open this session in the workspace to edit it'}
            >
              ✎ {isArabic ? 'تعديل هذه الحصة' : 'Edit this session'}
            </button>
          )}
          <button className="btn-ghost action-button !min-h-[3rem]" disabled={!lesson || busy === 'csv'} onClick={exportSessionCSV}>
            ⬇ {busy === 'csv' ? '...' : isArabic ? 'تصدير CSV' : 'Export CSV'}
          </button>
        </div>
        {!lesson && <p className="text-[.68rem] text-fg-muted mt-2 mb-0">{isArabic ? 'التقارير متاحة للحصص المنتهية فقط (نفس قاعدة النظام).' : 'Reports are available for completed sessions only (existing rule).'}</p>}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <button className="nk-content text-right cursor-pointer" onClick={() => setTemplatesOpen(true)}>
          <b className="block text-[.85rem] mb-1">✉ {isArabic ? 'قوالب الرسائل' : 'Message templates'}</b>
          <small className="text-fg-muted block">{isArabic ? 'ترحيب، إنذار، ترقية، تقرير، رابط QR — تُستخدم في كل قوائم الإرسال.' : 'Welcome, warning, promotion, report, QR templates.'}</small>
        </button>
        <button className="nk-content text-right cursor-pointer" onClick={() => setAnnouncementsOpen(true)}>
          <b className="block text-[.85rem] mb-1">📢 {isArabic ? 'الإعلانات والإشعارات' : 'Announcements'}</b>
          <small className="text-fg-muted block">{isArabic ? 'إرسال إعلان لكل الطلاب أو طالب محدد مع إشعار فوري.' : 'Broadcast to all students or one, with push.'}</small>
        </button>
      </div>

      {/* ── باب واحد لكل تخصيص التقارير (كان استوديو بـ 6 كروت — اتبسّط) ── */}
      <button className="nk-content text-right cursor-pointer w-full mt-4" onClick={() => setStudioKind('session')}>
        <b className="block text-[.85rem] mb-1">🎛 {isArabic ? 'قوالب التقارير' : 'Report templates'}</b>
        <small className="text-fg-muted block">{isArabic ? 'ستة تقارير جاهزة (الحصة، الأسبوعي، الاختبار، وملخصات المدرس) — عدّل أسطر أي واحد أو ابعتوه زي ما هو.' : 'Six ready reports — edit any of them line by line, or send as-is.'}</small>
      </button>

      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        settings={ws.settings}
        onSave={async (patch) => {
          const { error } = await import('../lib/supabaseClient').then(({ supabase }) =>
            supabase.from('teacher_settings').update(patch).eq('teacher_id', ws.effectiveTeacherId),
          )
          // Honest save reporting: a failed update used to be silently
          // swallowed here and the success toast fired regardless.
          if (!error) { ws.refreshSettings?.(); ws.showToast?.(isArabic ? 'تم حفظ القوالب' : 'Templates saved', 'success'); track('templates_saved'); setTemplatesOpen(false) }
          else ws.showToast?.(friendlySaveErrorText(error, isArabic), 'error')
        }}
      />
      {announcementsOpen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-16 overflow-y-auto" onClick={() => setAnnouncementsOpen(false)}>
          <div className="glass-card w-full max-w-lg p-4" onClick={(e) => e.stopPropagation()}>
            <AnnouncementsModal open onClose={() => setAnnouncementsOpen(false)} teacherId={ws.effectiveTeacherId} studentCount={ws.students.length} showToast={ws.showToast} />
          </div>
        </div>
      )}

      {/* باب التقارير القابلة للتخصيص — remounts per kind so the template
          seeds once per open (the caret-jump fix contract). */}
      {studioKind && (
        <ReportStudioModal
          key={studioKind}
          open
          onClose={() => setStudioKind(null)}
          kind={studioKind}
          ws={ws}
          onSwitchKind={setStudioKind}
          onSaveTemplate={saveStudioTemplate}
          onQueue={(candidates, meta) => setPicker({ ...meta, candidates })}
          onBell={saveStudioBell}
        />
      )}

      {/* Shared recipient picker — every batch send from this area confirms
          its recipients here first (spec 10–11: suggest, never force). */}
      {picker && (
        <RecipientPickerModal
          open
          onClose={() => setPicker(null)}
          candidates={picker.candidates}
          title={picker.title}
          subtitle={picker.subtitle}
          preselected={(c) => (picker.preselect === 'all' ? true : picker.preselect === 'manual' ? false : picker.preselect === 'hasphone' ? !c.disabled : c.statusType === picker.preselect)}
          onStart={(items) => {
            setPicker(null)
            if (picker.custom) {
              // Custom flow: the picked students go to the COMPOSER first —
              // nothing is queued until the text is written.
              setComposer(items.map((it) => it.student).filter(Boolean))
              return
            }
            ui.startQueue(items)
          }}
        />
      )}

      {/* Custom message composer — pick students → write once → queue */}
      {composer && (
        <CustomMessageModal
          open
          onClose={() => setComposer(null)}
          students={composer}
          settings={ws.settings}
          onSend={(items) => { setComposer(null); ui.startQueue(items) }}
        />
      )}
    </div>
  )
}

async function supabaseLessonAttendance(lessonId) {
  const { supabase } = await import('../lib/supabaseClient')
  return supabase.from('attendance_records').select('student_id, status, homework_status').eq('lesson_session_id', lessonId)
}
