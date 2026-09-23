import { useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { WHATSAPP_URL, track } from '../marketing/config.js'

const DAY_MS = 24 * 60 * 60 * 1000

// SubscriptionExpiryBanner — تنبيه قرب انتهاء الاشتراك (owner request):
// when ≤3 days remain, a persistent warning banner shows under the app
// header BEFORE the SubscriptionGate pauses the account (the gate handles
// ≤0 — the banner handles the "still working, but ending soon" window so
// renewal happens without a cut in the daily flow).
//
// Contract notes:
//  • Same subscription-source rule as AuthContext.isSubscriptionActive:
//    an assistant sees the OWNER's subscription state (ownerProfile wins).
//  • Admins never see it — they bypass the subscription gate entirely.
//  • Status-aware honest copy: trial wording vs. active subscription, the
//    exact expiry date, and the same "paused, not deleted" reassurance the
//    gate uses. Renewal stays WhatsApp-based (no invented payment gateway).
export default function SubscriptionExpiryBanner() {
  const { profile, ownerProfile } = useAuth()
  const { isArabic } = useLanguage()

  const info = useMemo(() => {
    if (profile?.is_admin) return null
    const src = ownerProfile || profile // same rule as AuthContext
    if (!src?.is_verified) return null
    if (!['trial', 'active'].includes(src.subscription_status)) return null
    const exp = src.subscription_expires_at ? new Date(src.subscription_expires_at) : null
    if (!exp || Number.isNaN(exp.getTime())) return null
    const daysLeft = Math.ceil((exp.getTime() - Date.now()) / DAY_MS)
    if (daysLeft <= 0 || daysLeft > 3) return null // ≤0 → SubscriptionGate owns it
    return { daysLeft, isTrial: src.subscription_status === 'trial', dateStr: exp.toLocaleDateString(isArabic ? 'ar-EG' : 'en-GB') }
  }, [profile, ownerProfile, isArabic])

  if (!info) return null

  const when = isArabic
    ? info.daysLeft === 1 ? 'ينتهي خلال يوم واحد' : info.daysLeft === 2 ? 'ينتهي خلال يومين' : `ينتهي خلال ${info.daysLeft} أيام`
    : info.daysLeft === 1 ? 'ends in 1 day' : `ends in ${info.daysLeft} days`

  const subject = isArabic
    ? info.isTrial ? 'فترة التجربة' : 'اشتراكك'
    : info.isTrial ? 'Your trial' : 'Your subscription'

  return (
    <div
      className="mx-auto max-w-[1180px] px-4 pt-3"
      role="status"
      aria-live="polite"
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5"
        style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)' }}
      >
        <p className="m-0 text-[.78rem] leading-6" style={{ color: 'var(--warn-strong)' }}>
          ⏳ <b>{subject} {when}</b>
          {isArabic ? ' — بتاريخ ' : ' — on '}
          <b>{info.dateStr}</b>.
          {isArabic
            ? ' جدّد قبل الانتهاء عشان الحصص والتقارير والبوابة يفضلوا شغالين من غير توقف — وبياناتك محفوظة ومش بتتحذف.'
            : ' Renew before it ends to keep sessions, reports and the portal running — your data stays safe.'}
        </p>
        <a
          href={WHATSAPP_URL} target="_blank" rel="noreferrer"
          onClick={() => track('whatsapp_click', { source: 'expiry-banner' })}
          className="shrink-0 rounded-lg px-3 py-2 text-[.72rem] font-black transition hover:-translate-y-px"
          style={{ background: 'linear-gradient(to left, #FB9C1B, #E07F00)', color: '#1D0E03' }}
        >
          ◉ {isArabic ? 'جدّد عبر واتساب' : 'Renew via WhatsApp'}
        </a>
      </div>
    </div>
  )
}
