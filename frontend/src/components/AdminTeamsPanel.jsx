import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ConfirmDialog from './ConfirmDialog'

const TEAM_COLORS = ['#D4AF37', '#7C3AED', '#0EA5E9', '#10B981', '#F43F5E', '#F59E0B', '#6366F1', '#0F172A']
const ACCOUNT_TYPE_LABEL = { assistant: 'مساعد', teacher: 'مدرّس', admin: 'أدمن' }

/**
 * إدارة الفرق (TEAM MANAGEMENT) — النسخة المطورة:
 * وصف/لون/حالة + بحث مستخدمين (اسم/هاتف/إيميل/معرّف) + إضافة وإزالة أعضاء
 * فرديين + تعطيل/تفعيل + حذف لا يمس المستخدمين + عرض حساب العضو.
 * العضوية تنظيمية فقط — لا تمنح أي صلاحيات إضافية (الدور مستقل تمامًا).
 */
export default function AdminTeamsPanel({ showToast, onViewAccount }) {
  const [teams, setTeams] = useState([])
  const [members, setMembers] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', color: TEAM_COLORS[0], logo_url: '' })
  const [editMode, setEditMode] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('admin_teams_overview')
    if (error) {
      showToast?.(error.message || 'تعذر تحميل الفرق — شغّل migration_036 أولًا', 'error')
      setTeams([])
      setMembers([])
    } else {
      setTeams(data?.teams ?? [])
      setMembers(data?.members ?? [])
      setSelectedTeamId((current) => current || data?.teams?.[0]?.id || '')
    }
    setLoading(false)
  }, [showToast])

  useEffect(() => { load() }, [load])

  const selectedTeam = useMemo(() => teams.find((t) => t.id === selectedTeamId) || null, [teams, selectedTeamId])
  const selectedMembers = useMemo(() => members.filter((m) => m.team_id === selectedTeamId), [members, selectedTeamId])

  // بحث المستخدمين (اسم / هاتف / إيميل / معرّف)
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) { setSearchResults([]); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      const { data, error } = await supabase.rpc('admin_search_users', { p_query: q, p_limit: 20 })
      setSearching(false)
      if (cancelled) return
      if (error) { setSearchResults([]); return }
      setSearchResults((data ?? []).filter((u) => !u.is_admin))
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery])

  const createOrUpdateTeam = async (e) => {
    e?.preventDefault?.()
    if (!form.name.trim()) return
    setSaving(true)
    const { data, error } = await supabase.rpc('admin_upsert_team', {
      p_id: editMode ? selectedTeamId : null,
      p_name: form.name.trim(),
      p_description: form.description.trim() || null,
      p_color: form.color,
      p_logo_url: form.logo_url.trim() || null,
      p_status: editMode ? (selectedTeam?.status || 'active') : 'active',
    })
    setSaving(false)
    if (error) { showToast?.(error.message || 'تعذر حفظ الفريق', 'error'); return }
    await load()
    if (!editMode && data) { setSelectedTeamId(data); showToast?.('تم إنشاء الفريق ✅', 'success') }
    else showToast?.('تم تحديث الفريق ✅', 'success')
    setForm({ name: '', description: '', color: TEAM_COLORS[0], logo_url: '' })
    setEditMode(false)
  }

  const startEdit = () => {
    if (!selectedTeam) return
    setEditMode(true)
    setForm({
      name: selectedTeam.name || '',
      description: selectedTeam.description || '',
      color: selectedTeam.color || TEAM_COLORS[0],
      logo_url: selectedTeam.logo_url || '',
    })
  }

  const setStatus = async (status) => {
    if (!selectedTeam) return
    setSaving(true)
    const { error } = await supabase.rpc('admin_upsert_team', {
      p_id: selectedTeam.id,
      p_name: selectedTeam.name,
      p_description: selectedTeam.description || null,
      p_color: selectedTeam.color || TEAM_COLORS[0],
      p_logo_url: selectedTeam.logo_url || null,
      p_status: status,
    })
    setSaving(false)
    if (error) { showToast?.(error.message || 'تعذر تغيير حالة الفريق', 'error'); return }
    await load()
    showToast?.(status === 'active' ? 'تم تفعيل الفريق' : 'تم تعطيل الفريق (الأعضاء لم يتأثروا)', 'success')
  }

  const addMember = async (profileId) => {
    if (!selectedTeamId) return
    setSaving(true)
    const { error } = await supabase.rpc('admin_team_add_members', { p_team_id: selectedTeamId, p_profile_ids: [profileId] })
    setSaving(false)
    if (error) { showToast?.(error.message || 'تعذر إضافة العضو', 'error'); return }
    setSearchQuery('')
    setSearchResults([])
    await load()
    showToast?.('تمت إضافة العضو للفريق', 'success')
  }

  const removeMember = async (profileId) => {
    if (!selectedTeamId) return
    setSaving(true)
    const { error } = await supabase.rpc('admin_team_remove_member', { p_team_id: selectedTeamId, p_profile_id: profileId })
    setSaving(false)
    if (error) { showToast?.(error.message || 'تعذر إزالة العضو', 'error'); return }
    await load()
    showToast?.('تمت إزالة العضو من الفريق (حسابه لم يتأثر)', 'success')
  }

  const doDeleteTeam = async () => {
    if (!deleteTarget) return
    setSaving(true)
    const { error } = await supabase.rpc('admin_delete_team_v2', { p_team_id: deleteTarget.id })
    setSaving(false)
    setDeleteTarget(null)
    if (error) { showToast?.(error.message || 'تعذر حذف الفريق', 'error'); return }
    if (selectedTeamId === deleteTarget.id) setSelectedTeamId('')
    await load()
    showToast?.('تم حذف الفريق — لم يُحذف أي مستخدم', 'success')
  }

  if (loading) return <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-outline">جاري تحميل الفرق...</div>

  return (
    <div className="space-y-4">
      {/* ── إنشاء / تعديل فريق ── */}
      <form onSubmit={createOrUpdateTeam} className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-black text-brand-navy">فرق العمل</h2>
            <p className="text-outline text-xs mt-1">
              اجمع المدرّسين/المساعدين في فريق لأغراض تنظيمية — العضوية <span className="font-bold">لا تمنح أي صلاحيات</span> (الدور مستقل عن الفريق).
            </p>
          </div>
          <span className="text-xs font-bold text-violet-600 bg-violet-50 px-2 py-1 rounded-full">Admin only</span>
        </div>

        <div className="grid sm:grid-cols-2 gap-2 mb-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={editMode ? 'اسم الفريق الجديد' : 'اسم الفريق (مثال: فريق التاريخ)'} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold" disabled={saving} />
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="وصف الفريق (اختياري)" className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold" disabled={saving} />
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-outline">اللون:</span>
            {TEAM_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} style={{ backgroundColor: c }} className={`w-6 h-6 rounded-full border-2 transition ${form.color === c ? 'border-slate-800 scale-110' : 'border-transparent'}`} aria-label={`لون ${c}`} />
            ))}
          </div>
          <input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="رابط شعار الفريق (اختياري)" dir="ltr" className="flex-1 min-w-[200px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-brand-gold" disabled={saving} />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={saving || !form.name.trim()} className="bg-brand-gold hover:bg-brand-gold-hover disabled:opacity-50 text-brand-navy font-black px-4 py-2 rounded-lg text-sm">
            {editMode ? '💾 حفظ التعديل' : '＋ إنشاء فريق'}
          </button>
          {editMode && (
            <button type="button" onClick={() => { setEditMode(false); setForm({ name: '', description: '', color: TEAM_COLORS[0], logo_url: '' }) }} className="bg-slate-100 text-slate-600 font-bold px-4 py-2 rounded-lg text-sm">
              إلغاء التعديل
            </button>
          )}
        </div>
      </form>

      {teams.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-outline text-sm">لم يتم إنشاء فرق بعد.</div>
      ) : (
        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          {/* ── قائمة الفرق ── */}
          <div className="space-y-2">
            {teams.map((team) => (
              <button key={team.id} onClick={() => setSelectedTeamId(team.id)} className={`w-full text-right bg-white border rounded-xl p-3 transition ${selectedTeamId === team.id ? 'border-brand-gold ring-2 ring-brand-gold/20' : 'border-slate-200 hover:border-slate-300'}`}>
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: team.color || '#D4AF37' }} />
                  <span className="font-bold text-brand-navy truncate">{team.name}</span>
                  {team.status === 'disabled' && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">معطّل</span>}
                </span>
                {team.description && <span className="block text-xs text-outline mt-1 truncate">{team.description}</span>}
                <span className="block text-xs text-outline mt-1">{team.member_count} عضو · أُنشئ {new Date(team.created_at).toLocaleDateString('ar-EG')}</span>
              </button>
            ))}
          </div>

          {/* ── لوحة الفريق ── */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            {selectedTeam ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3 pb-3 border-b border-slate-100">
                  <div className="min-w-0">
                    <h3 className="font-black text-brand-navy flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: selectedTeam.color || '#D4AF37' }} />
                      {selectedTeam.name}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${selectedTeam.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {selectedTeam.status === 'active' ? 'نشط' : 'معطّل'}
                      </span>
                    </h3>
                    <p className="text-xs text-outline mt-1">{selectedMembers.length} عضو · أُنشئ {new Date(selectedTeam.created_at).toLocaleDateString('ar-EG', { dateStyle: 'medium' })}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={startEdit} disabled={saving} className="bg-brand-gold/15 border border-brand-gold/40 text-brand-gold-hover font-bold px-3 py-1.5 rounded-lg text-xs">✏️ تعديل</button>
                    {selectedTeam.status === 'active' ? (
                      <button onClick={() => setStatus('disabled')} disabled={saving} className="bg-slate-100 text-slate-600 font-bold px-3 py-1.5 rounded-lg text-xs">⏸ تعطيل الفريق</button>
                    ) : (
                      <button onClick={() => setStatus('active')} disabled={saving} className="bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded-lg text-xs">▶ تفعيل الفريق</button>
                    )}
                    <button onClick={() => setDeleteTarget(selectedTeam)} disabled={saving} className="bg-rose-50 border border-rose-200 text-rose-600 font-bold px-3 py-1.5 rounded-lg text-xs">🗑 حذف الفريق</button>
                  </div>
                </div>

                {/* ── بحث وإضافة أعضاء ── */}
                <div className="mb-3">
                  <div className="relative">
                    <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="ابحث بالاسم أو الهاتف أو الإيميل أو المعرّف لإضافة عضو..." className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold" disabled={saving} />
                    {searching && <span className="absolute left-3 top-2.5 text-outline text-xs">⏳</span>}
                  </div>
                  {searchResults.length > 0 && (
                    <div className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
                      {searchResults.map((u) => (
                        <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-brand-navy truncate">{u.full_name || 'بدون اسم'}</p>
                            <p className="text-[11px] text-outline truncate" dir="ltr">{u.email || u.phone || u.id?.slice(0, 8)} · {ACCOUNT_TYPE_LABEL[u.account_type] || 'مدرّس'}</p>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button onClick={() => addMember(u.id)} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold px-2.5 py-1 rounded-lg">＋ إضافة</button>
                            <button onClick={() => onViewAccount?.(u.id)} className="bg-slate-100 text-slate-600 text-xs font-bold px-2.5 py-1 rounded-lg">عرض</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── جدول الأعضاء ── */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-outline text-xs border-b border-slate-200">
                        <th className="text-right px-3 py-2 font-bold">الاسم</th>
                        <th className="text-right px-3 py-2 font-bold">الدور</th>
                        <th className="text-right px-3 py-2 font-bold">الحالة</th>
                        <th className="text-right px-3 py-2 font-bold">آخر نشاط</th>
                        <th className="text-right px-3 py-2 font-bold">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedMembers.length === 0 && (
                        <tr><td colSpan={5} className="text-center text-outline text-xs py-6">لا يوجد أعضاء — استخدم البحث بالأعلى للإضافة.</td></tr>
                      )}
                      {selectedMembers.map((m) => (
                        <tr key={m.profile_id} className="border-b border-slate-100 hover:bg-slate-50/60">
                          <td className="px-3 py-2">
                            <p className="font-bold text-brand-navy">{m.full_name || 'بدون اسم'}</p>
                            <p className="text-[11px] text-outline truncate" dir="ltr">{m.email || m.phone || '—'}</p>
                          </td>
                          <td className="px-3 py-2 text-outline text-xs">{ACCOUNT_TYPE_LABEL[m.account_type || 'teacher']}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${m.is_verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {m.is_verified ? 'مفعّل' : 'بانتظار التفعيل'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-outline text-xs whitespace-nowrap">{m.last_activity ? new Date(m.last_activity).toLocaleDateString('ar-EG') : 'مفيش نشاط'}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1.5">
                              <button onClick={() => onViewAccount?.(m.profile_id)} className="text-violet-600 hover:text-violet-500 text-xs font-bold">عرض الحساب</button>
                              <button onClick={() => removeMember(m.profile_id)} disabled={saving} className="text-rose-500 hover:text-rose-600 text-xs font-bold">إزالة من الفريق</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-outline mt-2">حذف الفريق أو إزالة عضو منه <span className="font-bold">لا يحذف أو يعلّل أي حساب مستخدم</span> — العضوية تنظيمية فقط.</p>
              </>
            ) : (
              <p className="text-outline text-sm text-center py-8">اختار فريق من القائمة.</p>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="حذف الفريق"
        danger
        confirmLabel="حذف الفريق"
        message={`هتحذف فريق «${deleteTarget?.name || ''}» وعضوياته (${deleteTarget?.member_count ?? 0}). الحسابات نفسها لن تُحذف ولن تتأثر بأي شكل.`}
        onConfirm={doDeleteTeam}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
