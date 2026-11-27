/**
 * Student QR CARDS — Visa-style printable card + A4 sheet composer (Task 68).
 * ─────────────────────────────────────────────────────────────────────────
 * One physical card per student, ISO ID-1 proportions (85.6 × 53.98 mm —
 * the exact size of a bank card). The QR encodes the SAME portal URL the
 * system already issues (…/qr/<20-char token>), so scanning behaves exactly
 * like every other QR in the product:
 *   • Normal phone camera  → opens the student's public portal page.
 *   • Nokhba in-app scanner → resolve_student_by_qr RPC → attendance.
 * Card shows the student's F-code (student.code) so the teacher can match
 * a physical card to a row even when the QR is damaged.
 *
 * DESIGN v2 (Task 68 review round 3 — owner spec): diagonal gold/navy face,
 * off-axis elements (tilted wordmark, chip, QR panel), and a ROUNDED-DOT QR
 * with the النخبة mark in the centre, error-correction level H. Painted
 * directly on a Canvas 2D context (no html2canvas): deterministic, shapes
 * Arabic natively (Cairo via document.fonts), and draws the QR matrix
 * module-by-module as dots — no intermediate raster.
 *
 * PDF: A4 portrait, 2 × 4 grid (8 cards/page) with dashed cut guides and
 * an English-only footer (jsPDF core fonts cannot render Arabic — all
 * Arabic text lives inside the card images).
 *
 * Placeholder mode: prints N blank cards BEFORE any student exists —
 * dashed name/code lines and an empty QR frame — for teachers who want
 * card stock ready in advance.
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
const NAVY_DEEP = '#0E2350'
const GOLD = '#F5C542'
const GOLD_SOFT = 'rgba(245,197,66,.35)'
const FONT = 'Cairo'
const LOGO_URL = '/nokhba-mark.svg'

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

const loadLogo = (() => {
  let done = null
  return () => {
    if (!done) {
      done = new Promise((resolve) => {
        const im = new Image()
        im.onload = () => resolve(im)
        im.onerror = () => resolve(null)
        im.src = LOGO_URL
      })
    }
    return done
  }
})()

function setLetterSpacing(ctx, spacing) {
  try { ctx.letterSpacing = spacing } catch { /* older browsers: skip */ }
}

/** Shrink-to-fit one line: returns the font size (≤ startSize) that renders
 * `text` within `maxWidth`, ellipsizing if it would fall below `minSize`. */
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

/* ── ROUNDED-DOT QR (design v2) ────────────────────────────────────────────
 * QRCode.create() gives the raw module matrix; each dark module is painted
 * as a circle so the printed code reads as rounded dots. The النخبة mark
 * sits in a white rounded well at the centre — safe at EC level H (30%). */
async function drawDotQR(ctx, link, cx, cy, size, logoImg) {
  const QRCode = (await import('qrcode')).default
  const qr = QRCode.create(link, { errorCorrectionLevel: 'H' })
  const n = qr.modules.size
  const data = qr.modules.data
  const quiet = 2
  const cell = size / (n + quiet * 2)
  const ox = cx - size / 2 + quiet * cell
  const oy = cy - size / 2 + quiet * cell
  ctx.fillStyle = NAVY_DEEP
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (data[r * n + c]) {
        ctx.beginPath()
        ctx.arc(ox + c * cell + cell / 2, oy + r * cell + cell / 2, cell * 0.46, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  if (logoImg) {
    const ls = size * 0.26
    const lx = cx - ls / 2
    const ly = cy - ls / 2
    ctx.save()
    roundRectPath(ctx, lx - 7, ly - 7, ls + 14, ls + 14, 16)
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()
    ctx.drawImage(logoImg, lx, ly, ls, ls)
    ctx.restore()
  } else {
    ctx.save()
    roundRectPath(ctx, cx - size * 0.13, cy - size * 0.13, size * 0.26, size * 0.26, 14)
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()
    ctx.fillStyle = GOLD
    ctx.font = `900 ${Math.round(size * 0.09)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('النخبة', cx, cy + size * 0.03)
    ctx.restore()
  }
}

/**
 * Paint the Visa-style card (design v2 — diagonal, off-axis) on a canvas.
 * `link` is the portal URL the QR encodes (dot-QR drawn here, level H).
 */
export async function paintCardCanvas({ student, link, placeholder = false } = {}) {
  await loadFonts()
  const logoImg = await loadLogo()
  const SCALE = 1.2
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(CARD_W_PX * SCALE)
  canvas.height = Math.round(CARD_H_PX * SCALE)
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'top'

  const W = CARD_W_PX
  const H = CARD_H_PX
  const M = 52

  // ── face: navy, rounded ──
  roundRectPath(ctx, 0, 0, W, H, 48)
  ctx.fillStyle = NAVY
  ctx.fill()
  ctx.save()
  roundRectPath(ctx, 0, 0, W, H, 48)
  ctx.clip()

  // ── diagonal gold band (off-axis, sweeping from mid-left down to bottom-right)
  const bandAngle = -0.10 // rad ≈ -5.7°
  ctx.save()
  ctx.translate(W * 0.5, H * 0.62)
  ctx.rotate(bandAngle)
  ctx.fillStyle = GOLD
  ctx.fillRect(-W, -38, W * 2, 76)
  ctx.fillStyle = 'rgba(255,255,255,.10)'
  ctx.fillRect(-W, 44, W * 2, 16)
  ctx.fillStyle = 'rgba(14,35,80,.16)'
  ctx.fillRect(-W, -52, W * 2, 10)
  ctx.restore()

  // faint oversized QR-dot texture in the top-left corner (off-axis deco)
  ctx.save()
  ctx.globalAlpha = 0.10
  ctx.fillStyle = GOLD
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 6; c += 1) {
      if ((r * 6 + c * 5) % 3 === 0) continue
      ctx.beginPath()
      ctx.arc(36 + c * 26, 30 + r * 26, 9, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()

  // ── header (top band area) ──
  ctx.save()
  ctx.translate(0, 0)
  ctx.rotate(-0.02)
  ctx.textAlign = 'right'
  ctx.fillStyle = GOLD
  ctx.font = `900 50px ${FONT}`
  ctx.fillText('النخبة', W - M, 34)
  const wordmarkW = ctx.measureText('النخبة').width
  const wordmarkLeft = W - M - wordmarkW
  ctx.fillStyle = 'rgba(255,255,255,.25)'
  ctx.fillRect(wordmarkLeft - 20, 40, 2, 40)
  ctx.fillStyle = 'rgba(255,255,255,.72)'
  ctx.font = `700 19px ${FONT}`
  setLetterSpacing(ctx, '7px')
  ctx.fillText('NOKHBA', wordmarkLeft - 38, 44)
  setLetterSpacing(ctx, '1px')
  ctx.textAlign = 'left'
  ctx.font = `800 20px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,.6)'
  ctx.fillText('كرت طالب · STUDENT CARD', M - 6, 46)
  ctx.restore()

  // ── EMV chip (right side, tilted — off-axis) ──
  const chipW = 112
  const chipH = 86
  ctx.save()
  ctx.translate(W - M - chipW / 2, 176)
  ctx.rotate(-0.09)
  ctx.fillStyle = GOLD
  roundRectPath(ctx, -chipW / 2, -chipH / 2, chipW, chipH, 16)
  ctx.fill()
  ctx.strokeStyle = 'rgba(20,45,98,.55)'
  ctx.lineWidth = 2
  roundRectPath(ctx, -chipW / 2 + 13, -chipH / 2 + 13, chipW - 26, chipH - 26, 9)
  ctx.stroke()
  ctx.beginPath(); ctx.moveTo(-chipW / 2 + 13, 0); ctx.lineTo(chipW / 2 - 13, 0); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, -chipH / 2 + 13); ctx.lineTo(0, chipH / 2 - 13); ctx.stroke()
  ctx.restore()

  // ── QR panel (left, off-axis white card) ──
  const qrPanel = 258
  const qrX = 74
  const qrY = 196
  ctx.save()
  ctx.translate(qrX + qrPanel / 2, qrY + qrPanel / 2)
  ctx.rotate(-0.055)
  ctx.fillStyle = '#FFFFFF'
  roundRectPath(ctx, -qrPanel / 2, -qrPanel / 2, qrPanel, qrPanel, 30)
  ctx.fill()
  ctx.strokeStyle = GOLD_SOFT
  ctx.lineWidth = 3
  roundRectPath(ctx, -qrPanel / 2 + 8, -qrPanel / 2 + 8, qrPanel - 16, qrPanel - 16, 24)
  ctx.stroke()
  if (!placeholder && link) {
    try {
      await drawDotQR(ctx, link, 0, 0, qrPanel - 44, logoImg)
    } catch { /* fall through to empty frame below */ }
  }
  if (placeholder || !link) {
    const inner = qrPanel - 60
    ctx.strokeStyle = '#B6C2D8'
    ctx.lineWidth = 3
    ctx.setLineDash([10, 8])
    roundRectPath(ctx, -inner / 2, -inner / 2, inner, inner, 14)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.textAlign = 'center'
    ctx.fillStyle = '#8B99B4'
    ctx.font = `800 28px ${FONT}`
    ctx.fillText('QR الطالب', 0, -22)
    ctx.fillStyle = '#A5B1C6'
    ctx.font = `700 16px ${FONT}`
    ctx.fillText('يُطبع بعد تسجيل الطالب', 0, 12)
  }
  ctx.restore()

  // ── identity block (right of the QR, under the chip) ──
  const idRight = W - M
  const idLeft = qrX + qrPanel + 44
  const idMax = idRight - idLeft
  ctx.textAlign = 'right'
  let y = 356
  if (placeholder) {
    ctx.strokeStyle = 'rgba(255,255,255,.55)'
    ctx.lineWidth = 3
    ctx.setLineDash([14, 10])
    ctx.beginPath(); ctx.moveTo(idRight, y + 48); ctx.lineTo(idLeft + 60, y + 48); ctx.stroke()
    ctx.setLineDash([])
    y += 72
    ctx.font = `700 25px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,.85)'
    const label = 'كود الطالب: '
    ctx.fillText(label, idRight, y)
    const labelW = ctx.measureText(label).width
    ctx.fillStyle = GOLD
    ctx.font = `800 25px ${FONT}`
    setLetterSpacing(ctx, '2px')
    ctx.fillText('F-•••••', idRight - labelW - 6, y)
    setLetterSpacing(ctx, '0px')
    y += 42
    ctx.fillStyle = 'rgba(255,255,255,.6)'
    ctx.font = `700 21px ${FONT}`
    ctx.fillText('المجموعة / المرحلة: ..................', idRight, y)
  } else {
    const name = String(student?.name || '').trim() || '—'
    const size = fitFontSize(ctx, name, 42, 27, idMax)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = `800 ${size}px ${FONT}`
    ctx.fillText(name, idRight, y)
    y += Math.round(size * 1.4)
    ctx.font = `700 25px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,.85)'
    const label = 'كود الطالب: '
    ctx.fillText(label, idRight, y)
    const labelW = ctx.measureText(label).width
    ctx.fillStyle = GOLD
    ctx.font = `800 25px ${FONT}`
    setLetterSpacing(ctx, '2px')
    ctx.fillText(String(student?.code || '—'), idRight - labelW - 6, y)
    setLetterSpacing(ctx, '0px')
    const meta = [student?.group_name, student?.stage].filter(Boolean).join(' · ')
    if (meta) {
      y += 42
      ctx.fillStyle = 'rgba(255,255,255,.62)'
      ctx.font = `700 21px ${FONT}`
      ctx.fillText(meta, idRight, y)
    }
  }

  // ── bottom strip: diagonal divider + note ──
  const stripTop = H - 96
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(0, stripTop + 26)
  ctx.lineTo(W, stripTop)
  ctx.lineTo(W, H)
  ctx.lineTo(0, H)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,.06)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(245,197,66,.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, stripTop + 26)
  ctx.lineTo(W, stripTop)
  ctx.stroke()
  ctx.restore()

  const note = placeholder
    ? 'كرت جاهز للتسليم — بعد تسجيل الطالب اطبع كرته الرسمية من صفحة الطلاب (QR الحضور)'
    : 'امسح الكود بكاميرا النخبة داخل الحصة لتسجيل الحضور — أو امسحه بأي كاميرا وادخل على موقع النخبة'
  ctx.textAlign = 'right'
  ctx.font = `700 20px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,.85)'
  const noteMax = W - M - 250
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
  const noteY = stripTop + 34 + (lines.length === 2 ? 0 : 12)
  lines.forEach((line, i) => ctx.fillText(line, W - M, noteY + i * 28))
  ctx.textAlign = 'left'
  ctx.fillStyle = GOLD
  ctx.font = `700 17px ${FONT}`
  setLetterSpacing(ctx, '1px')
  ctx.fillText('al-nokhbba.vercel.app', M, H - 34)
  setLetterSpacing(ctx, '0px')

  ctx.restore() // face clip
  return canvas
}

/** Render one card → JPEG data URL (0.92 keeps the sheet light: PNG canvases
 * weighed ~2.9MB each — 40 cards ≈ 110MB). QR robustness is preserved by
 * error-correction level H (30% tolerance) — see drawDotQR. */
async function renderCardToImage(opts) {
  const canvas = await paintCardCanvas(opts)
  return canvas.toDataURL('image/jpeg', 0.92)
}

/**
 * Resolve portal links for a list of students (concurrency 4).
 * @returns {Promise<{ entries: Array<{student, link}>, failed: number }>}
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
        return { student, link: buildStudentQRLink(token) }
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
  const link = buildStudentQRLink(token)
  const img = await renderCardToImage({ student, link })
  const safeCode = String(student.code || student.id).replace(/[^A-Za-z0-9-]/g, '_')
  return composeCardsPdf({ cards: [img], fileName: `nokhba-card-${safeCode}.pdf`, download })
}

/**
 * Print cards for MANY students (bulk selection / whole center).
 * @returns {{ success, failed, printed }} — failed = students skipped
 *   (token/QR generation failed); printed = cards placed on the sheet.
 */
export async function printStudentsCardsPdf(students, { download = true, onProgress } = {}) {
  // Progress is reported 0→50% during token/link resolution and 50→100%
  // during card painting — big centers (500+ students) get live feedback
  // (Task 68 review note 3).
  const total = (students || []).filter(Boolean).length
  const { entries, failed } = await buildStudentCardEntries(students, {
    onProgress: (done, t) => onProgress?.(Math.round((done / Math.max(t, 1)) * 50), 100),
  })
  if (!entries.length) return { success: false, failed, printed: 0 }
  const imgList = []
  for (let i = 0; i < entries.length; i += 1) {
    imgList.push(await renderCardToImage({ student: entries[i].student, link: entries[i].link }))
    onProgress?.(50 + Math.round(((i + 1) / entries.length) * 50), 100)
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
