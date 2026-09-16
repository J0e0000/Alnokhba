/**
 * portalRealtime — Instant (لحظي) data refresh for the student portal.
 * ============================================================================
 * WHY THIS EXISTS (Round 7):
 *   The student portal (/qr/:token) used to rely on 10-second polling, so a
 *   change the teacher just made (attendance, homework, points, finalizing a
 *   lesson, an announcement) took up to 10 seconds to appear — and nothing
 *   refreshed the page while the student's tab was hidden.
 *
 * HOW IT WORKS:
 *   Supabase Realtime `postgres_changes` cannot deliver protected-table rows
 *   to the ANONYMOUS portal client (RLS blocks SELECT for anon), so instead
 *   we use a lightweight *broadcast ping* on ONE shared topic:
 *
 *     `portal-refresh-<teacherId>`
 *
 *     1. The teacher's Dashboard subscribes to its own tables (RLS allows it)
 *        and, whenever any row changes, calls `pingPortalRefresh(teacherId)`.
 *        A ping contains NO data — just { source, at } — so nothing sensitive
 *        ever crosses the wire.
 *     2. Every open student portal of that teacher listens on the SAME topic
 *        and, on each ping, re-fetches its data through the token-secured
 *        `get_student_portal_data` RPC.
 *
 *   Broadcast events are only delivered to subscribers of the exact same
 *   channel topic — that's why BOTH sides must use `portal-refresh-<id>`
 *   verbatim (no -tx/-rx suffixes). The default `self: false` broadcast
 *   config means a sender never receives its own pings, which is exactly
 *   what we want (the dashboard has no handler anyway).
 *
 *   Because the teacher's browser is always the writer of student-visible
 *   data (attendance, lessons, announcements, points), a ping is guaranteed
 *   to fire at the exact moment data changes — giving sub-second updates.
 *   The 10s polling stays as a safety net for writes from other sources.
 *
 * SECURITY:
 *   - The channel is a public broadcast channel, but its payload carries zero
 *     student data (only a source label + timestamp).
 *   - The actual data still comes from the RPC, which validates the portal
 *     token server-side (migration_019+). A ping can only cause a portal to
 *     re-read data it is ALREADY authorized to see.
 *   - Guessing the channel requires knowing the teacher's UUID.
 */
import { supabase } from './supabaseClient'

const CHANNEL_PREFIX = 'portal-refresh-'

const channelTopicFor = (teacherId) => `${CHANNEL_PREFIX}${teacherId}`

// ── Receiver side (student portal) ──────────────────────────────────────────

/**
 * Listen for refresh pings for a teacher's students.
 * @param {string} teacherId - The teacher whose data this portal displays.
 * @param {(source?: string) => void} onRefresh - Called (debounced by caller)
 *   each time the teacher's data changes.
 * @returns {() => void} unsubscribe
 */
export function subscribePortalRefresh(teacherId, onRefresh) {
  if (!teacherId || typeof onRefresh !== 'function') return () => {}
  let lastPingAt = 0
  let channel
  try {
    channel = supabase
      .channel(channelTopicFor(teacherId))
      .on('broadcast', { event: 'refresh' }, (message) => {
        const payload = message?.payload || {}
        const at = Number(payload.at || 0)
        // Ignore strictly OLDER pings (out-of-order / late duplicates). Equal
        // timestamps are legit — two rapid changes can ping in the same ms.
        if (at && at < lastPingAt) return
        lastPingAt = at || Date.now()
        try { onRefresh(payload.source) } catch { /* listener errors must never break the channel */ }
      })
      .subscribe()
  } catch {
    return () => {}
  }
  return () => { try { supabase.removeChannel(channel) } catch { /* already closed */ } }
}

// ── Sender side (teacher dashboard) ─────────────────────────────────────────

// One subscribed sender channel per teacherId per browser tab (kept for the
// component's lifetime — removing it on every ping would drop messages).
const senderChannels = new Map()
// Pings fired before the sender channel finishes joining are buffered and
// flushed once subscribed, so the very first change is never lost.
const senderPending = new Map()

/**
 * Announce that this teacher's data changed so every open student portal
 * refreshes instantly. Fire-and-forget: failures are ignored on purpose
 * (the portal's polling remains the safety net).
 * @param {string} teacherId
 * @param {string} [source] - Label describing what changed (for debugging).
 */
export function pingPortalRefresh(teacherId, source = 'data-change') {
  if (!teacherId) return
  const payload = { source, at: Date.now() }
  let entry = senderChannels.get(teacherId)
  if (!entry) {
    let channel
    try {
      channel = supabase
        .channel(`${channelTopicFor(teacherId)}`)
        .subscribe((status) => {
          const e = senderChannels.get(teacherId)
          if (e) e.subscribed = status === 'SUBSCRIBED'
          if (status === 'SUBSCRIBED') flushPending(teacherId)
        })
    } catch { return /* realtime unavailable — polling covers it */ }
    entry = { channel, subscribed: false }
    senderChannels.set(teacherId, entry)
    senderPending.set(teacherId, [])
  }
  if (!entry.subscribed) {
    // Buffer until the channel is live (usually a few hundred ms after mount).
    const pending = senderPending.get(teacherId) || []
    pending.push(payload)
    senderPending.set(teacherId, pending)
    if (pending.length > 20) senderPending.set(teacherId, pending.slice(-20))
    return
  }
  sendPing(entry.channel, payload)
}

function flushPending(teacherId) {
  const pending = senderPending.get(teacherId)
  const entry = senderChannels.get(teacherId)
  if (!pending || !entry) return
  senderPending.set(teacherId, [])
  for (const payload of pending.slice(-5)) sendPing(entry.channel, payload)
}

function sendPing(channel, payload) {
  try { channel.send({ type: 'broadcast', event: 'refresh', payload }) } catch { /* dropped ping — polling covers it */ }
}

/**
 * Test/teardown helper — closes the cached sender channel for a teacher.
 * The Dashboard keeps its channel for its whole lifetime, so this is only
 * used by automated tests.
 */
export function _disposePortalRefreshSender(teacherId) {
  const entry = senderChannels.get(teacherId)
  if (entry) { try { supabase.removeChannel(entry.channel) } catch { /* already closed */ } }
  senderChannels.delete(teacherId)
  senderPending.delete(teacherId)
}
