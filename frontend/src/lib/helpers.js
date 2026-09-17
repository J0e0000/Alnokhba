// دوال مساعدة مشتركة — نفس منطق النسخة الأصلية بالظبط

export const STAGE_CATEGORIES = ['ابتدائي', 'إعدادي', 'ثانوي']

export const GRADES_BY_STAGE = {
  'ابتدائي': ['الأول الابتدائي', 'الثاني الابتدائي'],
  'إعدادي': ['الأول الإعدادي', 'الثاني الإعدادي', 'الثالث الإعدادي'],
  'ثانوي': ['الأول الثانوي', 'الثاني الثانوي', 'الثالث الثانوي'],
}

export const CORE_GRADE_OPTIONS = Object.values(GRADES_BY_STAGE).flat()

export function generateStudentCode() {
  return 'F-' + Math.floor(10000 + Math.random() * 90000)
}

export function normalizeArabicDigits(value) {
  return String(value || '').replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
}

/**
 * Normalize an Egyptian mobile number to WhatsApp international digits.
 * Valid output is exactly 12 digits: 20 + Egyptian mobile number.
 * Examples: 01012345678 -> 201012345678; +201012345678 -> 201012345678.
 */
export function normalizeEgyptianPhone(phone) {
  let raw = normalizeArabicDigits(phone).trim().replace(/\D/g, '')
  if (raw.startsWith('00')) raw = raw.slice(2)
  if (/^201[0125]\d{8}$/.test(raw)) return raw
  if (/^01[0125]\d{8}$/.test(raw)) return `20${raw.slice(1)}`
  return ''
}

export function sanitizePhone(phone) {
  return normalizeEgyptianPhone(phone)
}

export function getWhatsAppPhoneDigits(phone) {
  return normalizeEgyptianPhone(phone)
}

export function formatWhatsAppPhone(phone) {
  const normalized = normalizeEgyptianPhone(phone)
  return normalized ? `+${normalized}` : ''
}

export function isValidPhone(phone) {
  return Boolean(normalizeEgyptianPhone(phone))
}

/**
 * Detect iOS Safari (iPhone / iPad / iPod, plus iPadOS 13+ which reports a
 * desktop Mac UA but keeps touch points). Used by the student portal to show
 * the correct "Add to Home Screen" push-notification guidance.
 *
 * FIX (Round 12 regression — the student-portal crash on every iPhone):
 * PublicQRPage.jsx called isIOSBrowser() inside a render branch guarded by
 * `typeof Notification === 'undefined'` — a branch ONLY taken on iOS Safari
 * browser tabs (Apple exposes Notification to installed Home-Screen web
 * apps). The function did not exist in the bundle, so every iPhone opening
 * a /qr/:token link threw `ReferenceError: Can't find variable:
 * isIOSBrowser` during React render and fell into the error boundary
 * ("حدثت مشكلة بسيطة"), while Android/desktop never executed the branch and
 * looked fine. It must stay exported from helpers.js and imported by every
 * caller (guarded by tests/ios-render-check.cjs).
 */
export function isIOSBrowser() {
  if (typeof navigator === 'undefined') return false
  const ua = String(navigator.userAgent || '')
  const platform = String(navigator.platform || '')
  const touchPoints = Number(navigator.maxTouchPoints || 0)
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ masquerades as desktop macOS Safari: Mac platform + real touch
  return platform === 'MacIntel' && touchPoints > 1
}

export function getStudentRank(points, ranks) {
  // FIX (portal crash): ranks can arrive malformed from the portal RPC
  // (non-array, or an array holding null/empty rows) — the old code read
  // ranks[0].title directly and threw, which crashed the whole student
  // portal into the error-boundary screen. Filter to valid rows first;
  // behavior for well-formed rank arrays is unchanged.
  if (!Array.isArray(ranks)) return ''
  const safeRanks = ranks.filter((r) => r && typeof r === 'object')
  if (safeRanks.length === 0) return ''
  let title = safeRanks[0].title
  for (const r of safeRanks) { if (points >= r.min) title = r.title }
  return title
}

export function getStudentRankPosition(studentId, allStudents) {
  const sorted = [...allStudents].sort((a, b) => b.points - a.points)
  const index = sorted.findIndex((s) => s.id === studentId)
  return index !== -1 ? index + 1 : '-'
}

// طالب فيه تراجع أكاديمي: آخر امتحانين والنسبة نزلت 15% أو أكتر
export function checkAcademicWarning(exams) {
  if (!exams || exams.length < 2) return false
  const last = exams[exams.length - 1]
  const prev = exams[exams.length - 2]
  const lastSections = Object.keys(last.section_scores || {}).length
  const prevSections = Object.keys(prev.section_scores || {}).length
  if (lastSections === 0 || prevSections === 0) return false
  const lastPct = (last.total_score / (last.max_score_per_section * lastSections)) * 100
  const prevPct = (prev.total_score / (prev.max_score_per_section * prevSections)) * 100
  return (prevPct - lastPct) >= 15
}

export function parseTemplate(templateStr, student, ranks, extraValues = {}) {
  const values = {
    studentName: student?.name || '',
    rank: getStudentRank(student?.points, ranks),
    stage: student?.stage || '',
    group: student?.group_name || '',
    ...extraValues,
  }
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value ?? '')),
    templateStr || '',
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// iOS-safe WhatsApp handoff (Round 4)
//
// Why this exists: iOS Safari (and Chrome/Edge on iPhone, which all use
// WebKit) silently drops JS-initiated WhatsApp navigation in three ways:
//   1. window.open() after any `await` — the user gesture is expired, the
//      popup blocker returns null and nothing opens.
//   2. Re-opening a NAMED window (window.open(url, 'nokhba_whatsapp')) — iOS
//      does not reliably re-navigate an existing named tab, so every send
//      after the first is a silent no-op.
//   3. The api.whatsapp.com/send host — often lands on the WhatsApp web
//      landing page instead of opening the app. wa.me is the official
//      universal link iOS opens directly into WhatsApp.
//
// The layered strategy below tries the automatic methods, and EVERY send
// also publishes the prepared link to the WhatsAppHandoffBar, which renders
// a REAL <a href> the user taps. A tapped link is browser-native navigation:
// popup blockers never apply and iOS always opens WhatsApp.
// ─────────────────────────────────────────────────────────────────────────────

const whatsappHandoffListeners = new Set()
let whatsappHandoffSeq = 0

/**
 * Subscribe to prepared WhatsApp handoffs (used by WhatsAppHandoffBar).
 * @param {(event: {id:number, waUrl:string, message:string, caption:string}) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeWhatsAppHandoff(listener) {
  whatsappHandoffListeners.add(listener)
  return () => { whatsappHandoffListeners.delete(listener) }
}

/**
 * Publish a prepared WhatsApp handoff so the global bar can render a
 * guaranteed, tappable wa.me link. Call this on EVERY send attempt.
 */
export function showWhatsAppHandoff(waUrl, meta = {}) {
  if (!waUrl) return
  whatsappHandoffSeq += 1
  const event = {
    id: whatsappHandoffSeq,
    waUrl,
    message: String(meta.message || ''),
    caption: String(meta.caption || ''),
    at: Date.now(),
  }
  whatsappHandoffListeners.forEach((listener) => {
    try { listener(event) } catch { /* listener errors must never break sends */ }
  })
}

/**
 * Touch devices (iPhone / iPad / Android). The blank reserved-window trick
 * that helps desktop popup blockers silently fails here, so we skip it.
 */
export function isHandheldBrowser() {
  try {
    const ua = navigator.userAgent || ''
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches
    return Boolean(isIOS || coarsePointer)
  } catch { return false }
}

/**
 * Build the canonical wa.me universal link. Works on iPhone (opens the app
 * directly), Android, and desktop. Returns '' when phone/message are invalid.
 */
export function buildWhatsAppUrl(phone, message) {
  const digits = getWhatsAppPhoneDigits(phone)
  if (!digits || !message) return ''
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

let whatsappWindowHandle = null

// Round 7 (honest toasts): the last automatic handoff outcome, so callers can
// tell the teacher WHEN the guaranteed path is the tappable handoff bar. On
// iPhone an async report flow (fetch → build → send) can exhaust the user
// gesture, so window.open/anchor-click silently fail and ONLY the bar's real
// <a> link opens WhatsApp — the old code still toasted "تم الإرسال" which
// looked like a lie. `needsTap` is true exactly when the caller should say
// "اضغط زر فتح واتساب" instead of "تم الإرسال".
let lastHandoffInfo = { method: '', ok: false, needsTap: false }

/**
 * Inspect how the LAST sendWhatsApp/sendReportWhatsApp call handed off.
 * @returns {{ method: string, ok: boolean, needsTap: boolean }}
 */
export function lastWhatsAppHandoffInfo() {
  return { ...lastHandoffInfo }
}

function recordHandoff(ok, method) {
  lastHandoffInfo = {
    method: method || '',
    ok: Boolean(ok),
    // The anchor-click layer is programmatic navigation — desktop browsers
    // usually allow it, but iPhone/Android popup blockers drop it whenever
    // the user gesture is gone (async flows). Only trust it on desktop.
    needsTap: !ok || (method === 'anchor_click' && isHandheldBrowser()),
  }
}

/**
 * Layered WhatsApp handoff. Order:
 *   1. Navigate the window handle we kept from a previous window.open —
 *      the opener may navigate its own popup (allowed cross-origin).
 *   2. window.open(url, '_blank') — works when still inside the user
 *      gesture (sync click handler). No named window: iOS drops those.
 *   3. Programmatic click on a real <a target="_blank"> element.
 * When every automatic layer is blocked, the WhatsAppHandoffBar (a real
 * link the user taps) is the guaranteed path.
 * @returns {{ ok: boolean, method: string }}
 */
export function openWhatsAppUrl(url) {
  if (!url) { recordHandoff(false, 'no_url'); return { ok: false, method: 'no_url' } }
  try {
    if (whatsappWindowHandle && !whatsappWindowHandle.closed) {
      whatsappWindowHandle.location.href = url
      try { whatsappWindowHandle.focus?.() } catch { /* focus is best-effort */ }
      recordHandoff(true, 'reused_window')
      return { ok: true, method: 'reused_window' }
    }
  } catch { whatsappWindowHandle = null /* handle went stale/cross-origin-blocked */ }
  try {
    const win = window.open(url, '_blank')
    if (win && !win.closed) {
      whatsappWindowHandle = win
      try { win.focus?.() } catch { /* focus is best-effort */ }
      recordHandoff(true, 'window_open')
      return { ok: true, method: 'window_open' }
    }
  } catch { /* popup blocked — try the anchor layer */ }
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    recordHandoff(true, 'anchor_click')
    return { ok: true, method: 'anchor_click' }
  } catch { /* every automatic layer failed — the handoff bar covers it */ }
  recordHandoff(false, 'blocked')
  return { ok: false, method: 'blocked' }
}

export function sendWhatsApp(phone, message) {
  const url = buildWhatsAppUrl(phone, message)
  if (!url) { recordHandoff(false, 'invalid_input'); return false }
  // Always surface the guaranteed fallback link (real <a> in the handoff bar)
  // BEFORE attempting the automatic handoff — iOS can report success while
  // nothing actually opens.
  showWhatsAppHandoff(url, { message })
  return openWhatsAppUrl(url).ok
}

export function closeReusableWhatsAppWindow() {
  try { whatsappWindowHandle?.close?.() } catch { /* already closed */ }
  whatsappWindowHandle = null
}

/**
 * Copy text to the clipboard with a legacy fallback (non-secure contexts /
 * older WebViews where navigator.clipboard is missing or rejected).
 * Returns true when the text is (very likely) on the clipboard.
 */
export async function copyToClipboard(text) {
  const value = String(text || '')
  if (!value) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, value.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}
