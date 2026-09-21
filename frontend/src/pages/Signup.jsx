import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { WHATSAPP_URL, track } from '../marketing/config.js'
import { TRIAL, fmtAr } from '../marketing/pricing.js'

// Trial facts rendered here come from the single pricing source of truth so
// the signup page can never drift from /pricing (14 days, no card, paused
// after the trial with 30-day retention — never "free forever").
const TRIAL_FEATURES = [
  ['الطلاب والمجموعات', 'بطاقة لكل طالب وملف كامل بملاحظاته ودرجاته'],
  ['مسار الحصة', 'حضور بلمسة، تفاعل، وواجب بأحواله — والحفظ تلقائي'],
  ['الامتحانات والدرجات', 'درجات بأقسامها وتوزيع تلقائي على الطلاب'],
  ['المصروفات والتسديدات', 'متابعة إيرادات كل مجموعة ومتأخرات كل طالب'],
  ['تقارير واتساب', 'تقرير جاهز لأولياء الأمور بمراجعة قبل الإرسال'],
  ['فريق التحليل الأسبوعي', 'ملخص أسبوعي يقولك أنهي مجموعة محتاجة تدخلك'],
]

export default function Signup({ onSwitchToLogin }) {
  const { signUp } = useAuth()
  const DAYS_AR = fmtAr(TRIAL.days) // ١٤ — Arabic-Indic, consistent with site copy
  const RETENTION_AR = fmtAr(TRIAL.retentionDays)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const pwOk = password.length >= 8

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    // SEC: 8-char minimum (aligned with admin set_password policy; GoTrue allows 6
    // but we hold the stricter client-side floor — server RLS remains the boundary).
    if (!pwOk) {
      setError('كلمة المرور لازم تكون 8 حروف/أرقام على الأقل.')
      return
    }
    setLoading(true)
    const { error } = await signUp({ email, password, fullName: fullName.trim(), phone: phone.trim() })
    setLoading(false)
    track('signup_submit', { ok: !error })
    if (error) setError(error.message)
    else setDone(true)
  }

  // ── Success state: honest next steps (email confirm → quick activation) ──
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
        <div className="w-full max-w-lg glass-card rounded-2xl p-8 shadow-2xl text-center">
          <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--ok-bg,var(--surface-container))] text-3xl font-black text-[var(--ok-strong,var(--fg))] ring-1 ring-[var(--surface-border)]" aria-hidden="true">✓</span>
          <h2 className="text-2xl font-black text-fg mb-2">تم إنشاء حسابك — خطوة واحدة وتبدأ</h2>
          <ol className="mx-auto mt-6 max-w-md space-y-3 text-right">
            <li className="rounded-xl border border-subtle bg-[var(--surface-container)] p-4">
              <p className="text-sm font-black text-fg">١. أكّد بريدك الإلكتروني</p>
              <p className="mt-1 text-sm leading-7 text-fg-muted">بعتنا لك رسالة تأكيد على <b dir="ltr" className="font-bold">{email}</b>. افتح الرابط — ده بيحمي حسابك وبيانات مركزك.</p>
            </li>
            <li className="rounded-xl border border-subtle bg-[var(--surface-container)] p-4">
              <p className="text-sm font-black text-fg">٢. تفعيل سريع</p>
              <p className="mt-1 text-sm leading-7 text-fg-muted">بعد تأكيد الإيميل بيتفعل حسابك سريعًا وتبدأ تجربتك {DAYS_AR} يوم بكل المميزات — من غير بطاقة دفع.</p>
            </li>
          </ol>
          <p className="mt-5 text-sm leading-7 text-fg-muted">
            عايز تفعيل أسرع أو مساعدة في الإعداد؟{' '}
            <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => track('whatsapp_click', { source: 'signup-success' })} className="font-black text-brand-gold-hover hover:text-brand-gold-hover underline decoration-[var(--brand-gold)]/40 underline-offset-4">ابعتلنا على واتساب</a>
          </p>
          <button onClick={onSwitchToLogin} className="mt-6 text-brand-gold-hover hover:text-brand-gold-hover font-bold text-sm">
            الرجوع لتسجيل الدخول
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-brand-bg p-4 py-8 sm:p-6" dir="rtl">
      {/* subtle brand ambience */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-[var(--brand-gold)] opacity-[0.07] blur-3xl" />
        <div className="absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-[var(--brand-navy-light)] opacity-[0.12] blur-3xl" />
      </div>

      <div className="relative w-full max-w-5xl glass-card overflow-hidden shadow-2xl">
        <div className="grid lg:grid-cols-2">
          {/* ── FORM (right side in RTL) ── */}
          <div className="order-1 p-6 sm:p-10">
            <a href="/" className="inline-flex items-center gap-1.5 text-xs font-bold text-fg-subtle transition hover:text-fg">
              <span aria-hidden="true">→</span> الرجوع للرئيسية
            </a>

            <div className="mt-6 flex items-center gap-3">
              <img src="/nokhba-mark.svg" alt="شعار النخبة" className="h-12 w-12" />
              <div>
                <h1 className="text-2xl font-black text-fg leading-tight">اعمل حسابك</h1>
                <p className="text-sm text-fg-subtle mt-0.5">{DAYS_AR} يوم تجربة كاملة — من غير بطاقة دفع</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate={false}>
              <div>
                <label htmlFor="su-name" className="mb-1.5 block text-sm font-bold text-on-surface-variant">الاسم الكامل</label>
                <input
                  id="su-name" type="text" required autoComplete="name" value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="مثال: أحمد محمد"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
                />
              </div>

              <div>
                <label htmlFor="su-phone" className="mb-1.5 block text-sm font-bold text-on-surface-variant">رقم الهاتف (واتساب)</label>
                <input
                  id="su-phone" type="tel" required autoComplete="tel" inputMode="tel" value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01xxxxxxxxx" dir="ltr" className="glass-input w-full rounded-xl px-3.5 py-2.5 text-right text-sm outline-none"
                />
                <p className="mt-1.5 text-xs text-fg-subtle">بنستخدمه للتواصل معاك ولتقارير أولياء الأمور.</p>
              </div>

              <div>
                <label htmlFor="su-email" className="mb-1.5 block text-sm font-bold text-on-surface-variant">البريد الإلكتروني</label>
                <input
                  id="su-email" type="email" required autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@center.com" dir="ltr" className="glass-input w-full rounded-xl px-3.5 py-2.5 text-right text-sm outline-none"
                />
              </div>

              <div>
                <label htmlFor="su-pw" className="mb-1.5 block text-sm font-bold text-on-surface-variant">كلمة المرور</label>
                <div className="relative">
                  <input
                    id="su-pw" type={showPw ? 'text' : 'password'} required minLength={8} autoComplete="new-password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="٨ حروف/أرقام على الأقل" dir="ltr"
                    aria-invalid={!pwOk && password.length > 0}
                    className="glass-input w-full rounded-xl px-3.5 py-2.5 pl-12 text-right text-sm outline-none"
                  />
                  <button
                    type="button" onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-black text-fg-subtle transition hover:text-fg"
                  >
                    {showPw ? 'إخفاء' : 'إظهار'}
                  </button>
                </div>
                {password.length > 0 && (
                  <p className={`mt-1.5 text-xs font-bold ${pwOk ? 'text-[var(--ok-strong,var(--fg))]' : 'text-fg-subtle'}`}>
                    {pwOk ? '✓ كلمة المرور تمام' : `فاضل ${8 - password.length} حروف على الأقل`}
                  </p>
                )}
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-[var(--danger-strong)]/25 bg-[var(--danger-bg)] px-4 py-3 text-xs font-bold leading-6 text-[var(--danger-strong)]">
                  {error}
                </p>
              )}

              <button
                type="submit" disabled={loading}
                className="btn-glow w-full rounded-xl py-3 font-black text-sm transition-all disabled:opacity-50"
              >
                {loading ? 'جاري إنشاء الحساب...' : 'ابدأ تجربتك المجانية'}
              </button>

              <p className="text-center text-xs leading-6 text-fg-subtle">
                بإنشاء الحساب أنت بتوافق على{' '}
                <a href="/privacy" className="font-bold text-brand-gold-hover hover:text-brand-gold-hover underline decoration-[var(--brand-gold)]/40 underline-offset-4">سياسة الخصوصية</a>.
                — مفيش بطاقة دفع، ومفيش تجديد تلقائي.
              </p>
            </form>

            <p className="mt-6 border-t border-subtle pt-5 text-center text-sm text-fg-muted">
              عندك حساب؟{' '}
              <button onClick={onSwitchToLogin} className="font-black text-brand-gold-hover hover:text-brand-gold-hover">
                سجّل دخول
              </button>
            </p>
          </div>

          {/* ── TRIAL VALUE PANEL (left side in RTL, below form on mobile) ── */}
          {/* NOTE: index.css has an unlayered `aside, header, main { color: var(--fg) }`
              rule that beats layered Tailwind utilities — hence the inline color. */}
          <aside className="order-2 relative bg-brand-navy p-6 sm:p-10" style={{ color: '#ffffff' }}>
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40" style={{ background: 'radial-gradient(600px 300px at 80% 0%, rgba(227,176,75,0.14), transparent 60%)' }} />
            <div className="relative">
              <span className="inline-block rounded-full border border-[#FB9C1B]/40 bg-[#FB9C1B]/10 px-3.5 py-1.5 text-xs font-black text-[#FBBF6D]">
                تجربة مجانية {DAYS_AR} يوم — بدون بطاقة
              </span>
              <h2 className="mt-5 text-2xl font-black leading-snug">
                كل اللي مركزك محتاجه — من أول يوم.
              </h2>
              <p className="mt-2 text-sm leading-7 text-slate-300">
                حسابك بيفتح على المنصة كاملة: تجرب بشغلك الحقيقي، وتقرر بنفسك قبل أي دفع.
              </p>

              <ul className="mt-7 space-y-4">
                {TRIAL_FEATURES.map(([t, d]) => (
                  <li key={t} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#FB9C1B]/15 text-xs font-black text-[#FBBF6D] ring-1 ring-[#FB9C1B]/30" aria-hidden="true">✓</span>
                    <div>
                      <p className="text-sm font-black leading-6">{t}</p>
                      <p className="text-xs leading-6 text-slate-300/85">{d}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-8 rounded-2xl border border-white/12 bg-white/[0.06] p-5">
                <p className="text-sm font-black text-[#FBBF6D]">بعد الـ{DAYS_AR} يوم؟</p>
                <p className="mt-1.5 text-xs leading-6 text-slate-300">
                  الحساب بيتوقف مؤقتًا — مش حذف. بياناتك تفضل محفوظة {RETENTION_AR} يوم،
                  ولو كملت باقة تبدأ من ٣٩٩ جنيه/شهر وبتتفعل على واتساب. مفيش تجديد تلقائي.
                </p>
              </div>

              <a
                href={WHATSAPP_URL} target="_blank" rel="noreferrer"
                onClick={() => track('whatsapp_click', { source: 'signup-side' })}
                className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#25D366]/35 bg-[#25D366]/10 px-5 text-sm font-black text-[#4be08a] transition hover:bg-[#25D366]/20"
              >
                <span aria-hidden="true">◉</span> محتاج مساعدة في الإعداد؟ كلمنا
              </a>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
