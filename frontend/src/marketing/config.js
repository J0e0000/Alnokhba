// ═══════════════════════════════════════════════════════════════════════════
// MARKETING CONFIG — single source of truth for public-site facts.
// EVERY claim here must be verifiable in the product. No invented metrics,
// customers, reviews, or pricing numbers.
// ═══════════════════════════════════════════════════════════════════════════

export const SITE_URL = 'https://al-nokhbba.vercel.app'
export const SITE_NAME = 'النخبة'
export const WA_NUMBER = '201014996636'
export const WA_TEXT = encodeURIComponent('مرحبًا، أريد معرفة المزيد عن منصة النخبة')
export const WHATSAPP_URL = `https://wa.me/${WA_NUMBER}?text=${WA_TEXT}`
// Trial model (owner-approved): 14 days, full core product, no card. After the
// trial the account is paused (not deleted) — data is preserved indefinitely;
// renewal restores everything. Mirrors src/marketing/pricing.js TRIAL.
export const TRIAL_DAYS = 14
// Verified: signup needs email + password + name only — no card, no auto-billing.
// Verified: renewal/activation happens over WhatsApp after payment confirmation
// (see SubscriptionGate copy) — there is no self-serve payment gateway yet.

export const NAV = [
  { label: 'الرئيسية', href: '/' },
  { label: 'المميزات', href: '/features' },
  { label: 'الحلول', href: '/solutions' },
  { label: 'الأسعار', href: '/pricing' },
  { label: 'المصادر', href: '/resources' },
  { label: 'من نحن', href: '/about' },
  { label: 'تواصل', href: '/contact' },
]

// Real product screenshots captured from the running app (demo data).
export const SCREENS = {
  dashboard: { src: '/screens/home-dashboard.png', w: 1440, h: 900 },
  session: { src: '/screens/session-workspace.png', w: 1440, h: 900 },
  students: { src: '/screens/students.png', w: 1440, h: 900 },
  reports: { src: '/screens/reports.png', w: 1440, h: 900 },
  insights: { src: '/screens/insights.png', w: 1440, h: 900 },
  mobile: { src: '/screens/mobile-attendance.png', w: 390, h: 844 },
}

// Analytics events (Phase 14) — first-party only (CSP allows no third-party
// script origins). Every event also lands in window.dataLayer so a tag
// manager can be adopted later without touching component code again.
export function track(event, params = {}) {
  try {
    const payload = { event, ...params, ts: Date.now() }
    window.dataLayer = window.dataLayer || []
    window.dataLayer.push(payload)
    const log = JSON.parse(localStorage.getItem('nokhba_mkt_events') || '[]')
    log.push(payload)
    if (log.length > 400) log.splice(0, log.length - 400)
    localStorage.setItem('nokhba_mkt_events', JSON.stringify(log))
    // PostHog bridge (audit 2026-10): conversion-funnel events (trial_cta_click,
    // signup_submit, whatsapp_click, pricing_plan_selected…) used to live ONLY
    // in dataLayer/localStorage — invisible to product analytics. Forward to
    // the app's PostHog client when it is loaded; queue a small backlog until
    // lib/posthog.initPostHog drains it. Never throws.
    if (window.__nkPosthog) {
      window.__nkPosthog.capture(event, params)
    } else {
      window.__nkQueue = window.__nkQueue || []
      if (window.__nkQueue.length < 200) window.__nkQueue.push(payload)
    }
  } catch { /* tracking must never break the page */ }
}
