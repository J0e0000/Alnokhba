import { useState, useEffect, Suspense, lazy } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { SettingsProvider } from './context/SettingsContext'
import { ToastProvider } from './context/ToastContext'
import { ThemeProvider } from './context/ThemeContext'
import { LanguageProvider } from './context/LanguageContext'
import { UndoProvider } from './context/UndoContext'
import { BrandingProvider } from './context/BrandingContext'
import { WorkspaceProvider } from './store/WorkspaceStore'
import { UIProvider } from './shell/UIContext'
import AppShell from './shell/AppShell'
import Login from './pages/Login'
import LandingPage from './pages/LandingPage'
import ProductionErrorBoundary from './components/ProductionErrorBoundary'
import SupportAccessBanner from './components/SupportAccessBanner'
import WhatsAppHandoffBar from './components/WhatsAppHandoffBar'

/* PERF (performance round): the whole app used to ship as ONE eager bundle —
   the admin dashboard, the 1,197-line parents' QR portal, onboarding,
   status pages, signup/reset flows were all parsed and executed on every
   load by every user, together with chart.js, html5-qrcode, jspdf, qrcode
   and html2canvas-pro. Login and the landing page stay eager (they are the
   anonymous entry points); everything else is code-split and streams in on
   demand over the existing branded boot splash. */
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const SubscriptionGate = lazy(() => import('./pages/SubscriptionGate'))
const PublicQRPage = lazy(() => import('./pages/PublicQRPage'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const PreviewDashboard = lazy(() => import('./pages/PreviewDashboard'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const AuthAction = lazy(() => import('./pages/AuthAction'))
const Signup = lazy(() => import('./pages/Signup'))

const PageFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-brand-bg text-fg-subtle text-sm">
    جاري التحميل...
  </div>
)

/**
 * Check if the current path is the public QR page.
 * No auth required for /qr/:token routes.
 */
function isPublicQRPath() {
  return /^\/qr\//.test(window.location.pathname)
}

function getAuthCallbackError() {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return null
  const params = new URLSearchParams(hash)
  const code = params.get('error_code') || params.get('error')
  if (!code) return null
  const normalized = `${code} ${params.get('error_description') || ''}`.toLowerCase()
  if (normalized.includes('otp_expired') || normalized.includes('access_denied') || normalized.includes('expired') || normalized.includes('invalid')) return 'expired'
  return 'network'
}

function getRequestedAuthView() {
  const requested = new URLSearchParams(window.location.search).get('auth')
  return requested === 'signup' ? 'signup' : 'login'
}

function isPreviewPath() {
  return new URLSearchParams(window.location.search).get('preview') === '1'
}

function getAuthActionPath() {
  const path = window.location.pathname
  return /^\/(auth\/(confirm|callback)|confirm|confirmation|email-confirmed)$/.test(path)
}

function getStatusPath() {
  const path = window.location.pathname
  if (path === '/404') return 404
  if (path === '/403' || path === '/unauthorized') return 403
  if (path === '/500') return 500
  if (path === '/network-error') return 'network'
  if (path === '/expired-link') return 'expired'
  return null
}

// /privacy — standalone public page (footer link on the landing page).
function isPrivacyPath() {
  return window.location.pathname === '/privacy'
}

function Gate() {
  const { session, profile, loading, isSubscriptionActive, passwordRecovery, supportSession } = useAuth()
  const [authView, setAuthView] = useState(getRequestedAuthView)
  const [adminView, setAdminView] = useState(false)
  const [onboardingDone, setOnboardingDone] = useState(false)

  // جلسة وصول دعم نشطة → نعرض لوحة المستخدم المستهدف (مش لوحة الأدمن)
  useEffect(() => { if (supportSession) setAdminView(false) }, [supportSession])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg text-fg-subtle text-sm">
        جاري التحميل...
      </div>
    )
  }

  if (isPrivacyPath()) return <Suspense fallback={<PageFallback />}><PrivacyPage /></Suspense>

  if (passwordRecovery) return <Suspense fallback={<PageFallback />}><ResetPassword /></Suspense>

  if (!session) {
    const authRequested = new URLSearchParams(window.location.search).get('auth')
    if (isPreviewPath()) return <Suspense fallback={<PageFallback />}><PreviewDashboard onBack={() => { window.location.assign('/') }} onLogin={() => { window.location.assign('/?auth=login') }} /></Suspense>
    if (!authRequested) return <LandingPage onLogin={() => { window.location.assign('/?auth=login') }} onSignup={() => { window.location.assign('/?auth=signup') }} onPreview={() => { window.location.assign('/?preview=1') }} />
    return authView === 'login'
      ? <Login onSwitchToSignup={() => { window.location.assign('/?auth=signup') }} />
      : <Suspense fallback={<PageFallback />}><Signup onSwitchToLogin={() => { window.location.assign('/?auth=login') }} /></Suspense>
  }

  // Onboarding: if the user is logged in but hasn't completed onboarding yet
  // (account_type is null or they're an assistant with no accepted request)
  // show the Onboarding page. The flag is stored in localStorage so it
  // survives page refreshes — cleared on logout.
  const needsOnboarding = session && !onboardingDone && profile && (
    !profile.account_type ||
    profile.account_type === '' ||
    (profile.account_type === 'assistant' && !localStorage.getItem('assistant_request_sent'))
  )

  if (session && !profile) {
    return <StatusPage
      code="network"
      onRetry={() => window.location.reload()}
      onHome={() => { window.location.href = '/?auth=login' }}
    />
  }

  if (needsOnboarding) {
    return <Suspense fallback={<PageFallback />}><Onboarding onComplete={() => {
      setOnboardingDone(true)
      // If assistant sent a request, mark it so we show "pending" instead of onboarding
      try { localStorage.setItem('assistant_request_sent', '1') } catch {}
      // Force a profile refresh so account_type is updated
      window.location.reload()
    }} /></Suspense>
  }

  if (profile?.is_admin && adminView && !supportSession) {
    return <Suspense fallback={<PageFallback />}><AdminDashboard onBack={() => setAdminView(false)} /></Suspense>
  }

  // أثناء جلسة وصول الدعم نسمح بعرض بيانات حساب منتهي/غير مفعّل للفحص
  if (!isSubscriptionActive && !profile?.is_admin && !supportSession) return <Suspense fallback={<PageFallback />}><SubscriptionGate /></Suspense>

  return (
    <LanguageProvider>
      <BrandingProvider>
        <SettingsProvider>
          <UndoProvider>
            <WorkspaceProvider>
              <UIProvider teacherId={profile?.id}>
                <div className="min-h-screen flex flex-col">
                  {supportSession && (
                    <SupportAccessBanner onExit={() => { setAdminView(true) }} />
                  )}
                  <AppShell onOpenAdmin={supportSession ? undefined : () => setAdminView(true)} />
                  {/* Guaranteed WhatsApp path on iPhone: a real <a> link bar shown
                      whenever a send is prepared (Round 4 iOS fix). */}
                  <WhatsAppHandoffBar />
                </div>
              </UIProvider>
            </WorkspaceProvider>
          </UndoProvider>
        </SettingsProvider>
      </BrandingProvider>
    </LanguageProvider>
  )
}

export default function App() {
  // Public QR page — no auth, no providers needed
  if (isPublicQRPath()) {
    return <ProductionErrorBoundary><Suspense fallback={<PageFallback />}><PublicQRPage /></Suspense></ProductionErrorBoundary>
  }
  if (getAuthActionPath()) {
    return <ProductionErrorBoundary><ThemeProvider><ToastProvider><AuthProvider><Suspense fallback={<PageFallback />}><AuthAction onDone={() => { window.location.replace('/?auth=login') }} /></Suspense></AuthProvider></ToastProvider></ThemeProvider></ProductionErrorBoundary>
  }
  const authCallbackError = getAuthCallbackError()
  if (authCallbackError) return <Suspense fallback={<PageFallback />}><StatusPage code={authCallbackError} onHome={() => { window.location.replace('/?auth=login') }} /></Suspense>
  const status = getStatusPath()
  if (status) return <Suspense fallback={<PageFallback />}><StatusPage code={status} /></Suspense>

  return (
    <ProductionErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ProductionErrorBoundary>
  )
}
