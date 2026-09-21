import { useAuth } from '../context/AuthContext'
import { WHATSAPP_URL, track } from '../marketing/config.js'
import { TRIAL, fmtAr } from '../marketing/pricing.js'

// Expired-trial/subscription screen. Honest model: the account is PAUSED,
// not deleted — data stays for TRIAL.retentionDays, renewal restores
// everything as it was. Renewal happens over WhatsApp (no payment gateway).
export default function SubscriptionGate() {
  const { profile, signOut } = useAuth()

  const expired = profile?.subscription_expires_at
    ? new Date(profile.subscription_expires_at).toLocaleDateString('ar-EG')
    : ''

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
      <div className="w-full max-w-md glass-card border-brand-gold/30 rounded-2xl p-8 shadow-2xl text-center">
        <img src="/nokhba-mark.svg" alt="النخبة" className="w-14 h-14 mx-auto mb-3" />
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--warn-bg,var(--surface-container))] text-2xl font-black text-[var(--warn-strong,var(--fg))] ring-1 ring-[var(--surface-border)]" aria-hidden="true">⏸</span>
        <h2 className="text-xl font-black text-brand-gold-hover mb-2">الحساب متوقف مؤقتًا</h2>
        <p className="text-fg-subtle text-sm leading-relaxed mb-6">
          فترة اشتراكك انتهت بتاريخ {expired}. الحساب متوقف مؤقتًا — <b className="font-bold text-fg">مش حذف</b>:
          بيانات مركزك كلها محفوظة {fmtAr(TRIAL.retentionDays)} يوم زي ما هي، وأول ما تفعّل تاني بترجع تشتغل من نفس المكان بالظبط.
        </p>

        <a
          href={WHATSAPP_URL} target="_blank" rel="noreferrer"
          onClick={() => track('whatsapp_click', { source: 'subscription-gate' })}
          className="mb-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#e3b04b] to-[#c98f2e] px-5 text-sm font-black text-[#1a1205] shadow-lg shadow-amber-500/20 transition hover:-translate-y-0.5"
        >
          <span aria-hidden="true">◉</span> جدّد عبر واتساب — التفعيل فور التأكيد
        </a>

        <div className="glass-input rounded-xl p-4 text-xs leading-6 text-fg-subtle mb-6">
          كلمنا على واتساب واختار الباقة المناسبة لمركزك — مفيش تجديد تلقائي ولا خصم صامت،
          والتفعيل بيتم بمجرد تأكيدك.
        </div>

        <button
          onClick={signOut}
          className="text-fg-subtle hover:text-fg text-xs underline"
        >
          تسجيل الخروج
        </button>
      </div>
    </div>
  )
}
