import Icon, { hasIcon } from '../components/icons'
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
import { friendlySaveErrorText } from '../lib/friendlyError'
import { track } from '../lib/posthog'
import { GRADES_BY_STAGE } from '../lib/helpers'
import useContextMenu from '../hooks/useContextMenu'

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
  const [newGroup, setNewGroup] = useState({ name: '', stage: '' })
  // Task 66 (مجموعة بمعادين): المجموعة الواحدة قد يكون لها أكثر من موعد
  // أسبوعي (أيام مختلفة) — صفوف المواعيد في فورم الإضافة والتعديل.
  const [newSlots, setNewSlots] = useState([{ day: String(new Date().getDay()), time: '16:30' }])
  // Group EDITING (teacher request): each group row can be renamed and its
  // stage/day/time changed. Rename propagates everywhere (students, schedule,
  // settings) through ws.renameGroup; meta changes go through ws.updateGroup.
  const [editingGroup, setEditingGroup] = useState(null) // group name being edited
  const [editForm, setEditForm] = useState({ name: '', stage: '' })
  const [editSlots, setEditSlots] = useState([{ day: '0', time: '16:30' }])
  const [busyGroup, setBusyGroup] = useState(false)
  // Task 65 (دمج المجموعات): المجموعة المصدر المفتوحة في مودال الدمج.
  const [mergeSource, setMergeSource] = useState(null)

  // Task 65 — right-click / long-press على صف المجموعة: تعديل / دمج / حذف.
  const { triggerProps, contextMenu } = useContextMenu()
  const groupMenuItems = (g) => [
    { icon: 'pencil', label: isArabic ? 'تعديل الاسم والموعد' : 'Edit name & schedule', onClick: () => startGroupEdit(g) },
    { icon: 'refresh', label: isArabic ? 'دمج مع مجموعة أخرى' : 'Merge into another group', disabled: (ws.groups || []).length < 2, onClick: () => setMergeSource(g) },
    'sep',
    {
      icon: 'trash',
      label: isArabic ? 'حذف المجموعة' : 'Delete group',
      danger: true,
      onClick: async () => {
        const ok = await ui.askConfirm(`${isArabic ? 'حذف المجموعة' : 'Delete group'} ${g}؟`, { danger: true, confirmLabel: isArabic ? 'حذف' : 'Delete' })
        if (ok) ws.deleteGroup(g)
      },
    },
  ]

  const startGroupEdit = (g) => {
    const meta = ws.groupMeta[g] || {}
    // الموعدون الحاليون من group_schedule (المصدر الكامل) — الميتا فقط احتياط
    const rows = (ws.groupSchedule || []).filter((r) => r.group_name === g)
      .sort((a, b) => Number(a.weekday) - Number(b.weekday))
      .map((r) => ({ day: String(r.weekday), time: r.lesson_time || '16:30' }))
    setEditingGroup(g)
    setEditForm({ name: g, stage: meta.stage || '' })
    setEditSlots(rows.length
      ? rows
      : [{ day: meta.day !== undefined && meta.day !== '' ? String(meta.day) : '0', time: meta.time || '16:30' }])
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
      const stageChanged = editForm.stage !== (ws.groupMeta[editingGroup]?.stage || '')
      // توقيع المواعيد: قارن مع صفوف group_schedule الحالية — عدّل عند أي فرق
      const sig = (arr) => arr.map((s) => `${Number(s.day)}@${String(s.time || '')}`).sort().join('|')
      const slotsChanged = sig(editSlots.map((s) => ({ day: Number(s.day), time: s.time })))
        !== sig((ws.groupSchedule || []).filter((r) => r.group_name === current)
          .map((r) => ({ day: Number(r.weekday), time: r.lesson_time || '' })))
      if (stageChanged || slotsChanged) await ws.updateGroup(current, { stage: editForm.stage, slots: editSlots })
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
          ['insights', isArabic ? 'فريق التحليل' : 'Insights Team'],
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
            <Icon name="sparkles" size={18} />
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
            <Icon name="rotate-ccw" size={15} style={{ marginInlineEnd: 6, verticalAlign: '-0.2em' }} />{isArabic ? 'تراجع' : 'Undo'}
          </button>
          <button className="nk-wf-ghost" onClick={() => ui.setHistoryOpen(true)} title={isArabic ? 'سجل العمليات' : 'Action history'}>
            <Icon name="hourglass" size={15} style={{ marginInlineEnd: 6, verticalAlign: '-0.2em' }} />{isArabic ? 'سجل العمليات' : 'History'}
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
                  <div className="grid grid-cols-2 gap-2 w-full">
                    <input className="glass-input rounded-xl px-3 py-2 text-sm" placeholder={isArabic ? 'اسم المجموعة' : 'Group name'} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} aria-label={isArabic ? 'اسم المجموعة' : 'Group name'} />
                    <select className="glass-input rounded-xl px-2 py-2 text-[.78rem]" value={editForm.stage} onChange={(e) => setEditForm({ ...editForm, stage: e.target.value })} aria-label={isArabic ? 'المرحلة' : 'Stage'}>
                      <option value="">{isArabic ? 'المرحلة...' : 'Stage...'}</option>
                      {Object.entries(GRADES_BY_STAGE).map(([category, grades]) => (
                        <optgroup key={category} label={category}>
                          {grades.map((gr) => <option key={gr} value={gr}>{gr}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {/* Task 66 — مجموعة بمعادين: مواعيد أسبوعية متعددة بأيام مختلفة */}
                    <div className="col-span-2">
                      <SlotEditor slots={editSlots} setSlots={setEditSlots} isArabic={isArabic} />
                    </div>
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
              <div key={g} className="nk-row nk-ctx-target" {...triggerProps(() => groupMenuItems(g), g)}>
                <span className="min-w-0">
                  <b className="truncate">{g}</b>
                  <small>
                    {meta.stage || '—'} · {(ws.groupSchedule || []).filter((r) => r.group_name === g)
                      .sort((a, b) => Number(a.weekday) - Number(b.weekday))
                      .map((r) => `${WEEKDAYS[Number(r.weekday)]} ${r.lesson_time || ''}`.trim()).join(' · ')
                      || (meta.day !== undefined && meta.day !== '' ? `${WEEKDAYS[Number(meta.day)]} ${meta.time || ''}` : '—')}
                  </small>
                </span>
                <span className="flex gap-1.5">
                  <button
                    className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold"
                    onClick={() => startGroupEdit(g)}
                    title={isArabic ? 'تعديل الاسم والمرحلة والموعد' : 'Edit name, stage & schedule'}
                  ><Icon name="pencil" size={14} /></button>
                  <button
                    className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold"
                    onClick={() => setMergeSource(g)}
                    disabled={(ws.groups || []).length < 2}
                    title={isArabic ? 'دمج هذه المجموعة في مجموعة أخرى مع كل بياناتها' : 'Merge this group into another one with all its data'}
                  ><Icon name="refresh" size={14} /></button>
                  <button
                    className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold"
                    onClick={async () => {
                      const ok = await ui.askConfirm(`${isArabic ? 'حذف المجموعة' : 'Delete group'} ${g}؟`, { danger: true, confirmLabel: isArabic ? 'حذف' : 'Delete' })
                      if (ok) ws.deleteGroup(g)
                    }}
                  ><Icon name="trash" size={14} /></button>
                </span>
              </div>
            )
          })}
          {ws.groups.length === 0 && <p className="text-[.74rem] text-fg-muted m-0">{isArabic ? 'لا مجموعات بعد' : 'No groups yet'}</p>}
        </div>

        {!isAssistant && (
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2 items-center">
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
            </div>
            {/* Task 66 — مجموعة بمعادين: موعد واحد على الأقل، وأضف ما تشاء */}
            <SlotEditor slots={newSlots} setSlots={setNewSlots} isArabic={isArabic} />
            <button
              className="btn-navy rounded-xl px-4 py-2 text-[.74rem] font-extrabold w-fit"
              onClick={async () => {
                const ok = await ws.addGroup({ name: newGroup.name, stage: newGroup.stage, slots: newSlots })
                if (ok) {
                  setNewGroup({ name: '', stage: '' })
                  setNewSlots([{ day: String(new Date().getDay()), time: '16:30' }])
                }
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
          <b className="block text-[.85rem] mb-1"><Icon name="send" size={15} style={{ marginInlineEnd: 6, verticalAlign: '-0.2em' }} />{isArabic ? 'قوالب الرسائل' : 'Message templates'}</b>
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
          if (!error) { ws.refreshSettings?.(); ws.showToast?.(isArabic ? 'تم حفظ الإعدادات' : 'Settings saved', 'success'); track('settings_saved'); setSettingsOpen(false) }
          else ws.showToast?.(friendlySaveErrorText(error, isArabic), 'error')
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
          if (!error) { ws.refreshSettings?.(); ws.showToast?.(isArabic ? 'تم حفظ القوالب' : 'Templates saved', 'success'); track('templates_saved'); setTemplatesOpen(false) }
          else ws.showToast?.(friendlySaveErrorText(error, isArabic), 'error')
        }}
      />
      <BrandingModal open={brandingOpen} onClose={() => setBrandingOpen(false)} />

      {/* Task 65 — مودال دمج المجموعات (يُفتح من زر ⇄ أو القائمة السياقية) */}
      {mergeSource && <MergeGroupModal source={mergeSource} onClose={() => setMergeSource(null)} />}

      {/* Task 65 — قائمة السياق لصفوف المجموعات */}
      {contextMenu}
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

// ─────────────────────────────────────────────────────────────────────────────
// MERGE GROUPS (Task 65): المجموعة المصدر تذوب بالكامل في المجموعة الهدف —
// الطلاب والحصص والواجبات والامتحانات تنتقل عبر RPC ذري على السيرفر
// (migration_065)، ومواعيد المصدر تنضم لمواعيد الهدف، ثم يختفي اسم المصدر
// من القوائم. العملية نهائية — لذلك العدّاد يظهر قبل التأكيد.
// ─────────────────────────────────────────────────────────────────────────────
function MergeGroupModal({ source, onClose }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  // Task 66 — سؤال الوقت: 'separate_times' (افتراضي) أو 'same_time'
  const [scheduleMode, setScheduleMode] = useState('separate_times')
  const groups = (ws.groups || []).filter((g) => g !== source)
  const byGroup = (list, name) => (list || []).filter((x) => x.group_name === name).length
  const students = (ws.students || []).filter((s) => s.group_name === source
    || (Array.isArray(s.extra_groups) && s.extra_groups.includes(source))).length
  const sessions = byGroup(ws.lessonSessions, source)
  const hw = byGroup(ws.homeworkTasks, source)
  const exams = byGroup(ws.standaloneExams, source) + byGroup(ws.onlineExams, source)

  const doMerge = async () => {
    if (!target || busy) return
    setBusy(true)
    const ok = await ws.mergeGroups(source, target, scheduleMode)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/50 p-4" onClick={busy ? undefined : onClose} role="dialog" aria-modal="true">
      <div className="glass-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-extrabold m-0 mb-1">
          {isArabic ? `دمج «${source}» في مجموعة أخرى` : `Merge "${source}" into another group`}
        </h3>
        <p className="text-[.72rem] text-fg-muted mt-0 mb-3">
          {isArabic
            ? 'كل بيانات المجموعة المصدر تنتقل للمجموعة الهدف ثم يختفي اسمها من القوائم. العملية نهائية ولا يمكن التراجع عنها.'
            : 'All source-group data moves to the target group, then the source name disappears. This is final and cannot be undone.'}
        </p>
        <div className="nk-notice mb-3 !text-[.7rem]">
          <b className="block mb-1">{isArabic ? 'سيتم نقل:' : 'Will be moved:'}</b>
          {isArabic
            ? `${students} طالب · ${sessions} حصة (بحضورها ودرجاتها) · ${hw} واجب تفاعلي · ${exams} امتحان — ومواعيد «${source}» الأسبوعية تنضم لمواعيد الهدف.`
            : `${students} students · ${sessions} sessions (with attendance & grades) · ${hw} homework tasks · ${exams} exams — the source weekly schedule joins the target's.`}
        </div>
        <select className="glass-input rounded-xl px-3 py-2.5 text-sm w-full mb-3" value={target} onChange={(e) => setTarget(e.target.value)} autoFocus>
          <option value="">{isArabic ? 'اختر المجموعة الهدف...' : 'Pick the target group...'}</option>
          {groups.map((g) => <option key={g} value={g}>{g}{ws.groupMeta[g]?.stage ? ` — ${ws.groupMeta[g].stage}` : ''}</option>)}
        </select>
        {groups.length === 0 && (
          <p className="text-[.72rem] text-fg-muted mb-3">{isArabic ? 'لا توجد مجموعة أخرى للدمج معها.' : 'No other group to merge into.'}</p>
        )}

        {/* Task 66 — سؤال الدمج الزمني (طلب المالك): نفس الوقت ولا كل مجموعة
            بموعدها؟ النقل الذكي للطلاب المكررين يحدث في الحالتين. */}
        <div className="mb-3 rounded-xl p-3" style={{ background: 'var(--surface-container)' }}>
          <b className="block text-[.76rem] mb-2">{isArabic ? '⏰ ماذا يحدث للمواعيد الأسبوعية؟' : 'What happens to the weekly slots?'}</b>
          <label className="flex items-start gap-2.5 mb-2 cursor-pointer">
            <input type="radio" name="schedmode" className="mt-1 accent-[var(--brand-gold)]" checked={scheduleMode === 'same_time'} onChange={() => setScheduleMode('same_time')} />
            <span className="text-[.72rem] leading-5">
              <b className="block">{isArabic ? 'نفس الوقت — مواعيد المصدر تُحذف' : 'Same time — source slots are removed'}</b>
              <small className="text-fg-muted">{isArabic ? 'المجموعة الموحدة تلتقي على موعد المجموعة الهدف فقط.' : 'The merged group meets only at the target group’s slot.'}</small>
            </span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="radio" name="schedmode" className="mt-1 accent-[var(--brand-gold)]" checked={scheduleMode === 'separate_times'} onChange={() => setScheduleMode('separate_times')} />
            <span className="text-[.72rem] leading-5">
              <b className="block">{isArabic ? 'كل مجموعة بموعدها — المواعيد تتجميع مع بعض' : 'Each keeps its slot — slots combine'}</b>
              <small className="text-fg-muted">{isArabic ? 'مواعيد المصدر تنضم لمواعيد الهدف: المجموعة الموحدة بمعادين (أو أكثر).' : 'Source slots join the target’s: the merged group has two (or more) weekly slots.'}</small>
            </span>
          </label>
        </div>

        <div className="nk-notice mb-3 !text-[.7rem]">
          {isArabic
            ? 'الطالب الموجود في المجموعتين (بنفس الرقم أو نفس الاسم) يتوحد في سجل واحد — بنفس درجاته وحضوره وواجباته، بدون تكرار.'
            : 'A student present in both groups (same phone or same name) is unified into one record — keeping all grades, attendance and homework, with no duplicates.'}
        </div>

        <div className="flex gap-2">
          <button className="btn-ghost flex-1 rounded-xl px-4 py-2.5 text-[.75rem] font-extrabold" onClick={onClose} disabled={busy}>
            {isArabic ? 'إلغاء' : 'Cancel'}
          </button>
          <button className="btn-gold flex-1 rounded-xl px-4 py-2.5 text-[.75rem] font-extrabold" disabled={!target || busy} onClick={doMerge}>
            {busy ? (isArabic ? 'جاري الدمج…' : 'Merging…') : (isArabic ? 'دمج نهائي' : 'Merge now')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SLOT EDITOR (Task 66 — مجموعة بمعادين): صفوف مواعيد أسبوعية — يوم + ميعاد.
// كل يوم مرة واحدة للمجموعة الواحدة (فهرس فريد على teacher+group+weekday).
// ─────────────────────────────────────────────────────────────────────────────
function SlotEditor({ slots, setSlots, isArabic }) {
  const used = new Set(slots.map((s) => Number(s.day)))
  return (
    <div className="grid gap-2">
      {slots.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[.64rem] text-fg-muted w-16 shrink-0 font-extrabold">
            {isArabic ? `معاد ${i + 1}` : `Slot ${i + 1}`}
            {i === 0 && <span className="block text-[.58rem] opacity-70">{isArabic ? '(الأساسي)' : '(primary)'}</span>}
          </span>
          <select
            className="glass-input rounded-xl px-2 py-1.5 text-[.74rem] flex-1 min-w-0"
            value={s.day}
            aria-label={isArabic ? 'يوم الموعد' : 'Slot weekday'}
            onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))}
          >
            {WEEKDAYS.map((d, di) => (
              <option key={d} value={di} disabled={used.has(di) && Number(s.day) !== di}>{d}</option>
            ))}
          </select>
          <input
            type="time"
            className="glass-input rounded-xl px-2 py-1.5 text-[.74rem] w-[7.5rem] shrink-0"
            value={s.time}
            aria-label={isArabic ? 'ميعاد الموعد' : 'Slot time'}
            onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
          />
          {slots.length > 1 && (
            <button
              className="btn-ghost !min-h-0 rounded-lg px-2 py-1.5 text-[.66rem] font-black shrink-0"
              style={{ color: 'var(--danger-strong)' }}
              title={isArabic ? 'إزالة الموعد' : 'Remove slot'}
              aria-label={isArabic ? 'إزالة الموعد' : 'Remove slot'}
              onClick={() => setSlots(slots.filter((_, j) => j !== i))}
            >✕</button>
          )}
        </div>
      ))}
      {slots.length < WEEKDAYS.length && (
        <button
          className="btn-ghost !min-h-0 rounded-lg px-3 py-1.5 text-[.66rem] font-extrabold w-fit"
          onClick={() => {
            const free = WEEKDAYS.map((_, di) => di).find((di) => !used.has(di))
            setSlots([...slots, { day: String(free ?? 0), time: '16:30' }])
          }}
        >＋ {isArabic ? 'معاد إضافي للمجموعة' : 'Extra weekly slot'}</button>
      )}
      <small className="text-fg-muted">
        {isArabic
          ? 'المجموعة تظهر في كل أيام مواعيدها على الشاشة الرئيسية، وكل موعد حصته المستقلة.'
          : 'The group appears on Home on every scheduled day; each slot is its own session.'}
      </small>
    </div>
  )
}
