// ═══════════════════════════════════════════════════════════════════════════
// EL NO5BA CENTERS — Dashboard + Today tabs
// Dashboard answers exactly three questions: ماذا يحدث اليوم؟ / ما الذي يحتاج
// انتباهي؟ / ما الخطوة التالية؟ — 3 KPI cards + NEXT SESSION hero.
// ═══════════════════════════════════════════════════════════════════════════
import { useMemo } from 'react'
import { useCenters } from './CentersStore'
import {
  SESSION_STATUS, todaySessions, nextSession, sessionStudentCount, studentsOfGroup, roomConflict, api,
} from './centersApi'

export const GOLD = '#D4AF37'
export const NAVY = '#0E2954'

export const STATUS_CHIP = {
  upcoming: { bg: 'rgba(37,99,235,.1)', fg: '#1D4ED8', dot: '#2563EB' },
  live: { bg: 'rgba(22,163,74,.12)', fg: '#15803D', dot: '#16A34A' },
  completed: { bg: 'rgba(100,116,139,.12)', fg: '#475569', dot: '#64748B' },
  cancelled: { bg: 'rgba(220,38,38,.1)', fg: '#B91C1C', dot: '#DC2626' },
}

export function StatusChip({ status }) {
  const s = STATUS_CHIP[status] || STATUS_CHIP.upcoming
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, background: s.bg, color: s.fg, padding: '3px 10px', borderRadius: 999 }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: s.dot }} />{SESSION_STATUS[status] || status}
    </span>
  )
}

function KpiCard({ title, value, sub }) {
  return (
    <div style={{ background: '#fff', border: '1px solid rgba(14,41,84,.1)', borderRadius: 14, padding: '12px 14px', flex: '1 1 160px', minWidth: 150 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#64748B' }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: NAVY, lineHeight: 1.15, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export function DashboardTab() {
  const { data, setFocusSessionId, refresh, centerId } = useCenters()
  const todays = todaySessions(data.sessions)
  const next = nextSession(data.sessions)

  const kpi = useMemo(() => {
    const active = todays.filter((s) => s.status !== 'cancelled')
    const completed = active.filter((s) => s.status === 'completed').length
    const live = active.filter((s) => s.status === 'live').length
    const upcoming = active.filter((s) => s.status === 'upcoming').length
    const groupIds = new Set(active.map((s) => s.group_id))
    const studentsToday = active.reduce((sum, s) => sum + sessionStudentCount(data.enrollments, s.group_id), 0)
    const roomsUsed = new Set(active.filter((s) => s.room_id).map((s) => s.room_id))
    // next room release: earliest end-time among sessions currently occupying rooms
    let release = null
    active.filter((s) => s.room_id && s.status === 'live').forEach((s) => {
      const [h, m] = String(s.ends_at || '0:0').split(':').map(Number)
      const end = h * 60 + m
      if (!release || end < release) release = end
    })
    const releaseStr = release != null ? `${String(Math.floor(release / 60)).padStart(2, '0')}:${String(release % 60).padStart(2, '0')}` : null
    return { total: active.length, completed, live, upcoming, groupCount: groupIds.size, studentsToday, roomsUsed: roomsUsed.size, releaseStr }
  }, [todays, data.enrollments])

  const nextGroup = data.groups.find((g) => g.id === next?.group_id)
  const nextTeacher = data.teachers.find((t) => t.id === next?.teacher_id)
  const nextRoom = data.rooms.find((r) => r.id === next?.room_id)
  const nextCount = next ? sessionStudentCount(data.enrollments, next.group_id) : 0

  const generateToday = async () => {
    const weekday = new Date().getDay()
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    let created = 0
    for (const g of data.groups) {
      const slots = Array.isArray(g.schedule) ? g.schedule : []
      const slot = slots.find((s) => Number(s.weekday) === weekday)
      if (!slot) continue
      const exists = data.sessions.some((s) => s.group_id === g.id && s.session_date === iso)
      if (exists) continue
      const conflict = roomConflict(data.sessions, g.room_id, iso, slot.start, slot.end, null)
      await api.addSession(centerId, {
        group_id: g.id, room_id: conflict ? null : g.room_id, teacher_id: g.teacher_id,
        session_date: iso, starts_at: slot.start, ends_at: slot.end, status: 'upcoming',
      })
      created += 1
    }
    await refresh()
    if (!created) { /* nothing due today — the button simply does nothing harmful */ }
  }

  const needsGenerate = todays.length === 0 && data.groups.some((g) => (Array.isArray(g.schedule) ? g.schedule : []).length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* EXACTLY THREE primary KPI cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KpiCard title="حصص اليوم" value={kpi.total}
          sub={`${kpi.completed} تمت${kpi.live ? ` · ${kpi.live} جارية` : ''}${kpi.upcoming ? ` · ${kpi.upcoming} قادمة` : ''}`} />
        <KpiCard title="طلاب اليوم" value={kpi.studentsToday}
          sub={`في ${kpi.groupCount} ${kpi.groupCount === 1 ? 'مجموعة' : 'مجموعات'}`} />
        <KpiCard title="القاعات قيد الاستخدام" value={`${kpi.roomsUsed} / ${data.rooms.length || 0}`}
          sub={kpi.releaseStr ? `أقرب إخلاء قاعة: ${kpi.releaseStr}` : 'لا حصص جارية الآن'} />
      </div>

      {/* NEXT SESSION — the most visible action in the app */}
      <section style={{ background: `linear-gradient(135deg, ${NAVY}, #1A3A7A)`, borderRadius: 18, padding: '18px 18px 16px', color: '#fff', boxShadow: '0 10px 30px rgba(14,41,84,.35)' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: GOLD, marginBottom: 6 }}>الجلسة التالية</div>
        {next ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 230 }}>
              <div style={{ fontSize: 21, fontWeight: 900 }}>{nextGroup?.name || 'حصة'}</div>
              <div style={{ fontSize: 13, color: '#CBD5E1', marginTop: 4 }}>
                👨‍🏫 {nextTeacher?.name || 'بدون معلم'} · 🚪 {nextRoom?.name || 'بدون قاعة'} · 👥 {nextCount} طالب
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: GOLD, marginTop: 6 }}>
                {next.starts_at} – {next.ends_at}
                {next.status === 'live' && ' · جارية الآن'}
              </div>
            </div>
            <button onClick={() => setFocusSessionId(next.id)}
              style={{ background: GOLD, color: NAVY, border: 0, borderRadius: 14, padding: '16px 30px', fontSize: 17, fontWeight: 900, cursor: 'pointer', boxShadow: '0 6px 20px rgba(212,175,55,.4)' }}>
              افتح الحصة
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 15, color: '#CBD5E1' }}>لا توجد حصص قادمة اليوم — كله تمام ✨</div>
            {needsGenerate && (
              <button onClick={generateToday}
                style={{ marginTop: 10, background: GOLD, color: NAVY, border: 0, borderRadius: 12, padding: '11px 18px', fontSize: 14, fontWeight: 900, cursor: 'pointer' }}>
                توليد حصص اليوم من الجداول
              </button>
            )}
          </div>
        )}
      </section>

      {/* What needs attention: live sessions + conflicts today */}
      {todays.some((s) => s.status === 'live') && (
        <section style={{ background: '#F0FDF4', border: '1.5px solid #16A34A', borderRadius: 14, padding: 12 }}>
          <div style={{ fontWeight: 900, color: '#15803D', fontSize: 14, marginBottom: 6 }}>🔴 حصص جارية الآن — تحت انتباهك</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {todays.filter((s) => s.status === 'live').map((s) => (
              <SessionRow key={s.id} session={s} onOpen={() => setFocusSessionId(s.id)} actionLabel="متابعة الحصة" compact />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Today tab ────────────────────────────────────────────────────────────────
export function SessionRow({ session, onOpen, actionLabel, showDate, compact }) {
  const { data } = useCenters()
  const group = data.groups.find((g) => g.id === session.group_id)
  const teacher = data.teachers.find((t) => t.id === session.teacher_id)
  const room = data.rooms.find((r) => r.id === session.room_id)
  const count = sessionStudentCount(data.enrollments, session.group_id)

  const actionByStatus = {
    upcoming: 'افتح الحصة',
    live: 'متابعة الحصة',
    completed: 'عرض النتائج',
  }
  const label = actionLabel || actionByStatus[session.status]

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid rgba(14,41,84,.1)', borderRadius: 12, padding: compact ? '8px 12px' : '11px 14px' }}>
      <div style={{ minWidth: 90, fontWeight: 900, color: NAVY, fontSize: 14 }} dir="ltr">{session.starts_at}–{session.ends_at}</div>
      <div style={{ flex: 1, minWidth: 190 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>{group?.name || 'حصة'}{showDate ? ` · ${session.session_date}` : ''}</div>
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 1 }}>
          👨‍🏫 {teacher?.name || '—'} · 🚪 {room?.name || '—'} · 👥 {count}
        </div>
      </div>
      <StatusChip status={session.status} />
      {session.status !== 'cancelled' && onOpen && (
        <button onClick={onOpen}
          style={{ background: session.status === 'completed' ? '#fff' : GOLD, color: NAVY, border: session.status === 'completed' ? `1.5px solid ${NAVY}` : 0, borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 900, cursor: 'pointer' }}>
          {label}
        </button>
      )}
    </div>
  )
}

export function TodayTab() {
  const { data, centerId, setFocusSessionId, refresh } = useCenters()
  const todays = todaySessions(data.sessions)
  const weekday = new Date().getDay()
  const todayIso = new Date()
  const iso = `${todayIso.getFullYear()}-${String(todayIso.getMonth() + 1).padStart(2, '0')}-${String(todayIso.getDate()).padStart(2, '0')}`
  const missing = data.groups.filter((g) =>
    (Array.isArray(g.schedule) ? g.schedule : []).some((s) => Number(s.weekday) === weekday) &&
    !data.sessions.some((s) => s.group_id === g.id && s.session_date === iso))

  const generate = async () => {
    for (const g of missing) {
      const slot = g.schedule.find((s) => Number(s.weekday) === weekday)
      const conflict = roomConflict(data.sessions, g.room_id, iso, slot.start, slot.end, null)
      await api.addSession(centerId, {
        group_id: g.id, room_id: conflict ? null : g.room_id, teacher_id: g.teacher_id,
        session_date: iso, starts_at: slot.start, ends_at: slot.end, status: 'upcoming',
      })
    }
    await refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: NAVY, flex: 1 }}>📅 حصص اليوم</h2>
        {missing.length > 0 && (
          <button onClick={generate} style={{ background: NAVY, color: '#fff', border: 0, borderRadius: 10, padding: '9px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
            ⚙️ توليد {missing.length} حصة من الجداول
          </button>
        )}
      </div>
      {todays.length === 0 && (
        <p style={{ background: '#fff', border: '1px dashed rgba(14,41,84,.2)', borderRadius: 12, padding: 16, fontSize: 13.5, color: '#64748B', textAlign: 'center', margin: 0 }}>
          لا توجد حصص اليوم. الحصص تتولد من جدول المجموعات، أو أضفها من تبويب «المجموعات».
        </p>
      )}
      {todays.map((s) => (
        <SessionRow key={s.id} session={s} onOpen={() => setFocusSessionId(s.id)} />
      ))}
    </div>
  )
}
