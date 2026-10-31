/**
 * QR payload parsing + student resolution (Round 9 — QR root-cause fix).
 *
 * ROOT CAUSE this module fixes:
 *   The system's own student QR cards encode the PORTAL URL
 *   (https://<site>/qr/<20-char-token>). The old scanner only matched raw
 *   student UUIDs locally, so scanning the student's actual QR card produced
 *   the misleading error "ده رابط بوابة الطالب" instead of recording
 *   attendance. Tokens ARE resolvable — `student_qr_tokens` is readable by
 *   the authenticated teacher (RLS: qr_token_public_read) and maps
 *   token → student_id.
 *
 * Supported payload shapes (any QR the system issues, on any medium):
 *   1. Full portal URL      https://al-nokhbba.vercel.app/qr/abc123...   (20-char token)
 *   2. Bare token           abc123...                                    (20 chars [a-z0-9])
 *   3. Raw student UUID     ffc215ac-a364-4de7-b2d6-b1712ea5d48f         (legacy cards)
 *
 * The QR must be DECODED first (html5-qrcode real decoder — camera or image
 * file). This module never treats a URL as "attendance proof"; it extracts
 * the opaque reference and resolves it against the database.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[a-z0-9]{20}$/

/**
 * Parse a raw decoded QR string into a structured payload.
 * Pure function — safe to unit test and reuse anywhere.
 *
 * @param {string} raw - exactly what the QR decoder returned
 * @returns {{ kind: 'url-token'|'token'|'uuid'|'unknown', token?: string, studentId?: string, url?: string }}
 */
export function parseQrPayload(raw) {
  const text = String(raw || '').trim()
  if (!text) return { kind: 'unknown' }

  // 1) Full portal URL (any host): .../qr/<token> — tolerate query/hash suffixes
  //    and uppercase tokens (some phones/OCR-ish decoders uppercase output).
  const qrPathMatch = text.match(/\/qr\/([A-Za-z0-9]+)(?:[?#].*)?$/)
  if (qrPathMatch) {
    const token = qrPathMatch[1].toLowerCase()
    if (TOKEN_RE.test(token)) return { kind: 'url-token', token, url: text }
    // /qr/<uuid> — a hypothetical direct-student link variant
    if (UUID_RE.test(qrPathMatch[1])) return { kind: 'uuid', studentId: qrPathMatch[1].toLowerCase(), url: text }
    return { kind: 'unknown', url: text }
  }

  // 2) Bare 20-char token (case-tolerant)
  if (TOKEN_RE.test(text.toLowerCase()) && /[a-z]/i.test(text)) {
    return { kind: 'token', token: text.toLowerCase() }
  }

  // 3) Raw student UUID (legacy attendance cards)
  if (UUID_RE.test(text)) return { kind: 'uuid', studentId: text.toLowerCase() }

  return { kind: 'unknown' }
}

/**
 * Resolve a parsed payload to a student of THIS workspace.
 *
 * Resolution order:
 *   uuid  → local students list (RLS-scoped: another center's student can
 *           never be in this list → "not your center" is enforced by data
 *           isolation, and the final write is re-authorized server-side by
 *           the upsert RPC anyway).
 *   token → `student_qr_tokens` lookup (server-side table, one ACTIVE token
 *           per student, unique index) → student_id → local students list.
 *           Revoked tokens resolve to nothing.
 *
 * @param {object}   params
 * @param {string}   params.raw            raw decoded QR text
 * @param {Array}    params.students       the teacher's loaded students (workspace-scoped)
 * @param {object}   params.supabase       supabase client (authenticated session)
 * @param {function} [params.onDiagnostic] optional diagnostic sink ({stage, status, details})
 * @returns {Promise<{ ok: true, student: object, matchType: 'uuid'|'token' } |
 *                    { ok: false, code: string, message: string }>}
 *          codes: EMPTY_CODE | UNKNOWN_FORMAT | TOKEN_LOOKUP_FAILED |
 *                 STUDENT_NOT_FOUND | STUDENT_OTHER_CENTER
 */
export async function resolveQrStudent({ raw, students = [], supabase, onDiagnostic }) {
  const emit = (stage, status, details) => {
    try { onDiagnostic?.({ stage, status, details, time: Date.now() }) } catch { /* diagnostics must never break the flow */ }
  }

  const payload = parseQrPayload(raw)
  emit('parse', payload.kind === 'unknown' ? 'error' : 'ok', { kind: payload.kind, rawLength: String(raw || '').length })

  if (payload.kind === 'unknown') {
    return { ok: false, code: 'UNKNOWN_FORMAT', message: 'لم نتعرف على هذا الكود — تأكد أنه كود النخبة الصحيح.' }
  }

  if (payload.kind === 'uuid') {
    const student = students.find((s) => s.id === payload.studentId)
    if (!student) {
      emit('resolve', 'error', { via: 'uuid', found: false })
      // Distinguish "no such student anywhere" from "exists but not in this
      // workspace" without leaking cross-tenant data: tokens table is the only
      // public map, so for UUIDs we simply report not-found / other-center.
      return { ok: false, code: 'STUDENT_OTHER_CENTER', message: 'هذا الكود لا ينتمي إلى مركزك — لا يمكن تسجيل الحضور.' }
    }
    emit('resolve', 'ok', { via: 'uuid', studentId: student.id })
    return { ok: true, student, matchType: 'uuid' }
  }

  // token / url-token → server-side resolution through student_qr_tokens
  const token = payload.token
  try {
    const { data, error } = await supabase
      .from('student_qr_tokens')
      .select('student_id, revoked_at')
      .eq('token', token)
      .limit(2)

    if (error) {
      emit('token_lookup', 'error', { message: String(error.message || error).slice(0, 200) })
      return { ok: false, code: 'TOKEN_LOOKUP_FAILED', message: 'تعذر التحقق من الكود من السيرفر — تأكد من الاتصال وحاول مرة أخرى.' }
    }

    const rows = data || []
    if (rows.length === 0) {
      emit('token_lookup', 'ok', { found: false })
      return { ok: false, code: 'STUDENT_NOT_FOUND', message: 'الكود غير مسجل أو تم إلغاؤه — اطلب كود QR جديد للطالب.' }
    }

    // One ACTIVE token per student (partial unique index) — prefer the active row.
    const active = rows.find((r) => !r.revoked_at) || null
    if (!active) {
      emit('token_lookup', 'ok', { found: true, revoked: true })
      return { ok: false, code: 'STUDENT_NOT_FOUND', message: 'تم إلغاء هذا الكود — اطلب كود QR جديد للطالب.' }
    }

    const student = students.find((s) => s.id === active.student_id)
    if (!student) {
      // Token is valid in the DB but the student is NOT in this teacher's
      // workspace → the QR belongs to another center.
      emit('resolve', 'error', { via: 'token', studentId: active.student_id, inWorkspace: false })
      return { ok: false, code: 'STUDENT_OTHER_CENTER', message: 'هذا الكود خاص بطالب في مركز آخر — لا يمكن تسجيل الحضور هنا.' }
    }

    emit('resolve', 'ok', { via: 'token', studentId: student.id })
    return { ok: true, student, matchType: 'token' }
  } catch (err) {
    emit('token_lookup', 'error', { message: String(err?.message || err).slice(0, 200) })
    return { ok: false, code: 'TOKEN_LOOKUP_FAILED', message: 'تعذر التحقق من الكود من السيرفر — تأكد من الاتصال وحاول مرة أخرى.' }
  }
}

/**
 * Sort students alphabetically (Arabic + English aware).
 * Used by the exam grading list and session lists.
 */
export function sortStudentsByName(list, locale = 'ar') {
  return [...(list || [])].sort((a, b) =>
    String(a?.name || '').localeCompare(String(b?.name || ''), locale, { numeric: true, sensitivity: 'base' }))
}
