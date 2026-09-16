import { useAuth } from '../context/AuthContext'

export default function SubscriptionGate() {
  const { profile, signOut } = useAuth()

  const expired = profile?.subscription_expires_at
    ? new Date(profile.subscription_expires_at).toLocaleDateString('ar-EG')
    : ''

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
      <div className="w-full max-w-md glass-card border-brand-gold/30 rounded-2xl p-8 shadow-2xl text-center">
        <img src="/nokhba-mark.svg" alt="النخبة" className="w-14 h-14 mx-auto mb-3" />
        <div className="text-4xl mb-3">⏳</div>
        <h2 className="text-xl font-black text-brand-gold-hover mb-2">انتهت فترة الاشتراك</h2>
        <p className="text-fg-subtle text-sm leading-relaxed mb-6">
          اشتراكك انتهى بتاريخ {expired}. جدّد اشتراكك عشان تكمل استخدام النظام وبياناتك هتفضل محفوظة زي ما هي.
        </p>

        {/* هنا مكان زرار/تعليمات الدفع الفعلي بعد ما تربط بوابة الدفع */}
        <div className="glass-input border border-subtle rounded-xl p-4 text-sm text-fg-subtle mb-6">
          للتجديد، تواصل معنا عبر واتساب وهنفعّل اشتراكك بمجرد تأكيد الدفع.
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
