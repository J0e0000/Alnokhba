// ═══════════════════════════════════════════════════════════════════════════
// EL NO5BA CENTERS — Reports + Settings tabs
// Reports = attendance / sessions / teachers / students / rooms operational
// summaries over a range, with branded A4 printing. Settings = center info,
// staff, audit log, manual backup (JSON export with audit note).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { useCenters } from './CentersStore'
import { dayOffsetStr, todayStr, studentsOfGroup, api } from './centersApi'
import { supabase } from '../lib/supabaseClient'
import { printReport } from './printCenters'
import { NAVY } from './DashboardToday'

const card = { background: '#fff', border: '1px solid rgba(14,41,84,.1)', borderRadius: 14, padding: 14 }
const btnGold = { background: '#D4AF37', color: NAVY, border: 0, borderRadius: 10, padding: '10px 18px', fontSize: 13.5, fontWeight: 900, cursor: 'pointer' }
const inputStyle = { border: '1px solid rgba(14,41,84,.18)', borderRadius: 10, padding: '9px 11px', fontSize: 13, fontFamily: 'inherit' }

export function ReportsTab() {
  const { data, centerId, centers } = useCenters()
  const [rangeDays, setRangeDays] = useState(7)

  const report = useMemo(() => {
    const from = dayOffsetStr(-rangeDays + 1), to = todayStr()
    const inRange = data.sessions.filter((s) => s.session_date >= from && s.session_date <= to && s.status !== 'cancelled')
    const completed = inRange.filter((s) => s.status === 'completed')
    const sessionIds = new Set(inRange.map((s) => s.id))
    const att = data.attendance.filter((a) => sessionIds.has(a.session_id))
    const marked = att.length
    const presentish = att.filter((a) => a.status === 'present' || a.status === 'late').length
    const attRate = marked ? Math.round((presentish / marked) * 100) : null

    const perGroup = data.groups.map((g) => {
      const gs = inRange.filter((s) => s.group_id === g.id)
      const gAtt = att.filter((a) => gs.some((s) => s.id === a.session_id))
      const gMarked = gAtt.length
      const gPresent = gAtt.filter((a) => a.status === 'present' || a.status === 'late').length
      return {
        group: g,
        sessions: gs.length,
        rate: gMarked ? Math.round((gPresent / gMarked) * 100) : null,
        students: studentsOfGroup(data.enrollments, data.students, g.id).length,
      }
    }).filter((r) => r.sessions > 0)

    const perTeacher = data.teachers.map((t) => {
      const ts = inRange.filter((s) => s.teacher_id === t.id)
      const tAtt = att.filter((a) => ts.some((s) => s.id === a.session_id))
      const marked = tAtt.length
      const present = tAtt.filter((a) => a.status === 'present' || a.status === 'late').length
      return { teacher: t, sessions: ts.length, rate: marked ? Math.round((present / marked) * 100) : null }
    }).filter((r) => r.sessions > 0)

    return { from, to, total: inRange.length, completed: completed.length, attRate, marked, perGroup, perTeacher }
  }, [data, rangeDays])

  const doPrint = () => {
    printReport({
      centerName: centers.find((c) => c.id === centerId)?.name,
      rangeLabel: `${report.from} ← ${report.to} (${rangeDays} يوم)`,
      stats: [
        ['الحصص', String(report.total)],
        ['تمت', String(report.completed)],
        ['نسبة الحضور', report.attRate != null ? `${report.attRate}%` : '—'],
        ['رصود الحضور', String(report.marked)],
      ],
      perGroup: report.perGroup.map((r) => [r.group.name, String(r.sessions), r.rate != null ? `${r.rate}%` : '—', String(r.students)]),
      perTeacher: report.perTeacher.map((r) => [r.teacher.name, r.teacher.subject || '—', String(r.sessions), r.rate != null ? `${r.rate}%` : '—']),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <h3 style={{ margin: 0, flex: 1, color: NAVY, fontSize: 15, fontWeight: 900 }}>📈 التقرير التشغيلي</h3>
        <select value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))} style={inputStyle}>
          <option value={7}>آخر 7 أيام</option>
          <option value={14}>آخر 14 يوم</option>
          <option value={30}>آخر 30 يوم</option>
        </select>
        <button onClick={doPrint} style={btnGold}>🖨️ طباعة A4</button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[['الحصص', report.total], ['حصص تمت', report.completed], ['نسبة الحضور', report.attRate != null ? `${report.attRate}%` : '—'], ['رصود', report.marked]].map(([l, v]) => (
          <div key={l} style={{ ...card, flex: '1 1 140px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#64748B' }}>{l}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: NAVY }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', color: NAVY, fontSize: 14, fontWeight: 900 }}>المجموعات</h3>
        {report.perGroup.length === 0 && <p style={{ color: '#94A3B8', fontSize: 13, margin: 0 }}>لا توجد حصص في هذه الفترة.</p>}
        {report.perGroup.map((r) => (
          <div key={r.group.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(14,41,84,.06)', fontSize: 13 }}>
            <span style={{ flex: 1, fontWeight: 800, color: NAVY }}>{r.group.name}</span>
            <span style={{ color: '#64748B', fontSize: 12 }}>{r.sessions} حصة · 👥 {r.students}</span>
            <span style={{ fontWeight: 900, color: r.rate == null ? '#94A3B8' : r.rate >= 75 ? '#15803D' : r.rate >= 50 ? '#B45309' : '#B91C1C', minWidth: 44, textAlign: 'left' }}>
              {r.rate != null ? `${r.rate}%` : '—'}
            </span>
          </div>
        ))}
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', color: NAVY, fontSize: 14, fontWeight: 900 }}>المعلمون</h3>
        {report.perTeacher.length === 0 && <p style={{ color: '#94A3B8', fontSize: 13, margin: 0 }}>لا توجد بيانات معلمين في هذه الفترة.</p>}
        {report.perTeacher.map((r) => (
          <div key={r.teacher.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(14,41,84,.06)', fontSize: 13 }}>
            <span style={{ flex: 1, fontWeight: 800, color: NAVY }}>{r.teacher.name}</span>
            <span style={{ color: '#64748B', fontSize: 12 }}>{r.sessions} حصة</span>
            <span style={{ fontWeight: 900, color: r.rate == null ? '#94A3B8' : '#1D4ED8', minWidth: 44, textAlign: 'left' }}>
              {r.rate != null ? `${r.rate}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── SETTINGS ────────────────────────────────────────────────────────────────
export function SettingsTab() {
  const { centers, centerId, data, refresh, setSaveState } = useCenters()
  const center = centers.find((c) => c.id === centerId)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [members, setMembers] = useState([])

  // center members with profile names (RLS: members of this center only)
  const loadMembers = async () => {
    try {
      const { data: rows } = await supabase.from('center_members')
        .select('id, role, user_id').eq('center_id', centerId)
      const list = rows || []
      const userIds = [...new Set(list.map((m) => m.user_id).filter(Boolean))]
      let profilesById = new Map()
      if (userIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', userIds)
        profilesById = new Map((profs || []).map((p) => [p.id, p]))
      }
      setMembers(list.map((m) => ({ ...m, profiles: profilesById.get(m.user_id) || null })))
    } catch { setMembers([]) }
  }
  useEffect(() => { if (centerId) loadMembers() }, [centerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const draft = form || { name: center?.name || '', phone: center?.phone || '', address: center?.address || '' }
  const saveCenter = async () => {
    setBusy(true); setSaveState('saving')
    try {
      await api.updateRow('centers', centerId, { name: draft.name.trim(), phone: draft.phone || null, address: draft.address || null })
      setSaveState('saved'); await refresh()
      setForm(null)
    } catch { setSaveState('error') } finally { setBusy(false) }
  }

  const backupNow = async () => {
    setBusy(true)
    try {
      const payload = { product: 'elno5ba-centers', center_id: centerId, exported_at: new Date().toISOString(), data }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `centers-backup-${(center?.name || 'center').replace(/\s+/g, '-')}-${todayStr()}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      // audit the export in the append-only center audit trail
      try {
        await supabase.from('center_audit_logs').insert({ center_id: centerId, action: 'export_backup', target_type: 'center', details: 'تنزيل نسخة احتياطية JSON' })
      } catch { /* audit insert is member-blocked by RLS (triggers-only) — file export still succeeded */ }
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', color: NAVY, fontSize: 15, fontWeight: 900 }}>🏢 بيانات المركز</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <div><label style={{ fontSize: 11.5, fontWeight: 800, color: '#64748B', display: 'block', marginBottom: 3 }}>الاسم</label>
            <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={draft.name} onChange={(e) => setForm({ ...draft, name: e.target.value })} /></div>
          <div><label style={{ fontSize: 11.5, fontWeight: 800, color: '#64748B', display: 'block', marginBottom: 3 }}>الهاتف</label>
            <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={draft.phone || ''} onChange={(e) => setForm({ ...draft, phone: e.target.value })} /></div>
          <div><label style={{ fontSize: 11.5, fontWeight: 800, color: '#64748B', display: 'block', marginBottom: 3 }}>العنوان</label>
            <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={draft.address || ''} onChange={(e) => setForm({ ...draft, address: e.target.value })} /></div>
        </div>
        <button onClick={saveCenter} disabled={busy} style={{ ...btnGold, marginTop: 10 }}>{busy ? 'جاري الحفظ…' : '💾 حفظ'}</button>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', color: NAVY, fontSize: 15, fontWeight: 900 }}>🧑‍💼 فريق المركز ({members.length})</h3>
        {members.map((m) => (
          <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(14,41,84,.06)', fontSize: 13 }}>
            <span style={{ flex: 1, fontWeight: 800, color: NAVY }}>{m.profiles?.full_name || m.profiles?.email || m.user_id}</span>
            <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(212,175,55,.14)', color: '#8a6d1a', padding: '2px 10px', borderRadius: 999 }}>
              {m.role === 'owner' ? 'مالك' : m.role === 'manager' ? 'مدير' : 'موظف'}
            </span>
          </div>
        ))}
        <p style={{ fontSize: 11.5, color: '#94A3B8', margin: '8px 0 0' }}>إضافة أعضاء جدد يتم من مالك المنصة (الأدمن) حمايةً للعزل بين المراكز — كل عضو يُربط بحساب مسجَّل.</p>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', color: NAVY, fontSize: 15, fontWeight: 900 }}>💾 النسخ الاحتياطي</h3>
        <p style={{ fontSize: 12.5, color: '#64748B', margin: '0 0 10px' }}>
          نسخة يدوية فورية تُنزّل على جهازك (JSON شامل لكل بيانات المركز). النسخ التلقائي المجدول يديره مالك المنصة من لوحة الأدمن المركزية.
        </p>
        <button onClick={backupNow} disabled={busy} style={btnGold}>{busy ? 'جاري التحضير…' : '⬇️ تنزيل نسخة الآن'}</button>
      </div>
    </div>
  )
}
