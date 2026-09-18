import { useEffect, useState, useCallback } from 'react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { supabase } from '../lib/supabaseClient'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import { WEEKDAY_KEYS } from '../lib/i18n'

const REPORT_FIELDS_MAP = [
  { key: 'rank' }, { key: 'position' }, { key: 'points' }, { key: 'warnings' },
  { key: 'attendance' }, { key: 'homework' }, { key: 'session' }, { key: 'logs' },
]

export default function SettingsModal({ open, onClose, settings, onSave, onResetAllData, teacherId, teacherEmail, isAssistant }) {
  const { showToast } = useToast()
  const { t, weekday, reportFieldLabel, isArabic } = useLanguage()
  const [finalConfirmOpen, setFinalConfirmOpen] = useState(false)
  const [groupList, setGroupList] = useState([])
  const [activeGroupTab, setActiveGroupTab] = useState(0)
  const [newGroupName, setNewGroupName] = useState('')
  const [points, setPoints] = useState({ interact: 3, interrupt: -3, present: 1, absent: -1 })
  const [ranks, setRanks] = useState([])
  const [reportFields, setReportFields] = useState([])
  const [schedule, setSchedule] = useState({})
  const [team, setTeam] = useState([])
  const [newAssistantEmail, setNewAssistantEmail] = useState('')
  const [teamError, setTeamError] = useState('')
  const [absenceWarningThreshold, setAbsenceWarningThreshold] = useState(2)
  const [absenceAttentionThreshold, setAbsenceAttentionThreshold] = useState(3)
  const [notificationPreferences, setNotificationPreferences] = useState({ attendance: true, homework: true, exams: true, lessons: true, payments: true, announcements: true })
  const [qrMessageTemplate, setQrMessageTemplate] = useState('مرحباً {studentName}\nرابط متابعة الطالب:')

  const loadTeam = async () => {
    const { data } = await supabase.from('workspace_members').select('id, member_id, created_at, profiles!workspace_members_member_id_fkey(full_name, email)').eq('owner_id', teacherId)
    setTeam(data ?? [])
  }

  useEffect(() => { if (open && !isAssistant && teacherId) loadTeam() }, [open, teacherId, isAssistant]) // eslint-disable-line

  const addAssistant = async (e) => {
    e.preventDefault()
    setTeamError('')
    const { error } = await supabase.rpc('link_assistant_by_email', { assistant_email: newAssistantEmail.trim() })
    if (error) setTeamError(error.message.includes(isArabic ? 'لا يوجد' : 'not found') ? error.message : (isArabic ? 'حصل خطأ، تأكد إن الإيميل ده عنده حساب على المنصة بالفعل.' : 'Error — make sure this email has an account on the platform.'))
    else { setNewAssistantEmail(''); loadTeam(); showToast(isArabic ? 'اتربط المساعد بنجاح' : 'Assistant linked', 'success') }
  }

  const removeAssistant = async (id) => { await supabase.from('workspace_members').delete().eq('id', id); loadTeam() }


  useEffect(() => {
    if (settings) {
      setGroupList((settings.groups || []).filter(Boolean))
      setPoints({ interact: settings.points_interact, interrupt: settings.points_interrupt, present: settings.points_present, absent: settings.points_absent })
      setRanks(settings.ranks || [])
      setReportFields(settings.report_fields || ['rank', 'position', 'points', 'warnings', 'attendance', 'homework', 'session', 'logs'])
      setAbsenceWarningThreshold(Number(settings.insight_config?.absence_warning_threshold || settings.absence_warning_threshold || 2))
      setAbsenceAttentionThreshold(Number(settings.insight_config?.absence_attention_threshold || settings.absence_attention_threshold || 3))
      setNotificationPreferences({ attendance: true, homework: true, exams: true, lessons: true, payments: true, announcements: true, ...(settings.notification_preferences || {}) })
      setQrMessageTemplate(settings.qr_message_template || 'مرحباً {studentName}\nرابط متابعة الطالب: {link}')
    }
  }, [settings, open])

  useEffect(() => {
    if (!open || !teacherId) return
    // Defense-in-depth (migration_019): scope by teacher_id
    supabase.from('group_schedule').select('*').eq('teacher_id', teacherId).then(({ data }) => {
      const map = {}
      ;(data ?? []).forEach((r) => { if (!map[r.group_name]) map[r.group_name] = new Set(); map[r.group_name].add(r.weekday) })
      setSchedule(map)
    })
  }, [open, teacherId])

  const toggleDay = async (groupName, day) => {
    const has = schedule[groupName]?.has(day)
    setSchedule((prev) => { const next = { ...prev, [groupName]: new Set(prev[groupName] || []) }; if (has) next[groupName].delete(day); else next[groupName].add(day); return next })
    if (has) await supabase.from('group_schedule').delete().match({ teacher_id: teacherId, group_name: groupName, weekday: day })
    else await supabase.from('group_schedule').insert({ teacher_id: teacherId, group_name: groupName, weekday: day })
  }

  const addGroup = useCallback(() => {
    const name = newGroupName.trim()
    if (!name) return
    if (groupList.includes(name)) { showToast(isArabic ? 'المجموعة دي موجودة بالفعل' : 'Group already exists', 'error'); return }
    setGroupList((prev) => [...prev, name])
    setNewGroupName('')
    setActiveGroupTab(groupList.length)
  }, [newGroupName, groupList, isArabic, showToast])

  const removeGroup = useCallback((idx) => {
    setGroupList((prev) => prev.filter((_, i) => i !== idx))
    setActiveGroupTab((prev) => Math.min(prev, groupList.length - 2))
  }, [groupList.length])

  const renameGroup = useCallback((idx, newName) => {
    setGroupList((prev) => prev.map((g, i) => i === idx ? newName : g))
  }, [])

  const submit = (e) => {
    e.preventDefault()
    onSave({
      groups: groupList,
      points_interact: Number(points.interact) || 0,
      points_interrupt: Number(points.interrupt) || 0,
      points_present: Number(points.present) || 0,
      points_absent: Number(points.absent) || 0,
      ranks,
      report_fields: reportFields,
      insight_config: { ...(settings?.insight_config || {}), absence_warning_threshold: Math.max(1, Number(absenceWarningThreshold) || 2), absence_attention_threshold: Math.max(Math.max(1, Number(absenceWarningThreshold) || 2), Number(absenceAttentionThreshold) || 3) },
      notification_preferences: notificationPreferences,
      qr_message_template: qrMessageTemplate,
    })
  }

  const toggleReportField = (key) => { setReportFields((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])) }

  return (
    <Modal open={open} onClose={onClose} title={t('settings_title')} wide>
      <form onSubmit={submit} className='space-y-5'>
        <div className='rounded-xl border border-brand-gold/20 bg-brand-gold/5 p-3 text-xs text-fg-subtle'>${'{'}isArabic ? 'إدارة المجموعات والحصص أصبحت من صفحة الحصص.' : 'Manage groups and lesson schedules from the Lessons page.'${'}'}</div>

        <div>
          <p className='text-sm text-fg-muted mb-2 font-bold'>{t('points_values')}</p>
          <div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
            <PointField label={t('interact_label')} value={points.interact} onChange={(v) => setPoints({ ...points, interact: v })} />
            <PointField label={t('disruption_label')} value={points.interrupt} onChange={(v) => setPoints({ ...points, interrupt: v })} />
            <PointField label={t('present_label')} value={points.present} onChange={(v) => setPoints({ ...points, present: v })} />
            <PointField label={t('absent_label')} value={points.absent} onChange={(v) => setPoints({ ...points, absent: v })} />
          </div>
        </div>

        <div>
          <p className='text-sm text-fg-muted mb-2 font-bold'>{isArabic ? 'تنبيهات الغياب' : 'Absence alerts'}</p>
          <div className='grid grid-cols-2 gap-2 mb-4'>
            <PointField label={isArabic ? 'تحذير بعد عدد غيابات' : 'Warning after absences'} value={absenceWarningThreshold} onChange={setAbsenceWarningThreshold} />
            <PointField label={isArabic ? 'يحتاج متابعة بعد' : 'Attention after absences'} value={absenceAttentionThreshold} onChange={setAbsenceAttentionThreshold} />
          </div>
          <p className='text-[11px] text-fg-subtle'>{isArabic ? 'يتم تسجيل الغياب فقط عند اختيار المجموعة والضغط على بدء حصة جديدة، ولا يتأثر الطلاب خارج المجموعة.' : 'Absence is marked only for the selected group when starting a new lesson; students outside the group are untouched.'}</p>
        </div>

        <div>
          <p className='text-sm text-fg-muted mb-2 font-bold'>{isArabic ? 'قالب رسالة QR الثابت' : 'Fixed QR message template'}</p>
          <p className='text-[11px] text-fg-subtle mb-2'>{isArabic ? 'استخدم {studentName} و{link} — ولو {link} مش موجودة في القالب، هنتضاف تلقائياً في آخر الرسالة فلا يضيع الرابط أبداً.' : 'Use {studentName} and {link} — if {link} is missing, the student portal link is appended automatically so it can never be lost.'}</p>
          <textarea value={qrMessageTemplate} onChange={(e) => setQrMessageTemplate(e.target.value)} rows={3} className='w-full glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle resize-y' />
        </div>

        <div>
          <p className='text-sm text-fg-muted mb-2 font-bold'>{isArabic ? 'تفضيلات التقارير' : 'Report preferences'}</p>
          <p className='text-fg-subtle text-[11px] mb-2'>{t('report_fields_desc')}</p>
          <div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
            {REPORT_FIELDS_MAP.map((f) => (
              <label key={f.key} className='flex items-center gap-1.5 glass-card rounded-lg px-2 py-1.5 text-xs cursor-pointer text-fg'>
                <input type='checkbox' checked={reportFields.includes(f.key)} onChange={() => toggleReportField(f.key)} className='w-3.5 h-3.5 accent-[#D4A373]' />
                {reportFieldLabel(f.key)}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className='text-sm text-fg-muted mb-2 font-bold'>{t('ranks_label')}</p>
          <div className='grid grid-cols-2 sm:grid-cols-5 gap-2'>
            {ranks.map((r, idx) => (
              <div key={idx} className='glass-card p-2 rounded-lg flex flex-col gap-1'>
                <span className='text-fg-subtle text-[10px] font-bold'>{t('from_points')} {r.min} {t('point_word')}</span>
                <input value={r.title} onChange={(e) => { const next = [...ranks]; next[idx] = { ...next[idx], title: e.target.value }; setRanks(next) }}
                  className='w-full glass-input text-brand-gold-hover px-2 py-1 rounded text-xs text-center font-bold outline-none' />
              </div>
            ))}
          </div>
        </div>


        <button className='w-full bg-brand-gold hover:bg-brand-gold-hover text-brand-bg font-bold py-2.5 rounded-lg text-sm'>
          {t('save_settings')}
        </button>
      </form>

      {/* Team / Assistants */}
      {!isAssistant && (
        <div className='mt-6 pt-4 border-t border-subtle'>
          <p className='text-sm font-bold text-fg-muted mb-2'>{t('team_title')}</p>
          <p className='text-fg-subtle text-[11px] mb-2'>{t('team_desc')}</p>
          <form onSubmit={addAssistant} className='flex gap-2 mb-2'>
            <input type='email' required value={newAssistantEmail} onChange={(e) => setNewAssistantEmail(e.target.value)} dir='ltr'
              placeholder={t('assistant_email')} className='flex-1 glass-input rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-gold' />
            <button className='bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/40 px-3 rounded-lg text-xs font-bold'>{t('link_btn')}</button>
          </form>
          {teamError && <p className='text-rose-400 text-[11px] mb-2'>{teamError}</p>}
          <div className='space-y-1'>
            {team.map((m) => (
              <div key={m.id} className='flex justify-between items-center glass-card rounded-lg px-3 py-1.5 text-xs'>
                <span className='text-fg'>{m.profiles?.full_name || m.profiles?.email}</span>
                <button onClick={() => removeAssistant(m.id)} className='text-rose-400 hover:text-rose-300'>{t('remove')}</button>
              </div>
            ))}
            {team.length === 0 && <p className='text-fg-subtle text-[11px]'>{t('no_assistants')}</p>}
          </div>
        </div>
      )}

      {/* Danger Zone */}
      {!isAssistant && (
      <div className='mt-6 pt-4 border-t border-subtle'>
        <button type='button' onClick={() => setFinalConfirmOpen(true)} className='text-rose-400 hover:text-rose-300 text-xs font-bold bg-rose-500/10 border border-rose-500/30 px-4 py-2 rounded-lg transition-colors'>
          ⚠️ {t('delete_all_data')}
        </button>
        <p className='text-fg-subtle text-[11px] mt-1'>{t('delete_all_warning')}</p>
      </div>
      )}

      <ConfirmDialog open={finalConfirmOpen} title={t('final_confirm_title')} danger confirmLabel={t('final_confirm_btn')} message={t('final_confirm_msg')} onConfirm={() => { setFinalConfirmOpen(false); onResetAllData() }} onCancel={() => setFinalConfirmOpen(false)} />
    </Modal>
  )
}

function PointField({ label, value, onChange }) {
  return (
    <div>
      <label className='block text-[11px] text-fg-subtle mb-1'>{label}</label>
      <input type='number' value={value} onChange={(e) => onChange(e.target.value)} dir='ltr' className='w-full glass-input rounded-lg px-2 py-1.5 text-sm text-center outline-none focus:border-brand-gold' />
    </div>
  )
}
