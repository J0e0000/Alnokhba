import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Icon from '../components/icons'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { useTheme } from '../context/ThemeContext'
import { useWorkspace, useWorkspaceMeta } from '../store/WorkspaceStore'
import { useUI } from './UIContext'
import NotificationBell from '../components/NotificationBell'
import TeacherNotificationCenter from '../components/TeacherNotificationCenter'
import UpdateWelcomePopup from '../components/UpdateWelcomePopup'
import { usePlatformUpdates } from '../hooks/usePlatformUpdates'
import InsightsNotifier from '../components/InsightsNotifier'
import OfflineBanner from '../components/OfflineBanner'
import UndoSnackbar from '../components/UndoSnackbar'
import SubscriptionExpiryBanner from '../components/SubscriptionExpiryBanner'
import HistoryModal from '../components/HistoryModal'
// PERF (bundle splitting): the message-queue modal is the ONLY eager window
// into lib/qrPdfWhatsApp (~70 KB of PDF/QR builders). It renders only when a
// send queue is active — lazily, so its graph ships on demand.
const MessageQueueModal = lazySafe(() => import('../components/MessageQueueModal'))
import { getHistoryCount, getRedoCount } from '../lib/undoManager'
import HomePage from '../home/HomePage'
import SessionWorkspace from '../session/SessionWorkspace'
import ExamWorkspace from '../exams/ExamWorkspace'
import HomeworkWorkspace from '../homework/HomeworkWorkspace'
import OnlineExamWorkspace from '../exams/OnlineExamWorkspace'
import TourOverlay from '../components/TourOverlay'
import AreaErrorBoundary from '../components/AreaErrorBoundary'

// PERF (bundle splitting): Home and the Session Workspace stay in the main
// bundle (they ARE the daily flow — lazy chunks would add a flash to the
// first paint). Secondary destinations load on demand: opening Students,
// Reports, Settings, or History fetches only that area's chunk, so first
// paint stays light and unrelated area code never runs at startup.
// ANALYTICS RESTRUCTURE: the old "التحليلات" dashboard area was merged into
// فريق التحليل, which now lives INSIDE Settings (owner request) — one simple
// infographic report, no standalone area, no account-menu entry.
const StudentsArea = lazySafe(() => import('../areas/StudentsArea'))
const HistoryArea = lazySafe(() => import('../areas/HistoryArea'))
const ReportsArea = lazySafe(() => import('../areas/ReportsArea'))
const SettingsArea = lazySafe(() => import('../areas/SettingsArea'))
const HomeworkArea = lazySafe(() => import('../areas/HomeworkArea'))

const AREA_FALLBACK_AR = 'جاري التحميل...'
const AREA_FALLBACK_EN = 'Loading...'

/* LAZY STALL BUSTER (stuck-boot fix, 2026-11-05) — same contract as App.jsx:
   an import() that silently stalls on mobile networks would otherwise pin
   the area fallback «جاري التحميل...» forever. The 30s rejection reaches
   the AreaErrorBoundary around each area and shows the recovery card. */
function lazySafe(loader) {
  return lazy(() => Promise.race([
    Promise.resolve().then(loader),
    new Promise((_, reject) => setTimeout(() => reject(new Error('lazy-chunk-stall-timeout')), 30000)),
  ]))
}
import useIsMobile from './useIsMobile'


const IS_DEMO = Boolean(typeof window !== 'undefined' && window.__NOKHBA_DEMO__)

const AR_DATE = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const EN_DATE = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

// IA simplification (spec 8): "Student History" is NO LONGER a main nav
// item — history is contextual (open a student → their details/history via
// the name link). The history AREA still renders for the deep link
// (ui.openStudentHistory); it just doesn't compete for navigation space.
const NAV = [
  { key: 'home', label: 'نظرة عامة', labelEn: 'Overview', icon: 'layout-dashboard' },
  { key: 'students', label: 'الطلاب', labelEn: 'Students', icon: 'trophy' },
  { key: 'homework', label: 'الواجبات', labelEn: 'Homework', icon: 'pencil' },
  { key: 'reports', label: 'التقارير', labelEn: 'Reports', icon: 'arrow-up-right' },
  { key: 'settings', label: 'الإعدادات', labelEn: 'Settings', icon: 'settings' },
]
const MOBILE_NAV = NAV

// Spotlight tour steps (spec 17–19): targets are data-tour anchors resolved
// at runtime — visible element wins (desktop sidebar vs mobile bottom nav).
const TOUR_STEPS_AR = [
  { target: '[data-tour="today-sessions"]', title: 'حصص اليوم تبدأ من هنا', body: 'كل حصة مجدولة اليوم تظهر كبطاقة. اضغط «فتح الحصة» لتبدأ مساحة العمل: حضور، تفاعل، واجب، امتحان، وتقرير — كلها في شاشة واحدة بدون تنقل.' },
  { target: '[data-tour="stats"]', title: 'نظرة سريعة على يومك', body: 'ثلاث أرقام فقط: عدد حصص اليوم، عدد الطلاب، والإجراءات المعلقة التي تحتاج انتباهك.' },
  { target: '[data-tour="nav-students"]', title: 'الطلاب وإدارتهم', body: 'من هنا تدير الطلاب: إضافة طالب أو عدة طلاب دفعة واحدة، فلترة بالمرحلة أو المجموعة، وإجراءات جماعية (تعيين مجموعة، رسائل، QR) عند تحديد أكثر من طالب.' },
  { target: '[data-tour="nav-homework"]', title: 'الواجبات التفاعلية', body: 'تبويب كامل للواجبات: قوالب جاهزة (واجب 10 اختيارات، صح وغلط...) تفتح البناء بعدد أسئلة فورًا، Enter بينقلك بين الاختيارات، ومفتاح إجابات تلصقه مرة واحدة — والتصحيح تلقائي والدرجة تتسجل في الحصة الجاية.' },
  { target: '[data-tour="nav-reports"]', title: 'التقارير الجماعية', body: 'تقارير الحصص المنتهية لكل المجموعة، روابط البوابة (QR)، والقوالب — مع اختيار المستلمين في كل إرسال.' },
  { target: '[data-tour="account"]', title: 'حسابك وإعداداتك', body: 'الإعدادات والمساعدة والخروج موجودة هنا ومن صفحة الإعدادات — عشان تفضل شاشة العمل نظيفة أثناء الحصص.' },
  // Task 66 — الميزات الجديدة (معادين للمجموعة، الدمج الذكي، القائمة السياقية، شريط التحديد)
  { target: '.nk-session-card', title: 'قائمة سريعة بالضغط المطول', body: 'Right-click على الكمبيوتر أو ضغطة مطولة على الموبايل على أي بطاقة حصة أو صف طالب أو مجموعة — تظهر لك كل الإجراءات المتاحة فورًا.' },
  { title: 'مجموعة بمعادين', body: 'من الإعدادات → المجموعات: عدّل أي مجموعة واضف «معاد إضافي» ليوم وميعاد مختلفين — المجموعة تظهر في كل أيام مواعيدها على الشاشة الرئيسية، وكل موعد حصته المستقلة بحضورها ودرجاتها.' },
  { title: 'دمج مجموعتين بذكاء', body: 'اضغط زر الدمج جنب أي مجموعة في الإعدادات: تختار المجموعة الهدف، ونسألك — نفس الوقت ولا كل مجموعة بموعدها؟ والطالب المكرر (نفس الرقم أو نفس الاسم) يتوحد تلقائيًا في سجل واحد بنفس درجاته وحضوره وواجباته، بدون تكرار.' },
  { title: 'حدّد طلاب وشوف الخيارات', body: 'في شاشة الطلاب، حدد أي عدد من الطلاب — شريط الإجراءات يظهر فورًا: تعيين مجموعة، رسالة جماعية، نسخ الأرقام، روابط البوابة، والحذف.' },
]
const TOUR_STEPS_EN = [
  { target: '[data-tour="today-sessions"]', title: "Today's sessions start here", body: 'Every scheduled session is a card. Tap "Open session" to launch the workspace: attendance, interaction, homework, exams and the report — all in one screen.' },
  { target: '[data-tour="stats"]', title: 'Your day at a glance', body: 'Just three numbers: sessions today, students today, and pending actions needing your attention.' },
  { target: '[data-tour="nav-students"]', title: 'Students', body: 'Manage students here: single or bulk add, stage/group filters, and bulk actions (assign group, messages, QR) when you select multiple students.' },
  { target: '[data-tour="nav-homework"]', title: 'Interactive homework', body: 'A full homework tab: ready templates (10 MCQs, true/false...) generate questions instantly, Enter jumps between choices, and you can paste a whole answer key at once — grading is automatic and grades flow into the next session.' },
  { target: '[data-tour="nav-reports"]', title: 'Batch reports', body: 'Reports for completed sessions, portal (QR) links, and templates — with recipient selection on every send.' },
  { target: '[data-tour="account"]', title: 'Account & settings', body: 'Settings, help and sign-out live here and in the Settings page — keeping the working screen clean during sessions.' },
  // Task 66 — new features (multi-slot groups, smart merge, context menu, bulk bar)
  { target: '.nk-session-card', title: 'Quick actions on long-press', body: 'Right-click on PC or long-press on mobile on any session card, student row or group — every available action appears instantly.' },
  { title: 'One group, two slots', body: 'Settings → Groups: edit any group and add an extra weekly slot on a different day and time — the group shows on Home on every scheduled day, each slot is its own session.' },
  { title: 'Smart group merge', body: 'Press the merge button next to any group in Settings: pick the target group, and choose — same time, or each keeps its slot? Duplicate students (same phone or same name) are automatically unified into one record keeping all grades, attendance and homework.' },
  { title: 'Select students, see actions', body: 'In the Students screen, select any number of students — the action bar appears instantly: assign group, batch message, copy phone numbers, portal links, and delete.' },
]

export default function AppShell({ onOpenAdmin }) {
  const { profile, signOut, isAssistant, ownerProfile } = useAuth()
  const { lang, isArabic, toggleLang } = useLanguage()
  const { isDark, toggleTheme } = useTheme()
  const ws = useWorkspace()
  const wsMeta = useWorkspaceMeta()
  const ui = useUI()
  const isMobile = useIsMobile()

  // FOCUS MODE (mobile UX restructure): while the teacher is inside a session
  // task on a phone, the global chrome (top bar with theme/lang/account, the
  // bottom navigation, the sidebar) does NOT render at all — it is a real
  // unmount, not a CSS hide — so nothing competes with the current task and
  // nothing keeps re-rendering behind it. "Exit Focus" (in the workspace's
  // focused header) leaves the task back to Home; it is NEVER logout.
  // الامتحان المنفصل يدخل نفس وضع التركيز — نفس فكرة الحصة.
  const focusActive = isMobile && (ui.area === 'session' || ui.area === 'exam' || ui.area === 'task' || ui.area === 'onlineExam')

  const [accountOpen, setAccountOpen] = useState(false)
  const [notifCenterOpen, setNotifCenterOpen] = useState(false)
  // ✨ unread platform-update count — shared by the ◔ launcher AND the 🔔
  // bell (review round 2, note b). refreshKey flips as the center opens and
  // closes so both badges re-sync after read.
  const { popupState, dismissPopup, openPopup } = usePlatformUpdates()
  const historyOpen = ui.historyOpen
  const setHistoryOpen = ui.setHistoryOpen
  const [historyCount, setHistoryCount] = useState(getHistoryCount())
  const [dismissedBroadcasts, setDismissedBroadcasts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dismissedBroadcasts') || '[]') } catch { return [] }
  })

  useEffect(() => {
    const refresh = () => setHistoryCount(getHistoryCount())
    const timer = window.setInterval(refresh, 4000)
    return () => window.clearInterval(timer)
  }, [])

  const dismissBroadcast = (id) => {
    const next = [...dismissedBroadcasts, id]
    setDismissedBroadcasts(next)
    localStorage.setItem('dismissedBroadcasts', JSON.stringify(next))
  }

  const dateLabel = useMemo(() => (isArabic ? AR_DATE : EN_DATE).format(new Date()), [isArabic])
  const brandName = ws.settings ? null : null
  void brandName

  const activeNav = ui.area === 'session' ? 'home'
    : (ui.area === 'task' || ui.area === 'onlineExam') ? 'homework'
    : ui.area

  // LOGOUT SAFETY (UX restructure): logout lives ONLY in the account menu
  // (under the user's name) and in Settings — never in the bottom navigation
  // or next to workflow actions — and always asks for confirmation first.
  const handleSignOut = async () => {
    setAccountOpen(false)
    const ok = await ui.askConfirm(
      ui.area === 'session'
        ? (isArabic
            ? 'أنت جوه مساحة حصة — كل علامة بتتحفظ فورًا ومحفوظة. تحب تسجل الخروج؟'
            : 'You are inside a session workspace — every mark is saved instantly. Sign out?')
        : (isArabic ? 'تسجيل الخروج من حسابك؟' : 'Sign out of your account?'),
      { title: isArabic ? 'تسجيل الخروج' : 'Sign out', confirmLabel: isArabic ? 'تسجيل الخروج' : 'Sign out', danger: true },
    )
    if (ok) await signOut()
  }

  const roleLabel = profile?.is_admin
    ? (isArabic ? 'مدير النظام' : 'Administrator')
    : isAssistant
      ? (isArabic ? `مساعد لدى ${ownerProfile?.full_name || ''}` : `Assistant to ${ownerProfile?.full_name || ''}`)
      : (isArabic ? 'مدرس' : 'Teacher')

  const nav = (
    <>
      {NAV.map((item) => (
        <button
          key={item.key}
          className={`nav-btn ${activeNav === item.key ? 'active' : ''}`}
          aria-current={activeNav === item.key ? 'page' : undefined}
          data-tour={item.key === 'students' ? 'nav-students' : item.key === 'homework' ? 'nav-homework' : item.key === 'reports' ? 'nav-reports' : undefined}
          onClick={() => ui.setArea(item.key)}
        >
          <Icon name={item.icon} size={18} />
          <span>{isArabic ? item.label : item.labelEn}</span>
        </button>
      ))}
      <div className="mt-5 pt-4 text-[.68rem] leading-6" style={{ borderTop: '1px solid rgba(255,255,255,.12)', color: '#aebad0' }}>
        {isAssistant && ownerProfile ? (
          <span>تعمل كمساعد لـ {ownerProfile.full_name}</span>
        ) : (
          <span>مسار الحصص الجديد — كل الحصة في مساحة واحدة بدون تنقل.</span>
        )}
      </div>
    </>
  )

  return (
    <div className={`nk-shell min-h-screen flex flex-col${focusActive ? ' nk-focus' : ''}`} style={{ background: 'var(--app-bg)' }}>
      {/* ── Top bar — unmounted during mobile Focus Mode ────────── */}
      {!focusActive && (
      <header
        className="sticky top-0 z-40 border-b border-subtle"
        style={{ background: 'var(--surface)', backdropFilter: 'none' }}
      >
        <div className="mx-auto max-w-[1180px] px-4 py-2.5 flex items-center gap-3">
          <button className="flex items-center gap-2.5 shrink-0" onClick={() => ui.setArea('home')} aria-label="النخبة — الرئيسية">
            <span
              className="grid place-items-center w-10 h-10 rounded-2xl font-black text-lg"
              style={{ border: '1px solid color-mix(in srgb, var(--brand-gold) 45%, transparent)', background: 'var(--brand-gold-surface)', color: 'var(--brand-gold)' }}
            >
              ن
            </span>
            <span className="hidden sm:block text-right leading-tight">
              <b className="block text-[.95rem]">{isArabic ? 'النخبة' : 'ALNOKHBA'}</b>
              <small className="block text-[.66rem] text-fg-muted">{isArabic ? 'إدارة الحصص الذكية' : 'Session Pipeline'}</small>
            </span>
          </button>

          <span className="hidden md:inline text-[.7rem] text-fg-muted ms-1">{dateLabel}</span>
          {IS_DEMO && (
            <span className="nk-pill nk-pill-gold !py-1 !text-[.62rem]" title="بيئة عرض تجريبية — أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY للاتصال بقاعدة البيانات الحقيقية">
              بيئة تجريبية
            </span>
          )}

          <div className="flex items-center gap-1.5 ms-auto">
            <OfflineBanner isOnline={ws.isOnline} pending={wsMeta.queuePending ?? 0} syncing={Boolean(wsMeta.queueSyncing)} onManualSync={ws.syncPendingSaves} />
            {/* FREQUENCY-BASED UI: theme / language / undo / history are
                low-frequency controls — the desktop header keeps them, mobile
                reaches them from Settings → Appearance & tools (spec 5, 34). */}
            <button
              className="hidden lg:grid w-9 h-9 place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
              onClick={toggleTheme}
              title={isDark ? 'الوضع الفاتح' : 'الوضع الليلي'}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <Icon name={isDark ? 'sun' : 'moon'} size={18} />
            </button>
            <button
              className="hidden lg:grid w-9 h-9 place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg text-[.7rem] font-black"
              onClick={toggleLang}
              title="العربية / English"
            >
              {lang === 'ar' ? 'EN' : 'ع'}
            </button>
            <TeacherNotificationCenterLauncher onOpen={() => setNotifCenterOpen(true)} />
            <NotificationBell broadcasts={ws.broadcasts} dismissedBroadcasts={dismissedBroadcasts} onDismiss={dismissBroadcast} updatesUnread={0} />
            <button
              className="hidden lg:grid w-9 h-9 place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
              onClick={() => { ws.handleUndo(); }}
              title="تراجع"
              aria-label="تراجع"
            >
              <Icon name="rotate-ccw" size={18} />
            </button>
            <button
              className="hidden lg:grid w-9 h-9 place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
              onClick={() => setHistoryOpen(true)}
              title="سجل العمليات"
              aria-label="سجل العمليات"
            >
              <Icon name="hourglass" size={18} />
            </button>
            {profile?.is_admin && !isAssistant && (
              <button
                className="grid w-9 h-9 place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
                onClick={onOpenAdmin}
                title="لوحة الأدمن"
              >
                <Icon name="shield" size={18} />
              </button>
            )}
            <div className="nk-account-anchor" data-tour="account">
              <button
                className="w-9 h-9 rounded-xl grid place-items-center text-[.72rem] font-black"
                style={{ background: 'var(--brand-navy)', color: '#fff' }}
                onClick={() => setAccountOpen((o) => !o)}
                title={profile?.full_name}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
              >
                {(profile?.full_name || 'ن').slice(0, 1)}
              </button>
            </div>
          </div>
        </div>
      </header>
      )}

      {/* ── Subscription ending awareness (≤3 days left): persistent warning
          under the header so renewal happens BEFORE the SubscriptionGate
          pauses the account. Hidden in Focus Mode (session owns the screen). ── */}
      {!focusActive && <SubscriptionExpiryBanner />}

      {/* ── Body ────────────────────────────────────────────────── */}
      <div
        className={`mx-auto w-full flex-1 pt-4 flex gap-5 items-start ${focusActive ? 'max-w-[760px] px-2 pb-28' : 'max-w-[1180px] px-4 pb-24 lg:pb-8'}`}
      >
        {/* Desktop sidebar (prototype: navy band) */}
        <aside className="hidden lg:block w-[215px] shrink-0 nk-sidebar" aria-label="التنقل الرئيسي">
          <h3>{isArabic ? 'مساحة المدرس' : 'Teacher Space'}</h3>
          <nav className="grid gap-2">{nav}</nav>
        </aside>

        <main className="flex-1 min-w-0">
          {ui.area === 'home' && <AreaErrorBoundary area='home'><HomePage /></AreaErrorBoundary>}
          {ui.area === 'session' && <AreaErrorBoundary area='session'><SessionWorkspace params={ui.sessionParams} /></AreaErrorBoundary>}
          {ui.area === 'exam' && <AreaErrorBoundary area='exam'><ExamWorkspace params={ui.examParams} /></AreaErrorBoundary>}
          {ui.area === 'task' && <AreaErrorBoundary area='task'><HomeworkWorkspace params={ui.taskParams} /></AreaErrorBoundary>}
          {ui.area === 'onlineExam' && <AreaErrorBoundary area='onlineExam'><OnlineExamWorkspace params={ui.oeParams} /></AreaErrorBoundary>}
          <Suspense fallback={<div className="py-10 text-center text-sm text-fg-muted" role="status">{isArabic ? AREA_FALLBACK_AR : AREA_FALLBACK_EN}</div>}>
            {ui.area === 'students' && <AreaErrorBoundary area='students'><StudentsArea /></AreaErrorBoundary>}
            {ui.area === 'history' && <AreaErrorBoundary area='history'><HistoryArea /></AreaErrorBoundary>}
            {ui.area === 'homework' && <AreaErrorBoundary area='homework'><HomeworkArea /></AreaErrorBoundary>}
            {ui.area === 'reports' && <AreaErrorBoundary area='reports'><ReportsArea /></AreaErrorBoundary>}
            {ui.area === 'settings' && <AreaErrorBoundary area='settings'><SettingsArea /></AreaErrorBoundary>}
            {/* legacy 'insights'/'analytics' deep links land in Settings —
                فريق التحليل lives there now (one infographic report). */}
            {(ui.area === 'insights' || ui.area === 'analytics') && <AreaErrorBoundary area='settings'><SettingsArea /></AreaErrorBoundary>}
          </Suspense>
        </main>
      </div>

      {/* ── Mobile bottom nav — navigation ONLY, hidden during Focus Mode:
          the session task owns the screen. Logout lives in the account menu:
          a stray tap here must never end the user's session. ─────────── */}
      {!focusActive && (
      <nav className="nk-bottom-nav lg:hidden" aria-label="التنقل" data-tour="bottom-nav">
        {MOBILE_NAV.map((item) => (
          <button
            key={item.key}
            className={activeNav === item.key ? 'active' : ''}
            onClick={() => ui.setArea(item.key)}
            data-tour={item.key === 'students' ? 'nav-students' : item.key === 'homework' ? 'nav-homework' : item.key === 'reports' ? 'nav-reports' : undefined}
          >
            <Icon name={item.icon} size={20} />
            <span>{isArabic ? item.label : item.labelEn}</span>
          </button>
        ))}
      </nav>
      )}

      {/* ── Overlays ────────────────────────────────────────────── */}
      {accountOpen && profile && (
        <>
          <div className="nk-account-backdrop" onClick={() => setAccountOpen(false)} aria-hidden="true" />
          <div
            className="fixed z-[61]"
            style={{ position: 'fixed', insetInlineEnd: 'max(1rem, calc((100vw - 1180px) / 2 + 1rem))', top: '64px' }}
          >
            <div className="nk-account-menu" role="menu" aria-label={isArabic ? 'الحساب' : 'Account'}>
              <div className="nk-account-menu__head">
                <b>{profile.full_name}</b>
                <small>{roleLabel}{profile.email ? ` · ${profile.email}` : ''}</small>
              </div>
              {/* فريق التحليل moved inside الإعدادات (owner request) — the
                  account menu keeps only the settings destination. */}
              <button
                className="nk-account-menu__item"
                role="menuitem"
                onClick={() => { setAccountOpen(false); ui.setArea('settings') }}
              >
                <Icon name="settings" size={16} />
                <span>{isArabic ? 'الإعدادات' : 'Settings'}</span>
              </button>
              <button
                className="nk-account-menu__item nk-account-menu__item--logout"
                role="menuitem"
                onClick={handleSignOut}
              >
                <Icon name="log-out" size={16} />
                <span>{isArabic ? 'تسجيل الخروج' : 'Sign out'}</span>
              </button>
            </div>
          </div>
        </>
      )}
      {notifCenterOpen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-16" onClick={() => setNotifCenterOpen(false)}>
          <div className="glass-card w-full max-w-lg p-4 max-h-[75vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <TeacherNotificationCenter onOpenInsights={() => { setNotifCenterOpen(false); ui.openInsights() }} onOpenUpdatePopup={() => { setNotifCenterOpen(false); openPopup() }} />
          </div>
        </div>
      )}
      {/* ONE-TIME welcome popup (note #23): what's new + short tutorial,
          shown on the first open per teacher, dismissed forever after. */}
      {popupState === 'show' && <UpdateWelcomePopup onDismiss={dismissPopup} />}
      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestore={async (id) => { await ws.handleHistoryRestore(id) }}
        onRedo={() => ws.handleRedo()}
        canRedo={wsMeta.canRedo}
        redoCount={getRedoCount()}
      />
      {(ui.queue.open || (ui.queue.items.length > 0 && ui.queue.index < ui.queue.items.length)) && (
        <Suspense fallback={null}>
          <MessageQueueModal
            open={ui.queue.open}
            onClose={ui.closeQueue}
            queue={ui.queue.items}
            index={ui.queue.index}
            status={ui.queue.status}
            onAdvance={ui.advanceQueue}
            onEditMessage={ui.updateQueueItemMessage}
          />
        </Suspense>
      )}
      {/* Paused send batch — a small non-intrusive chip at the very top
          (never over the working area): resume exactly where it stopped, or
          discard the remainder. Hidden while the queue modal itself is open. */}
      {!ui.queue.open && ui.queue.index < ui.queue.items.length && (
        <div
          className="fixed top-2 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 rounded-full px-3 py-1.5 shadow-lg"
          style={{ background: 'var(--surface)', border: '1px solid var(--brand-gold)' }}
          role="status"
        >
          <button className="text-[.7rem] font-extrabold" onClick={ui.reopenQueue}>
            <Icon name="pause" size={13} style={{ marginInlineEnd: 5, verticalAlign: '-0.15em' }} />استكمال قائمة الإرسال ({ui.queue.items.length - ui.queue.index} متبقي)
          </button>
          <button className="text-fg-subtle hover:text-fg leading-none" onClick={ui.discardQueue} aria-label="إلغاء القائمة المتبقية"><Icon name="x" size={13} /></button>
        </div>
      )}
      {/* فريق التحليل greeting (owner request): when the weekly window is due
          the analysis runs quietly in the background and ONE non-blocking
          entry lands in the notification bell — never a popup over the UI. */}
      <InsightsNotifier />
      <UndoSnackbar
        visible={wsMeta.undoSnackbar.visible}
        message={wsMeta.undoSnackbar.message}
        onUndo={() => ws.handleUndo()}
        onRedo={() => ws.handleRedo()}
        canRedo={wsMeta.canRedo}
        onDismiss={() => wsMeta.setUndoSnackbar({ visible: false, message: '' })}
        onHistory={() => setHistoryOpen(true)}
        historyCount={historyCount}
      />
      {/* Spotlight tour (spec 17–19) — started from Settings → Help & Support;
          skipping/finishing always restores the UI. */}
      {ui.tourActive && (
        <TourOverlay
          steps={isArabic ? TOUR_STEPS_AR : TOUR_STEPS_EN}
          onDone={() => {
            ui.setTourActive(false)
            try { localStorage.setItem('nokhba_tour_done_v1', '1') } catch { /* ignore */ }
          }}
        />
      )}
    </div>
  )
}

function TeacherNotificationCenterLauncher({ onOpen }) {
  // Opens the notification center modal. The old unread badge (✨ platform
  // updates) is gone — updates retired into the one-time welcome popup.
  return (
    <button
      className="relative w-9 h-9 grid place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
      onClick={onOpen}
      title="مركز الإشعارات"
      aria-label="مركز الإشعارات"
    >
      <Icon name="history" size={18} />
    </button>
  )
}
