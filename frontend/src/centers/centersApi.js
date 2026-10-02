// ═══════════════════════════════════════════════════════════════════════════
// EL NO5BA CENTERS — data layer (tenant = center)
// Every call goes through supabase-js against RLS-protected tables
// (migration_050). Isolation is enforced SERVER-SIDE by RLS: a member of
// Center A physically cannot read/write Center B rows, even by manipulating
// ids in the console — the queries below always scope by center_id AND the
// database re-checks membership. The demo adapter implements the same ops.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from '../lib/supabaseClient'

export const SESSION_STATUS = { upcoming: 'لم تبدأ', live: 'جارية الآن', completed: 'تمت', cancelled: 'ملغاة' }
export const ATT_STATUS = { present: 'حاضر', late: 'متأخر', absent: 'غائب', excused: 'إذن' }

export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const dayOffsetStr = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// "17:30" → minutes since midnight (schedule conflict checks + sorting)
export const hhmmToMin = (s) => {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

// ── centers list for the signed-in user (via membership) ────────────────────
// Two plain queries (membership → centers) instead of an FK-join select so the
// demo adapter and the live client run the identical code path. RLS scopes
// both tables server-side.
export async function listMyCenters() {
  const { data: memberships, error: mErr } = await supabase
    .from('center_members')
    .select('center_id, role')
    .order('created_at', { ascending: true })
  if (mErr) throw new Error(mErr.message)
  const rows = memberships || []
  if (!rows.length) return []
  const ids = [...new Set(rows.map((r) => r.center_id).filter(Boolean))]
  const { data: centerRows, error: cErr } = await supabase
    .from('centers')
    .select('id, name, phone, address, notes, created_at')
    .in('id', ids)
  if (cErr) throw new Error(cErr.message)
  const byId = new Map((centerRows || []).map((c) => [c.id, c]))
  return rows
    .map((r) => {
      const center = byId.get(r.center_id)
      return center ? { ...center, my_role: r.role } : null
    })
    .filter(Boolean)
}

export async function createCenterApi(name, phone) {
  const { data, error } = await supabase.rpc('create_center', { p_name: name, p_phone: phone || null })
  if (error) throw new Error(error.message)
  return data
}

// ── full workspace load (parallel; RLS scopes every row to this center) ────
export async function loadWorkspace(centerId) {
  const [rooms, teachers, students, groups, enrollments, sessions] = await Promise.all([
    supabase.from('center_rooms').select('*').eq('center_id', centerId).order('created_at'),
    supabase.from('center_teachers').select('*').eq('center_id', centerId).order('created_at'),
    supabase.from('center_students').select('*').eq('center_id', centerId).order('created_at', { ascending: false }).limit(1000),
    supabase.from('center_groups').select('*').eq('center_id', centerId).order('created_at'),
    supabase.from('center_group_students').select('id, group_id, student_id').eq('center_id', centerId).limit(5000),
    supabase.from('center_sessions').select('*').eq('center_id', centerId)
      .gte('session_date', dayOffsetStr(-14)).lte('session_date', dayOffsetStr(14))
      .order('session_date', { ascending: true }).order('starts_at').limit(400),
  ])
  const firstErr = [rooms, teachers, students, groups, enrollments, sessions].find((r) => r.error)?.error
  if (firstErr) throw new Error(firstErr.message)

  const sessionIds = (sessions.data || []).map((s) => s.id)
  let attendance = []
  if (sessionIds.length) {
    const { data, error } = await supabase.from('center_attendance')
      .select('id, session_id, student_id, status, note, updated_at')
      .eq('center_id', centerId).in('session_id', sessionIds).limit(8000)
    if (error) throw new Error(error.message)
    attendance = data || []
  }
  return {
    rooms: rooms.data || [], teachers: teachers.data || [], students: students.data || [],
    groups: groups.data || [], enrollments: enrollments.data || [],
    sessions: sessions.data || [], attendance,
  }
}

// ── attendance autosave: upsert one (session, student) pair ─────────────────
// find-then-write keeps demo-mode and live behavior identical and avoids
// relying on DB unique-conflict handling for the optimistic path.
export async function saveAttendanceRow(centerId, sessionId, studentId, status, note) {
  const { data: existing } = await supabase.from('center_attendance')
    .select('id').eq('session_id', sessionId).eq('student_id', studentId).maybeSingle()
  if (existing?.id) {
    const { error } = await supabase.from('center_attendance')
      .update({ status, note: note ?? null, updated_at: new Date().toISOString() }).eq('id', existing.id)
    if (error) throw new Error(error.message)
    return existing.id
  }
  const { data, error } = await supabase.from('center_attendance')
    .insert({ center_id: centerId, session_id: sessionId, student_id: studentId, status, note: note ?? null })
    .select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function saveSessionNotes(sessionId, notes, topic) {
  const patch = { updated_at: new Date().toISOString() }
  if (notes !== undefined) patch.notes = notes
  if (topic !== undefined) patch.topic = topic
  const { error } = await supabase.from('center_sessions').update(patch).eq('id', sessionId)
  if (error) throw new Error(error.message)
}

export async function setSessionStatus(sessionId, status) {
  const patch = { status, updated_at: new Date().toISOString() }
  if (status === 'completed') patch.completed_at = new Date().toISOString()
  if (status === 'live' || status === 'upcoming') patch.completed_at = null
  const { error } = await supabase.from('center_sessions').update(patch).eq('id', sessionId)
  if (error) throw new Error(error.message)
}

export async function setSessionTeacher(sessionId, teacherId) {
  const { error } = await supabase.from('center_sessions')
    .update({ teacher_id: teacherId || null, updated_at: new Date().toISOString() }).eq('id', sessionId)
  if (error) throw new Error(error.message)
}

export async function setSessionRoom(sessionId, roomId) {
  const { error } = await supabase.from('center_sessions')
    .update({ room_id: roomId || null, updated_at: new Date().toISOString() }).eq('id', sessionId)
  if (error) throw new Error(error.message)
}

// ── CRUD (all RLS-guarded server-side) ──────────────────────────────────────
async function insertInto(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single()
  if (error) throw new Error(error.message)
  return data
}
async function updateRow(table, id, patch) {
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}
async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export const api = {
  insertInto, updateRow, deleteRow,
  addRoom: (centerId, r) => insertInto('center_rooms', { center_id: centerId, ...r }),
  addTeacher: (centerId, r) => insertInto('center_teachers', { center_id: centerId, ...r }),
  addStudent: (centerId, r) => insertInto('center_students', { center_id: centerId, ...r }),
  addGroup: (centerId, r) => insertInto('center_groups', { center_id: centerId, ...r }),
  enroll: (centerId, groupId, studentId) => insertInto('center_group_students', { center_id: centerId, group_id: groupId, student_id: studentId }),
  unenroll: (rowId) => deleteRow('center_group_students', rowId),
  addSession: (centerId, r) => insertInto('center_sessions', { center_id: centerId, ...r }),
}

// ── derived helpers shared by tabs ──────────────────────────────────────────
export function studentsOfGroup(enrollments, students, groupId) {
  const ids = new Set(enrollments.filter((e) => e.group_id === groupId).map((e) => e.student_id))
  return students.filter((s) => ids.has(s.id))
}
export function attendanceFor(attendance, sessionId) {
  return attendance.filter((a) => a.session_id === sessionId)
}
export function sessionStudentCount(enrollments, groupId) {
  return enrollments.filter((e) => e.group_id === groupId).length
}
// Does this room already host a session overlapping [start,end) on the same date?
export function roomConflict(sessions, roomId, sessionDate, startsAt, endsAt, ignoreSessionId) {
  if (!roomId) return null
  const s0 = hhmmToMin(startsAt), e0 = hhmmToMin(endsAt)
  return sessions.find((s) =>
    s.room_id === roomId && s.session_date === sessionDate && s.id !== ignoreSessionId &&
    s.status !== 'cancelled' &&
    hhmmToMin(s.starts_at) < e0 && s0 < hhmmToMin(s.ends_at)) || null
}
// today's sessions sorted by start time
export function todaySessions(sessions) {
  const today = todayStr()
  return sessions
    .filter((s) => s.session_date === today)
    .sort((a, b) => hhmmToMin(a.starts_at) - hhmmToMin(b.starts_at))
}
// next live-or-upcoming session from now (or first remaining today)
export function nextSession(sessions, now = new Date()) {
  const todays = todaySessions(sessions).filter((s) => s.status === 'upcoming' || s.status === 'live')
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return todays.find((s) => s.status === 'live') ||
    todays.find((s) => hhmmToMin(s.ends_at) >= nowMin) ||
    todays[0] || null
}
