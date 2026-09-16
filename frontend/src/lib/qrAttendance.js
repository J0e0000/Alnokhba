/**
 * QR Attendance — shared resolve + validation logic (Round 9/10)
 * ------------------------------------------------------------------------
 * Both the inline QRAttendancePanel (sessions workspace) and the fullscreen
 * QRScannerModal use this module so the two surfaces behave identically.
 *
 * Server contract (migration 039, already live in production):
 *   rpc resolve_student_by_qr({ p_payload }) →
 *     { ok: true, student: {...}, already_present_today: bool }
 *     | { ok: false, error: 'not_authenticated' | 'empty_payload' |
 *         'invalid_payload' | 'unsupported_url' | 'token_invalid' |
 *         'student_not_found' | 'not_authorized' }
 *
 * The payload can be a raw student UUID, a portal URL (…/qr/TOKEN), or a
 * token from student_qr_tokens — the server handles all three shapes.
 */
import { supabase } from './supabaseClient'

const SERVER_ERROR_MESSAGES = {
  not_authenticated: 'لازم تسجل دخول تاني.',
  empty_payload: 'الكود فاضي.',
  invalid_payload: '❌ الكود غير صالح.',
  unsupported_url: '❌ ده رابط مش كود النخبة — امسح كود QR بتاع الطالب.',
  token_invalid: '❌ كود غير صالح أو منتهي — اطلب كود جديد للمدرس.',
  student_not_found: '❌ الكود غير معروف.',
  not_authorized: '⛔ الطالب ده مش في مساحة عملك.',
}

/**
 * Resolve a decoded QR payload to a student on the server.
 * Returns { err, message } on failure or { ok } on success.
 */
export async function resolveStudentByQr(payload) {
  const raw = String(payload || '').trim()
  if (!raw) return { err: 'empty', message: SERVER_ERROR_MESSAGES.empty_payload }
  let data = null
  let rpcError = null
  try {
    const res = await supabase.rpc('resolve_student_by_qr', { p_payload: raw })
    data = res.data
    rpcError = res.error
  } catch (networkError) {
    return { err: 'network', message: 'تعذر الاتصال بالسيرفر — جرب تاني.' }
  }
  if (rpcError) {
    const msg = String(rpcError.message || '')
    if (msg.includes('Could not find the function') || msg.includes('PGRST202')) {
      return {
        err: 'migration',
        message: 'خاصية مسح QR من السيرفر محتاجة Migration 039 — شغّلها من مجلد supabase.',
      }
    }
    if (msg.includes('permission denied')) {
      return { err: 'auth', message: 'لازم تسجل دخول تاني.' }
    }
    return { err: 'server', message: `تعذر التحقق من الكود: ${msg}` }
  }
  if (!data || data.ok !== true) {
    const code = data?.error || 'invalid'
    return { err: code, message: SERVER_ERROR_MESSAGES[code] || '❌ كود غير مدعوم.' }
  }
  return { ok: data }
}

/**
 * Shared pre-mark checks (warnings / payment gate). Returns
 * { blocked: true, message } | { blocked: false, needsPayment: {...} } | { ok: true, student }
 * `students` and `paymentStatuses` come from the Dashboard state.
 */
export function checkStudentEntry(merged, paymentStatuses, isArabic = true) {
  const payStatus = paymentStatuses?.find((p) => p.student_id === merged.id)
  if (
    Number(merged.warnings || 0) >= Number(payStatus?.max_warnings || 3)
    || payStatus?.blocked_by_warnings
  ) {
    return {
      blocked: true,
      message: isArabic
        ? `⛔ ${merged.name} ممنوع من الدخول بعد ${merged.warnings || 0} إنذارات`
        : `⛔ ${merged.name} is blocked after repeated warnings`,
    }
  }
  if (payStatus && payStatus.status !== 'paid') {
    const due = Math.max(0, Number(payStatus.remaining || 0))
    return { blocked: false, needsPayment: { payStatus, due } }
  }
  return { ok: true, student: merged }
}

/**
 * Full scan-to-present pipeline used by both scanner surfaces.
 * callbacks: {
 *   students, paymentStatuses, activeLessonId, isArabic,
 *   markPresent(studentId) → Promise<bool>,
 *   confirmPayment(student, payStatus, due) → Promise<bool>,
 * }
 * Returns { type: 'success'|'info'|'error', text } for the surface feedback UI.
 */
export async function handleScannedPayload(decodedText, callbacks) {
  const { students, paymentStatuses, activeLessonId, isArabic, markPresent, confirmPayment } = callbacks
  const resolution = await resolveStudentByQr(decodedText)
  if (resolution.err) return { type: 'error', text: resolution.message }

  const resolved = resolution.ok.student || {}
  if (resolution.ok.already_present_today === true) {
    return { type: 'info', text: `ℹ️ ${resolved.name || 'الطالب'} مسجل حضور النهارده بالفعل` }
  }
  // Merge with the local row (keeps warnings/points fresh) — server wins on conflicts.
  const local = students?.find((s) => s.id === resolved.id)
  const merged = { ...local, ...resolved }

  const entry = checkStudentEntry(merged, paymentStatuses, isArabic)
  if (entry.blocked) return { type: 'error', text: entry.message }

  let payText = ''
  if (entry.needsPayment) {
    const { payStatus, due } = entry.needsPayment
    const confirmed = window.confirm(
      isArabic
        ? `هل دفع ${merged.name}؟\nاضغط موافق لتسجيل الدفعة والسماح بالدخول، أو إلغاء لمنع الدخول.`
        : `Has ${merged.name} paid?\nPress OK to record the payment and allow entry, or Cancel to block entry.`,
    )
    if (!confirmed) {
      return {
        type: 'error',
        text: isArabic
          ? `💳 لم يتم تأكيد الدفع — لا يمكن تسجيل دخول ${merged.name}`
          : `💳 Payment not confirmed — ${merged.name} cannot enter`,
      }
    }
    if (confirmPayment) {
      const saved = await confirmPayment(merged, payStatus, due)
      if (!saved) {
        return {
          type: 'error',
          text: isArabic
            ? 'تعذر تسجيل الدفعة، لم يتم تسجيل الحضور.'
            : 'Payment could not be recorded; attendance was not saved.',
        }
      }
    }
    payText = isArabic ? ' | ✅ تم تأييد الدفع' : ' | ✅ Payment confirmed'
  }

  if (!activeLessonId) {
    return {
      type: 'error',
      text: isArabic
        ? 'افتح الحصة أولاً قبل مسح QR'
        : 'Open a lesson before scanning QR',
    }
  }

  const marked = await markPresent(merged.id)
  if (!marked) {
    return {
      type: 'error',
      text: isArabic
        ? `تعذر حفظ حضور ${merged.name} — حاول مرة تانية.`
        : `Could not save attendance for ${merged.name} — please try again.`,
    }
  }
  return {
    type: 'success',
    text: isArabic
      ? `✅ تم تسجيل: ${merged.name}${payText}`
      : `✅ Registered: ${merged.name}${payText}`,
  }
}

/** Normalize an Arabic/English student name for fuzzy matching (Excel import). */
export function normalizeStudentName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    // strip Arabic diacritics (tashkeel) + tatweel
    .replace(/[\u064B-\u065F\u0640]/g, '')
    // unify alef variants
    .replace(/[أإآٱ]/g, 'ا')
    // unify yaa/alef maqsura
    .replace(/[ىي]/g, 'ي')
    // unify taa marbuta
    .replace(/ة/g, 'ه')
    // collapse inner whitespace
    .replace(/\s+/g, ' ')
}
