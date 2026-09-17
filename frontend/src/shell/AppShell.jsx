import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { useTheme } from '../context/ThemeContext'
import { useWorkspace } from '../store/WorkspaceStore'
import { useUI } from './UIContext'
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
  const ui = useUI()

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyCount, setHistoryCount] = useState(getHistoryCount())

  useEffect(() => {
    const refresh = () => setHistoryCount(getHistoryCount())
    const timer = window.setInterval(refresh, 4000)
    return () => window.clearInterval(timer)
  }, [])

  const dateLabel = useMemo(() => (isArabic ? AR_DATE : EN_DATE).format(new Date()), [isArabic])
  const brandName = ws.settings ? null : null
  void brandName

  const activeNav = ui.area === 'session' ? 'home' : ui.area

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
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--app-bg)' }}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
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
            <button
              className="w-9 h-9 grid place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg"
              onClick={toggleTheme}
              title={isDark ? 'الوضع الفاتح' : 'الوضع الليلي'}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? '☀' : '☾'}
            </button>
            <button
              className="w-9 h-9 grid place-items-center rounded-xl border border-subtle text-fg-muted hover:text-fg text-[.7rem] font-black"
              onClick={toggleLang}
              title="العربية / English"
            >
              {lang === 'ar' ? 'EN' : 'ع'}
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
          </div>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pt-4 pb-24 lg:pb-8 flex gap-5 items-start">
        {/* Desktop sidebar (prototype: navy band) */}
        <aside className="hidden lg:block w-[215px] shrink-0 nk-sidebar" aria-label="التنقل الرئيسي">
          <h3>{isArabic ? 'مساحة المدرس' : 'Teacher Space'}</h3>
          <nav className="grid gap-2">{nav}</nav>
          <button
            className="nav-btn mt-3 !text-[.72rem]"
            style={{ color: '#f0b9b9' }}
            onClick={async () => { await signOut() }}
          >
            ⎋ {isArabic ? 'خروج' : 'Sign out'}
          </button>
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

      {/* ── Mobile bottom nav ───────────────────────────────────── */}
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
        <button onClick={async () => { await signOut() }}>
          <span aria-hidden="true" style={{ fontSize: '1.05rem' }}>⎋</span>
          <span>{isArabic ? 'خروج' : 'Exit'}</span>
        </button>
      </nav>

      {/* ── Overlays ────────────────────────────────────────────── */}
      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestore={async (id) => { await ws.handleHistoryRestore(id) }}
        onRedo={() => ws.handleRedo()}
        canRedo={ws.canRedo}
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
        visible={ws.undoSnackbar.visible}
        message={ws.undoSnackbar.message}
        onUndo={() => ws.handleUndo()}
        onRedo={() => ws.handleRedo()}
        canRedo={ws.canRedo}
        onDismiss={() => ws.setUndoSnackbar({ visible: false, message: '' })}
        onHistory={() => setHistoryOpen(true)}
        historyCount={historyCount}
      />
    </div>
  )
}
