// ═══════════════════════════════════════════════════════════════════════════
// FRIENDLY SAVE ERRORS (owner request: "make the error actually tell me what
// to do and not be technical").
//
// Raw Supabase/PostgREST messages (PGRST204, 42703, JWT errors…) used to be
// shown as-is in toasts. This helper maps every known failure family to one
// short Arabic/English sentence that states what happened and the exact next
// step — never jargon. The raw message stays available as `detail` for
// support/diagnostics but is never the headline.
// ═══════════════════════════════════════════════════════════════════════════

const SCHEMA_HINT = {
  ar: 'الحفظ وقف لأن قاعدة البيانات محتاجة ترقية بسيطة (مرة واحدة بس): افتح لوحة Supabase → SQL Editor → الصق محتوى ملف «supabase/migration_047_report_template_columns.sql» (وملف migration_046 لو لسه مش متطبق) → اضغط Run. بعدها جرّب الحفظ تاني وهينفع.',
  en: 'Saving stopped because the database needs a one-time upgrade: open the Supabase dashboard → SQL Editor → paste the contents of «supabase/migration_047_report_template_columns.sql» (and migration_046 if not applied yet) → Run. Then try saving again.',
}

const AUTH_HINT = {
  ar: 'حسابك حاليًا مش مسموحله بالعملية دي. جرّب تعمل تسجيل خروج ودخول تاني — ولو المشكلة استمرت بلّغ الدعم.',
  en: 'Your account is not allowed to do this right now. Try signing out and back in — if it keeps happening, contact support.',
}

const NETWORK_HINT = {
  ar: 'مفيش اتصال بالإنترنت (أو الشبكة ضعيفة). اتأكد من الاتصال وجرّب تاني.',
  en: 'No internet connection (or the network is unstable). Check your connection and try again.',
}

const DUPLICATE_HINT = {
  ar: 'البيانات دي متسجلة قبل كده — غيّرها شوية وجرّب تاني.',
  en: 'This data already exists — change it a little and try again.',
}

const FALLBACK_HINT = {
  ar: 'حصلت مشكلة أثناء الحفظ. جرّب تاني، ولو استمرت اعمل تحديث للصفحة وحاول مرة كمان.',
  en: 'Something went wrong while saving. Try again — if it keeps happening, refresh the page and try once more.',
}

function classify(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  const m = msg.toLowerCase()

  // Missing column / stale schema cache (PGRST204, 42703) — the templates
  // modal family, verified live against production on 2026-09-22.
  if (code === 'PGRST204' || code === '42703'
    || /schema cache|could not find the .* column|does not exist/i.test(msg)) {
    return { key: 'schema', hint: SCHEMA_HINT }
  }
  // Auth / permission (401, 403, RLS, invalid JWT…)
  if (code === '42501' || code === 'PGRST301' || code === '401' || code === '403'
    || /permission denied|row-level security|invalid jwt|jwt.*expired|unauthorized/i.test(m)) {
    return { key: 'auth', hint: AUTH_HINT }
  }
  // Network layer (fetch failures usually arrive as TypeError with no code)
  if (/failed to fetch|networkerror|network error|load failed|internet|offline/i.test(m)
    || (error instanceof TypeError && !code)) {
    return { key: 'network', hint: NETWORK_HINT }
  }
  // Uniqueness conflicts
  if (code === '23505' || /duplicate key|unique constraint/i.test(m)) {
    return { key: 'duplicate', hint: DUPLICATE_HINT }
  }
  return { key: 'fallback', hint: FALLBACK_HINT }
}

/**
 * Map a failed Supabase write to a short actionable message.
 * @returns {{ text: string, detail: string, key: string }}
 *   text   — the human message (headline of the toast)
 *   detail — the original technical message, kept for diagnostics only
 */
export function describeSaveError(error, isArabic = true) {
  const { key, hint } = classify(error)
  return {
    key,
    text: isArabic ? hint.ar : hint.en,
    detail: String(error?.message || ''),
  }
}

/** Same as describeSaveError but returns just the toast string. */
export function friendlySaveErrorText(error, isArabic = true) {
  return describeSaveError(error, isArabic).text
}
