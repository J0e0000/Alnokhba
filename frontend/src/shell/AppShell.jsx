import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { useTheme } from '../context/ThemeContext'
import { useWorkspace, useWorkspaceMeta } from '../store/WorkspaceStore'
import { useUI } from './UIContext'
import NotificationBell from '../components/NotificationBell'
import TeacherNotificationCenter from '../components/TeacherNotificationCenter'
import OfflineBanner from '../components/OfflineBanner'
import UndoSnackbar from '../components/UndoSnackbar'
import HistoryModal from '../components/HistoryModal'
import MessageQueueModal from '../components/MessageQueueModal'
import { getHistoryCount, getRedoCount } from '../lib/undoManager'
import HomePage from '../home/HomePage'
import SessionWorkspace from '../session/SessionWorkspace'
import StudentsArea from '../areas/StudentsArea'
import HistoryArea from '../areas/HistoryArea'
import ReportsArea from '../areas/ReportsArea'
import AnalyticsArea from '../areas/AnalyticsArea'
import SettingsArea from '../areas/SettingsArea'
import useIsMobile from './useIsMobile'

const IS_DEMO = Boolean(typeof window !== 'undefined' && window.__NOKHBA_DEMO__)

const AR_DATE = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const EN_DATE = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

const NAV = [
  { key: 'home', label: 'نظرة عامة', labelEn: 'Overview', icon: '▦' },
  { key: 'students', label: 'الطلاب', labelEn: 'Students', icon: '♧' },
  { key: 'history', label: 'سجل الطالب', labelEn: 'Student History', icon: '◷' },
  { key: 'reports', label: 'التقارير', labelEn: 'Reports', icon: '↗' },
  { key: 'analytics', label: 'التحليلات', labelEn: 'Analytics', icon: '⌁' },
  { key: 'settings', label: 'الإعدادات', labelEn: 'Settings', icon: '⚙' },
]
const MOBILE_NAV = NAV.filter((n) => n.key !== 'analytics')

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
  const focusActive = isMobile && ui.area === 'session'

  const [accountOpen, setAccountOpen] = useState(false)
  const [notifCenterOpen, setNotifCenterOpen] = useState(false)
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

  const activeNav = ui.area === 'session' ? 'home' : ui.area

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
          onClick={() => ui.setArea(item.key)}
        >
          <span aria-hidden="true" style={{ fontSize: '1rem' }}>{item.icon}</span>
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
    <div className={`min-h-screen flex flex-col${focusActive ? ' nk-focus' : ''}`} style={{ background: 'var(--app-bg)' }}>
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
            <OfflineBanner isOnline={ws.isOnline} pending={0} syncing={false} onManualSync={ws.syncPendingSaves} />
            {/* FREQUENCY-BASED UI: theme / language / undo / history are
                low-frequency controls — the desktop header keeps them, mobile
                reaches them from Settings → Appearance & tools (spec 5, 34). */}
            <button
              className="hidden lg:grid w-9 h-9 place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
              onClick={toggleTheme}
              title={isDark ? 'الوضع الفاتح' : 'الوضع الليلي'}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? '☀' : '☾'}
            </button>
            <button
              className="hidden lg:grid w-9 h-9 place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg text-[.7rem] font-black"
              onClick={toggleLang}
              title="العربية / English"
            >
              {lang === 'ar' ? 'EN' : 'ع'}
            </button>
            <TeacherNotificationCenterLauncher onOpen={() => setNotifCenterOpen(true)} />
            <NotificationBell broadcasts={ws.broadcasts} dismissedBroadcasts={dismissedBroadcasts} onDismiss={dismissBroadcast} />
            <button
              className="hidden lg:grid w-9 h-9 place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
              onClick={() => { ws.handleUndo(); }}
              title="تراجع"
              aria-label="تراجع"
            >
              ↺
            </button>
            <button
              className="hidden lg:grid w-9 h-9 place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
              onClick={() => setHistoryOpen(true)}
              title="سجل العمليات"
              aria-label="سجل العمليات"
            >
              ⧖
            </button>
            {profile?.is_admin && !isAssistant && (
              <button
                className="hidden sm:grid w-9 h-9 place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
                onClick={onOpenAdmin}
                title="لوحة الأدمن"
              >
                🛡
              </button>
            )}
            <div className="nk-account-anchor">
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
          {ui.area === 'home' && <HomePage />}
          {ui.area === 'session' && <SessionWorkspace params={ui.sessionParams} />}
          {ui.area === 'students' && <StudentsArea />}
          {ui.area === 'history' && <HistoryArea />}
          {ui.area === 'reports' && <ReportsArea />}
          {ui.area === 'analytics' && <AnalyticsArea />}
          {ui.area === 'settings' && <SettingsArea />}
        </main>
      </div>

      {/* ── Mobile bottom nav — navigation ONLY, hidden during Focus Mode:
          the session task owns the screen. Logout lives in the account menu:
          a stray tap here must never end the user's session. ─────────── */}
      {!focusActive && (
      <nav className="nk-bottom-nav lg:hidden" aria-label="التنقل">
        {MOBILE_NAV.map((item) => (
          <button
            key={item.key}
            className={activeNav === item.key ? 'active' : ''}
            onClick={() => ui.setArea(item.key)}
          >
            <span aria-hidden="true" style={{ fontSize: '1.05rem' }}>{item.icon}</span>
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
              <button
                className="nk-account-menu__item"
                role="menuitem"
                onClick={() => { setAccountOpen(false); ui.setArea('settings') }}
              >
                <span aria-hidden="true">⚙</span>
                <span>{isArabic ? 'الإعدادات' : 'Settings'}</span>
              </button>
              <button
                className="nk-account-menu__item nk-account-menu__item--logout"
                role="menuitem"
                onClick={handleSignOut}
              >
                <span aria-hidden="true">⎋</span>
                <span>{isArabic ? 'تسجيل الخروج' : 'Sign out'}</span>
              </button>
            </div>
          </div>
        </>
      )}
      {notifCenterOpen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-16" onClick={() => setNotifCenterOpen(false)}>
          <div className="glass-card w-full max-w-lg p-4 max-h-[75vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <TeacherNotificationCenter />
          </div>
        </div>
      )}
      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestore={async (id) => { await ws.handleHistoryRestore(id) }}
        onRedo={() => ws.handleRedo()}
        canRedo={wsMeta.canRedo}
        redoCount={getRedoCount()}
      />
      <MessageQueueModal
        open={ui.queue.open}
        onClose={ui.closeQueue}
        queue={ui.queue.items}
        index={ui.queue.index}
        onAdvance={ui.advanceQueue}
      />
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
    </div>
  )
}

function TeacherNotificationCenterLauncher({ onOpen }) {
  return (
    <button
      className="w-9 h-9 grid place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
      onClick={onOpen}
      title="مركز الإشعارات"
      aria-label="مركز الإشعارات"
    >
      ◔
    </button>
  )
}
