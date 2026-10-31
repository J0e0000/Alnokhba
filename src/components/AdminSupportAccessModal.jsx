import { useState } from 'react'
import Modal from './Modal'
import { supabase } from '../lib/supabaseClient'

/**
 * نافذة تأكيد "وصول الدعم" (Support Access) من لوحة الأدمن.
 * مطلوب سبب إلزامي قبل الدخول، وكل شيء مسجّل في سجل التدقيق من الخادم.
 * الحسابات الأدمن محظورة (server-side + client-side) لتفادي صلاحيات متشابكة.
 */
export default function AdminSupportAccessModal({ open, teacher, onClose, onStarted, showToast }) {
  const [reason, setReason] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const start = async () => {
    const trimmed = reason.trim()
    if (trimmed.length < 4) {
      setError('اكتب سبب الوصول (مثال: فحص مشكلة في تقرير الحضور)')
      return
    }
    setStarting(true)
    setError('')
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_start_support_session', {
        p_target_user_id: teacher.id,
        p_reason: trimmed,
        p_minutes: 30,
      })
      if (rpcError) throw new Error(rpcError.message)
      showToast?.('اتفتحت جلسة وصول دعم لمدة 30 دقيقة — كل الإجراءات مسجّلة', 'success')
      setReason('')
      onStarted?.(data)
      onClose?.()
    } catch (err) {
      setError(err.message || 'تعذر فتح جلسة وصول الدعم')
    } finally {
      setStarting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="🛠️ وصول الدعم لحساب مستخدم">
      <div className="space-y-4">
        <div className="bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-xl p-3 text-sm text-[var(--warn-strong)] leading-relaxed">
          أنت على وشك <span className="font-black">فتح حساب المستخدم مؤقتًا لمدة 30 دقيقة</span> لغرض الدعم الفني.
          هتشوف بياناته وتقدر تصلّح مشاكله — وكل عملية تُسجَّل في سجل التدقيق باسمك.
          <span className="block mt-1 font-bold">مش هتقدر تغيّر كلمة مروره أو صلاحيات الأدمن من هنا.</span>
        </div>

        <div className="bg-surface-container border border-outline rounded-xl p-3 text-sm space-y-1">
          <div className="flex justify-between gap-3"><span className="text-fg-muted">المستخدم</span><span className="font-bold text-fg">{teacher?.full_name || '—'}</span></div>
          <div className="flex justify-between gap-3"><span className="text-fg-muted">البريد</span><span className="font-bold text-fg truncate" dir="ltr">{teacher?.email || '—'}</span></div>
          <div className="flex justify-between gap-3"><span className="text-fg-muted">الدور</span><span className="font-bold text-fg">{teacher?.is_admin ? 'أدمن (محظور)' : teacher?.account_type === 'assistant' ? 'مساعد' : 'مدرّس'}</span></div>
        </div>

        <div>
          <label className="block text-sm font-bold text-fg mb-1.5">سبب الوصول <span className="text-[var(--danger-strong)]">*</span></label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError('') }}
            placeholder="مثال: فحص مشكلة في تقرير الحضور"
            className="w-full bg-surface-container border border-outline rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold"
            disabled={starting}
          />
        </div>

        {error && <p className="text-[var(--danger-strong)] text-sm font-bold bg-[var(--danger-bg)] border border-[var(--danger-border)] rounded-lg p-2">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={starting}
            className="flex-1 bg-surface-container-high text-fg font-bold py-2.5 rounded-lg text-sm hover:bg-surface-container-highest disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            onClick={start}
            disabled={starting || teacher?.is_admin}
            className="flex-1 bg-brand-gold hover:bg-brand-gold-hover disabled:opacity-50 text-brand-navy font-black py-2.5 rounded-lg text-sm"
          >
            {starting ? 'جاري الفتح...' : 'متابعة — افتح الحساب مؤقتًا'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
