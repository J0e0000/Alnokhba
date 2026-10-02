// ═══════════════════════════════════════════════════════════════════════════
// EL NO5BA CENTERS — app shell (route: /centers)
// TABS WORKFLOW: لوحة اليوم · اليوم · المجموعات · الطلاب والمعلمون · القاعات
// والتشغيل · التقارير · الإعدادات. One place for everything, obvious next
// action, Focus Mode overlay for live sessions, persistent success bar.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { CentersProvider, useCenters } from './CentersStore'
import { DashboardTab, TodayTab, NAVY } from './DashboardToday'
import { ClassesTab, PeopleTab, RoomsTab } from './ManageTabs'
import { ReportsTab, SettingsTab } from './ReportsSettings'
import FocusMode from './FocusMode'
import { createCenterApi } from './centersApi'
import { printSessionSummary } from './printCenters'
import { attendanceFor, studentsOfGroup } from './centersApi'

const GOLD = '#D4AF37'
const TABS = [
  ['dashboard', '📊 لوحة اليوم'],
  ['today', '📅 اليوم'],
  ['classes', '🎒 المجموعات'],
  ['people', '👥 الطلاب والمعلمون'],
  ['rooms', '🚪 القاعات والتشغيل'],
  ['reports', '📈 التقارير'],
  ['settings', '⚙️ الإعدادات'],
]

function SuccessBar() {
  const { successBar, setSuccessBar, undo, data, centers, centerId } = useCenters()
  if (!successBar) return null
  const session = data.sessions.find((s) => s.id === successBar.sessionId)
  const doPrint = () => {
    if (!session) return
    const group = data.groups.find((g) => g.id === session.group_id)
    const teacher = data.teachers.find((t) => t.id === session.teacher_id)
    const room = data.rooms.find((r) => r.id === session.room_id)
    printSessionSummary({
      centerName: centers.find((c) => c.id === centerId)?.name, session, group, teacher, room,
      students: studentsOfGroup(data.enrollments, data.students, session.group_id),
      attendanceRows: attendanceFor(data.attendance, session.id),
    })
  }
  const doUndo = async () => {
    await undo()
    setSuccessBar(null)
  }
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 60, background: '#F0FDF4', borderBottom: '2px solid #16A34A', padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', direction: 'rtl' }}>
      <span style={{ fontWeight: 900, color: '#166534', flex: 1, minWidth: 200, fontSize: 14 }}>✅ {successBar.message}</span>
      <button onClick={doPrint} style={{ background: GOLD, color: NAVY, border: 0, borderRadius: 10, padding: '8px 16px', fontWeight: 900, fontSize: 13, cursor: 'pointer' }}>🖨️ طباعة</button>
      <button onClick={doUndo} style={{ background: '#fff', color: NAVY, border: `1.5px solid ${NAVY}`, borderRadius: 10, padding: '8px 16px', fontWeight: 900, fontSize: 13, cursor: 'pointer' }}>↩️ تراجع</button>
      <button onClick={() => setSuccessBar(null)} title="إخفاء" style={{ background: 'none', border: 0, color: '#64748B', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>✕</button>
    </div>
  )
}

function CenterOnboarding() {
  const { refresh } = useCenters()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const create = async () => {
    if (!name.trim()) return
    setBusy(true); setErr('')
    try {
      await createCenterApi(name.trim())
      await refresh()
    } catch (e) { setErr(e?.message || 'تعذر إنشاء المركز') } finally { setBusy(false) }
  }
  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ background: '#fff', border: '1px solid rgba(14,41,84,.12)', borderRadius: 18, padding: 26, maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 34 }}>🏢</div>
        <h2 style={{ color: NAVY, fontSize: 18, fontWeight: 900, margin: '8px 0 6px' }}>أنشئ مركزك الأول</h2>
        <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 14px' }}>اسم المركز سيظهر في التقارير وواجهة الفريق.</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم المركز"
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid rgba(14,41,84,.2)', borderRadius: 12, padding: '11px 13px', fontSize: 14, marginBottom: 10 }} />
        {err && <p style={{ color: '#B91C1C', fontSize: 12.5, margin: '0 0 8px' }}>{err}</p>}
        <button onClick={create} disabled={busy || !name.trim()}
          style={{ width: '100%', background: GOLD, color: NAVY, border: 0, borderRadius: 12, padding: 13, fontSize: 15, fontWeight: 900, cursor: 'pointer' }}>
          {busy ? 'جاري الإنشاء…' : '🚀 إنشاء المركز'}
        </button>
      </div>
    </div>
  )
}

function CentersShell() {
  const { centers, centerId, setCenterId, data, loading, error, focusSessionId, historyInfo, undo, redo, refresh } = useCenters()
  const [tab, setTab] = useState('dashboard')

  // Reload when the tab becomes visible again (fresh after hours away) —
  // never resets local edits (autosave keeps everything server-side).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const body = useMemo(() => {
    switch (tab) {
      case 'dashboard': return <DashboardTab />
      case 'today': return <TodayTab />
      case 'classes': return <ClassesTab />
      case 'people': return <PeopleTab />
      case 'rooms': return <RoomsTab />
      case 'reports': return <ReportsTab />
      case 'settings': return <SettingsTab />
      default: return null
    }
  }, [tab])

  if (loading && !data.sessions.length) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#64748B', fontSize: 14 }}>جاري تحميل مركزك…</div>
  }
  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, direction: 'rtl' }}>
        <div style={{ background: '#FEF2F2', border: '1.5px solid #DC2626', borderRadius: 14, padding: 18, maxWidth: 420, textAlign: 'center' }}>
          <p style={{ margin: '0 0 10px', color: '#B91C1C', fontWeight: 800 }}>تعذر تحميل بيانات المركز</p>
          <p style={{ margin: '0 0 12px', color: '#7F1D1D', fontSize: 12.5, wordBreak: 'break-word' }}>{error}</p>
          <button onClick={() => refresh()} style={{ background: NAVY, color: '#fff', border: 0, borderRadius: 10, padding: '9px 18px', fontWeight: 800, cursor: 'pointer' }}>إعادة المحاولة</button>
        </div>
      </div>
    )
  }
  if (!centerId) return <CenterOnboarding />

  return (
    <div style={{ minHeight: '100vh', background: '#F1F5F9', direction: 'rtl', fontFamily: 'Cairo, Tahoma, sans-serif' }}>
      {/* Header */}
      <header style={{ background: `linear-gradient(135deg, ${NAVY}, #1A3A7A)`, color: '#fff', padding: '12px 16px 0' }}>
        <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 19, fontWeight: 900, color: GOLD }}>النخبة <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>| المراكز</span></div>
            <div style={{ fontSize: 12, color: '#CBD5E1', marginTop: 1 }}>
              {centers.find((c) => c.id === centerId)?.name || ''}
            </div>
          </div>
          {centers.length > 1 && (
            <select value={centerId} onChange={(e) => setCenterId(e.target.value)}
              style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 10, padding: '7px 10px', fontSize: 12.5, fontWeight: 700 }}>
              {centers.map((c) => <option key={c.id} value={c.id} style={{ color: NAVY }}>{c.name}</option>)}
            </select>
          )}
          <button onClick={() => undo().catch(() => {})} disabled={!historyInfo.canUndo} title={`تراجع: ${historyInfo.lastLabel}`}
            style={{ background: historyInfo.canUndo ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 10, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: historyInfo.canUndo ? 'pointer' : 'not-allowed' }}>
            ↩️ تراجع
          </button>
          <button onClick={() => redo().catch(() => {})} disabled={!historyInfo.canRedo}
            style={{ background: historyInfo.canRedo ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 10, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: historyInfo.canRedo ? 'pointer' : 'not-allowed' }}>
            ↪️
          </button>
        </div>
        {/* Tabs */}
        <nav style={{ maxWidth: 980, margin: '10px auto 0', display: 'flex', gap: 2, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{
                background: 'transparent', border: 0, borderBottom: tab === id ? `3px solid ${GOLD}` : '3px solid transparent',
                color: tab === id ? GOLD : '#CBD5E1', fontSize: 13, fontWeight: 800, padding: '9px 13px',
                cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
              }}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <SuccessBar />

      <main style={{ maxWidth: 980, margin: '0 auto', padding: '16px 14px 80px' }}>
        {body}
      </main>

      {focusSessionId && <FocusMode />}
    </div>
  )
}

export default function CentersApp() {
  return (
    <CentersProvider>
      <CentersShell />
    </CentersProvider>
  )
}
