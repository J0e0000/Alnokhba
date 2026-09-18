import { useMemo, useState } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import TemplatesModal from '../components/TemplatesModal'
import AnnouncementsModal from '../components/AnnouncementsModal'
import { buildTextReport, getOrCreateStudentToken, buildStudentQRLink, buildQRMessage } from '../lib/qrPdfWhatsApp'
import { isValidPhone } from '../lib/helpers'
import { normalizeEgyptianPhone, buildWhatsAppUrl } from '../lib/helpers'
import { downloadCSV, localDateStr } from '../lib/csv'
import { supabase } from '../lib/supabaseClient'

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
  const [busy, setBusy] = useState('')

  const completedLessons = useMemo(
    () => ws.lessonSessions.filter((l) => l.group_name === group && l.status === 'completed')
      .sort((a, b) => String(b.session_date).localeCompare(String(a.session_date))).slice(0, 30),
    [ws.lessonSessions, group],
  )
  const lesson = ws.lessonSessions.find((l) => l.id === lessonId) || null

  const buildDailyReports = async () => {
    if (!lesson) return
    setBusy('reports')
    try {
      const { data: rows } = await supabaseLessonAttendance(lesson.id)
      const attendanceMap = Object.fromEntries((rows || []).map((r) => [r.student_id, r]))
      const groupStudents = ws.students.filter((s) => s.group_name === group)
      const ranks = ws.ranks
      const items = []
      for (const s of groupStudents) {
        const row = attendanceMap[s.id]
        const session = {
          lesson_topic: lesson.lesson_topic || '', homework_text: lesson.homework_text || '',
          video_link: lesson.video_link || '', attendance: row?.status || 'لم يرصد',
        }
        const reportStudent = { ...s, attendance_status: row?.status || s.attendance_status, hw_status: row?.homework_status || s.hw_status }
        const text = buildTextReport(reportStudent, { ranks, allStudents: ws.students, session, examScores: ws.examScoresByStudent[s.id] || [] })
        if (s.phone && isValidPhone(s.phone)) items.push({ student: reportStudent, phone: normalizeEgyptianPhone(s.phone), message: text, lessonId: lesson.id })
      }
      if (items.length === 0) { ws.showToast?.(isArabic ? 'لا يوجد طلاب بأرقام صحيحة' : 'No students with valid phones', 'error'); return }
      ui.startQueue(items)
    } finally { setBusy('') }
  }

  const buildQRQueue = async () => {
    setBusy('qr')
    try {
      const groupStudents = ws.students.filter((s) => s.group_name === group)
      const template = ws.settings?.qr_message_template || ''
      const items = []
      for (const s of groupStudents) {
        if (!s.phone || !isValidPhone(s.phone)) continue
        const token = await getOrCreateStudentToken(s.id)
        if (!token) continue
        const link = buildStudentQRLink(token)
        // buildQRMessage ALWAYS appends the link when the template lacks {link}
        const message = buildQRMessage(s.name, link, template)
        items.push({ student: s, phone: normalizeEgyptianPhone(s.phone), message, qrUrl: link })
      }
      if (items.length === 0) { ws.showToast?.(isArabic ? 'لا يوجد طلاب بأرقام صحيحة' : 'No students with valid phones', 'error'); return }
      ui.startQueue(items)
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
    const groupStudents = ws.students.filter((s) => s.group_name === group && s.phone && isValidPhone(s.phone))
    const items = groupStudents.map((s) => ({ student: s, phone: normalizeEgyptianPhone(s.phone), message: (ws.settings?.msg_welcome || 'مرحبًا {studentName}').replace('{studentName}', s.name) }))
    if (!items.length) { ws.showToast?.(isArabic ? 'لا يوجد طلاب بأرقام صحيحة' : 'No students with valid phones', 'error'); return }
    ui.startQueue(items)
  }

  return (
    <div>
      <h1 className="text-lg font-black m-0 mb-1">{isArabic ? 'التقارير' : 'Reports'}</h1>
      <p className="text-[.74rem] text-fg-muted mb-4">
        {isArabic ? 'تقارير جماعية وقوالب ورسائل — تقرير الحصة الحالية من داخل مساحة الحصة نفسها.' : 'Batch reports, templates, and messages — the current-session report lives inside the Session Workspace.'}
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

      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        settings={ws.settings}
        onSave={async (patch) => {
          const result = await ws.refreshSettings && ws.settings
          await import('../lib/supabaseClient').then(({ supabase }) =>
            supabase.from('teacher_settings').update(patch).eq('teacher_id', ws.effectiveTeacherId),
          )
          ws.refreshSettings?.()
          ws.showToast?.(isArabic ? 'تم حفظ القوالب' : 'Templates saved', 'success')
          void result
          setTemplatesOpen(false)
        }}
      />
      {announcementsOpen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-16 overflow-y-auto" onClick={() => setAnnouncementsOpen(false)}>
          <div className="glass-card w-full max-w-lg p-4" onClick={(e) => e.stopPropagation()}>
            <AnnouncementsModal open onClose={() => setAnnouncementsOpen(false)} teacherId={ws.effectiveTeacherId} studentCount={ws.students.length} showToast={ws.showToast} />
          </div>
        </div>
      )}
    </div>
  )
}

async function supabaseLessonAttendance(lessonId) {
  const { supabase } = await import('../lib/supabaseClient')
  return supabase.from('attendance_records').select('student_id, status, homework_status').eq('lesson_session_id', lessonId)
}
