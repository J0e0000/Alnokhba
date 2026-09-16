import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

export default function Login({ onSwitchToSignup }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [forgotMode, setForgotMode] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  // حماية إضافية بسيطة من جهة العميل ضد محاولات الدخول المتكررة —
  // الحماية الحقيقية والمُلزمة موجودة أصلاً على مستوى سيرفر Supabase Auth
  const MAX_ATTEMPTS = 5
  const COOLDOWN_S = 60
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [cooldown, setCooldown] = useState(0)

  const startCooldown = () => {
    setCooldown(COOLDOWN_S)
    const t = setInterval(() => {
      setCooldown((c) => { if (c <= 1) { clearInterval(t); return 0 } return c - 1 })
    }, 1000)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (cooldown > 0) return
    setError('')
    setLoading(true)
    const { error } = await signIn({ email, password })
    setLoading(false)
    if (error) {
      const next = failedAttempts + 1
      setFailedAttempts(next)
      if (next >= MAX_ATTEMPTS) {
        setError(`محاولات كتير غلط. استنى ${COOLDOWN_S} ثانية قبل ما تجرب تاني.`)
        setFailedAttempts(0)
        startCooldown()
      } else {
        setError('البريد الإلكتروني أو كلمة المرور غير صحيحة.')
      }
    } else {
      setFailedAttempts(0)
    }
  }

  const handleForgotSubmit = async (e) => {
    e.preventDefault()
    setForgotError('')
    setForgotLoading(true)
    const redirectTo = `${window.location.origin}/?auth=recovery`
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), { redirectTo })
    setForgotLoading(false)
    if (resetError) {
      setForgotError('تعذر إرسال رابط الاسترجاع الآن. راجع البريد الإلكتروني وحاول مرة أخرى.')
      return
    }
    setForgotSent(true)
  }

  if (forgotMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
        <div className="w-full max-w-sm glass-card rounded-2xl p-8 shadow-2xl">
          <img src="/nokhba-mark.svg" alt="النخبة" className="w-16 h-16 mx-auto mb-2" />
          <h1 className="text-xl font-black text-center mb-1 text-fg font-black">استرجاع كلمة المرور</h1>

          {forgotSent ? (
            <div className="text-center mt-4">
              <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-right">
                <p className="text-emerald-800 text-sm leading-7">تم إرسال التعليمات إلى بريدك الإلكتروني. افتح الرابط لإكمال تغيير كلمة المرور، ثم ارجع إلى صفحة الدخول.</p>
              </div>
              <button onClick={() => { setForgotMode(false); setForgotSent(false) }} className="text-brand-gold-hover hover:text-brand-gold-hover text-sm font-bold">
                الرجوع لتسجيل الدخول
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotSubmit} className="space-y-4 mt-4">
              <div>
                <label className="block text-sm text-fg-subtle mb-1">البريد الإلكتروني المسجّل</label>
                <input
                  type="email" required value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
                />
              </div>
              {forgotError && <p role="alert" className="text-rose-700 text-xs leading-6">{forgotError}</p>}
              <button
                type="submit" disabled={forgotLoading}
                className="w-full btn-glow disabled:opacity-50 font-bold py-3 rounded-xl transition-all text-sm"
              >
                {forgotLoading ? 'جاري الإرسال...' : 'إرسال رابط الاسترجاع'}
              </button>
              <button type="button" onClick={() => setForgotMode(false)} className="w-full text-fg-subtle hover:text-fg-subtle text-xs">
                إلغاء
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
      <div className="w-full max-w-sm glass-card rounded-2xl p-8 shadow-2xl">
        <img src="/nokhba-mark.svg" alt="النخبة" className="w-16 h-16 mx-auto mb-2" />
        <h1 className="text-2xl font-black text-center mb-1 text-fg font-black">
          النخبة
        </h1>
        <p className="text-fg-subtle text-sm text-center mb-6">تسجيل الدخول لحسابك</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-fg-subtle mb-1">البريد الإلكتروني</label>
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm text-fg-subtle">كلمة المرور</label>
              <button type="button" onClick={() => { setForgotMode(true); setForgotEmail(email) }} className="text-brand-gold-hover hover:text-brand-gold-hover text-xs">
                نسيت كلمة السر؟
              </button>
            </div>
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
            />
          </div>

          {error && <p className="text-rose-400 text-xs">{error}</p>}

          <button
            type="submit" disabled={loading || cooldown > 0}
            className="w-full btn-glow disabled:opacity-50 font-bold py-3 rounded-xl transition-all text-sm"
          >
            {cooldown > 0 ? `استنى ${cooldown} ثانية` : loading ? 'جاري الدخول...' : 'دخول'}
          </button>
        </form>

        <p className="text-fg-subtle text-xs text-center mt-6">
          مفيش حساب؟{' '}
          <button onClick={onSwitchToSignup} className="text-brand-gold-hover hover:text-brand-gold-hover font-bold">
            اعمل حساب جديد
          </button>
        </p>
      </div>
    </div>
  )
}
