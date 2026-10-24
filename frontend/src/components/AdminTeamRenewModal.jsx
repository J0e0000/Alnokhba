import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { supabase } from '../lib/supabaseClient'
import { describeEdgeFunctionError } from '../lib/edgeFunctionErrors'

const STATUS_LABEL = { trial: 'تجربة', active: 'فعّال', expired: 'منتهي', cancelled: 'ملغي' }

/**
 * 🔄 تجديد اشتراك فريق كامل دفعة واحدة (Task 44j).
 * وضعان: تاريخ انتهاء موحّد لكل الأعضاء («اشتراكه هيخلص يوم ١/١٠ يبقى كل
 * التيم نفس الكلام»)، أو تمديد بالأيام يُحسب لكل عضو من أقصى(الآن، انتهاؤه
 * الحالي) — نفس قاعدة التجديد الفردي. الحفظ أولًا على السيرفر → صف سجل دائم
 * لكل عضو في subscription_renewals → إيميل جماعي فشله لا يلمس الاشتراكات.
 */
export default function AdminTeamRenewModal({ open, team, members, onClose, showToast, onRenewed }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState('date')
  const [deadlineDate, setDeadlineDate] = useState('')
  const [extendDays, setExtendDays] = useState(30)
  const [planName, setPlanName] = useState('')
  const [sendEmail, setSendEmail] = useState(true)
  const [rows, setRows] = useState([]) // [{ id, full_name, email, subscription_status, subscription_expires_at }]
  const [result, setResult] = useState(null)

  const loadMembers = async () => {
    setLoading(true)
    setResult(null)
    const ids = (members || []).map((m) => m.profile_id).filter(Boolean)
    if (!ids.length) { setRows([]); setLoading(false); return }
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, subscription_status, subscription_expires_at')
      .in('id', ids)
    const byId = new Map((data ?? []).map((p) => [p.id, p]))
    setRows((members || []).map((m) => byId.get(m.profile_id) || { id: m.profile_id, full_name: m.full_name, email: m.email }))
    setLoading(false)
  }

  useEffect(() => { if (open && team) {
    setMode('date')
    const d = new Date(Date.now() + 30 * 86400000)
    setDeadlineDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    setExtendDays(30)
    setPlanName('')
    setSendEmail(true)
    loadMembers()
  } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, team?.id])

  const computed = useMemo(() => {
    if (mode === 'date') {
      if (!deadlineDate) return null
      const [y, m, d] = deadlineDate.split('-').map(Number)
      if (!y || !m || !d) return null
      return new Date(y, m - 1, d, 23, 59, 59)
    }
    const days = Number(extendDays)
    if (!days || days <= 0) return null
    return days
  }, [mode, deadlineDate, extendDays])

  const submit = async () => {
    if (saving) return
    const body = { action: 'renew_team_subscription', teamId: team.id, sendEmail, planName: planName.trim() || undefined }
    if (mode === 'date') {
      if (!computed) { showToast?.('اختار تاريخ انتهاء أولًا', 'error'); return }
      body.newExpiresAt = computed.toISOString()
    } else {
      if (!computed) { showToast?.('اكتب عدد أيام صحيح', 'error'); return }
      body.days = computed
    }
    setSaving(true)
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-actions', { body })
      if (error) throw await describeEdgeFunctionError(error, { functionName: 'admin-account-actions' })
      if (data?.error) throw new Error(data.error)
      setResult(data)
      showToast?.(data?.summary || `اتجدد اشتراك ${data?.renewed?.length ?? 0} عضو`, data?.failures?.length ? 'error' : 'success', 7000)
      onRenewed?.(data)
      await loadMembers()
    } catch (err) {
      showToast?.(err.message || 'تعذر تجديد اشتراك الفريق', 'error', 8000)
    } finally {
      setSaving(false)
    }
  }

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—')

  return (
    <Modal open={open} onClose={saving ? undefined : onClose} title={`🔄 تجديد اشتراك الفريق — ${team?.name || ''}`} wide>
      <div className="space-y-4">
        {loading ? (
          <p className="text-fg-muted text-sm text-center py-4">جاري تحميل أعضاء الفريق...</p>
        ) : rows.length === 0 ? (
          <p className="text-fg-muted text-sm text-center py-4">الفريق لا يحتوي أعضاء — أضف أعضاء أولًا ثم جرب مرة أخرى.</p>
        ) : (
          <>
            {result && (
              <div className="bg-surface-container border border-outline rounded-xl p-3 text-xs space-y-1.5">
                <p className="font-bold text-fg">{result.summary || 'نتيجة التجديد'}</p>
                <p className="text-fg-muted">
                  ✓ اتجدد: <b className="text-[var(--ok-strong)]">{result.renewed?.length ?? 0}</b>
                  {result.failures?.length > 0 && <> · ⚠️ فشل: <b className="text-[var(--warn-strong)]">{result.failures.length}</b></>}
                  {result.email && <> · الإيميلات: <b>{result.email.sent}</b> وصل / <b>{result.email.failed?.length ?? 0}</b> فشل</>}
                </p>
                {result.failures?.map((f) => (
                  <p key={f.id} className="text-[var(--warn-strong)]">⚠️ {f.name}: {f.error}</p>
                ))}
                {result.email?.failed?.map((f, i) => (
                  <p key={i} className="text-[var(--warn-strong)]">✉️ {f.name}: {f.error}</p>
                ))}
              </div>
            )}

            {/* الأعضاء وحالتهم الحالية */}
            <div className="border border-outline rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-container text-fg-muted border-b border-outline">
                    <th className="text-right px-3 py-2 font-bold">العضو</th>
                    <th className="text-right px-3 py-2 font-bold">الحالة الآن</th>
                    <th className="text-right px-3 py-2 font-bold">ينتهي حاليًا</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b border-outline last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-bold text-fg">{p.full_name || 'بدون اسم'}</p>
                        <p className="text-fg-muted text-[10px] truncate" dir="ltr">{p.email || '—'}</p>
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{STATUS_LABEL[p.subscription_status] || p.subscription_status || '—'}</td>
                      <td className="px-3 py-2 text-fg">{fmtDate(p.subscription_expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* نمط التجديد */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-bold text-fg">نمط التجديد</p>
              <div className="flex bg-surface-container rounded-lg p-0.5 gap-0.5 text-xs font-bold">
                <button type="button" onClick={() => setMode('date')} className={`px-3 py-1.5 rounded-md transition ${mode === 'date' ? 'bg-brand-gold text-brand-navy' : 'text-fg-muted'}`}>تاريخ موحّد للجميع</button>
                <button type="button" onClick={() => setMode('days')} className={`px-3 py-1.5 rounded-md transition ${mode === 'days' ? 'bg-brand-gold text-brand-navy' : 'text-fg-muted'}`}>تمديد بالأيام</button>
              </div>
            </div>

            {mode === 'date' ? (
              <label className="block text-sm font-bold text-fg">
                تاريخ الانتهاء الجديد (لكل الأعضاء)
                <input type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} dir="ltr"
                  className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold" />
              </label>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-sm font-bold text-fg flex items-center gap-2">
                  عدد الأيام
                  <input type="number" min={1} value={extendDays} onChange={(e) => setExtendDays(e.target.value)} dir="ltr"
                    className="w-20 bg-surface-container border border-outline rounded-lg px-2 py-1.5 text-sm text-center outline-none focus:border-brand-gold" />
                </label>
                <div className="flex gap-1">
                  {[7, 30, 90, 180, 365].map((n) => (
                    <button key={n} type="button" onClick={() => setExtendDays(n)} className={`text-[11px] font-bold px-2 py-1 rounded-lg border transition ${Number(extendDays) === n ? 'bg-brand-gold/15 text-brand-gold-hover border-brand-gold/40' : 'border-outline text-fg-muted'}`}>+{n}</button>
                  ))}
                </div>
                <p className="text-[11px] text-fg-muted w-full">كل عضو هياخد +{Number(extendDays) || 0} يوم من تاريخ انتهائه الحالي (أو من النهاردة لو اشتراكه خلص خلاص).</p>
              </div>
            )}

            {mode === 'date' && computed instanceof Date && (
              <p className="text-xs text-fg-muted">
                النتيجة: اشتراك <b className="text-fg">{rows.length}</b> عضو هيبقى فعال حتى{' '}
                <b className="text-fg">{computed.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</b>
                {computed.getTime() <= Date.now() && <span className="text-[var(--danger-strong)] font-bold"> — تاريخ سابق (هيتسجل كمنتهي)</span>}
              </p>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-sm font-bold text-fg">
                اسم الباقة (اختياري)
                <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="مثال: باقة الترم الدراسي"
                  className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold" />
              </label>
              <label className="flex items-end gap-2 text-sm font-bold text-fg pb-1">
                <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)}
                  className="w-4 h-4 accent-[var(--brand-gold,#D4AF37)]" disabled={saving} />
                إرسال إيميل تجديد لكل الأعضاء
                <span className="text-[10px] font-normal text-fg-muted">(يحتاج ⚙️ إعدادات البريد مضبوطة)</span>
              </label>
            </div>

            <p className="text-[11px] text-fg-muted bg-surface-container border border-outline rounded-lg px-3 py-2">
              كل عضو هياخد صف تجديد خاص به في «سجل التجديدات» (تاريخه السابق → الجديد)، وفشل إيميل أي عضو
              <span className="font-bold"> لا يلغي تجديده</span> — يظهر زر إعادة إرسال بجانبه كالعادة.
            </p>

            <div className="flex gap-2">
              <button onClick={onClose} disabled={saving}
                className="flex-1 bg-surface-container-high text-fg font-bold py-2.5 rounded-lg text-sm hover:bg-surface-container-highest disabled:opacity-50">
                {result ? 'إغلاق' : 'إلغاء'}
              </button>
              <button onClick={submit} disabled={saving || loading || !rows.length}
                className="flex-1 bg-brand-gold hover:bg-brand-gold-hover text-brand-navy font-black py-2.5 rounded-lg text-sm disabled:opacity-60">
                {saving ? '… جاري تجديد الفريق' : `🔄 تجديد ${rows.length} عضو الآن`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
