import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

export default function AuthAction({ onDone }) {
  const { session } = useAuth()
  const [status, setStatus] = useState('processing') // processing | success | error
  const [message, setMessage] = useState('جاري التحقق من الرابط...')
  const [type, setType] = useState('')

  useEffect(() => {
    // استخراج نوع العملية من الرابط (Supabase يضعها في الـ hash أو الـ query)
    const hash = window.location.hash
    const params = new URLSearchParams(hash.replace('#', '?'))
    const errorDescription = params.get('error_description')
    const actionType = params.get('type')
    
    setType(actionType || '')

    if (errorDescription) {
      setStatus('error')
      setMessage(`خطأ: ${errorDescription}`)
      return
    }

    // إذا كان النوع استرجاع كلمة مرور، الـ AuthContext سيتولى الأمر عبر PASSWORD_RECOVERY
    if (actionType === 'recovery') {
      setStatus('success')
      setMessage('تم التحقق بنجاح. يمكنك الآن تعيين كلمة مرور جديدة.')
      return
    }

    // التحقق من البريد الإلكتروني (Signup)
    if (actionType === 'signup' || actionType === 'email_verification') {
      setStatus('success')
      setMessage('تم تأكيد بريدك الإلكتروني بنجاح! يمكنك الآن تسجيل الدخول.')
      return
    }

    // إذا وصلنا هنا ولم يكن هناك خطأ، نعتبره نجاحاً عاماً أو جاري المعالجة
    const timer = setTimeout(() => {
      if (status === 'processing') {
        setStatus('success')
        setMessage('تمت العملية بنجاح.')
      }
    }, 2000)

    return () => clearTimeout(timer)
  }, [status])

  const goHome = () => {
    if (onDone) { onDone(); return }
    window.location.href = window.location.origin
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-2xl text-center">
        <div className="mb-6">
          <img src="/nokhba-mark.svg" alt="النخبة" className="w-20 h-20 mx-auto" />
        </div>

        {status === 'processing' && (
          <div className="space-y-4">
            <div className="w-12 h-12 border-4 border-brand-gold border-t-transparent rounded-full animate-spin mx-auto"></div>
            <h2 className="text-xl font-bold text-brand-navy">{message}</h2>
            <p className="text-outline text-sm">برجاء الانتظار لحظة...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl">
              ✓
            </div>
            <h2 className="text-2xl font-black text-brand-navy">تمت العملية بنجاح</h2>
            <p className="text-outline font-medium">{message}</p>
            <button
              onClick={goHome}
              className="w-full bg-brand-navy text-white font-bold py-3 rounded-xl hover:bg-brand-navy-light transition-colors mt-4"
            >
              الذهاب للرئيسية
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto text-3xl">
              ✕
            </div>
            <h2 className="text-2xl font-black text-brand-navy">عذراً، حدث خطأ</h2>
            <p className="text-rose-600 font-medium">{message}</p>
            <p className="text-outline text-sm">قد يكون الرابط قديم أو تم استخدامه مسبقاً.</p>
            <button
              onClick={goHome}
              className="w-full bg-slate-100 text-slate-700 font-bold py-3 rounded-xl hover:bg-slate-200 transition-colors mt-4"
            >
              العودة للرئيسية
            </button>
          </div>
        )}
        
        <div className="mt-8 pt-6 border-t border-slate-100">
          <p className="text-on-surface-variant text-xs">
            نظام النخبة لإدارة الحلقات التعليمية
          </p>
        </div>
      </div>
    </div>
  )
}
