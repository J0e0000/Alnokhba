import { Suspense, lazy, useEffect, useState } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useLanguage } from '../context/LanguageContext'
import SettingsModal from '../components/SettingsModal'
import TemplatesModal from '../components/TemplatesModal'
import BrandingModal from '../components/BrandingModal'
import HelpSupportModal from '../components/HelpSupportModal'
import { IS_DEMO } from '../lib/supabaseClient'
import { GRADES_BY_STAGE } from '../lib/helpers'

// PERF: the insights report stays its own lazy chunk — it loads only when
// Settings (its new home) renders, never at startup.
const InsightsReport = lazy(() => import('../components/InsightsReport'))

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS AREA — groups & weekly schedule (multi-slot per group supported),
// points/ranks/thresholds (SettingsModal), message templates, branding,
// assistant linking. No settings here are required for the daily pipeline.
// ═══════════════════════════════════════════════════════════════════════════
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default function SettingsArea() {
  const ws = useWorkspace()
  const ui = useUI()
  const { profile, isAssistant, ownerProfile, signOut } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const { lang, toggleLang } = useLanguage()
  const { isArabic } = ws
  // TABS (owner request): فريق التحليل is a real TAB — opening Settings shows
  // the regular settings first, never the report, and nothing auto-runs on
  // open. The insights tab renders lazily (its chunk + its weekly window) only
  // when the teacher actually opens it — or via the bell notification.
  const [tab, setTab] = useState(() => (ui.area === 'insights' || ui.area === 'analytics') ? 'insights' : 'general')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [brandingOpen, setBrandingOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [newGroup, setNewGroup] = useState({ name: '', stage: '', day: String(new Date().getDay()), time: '16:30' })
  // Group EDITING (teacher request): each group row can be renamed and its
  // stage/day/time changed. Rename propagates everywhere (students, schedule,
  // settings) through ws.renameGroup; meta changes go through ws.updateGroup.
  const [editingGroup, setEditingGroup] = useState(null) // group name being edited
  const [editForm, setEditForm] = useState({ name: '', stage: '', day: 0, time: '' })
  const [busyGroup, setBusyGroup] = useState(false)

  const startGroupEdit = (g) => {
    const meta = ws.groupMeta[g] || {}
    setEditingGroup(g)
    setEditForm({ name: g, stage: meta.stage || '', day: meta.day !== undefined && meta.day !== '' ? Number(meta.day) : 0, time: meta.time || '16:30' })
  }

  // Bell notification intent: a pending "open insights" request from the
  // notification center switches to the insights tab — and is CONSUMED, so a
  // later normal visit to Settings lands on the general tab again.
  useEffect(() => {
    if (ui.insightsIntent > 0) {
      setTab('insights')
      ui.clearInsightsIntent?.()
    }
  }, [ui.insightsIntent])

  const saveGroupEdit = async () => {
    if (!editingGroup || busyGroup) return
    const name = editForm.name.trim()
    if (!name) { ws.showToast?.(isArabic ? 'اسم المجموعة مطلوب' : 'Group name is required', 'error'); return }
    setBusyGroup(true)
    try {
      let current = editingGroup
      if (name !== editingGroup) {
        const okRename = await ws.renameGroup(editingGroup, name)
        if (!okRename) { setBusyGroup(false); return }
        current = name
      }
      const meta = ws.groupMeta[editingGroup] || {}
      const metaChanged = editForm.stage !== (meta.stage || '')
        || Number(editForm.day) !== Number(meta.day)
        || editForm.time !== (meta.time || '')
      if (metaChanged) await ws.updateGroup(current, { stage: editForm.stage, day: editForm.day, time: editForm.time })
      setEditingGroup(null)
    } finally { setBusyGroup(false) }
  }

  return (
    <div>
      <h1 className="text-lg font-black m-0 mb-1">{isArabic ? 'الإعدادات' : 'Settings'}</h1>
      <p className="text-[.74rem] text-fg-muted mb-4">{isArabic ? 'المجموعات، الجدول الأسبوعي، النقاط والرتب، والقوالب.' : 'Groups, weekly schedule, points & ranks, templates.'}</p>

      {/* TAB BAR — فريق التحليل lives in its own tab (owner request): opening
          Settings always lands on the regular settings, nothing pops up. */}
      <div className="flex gap-1.5 mb-4" role="tablist" aria-label={isArabic ? 'أقسام الإعدادات' : 'Settings sections'}>
        {([
          ['general', isArabic ? 'الإعدادات' : 'Settings'],
          ['insights', `✦ ${isArabic ? 'فريق التحليل' : 'Insights Team'}`],
        ]).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className="rounded-xl px-4 py-2 text-[.76rem] font-extrabold transition"
            style={tab === key
              ? { background: 'var(--brand-navy)', color: '#fff', border: '1px solid var(--brand-navy)' }
              : { background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--surface-border)' }}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'insights' && (
      <section className="mb-4 rounded-3xl border border-outline bg-surface overflow-hidden">
        <div
          className="flex items-center gap-3 px-4 py-3.5 border-b border-outline"
          style={{ background: 'linear-gradient(135deg, var(--brand-navy) 0%, var(--brand-navy-light) 100%)' }}
        >
          <span
            className="h-10 w-10 shrink-0 rounded-2xl grid place-items-center text-lg"
            style={{ background: 'var(--brand-gold-surface)', color: 'var(--brand-gold)', border: '1px solid var(--brand-gold)' }}
            aria-hidden="true"
          >
            ✦
          </span>
          <div className="min-w-0">
            <h2 className="text-[.95rem] font-black m-0" style={{ color: '#fff' }}>
              {isArabic ? 'فريق التحليل' : 'Insights Team'}
            </h2>
            <p className="text-[.68rem] m-0 mt-0.5" style={{ color: 'rgba(255,255,255,.72)' }}>
              {isArabic
                ? 'بيقلب بيانات حصصك لتقرير واحد بسيط — الوضع عامل إزاي، واللي بس يستاهل انتباهك.'
                : 'Turns your session data into one simple report — how things are going and what needs your attention.'}
            </p>
          </div>
        </div>
        <div className="p-4">
          <Suspense fallback={<div className="text-[.74rem] text-fg-muted">{isArabic ? 'جاري فتح فريق التحليل…' : 'Loading insights…'}</div>}>
            <InsightsReport />
          </Suspense>
        </div>
      </section>
      )}

      {tab === 'general' && (<>
      {/* FREQUENCY-BASED UI (spec 5, 34): theme / language / undo / history
          are low-frequency — they live HERE on mobile (the header keeps them
          on desktop only). Account controls incl. logout stay below. */}
      <section className="glass-card p-4 mb-4">
        <h3 className="text-[.85rem] font-extrabold mt-0 mb-3">{isArabic ? 'المظهر واللغة وأدوات التطبيق' : 'Appearance, language & tools'}</h3>
        <div className="flex flex-wrap gap-2">
          <button className="nk-wf-ghost" onClick={toggleTheme}>
            {isDark ? '☀' : '☾'} {isDark ? (isArabic ? 'الوضع الفاتح' : 'Light mode') : (isArabic ? 'الوضع الليلي' : 'Dark mode')}
          </button>
          <button className="nk-wf-ghost" onClick={toggleLang}>
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
          <button className="nk-wf-ghost" onClick={() => ws.handleUndo()} title={isArabic ? 'تراجع عن آخر عملية' : 'Undo the last action'}>
            ↺ {isArabic ? 'تراجع' : 'Undo'}
          </button>
          <button className="nk-wf-ghost" onClick={() => ui.setHistoryOpen(true)} title={isArabic ? 'سجل العمليات' : 'Action history'}>
            ⧖ {isArabic ? 'سجل العمليات' : 'History'}
          </button>
        </div>
      </section>

      {/* Groups & schedule */}
      <section className="glass-card p-4 mb-4">
        <h3 className="text-[.85rem] font-extrabold mt-0 mb-3">{isArabic ? 'المجموعات والجدول الأسبوعي' : 'Groups & weekly schedule'}</h3>
        <p className="text-[.68rem] text-fg-muted mt-0 mb-3">
          {isArabic ? 'المجموعة الواحدة قد يكون لها أكثر من موعد أسبوعي — كل موعد حصة مستقلة بحضورها ودرجاتها.' : 'One group can have multiple weekly slots — every session is an independent attendance event.'}
        </p>
        <div className="grid gap-2 mb-4">
          {ws.groups.map((g) => {
            const meta = ws.groupMeta[g] || {}
            const editing = editingGroup === g
            if (editing) {
              return (
                <div key={g} className="nk-row !flex-wrap" style={{ borderColor: 'var(--brand-gold)', background: 'var(--brand-gold-surface)' }}>
                  <div className="grid grid-cols-2 sm:grid-cols-[1.3fr_1.2fr_0.9fr_0.8fr] gap-2 w-full">
                    <input className="glass-input rounded-xl px-3 py-2 text-sm" placeholder={isArabic ? 'اسم المجموعة' : 'Group name'} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} aria-label={isArabic ? 'اسم المجموعة' : 'Group name'} />
                    <select className="glass-input rounded-xl px-2 py-2 text-[.78rem]" value={editForm.stage} onChange={(e) => setEditForm({ ...editForm, stage: e.target.value })} aria-label={isArabic ? 'المرحلة' : 'Stage'}>
                      <option value="">{isArabic ? 'المرحلة...' : 'Stage...'}</option>
                      {Object.entries(GRADES_BY_STAGE).map(([category, grades]) => (
                        <optgroup key={category} label={category}>
                          {grades.map((gr) => <option key={gr} value={gr}>{gr}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <select className="glass-input rounded-xl px-2 py-2 text-[.74rem]" value={editForm.day} onChange={(e) => setEditForm({ ...editForm, day: Number(e.target.value) })} aria-label={isArabic ? 'اليوم' : 'Day'}>
                      {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                    <input type="time" className="glass-input rounded-xl px-2 py-2 text-[.74rem]" value={editForm.time} onChange={(e) => setEditForm({ ...editForm, time: e.target.value })} aria-label={isArabic ? 'الميعاد' : 'Time'} />
                  </div>
                  <div className="flex gap-1.5 w-full justify-end">
                    <button className="btn-ghost !min-h-0 rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold" onClick={() => setEditingGroup(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                    <button className="btn-navy !min-h-0 rounded-lg px-3 py-1.5 text-[.7rem] font-extrabold" disabled={busyGroup} onClick={saveGroupEdit}>
                      ✓ {busyGroup ? (isArabic ? 'جاري الحفظ…' : 'Saving…') : (isArabic ? 'حفظ التعديل' : 'Save changes')}
                    </button>
                  </div>
                  <small className="w-full text-fg-muted">{isArabic ? 'تغيير الاسم يحدّث طلاب المجموعة ومواعيدها أوتوماتيكيًا.' : 'Renaming updates the group’s students and schedule automatically.'}</small>
                </div>
              )
            }
            return (
              <div key={g} className="nk-row">
                <span className="min-w-0">
                  <b className="truncate">{g}</b>
                  <small>{meta.stage || '—'} · {meta.day !== undefined && meta.day !== '' ? WEEKDAYS[Number(meta.day)] : '—'} · {meta.time || '—'}</small>
                </span>
                <span className="flex gap-1.5">
                  <button
                    className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold"
                    onClick={() => startGroupEdit(g)}
                    title={isArabic ? 'تعديل الاسم والمرحلة والموعد' : 'Edit name, stage & schedule'}
                  >✎</button>
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
            {/* Controlled stage selector (student-creation round): the group's
                stage is the authoritative source for its students' stage — it
                must be a standardized value, never free text. */}
            <select className="glass-input rounded-xl px-2 py-2 text-[.78rem]" value={newGroup.stage} onChange={(e) => setNewGroup({ ...newGroup, stage: e.target.value })} aria-label={isArabic ? 'المرحلة' : 'Stage'}>
              <option value="">{isArabic ? 'المرحلة...' : 'Stage...'}</option>
              {Object.entries(GRADES_BY_STAGE).map(([category, grades]) => (
                <optgroup key={category} label={category}>
                  {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                </optgroup>
              ))}
            </select>
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
        {/* Help & Support (spec 20): FAQ + the interactive tour live here —
            low-frequency help content never belongs in the main workflow. */}
        <button className="nk-content text-right cursor-pointer" onClick={() => setHelpOpen(true)}>
          <b className="block text-[.85rem] mb-1">؟ {isArabic ? 'المساعدة والدعم' : 'Help & support'}</b>
          <small className="text-fg-muted block">{isArabic ? 'الأسئلة الشائعة، الجولة التفاعلية، وطرق التواصل مع الدعم.' : 'FAQ, interactive tour, and support contact.'}</small>
        </button>
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

      {/* Account — logout lives here (under the profile section), never in
          navigation bars or workflow areas. Always confirmed. */}
      <section className="glass-card p-4 mt-4">
        <h3 className="text-[.85rem] font-extrabold mt-0 mb-3">{isArabic ? 'الحساب' : 'Account'}</h3>
        <div className="nk-row mb-3">
          <span className="min-w-0">
            <b className="truncate">{profile?.full_name || '—'}</b>
            <small>{profile?.email || ''}{profile?.email ? ' · ' : ''}{isAssistant ? (isArabic ? `مساعد لدى ${ownerProfile?.full_name || ''}` : `Assistant to ${ownerProfile?.full_name || ''}`) : (isArabic ? 'مدرس' : 'Teacher')}</small>
          </span>
        </div>
        <button
          className="btn-ghost rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold"
          style={{ color: 'var(--danger-strong)' }}
          onClick={async () => {
            const ok = await ui.askConfirm(
              isArabic ? 'تسجيل الخروج من حسابك؟' : 'Sign out of your account?',
              { title: isArabic ? 'تسجيل الخروج' : 'Sign out', confirmLabel: isArabic ? 'تسجيل الخروج' : 'Sign out', danger: true },
            )
            if (ok) await signOut()
          }}
        >
          ⎋ {isArabic ? 'تسجيل الخروج' : 'Sign out'}
        </button>
      </section>
      </>)}

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
      <HelpSupportModal open={helpOpen} onClose={() => setHelpOpen(false)} onStartTour={() => {
        // The tour is a walkthrough of the HOME working screen — jump there
        // first so every step's target element actually exists in the DOM.
        setHelpOpen(false)
        ui.setArea('home')
        ui.setTourActive(true)
      }} />
    </div>
  )
}
