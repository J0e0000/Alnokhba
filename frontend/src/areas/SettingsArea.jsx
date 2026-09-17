import { useMemo, useState } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { useAuth } from '../context/AuthContext'
import SettingsModal from '../components/SettingsModal'
import TemplatesModal from '../components/TemplatesModal'
import BrandingModal from '../components/BrandingModal'
import { IS_DEMO } from '../lib/supabaseClient'

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS AREA — groups & weekly schedule (multi-slot per group supported),
// points/ranks/thresholds (SettingsModal), message templates, branding,
// assistant linking. No settings here are required for the daily pipeline.
// ═══════════════════════════════════════════════════════════════════════════
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default function SettingsArea() {
  const ws = useWorkspace()
  const ui = useUI()
  const { profile, isAssistant, ownerProfile } = useAuth()
  const { isArabic } = ws
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [brandingOpen, setBrandingOpen] = useState(false)
  const [newGroup, setNewGroup] = useState({ name: '', stage: '', day: String(new Date().getDay()), time: '16:30' })

  return (
    <div>
      <h1 className="text-lg font-black m-0 mb-1">{isArabic ? 'الإعدادات' : 'Settings'}</h1>
      <p className="text-[.74rem] text-fg-muted mb-4">{isArabic ? 'المجموعات، الجدول الأسبوعي، النقاط والرتب، والقوالب.' : 'Groups, weekly schedule, points & ranks, templates.'}</p>

      {/* Groups & schedule */}
      <section className="glass-card p-4 mb-4">
        <h3 className="text-[.85rem] font-extrabold mt-0 mb-3">{isArabic ? 'المجموعات والجدول الأسبوعي' : 'Groups & weekly schedule'}</h3>
        <p className="text-[.68rem] text-fg-muted mt-0 mb-3">
          {isArabic ? 'المجموعة الواحدة قد يكون لها أكثر من موعد أسبوعي — كل موعد حصة مستقلة بحضورها ودرجاتها.' : 'One group can have multiple weekly slots — every session is an independent attendance event.'}
        </p>
        <div className="grid gap-2 mb-4">
          {ws.groups.map((g) => {
            const meta = ws.groupMeta[g] || {}
            return (
              <div key={g} className="nk-row">
                <span className="min-w-0">
                  <b className="truncate">{g}</b>
                  <small>{meta.stage || '—'} · {meta.day !== undefined && meta.day !== '' ? WEEKDAYS[Number(meta.day)] : '—'} · {meta.time || '—'}</small>
                </span>
                <span className="flex gap-1.5">
                  <button
                    className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold"
                    onClick={async () => {
                      const ok = await ui.askConfirm(`${isArabic ? 'حذف المجموعة' : 'Delete group'} ${g}؟`, { danger: true, confirmLabel: isArabic ? 'حذف' : 'Delete' })
                      if (ok) ws.deleteGroup(g)
                    }}
                  >🗑</button>
                </span>
              </div>
            )
          })}
          {ws.groups.length === 0 && <p className="text-[.74rem] text-fg-muted m-0">{isArabic ? 'لا مجموعات بعد' : 'No groups yet'}</p>}
        </div>

        {!isAssistant && (
          <div className="grid sm:grid-cols-[1.3fr_1fr_0.8fr_0.8fr_auto] grid-cols-2 gap-2 items-center">
            <input className="glass-input rounded-xl px-3 py-2 text-sm" placeholder={isArabic ? 'اسم المجموعة' : 'Group name'} value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} />
            <input className="glass-input rounded-xl px-3 py-2 text-sm" placeholder={isArabic ? 'المرحلة' : 'Stage'} value={newGroup.stage} onChange={(e) => setNewGroup({ ...newGroup, stage: e.target.value })} />
            <select className="glass-input rounded-xl px-2 py-2 text-[.74rem]" value={newGroup.day} onChange={(e) => setNewGroup({ ...newGroup, day: e.target.value })} aria-label={isArabic ? 'اليوم' : 'Day'}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
            <input type="time" className="glass-input rounded-xl px-2 py-2 text-[.74rem]" value={newGroup.time} onChange={(e) => setNewGroup({ ...newGroup, time: e.target.value })} aria-label={isArabic ? 'الميعاد' : 'Time'} />
            <button
              className="btn-navy rounded-xl px-4 py-2 text-[.74rem] font-extrabold"
              onClick={async () => {
                const ok = await ws.addGroup(newGroup)
                if (ok) setNewGroup({ name: '', stage: '', day: String(new Date().getDay()), time: '16:30' })
              }}
            >
              ＋ {isArabic ? 'إضافة' : 'Add'}
            </button>
          </div>
        )}
      </section>

      {/* Quick settings cards */}
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <button className="nk-content text-right cursor-pointer" onClick={() => setSettingsOpen(true)}>
          <b className="block text-[.85rem] mb-1">⚖ {isArabic ? 'النقاط والرتب والتنبيهات' : 'Points, ranks & alerts'}</b>
          <small className="text-fg-muted block">{isArabic ? 'نقاط الحضور والتفاعل، رتب النقاط، عتبات الغياب، تفضيلات الإشعارات، ربط المساعد.' : 'Attendance/interaction points, rank tiers, absence thresholds, notifications, assistant link.'}</small>
        </button>
        <button className="nk-content text-right cursor-pointer" onClick={() => setTemplatesOpen(true)}>
          <b className="block text-[.85rem] mb-1">✉ {isArabic ? 'قوالب الرسائل' : 'Message templates'}</b>
          <small className="text-fg-muted block">{isArabic ? 'قوالب واتساب: ترحيب، إنذار، ترقية، تقرير، رابط QR.' : 'WhatsApp templates: welcome, warning, promotion, report, QR.'}</small>
        </button>
        {!isAssistant && (
          <button className="nk-content text-right cursor-pointer" onClick={() => setBrandingOpen(true)}>
            <b className="block text-[.85rem] mb-1">🎨 {isArabic ? 'هوية المركز' : 'Center branding'}</b>
            <small className="text-fg-muted block">{isArabic ? 'اسم المدرس، اسم المركز، الشعار، الألوان.' : 'Teacher name, center name, logo, palette.'}</small>
          </button>
        )}
        {IS_DEMO && (
          <button className="nk-content text-right cursor-pointer" onClick={() => {
            if (confirm('إعادة تعيين البيانات التجريبية؟')) {
              // dynamic import: the demo adapter never ships into production bundles
              import('../demo/demoClient').then((m) => m.resetDemoData())
            }
          }}>
            <b className="block text-[.85rem] mb-1">♻ {isArabic ? 'إعادة تعيين البيئة التجريبية' : 'Reset demo data'}</b>
            <small className="text-fg-muted block">{isArabic ? 'إرجاع بيانات العرض لأصلها.' : 'Restore the demo seed data.'}</small>
          </button>
        )}
      </div>

      {isAssistant && ownerProfile && (
        <div className="nk-notice">
          {isArabic ? `أنت مساعد لدى ${ownerProfile.full_name} — تعمل على نفس مساحة العمل بنفس الصلاحيات.` : `You are assisting ${ownerProfile.full_name} — same workspace, same permissions.`}
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={ws.settings}
        onSave={async (patch) => {
          const { error } = await import('../lib/supabaseClient').then(({ supabase }) =>
            supabase.from('teacher_settings').update(patch).eq('teacher_id', ws.effectiveTeacherId),
          )
          if (!error) { ws.refreshSettings?.(); ws.showToast?.(isArabic ? 'تم حفظ الإعدادات' : 'Settings saved', 'success'); setSettingsOpen(false) }
          else ws.showToast?.(error.message || 'تعذر الحفظ', 'error')
        }}
        onResetAllData={async () => {
          const ok = await ui.askConfirm(isArabic ? 'سيتم حذف كل الطلاب والامتحانات نهائيًا! هل أنت متأكد تمامًا؟' : 'This permanently deletes ALL students and exams! Are you absolutely sure?', { danger: true, confirmLabel: isArabic ? 'نعم، احذف الكل' : 'Yes, delete all' })
          if (!ok) return
          await import('../lib/supabaseClient').then(async ({ supabase }) => {
            await supabase.from('exams').delete().eq('teacher_id', ws.effectiveTeacherId)
            await supabase.from('students').delete().eq('teacher_id', ws.effectiveTeacherId)
          })
          ws.loadAll()
          setSettingsOpen(false)
        }}
        teacherId={ws.effectiveTeacherId}
        teacherEmail={profile?.email || ''}
        isAssistant={isAssistant}
      />
      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        settings={ws.settings}
        onSave={async (patch) => {
          const { error } = await import('../lib/supabaseClient').then(({ supabase }) =>
            supabase.from('teacher_settings').update(patch).eq('teacher_id', ws.effectiveTeacherId),
          )
          if (!error) { ws.refreshSettings?.(); ws.showToast?.(isArabic ? 'تم حفظ القوالب' : 'Templates saved', 'success'); setTemplatesOpen(false) }
          else ws.showToast?.(error.message || 'تعذر الحفظ', 'error')
        }}
      />
      <BrandingModal open={brandingOpen} onClose={() => setBrandingOpen(false)} />
    </div>
  )
}
