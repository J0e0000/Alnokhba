/**
 * Student QR CARDS — Visa-style printable card + A4 sheet composer (Task 68).
 * ─────────────────────────────────────────────────────────────────────────
 * One physical card per student, ISO ID-1 proportions (85.6 × 53.98 mm —
 * the exact size of a bank card), navy face + gold accents matching the
 * brand (flat, print-friendly). The QR encodes the SAME portal URL the
 * system already issues (…/qr/<20-char token>), so scanning behaves exactly
 * like every other QR in the product:
 *   • Normal phone camera  → opens the student's public portal page.
 *   • Nokhba in-app scanner → resolve_student_by_qr RPC → attendance.
 * Card shows the student's F-code (student.code) so the teacher can match
 * a physical card to a row even when the QR is damaged.
 *
 * RENDERING: the card is painted DIRECTLY on a Canvas 2D context — no
 * html2canvas. Rationale: html2canvas-pro proved unreliable at rasterizing
 * replaced elements (<img>/<canvas>) inside its clone iframe (CSP-sensitive:
 * production `connect-src` does not allow `data:`, so cloned QR images come
 * out blank). Canvas 2D drawImage/fillText has no such pipeline, shapes
 * Arabic natively (Cairo via document.fonts), and is deterministic.
 *
 * PDF: A4 portrait, 2 × 4 grid (8 cards/page) with dashed cut guides and
 * an English-only footer (jsPDF core fonts cannot render Arabic — all
 * Arabic text lives inside the card images).
 *
 * Placeholder mode: prints N blank cards BEFORE any student exists —
 * dashed name/code lines and an empty QR frame — for teachers who want
 * card stock ready in advance. Real cards (with live QR) are printed per
 * student from the Students area / QR modal after enrollment.
 */
import { getOrCreateStudentToken, buildStudentQRLink } from './qrPdfWhatsApp'

// ISO ID-1 in mm — do not change without changing the composer geometry.
export const CARD_W_MM = 85.6
export const CARD_H_MM = 53.98

// Canvas scale: 12 px per mm, rendered at 1.2× ≈ 366 DPI at print size.
const PX_PER_MM = 12
const CARD_W_PX = Math.round(CARD_W_MM * PX_PER_MM) // 1027
const CARD_H_PX = Math.round(CARD_H_MM * PX_PER_MM) // 648

const NAVY = '#142D62'
const GOLD = '#F5C542'
const FONT = 'Cairo'

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

const loadFonts = (() => {
  let done = null
  return () => {
    if (!done) {
      const faces = [
        '400 21px Cairo', '700 18px Cairo', '700 21px Cairo', '700 22px Cairo',
        '700 26px Cairo', '800 21px Cairo', '800 30px Cairo', '800 44px Cairo',
        '900 52px Cairo',
      ]
      done = Promise.all(faces.map((f) => document.fonts.load(f, 'النخبة').catch(() => undefined)))
    }
    return done
  }
})()

function setLetterSpacing(ctx, spacing) {
  try { ctx.letterSpacing = spacing } catch { /* older browsers: skip */ }
}

/**
 * Shrink-to-fit one line: returns the font size (≤ startSize) that renders
 * `text` within `maxWidth`, ellipsizing if it would fall below `minSize`.
 */
function fitFontSize(ctx, text, startSize, minSize, maxWidth, weight = '800') {
  let size = startSize
  let out = text
  for (; size >= minSize; size -= 2) {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (ctx.measureText(out).width <= maxWidth) return size
  }
  ctx.font = `${weight} ${minSize}px ${FONT}`
  let t = out
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1)
  out = `${t}…`
  return minSize
}

/** Load an image (data URL) and resolve when decodable. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('image load failed'))
    im.src = src
  })
}

/**
 * Paint the Visa-style card directly on a canvas.
 * Geometry mirrors the original DOM design (12 px/mm, RTL).
 */
export async function paintCardCanvas({ student, qr: qrDataUrl, placeholder = false } = {}) {
  await loadFonts()
  const SCALE = 1.2
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(CARD_W_PX * SCALE)
  canvas.height = Math.round(CARD_H_PX * SCALE)
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'top'

  const W = CARD_W_PX
  const H = CARD_H_PX
  const M = 56 // side padding

  // ── face ──
  roundRectPath(ctx, 0, 0, W, H, 48)
  ctx.fillStyle = NAVY
  ctx.fill()
  ctx.fillStyle = GOLD
  ctx.fillRect(0, 0, W, 8)
  ctx.strokeStyle = 'rgba(245,197,66,.4)'
  ctx.lineWidth = 2
  roundRectPath(ctx, 6, 6, W - 12, H - 12, 44)
  ctx.stroke()

  // ── header row (RTL): النخبة wordmark right, NOKHBA + divider left of it,
  // STUDENT CARD label leftmost ──
  ctx.textAlign = 'right'
  ctx.fillStyle = GOLD
  ctx.font = `900 52px ${FONT}`
  ctx.fillText('النخبة', W - M, 50)
  const wordmarkW = ctx.measureText('النخبة').width
  const wordmarkLeft = W - M - wordmarkW
  ctx.fillStyle = 'rgba(255,255,255,.25)'
  ctx.fillRect(wordmarkLeft - 20, 56, 2, 40)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,.7)'
  ctx.font = `700 20px ${FONT}`
  setLetterSpacing(ctx, '7px')
  ctx.fillText('NOKHBA', wordmarkLeft - 38, 58)
  setLetterSpacing(ctx, '1px')
  ctx.textAlign = 'left'
  ctx.font = `800 21px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,.62)'
  ctx.fillText('كرت طالب · STUDENT CARD', M, 58)

  // ── EMV chip (right side, under the wordmark) ──
  const chipW = 118
  const chipH = 92
  const chipX = W - M - chipW
  const chipY = 206
  ctx.fillStyle = GOLD
  roundRectPath(ctx, chipX, chipY, chipW, chipH, 18)
  ctx.fill()
  ctx.strokeStyle = 'rgba(20,45,98,.55)'
  ctx.lineWidth = 2
  roundRectPath(ctx, chipX + 14, chipY + 14, chipW - 28, chipH - 28, 10)
  ctx.stroke()
  ctx.beginPath(); ctx.moveTo(chipX + 14, chipY + chipH / 2); ctx.lineTo(chipX + chipW - 14, chipY + chipH / 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(chipX + chipW / 2, chipY + 14); ctx.lineTo(chipX + chipW / 2, chipY + chipH - 14); ctx.stroke()

  // ── QR panel (left) ──
  const qrX = M
  const qrY = 168
  const qrPanel = 250
  ctx.fillStyle = '#FFFFFF'
  roundRectPath(ctx, qrX, qrY, qrPanel, qrPanel, 28)
  ctx.fill()
  if (!placeholder && qrDataUrl) {
    try {
      const qim = await loadImage(qrDataUrl)
      ctx.drawImage(qim, qrX + 16, qrY + 16, qrPanel - 32, qrPanel - 32)
    } catch { /* fall through to empty frame below */ }
  }
  if (placeholder || !qrDataUrl) {
    const inner = qrPanel - 54
    ctx.strokeStyle = '#B6C2D8'
    ctx.lineWidth = 3
    ctx.setLineDash([10, 8])
    roundRectPath(ctx, qrX + 27, qrY + 27, inner, inner, 14)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.textAlign = 'center'
    ctx.fillStyle = '#8B99B4'
    ctx.font = `800 30px ${FONT}`
    ctx.fillText('QR الطالب', qrX + qrPanel / 2, qrY + qrPanel / 2 - 30)
    ctx.fillStyle = '#A5B1C6'
    ctx.font = `700 17px ${FONT}`
    ctx.fillText('يُطبع بعد تسجيل الطالب', qrX + qrPanel / 2, qrY + qrPanel / 2 + 12)
    ctx.textAlign = 'right'
  }

  // ── identity block (right of the QR, under the chip) ──
  const idRight = W - M
  const idLeft = qrX + qrPanel + 54
  const idMax = idRight - idLeft
  ctx.textAlign = 'right'
  let y = 344
  if (placeholder) {
    ctx.strokeStyle = 'rgba(255,255,255,.55)'
    ctx.lineWidth = 3
    ctx.setLineDash([14, 10])
    ctx.beginPath(); ctx.moveTo(idRight, y + 52); ctx.lineTo(idLeft + 60, y + 52); ctx.stroke()
    ctx.setLineDash([])
    y += 74
    ctx.font = `700 26px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,.85)'
    const label = 'كود الطالب: '
    ctx.fillText(label, idRight, y)
    const labelW = ctx.measureText(label).width
    ctx.fillStyle = GOLD
    ctx.font = `800 26px ${FONT}`
    setLetterSpacing(ctx, '2px')
    ctx.fillText('F-•••••', idRight - labelW - 6, y)
    setLetterSpacing(ctx, '0px')
    y += 44
    ctx.fillStyle = 'rgba(255,255,255,.6)'
    ctx.font = `700 22px ${FONT}`
    ctx.fillText('المجموعة / المرحلة: ..................', idRight, y)
  } else {
    const name = String(student?.name || '').trim() || '—'
    const size = fitFontSize(ctx, name, 44, 28, idMax)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = `800 ${size}px ${FONT}`
    ctx.fillText(name, idRight, y)
    y += Math.round(size * 1.42)
    ctx.font = `700 26px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,.85)'
    const label = 'كود الطالب: '
    ctx.fillText(label, idRight, y)
    const labelW = ctx.measureText(label).width
    ctx.fillStyle = GOLD
    ctx.font = `800 26px ${FONT}`
    setLetterSpacing(ctx, '2px')
    ctx.fillText(String(student?.code || '—'), idRight - labelW - 6, y)
    setLetterSpacing(ctx, '0px')
    const meta = [student?.group_name, student?.stage].filter(Boolean).join(' · ')
    if (meta) {
      y += 44
      ctx.fillStyle = 'rgba(255,255,255,.6)'
      ctx.font = `700 22px ${FONT}`
      ctx.fillText(meta, idRight, y)
    }
  }

  // ── bottom strip ──
  const stripH = 112
  const stripTop = H - stripH
  ctx.fillStyle = 'rgba(255,255,255,.06)'
  ctx.fillRect(0, stripTop, W, stripH)
  ctx.strokeStyle = 'rgba(245,197,66,.45)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, stripTop); ctx.lineTo(W, stripTop); ctx.stroke()
  const note = placeholder
    ? 'كرت جاهز للتسليم — بعد تسجيل الطالب اطبع كرته الرسمية بـ QR الحضور من صفحة الطلاب'
    : 'امسح الكود بكاميرا النخبة داخل الحصة لتسجيل الحضور — أو افتح الرابط بأي كاميرا'
  ctx.textAlign = 'right'
  ctx.font = `700 21px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,.85)'
  // wrap to at most 2 lines within the strip
  const noteMax = W - M - 260
  const words = note.split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w
    if (ctx.measureText(candidate).width <= noteMax) cur = candidate
    else { if (cur) lines.push(cur); cur = w }
    if (lines.length === 2) break
  }
  if (cur && lines.length < 2) lines.push(cur)
  const noteY = stripTop + (stripH - lines.length * 30) / 2
  lines.forEach((line, i) => ctx.fillText(line, W - M, noteY + i * 30))
  ctx.textAlign = 'left'
  ctx.fillStyle = GOLD
  ctx.font = `700 18px ${FONT}`
  setLetterSpacing(ctx, '1px')
  ctx.fillText('al-nokhbba.vercel.app', M, stripTop + (stripH - 24) / 2 + 4)
  setLetterSpacing(ctx, '0px')

  return canvas
}

/** Render one card → JPEG data URL (0.92 keeps the sheet light: PNG canvases
 * weighed ~2.9MB each — 40 cards ≈ 110MB). QR robustness is preserved by
 * error-correction level H (30% tolerance) — see qrForLink. */
async function renderCardToImage(opts) {
  const canvas = await paintCardCanvas(opts)
  return canvas.toDataURL('image/jpeg', 0.92)
}

/** Generate the portal QR for a link (high-res for print). */
async function qrForLink(link) {
  const QRCode = (await import('qrcode')).default
  return QRCode.toDataURL(link, {
    width: 512, margin: 2,
    color: { dark: NAVY, light: '#FFFFFF' },
    // Level H — printed cards get handled, scratched and laminated.
    errorCorrectionLevel: 'H',
  })
}

/**
 * Resolve portal links + QR images for a list of students (concurrency 4).
 * @returns {Promise<{ entries: Array<{student, qr}>, failed: number }>}
 *   Students whose token could not be resolved are skipped (counted in failed).
 */
export async function buildStudentCardEntries(students = [], { onProgress } = {}) {
  const list = (students || []).filter(Boolean)
  const entries = []
  let failed = 0
  const CHUNK = 4
  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK)
    const results = await Promise.all(slice.map(async (student) => {
      try {
        const token = await getOrCreateStudentToken(student.id)
        if (!token) return null
        const qr = await qrForLink(buildStudentQRLink(token))
        return { student, qr }
      } catch {
        return null
      }
    }))
    for (const r of results) {
      if (r) entries.push(r)
      else failed += 1
    }
    onProgress?.(Math.min(i + CHUNK, list.length), list.length)
  }
  return { entries, failed }
}

const loadJsPDF = async () => (await import('jspdf')).default

/**
 * Compose the A4 sheet: 2 × 4 cards per page with dashed cut guides.
 * `cards` = ready-to-place image data URLs; `blanks` = placeholder slots
 * (rendered as blank stock cards).
 */
async function composeCardsPdf({ cards = [], blanks = 0, fileName = 'nokhba-student-cards.pdf', download = true } = {}) {
  const total = cards.length + blanks
  if (total <= 0) return { success: false, skipped: true }

  const blankImages = []
  for (let i = 0; i < blanks; i += 1) {
    blankImages.push(await renderCardToImage({ placeholder: true }))
  }

  const jsPDF = await loadJsPDF()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()   // 210
  const pageH = doc.internal.pageSize.getHeight()  // 297

  const COLS = 2
  const ROWS = 4
  const MARGIN_X = 16
  const MARGIN_Y = 14
  const GAP_X = pageW - 2 * MARGIN_X - 2 * CARD_W_MM // 6.8 → symmetric columns
  const GAP_Y = 9
  const CELL_H = CARD_H_MM + GAP_Y

  const drawGuides = () => {
    doc.setDrawColor(176, 186, 204)
    doc.setLineWidth(0.25)
    doc.setLineDashPattern([1, 1.2], 0)
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const x = MARGIN_X + c * (CARD_W_MM + GAP_X)
        const y = MARGIN_Y + r * CELL_H
        if (y + CARD_H_MM > pageH - 14) continue
        doc.rect(x, y, CARD_W_MM, CARD_H_MM)
      }
    }
    doc.setLineDashPattern([], 0)
  }

  const footer = (pageIndex, pageCount) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(130)
    doc.text(`Nokhba student QR cards — cut along dashed lines — page ${pageIndex}/${pageCount}`, pageW / 2, pageH - 6, { align: 'center' })
  }

  const pageCount = Math.ceil(total / (COLS * ROWS))
  for (let i = 0; i < total; i += 1) {
    const slot = i % (COLS * ROWS)
    if (slot === 0 && i > 0) doc.addPage()
    if (slot === 0) drawGuides()
    const r = Math.floor(slot / COLS)
    const c = slot % COLS
    const x = MARGIN_X + c * (CARD_W_MM + GAP_X)
    const y = MARGIN_Y + r * CELL_H
    const img = i < cards.length ? cards[i] : blankImages[i - cards.length]
    doc.addImage(img, 'JPEG', x, y, CARD_W_MM, CARD_H_MM)
  }
  for (let p = 1; p <= pageCount; p += 1) {
    if (p > 1) doc.setPage(p)
    footer(p, pageCount)
  }

  if (download) {
    doc.save(fileName)
  }
  return { success: true, pageCount, cards: cards.length, blanks }
}

/**
 * Print ONE student's Visa-style card (QR portal link + F-code).
 * Called from StudentQRModal.
 */
export async function printStudentCardPdf(student, { download = true } = {}) {
  if (!student?.id) return { success: false }
  const token = await getOrCreateStudentToken(student.id)
  if (!token) return { success: false, reason: 'token' }
  const qr = await qrForLink(buildStudentQRLink(token))
  const img = await renderCardToImage({ student, qr })
  const safeCode = String(student.code || student.id).replace(/[^A-Za-z0-9-]/g, '_')
  return composeCardsPdf({ cards: [img], fileName: `nokhba-card-${safeCode}.pdf`, download })
}

/**
 * Print cards for MANY students (bulk selection / whole center).
 * @returns {{ success, failed, printed }} — failed = students skipped
 *   (token/QR generation failed); printed = cards placed on the sheet.
 */
export async function printStudentsCardsPdf(students, { download = true, onProgress } = {}) {
  const { entries, failed } = await buildStudentCardEntries(students, { onProgress })
  if (!entries.length) return { success: false, failed, printed: 0 }
  const imgList = []
  for (const e of entries) {
    imgList.push(await renderCardToImage({ student: e.student, qr: e.qr }))
  }
  const res = await composeCardsPdf({ cards: imgList, fileName: 'nokhba-student-cards.pdf', download })
  return { ...res, failed, printed: imgList.length }
}

/**
 * Print N blank placeholder cards (before any student exists).
 * @param {number} count 1–40 — 8 per A4 page.
 */
export async function printPlaceholderCardsPdf(count = 8, { download = true } = {}) {
  const n = Math.max(1, Math.min(40, Math.floor(Number(count) || 0)))
  return composeCardsPdf({ blanks: n, fileName: 'nokhba-placeholder-cards.pdf', download })
}
