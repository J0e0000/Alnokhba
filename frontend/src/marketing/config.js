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
// Verified in src/pages/Signup.jsx: "حساب جديد — 7 أيام تجربة مجانية"
export const TRIAL_DAYS = 7
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
  } catch { /* tracking must never break the page */ }
}
