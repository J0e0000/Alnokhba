/**
 * PLATFORM UPDATE — ONE-TIME WELCOME POPUP (review round 5, note #23)
 * ─────────────────────────────────────────────────────────────────────────
 * The old model (7 seeded ✨ rows per teacher in a pinned section) is RETIRED
 * per Youssef's instruction: the app now DELETES every ✨ row for the signed-in
 * teacher on load (retireUpdateNotifications) and never seeds again.
 *
 * Replacing it: ONE welcome popup, shown the first time a teacher opens the
 * platform after this update (what's new: card redesign v3, pre-printed coded
 * blanks + assign-to-student, bulk print — with a short friendly tutorial).
 * Once-per-teacher: dismissal is stored per teacher in the DB
 * (teacher_notification_events as an invisible 📌 row — same pattern as the
 * 🎴 card pool, no migration) with a localStorage fallback/mirror so the
 * popup never flashes again even offline. The ◔ header launcher re-opens the
 * tutorial on demand.
 */
import { supabase } from './supabaseClient'

export const UPDATE_MARKER = '✨'
export const POPUP_MARKER = '📌'

// Fixed namespace for the v5-style deterministic ids (any valid uuid).
const UUID_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function hex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') }

/** SHA-1(uuid_ns + ':' + name + ':' + teacherId) formatted as a uuid —
 * deterministic per (name, teacher): same inputs → same row id forever. */
export async function updateRowId(name, teacherId) {
  const key = `${UUID_NS}:${name}:${teacherId}`
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(key))
    const h = hex(new Uint8Array(buf)).slice(0, 32)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${h.slice(18, 20)}-${h.slice(20, 32)}`
  } catch {
    // No crypto.subtle (insecure context): FNV-1a fallback — still deterministic.
    let a = 0x811c9dc5, b = 0x01000193
    for (let i = 0; i < key.length; i += 1) {
      a = ((a ^ key.charCodeAt(i)) * 0x01000193) >>> 0
      b = ((b + key.charCodeAt(i)) * 0x85ebca6b) >>> 0
    }
    const h = (hex(new TextEncoder().encode(key)).slice(0, 12) + a.toString(16) + b.toString(16) + Date.UTC(2026, 0).toString(16)).padEnd(32, '0').slice(0, 32)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${h.slice(16, 18)}${h.slice(18, 20)}-${h.slice(20, 32)}`
  }
}

/* ── RETIRE legacy system rows ───────────────────────────────────────────── */

// One delete sweep per teacher per session: the old ✨ seeded notices AND
// the 🎴 card-pool bookkeeping (note #32-1: the card-linking feature was
// removed — its leftover rows must go too). Nothing re-seeds either kind.
const retiredTeachers = new Set()

export async function retireUpdateNotifications(teacherId) {
  if (!teacherId || retiredTeachers.has(teacherId)) return 0
  retiredTeachers.add(teacherId)
  let deleted = 0
  for (const prefix of [UPDATE_MARKER, '🎴']) {
    try {
      const { error, count } = await supabase
        .from('teacher_notification_events')
        .delete()
        .eq('teacher_id', teacherId)
        .like('title', `${prefix}%`)
        .select('id', { count: 'exact' })
      if (error) throw new Error(error.message)
      deleted += count || 0
    } catch (err) {
      // Non-fatal: rows are also filtered client-side everywhere, so a
      // failed sweep only means leftover rows this session — retried next.
      console.warn('[NOKHBA updates] retire sweep failed:', err?.message || err)
    }
  }
  return deleted
}

/* ── ONE-TIME welcome popup state ────────────────────────────────────────── */

// v2 (note #32): the popup copy changed (card-linking cancelled — the
// tutorial now describes the final personal-card design), so the flag is
// versioned: EVERY teacher sees the updated tutorial exactly once more,
// and a fresh dismiss is stored under the new key (also gives the reviewer
// a clean re-test path without touching the DB).
const POPUP_ROW_NAME = 'platform-update-popup-v2'

const popupRowId = (teacherId) => updateRowId(POPUP_ROW_NAME, teacherId)

const popupLocalKey = (teacherId) => `alnokhba_update_popup_done_v2_${teacherId}`

function popupLocalDismissed(teacherId) {
  try { return localStorage.getItem(popupLocalKey(teacherId)) === '1' } catch { return false }
}

/** Once-per-teacher check: localStorage answers instantly, the DB row is
 * authoritative (a fresh device must not re-show the popup — mirror back). */
export async function isUpdatePopupDismissed(teacherId) {
  if (!teacherId) return { dismissed: true }
  if (popupLocalDismissed(teacherId)) return { dismissed: true, source: 'local' }
  try {
    const id = await popupRowId(teacherId)
    const { data, error } = await supabase
      .from('teacher_notification_events')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (!error && data) {
      try { localStorage.setItem(popupLocalKey(teacherId), '1') } catch { /* private mode */ }
      return { dismissed: true, source: 'db' }
    }
    return { dismissed: false }
  } catch {
    // DB unreachable → fall back to localStorage only (it said "not seen").
    return { dismissed: false, source: 'local-fallback' }
  }
}

/** Persist dismissal: DB row first (authoritative, survives any device),
 * localStorage always (instant, offline fallback). */
export async function dismissUpdatePopup(teacherId) {
  try { localStorage.setItem(popupLocalKey(teacherId), '1') } catch { /* private mode */ }
  if (!teacherId) return 'local'
  try {
    const id = await popupRowId(teacherId)
    const { error } = await supabase
      .from('teacher_notification_events')
      .upsert({
        id,
        teacher_id: teacherId,
        event_type: 'other',
        is_read: true, // bookkeeping — must never surface as unread
        title: `${POPUP_MARKER} welcome-popup dismissed`,
        body: JSON.stringify({ dismissedAt: new Date().toISOString() }),
      }, { onConflict: 'id' })
    if (!error) return 'db'
  } catch { /* fall through — localStorage already holds the flag */ }
  return 'local'
}

/** Popup copy — what's new (card design v3, coded blank cards + assignment,
 * bulk print) as a short friendly Arabic tutorial (note #23: 3–5 steps). */
export const UPDATE_POPUP_CONTENT = {
  title: 'النخبة فيها جديد',
  subtitle: 'تحديث كروت الطلاب — شوف إيه اللي اتغير في ٤ خطوات سريعة',
  steps: [
    {
      icon: 'credit-card',
      text: 'كل طالب ليه كرت رسمي جديد: تصميم نضيف بألوان النخبة، وزوايا دائرية، ومقاس فيزا جاهز للطباعة — وجهين (الاسم والكود أمامًا و QR خلف).',
    },
    {
      icon: 'palette',
      text: 'اختار شكل الكرت اللي يعجبك: ٤ ألوان (أزرق ليلي، عاجي ذهبي، زمردي، بنفسجي) — من صفحة الطلاب → «💳 كروت QR»، واختيارك بيشتغل في كل الطبعات.',
    },
    {
      icon: 'printer',
      text: 'اطبع كروت كل الطلاب أو المحددين منهم في PDF واحد — ٨ كروت في صفحة A4 مع خطوط قص: صفحة الوجوه الأول ثم صفحة الظهراني.',
    },
    {
      icon: 'smartphone',
      text: 'QR الكرت هو نفسه رابط بوابة الطالب: الكاميرا العادية بتفتح صفحته، وكاميرا النخبة بتسجل حضوره — وكروت فارغة للتحضير متاحة برضو قبل التسجيل.',
    },
  ],
  cta: 'يلا نبدأ 🚀',
  hint: 'بتقدر ترجع للشرح ده في أي وقت من زر ◔ فوق.',
}
