import { useCallback, useEffect, useState } from 'react'
import Modal from './Modal'
import { supabase } from '../lib/supabaseClient'
import { describeEdgeFunctionError } from '../lib/edgeFunctionErrors'

/**
 * ⚙️ إعدادات البريد (Task 44j) — الأدمن يلصق مفتاح Resend من لوحة الأدمن نفسها
 * بدل Supabase Dashboard/secrets. يُخزَّن في جدول admin_email_config (RLS
 * deny-all) عبر أكشن set_email_config في دالة admin-account-actions، والمفتاح
 * لا يُعاد كاملًا أبدًا للعميل — نسخة مقنّعة فقط. زر الإيميل التجريبي يتأكد
 * من الوصول لـ Resend قبل أول تجديد حقيقي.
 */
export default function EmailConfigModal({ open, onClose, showToast, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [from, setFrom] = useState('')
  const [testTo, setTestTo] = useState('')
  const [status, setStatus] = useState(null) // { configured, masked_key, from, source }
  const [lastResult, setLastResult] = useState(null) // { sent, error } | null

  const load = useCallback(async () => {
    setLoading(true)
    setLastResult(null)
    const { data, error } = await supabase.functions.invoke('admin-account-actions', { body: { action: 'get_email_config' } })
    if (error) {
      const e = await describeEdgeFunctionError(error, { functionName: 'admin-account-actions' })
      showToast?.(e.message || 'تعذر قراءة إعدادات البريد', 'error')
      setStatus(null)
    } else if (data?.error) {
      showToast?.(data.error, 'error')
    } else {
      setStatus(data)
      setFrom(data?.from || '')
    }
    setApiKey('')
    setLoading(false)
  }, [showToast])

  useEffect(() => { if (open) load() }, [open, load])

  const save = async () => {
    // كلا الحقلين يُرسل دائمًا: نص فارغ = مسح (يرجع للسلوك الافتراضي)،
    // فارغ ومعناها "بدون تغيير" غير ممكن من نفس النموذج — نوضح ذلك في الواجهة.
    if (!apiKey.trim() && status?.configured) {
      const ok = window.confirm('حقل المفتاح فاضي — هيتمسح المفتاح المحفوظ ويبقى الإرسال معطّلًا. متابعة؟')
      if (!ok) return
    }
    setSaving(true)
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-actions', {
        body: { action: 'set_email_config', resendApiKey: apiKey.trim(), from: from.trim() },
      })
      if (error) throw await describeEdgeFunctionError(error, { functionName: 'admin-account-actions' })
      if (data?.error) throw new Error(data.error)
      showToast?.('اتحفظت إعدادات البريد ✓', 'success')
      setApiKey('')
      await load()
      onSaved?.(data)
    } catch (err) {
      showToast?.(err.message || 'تعذر حفظ إعدادات البريد', 'error', 7000)
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    const to = testTo.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
      showToast?.('اكتب بريدًا صحيحًا للاختبار', 'error')
      return
    }
    setTesting(true)
    setLastResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-actions', {
        body: { action: 'send_test_email', to },
      })
      if (error) throw await describeEdgeFunctionError(error, { functionName: 'admin-account-actions' })
      if (data?.error) throw new Error(data.error)
      const r = data?.email || { sent: false, error: 'رد غير متوقع من الخدمة' }
      setLastResult(r)
      if (r.sent) showToast?.('الإيميل التجريبي اتبعت ✓ افحص صندوق الوارد', 'success')
      else showToast?.('فشل الإرسال — السبب ظاهر في النتيجة بالأسفل', 'error', 7000)
    } catch (err) {
      showToast?.(err.message || 'تعذر إرسال الإيميل التجريبي', 'error', 7000)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="⚙️ إعدادات إرسال الإيميل (Resend)">
      <div className="space-y-4">
        <div className="bg-surface-container border border-outline rounded-xl p-3 text-sm leading-relaxed text-fg">
          <p className="font-bold text-fg mb-1">ليه الإيميلات بتفشل؟</p>
          <p className="text-fg-muted text-xs">
            إيميلات التجديد بتتبعت عبر خدمة Resend — ولسه مفيش مفتاح محفوظ. الصق المفتاح هنا مرة واحدة
            وهتشتغل كل الإيميلات (التجديدات + إعادة الإرسال للرسايل الفاشلة) من غير أي Dashboard.
          </p>
          <ol className="text-xs text-fg-muted mt-2 space-y-1 list-decimal ps-4">
            <li>اعمل حساب مجاني في <span dir="ltr" className="font-bold">resend.com</span> → API Keys → Create API Key.</li>
            <li>انسخ المفتاح (بيبدأ بـ <span dir="ltr" className="font-mono">re_</span>) والصقه هنا.</li>
            <li>احفظ، ثم اضغط «إرسال إيميل تجريبي» للتأكد.</li>
          </ol>
          <p className="text-[11px] mt-2 text-[var(--warn-strong)] bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-lg px-2.5 py-1.5">
            ملاحظة: في وضع التجربة (قبل تفعيل نطاق في Resend) الإيميل يصل فقط لصاحب حساب Resend نفسه.
            للإرسال لكل المدرّسين أضف نطاقك في Resend → Domains وفعّل سجلات DNS، واكتب المُرسل بنطاقك (مثال بالأسفل).
          </p>
        </div>

        {loading ? (
          <p className="text-fg-muted text-sm text-center py-3">جاري قراءة الإعدادات...</p>
        ) : (
          <>
            <div className="bg-surface-container border border-outline rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between gap-3">
                <span className="text-fg-muted">الحالة</span>
                {status?.configured
                  ? <span className="font-bold text-[var(--ok-strong)]">مفتاح محفوظ ✓ ({status.masked_key})</span>
                  : <span className="font-bold text-[var(--warn-strong)]">لا يوجد مفتاح — الإيميلات هتفشل</span>}
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-fg-muted">مصدر المفتاح</span>
                <span className="font-bold text-fg">{status?.source === 'env' ? 'متغير بيئة السيرفر' : status?.source === 'db' ? 'محفوظ هنا (لوحة الأدمن)' : '—'}</span>
              </div>
            </div>

            <label className="block text-sm font-bold text-fg">
              مفتاح Resend API
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="re_..."
                dir="ltr"
                autoComplete="off"
                className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-brand-gold"
                disabled={saving || testing}
              />
              <span className="block text-[11px] font-normal text-fg-muted mt-1">
                {status?.configured ? 'اتركه فاضي للاحتفاظ بالمفتاح الحالي (أو امسحه واحفظ لإلغائه).' : 'الصق المفتاح كما هو من resend.com/api-keys.'}
              </span>
            </label>

            <label className="block text-sm font-bold text-fg">
              المُرسل (من) — اختياري
              <input
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder={'Alnokhba <noreply@yourdomain.com>'}
                dir="ltr"
                className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold"
                disabled={saving || testing}
              />
              <span className="block text-[11px] font-normal text-fg-muted mt-1">
                الافتراضي onboarding@resend.dev يعمل في وضع التجربة فقط — بعد تفعيل نطاقك اكتبه هنا.
              </span>
            </label>

            {lastResult && (
              <div className={`rounded-xl p-3 text-xs leading-relaxed border ${lastResult.sent ? 'bg-[var(--ok-bg)] border-[var(--ok-border)] text-[var(--ok-strong)]' : 'bg-[var(--warn-bg)] border-[var(--warn-border)] text-[var(--warn-strong)]'}`}>
                {lastResult.sent
                  ? '✓ الإيميل التجريبي اتبعت بنجاح — إعداداتك سليمة وإيميلات التجديد هتوص طبيعي.'
                  : `فشل الإرسال: ${lastResult.error || 'سبب غير معروف'}${/test mode|only send/i.test(lastResult.error || '') ? ' — وضع التجربة في Resend: فعّل نطاقك أو أرسل لنفس بريد حساب Resend أولًا.' : ''}`}
              </div>
            )}

            <div className="flex flex-wrap gap-2 items-center bg-surface-container border border-outline rounded-xl p-3">
              <input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="بريد لاستلام إيميل تجريبي"
                dir="ltr"
                className="flex-1 min-w-[200px] bg-surface-container-high border border-outline rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold"
                disabled={saving || testing}
              />
              <button
                onClick={sendTest}
                disabled={saving || testing}
                className="bg-[var(--info-bg)] text-[var(--info-strong)] border border-[var(--info-border)] font-bold px-4 py-2 rounded-lg text-sm disabled:opacity-60"
              >
                {testing ? '… جاري الإرسال' : '✉️ إرسال إيميل تجريبي'}
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="flex-1 bg-surface-container-high text-fg font-bold py-2.5 rounded-lg text-sm hover:bg-surface-container-highest disabled:opacity-50"
              >
                إغلاق
              </button>
              <button
                onClick={save}
                disabled={saving || testing}
                className="flex-1 bg-brand-gold hover:bg-brand-gold-hover text-brand-navy font-black py-2.5 rounded-lg text-sm disabled:opacity-60"
              >
                {saving ? '… جاري الحفظ' : '💾 حفظ الإعدادات'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
