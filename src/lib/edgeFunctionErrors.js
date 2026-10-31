// ═══════════════════════════════════════════════════════════════════════════
// EDGE FUNCTION ERROR DECIPHERING
// supabase-js wraps every non-2xx Edge Function response in FunctionsHttpError
// whose .message is ALWAYS the generic "Edge Function returned a non-2x status
// code" — the actual reason (unsupported action? rate limit? config? admin
// check?) lives in the response body (error.context, a standard Response).
// Reading the body turns opaque toasts into actionable Arabic messages, and
// lets callers match on the REAL server text (e.g. the legacy
// "Unsupported action" fallback for an old deployed function version).
// ═══════════════════════════════════════════════════════════════════════════

// Function genuinely unreachable (fetch-level failure / gateway 404 for a
// missing function). Deliberately NARROW: a function's own JSON error like
// "Renewal record not found" must NOT be misread as "not deployed".
const NOT_DEPLOYED_RE = /function not found|failed to send|fetch failed|non-existent/i
// Migration_049 infra referenced by the function but missing in the database —
// the operation itself is unaffected (audit is best-effort, limiter fails
// open), so this is appended as a hint rather than replacing the message.
const RATE_LIMIT_INFRA_RE = /admin_audit_logs|admin_log_audit|consume_rate_limit|edge_rate_limits/i
const RENEWALS_TABLE_RE = /subscription_renewals/i

export async function describeEdgeFunctionError(error, { functionName = 'الخدمة' } = {}) {
  const status = error?.context?.status ?? error?.status ?? null
  let detail = ''
  if (error?.context && typeof error.context.text === 'function') {
    try {
      const text = await error.context.text()
      if (text) {
        try {
          const j = JSON.parse(text)
          detail = String(j?.error || j?.message || text)
        } catch { detail = String(text) }
      }
    } catch { /* body unreadable — fall through to generic message */ }
  }
  if (!detail) detail = String(error?.message || '')
  const hay = `${detail} ${error?.message || ''}`

  const notDeployed = NOT_DEPLOYED_RE.test(hay)
  let msg
  if (notDeployed) {
    msg = `دالة ${functionName} غير منشورة (أو غير قابلة للوصول) على Supabase — انشرها من مجلد supabase/functions ثم أعد المحاولة`
  } else if (status === 401 || /missing authorization|unauthorized|invalid jwt/i.test(hay)) {
    msg = 'انتهت صلاحية الجلسة أو التوقيع غير صالح — سجّل الدخول من جديد ثم أعد المحاولة'
  } else if (status === 403 || /admin access required/i.test(hay)) {
    msg = 'هذه العملية للأدمن فقط — حسابك الحالي غير معلَّم أدمن (profiles.is_admin)'
  } else if (status === 429 || /too many/i.test(hay)) {
    msg = 'محاولات كثيرة في وقت قصير — انتظر دقيقتين ثم أعد المحاولة'
  } else if (/server configuration is incomplete/i.test(hay)) {
    msg = `إعدادات ${functionName} ناقصة على السيرفر — أعد نشر الدالة بالـ CLI (الـ secrets تُحقن تلقائيًا)`
  } else {
    msg = detail
    if (RATE_LIMIT_INFRA_RE.test(detail)) {
      msg += ' — ينقص تنفيذ migration_049 في Supabase SQL Editor (supabase/ECOSYSTEM-DEPLOYMENT.md)'
    } else if (RENEWALS_TABLE_RE.test(detail)) {
      msg += ' — جدول سجل التجديدات غير موجود: نفّذ migration سجل التجديدات في Supabase SQL Editor'
    }
  }

  const err = new Error(msg)
  err.status = status
  err.raw = detail
  err.notDeployed = notDeployed
  return err
}
