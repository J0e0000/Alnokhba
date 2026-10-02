// ═══════════════════════════════════════════════════════════════════════════
// EL NO5BA CENTERS — Classes / Students & Teachers / Rooms & Operations tabs
// ═══════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import { useCenters } from './CentersStore'
import { studentsOfGroup, roomConflict, todaySessions, sessionStudentCount, api } from './centersApi'
import { NAVY } from './DashboardToday'

const inputStyle = { border: '1px solid rgba(14,41,84,.18)', borderRadius: 10, padding: '9px 11px', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
const labelStyle = { fontSize: 11.5, fontWeight: 800, color: '#64748B', display: 'block', marginBottom: 3 }
const card = { background: '#fff', border: '1px solid rgba(14,41,84,.1)', borderRadius: 14, padding: 14 }
const btnGold = { background: '#D4AF37', color: NAVY, border: 0, borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 900, cursor: 'pointer' }
const btnGhost = { background: '#fff', border: '1.5px solid rgba(14,41,84,.25)', color: NAVY, borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }

function Collapsible({ title, badge, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={card}>
      <button onClick={() => setOpen((v) => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 0, cursor: 'pointer', padding: 0, textAlign: 'right' }}>
        <span style={{ fontWeight: 900, color: NAVY, fontSize: 15, flex: 1, textAlign: 'right' }}>{title}</span>
        {badge != null && <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(212,175,55,.15)', color: '#8a6d1a', padding: '2px 10px', borderRadius: 999 }}>{badge}</span>}
        <span style={{ color: '#94A3B8', fontSize: 13 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  )
}

// ── CLASSES (groups + schedules + sessions status) ──────────────────────────
export function ClassesTab() {
  const { data, centerId, createRow, deleteRowWithUndo, enrollStudent, refresh, setFocusSessionId } = useCenters()
  const [form, setForm] = useState({ name: '', subject: '', grade: '', teacher_id: '', room_id: '', capacity: 20, weekday: 0, start: '17:00', end: '18:30' })
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(null)

  const addGroup = async () => {
    if (!form.name.trim()) return
    setBusy(true)
    try {
      await createRow('groups', {
        center_id: centerId,
        name: form.name.trim(), subject: form.subject.trim() || null, grade: form.grade.trim() || null,
        teacher_id: form.teacher_id || null, room_id: form.room_id || null, capacity: Number(form.capacity) || 20,
        schedule: [{ weekday: Number(form.weekday), start: form.start, end: form.end }],
      }, 'إنشاء مجموعة')
      setForm({ ...form, name: '', subject: '' })
    } catch { /* store surfaced the error state */ }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Collapsible title="➕ مجموعة جديدة" defaultOpen={data.groups.length === 0}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <div><label style={labelStyle}>اسم المجموعة *</label><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: رياضيات — الصف الثالث" /></div>
          <div><label style={labelStyle}>المادة</label><input style={inputStyle} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="رياضيات" /></div>
          <div><label style={labelStyle}>الصف</label><input style={inputStyle} value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="الثالث الثانوي" /></div>
          <div>
            <label style={labelStyle}>المعلم</label>
            <select style={inputStyle} value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}>
              <option value="">— بدون —</option>
              {data.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>القاعة</label>
            <select style={inputStyle} value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
              <option value="">— بدون —</option>
              {data.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div><label style={labelStyle}>اليوم</label>
            <select style={inputStyle} value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
              {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div><label style={labelStyle}>من</label><input type="time" style={inputStyle} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
          <div><label style={labelStyle}>إلى</label><input type="time" style={inputStyle} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
        </div>
        <button onClick={addGroup} disabled={busy} style={{ ...btnGold, marginTop: 10 }}>{busy ? 'جاري الإضافة…' : 'إضافة المجموعة'}</button>
      </Collapsible>

      {data.groups.map((g) => {
        const teacher = data.teachers.find((t) => t.id === g.teacher_id)
        const room = data.rooms.find((r) => r.id === g.room_id)
        const students = studentsOfGroup(data.enrollments, data.students, g.id)
        const unenrolled = data.students.filter((s) => !students.some((x) => x.id === s.id))
        const schedule = Array.isArray(g.schedule) ? g.schedule : []
        const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
        return (
          <div key={g.id} style={card}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 900, color: NAVY, fontSize: 15 }}>{g.name}</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                  {[g.subject, g.grade, teacher?.name ? `👨‍🏫 ${teacher.name}` : '', room?.name ? `🚪 ${room.name}` : ''].filter(Boolean).join(' · ')}
                </div>
                {schedule.length > 0 && (
                  <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 2 }}>
                    {schedule.map((s, i) => `${days[Number(s.weekday)] || ''} ${s.start}–${s.end}`).join(' ، ')}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(37,99,235,.08)', color: '#1D4ED8', padding: '3px 10px', borderRadius: 999 }}>👥 {students.length}</span>
              <button onClick={() => setExpanded(expanded === g.id ? null : g.id)} style={btnGhost}>{expanded === g.id ? 'إغلاق' : 'إدارة'}</button>
            </div>

            {expanded === g.id && (
              <div style={{ marginTop: 12, borderTop: '1px solid rgba(14,41,84,.08)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select style={{ ...inputStyle, maxWidth: 230 }} defaultValue="" onChange={(e) => { if (e.target.value) { enrollStudent(g.id, e.target.value).catch(() => {}); e.target.value = '' } }}>
                    <option value="">+ أضف طالبًا للمجموعة…</option>
                    {unenrolled.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <span style={{ fontSize: 11.5, color: '#94A3B8' }}>أول {Math.min(students.length, 12)} من {students.length}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {students.slice(0, 12).map((s) => {
                    const enr = data.enrollments.find((e) => e.group_id === g.id && e.student_id === s.id)
                    return (
                      <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, background: '#F1F5F9', border: '1px solid rgba(14,41,84,.08)', padding: '4px 9px', borderRadius: 999 }}>
                        {s.name}
                        {enr && <button title="إزالة من المجموعة" onClick={() => api.unenroll(enr.id).then(() => refresh()).catch(() => {})}
                          style={{ border: 0, background: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 900, padding: 0, fontSize: 12 }}>✕</button>}
                      </span>
                    )
                  })}
                </div>
                <button onClick={() => { if (window.confirm(`حذف المجموعة «${g.name}»؟ الحصص السابقة تبقى محفوظة.`)) deleteRowWithUndo('groups', g, 'حذف مجموعة').catch(() => {}) }}
                  style={{ ...btnGhost, color: '#DC2626', borderColor: 'rgba(220,38,38,.4)', alignSelf: 'flex-start' }}>
                  🗑️ حذف المجموعة (مع إمكانية التراجع)
                </button>
              </div>
            )}
          </div>
        )
      })}
      {data.groups.length === 0 && <p style={{ ...card, textAlign: 'center', color: '#64748B', fontSize: 13.5, margin: 0 }}>لا توجد مجموعات بعد — ابدأ بإضافة مجموعة فوق.</p>}
    </div>
  )
}

// ── STUDENTS & TEACHERS ─────────────────────────────────────────────────────
export function PeopleTab() {
  const { data, centerId, createRow, deleteRowWithUndo } = useCenters()
  const [student, setStudent] = useState({ name: '', phone: '', parent_phone: '', stage: '' })
  const [teacher, setTeacher] = useState({ name: '', phone: '', subject: '' })
  const [busy, setBusy] = useState(false)

  const addStudent = async () => {
    if (!student.name.trim()) return
    setBusy(true)
    try {
      await createRow('students', { center_id: centerId, name: student.name.trim(), phone: student.phone || null, parent_phone: student.parent_phone || null, stage: student.stage || null }, 'إضافة طالب')
      setStudent({ name: '', phone: '', parent_phone: '', stage: '' })
    } catch {} finally { setBusy(false) }
  }
  const addTeacher = async () => {
    if (!teacher.name.trim()) return
    setBusy(true)
    try {
      await createRow('teachers', { center_id: centerId, name: teacher.name.trim(), phone: teacher.phone || null, subject: teacher.subject || null }, 'إضافة معلم')
      setTeacher({ name: '', phone: '', subject: '' })
    } catch {} finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Collapsible title="👥 الطلاب" badge={data.students.length}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 10 }}>
          <div><label style={labelStyle}>الاسم *</label><input style={inputStyle} value={student.name} onChange={(e) => setStudent({ ...student, name: e.target.value })} /></div>
          <div><label style={labelStyle}>هاتف الطالب</label><input style={inputStyle} value={student.phone} onChange={(e) => setStudent({ ...student, phone: e.target.value })} /></div>
          <div><label style={labelStyle}>هاتف ولي الأمر</label><input style={inputStyle} value={student.parent_phone} onChange={(e) => setStudent({ ...student, parent_phone: e.target.value })} /></div>
          <div><label style={labelStyle}>المرحلة</label><input style={inputStyle} value={student.stage} onChange={(e) => setStudent({ ...student, stage: e.target.value })} /></div>
        </div>
        <button onClick={addStudent} disabled={busy} style={{ ...btnGold, marginBottom: 12 }}>{busy ? '…' : '➕ إضافة طالب'}</button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {data.students.map((s) => {
            const groupNames = data.enrollments.filter((e) => e.student_id === s.id)
              .map((e) => data.groups.find((g) => g.id === e.group_id)?.name).filter(Boolean)
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(14,41,84,.06)', padding: '7px 2px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: NAVY }}>{s.name}</div>
                  <div style={{ fontSize: 11.5, color: '#64748B' }}>
                    {[s.stage, s.phone ? `📱 ${s.phone}` : '', s.parent_phone ? `ولي الأمر: ${s.parent_phone}` : '', groupNames.length ? groupNames.join(' ، ') : 'بدون مجموعة'].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button onClick={() => { if (window.confirm(`حذف الطالب «${s.name}»؟`)) deleteRowWithUndo('students', s, 'حذف طالب').catch(() => {}) }}
                  style={{ border: 0, background: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 900 }}>🗑️</button>
              </div>
            )
          })}
          {data.students.length === 0 && <p style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', margin: '8px 0' }}>لا يوجد طلاب بعد.</p>}
        </div>
      </Collapsible>

      <Collapsible title="👨‍🏫 المعلمون" badge={data.teachers.length}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 10 }}>
          <div><label style={labelStyle}>الاسم *</label><input style={inputStyle} value={teacher.name} onChange={(e) => setTeacher({ ...teacher, name: e.target.value })} /></div>
          <div><label style={labelStyle}>الهاتف</label><input style={inputStyle} value={teacher.phone} onChange={(e) => setTeacher({ ...teacher, phone: e.target.value })} /></div>
          <div><label style={labelStyle}>المادة</label><input style={inputStyle} value={teacher.subject} onChange={(e) => setTeacher({ ...teacher, subject: e.target.value })} /></div>
        </div>
        <button onClick={addTeacher} disabled={busy} style={{ ...btnGold, marginBottom: 12 }}>{busy ? '…' : '➕ إضافة معلم'}</button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {data.teachers.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(14,41,84,.06)', padding: '7px 2px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: NAVY }}>{t.name}</div>
                <div style={{ fontSize: 11.5, color: '#64748B' }}>{[t.subject, t.phone].filter(Boolean).join(' · ')}</div>
              </div>
              <button onClick={() => { if (window.confirm(`حذف المعلم «${t.name}»؟`)) deleteRowWithUndo('teachers', t, 'حذف معلم').catch(() => {}) }}
                style={{ border: 0, background: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 900 }}>🗑️</button>
            </div>
          ))}
          {data.teachers.length === 0 && <p style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', margin: '8px 0' }}>لا يوجد معلمون بعد.</p>}
        </div>
      </Collapsible>
    </div>
  )
}

// ── ROOMS & OPERATIONS (capacity, occupancy, conflicts) ─────────────────────
export function RoomsTab() {
  const { data, centerId, createRow, deleteRowWithUndo } = useCenters()
  const [form, setForm] = useState({ name: '', capacity: 20 })
  const todays = todaySessions(data.sessions).filter((s) => s.status !== 'cancelled')

  const addRoom = async () => {
    if (!form.name.trim()) return
    try {
      await createRow('rooms', { center_id: centerId, name: form.name.trim(), capacity: Number(form.capacity) || 20 }, 'إضافة قاعة')
      setForm({ name: '', capacity: 20 })
    } catch {}
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', color: NAVY, fontSize: 15, fontWeight: 900 }}>🚪 القاعات ({data.rooms.length})</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, maxWidth: 200 }} placeholder="اسم القاعة" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input style={{ ...inputStyle, maxWidth: 110 }} type="number" min="1" placeholder="السعة" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          <button onClick={addRoom} style={btnGold}>➕ إضافة قاعة</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
          {data.rooms.map((r) => {
            const usedToday = todays.filter((s) => s.room_id === r.id)
            const conflict = usedToday.find((s) => roomConflict(todays, r.id, s.session_date, s.starts_at, s.ends_at, s.id))
            const overCap = usedToday.find((s) => sessionStudentCount(data.enrollments, s.group_id) > r.capacity)
            return (
              <div key={r.id} style={{ border: `1.5px solid ${conflict ? 'rgba(220,38,38,.45)' : 'rgba(14,41,84,.1)'}`, borderRadius: 12, padding: 12, background: conflict ? '#FEF2F2' : '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 900, color: NAVY, flex: 1, fontSize: 14 }}>🚪 {r.name}</span>
                  <button onClick={() => { if (window.confirm(`حذف القاعة «${r.name}»؟`)) deleteRowWithUndo('rooms', r, 'حذف قاعة').catch(() => {}) }}
                    style={{ border: 0, background: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 900 }}>🗑️</button>
                </div>
                <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>السعة: {r.capacity} مقعد · حصص اليوم: {usedToday.length}</div>
                {conflict && <div style={{ fontSize: 11.5, color: '#B91C1C', fontWeight: 800, marginTop: 4 }}>⚠️ تعارض مواعيد اليوم</div>}
                {overCap && <div style={{ fontSize: 11.5, color: '#B45309', fontWeight: 800, marginTop: 4 }}>⚠️ عدد طلاب أعلى من السعة</div>}
              </div>
            )
          })}
          {data.rooms.length === 0 && <p style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', gridColumn: '1/-1' }}>لا توجد قاعات بعد.</p>}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', color: NAVY, fontSize: 15, fontWeight: 900 }}>📊 إشغال اليوم</h3>
        {todays.length === 0 && <p style={{ color: '#94A3B8', fontSize: 13, margin: 0 }}>لا توجد حصص اليوم.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {todays.map((s) => {
            const room = data.rooms.find((r) => r.id === s.room_id)
            const group = data.groups.find((g) => g.id === s.group_id)
            return (
              <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, borderBottom: '1px solid rgba(14,41,84,.06)', padding: '6px 2px' }}>
                <span dir="ltr" style={{ fontWeight: 800, color: NAVY, minWidth: 92 }}>{s.starts_at}–{s.ends_at}</span>
                <span style={{ flex: 1 }}>{group?.name || '—'} → {room ? `🚪 ${room.name}` : 'بدون قاعة'}</span>
                <span style={{ color: '#64748B' }}>👥 {sessionStudentCount(data.enrollments, s.group_id)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
