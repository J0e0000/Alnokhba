import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { SkeletonList } from '../components/Skeleton'
import ConfirmDialog from '../components/ConfirmDialog'
import AdminTeamsPanel from '../components/AdminTeamsPanel'
import AdminBackupsPanel from '../components/AdminBackupsPanel'
import AdminAuditLogsPanel from '../components/AdminAuditLogsPanel'
import AdminSupportAccessModal from '../components/AdminSupportAccessModal'

const STATUS_LABEL = { trial: 'تجربة مجانية', active: 'مشترك فعّال', expired: 'منتهي', cancelled: 'ملغي' }
const ACTION_LABEL = { extend: 'تفعيل/تمديد', cancel: 'إلغاء اشتراك', verify: 'تأكيد حساب', password_change: 'تغيير كلمة مرور', backup_failed: '⚠️ فشل نسخة احتياطية' }
const ACCOUNT_TYPE_LABEL = { assistant: 'مساعد', teacher: 'مدرّس' }

const TABS = [
  ['teachers', 'المدرّسون'],
  ['teams', '👥 الفرق'],
  ['backups', '💾 النسخ الاحتياطي'],
  ['audit', '🛡️ سجل التدقيق'],
  ['log', '📜 سجل النشاط'],
  ['broadcast', '📢 رسالة بث'],
]

export default function AdminDashboard({ onBack }) {
  const { user, signOut, refreshProfile } = useAuth()
  const { showToast } = useToast()
  const [cancelTarget, setCancelTarget] = useState(null)
  const [teachers, setTeachers] = useState([])
  const [statsByTeacher, setStatsByTeacher] = useState({})
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [extendDays, setExtendDays] = useState(30)
  const [extendMode, setExtendMode] = useState('date') // 'date' = تاريخ محدد | 'days' = تمديد بأيام
  const [deadlineDate, setDeadlineDate] = useState('')
  const [tab, setTab] = useState('teachers')
  const [activityLog, setActivityLog] = useState([])
  const [broadcasts, setBroadcasts] = useState([])
  const [broadcastText, setBroadcastText] = useState('')

  // ── جديد: بحث وفلترة الفرق وعرض التفاصيل ووصول الدعم ──
  const [teacherSearch, setTeacherSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('all') // all | none | <team_id>
  const [teamOverview, setTeamOverview] = useState({ teams: [], members: [] })
  const [teamOverviewError, setTeamOverviewError] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [supportTarget, setSupportTarget] = useState(null)

  const load = async () => {
    setLoading(true)
    const [{ data, error }, { data: stats }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.rpc('admin_teacher_stats'),
    ])
    if (!error) setTeachers(data ?? [])
    const map = {}
    ;(stats ?? []).forEach((r) => { map[r.teacher_id] = r })
    setStatsByTeacher(map)
    setLoading(false)
  }

  const loadTeamOverview = async () => {
    const { data, error } = await supabase.rpc('admin_teams_overview')
    if (error) { setTeamOverviewError(true); return }
    setTeamOverviewError(false)
    setTeamOverview({ teams: data?.teams ?? [], members: data?.members ?? [] })
  }

  const loadLog = async () => {
    const { data } = await supabase
      .from('admin_activity_log')
      .select('*, admin:profiles!admin_activity_log_admin_id_fkey(full_name), target:profiles!admin_activity_log_target_teacher_id_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(100)
    setActivityLog(data ?? [])
  }

  const loadBroadcasts = async () => {
    const { data } = await supabase.from('broadcast_messages').select('*').order('created_at', { ascending: false }).limit(20)
    setBroadcasts(data ?? [])
  }

  useEffect(() => { load() }, [])
  useEffect(() => { loadTeamOverview() }, [])
  useEffect(() => { if (tab === 'log') loadLog(); if (tab === 'broadcast') loadBroadcasts() }, [tab])

  const logActivity = async (targetId, action, details) => {
    await supabase.from('admin_activity_log').insert({ admin_id: user.id, target_teacher_id: targetId, action, details })
  }

  const setStatus = async (id, status) => {
    await supabase.from('profiles').update({ subscription_status: status }).eq('id', id)
    await logActivity(id, 'cancel', 'إلغاء الاشتراك')
    load()
    showToast('اتلغى الاشتراك', 'success')
  }

  const invokeAdminAction = async (body) => {
    const { data, error } = await supabase.functions.invoke('admin-account-actions', { body })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data
  }

  const toggleVerify = async (id, current) => {
    try {
      if (!current) await invokeAdminAction({ action: 'confirm_account', targetUserId: id })
      else {
        const { error } = await supabase.rpc('admin_set_verified', { p_profile_id: id, p_verified: false })
        if (error) throw error
      }
      showToast(!current ? 'تم تأكيد الحساب وتفعيله' : 'تم إلغاء تفعيل الحساب', 'success')
      load()
    } catch (error) { showToast(error.message || 'تعذر تغيير حالة الحساب', 'error') }
  }

  const changePassword = async (teacher) => {
    const password = window.prompt(`اكتب كلمة المرور الجديدة لـ ${teacher.full_name || teacher.email} (8 أحرف على الأقل):`, '')
    if (password === null) return
    const confirmation = window.prompt('أعد كتابة كلمة المرور للتأكيد:', '')
    if (confirmation === null) return
    if (password !== confirmation) { showToast('كلمتا المرور غير متطابقتين', 'error'); return }
    try {
      await invokeAdminAction({ action: 'set_password', targetUserId: teacher.id, password })
      showToast('تم تغيير كلمة المرور بنجاح', 'success')
    } catch (error) { showToast(error.message || 'تعذر تغيير كلمة المرور', 'error') }
  }

  // ── تحديد موعد انتهاء الاشتراك (تاريخ محدد أو تمديد بالأيام) ──
  const toInputDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const openSubscriptionEditor = (t) => {
    setEditingId(t.id)
    setExtendMode('date')
    const base = t.subscription_expires_at && new Date(t.subscription_expires_at) > new Date() ? new Date(t.subscription_expires_at) : new Date()
    setDeadlineDate(toInputDate(base))
    setExtendDays(30)
  }

  const previewExpiry = (t) => {
    if (extendMode === 'days') {
      const days = Number(extendDays)
      if (!days || days <= 0) return null
      const b = t.subscription_expires_at && new Date(t.subscription_expires_at) > new Date() ? new Date(t.subscription_expires_at) : new Date()
      b.setDate(b.getDate() + days)
      return b
    }
    if (!deadlineDate) return null
    const [y, m, d] = deadlineDate.split('-').map(Number)
    if (!y || !m || !d) return null
    return new Date(y, m - 1, d, 23, 59, 59)
  }

  const applyExpiry = async (t) => {
    let base, details, toastMsg
    if (extendMode === 'days') {
      const days = Number(extendDays)
      if (!days || days <= 0) { showToast('اكتب عدد أيام صحيح', 'error'); return }
      base = t.subscription_expires_at && new Date(t.subscription_expires_at) > new Date() ? new Date(t.subscription_expires_at) : new Date()
      base.setDate(base.getDate() + days)
      details = `تمديد ${days} يوم`
      toastMsg = `تم تمديد الاشتراك ${days} يوم`
    } else {
      if (!deadlineDate) { showToast('اختار تاريخ الانتهاء الأول', 'error'); return }
      const [y, m, d] = deadlineDate.split('-').map(Number)
      base = new Date(y, m - 1, d, 23, 59, 59)
      details = `تحديد تاريخ الانتهاء: ${deadlineDate}`
      toastMsg = `موعد الانتهاء الجديد: ${base.toLocaleDateString('ar-EG')}`
    }
    const future = base.getTime() > Date.now()
    const { error } = await supabase.from('profiles').update({
      subscription_status: future ? 'active' : 'expired',
      subscription_expires_at: base.toISOString(),
    }).eq('id', t.id)
    if (error) { showToast(error.message || 'تعذر تحديث موعد الانتهاء', 'error'); return }
    await logActivity(t.id, 'extend', details)
    setEditingId(null)
    showToast(`${toastMsg} لـ ${t.full_name || t.email}`, 'success')
    load()
  }

  const sendBroadcast = async (e) => {
    e.preventDefault()
    if (!broadcastText.trim()) return
    await supabase.from('broadcast_messages').insert({ admin_id: user.id, message: broadcastText.trim() })
    setBroadcastText('')
    loadBroadcasts()
  }

  const deleteBroadcast = async (id) => {
    await supabase.from('broadcast_messages').delete().eq('id', id)
    loadBroadcasts()
  }

  // ── فلترة المدرّسين: بحث (اسم/إيميل/هاتف) + فريق ──
  const teamsByProfile = useMemo(() => {
    const map = {}
    for (const m of teamOverview.members) {
      (map[m.profile_id] ||= []).push(m.team_id)
    }
    return map
  }, [teamOverview])

  const filteredTeachers = useMemo(() => {
    const q = teacherSearch.trim().toLowerCase()
    return teachers.filter((t) => {
      if (q && !`${t.full_name || ''} ${t.email || ''} ${t.phone || ''}`.toLowerCase().includes(q)) return false
      if (teamFilter === 'all') return true
      if (teamFilter === 'none') return !(teamsByProfile[t.id] || []).length
      return (teamsByProfile[t.id] || []).includes(teamFilter)
    })
  }, [teachers, teacherSearch, teamFilter, teamsByProfile])

  const supportStarted = async () => {
    // الجلسة اتبدأت — حدّث السياق (هيحوّلنا للوحة المستخدم مع شريط وصول الدعم)
    await refreshProfile()
  }

  const viewAccountFromTeams = (profileId) => {
    setTab('teachers')
    setTeacherSearch('')
    setDetailId(profileId)
    const t = teachers.find((x) => x.id === profileId)
    if (!t) load().then(() => setDetailId(profileId))
  }

  return (
    <div className="min-h-screen bg-brand-bg text-fg" dir="rtl">
      <header className="border-b border-outline bg-surface backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <img src="/nokhba-mark.svg" alt="النخبة" className="w-9 h-9" />
            <div>
              <h1 className="font-black text-lg text-fg">لوحة الأدمن</h1>
              <p className="text-fg-muted text-xs">إدارة الحسابات والاشتراكات والفرق والنسخ الاحتياطي والأمان</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-brand-gold-hover hover:text-brand-gold-hover text-sm font-bold">لوحتي كمعلم</button>
            <button onClick={signOut} className="text-fg-muted hover:text-[var(--danger-strong)] text-sm">تسجيل الخروج</button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 flex gap-4 text-sm border-t border-outline overflow-x-auto">
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`py-2 border-b-2 font-bold whitespace-nowrap ${tab === key ? 'border-brand-gold text-brand-gold-hover' : 'border-transparent text-fg-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {tab === 'teachers' && (loading ? (
          <SkeletonList rows={4} />
        ) : (
          <div className="space-y-3">
            {/* بحث + فلترة حسب الفريق */}
            <div className="bg-surface border border-outline rounded-xl p-3 flex flex-wrap gap-2 items-end">
              <label className="flex-1 min-w-[220px] text-xs font-bold text-fg-muted">
                بحث (اسم / إيميل / هاتف)
                <input value={teacherSearch} onChange={(e) => setTeacherSearch(e.target.value)} placeholder="اكتب للبحث..." className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold" />
              </label>
              <label className="text-xs font-bold text-fg-muted">
                الفريق
                <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="mt-1 bg-surface-container border border-outline rounded-lg px-3 py-2 text-sm text-fg">
                  <option value="all">كل الفرق</option>
                  <option value="none">بدون فريق</option>
                  {teamOverview.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              {teamOverviewError && <span className="text-[11px] text-[var(--warn-strong)]">(شغّل migration_036 لتفعيل فلترة الفرق)</span>}
            </div>

            <p className="text-xs text-fg-muted">{filteredTeachers.length} من {teachers.length} مستخدم</p>

            {filteredTeachers.map((t) => {
              const expired = t.subscription_expires_at && new Date(t.subscription_expires_at) < new Date()
              const effectiveStatus = expired && t.subscription_status !== 'cancelled' ? 'expired' : t.subscription_status
              const stats = statsByTeacher[t.id]
              const userTeams = (teamsByProfile[t.id] || []).map((id) => teamOverview.teams.find((x) => x.id === id)).filter(Boolean)
              return (
                <div key={t.id} className={`bg-surface border rounded-xl p-4 transition ${detailId === t.id ? 'border-brand-gold/60 ring-1 ring-brand-gold/20' : 'border-outline'}`}>
                  <div className="flex flex-wrap justify-between items-center gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-fg flex items-center gap-2 flex-wrap">
                        {t.full_name || '—'}
                        {t.is_admin && <span className="text-[10px] bg-[var(--info-bg)] text-[var(--info-strong)] px-1.5 py-0.5 rounded">أدمن</span>}
                        {t.account_type === 'assistant' && <span className="text-[10px] bg-surface-container-high text-fg-muted px-1.5 py-0.5 rounded">مساعد</span>}
                        {userTeams.map((team) => (
                          <span key={team.id} className="text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: team.color || '#D4AF37' }}>{team.name}</span>
                        ))}
                      </p>
                      <p className="text-fg-muted text-xs" dir="ltr">{t.email} {t.phone && `· ${t.phone}`}</p>
                      <p className="text-fg-muted text-xs mt-1">
                        <StatusBadge status={effectiveStatus} />
                        {t.is_verified ? (
                          <span className="text-[var(--ok-strong)] mr-2">· ✅ مفعّل</span>
                        ) : (
                          <span className="text-[var(--warn-strong)] mr-2">· ⏳ بانتظار التفعيل</span>
                        )}
                        · ينتهي {t.subscription_expires_at ? new Date(t.subscription_expires_at).toLocaleDateString('ar-EG') : '—'}
                      </p>
                      {stats && (
                        <p className="text-fg-muted text-xs mt-1">
                          👥 {stats.student_count ?? 0} طالب · آخر نشاط: {stats.last_activity ? new Date(stats.last_activity).toLocaleDateString('ar-EG') : 'مفيش نشاط بعد'}
                        </p>
                      )}
                    </div>

                    {editingId === t.id ? (
                      <div className="w-full sm:w-[340px] bg-surface-container border border-outline rounded-xl p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-xs font-bold text-fg">تحديد موعد انتهاء الاشتراك</p>
                          <div className="flex bg-surface-container-high rounded-lg p-0.5 gap-0.5 text-[11px] font-bold">
                            <button type="button" onClick={() => setExtendMode('date')} className={`px-2 py-1 rounded-md transition ${extendMode === 'date' ? 'bg-brand-gold text-brand-navy' : 'text-fg-muted'}`}>تاريخ محدد</button>
                            <button type="button" onClick={() => setExtendMode('days')} className={`px-2 py-1 rounded-md transition ${extendMode === 'days' ? 'bg-brand-gold text-brand-navy' : 'text-fg-muted'}`}>تمديد بأيام</button>
                          </div>
                        </div>

                        {extendMode === 'date' ? (
                          <input type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} dir="ltr"
                            className="w-full bg-surface-container-high border border-outline rounded-lg px-2 py-1.5 text-sm text-fg outline-none focus:border-brand-gold" />
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <input type="number" min={1} value={extendDays} onChange={(e) => setExtendDays(e.target.value)} dir="ltr"
                              className="w-16 bg-surface-container-high border border-outline rounded-lg px-2 py-1.5 text-sm text-center text-fg outline-none focus:border-brand-gold" />
                            <span className="text-xs text-fg-muted">يوم</span>
                            <div className="flex gap-1">
                              {[7, 30, 90].map((n) => (
                                <button key={n} type="button" onClick={() => setExtendDays(n)} className={`text-[11px] font-bold px-2 py-1 rounded-lg border transition ${Number(extendDays) === n ? 'bg-brand-gold/15 text-brand-gold-hover border-brand-gold/40' : 'border-outline text-fg-muted'}`}>+{n}</button>
                              ))}
                            </div>
                          </div>
                        )}

                        {previewExpiry(t) && (
                          <p className="text-[11px] text-fg-muted">
                            النتيجة: ينتهي <span className="font-bold text-fg">{previewExpiry(t).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                            {previewExpiry(t).getTime() <= Date.now() && <span className="text-[var(--danger-strong)] font-bold"> — هيبقى منتهي</span>}
                          </p>
                        )}

                        <div className="flex items-center gap-2">
                          <button onClick={() => applyExpiry(t)} className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg">حفظ موعد الانتهاء</button>
                          <button onClick={() => setEditingId(null)} className="text-fg-muted text-xs hover:text-fg">إلغاء</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-end">
                        <div className="flex gap-1.5 flex-wrap justify-end">
                          <button onClick={() => setDetailId(detailId === t.id ? null : t.id)} className="bg-surface-container-high text-fg text-xs font-bold px-2.5 py-1.5 rounded-lg">👁 عرض</button>
                          {!t.is_admin && (
                            <button onClick={() => setSupportTarget(t)} className="bg-[var(--warn-bg)] border border-[var(--warn-border)] text-[var(--warn-strong)] text-xs font-bold px-2.5 py-1.5 rounded-lg">🛠️ وصول الدعم</button>
                          )}
                        </div>
                        <div className="flex gap-1.5 flex-wrap justify-end">
                          {!t.is_verified && (
                            <button onClick={() => toggleVerify(t.id, false)} className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm">تفعيل الحساب الآن</button>
                          )}
                          {t.is_verified && (
                            <button onClick={() => toggleVerify(t.id, true)} className="bg-surface-container-high text-fg text-xs font-bold px-3 py-1.5 rounded-lg">إلغاء التفعيل</button>
                          )}
                          <button onClick={() => openSubscriptionEditor(t)} className="bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/40 text-xs font-bold px-3 py-1.5 rounded-lg">✏️ تحديد الانتهاء</button>
                          <button onClick={() => changePassword(t)} className="bg-[var(--info-bg)] text-[var(--info-strong)] border border-[var(--info-border)] text-xs font-bold px-3 py-1.5 rounded-lg">🔑 كلمة المرور</button>
                          <button onClick={() => setCancelTarget(t)} className="bg-[var(--danger-bg)] text-[var(--danger-strong)] border border-[var(--danger-border)] text-xs font-bold px-3 py-1.5 rounded-lg">إلغاء الاشتراك</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── تفاصيل موسّعة (زر عرض) ── */}
                  {detailId === t.id && (
                    <div className="mt-3 pt-3 border-t border-outline grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      <DetailLine label="المعرّف (ID)" value={t.id} mono />
                      <DetailLine label="نوع الحساب" value={ACCOUNT_TYPE_LABEL[t.account_type] || 'مدرّس'} />
                      <DetailLine label="تاريخ التسجيل" value={new Date(t.created_at).toLocaleString('ar-EG')} />
                      <DetailLine label="عدد الطلاب" value={String(stats?.student_count ?? 0)} />
                      <DetailLine label="الفِرق" value={userTeams.length ? userTeams.map((x) => x.name).join('، ') : 'بدون فريق'} />
                      <DetailLine label="آخر نشاط" value={stats?.last_activity ? new Date(stats.last_activity).toLocaleString('ar-EG') : 'مفيش نشاط'} />
                    </div>
                  )}
                </div>
              )
            })}
            {filteredTeachers.length === 0 && <p className="text-fg-muted text-sm text-center py-8">لا يوجد مستخدمون مطابقون للبحث/الفلتر.</p>}
            {teachers.length === 0 && <p className="text-fg-muted text-sm text-center py-8">لا يوجد مدرّسون مسجّلون بعد.</p>}
          </div>
        ))}

        {tab === 'teams' && <AdminTeamsPanel teachers={teachers} showToast={showToast} onViewAccount={viewAccountFromTeams} />}

        {tab === 'backups' && <AdminBackupsPanel showToast={showToast} />}

        {tab === 'audit' && <AdminAuditLogsPanel teams={teamOverview.teams} showToast={showToast} />}

        {tab === 'log' && (
          <div className="space-y-2">
            {activityLog.length === 0 ? (
              <p className="text-fg-muted text-sm text-center py-8">لا يوجد نشاط مسجّل بعد.</p>
            ) : activityLog.map((r) => (
              <div key={r.id} className="bg-surface border border-outline rounded-lg p-3 text-sm">
                <span className="text-brand-gold-hover font-bold">{r.admin?.full_name || 'النظام/المجدول'}</span>
                {' '}<span className="text-fg-muted">{ACTION_LABEL[r.action] || r.action} لـ</span>{' '}
                <span className="text-fg font-bold">{r.target?.full_name || '—'}</span>
                {r.details && <span className="text-fg-muted"> ({r.details})</span>}
                <p className="text-on-surface-variant text-xs mt-1">{new Date(r.created_at).toLocaleString('ar-EG')}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'broadcast' && (
          <div className="space-y-4">
            <form onSubmit={sendBroadcast} className="bg-surface border border-outline rounded-xl p-4 space-y-2">
              <p className="text-sm font-bold text-on-surface-variant">رسالة جديدة لكل المدرّسين</p>
              <textarea rows={3} value={broadcastText} onChange={(e) => setBroadcastText(e.target.value)}
                placeholder="مثال: هيحصل تحديث للنظام يوم الجمعة الساعة 2 فجرًا، الخدمة هتتوقف لمدة نص ساعة تقريبًا."
                className="w-full bg-surface-container border border-outline rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold" />
              <button className="bg-brand-gold hover:bg-brand-gold-hover text-brand-navy font-bold px-4 py-2 rounded-lg text-sm">إرسال للكل</button>
            </form>
            <div className="space-y-2">
              {broadcasts.map((b) => (
                <div key={b.id} className="bg-surface border border-outline rounded-lg p-3 flex justify-between items-start gap-2">
                  <div>
                    <p className="text-sm text-fg">{b.message}</p>
                    <p className="text-on-surface-variant text-xs mt-1">{new Date(b.created_at).toLocaleString('ar-EG')}</p>
                  </div>
                  <button onClick={() => deleteBroadcast(b.id)} className="text-[var(--danger-strong)] hover:opacity-75 text-xs shrink-0">حذف</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <ConfirmDialog
        open={!!cancelTarget} title="إلغاء الاشتراك" danger confirmLabel="إلغاء الاشتراك"
        message={`هيتم إلغاء اشتراك "${cancelTarget?.full_name}" وهيفقد الوصول للنظام فورًا.`}
        onConfirm={() => { setStatus(cancelTarget.id, 'cancelled'); setCancelTarget(null) }}
        onCancel={() => setCancelTarget(null)}
      />

      <AdminSupportAccessModal
        open={!!supportTarget}
        teacher={supportTarget}
        onClose={() => setSupportTarget(null)}
        onStarted={supportStarted}
        showToast={showToast}
      />
    </div>
  )
}

function DetailLine({ label, value, mono }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-muted shrink-0">{label}:</span>
      <span className={`text-fg font-bold text-left truncate ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : 'rtl'} title={String(value)}>{value}</span>
    </div>
  )
}

function StatusBadge({ status }) {
  const colors = {
    trial: 'text-brand-gold-hover', active: 'text-[var(--ok-strong)]', expired: 'text-brand-gold-hover', cancelled: 'text-[var(--danger-strong)]',
  }
  return <span className={`font-bold ${colors[status] || 'text-fg-muted'}`}>{STATUS_LABEL[status] || status}</span>
}
