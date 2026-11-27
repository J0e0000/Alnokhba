/**
 * PLATFORM UPDATE NOTIFICATIONS (in-app) — «شو الجديد في النخبة»
 * ─────────────────────────────────────────────────────────────────
 * Every shipped platform update produces ONE notification row PER TEACHER
 * account inside the existing `teacher_notification_events` table
 * (migration 023 — teacher_id → profiles.id, title/body/is_read/created_at,
 * RLS can_access_workspace). No WhatsApp, no email, no push — bell only.
 *
 * DELIVERY GUARANTEES
 * • Existing teachers: the app seeds missing rows on every load → unread.
 * • New teachers: first login seeds the whole manifest → all unread.
 * • Offline / logged out: rows live in Postgres → next login shows them.
 * • Duplicates: impossible — each row id is a DETERMINISTIC function of
 *   (update_key, teacher_id) (UUID v5-style SHA-1), and seeding uses
 *   INSERT … ON CONFLICT (id) IGNORE. Two devices seeding simultaneously
 *   still produce one row.
 * • Per-teacher proof: `select title, is_read, created_at from
 *   teacher_notification_events where teacher_id = X and title like '✨%'`.
 *
 * Rows are marked with the ✨ prefix in the title so the regular event
 * stream can exclude them; they render in the pinned «تحديثات النخبة»
 * section which is exempt from the session-time filter (Task 44i).
 */
import { supabase } from './supabaseClient'

export const UPDATE_MARKER = '✨'

/** The shipped-update manifest — newest first. Append-only: NEVER reuse a key. */
export const PLATFORM_UPDATES = [
  {
    key: '2026-11-qr-cards',
    icon: '💳',
    title: 'جديد: كروت الطلاب QR — كرت مطبوع بمقاس فيزا لكل طالب',
    body: 'كل طالب ليه كرت رسمي عليه QR البوابة وكود الطالب. اطبع PDF بـ 8 كروت في صفحة A4 مع خطوط قص، أو اطبع كروت جاهزة (فاضية) قبل ما تسجل الطلاب أصلاً. البطاقة العادية بتفتح صفحة الطالب، وكاميرا النخبة بتسجل حضوره.',
    hint: 'صفحة الطلاب → زر «💳 كروت QR»، أو من مودال QR للطالب «💳 كرت الطالب (فيزا)»، أو «المزيد» في شريط المحددين.',
  },
  {
    key: '2026-11-session-extra-dates',
    icon: '🗓',
    title: 'حصة واحدة بمعادين متعددة',
    body: 'سجّل الحصة مرة واحدة وضيف ليها معاد إضافي (مجموعة بمعادين في الأسبوع مثلًا). الحضور والتقارير بتحسب كل المعاديات تلقائيًا.',
    hint: 'مساحة الحصة → «معاد إضافي» جوار تاريخ الحصة، والمنصة الرئيسية بتعرض المعاديات كلها.',
  },
  {
    key: '2026-11-group-merge',
    icon: '🔀',
    title: 'دمج مجموعتين بضغطة واحدة',
    body: 'ادمج مجموعتين من غير فقدان أي بيانات: الحصص والواجبات والامتحانات والدرجات والطلاب بتتنقل كلها، ومرحلة الطلاب بتتظبط تلقائيًا.',
    hint: 'الإعدادات → المجموعات → «دمج المجموعات».',
  },
  {
    key: '2026-11-multi-group-students',
    icon: '👥',
    title: 'الطالب في أكثر من مجموعة',
    body: 'الطالب مسجّل في مجموعتين أو أكتر في نفس الوقت، والبحث والفلاتر والتقارير بتحسبه في كل مجموعاته.',
    hint: 'تعديل الطالب → «مجموعات إضافية».',
  },
  {
    key: '2026-11-context-menu-copy',
    icon: '☎️',
    title: 'قائمة إجراءات سريعة لكل طالب + نسخ الأرقام',
    body: 'زر يمين الماوس (أو ضغطة مطولة على الموبايل) على أي طالب يفتح قائمة بكل إجراءاته: السجل، التعديل، واتساب، رابط البوابة، تحديد، حذف. وتقدر تنسخ أرقام الطلاب المحددين مرة واحدة.',
    hint: 'صفحة الطلاب — كليك يمين على صف الطالب؛ زر «نسخ الأرقام» في شريط المحددين.',
  },
  {
    key: '2026-11-auto-archive',
    icon: '📦',
    title: 'أرشفة تلقائية للطلاب الغائبين',
    body: 'الطالب الغايب عن آخر حصتين بيتأرشف تلقائيًا (بدون خصم)، وترجّعه بضغطة زر لقوائم الحضور والتقارير.',
    hint: 'صفحة الطلاب → تبويب «المؤرشفون».',
  },
  {
    key: '2026-11-leaderboard',
    icon: '🏆',
    title: 'لائحة المتصدرين لطلابك',
    body: 'منصة تنافسية بالنقاط: منصة أول ٣ + ترتيب كامل وألقاب حسب رصيد النقاط، بتتحدث مع كل حصة.',
    hint: 'صفحة الطلاب → «لائحة المتصدرين».',
  },
]

// Fixed namespace for the v5-style deterministic ids (any valid uuid).
const UUID_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function hex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') }

/** SHA-1(uuid_ns + ':' + key + ':' + teacherId) formatted as a uuid —
 * deterministic per (update, teacher): same inputs → same row id forever. */
export async function updateRowId(updateKey, teacherId) {
  const name = `${UUID_NS}:${updateKey}:${teacherId}`
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(name))
    const h = hex(new Uint8Array(buf)).slice(0, 32)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${h.slice(18, 20)}-${h.slice(20, 32)}`
  } catch {
    // No crypto.subtle (insecure context): FNV-1a fallback — still deterministic.
    let a = 0x811c9dc5, b = 0x01000193
    for (let i = 0; i < name.length; i += 1) {
      a = ((a ^ name.charCodeAt(i)) * 0x01000193) >>> 0
      b = ((b + name.charCodeAt(i)) * 0x85ebca6b) >>> 0
    }
    const h = (hex(new TextEncoder().encode(name)).slice(0, 12) + a.toString(16) + b.toString(16) + Date.UTC(2026, 0).toString(16)).padEnd(32, '0').slice(0, 32)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${h.slice(16, 18)}${h.slice(18, 20)}-${h.slice(20, 32)}`
  }
}

function rowFor(u, teacherId, id) {
  return {
    id,
    teacher_id: teacherId,
    event_type: 'other',
    is_read: false,
    title: `${UPDATE_MARKER} ${u.icon} ${u.title}`,
    body: `${u.body}\n📍 ${u.hint}`,
  }
}

// Last seeding failure — surfaced in the UI (pinned section) so a silent RLS
// or FK failure can never hide the updates again (review round 2, note a).
let lastSeedError = null
export function lastSeedErrorMessage() { return lastSeedError }

// Local read-state fallback (per teacher): used when the server write fails
// (RLS / connectivity) so the UX still degrades gracefully.
const localReadKey = (teacherId) => `alnokhba_update_reads_${teacherId}`
export function localReadKeys(teacherId) {
  try { return JSON.parse(localStorage.getItem(localReadKey(teacherId)) || '[]') } catch { return [] }
}
function markUpdateReadLocal(teacherId, key) {
  try {
    const cur = localReadKeys(teacherId)
    if (!cur.includes(key)) localStorage.setItem(localReadKey(teacherId), JSON.stringify([...cur, key]))
  } catch { /* private mode — ignore */ }
}

/** Seed any missing update rows for this teacher. Duplicate-safe by
 * construction (deterministic id + on-conflict-ignore). ALWAYS returns the
 * full manifest as renderable rows: DB rows where they exist (persisted
 * read state), manifest-synthesized rows otherwise (local read state) —
 * the pinned section can never go empty again, and a failed seed is no
 * longer silent (lastSeedErrorMessage + console.error). */
export async function ensureUpdateNotifications(teacherId) {
  if (!teacherId) return []
  const ids = []
  const rows = []
  for (const u of PLATFORM_UPDATES) {
    const id = await updateRowId(u.key, teacherId)
    ids.push(id)
    rows.push(rowFor(u, teacherId, id))
  }
  let readFromDb = null
  try {
    const { error } = await supabase
      .from('teacher_notification_events')
      .insert(rows)
      .onConflict('id')
      .ignoreDuplicates()
    if (error) {
      lastSeedError = error.message
      console.error('[NOKHBA updates] seed insert failed:', error.message, '| code:', error.code || '?')
    } else {
      lastSeedError = null
    }
  } catch (err) {
    lastSeedError = err?.message || String(err)
    console.error('[NOKHBA updates] seed insert threw:', lastSeedError)
  }
  try {
    const { data, error } = await supabase
      .from('teacher_notification_events')
      .select('id, title, body, is_read, created_at')
      .in('id', ids)
    if (!error) readFromDb = new Map((data || []).map((r) => [r.id, r]))
    else if (!lastSeedError) lastSeedError = error.message
  } catch (err) {
    if (!lastSeedError) lastSeedError = err?.message || String(err)
  }
  const readLocal = new Set(localReadKeys(teacherId))
  return PLATFORM_UPDATES.map((u, i) => {
    const dbRow = readFromDb?.get(ids[i])
    if (dbRow) return { ...dbRow, key: u.key, icon: u.icon }
    const base = rowFor(u, teacherId, ids[i])
    return { ...base, key: u.key, icon: u.icon, is_read: readLocal.has(u.key), _localOnly: true }
  })
}

/** Mark one update read: prefer the server row (persisted, provable),
 * fall back to the local store when the row only exists client-side or the
 * write is rejected. Returns 'server' | 'local'. */
export async function markUpdateRead(teacherId, row) {
  if (!row?._localOnly) {
    try {
      const { error } = await supabase
        .from('teacher_notification_events')
        .update({ is_read: true })
        .eq('id', row.id)
        .eq('is_read', false)
      if (!error) return 'server'
      lastSeedError = error.message
    } catch (err) { lastSeedError = err?.message || String(err) }
  }
  if (row?.key) markUpdateReadLocal(teacherId, row.key)
  return 'local'
}
