import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const ACTION_LABEL = {
  support_access_started: '🛠️ فتح وصول دعم',
  support_access_ended: '⏏ إنهاء وصول دعم',
  support_insert_students: '➕ إضافة طالب (وصول دعم)',
  support_update_students: '✏️ تعديل طالب (وصول دعم)',
  support_delete_students: '🗑️ حذف طالب (وصول دعم)',
  support_insert_attendance_records: '➕ رصد حضور (وصول دعم)',
  support_update_attendance_records: '✏️ تعديل حضور (وصول دعم)',
  team_created: '👥 إنشاء فريق',
  team_updated: '👥 تعديل فريق',
  team_deleted: '👥 حذف فريق',
  team_members_added: '👥 إضافة أعضاء فريق',
  team_member_removed: '👥 إزالة عضو من فريق',
  backup_completed: '💾 اكتمال نسخة احتياطية',
  backup_completed_partial: '💾 اكتمال نسخة جزئية',
  backup_failed: '⚠️ فشل نسخة احتياطية',
  backup_deleted: '🗑️ حذف نسخة احتياطية',
  backup_deleted_retention: '🗑️ حذف تلقائي (سياسة الاحتفاظ)',
  backup_schedule_updated: '⚙️ تحديث إعدادات النسخ',
  restore_applied: '♻️ استعادة بيانات',
}

/**
 * سجل التدقيق (AUDIT LOGS) — دائم وغير قابل للتعديل أو الحذف من أي أحد
 * (حتى الأدمن): الجدول للإضافة فقط على مستوى قاعدة البيانات.
 * فلاتر: الأدمن / المستخدم المستهدف / الإجراء / التاريخ / الفريق / جلسة الدعم.
 */
export default function AdminAuditLogsPanel({ teams, showToast }) {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ admin_user_id: '', target_user_id: '', action: '', date_from: '', date_to: '', team_id: '' })
  const [searchDraft, setSearchDraft] = useState({ admin: '', target: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const payload = {}
    if (filters.admin_user_id) payload.admin_user_id = filters.admin_user_id
    if (filters.target_user_id) payload.target_user_id = filters.target_user_id
    if (filters.action) payload.action = filters.action
    if (filters.date_from) payload.date_from = filters.date_from
    if (filters.date_to) payload.date_to = filters.date_to
    if (filters.team_id) payload.team_id = filters.team_id
    const { data, error } = await supabase.rpc('admin_get_audit_logs', { p_filters: payload })
    setLoading(false)
    if (error) {
      showToast?.(error.message || 'تعذر تحميل سجل التدقيق — شغّل migration_036 أولًا', 'error')
      setLogs([])
      return
    }
    setLogs(data?.logs ?? [])
    setTotal(data?.total ?? 0)
  }, [filters, showToast])

  useEffect(() => { load() }, [load])

  const actionOptions = useMemo(() => {
    const set = new Set(logs.map((l) => l.action))
    return Array.from(set).sort()
  }, [logs])

  // البحث عن أدمن/مستهدف بالمعرّف
  const resolveId = (which) => {
    const q = String(searchDraft[which] || '').trim()
    if (!q) return ''
    const found = logs.find((l) =>
      (which === 'admin' && (l.admin_name === q || l.admin_user_id === q)) ||
      (which === 'target' && (l.target_name === q || l.target_user_id === q))
    )
    return which === 'admin' ? found?.admin_user_id || q : found?.target_user_id || q
  }

  return (
    <div className="space-y-3">
      <div className="bg-surface border border-outline rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-black text-fg">🛡️ سجل التدقيق</h2>
            <p className="text-fg-muted text-xs mt-1">
              سجل دائم للإضافة فقط — لا يمكن تعديله أو حذفه حتى من الأدمن. يشمل وصول الدعم وكل عمليات النسخ والفرق والاستعادة.
            </p>
          </div>
          <button onClick={load} className="text-fg-muted hover:text-brand-gold-hover text-xs font-bold">↻ تحديث</button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-xs font-bold text-fg-muted">
            الإجراء
            <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-2 py-2 text-sm text-fg">
              <option value="">الكل</option>
              {actionOptions.map((a) => <option key={a} value={a}>{ACTION_LABEL[a] || a}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-fg-muted">
            الفريق (فلترة المستهدفين)
            <select value={filters.team_id} onChange={(e) => setFilters({ ...filters, team_id: e.target.value })} className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-2 py-2 text-sm text-fg">
              <option value="">كل الفرق</option>
              {(teams || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-fg-muted">
            من تاريخ
            <input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-2 py-2 text-sm text-fg" />
          </label>
          <label className="text-xs font-bold text-fg-muted">
            إلى تاريخ
            <input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-2 py-2 text-sm text-fg" />
          </label>
          <label className="text-xs font-bold text-fg-muted">
            بحث باسم/معرّف الأدمن
            <div className="flex gap-1 mt-1">
              <input value={searchDraft.admin} onChange={(e) => setSearchDraft({ ...searchDraft, admin: e.target.value })} placeholder="اسم أو معرّف" className="flex-1 bg-surface-container border border-outline rounded-lg px-2 py-2 text-sm text-fg" />
              <button onClick={() => setFilters({ ...filters, admin_user_id: resolveId('admin') })} className="bg-brand-navy text-white text-xs font-bold px-3 rounded-lg">فلتر</button>
            </div>
          </label>
          <label className="text-xs font-bold text-fg-muted">
            بحث باسم/معرّف المستخدم المستهدف
            <div className="flex gap-1 mt-1">
              <input value={searchDraft.target} onChange={(e) => setSearchDraft({ ...searchDraft, target: e.target.value })} placeholder="اسم أو معرّف" className="flex-1 bg-surface-container border border-outline rounded-lg px-2 py-2 text-sm text-fg" />
              <button onClick={() => setFilters({ ...filters, target_user_id: resolveId('target') })} className="bg-brand-navy text-white text-xs font-bold px-3 rounded-lg">فلتر</button>
            </div>
          </label>
          <div className="flex items-end gap-2">
            <button onClick={() => { setFilters({ admin_user_id: '', target_user_id: '', action: '', date_from: '', date_to: '', team_id: '' }); setSearchDraft({ admin: '', target: '' }) }} className="bg-surface-container-high text-fg font-bold px-3 py-2 rounded-lg text-xs">مسح الفلاتر</button>
          </div>
        </div>
      </div>

      <div className="bg-surface border border-outline rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-outline text-sm">
          <span className="font-black text-fg">السجلات</span>
          <span className="text-fg-muted text-xs"> ({total} إجمالي — أحدث 100)</span>
        </div>
        {loading ? (
          <p className="text-fg-muted text-sm text-center py-8">جاري التحميل...</p>
        ) : logs.length === 0 ? (
          <p className="text-fg-muted text-sm text-center py-8">لا توجد سجلات مطابقة.</p>
        ) : (
          <div className="divide-y divide-outline">
            {logs.map((l) => (
              <div key={l.id} className="px-4 py-2.5 text-sm hover:bg-surface-container">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[10px] font-mono text-fg-subtle shrink-0" dir="ltr">#{l.id}</span>
                  <span className="font-bold text-fg">{l.admin_name || 'النظام'}</span>
                  <span className="text-fg-muted text-xs">
                    {(ACTION_LABEL[l.action] || l.action)}
                    {l.target_name && <> → <span className="font-bold text-fg">{l.target_name}</span></>}
                  </span>
                  {l.support_session_id && <span className="text-[10px] bg-[var(--info-bg)] text-[var(--info-strong)] px-1.5 py-0.5 rounded-full">جلسة دعم</span>}
                </div>
                {(l.reason || l.details) && (
                  <p className="text-xs text-fg-muted mt-0.5 truncate">{l.details || l.reason}</p>
                )}
                <p className="text-[11px] text-fg-subtle mt-0.5">{new Date(l.created_at).toLocaleString('ar-EG')}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
