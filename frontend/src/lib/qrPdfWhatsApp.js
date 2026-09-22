/**
 * QR → PDF → WhatsApp integration.
 * Generates a branded student QR PDF and sends via WhatsApp.
 * Also supports WhatsApp PDF report generation and text reports.
 */

/* PERF (performance round): jspdf and qrcode used to be STATIC imports here,
   which forced both libraries (~450 KB minified combined) into the first
   bundle of EVERY page — including the parents' QR portal, which never
   generates a PDF unless the teacher-facing export button is pressed. They
   are now loaded on demand inside the functions that need them. The pure
   string/URL helpers (buildQRMessage, buildStudentQRLink, buildTextReport…)
   stay synchronous and dependency-free. */
const loadJsPDF = async () => (await import('jspdf')).default
const loadQRCode = async () => (await import('qrcode')).default
import { supabase } from './supabaseClient'
import { isValidPhone, getWhatsAppPhoneDigits, buildWhatsAppUrl, openWhatsAppUrl, showWhatsAppHandoff, isHandheldBrowser } from './helpers'

// ─────────────────────────────────────────────────────────────────────────────
// Student QR Token Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 20-char token for a student's QR link.
 */
function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const arr = crypto.getRandomValues(new Uint8Array(20))
  return Array.from(arr, (b) => chars[b % chars.length]).join('')
}

const QR_TOKEN_CACHE_PREFIX = 'nokhba_student_qr_token_v1:'
const TOKEN_PATTERN = /^[a-z0-9]{20}$/

function readCachedToken(studentId) {
  try {
    const value = localStorage.getItem(`${QR_TOKEN_CACHE_PREFIX}${studentId}`)
    return TOKEN_PATTERN.test(value || '') ? value : null
  } catch { return null }
}

function cacheToken(studentId, token) {
  if (!TOKEN_PATTERN.test(String(token || ''))) return
  try { localStorage.setItem(`${QR_TOKEN_CACHE_PREFIX}${studentId}`, token) } catch { /* storage may be unavailable */ }
}

/**
 * Return a portal link only when this browser previously received a valid
 * server-issued token. This never creates a token and never uses a student ID.
 */
export function getCachedStudentPortalLink(studentId) {
  const token = readCachedToken(studentId)
  return token ? buildStudentQRLink(token) : null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function withTimeout(promise, timeoutMs) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('qr_token_request_timeout')), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function diagnosticError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || undefined,
    status: error?.status || undefined,
    message: String(error?.message || error || 'Unknown error').slice(0, 240),
  }
}

function emitDiagnostic(onStep, stage, status = 'info', details = undefined) {
  try { onStep?.({ stage, status, details, time: Date.now() }) } catch { /* diagnostics must never break the QR flow */ }
}

/** Give Supabase Auth a moment to restore Safari's persisted session. */
async function waitForAuthSession() {
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data } = await supabase.auth.getSession()
      if (data?.session) return true
      if (attempt < 2) await sleep(350)
    }
  } catch (error) {
    console.warn('[getOrCreateStudentToken] Could not read auth session:', error)
  }
  return false
}

/**
 * Get or create a permanent QR token for a student.
 * If the student has no active token, one is created automatically.
 *
 * Strategy (in order, first success wins):
 *  1) RPC: get_or_create_student_qr_token(p_student_id)
 *     — SECURITY DEFINER function (migration_018) that bypasses RLS,
 *       checks ownership internally, and handles race conditions.
 *       This is the primary path and the most robust.
 *  2) Direct SELECT + INSERT fallback (the old path)
 *     — used if the RPC doesn't exist yet (migration_018 not applied),
 *       or if the RPC errors for any unexpected reason. Retries up to
 *       3 times with backoff to handle race conditions.
 *
 * SECURITY (migration_019):
 *   The previous "Path 3: STATELESS FALLBACK" that returned the raw
 *   student_id as a token has been REMOVED. Returning a UUID as a token
 *   was insecure because:
 *     - UUIDs are not rotatable secrets (once leaked, they cannot be revoked)
 *     - Combined with the now-removed public_read RLS policies, anyone with
 *       a student_id could read that student's data forever
 *   Now: if both the RPC and direct INSERT paths fail, we return NULL and
 *   the caller is responsible for surfacing the error to the user. The
 *   caller MUST NOT silently fall back to a bare site URL.
 *
 * @param {string} studentId - The student's UUID
 * @returns {Promise<string|null>} The token string, or null if all paths failed
 */
export async function getOrCreateStudentToken(studentId, { onStep } = {}) {
  emitDiagnostic(onStep, 'input', studentId ? 'ok' : 'error', { studentIdProvided: Boolean(studentId) })
  if (!studentId) return null

  // A previously created token is safe to reuse on this device when the
  // connection is temporarily unavailable. Creating the first token still
  // requires an authenticated online request; we never invent a token offline.
  const cachedToken = readCachedToken(studentId)
  emitDiagnostic(onStep, 'local cache', cachedToken ? 'ok' : 'info', { secureTokenCached: Boolean(cachedToken) })
  // If a token already exists locally, use it immediately during a real
  // outage. If there is no cache, do not trust navigator.onLine as a hard
  // stop: iOS can briefly report false while 4G is recovering, so the
  // bounded request retries below get a chance to recover.
  if (typeof navigator !== 'undefined' && navigator.onLine === false && cachedToken) {
    emitDiagnostic(onStep, 'network', 'info', { browserOnline: false, action: 'using_cached_secure_token' })
    emitDiagnostic(onStep, 'token', 'ok', { source: 'local_cache' })
    return cachedToken
  }
  emitDiagnostic(onStep, 'network', 'info', { browserOnline: typeof navigator === 'undefined' ? 'unknown' : navigator.onLine })

  // Safari can render the dashboard before Supabase has restored its local
  // session. Wait briefly instead of sending an unauthenticated RPC.
  const hasSession = await waitForAuthSession()
  emitDiagnostic(onStep, 'auth session', hasSession ? 'ok' : 'error', { authenticatedSessionReady: hasSession })
  if (!hasSession && cachedToken) {
    emitDiagnostic(onStep, 'token', 'ok', { source: 'local_cache_after_auth_check' })
    return cachedToken
  }
  if (!hasSession) {
    console.warn('[getOrCreateStudentToken] No authenticated session is ready')
    emitDiagnostic(onStep, 'token', 'error', { reason: 'no_authenticated_session' })
    return null
  }

  // ─── Path 1: RPC (preferred — bypasses RLS, atomic) ───
  // Weak mobile data can report online while one request times out. A retry is
  // safe because the RPC returns the same active token after the first success.
  for (let rpcAttempt = 0; rpcAttempt < 3; rpcAttempt += 1) {
    emitDiagnostic(onStep, 'secure token RPC', 'info', { attempt: rpcAttempt + 1, maxAttempts: 3 })
    try {
      const { data: rpcToken, error: rpcErr } = await withTimeout(
        supabase.rpc('get_or_create_student_qr_token', { p_student_id: studentId }),
        7000
      )

      const normalizedToken = typeof rpcToken === 'string' ? rpcToken : rpcToken?.token
      if (!rpcErr && TOKEN_PATTERN.test(String(normalizedToken || ''))) {
        cacheToken(studentId, normalizedToken)
        emitDiagnostic(onStep, 'secure token RPC', 'ok', { attempt: rpcAttempt + 1, tokenReceived: true })
        emitDiagnostic(onStep, 'token', 'ok', { source: 'server_rpc' })
        return normalizedToken
      }
      if (rpcErr) {
        const details = diagnosticError(rpcErr)
        console.warn(`[getOrCreateStudentToken] RPC failed (attempt ${rpcAttempt + 1}):`, details.message)
        emitDiagnostic(onStep, 'secure token RPC', 'error', { attempt: rpcAttempt + 1, ...details })
      } else {
        emitDiagnostic(onStep, 'secure token RPC', 'error', { attempt: rpcAttempt + 1, reason: 'invalid_token_response' })
      }
    } catch (e) {
      const details = diagnosticError(e)
      console.warn(`[getOrCreateStudentToken] RPC threw (attempt ${rpcAttempt + 1}):`, details.message)
      emitDiagnostic(onStep, 'secure token RPC', 'error', { attempt: rpcAttempt + 1, ...details })
    }
    if (rpcAttempt < 2) await sleep(450 * (rpcAttempt + 1))
  }

  // ─── Path 2: Direct SELECT + INSERT ───
  const MAX_ATTEMPTS = 3

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // 1) Try to find an existing active token
      const { data: existing, error: readErr } = await supabase
        .from('student_qr_tokens')
        .select('token')
        .eq('student_id', studentId)
        .is('revoked_at', null)
        .maybeSingle()

      if (readErr) {
        emitDiagnostic(onStep, 'direct token lookup', 'error', diagnosticError(readErr))
        // If the table doesn't exist, stop retrying — return null.
        if (String(readErr.message || '').includes('does not exist') ||
            String(readErr.code || '').includes('42P01')) {
          console.warn('[getOrCreateStudentToken] student_qr_tokens table not found — giving up')
          break
        }
        console.warn(`[getOrCreateStudentToken] read error (attempt ${attempt + 1}):`, readErr)
      }
      if (existing?.token) {
        cacheToken(studentId, existing.token)
        emitDiagnostic(onStep, 'direct token lookup', 'ok', { tokenFound: true })
        emitDiagnostic(onStep, 'token', 'ok', { source: 'server_lookup' })
        return existing.token
      }
      emitDiagnostic(onStep, 'direct token lookup', 'ok', { tokenFound: false })

      // 2) No active token — create one
      const token = generateToken()
      const { error: insertErr } = await supabase
        .from('student_qr_tokens')
        .insert({ student_id: studentId, token })

      if (!insertErr) {
        cacheToken(studentId, token)
        emitDiagnostic(onStep, 'direct token insert', 'ok', { tokenCreated: true })
        emitDiagnostic(onStep, 'token', 'ok', { source: 'server_insert' })
        return token
      }
      emitDiagnostic(onStep, 'direct token insert', 'error', diagnosticError(insertErr))

      // 3) Insert failed — could be race condition, RLS denial, or table missing.
      //    If RLS denial or table missing, retrying won't help — break early.
      const msg = String(insertErr.message || '')
      if (msg.includes('does not exist') || msg.includes('row-level security') ||
          msg.includes('policy') || String(insertErr.code || '').includes('42P01')) {
        console.warn('[getOrCreateStudentToken] INSERT denied by RLS or table missing — giving up:', msg)
        break
      }
      console.warn(`[getOrCreateStudentToken] insert error (attempt ${attempt + 1}):`, insertErr)
      await sleep(250 * (attempt + 1))

      const { data: retry } = await supabase
        .from('student_qr_tokens')
        .select('token')
        .eq('student_id', studentId)
        .is('revoked_at', null)
        .maybeSingle()

      if (retry?.token) {
        cacheToken(studentId, retry.token)
        emitDiagnostic(onStep, 'direct token retry lookup', 'ok', { tokenFound: true })
        emitDiagnostic(onStep, 'token', 'ok', { source: 'server_retry_lookup' })
        return retry.token
      }
    } catch (err) {
      const details = diagnosticError(err)
      console.error(`[getOrCreateStudentToken] unexpected error (attempt ${attempt + 1}):`, details.message)
      emitDiagnostic(onStep, 'direct token path', 'error', { attempt: attempt + 1, ...details })
      await sleep(250 * (attempt + 1))
    }
  }

  // ─── All online DB paths failed ───
  // Reuse only a token that was previously issued by the server on this device.
  // Never use a student UUID or invent a token offline.
  if (cachedToken) {
    emitDiagnostic(onStep, 'token', 'ok', { source: 'local_cache_after_retries' })
    return cachedToken
  }
  emitDiagnostic(onStep, 'token', 'error', { reason: 'all_server_paths_failed', cachedToken: false })
  console.error('[getOrCreateStudentToken] All DB paths failed — returning null. Caller must surface error to user.')
  return null
}

/**
 * The permanent, public site URL — always used for links sent to real
 * students (WhatsApp, PDFs, etc.), regardless of where this code runs.
 *
 * This means even if you generate the link while running `npm run dev`
 * on localhost, the student still gets a working https://al-nokhbba.vercel.app
 * link instead of a localhost link they can't open.
 *
 * Override with VITE_PUBLIC_SITE_URL in .env if you ever move domains.
 */
export const PUBLIC_SITE_URL = (
  import.meta.env.VITE_PUBLIC_SITE_URL || 'https://al-nokhbba.vercel.app'
).replace(/\/$/, '') // strip trailing slash if present

/**
 * Build the full student QR link: {PUBLIC_SITE_URL}/qr/{token}
 * Always points at the permanent production domain so the link works
 * for students no matter where/when it was generated.
 */
export function buildStudentQRLink(token) {
  if (!token) {
    // Programming error — caller should never pass an empty token.
    // Throw instead of silently returning the bare site URL so the
    // bug is impossible to miss.
    throw new Error('buildStudentQRLink: token is required (got empty/null)')
  }
  return `${PUBLIC_SITE_URL}/qr/${token}`
}

/**
 * One-shot helper: get (or create) the student's token, then return
 * the full portal link. Throws if the token could not be created —
 * the caller MUST catch and surface the error to the user instead of
 * falling back to the bare site URL.
 *
 * @param {string} studentId
 * @returns {Promise<string>} Full portal URL like https://.../qr/TOKEN
 */
export async function getStudentPortalLink(studentId) {
  const token = await getOrCreateStudentToken(studentId)
  if (!token) {
    throw new Error('Failed to create student portal token')
  }
  return buildStudentQRLink(token)
}

/**
 * Generate a QR code data URL encoding the student's unique QR page URL.
 * @param {string} qrUrl - The full URL to encode (e.g. https://.../qr/TOKEN)
 */
export async function generateStudentQR(qrUrl) {
  try {
    const QRCode = await loadQRCode()
    return await QRCode.toDataURL(qrUrl, {
      width: 200, margin: 4,
      color: { dark: '#142D62', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    })
  } catch (err) {
    console.error('QR generation failed:', err)
    return null
  }
}

/**
 * Generate a beautiful QR card as a canvas/dataURL (not PDF).
 * Creates a branded card with student info + QR code, returns data URL.
 * @param {object} student - Student object
 * @param {string} qrUrl - REQUIRED. The full student portal URL to encode
 *   (e.g. https://.../qr/TOKEN). Pass buildStudentQRLink(token).
 */
export async function generateStudentQRImage(student, qrUrl) {
  if (!qrUrl) {
    throw new Error('generateStudentQRImage: qrUrl is required (pass buildStudentQRLink(token))')
  }
  const url = qrUrl
  const qrDataUrl = await generateStudentQR(url)
  if (!qrDataUrl) return { dataUrl: null }

  const html2canvas = (await import('html2canvas-pro')).default
  const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })

  const container = document.createElement('div')
  container.setAttribute('dir', 'rtl')
  container.style.cssText = `
    position: fixed; top: 0; left: 0;
    width: ${Math.max(280, Math.min(400, (window.innerWidth || 400) - 32))}px; padding: 0;
    opacity: 0.01; pointer-events: none; z-index: -1;
    font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
    background: #ffffff;
    direction: rtl;
  `

  container.innerHTML = `
    <div style="border: 3px solid #142D62; border-radius: 20px; padding: 28px; position: relative; overflow: hidden; background: linear-gradient(180deg, #ffffff 0%, #F8FAFC 100%);">
      <div style="position: absolute; top: 0; right: 0; width: 60px; height: 60px; border-bottom: 3px solid #F59E0B; border-left: 3px solid #F59E0B; border-bottom-left-radius: 20px;"></div>
      <div style="position: absolute; bottom: 0; left: 0; width: 60px; height: 60px; border-top: 3px solid #F59E0B; border-right: 3px solid #F59E0B; border-top-right-radius: 20px;"></div>
      <div style="text-align: center; padding-bottom: 16px; margin-bottom: 16px; border-bottom: 2px solid #F59E0B;">
        <div style="font-size: 28px; font-weight: 900; color: #142D62; margin-bottom: 4px;">النخبة</div>
        <div style="font-size: 12px; color: #64748B;">إدارة الحصص الذكية</div>
      </div>
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="font-size: 22px; font-weight: 800; color: #142D62; line-height: 1.3;">${escapeReportHtml(student.name)}</div>
        <div style="display: inline-block; background: #FEF3C7; color: #D97706; font-size: 11px; font-weight: 700; padding: 3px 12px; border-radius: 20px; margin-top: 6px;">طالب</div>
        ${student.stage ? `<div style="color: #64748B; font-size: 13px; margin-top: 6px;">${escapeReportHtml(student.stage)}${student.group_name ? ' · ' + escapeReportHtml(student.group_name) : ''}</div>` : ''}
        ${student.code ? `<div style="color: #94A3B8; font-size: 11px; margin-top: 2px; font-family: monospace;">${escapeReportHtml(student.code)}</div>` : ''}
      </div>
      <div style="display: flex; justify-content: center; margin-bottom: 16px;">
        <div style="border: 3px solid #F59E0B; border-radius: 14px; padding: 10px; background: white; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
          <img src="${qrDataUrl}" style="width: 180px; height: 180px; display: block;" />
        </div>
      </div>
      <div style="text-align: center; color: #142D62; font-size: 13px; font-weight: 700; padding-top: 14px; border-top: 1px solid #E2E8F0;">
        📷 امسح لتسجيل الحضور
      </div>
      <div style="text-align: center; color: #94A3B8; font-size: 10px; margin-top: 8px;">${today}</div>
    </div>
  `

  document.body.appendChild(container)
  try {
    const images = Array.from(container.querySelectorAll('img'))
    await Promise.all(images.map((img) => img.decode?.().catch(() => undefined)))
    const canvas = await html2canvas(container, {
      scale: Math.min(3, Math.max(2, window.devicePixelRatio || 2)),
      width: container.scrollWidth,
      height: container.scrollHeight,
      windowWidth: container.scrollWidth,
      windowHeight: container.scrollHeight,
      useCORS: true,
      imageTimeout: 15000,
      backgroundColor: '#ffffff',
    })
    const dataUrl = canvas.toDataURL('image/png', 0.95)
    return { dataUrl }
  } finally {
    document.body.removeChild(container)
  }
}

/**
 * Send a QR card image via WhatsApp.
 * Opens WhatsApp with a message telling the parent an image will be shared.
 */
/**
 * Build the QR WhatsApp message with the student's unique link.
 * @param {string} studentName
 * @param {string} studentLink - Full URL e.g. https://.../qr/TOKEN
 * @returns {string}
 */
export function buildQRMessage(studentName, studentLink, template) {
  const raw = template || 'أهلًا يا {studentName} 👋\nدي بوابتك الشخصية في النخبة:\n{link}\nهتتابع منها حضورك ونقاطك ورتبتك كل ما تتقدم. احفظ اللينك عندك ✅'
  const withName = raw.replaceAll('{studentName}', studentName)
  return withName.includes('{link}') ? withName.replaceAll('{link}', studentLink) : `${withName}\n${studentLink}`
}

function isSecureStudentLink(studentLink) {
  try {
    const url = new URL(studentLink)
    const token = url.pathname.split('/').filter(Boolean).pop()
    return url.origin === new URL(PUBLIC_SITE_URL).origin && url.pathname.startsWith('/qr/') && TOKEN_PATTERN.test(token || '')
  } catch { return false }
}

/**
 * Send QR link via WhatsApp.
 * Opens WhatsApp with a pre-filled message containing the student's unique QR link.
 * @param {string} phone - Phone number
 * @param {string} studentName
 * @param {string} studentLink - Full URL e.g. https://.../qr/TOKEN
 * @returns {string|false} WhatsApp URL or false
 */
export function openWhatsAppPlaceholder() {
  // The blank reserved window only helps DESKTOP popup blockers (reserve a
  // named tab during the click, navigate it after the async work). On
  // iPhone/touch devices it silently fails to hand off to the WhatsApp app
  // and strands a blank tab, so we skip it there entirely — the layered
  // handoff + WhatsAppHandoffBar cover those devices instead.
  if (isHandheldBrowser()) return null
  try {
    const popup = window.open('', 'nokhba_whatsapp')
    if (popup && !popup.closed) return popup
  } catch { /* popup blocked; layered handoff + fallback bar will be used */ }
  return null
}

function handoffToWhatsApp(waUrl, reservedWindow = null, onStep) {
  // Desktop-only reserved window (openWhatsAppPlaceholder returns null on
  // handheld devices, so this branch is skipped there by design).
  try {
    if (reservedWindow && !reservedWindow.closed) {
      reservedWindow.location.href = waUrl
      reservedWindow.focus?.()
      emitDiagnostic(onStep, 'WhatsApp handoff', 'ok', { method: 'reserved_window' })
      return true
    }
  } catch (error) {
    emitDiagnostic(onStep, 'WhatsApp handoff', 'error', { method: 'reserved_window', ...diagnosticError(error) })
  }

  // iOS-safe layered handoff: kept window handle → fresh window.open →
  // real anchor click. The WhatsAppHandoffBar (real <a> link the user taps)
  // is the guaranteed path when all automatic layers are blocked.
  const result = openWhatsAppUrl(waUrl)
  emitDiagnostic(onStep, 'WhatsApp handoff', result.ok ? 'ok' : 'error', { method: result.method })
  return result.ok
}

/**
 * Build the wa.me URL for a student QR message WITHOUT opening anything.
 * Used by the message queue, which renders the URL as a real <a> link the
 * user taps (native navigation — iOS Safari never blocks it).
 * @returns {string} wa.me URL or '' when validation fails
 */
export function buildQRWhatsAppUrl(phone, studentName, studentLink, template, { onStep } = {}) {
  const cleanPhone = getWhatsAppPhoneDigits(phone)
  const phoneValid = Boolean(cleanPhone && isValidPhone(phone))
  emitDiagnostic(onStep, 'phone validation', phoneValid ? 'ok' : 'error', { provided: Boolean(phone), valid: phoneValid, normalizedDigits: cleanPhone ? cleanPhone.length : 0 })
  if (!phoneValid || !studentLink) {
    emitDiagnostic(onStep, 'input validation', 'error', { secureLinkProvided: Boolean(studentLink) })
    return ''
  }

  const linkValid = isSecureStudentLink(studentLink)
  emitDiagnostic(onStep, 'secure portal link', linkValid ? 'ok' : 'error', { valid: linkValid, path: linkValid ? '/qr/{token}' : 'invalid' })
  if (!linkValid) return ''

  const message = buildQRMessage(studentName, studentLink, template)
  const linkCount = (message.match(/https?:\/\/[^\s]+\/qr\/[a-z0-9]{20}/g) || []).length
  const messageValid = linkCount === 1
  emitDiagnostic(onStep, 'message composition', messageValid ? 'ok' : 'error', { hasStudentName: message.includes(String(studentName || '')), securePortalLinkCount: linkCount, messageLength: message.length })
  if (!messageValid) return ''

  const waUrl = buildWhatsAppUrl(cleanPhone, message)
  emitDiagnostic(onStep, 'WhatsApp URL', waUrl ? 'ok' : 'error', { host: 'wa.me', queryTextEncoded: true })
  return waUrl
}

export function sendQRViaWhatsApp(phone, studentName, studentLink, template, reservedWindow = null, { onStep } = {}) {
  const waUrl = buildQRWhatsAppUrl(phone, studentName, studentLink, template, { onStep })
  if (!waUrl) return false

  // Always surface the guaranteed fallback (real <a> link in the handoff
  // bar) BEFORE attempting the automatic handoff — iOS can report success
  // while nothing actually opens.
  showWhatsAppHandoff(waUrl, { caption: String(studentName || '') })
  return handoffToWhatsApp(waUrl, reservedWindow, onStep) ? waUrl : false
}

/**
 * @deprecated Use sendQRViaWhatsApp instead
 */
export function sendQRImageToWhatsApp(phone, studentName, studentLink, template) {
  return sendQRViaWhatsApp(phone, studentName, studentLink, template)
}

/**
 * Generate a branded PDF with student info and QR code.
 * Uses the same design system: navy + gold + Cairo font.
 */
export async function generateStudentQRPDF(student, qrDataUrl) {
  const jsPDF = await loadJsPDF()
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'A5',
  })

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // Navy background
  doc.setFillColor(14, 41, 84)
  doc.rect(0, 0, pageW, pageH, 'F')

  // Gold accent border
  doc.setDrawColor(245, 197, 66)
  doc.setLineWidth(2)
  doc.rect(8, 8, pageW - 16, pageH - 16)

  // Logo / Title area
  doc.setTextColor(245, 197, 66)
  doc.setFontSize(20)
  try { doc.setFont('Cairo', 'bold') } catch { /* fallback to default */ }
  doc.text('النخبة', pageW / 2, 25, { align: 'center' })

  doc.setFontSize(9)
  doc.setTextColor(200, 200, 200)
  doc.text('إدارة الحصص الذكية', pageW / 2, 32, { align: 'center' })

  // Divider line
  doc.setDrawColor(245, 197, 66)
  doc.setLineWidth(0.5)
  doc.line(20, 37, pageW - 20, 37)

  // Student name
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  try { doc.setFont('Cairo', 'bold') } catch {}
  doc.text(`الطالب: ${student.name}`, pageW / 2, 48, { align: 'center' })

  // Student details
  doc.setFontSize(11)
  doc.setTextColor(200, 200, 200)
  if (student.stage) doc.text(`المرحلة: ${student.stage}`, pageW / 2, 57, { align: 'center' })
  if (student.group_name) doc.text(`المجموعة: ${student.group_name}`, pageW / 2, 64, { align: 'center' })
  if (student.code) {
    doc.setTextColor(245, 197, 66)
    doc.setFontSize(10)
    doc.text(`كود الطالب: ${student.code}`, pageW / 2, 74, { align: 'center' })
  }

  // QR code
  if (qrDataUrl) {
    const qrSize = 45
    const qrX = (pageW - qrSize) / 2
    const qrY = 82
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize)
  }

  // Instruction text
  doc.setTextColor(245, 197, 66)
  doc.setFontSize(11)
  try { doc.setFont('Cairo', 'bold') } catch {}
  doc.text('امسح الكود لمتابعة تقدم الطالب', pageW / 2, 138, { align: 'center' })

  // Footer
  doc.setFontSize(8)
  doc.setTextColor(150, 150, 150)
  const dateStr = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  doc.text(`تم الإنشاء من نظام النخبة — ${dateStr}`, pageW / 2, pageH - 15, { align: 'center' })

  return doc
}

/**
 * Send QR PDF info to parent via WhatsApp deep link.
 * @param {string} phone - Phone number in international format (e.g., 201xxxxxxxxx)
 * @param {string} studentName
 * @param {string} pdfUrl - URL to download/view the PDF
 * @param {boolean} autoOpen - If true, auto-opens WhatsApp
 */
/**
 * Send QR link via WhatsApp (legacy compat wrapper).
 * @param {string} phone
 * @param {string} studentName
 * @param {string} studentLink - Full student QR URL
 * @param {boolean} _autoOpen - Ignored (always opens)
 * @returns {string|false}
 */
export function sendQRToWhatsApp(phone, studentName, studentLink, _autoOpen = true) {
  return sendQRViaWhatsApp(phone, studentName, studentLink)
}

/**
 * Complete flow: Get token → Generate QR → PDF.
 * @param {object} student - Student object
 * @param {Function} showToast - Toast notification function
 * @returns {{ qrDataUrl: string, pdfBlob: Blob, pdfUrl: string, token: string } | null }
 */
export async function fullQRFlow(student, showToast) {
  if (!student) return null

  // Step 1: Get or create token
  const token = await getOrCreateStudentToken(student.id)
  if (!token) {
    showToast?.('فشل إنشاء رابط الطالب', 'error')
    return null
  }

  const qrUrl = buildStudentQRLink(token)

  // Step 2: Generate QR
  const qrDataUrl = await generateStudentQR(qrUrl)
  if (!qrDataUrl) {
    showToast?.('فشل إنشاء الكود', 'error')
    return null
  }

  // Step 3: Generate PDF
  const doc = await generateStudentQRPDF(student, qrDataUrl)
  const pdfBlob = doc.output('blob')
  const pdfUrl = URL.createObjectURL(pdfBlob)

  return { qrDataUrl, pdfBlob, pdfUrl, token, qrUrl }
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp PDF Report Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the rank title for a student based on points.
 */
function _getRank(points, ranks) {
  if (!ranks || ranks.length === 0) return '—'
  let title = ranks[0].title
  for (const r of ranks) { if (points >= r.min) title = r.title }
  return title
}

/**
 * Get the student's position (rank number) among all students sorted by points.
 */
function _getPosition(studentId, allStudents) {
  if (!allStudents || allStudents.length === 0) return '—'
  const sorted = [...allStudents].sort((a, b) => b.points - a.points)
  const index = sorted.findIndex((s) => s.id === studentId)
  return index !== -1 ? index + 1 : '—'
}

/**
 * Build a WhatsApp-formatted text report for a student.
 * Similar to the buildReport function in Dashboard.jsx.
 *
 * @param {object} student - Student object
 * @param {object} opts
 * @param {Array}  opts.ranks       - Rank definitions [{ min, title }]
 * @param {Array}  opts.allStudents  - All students (to compute position)
 * @param {object} opts.session      - Session info { group_name, lesson_topic, homework_text }
 * @param {string} opts.today        - Today's date string
 * @returns {string} Formatted WhatsApp text
 */
function escapeReportHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function _attendanceNarrative(status, session) {
  const value = String(status || '').toLowerCase()
  if (value.includes('حاضر') || value.includes('present')) {
    return {
      text: 'سُجّل حضور الطالب في حصة اليوم، وهذا يعكس انتظامًا جيدًا ومتابعة مباشرة للشرح.',
      recommendation: 'نوصي بالاستمرار على هذا الانتظام، ومراجعة الواجب قبل الحصة القادمة.'
    }
  }
  if (value.includes('غائب') || value.includes('absent')) {
    const video = session?.video_link ? `\nرابط شرح الحصة: ${session.video_link}` : ''
    return {
      text: `لم يُسجّل حضور الطالب في حصة اليوم. نرجو الاطلاع على سبب الغياب ومتابعة شرح الحصة حتى لا يفوته الجزء الجديد من المنهج.${video}`,
      recommendation: session?.video_link
        ? 'نوصي بمشاهدة الفيديو كاملًا، ثم حل الواجب وإرسال أي سؤال قبل الحصة القادمة.'
        : 'نوصي بمراجعة شرح الحصة والتواصل مع المدرس لمعرفة ما تم شرحه.'
    }
  }
  return {
    text: 'لم تُسجّل حالة الحضور لهذه الحصة بعد، لذلك لا يمكن تقييم الانتظام في هذا اليوم بدقة.',
    recommendation: 'نوصي بتحديث الحضور بعد انتهاء الحصة ومتابعة الواجب في موعده.'
  }
}

function _performanceNarrative(examScores = []) {
  const scores = Array.isArray(examScores) ? examScores : []
  let earned = 0
  let maximum = 0
  scores.forEach((exam) => {
    // Tolerate BOTH row shapes: raw exam rows (total_score +
    // max_score_per_section + section_scores, as stored in the exams table)
    // and the portal's simplified rows ({ total, max }) — so every caller
    // (PDF report, future WhatsApp flows) gets real grades, never the
    // "no exam result" placeholder when data actually exists.
    const earnedRaw = Number(exam.total_score ?? exam.total)
    let maxRaw = NaN
    if (exam.max_score_per_section != null && Number.isFinite(Number(exam.max_score_per_section))) {
      const sectionCount = Object.keys(exam.section_scores || {}).length || 1
      maxRaw = Number(exam.max_score_per_section) * sectionCount
    } else if (Number.isFinite(Number(exam.max))) {
      maxRaw = Number(exam.max)
    }
    if (Number.isFinite(earnedRaw) && Number.isFinite(maxRaw) && maxRaw > 0) {
      earned += earnedRaw
      maximum += maxRaw
    }
  })
  if (!maximum) return { text: 'لا توجد نتيجة امتحان مكتملة كافية للحكم على المستوى الدراسي حتى الآن.', recommendation: 'نوصي بمتابعة أول نتيجة قادمة ومراجعة نقاط القوة والاحتياج بعدها.' }
  const percentage = Math.round((earned / maximum) * 100)
  if (percentage >= 90) return { percentage, text: `بلغ متوسط نتائج الطالب ${percentage}%، وهو مستوى ممتاز يدل على فهم قوي واستعداد جيد.`, recommendation: 'نوصي بالحفاظ على نفس طريقة المذاكرة، مع الاستمرار في حل أسئلة أصعب لتطوير المستوى.' }
  if (percentage >= 75) return { percentage, text: `بلغ متوسط نتائج الطالب ${percentage}%، وهو مستوى جيد جدًا يعكس فهمًا واضحًا مع وجود مساحة بسيطة للتحسن.`, recommendation: 'نوصي بمراجعة الأخطاء بعد كل امتحان وتخصيص وقت قصير للنقاط التي حصل فيها على درجات أقل.' }
  if (percentage >= 60) return { percentage, text: `بلغ متوسط نتائج الطالب ${percentage}%، وهو مستوى جيد يحتاج إلى مزيد من التنظيم والمراجعة المنتظمة.`, recommendation: 'نوصي بتقسيم المذاكرة إلى جلسات قصيرة، ومراجعة الدروس السابقة قبل بدء الدرس الجديد.' }
  return { percentage, text: `بلغ متوسط نتائج الطالب ${percentage}%، ويحتاج المستوى إلى متابعة أقرب وخطة مراجعة أكثر انتظامًا.`, recommendation: 'نوصي بالبدء بمراجعة الأساسيات، وحل الواجب كاملًا، والتواصل مع المدرس عند ظهور أي نقطة غير واضحة.' }
}

/** Build an explanatory, attendance-aware report for WhatsApp and previews. */
export function getReportTemplateValues(examScores = [], student = {}, session = null) {
  const latest = Array.isArray(examScores) && examScores.length > 0 ? examScores[0] : null
  const sections = latest ? Object.keys(latest.section_scores || {}).length || 1 : 0
  // Tolerate both exam row shapes: raw exam rows (total_score /
  // max_score_per_section / exam_title / exams relation) and the portal's
  // simplified rows ({ total, max, title }).
  const max = latest
    ? Number(latest.max_score ?? 0)
      || Number(latest.max ?? 0)
      || (Number(latest.max_score_per_section ?? latest.exams?.max_score_per_section ?? 0) * sections)
    : 0
  const score = latest ? Number(latest.total_score ?? latest.total ?? latest.score ?? 0) : 0
  const percentage = max > 0 ? Math.round((score / max) * 100) : ''
  return {
    examTitle: latest?.exam_title || latest?.exams?.title || latest?.title || '',
    examScore: latest ? score : '',
    examMaxScore: latest && max ? max : '',
    examPercentage: percentage,
    attendance: student.attendance_status || 'لم يرصد',
    homework: student.hw_status || 'لم يرصد',
    lesson: session?.lesson_topic || '',
  }
}

export function buildTextReport(student, { ranks, allStudents, session, examScores, today } = {}) {
  const s = student
  const rank = _getRank(s.points, ranks)
  const position = _getPosition(s.id, allStudents)
  const todayStr = today || new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
  const attendance = _attendanceNarrative(s.attendance_status, session)
  const performance = _performanceNarrative(examScores)
  // Concrete latest-exam line (owner: "اتأكد إن الامتحانات والدرجات موجودة
  // فالتقرير") — falls back to '' when no exam data exists.
  const latestExam = getReportTemplateValues(examScores, s, session)
  const examLine = latestExam.examTitle && latestExam.examScore !== '' && latestExam.examMaxScore
    ? `آخر امتحان: «${latestExam.examTitle}» — درجة ${latestExam.examScore} من ${latestExam.examMaxScore}${latestExam.examPercentage !== '' ? ` (${latestExam.examPercentage}%)` : ''}.`
    : ''
  const lines = [
    `تقرير متابعة الطالب`,
    `التاريخ: ${todayStr}`,
    '',
    `ولي الأمر الكريم، نشارككم ملخص متابعة ${s.name} اليوم حتى تكون الصورة واضحة ومتكاملة.`,
    s.stage ? `المرحلة الدراسية: ${s.stage}` : '',
    s.group_name ? `المجموعة: ${s.group_name}` : '',
    '',
    `الحضور: ${attendance.text}`,
  ].filter(Boolean)
  if (session?.lesson_topic) lines.push(`درس اليوم: تم تناول موضوع «${session.lesson_topic}».`)
  if (session?.homework_text) lines.push(`الواجب: ${s.hw_status && !String(s.hw_status).includes('لم') ? `حالة الواجب الحالية هي «${s.hw_status}».` : `الواجب المطلوب هو «${session.homework_text}».`}`)
  lines.push('', `النتائج والدرجات: ${performance.text}`)
  if (examLine) lines.push(examLine)
  lines.push(`الرتبة الحالية: ${rank}، والمركز بين الطلاب: ${position === '—' ? 'غير محدد بعد' : `رقم ${position}`}.`)
  lines.push(`إجمالي النقاط: ${s.points || 0}. وعدد الإنذارات المسجلة: ${s.warnings || 0}.`)
  lines.push('', `التوصية: ${performance.recommendation}`)
  lines.push(`توصية الحضور: ${attendance.recommendation}`)
  lines.push('', 'نشكر لكم المتابعة المستمرة، ونسعد بالتعاون من أجل تقدم الطالب خطوةً بعد خطوة.')
  return lines.join('\n')
}

// ═════════════════════════════════════════════════════════════════════════════
// PRESENT / ABSENT attendance messages (recipient-targeting round)
//
// The teacher-facing spec requires DIFFERENT messages for present vs absent
// students, with the warning balance computed from REAL data — never
// hardcoded. Templates are teacher-editable (teacher_settings:
// msg_attendance_present / msg_attendance_absent via TemplatesModal); the
// defaults below are the owner-approved colloquial EGYPTIAN Arabic versions
// (owner request: "make a template ready for sending in egyptian arabic"). The
// consequence named in the absent default ("منع الدخول عبر البوابة") is the
// ONLY automated consequence that exists in the system today (QR entry block
// at warnings ≥ threshold, lib/qrAttendance.js) — no invented rules.
// ═════════════════════════════════════════════════════════════════════════════

export const DEFAULT_PRESENT_TEMPLATE = 'أهلًا حضرتك 🌟\n{studentName} حضر حصة {group} النهارده تمام ✅\n{lessonLine}شكرًا لمتابعتكم.'

export const DEFAULT_ABSENT_TEMPLATE = 'مساء الخير حضرتك،\n{studentName} معدهش حصة {group} النهارده ❌\n{lessonLine}رصيد الإنذارات دلوقتي: {warnings}.\nلو كمل {remainingWarnings} إنذار هيتمنع مؤقتًا من بوابة الطالب.\nلو فيه عذر أو ظرف صحي، بلغنا — وشكرًا لمتابعتكم.'

/**
 * Interpolate an attendance template with real per-student values.
 * Unknown/empty variables collapse their surrounding line instead of
 * leaving dangling "{placeholder}" text.
 */
function interpolateAttendance(template, vars) {
  let out = String(template || '')
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, String(value ?? ''))
  }
  // Collapse the blank lines left behind by empty optional blocks
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Build the WhatsApp message for one student's attendance status.
 * @param {object} student   - student row (name, group_name, stage, warnings)
 * @param {object} opts
 *   status           'حاضر' | 'غائب' (falls back to the full report text)
 *   lesson           lesson_sessions row (lesson_topic, video_link, session_date)
 *   settings         teacher_settings row (templates + insight_config)
 *   groupName        override when the session group differs from the row
 *   today            preformatted date string
 *   examScores       student's exam_scores rows — powers the optional {examLine}
 * @returns {string} ready-to-send message
 */
export function buildAttendanceMessage(student, { status, lesson, settings, groupName, today, examScores } = {}) {
  const s = student || {}
  const isPresent = String(status || '').includes('حاضر')
  const threshold = Number(settings?.insight_config?.max_warnings ?? 3)
  const warnings = Number(s.warnings || 0)
  const remaining = Math.max(0, threshold - warnings)
  const lessonLine = lesson?.lesson_topic ? `موضوع الحصة: ${lesson.lesson_topic}\n` : ''
  const videoLine = !isPresent && lesson?.video_link ? `\nرابط شرح الحصة: ${lesson.video_link}` : ''
  // ENRICHED BRICKS (owner spec: reports carry الحضور/الواجب/الامتحان):
  // optional composite lines built from REAL rows — each collapses entirely
  // when its data is missing (no exam that day → no exam line), so old saved
  // templates that don't use them are unaffected and new ones never show
  // dangling labels or invented numbers.
  const examVals = getReportTemplateValues(examScores || [], s, lesson)
  const examLine = examVals.examTitle && examVals.examScore !== '' && examVals.examMaxScore
    ? `التقييم: اختبار «${examVals.examTitle}» — ${examVals.examScore} من ${examVals.examMaxScore}${examVals.examPercentage !== '' ? ` (${examVals.examPercentage}%)` : ''}`
    : ''
  const homeworkLine = lesson?.homework_text ? `الواجب: ${lesson.homework_text}` : ''
  const pointsLine = s.points != null && s.points !== '' ? `النقاط الحالية: ${s.points}` : ''
  const dateStr = today || (lesson?.session_date
    ? new Date(lesson.session_date).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })
    : new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }))
  const vars = {
    studentName: s.name || '',
    group: groupName || s.group_name || '',
    date: dateStr,
    lessonLine,
    videoLink: lesson?.video_link || '',
    homework: lesson?.homework_text || '',
    homeworkLine,
    examLine,
    pointsLine,
    warnings,
    remainingWarnings: remaining,
    warningsThreshold: threshold,
  }
  const template = isPresent
    ? (settings?.msg_attendance_present || DEFAULT_PRESENT_TEMPLATE)
    : (settings?.msg_attendance_absent || DEFAULT_ABSENT_TEMPLATE)
  let text = interpolateAttendance(template, vars)
  if (videoLine && !text.includes(lesson.video_link)) text += `\n${videoLine.trim()}`
  return text
}

/**
 * Send a text report to WhatsApp.
 * Opens wa.me deep link with pre-filled message.
 *
 * @param {string} phone     - Phone number (international format)
 * @param {string} textReport - Formatted text to send
 * @returns {string|false} WhatsApp URL or false if no phone
 */
export function sendReportWhatsApp(phone, textReport) {
  const waUrl = buildWhatsAppUrl(phone, textReport)
  if (!waUrl) return false

  // Always surface the guaranteed fallback (real <a> link in the handoff
  // bar) BEFORE attempting the automatic handoff — iOS can report success
  // while nothing actually opens.
  showWhatsAppHandoff(waUrl, { message: textReport })
  return openWhatsAppUrl(waUrl).ok ? waUrl : false
}

/**
 * Generate a themed PDF report for a student using html2canvas-pro + jsPDF.
 * Creates a hidden div with the app's design (glass-card, navy+gold, RTL, Cairo font),
 * renders it with html2canvas at 2x scale, converts to A4 PDF.
 *
 * @param {object} student - Student object
 * @param {object} opts
 * @param {boolean} opts.isDark      - Controls theme colors (dark navy vs light)
 * @param {Array}   opts.ranks       - Rank definitions [{ min, title }]
 * @param {Array}   opts.examScores  - Exam rows (any supported shape) — powers the
 *                                     grades narrative + latest-exam line
 * @param {Array}   opts.allStudents  - All students (to compute position)
 * @param {object}  opts.session      - Session info { group_name, lesson_topic, homework_text }
 * @param {string}  opts.today        - Today's date string
 * @returns {Promise<{ success: boolean, pdfUrl?: string }>}
 */
export async function generateStudentReportPDF(student, { isDark = false, ranks, allStudents, session, examScores, today, download = false } = {}) {
  try {
    const html2canvas = (await import('html2canvas-pro')).default

    const s = student
    const rank = _getRank(s.points, ranks)
    const position = _getPosition(s.id, allStudents)
    const todayStr = today || new Date().toLocaleDateString('ar-EG', {
      year: 'numeric', month: 'long', day: 'numeric',
    })

    // Theme colors
    const bg = isDark ? '#0B1120' : '#F8FAFC'
    const cardBg = isDark
      ? 'rgba(14, 41, 84, 0.65)'  // navy glass
      : 'rgba(255, 255, 255, 0.85)'
    const border = isDark
      ? 'rgba(245, 197, 66, 0.35)'
      : 'rgba(14, 41, 84, 0.2)'
    const headingColor = '#F5C542'
    const textColor = isDark ? '#E2E8F0' : '#1E293B'
    const subtleColor = isDark ? '#94A3B8' : '#64748B'
    const accentNavy = '#142D62'
    const accentGold = '#F5C542'

    const container = document.createElement('div')
    container.setAttribute('dir', 'rtl')
    container.style.cssText = `
      position: fixed; top: -9999px; left: -9999px;
      width: 794px; /* A4 at 96dpi approx */
      font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
      background: ${bg};
      padding: 48px 40px;
      color: ${textColor};
      direction: rtl;
    `

    // Header
    const header = document.createElement('div')
    header.style.cssText = `
      text-align: center;
      margin-bottom: 32px;
      padding-bottom: 20px;
      border-bottom: 2px solid ${accentGold};
    `
    header.innerHTML = `
      <div style="font-size: 32px; font-weight: 800; color: ${accentGold}; margin-bottom: 4px;">النخبة</div>
      <div style="font-size: 14px; color: ${subtleColor};">إدارة الحصص الذكية</div>
      <div style="font-size: 13px; color: ${subtleColor}; margin-top: 8px;">تقرير متابعة الطالب</div>
    `
    container.appendChild(header)

    // Student info card
    const studentCard = document.createElement('div')
    studentCard.style.cssText = `
      background: ${cardBg};
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid ${border};
      border-radius: 16px;
      padding: 24px 28px;
      margin-bottom: 20px;
    `
    studentCard.innerHTML = `
      <div style="font-size: 22px; font-weight: 700; color: ${headingColor}; margin-bottom: 12px;">${escapeReportHtml(s.name)}</div>
      ${s.code ? `<div style="font-size: 14px; color: ${subtleColor}; margin-bottom: 6px;">كود الطالب: <span style="color: ${textColor}; font-weight: 600;">${escapeReportHtml(s.code)}</span></div>` : ''}
      ${s.stage ? `<div style="font-size: 14px; color: ${subtleColor}; margin-bottom: 6px;">المرحلة: <span style="color: ${textColor}; font-weight: 600;">${escapeReportHtml(s.stage)}</span></div>` : ''}
      ${s.group_name ? `<div style="font-size: 14px; color: ${subtleColor};">المجموعة: <span style="color: ${textColor}; font-weight: 600;">${escapeReportHtml(s.group_name)}</span></div>` : ''}
    `
    container.appendChild(studentCard)

    // Stats grid
    const statsGrid = document.createElement('div')
    statsGrid.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
    `

    const stats = [
      { icon: '🎖️', label: 'الرتبة', value: rank },
      { icon: '🏆', label: 'المركز', value: `#${position}` },
      { icon: '⭐', label: 'إجمالي النقاط', value: s.points || 0 },
      { icon: '🚨', label: 'الإنذارات', value: s.warnings || 0 },
      { icon: '🟢', label: 'الحضور', value: s.attendance_status || 'لم يرصد' },
      { icon: '📚', label: 'الواجب', value: s.hw_status || 'لم يرصد' },
    ]

    stats.forEach(({ icon, label, value }) => {
      const cell = document.createElement('div')
      cell.style.cssText = `
        background: ${cardBg};
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid ${border};
        border-radius: 12px;
        padding: 16px 20px;
        text-align: center;
      `
      cell.innerHTML = `
        <div style="font-size: 24px; margin-bottom: 6px;">${icon}</div>
        <div style="font-size: 12px; color: ${subtleColor}; margin-bottom: 4px;">${label}</div>
        <div style="font-size: 20px; font-weight: 700; color: ${headingColor};">${escapeReportHtml(String(value))}</div>
      `
      statsGrid.appendChild(cell)
    })
    container.appendChild(statsGrid)

    // Session card (if session info provided)
    if (session) {
      const sessionCard = document.createElement('div')
      sessionCard.style.cssText = `
        background: ${cardBg};
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid ${border};
        border-radius: 16px;
        padding: 24px 28px;
        margin-bottom: 20px;
      `
      sessionCard.innerHTML = `
        <div style="font-size: 18px; font-weight: 700; color: ${headingColor}; margin-bottom: 14px;">📅 معلومات الحصة</div>
        ${session.group_name ? `<div style="font-size: 14px; color: ${subtleColor}; margin-bottom: 6px;">الحصة: <span style="color: ${textColor}; font-weight: 600;">${escapeReportHtml(session.group_name)}</span></div>` : ''}
        ${session.lesson_topic ? `<div style="font-size: 14px; color: ${subtleColor}; margin-bottom: 6px;">الدرس: <span style="color: ${textColor}; font-weight: 600;">${escapeReportHtml(session.lesson_topic)}</span></div>` : ''}
        ${session.homework_text ? `<div style="font-size: 14px; color: ${subtleColor};">الواجب: <span style="color: ${textColor}; font-weight: 600;">${escapeReportHtml(session.homework_text)}</span></div>` : ''}
      `
      container.appendChild(sessionCard)
    }

    // Literary narrative section: the report explains what the numbers mean.
    const narrativeCard = document.createElement('div')
    narrativeCard.style.cssText = `
      background: ${cardBg};
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid ${border};
      border-radius: 16px;
      padding: 24px 28px;
      margin-bottom: 20px;
      white-space: pre-line;
      line-height: 1.9;
      font-size: 14px;
      color: ${textColor};
    `
    const narrative = buildTextReport(s, { ranks, allStudents, session, examScores, today })
    narrativeCard.innerHTML = `<div style="font-size: 18px; font-weight: 700; color: ${accentNavy}; margin-bottom: 12px;">ملخص المتابعة والتوصيات</div><div>${escapeReportHtml(narrative).replace(/\n/g, '<br/>')}</div>`
    container.appendChild(narrativeCard)

    // Footer
    const footer = document.createElement('div')
    footer.style.cssText = `
      text-align: center;
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid ${border};
      font-size: 12px;
      color: ${subtleColor};
    `
    footer.innerHTML = `
      <div>تم الإنشاء من نظام النخبة — ${todayStr}</div>
    `
    container.appendChild(footer)

    // Attach to DOM (required for html2canvas to work)
    document.body.appendChild(container)

    // Render with html2canvas at 2x scale
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: bg,
    })

    // Remove from DOM
    document.body.removeChild(container)

    // Convert to A4 PDF
    const imgData = canvas.toDataURL('image/png')
    const jsPDF = await loadJsPDF()
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    })

    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()

    // Preserve the report's full width. Long reports are split vertically into
    // additional A4 pages instead of shrinking the entire canvas, which used
    // to make the report appear like a small/half image with large blank sides.
    const pagePixelHeight = Math.max(1, Math.floor(canvas.width * (pdfHeight / pdfWidth)))
    let offsetY = 0
    let pageIndex = 0
    while (offsetY < canvas.height) {
      const sliceHeight = Math.min(pagePixelHeight, canvas.height - offsetY)
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = sliceHeight
      const pageContext = pageCanvas.getContext('2d')
      pageContext.fillStyle = bg
      pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      pageContext.drawImage(
        canvas,
        0, offsetY, canvas.width, sliceHeight,
        0, 0, pageCanvas.width, pageCanvas.height,
      )

      if (pageIndex > 0) pdf.addPage()
      const pageImageHeight = (sliceHeight * pdfWidth) / canvas.width
      pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, pageImageHeight)
      offsetY += sliceHeight
      pageIndex += 1
    }

    // Download
    const fileName = `تقرير_${s.name}.pdf`
    const pdfBlob = pdf.output('blob')
    const pdfUrl = URL.createObjectURL(pdfBlob)

    // Never download implicitly. Callers must explicitly pass download: true.
    if (download) {
      const link = document.createElement('a')
      link.href = pdfUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }

    return { success: true, pdfUrl, pdfBlob }
  } catch (err) {
    console.error('Failed to generate student report PDF:', err)
    return { success: false }
  }
}
