import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function ResetPassword() {
  const { setNewPassword, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('كلمة المرور لازم تكون 6 حروف/أرقام على الأقل.'); return }
    if (password !== confirm) { setError('كلمتا المرور مش متطابقتين.'); return }
    setLoading(true)
    const { error } = await setNewPassword(password)
    setLoading(false)
    if (error) setError('حصل خطأ، جرّب تاني أو اطلب رابط جديد.')
    else setDone(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
      <div className="w-full max-w-sm glass-card rounded-2xl p-8 shadow-2xl">
        <img src="/nokhba-mark.svg" alt="النخبة" className="w-16 h-16 mx-auto mb-2" />
        <h1 className="text-xl font-black text-center mb-1 text-fg font-black">تعيين كلمة مرور جديدة</h1>

        {done ? (
          <div className="mt-4 text-center">
            <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
              <div className="mb-1 text-lg font-black">تم تغيير كلمة المرور بنجاح</div>
              <p className="text-sm leading-7">أصبح حسابك جاهزًا للاستخدام من جديد.</p>
            </div>
            <button onClick={() => signOut()} className="w-full rounded-xl bg-slate-900 py-3 text-sm font-black text-white">العودة لتسجيل الدخول</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 mt-4">
            <div>
              <label className="block text-sm text-fg-subtle mb-1">كلمة المرور الجديدة</label>
              <input
                type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-fg-subtle mb-1">تأكيد كلمة المرور</label>
              <input
                type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm focus:border-brand-gold outline-none"
              />
            </div>
            {error && <p className="text-rose-400 text-xs">{error}</p>}
            <button
              type="submit" disabled={loading}
              className="w-full btn-glow disabled:opacity-50 font-bold py-3 rounded-xl transition-all text-sm"
            >
              {loading ? 'جاري الحفظ...' : 'حفظ كلمة المرور'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
