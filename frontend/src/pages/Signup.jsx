import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Signup({ onSwitchToLogin }) {
  const { signUp } = useAuth()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('كلمة المرور لازم تكون 6 حروف/أرقام على الأقل.')
      return
    }
    setLoading(true)
    const { error } = await signUp({ email, password, fullName, phone })
    setLoading(false)
    if (error) setError(error.message)
    else setDone(true)
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-8 shadow-2xl text-center">
          <h2 className="text-xl font-black text-emerald-600 mb-2">طلبك قيد المراجعة ⏳</h2>
          <p className="text-outline text-sm">
            تم استلام بياناتك بنجاح. حسابك الآن في انتظار موافقة الإدارة. سيتم تفعيل حسابك قريبًا، برجاء مراجعة بريدك الإلكتروني لتأكيده أولاً.
          </p>
          <button onClick={onSwitchToLogin} className="mt-6 text-brand-gold-hover hover:text-brand-gold-hover font-bold text-sm">
            الرجوع لتسجيل الدخول
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-8 shadow-2xl">
        <img src="/nokhba-mark.svg" alt="النخبة" className="w-16 h-16 mx-auto mb-2" />
        <h1 className="text-2xl font-black text-center mb-1 text-brand-navy font-black">
          النخبة
        </h1>
        <p className="text-outline text-sm text-center mb-6">حساب جديد — 7 أيام تجربة مجانية</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-on-surface-variant mb-1">الاسم الكامل</label>
            <input
              type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-on-surface-variant mb-1">رقم الهاتف (واتساب)</label>
            <input
              type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-on-surface-variant mb-1">البريد الإلكتروني</label>
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-on-surface-variant mb-1">كلمة المرور</label>
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
            />
          </div>

          {error && <p className="text-rose-600 text-xs">{error}</p>}

          <button
            type="submit" disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-all text-sm"
          >
            {loading ? 'جاري الإنشاء...' : 'إنشاء الحساب'}
          </button>
        </form>

        <p className="text-outline text-xs text-center mt-6">
          عندك حساب؟{' '}
          <button onClick={onSwitchToLogin} className="text-brand-gold-hover hover:text-brand-gold-hover font-bold">
            سجّل دخول
          </button>
        </p>
      </div>
    </div>
  )
}
