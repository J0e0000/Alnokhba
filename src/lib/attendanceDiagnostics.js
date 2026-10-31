/**
 * Attendance / QR operation diagnostics (Round 9).
 *
 * Internal ring buffer that records every attendance-related operation with
 * enough context to diagnose failures AFTER they happen — without ever
 * cluttering the normal UX. Successful operations are logged silently;
 * failures additionally emit a single console.warn line with a category.
 *
 * Access for developers/operators:
 *   window.__nokhbaAttendanceLog        → the full ring buffer (newest last)
 *   window.__nokhbaAttendanceLogDump()  → pretty JSON dump string
 *
 * Nothing here ever blocks or throws into the calling flow.
 */

const MAX_ENTRIES = 300
const buffer = []
let opCounter = 0

const CATEGORY_LABELS = {
  qr_decode_failed: 'QR decode failed',
  qr_unknown_format: 'QR payload not recognized',
  qr_token_lookup_failed: 'QR token lookup failed',
  qr_student_not_found: 'QR student not found',
  qr_student_other_center: 'QR student belongs to another center',
  qr_duplicate: 'Duplicate attendance attempt',
  qr_no_open_lesson: 'No open lesson for QR attendance',
  qr_camera_denied: 'Camera permission denied',
  qr_camera_unavailable: 'Camera unavailable',
  qr_payment_block: 'Payment not confirmed — entry blocked',
  qr_warning_block: 'Student blocked by warnings',
  save_failed: 'Attendance save failed',
  save_rollback: 'Optimistic state rolled back',
  save_ok: 'Attendance saved',
  neutral_ok: 'Attendance cleared to neutral',
  duplicate_guard: 'Server-side duplicate guard triggered',
  rpc_missing: 'RPC not deployed — legacy path used',
  session_restore: 'Session workspace restored after reload',
  exam_link_saved: 'Exam session link saved',
}

if (typeof window !== 'undefined') {
  window.__nokhbaAttendanceLog = buffer
  window.__nokhbaAttendanceLogDump = () => JSON.stringify(buffer, null, 2)
}

/**
 * Record one operation result.
 * @param {object} entry
 * @param {string} entry.action        mark_present | mark_absent | mark_neutral |
 *                                     qr_scan | qr_scan_file | save_exam | session_restore ...
 * @param {string} entry.result        ok | error
 * @param {string} [entry.category]    machine category (CATEGORY_LABELS keys or free text)
 * @param {object} [entry.context]     { studentRef, studentName, sessionRef, lessonId,
 *                                       actor, matchType, decodedLength, attempt, error }
 */
export function logAttendanceOp(entry) {
  try {
    const record = {
      opId: `ATT-${++opCounter}`,
      time: new Date().toISOString(),
      action: String(entry?.action || 'unknown'),
      result: entry?.result === 'error' ? 'error' : 'ok',
      category: entry?.category || (entry?.result === 'error' ? 'save_failed' : 'save_ok'),
      context: {
        studentRef: entry?.context?.studentRef || undefined,
        studentName: entry?.context?.studentName || undefined,
        sessionRef: entry?.context?.sessionRef || undefined,
        lessonId: entry?.context?.lessonId || undefined,
        actor: entry?.context?.actor || 'teacher',
        matchType: entry?.context?.matchType || undefined,
        decodedLength: entry?.context?.decodedLength || undefined,
        attempt: entry?.context?.attempt || undefined,
        error: entry?.context?.error ? String(entry.context.error).slice(0, 240) : undefined,
      },
    }
    buffer.push(record)
    if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
    if (record.result === 'error') {
      // One concise line — enough to grep, never enough to spam.
      console.warn(`[nokhba:attendance] ${CATEGORY_LABELS[record.category] || record.category} (${record.action})`, record.context.error || '')
    }
    return record
  } catch { /* diagnostics must never throw */ }
}

/** Exported for tests. */
export function getAttendanceLog() {
  return buffer
}

/** Exported for tests. */
export function clearAttendanceLog() {
  buffer.length = 0
}
