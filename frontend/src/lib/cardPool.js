/**
 * PRE-PRINTED CARD POOL (Task 68 review round 4)
 * ───────────────────────────────────────────────────────────────────────
 * Teachers print blank cards in bulk BEFORE students exist. Every card
 * carries a short 5-digit code + a QR that encodes /qr/<20-char token>.
 * Later the teacher ASSIGNS a card to a student (search by code, or
 * auto-assign next free card, or right in the new-student form) — and the
 * SAME printed QR then resolves to that student forever:
 *   • assignment inserts the card's token into student_qr_tokens bound to
 *     the student (existing teacher-insert policy, migration 014/018),
 *   • so /qr/:token (phone camera → portal) and resolve_student_by_qr
 *     (Nokhba in-app scanner → attendance) both resolve to the student.
 *
 * STORAGE: rides the existing per-teacher `teacher_notification_events`
 * table (no migration needed) as INVISIBLE rows — title marker «🎴», body
 * = JSON {code, token, assignedStudentId, assignedAt}, is_read=true so it
 * never shows as unread; the notification center filters 🎴 rows out of
 * the stream. Deterministic row id = UUID(SHA-1(code + teacherId)) →
 * DUPLICATE CODES ARE IMPOSSIBLE per teacher (id PK collision ⇒ the code
 * already exists ⇒ the printer auto-regenerates a fresh code).
 */
import { supabase } from './supabaseClient'

export const CARD_POOL_MARKER = '🎴'

function poolRowId(code, teacherId) {
  const name = `nokhba-card-pool:${code}:${teacherId}`
  // SHA-1 → UUID (deterministic). Same fallback strategy as platformUpdates.
  try {
    return crypto.subtle
      .digest('SHA-1', new TextEncoder().encode(name))
      .then((buf) => {
        const h = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${h.slice(18, 20)}-${h.slice(20, 32)}`
      })
  } catch {
    let a = 0x811c9dc5
    let b = 0x01000193
    for (let i = 0; i < name.length; i += 1) {
      a = ((a ^ name.charCodeAt(i)) * 0x01000193) >>> 0
      b = ((b + name.charCodeAt(i)) * 0x85ebca6b) >>> 0
    }
    const h = (a.toString(16) + b.toString(16) + '000000000000000000000000000000').slice(0, 32)
    return Promise.resolve(`${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${h.slice(16, 18)}${h.slice(18, 20)}-${h.slice(20, 32)}`)
  }
}

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
function newToken() {
  let t = ''
  for (let i = 0; i < 20; i += 1) t += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)]
  return t
}

function newCode() {
  return String(Math.floor(Math.random() * 100000)).padStart(5, '0')
}

const decodeBody = (row) => {
  try { return JSON.parse(row.body || '{}') } catch { return {} }
}

/**
 * Generate `count` unique blank cards for this teacher and return them as
 * { code, token, created_at } — already persisted (visible across devices,
 * survives logout). Codes are unique per teacher FOREVER: the row id is a
 * deterministic function of the code, and a collision means the code is
 * already taken → a fresh code is drawn (max 12 attempts per card).
 */
export async function generateBlankCards(teacherId, count = 8) {
  if (!teacherId) return []
  const cards = []
  for (let k = 0; k < count; k += 1) {
    let code = newCode()
    let id = await poolRowId(code, teacherId)
    // uniqueness loop: if this exact code already exists for the teacher,
    // draw again (bounded — 5-digit space vs a handful of cards).
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { data: existing } = await supabase
        .from('teacher_notification_events')
        .select('id')
        .eq('id', id)
        .maybeSingle()
      if (!existing) break
      code = newCode()
      id = await poolRowId(code, teacherId)
    }
    cards.push({ code, token: newToken(), id })
  }
  const rows = cards.map((c) => ({
    id: c.id,
    teacher_id: teacherId,
    event_type: 'other',
    is_read: true, // pool bookkeeping — never surfaces as unread
    title: `${CARD_POOL_MARKER} بطاقة ${c.code}`,
    body: JSON.stringify({ code: c.code, token: c.token, assignedStudentId: null, assignedAt: null }),
  }))
  const { error } = await supabase
    .from('teacher_notification_events')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
  return cards.map(({ code, token }) => ({ code, token }))
}

/** Fetch the whole pool (manifest-free — rows are the truth), newest first. */
export async function fetchCardPool(teacherId) {
  if (!teacherId) return []
  try {
    const { data, error } = await supabase
      .from('teacher_notification_events')
      .select('id, title, body, created_at')
      .eq('teacher_id', teacherId)
      .like('title', `${CARD_POOL_MARKER}%`)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) return []
    return (data || []).map((r) => {
      const d = decodeBody(r)
      const code = String(r.title || '').replace(CARD_POOL_MARKER, '').replace('بطاقة', '').trim()
      return { id: r.id, code, token: d.token || '', assignedStudentId: d.assignedStudentId || null, assignedAt: d.assignedAt || null, created_at: r.created_at }
    }).filter((c) => c.code && c.token)
  } catch {
    return []
  }
}

/** Find a card by its 5-digit code (exact). */
export async function findCardByCode(teacherId, code) {
  const clean = String(code || '').trim()
  if (!teacherId || !/^\d{5}$/.test(clean)) return null
  const pool = await fetchCardPool(teacherId)
  return pool.find((c) => c.code === clean) || null
}

/** Next free (unassigned) card — auto-assign support. */
export async function nextFreeCard(teacherId) {
  const pool = await fetchCardPool(teacherId)
  return pool.find((c) => !c.assignedStudentId) || null
}

/**
 * Assign a pool card to a student: inserts the card's token into
 * student_qr_tokens bound to the student (teacher-insert policy), then
 * records the assignment on the pool row. Idempotent-ish: re-assignment to
 * the same student is a no-op; assigning an already-assigned card throws.
 */
export async function assignCardToStudent(teacherId, card, studentId) {
  if (!card?.token) throw new Error('invalid-card')
  if (card.assignedStudentId && card.assignedStudentId !== studentId) {
    throw new Error('card-already-assigned')
  }
  // 1) bind the printed token to the student (idempotent: if the token row
  //    already exists for THIS student, done; another student → reject).
  const { data: existingToken } = await supabase
    .from('student_qr_tokens')
    .select('id, student_id, revoked_at')
    .eq('token', card.token)
    .maybeSingle()
  if (existingToken && existingToken.revoked_at) throw new Error('card-already-assigned')
  if (!existingToken) {
    // One ACTIVE token per student (partial unique index, migration 014):
    // assigning a printed card to a student who already has a portal token
    // revokes the old one first — the printed card becomes THE QR.
    const { data: current } = await supabase
      .from('student_qr_tokens')
      .select('id, token')
      .eq('student_id', studentId)
      .is('revoked_at', null)
      .maybeSingle()
    if (current && current.token !== card.token) {
      const { error: revErr } = await supabase
        .from('student_qr_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', current.id)
      if (revErr) throw new Error(revErr.message)
    }
    const { error } = await supabase
      .from('student_qr_tokens')
      .insert({ student_id: studentId, token: card.token })
    if (error) throw new Error(error.message)
  } else if (existingToken.student_id !== studentId) {
    throw new Error('card-already-assigned')
  }
  // 2) record the assignment on the pool row (server truth for the UI).
  const { error: updErr } = await supabase
    .from('teacher_notification_events')
    .update({
      body: JSON.stringify({ code: card.code, token: card.token, assignedStudentId: studentId, assignedAt: new Date().toISOString() }),
    })
    .eq('id', card.id)
  if (updErr) throw new Error(updErr.message)
  return { ok: true }
}
