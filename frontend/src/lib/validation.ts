// ─── Smart Validation Library ───────────────────────────────────────────────
// Deterministic business-logic validation. Prevents invalid data from being
// saved and explains problems clearly in Arabic.

/** Convert Arabic-Indic numerals and Persian numerals to English digits. */
export function normalizeDigits(input: string): string {
  if (!input) return ""
  const map: Record<string, string> = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  }
  return input.replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d)
}

/** Normalize a phone number: Arabic digits → English, strip spaces/dashes, keep leading +. */
export function normalizePhone(input: string): string {
  if (!input) return ""
  let s = normalizeDigits(input).trim()
  s = s.replace(/[\s\-().]/g, "")
  // Egyptian local: 01xxxxxxxxx → +201xxxxxxxxx
  if (/^01[0-9]{9}$/.test(s)) s = "+2" + s
  return s
}

export interface PhoneValidation {
  ok: boolean
  value: string
  error?: string
}

/** Validate an Egyptian phone number. Returns a clear Arabic error when invalid. */
export function validatePhone(input: string): PhoneValidation {
  if (!input || !input.trim()) return { ok: true, value: "" } // phone optional
  const v = normalizePhone(input)
  // Accept +20 followed by 10 digits (01xxxxxxxxx) OR local 01xxxxxxxxx (11 digits)
  if (!/^(\+20|0)?1[0-2,5][0-9]{8}$/.test(v.replace("+", ""))) {
    return {
      ok: false,
      value: v,
      error: "رقم الهاتف غير صحيح. تأكد من كتابة رقم مصري صحيح (مثال: 01012345678).",
    }
  }
  return { ok: true, value: v }
}

/** Validate an exam score against a max. 0 ≤ score ≤ max. */
export function validateScore(score: number, max: number): { ok: boolean; error?: string } {
  if (Number.isNaN(score)) return { ok: false, error: "الدرجة غير صحيحة." }
  if (score < 0) return { ok: false, error: `الدرجة لا يمكن أن تكون أقل من صفر.` }
  if (score > max) {
    return {
      ok: false,
      error: `الدرجة ${score} أكبر من الحد الأقصى للامتحان (${max}). الحد المسموح من 0 إلى ${max}.`,
    }
  }
  return { ok: true }
}

/** Validate an email address. */
export function validateEmail(input: string): { ok: boolean; error?: string } {
  if (!input || !input.trim()) return { ok: false, error: "البريد الإلكتروني مطلوب." }
  const v = input.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return { ok: false, error: "البريد الإلكتروني غير صحيح." }
  }
  return { ok: true }
}

/** Validate password strength. */
export function validatePassword(input: string): { ok: boolean; error?: string } {
  if (!input || input.length < 6) {
    return { ok: false, error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل." }
  }
  return { ok: true }
}

/** Validate a date string (yyyy-mm-dd) is a real calendar date and not in an obviously invalid range. */
export function validateDate(input: string): { ok: boolean; error?: string } {
  if (!input) return { ok: false, error: "التاريخ مطلوب." }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return { ok: false, error: "صيغة التاريخ غير صحيحة." }
  const d = new Date(input + "T00:00:00Z")
  if (Number.isNaN(d.getTime())) return { ok: false, error: "التاريخ غير موجود فعليًا." }
  const year = d.getUTCFullYear()
  if (year < 2000 || year > 2100) {
    return { ok: false, error: "السنة خارج النطاق المسموح." }
  }
  return { ok: true }
}

/** Validate stage name against allowed values. */
export const STAGES = ["ابتدائي", "إعدادي", "ثانوي"] as const
export type Stage = (typeof STAGES)[number]

export function validateStage(input: string): { ok: boolean; error?: string } {
  if (!input || !STAGES.includes(input as Stage)) {
    return { ok: false, error: "المرحلة غير صحيحة. اختر: ابتدائي أو إعدادي أو ثانوي." }
  }
  return { ok: true }
}

/** Build a human-readable validation error response (for API). */
export function validationError(message: string, fields?: Record<string, string>) {
  return Response.json(
    { ok: false, error: message, fields: fields ?? {} },
    { status: 400 }
  )
}

/** Generate a cryptographically random token (URL-safe). */
export function generateToken(len = 32): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}
