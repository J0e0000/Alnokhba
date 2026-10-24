import { normalizeEgyptianPhone } from './helpers.js'

// ═══════════════════════════════════════════════════════════════════════════
// RENEWAL RECEIPT (وصل تجديد) — Task 44l.
// The admin no longer needs email delivery for renewal receipts: each renewal
// becomes a beautifully branded WhatsApp message (نخبة branding) carrying the
// renewal date, duration and new expiry, sent to the member's registered
// platform phone via the SAME wa.me handoff queue used for students
// (MessageQueueModal) — nothing sends without a tap, same as everywhere else.
// ═══════════════════════════════════════════════════════════════════════════

export const SITE_URL = 'https://al-nokhbba.vercel.app'

const fmtDay = (iso) => (iso
  ? new Date(iso).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  : null)

const fmtNum = (n) => Number(n).toLocaleString('ar-EG')

// Duration label — prefer the server-computed days_added; fall back to the
// previous→new span when the row predates that field.
function durationLabel({ daysAdded, previousExpiresAt, newExpiresAt }) {
  if (daysAdded != null && Number.isFinite(Number(daysAdded)) && Number(daysAdded) !== 0) {
    const d = Number(daysAdded)
    return `${fmtNum(Math.abs(d))} ${Math.abs(d) === 1 ? 'يوم' : 'يوم'}${d < 0 ? ' (تعديل للخلف)' : ''}`
  }
  if (previousExpiresAt && newExpiresAt) {
    const span = Math.round((new Date(newExpiresAt).getTime() - new Date(previousExpiresAt).getTime()) / 86400000)
    if (Number.isFinite(span) && span !== 0) return `${fmtNum(Math.abs(span))} يوم`
  }
  return null
}

// The branded receipt itself — WhatsApp-flavored markdown (*bold*), fully
// RTL, every line short enough not to wrap badly on phones.
export function buildRenewalReceiptMessage({ name, teamName, planName, renewedAt, previousExpiresAt, newExpiresAt, daysAdded }) {
  const lines = []
  lines.push('🏆 *أكاديمية النخبة التعليمية*')
  lines.push('🧾 *وصل تجديد اشتراك*')
  lines.push('━━━━━━━━━━━━━━━')
  if (name) lines.push(`👤 العضو: ${name}`)
  if (teamName) lines.push(`👥 الفريق: ${teamName}`)
  if (planName) lines.push(`📦 الباقة: ${planName}`)
  const renewedLabel = fmtDay(renewedAt || new Date().toISOString())
  if (renewedLabel) lines.push(`📅 تاريخ التجديد: ${renewedLabel}`)
  const duration = durationLabel({ daysAdded, previousExpiresAt, newExpiresAt })
  if (duration) lines.push(`⏳ مدة التجديد: ${duration}`)
  const prev = fmtDay(previousExpiresAt)
  if (prev) lines.push(`🗓️ كان ينتهي: ${prev}`)
  const next = fmtDay(newExpiresAt)
  if (next) lines.push(`✅ ينتهي الاشتراك: ${next}`)
  lines.push('━━━━━━━━━━━━━━━')
  lines.push(`🌐 المنصة: ${SITE_URL}`)
  lines.push('💙 شكرًا لانضمامك لنخبة المعلمين')
  return lines.filter(Boolean).join('\n')
}

// One queue item per member — the exact shape MessageQueueModal consumes
// (plain message item: no qrUrl → the per-item edit affordance works, letting
// the admin tweak a receipt before sending it).
// Accepts BOTH key styles: camelCase (renewals-log rows built client-side)
// and the edge action's snake_case (team-renewal result: previous_expires_at,
// days_added, new_expires_at) — no caller-side mapping needed.
export function buildRenewalQueueItem(m) {
  const previousExpiresAt = m.previousExpiresAt ?? m.previous_expires_at ?? null
  const newExpiresAt = m.newExpiresAt ?? m.new_expires_at ?? null
  const daysAdded = m.daysAdded ?? m.days_added ?? null
  const normalized = normalizeEgyptianPhone(m.phone)
  return {
    key: `renewal-${m.id}`,
    kind: 'renewal_receipt',
    student: null,
    name: m.name || 'عضو',
    phone: normalized,
    message: buildRenewalReceiptMessage({
      name: m.name, teamName: m.teamName, planName: m.planName,
      renewedAt: m.renewedAt, previousExpiresAt, newExpiresAt, daysAdded,
    }),
  }
}

// Filter + build for a batch of renewed members (team renewal result).
export function buildRenewalQueueItems(members, teamContext = {}) {
  return (members || [])
    .map((m) => buildRenewalQueueItem({ ...m, ...teamContext }))
    .filter((it) => it.phone && it.message)
}
