/**
 * Student QR CARDS — printable card + A4 sheet composer (Task 68).
 * ─────────────────────────────────────────────────────────────────────────
 * DESIGN v4 (review round 5 — owner spec, relay note #27): FRONT/BACK.
 *   FRONT = النخبة logo lockup + the 5-digit card code on a soft modern
 *           gradient — NOTHING else (no name, no group/stage, no site URL).
 *   BACK  = the QR — nothing else.
 * Three selectable gradient styles (navy/blue, ivory/gold, dark/emerald)
 * picked in the cards modal; the choice persists on the teacher's device.
 *
 * The QR encodes the SAME portal URL the system already issues
 * (…/qr/<token>): phone camera → public portal page; Nokhba in-app scanner
 * → resolve_student_by_qr RPC → attendance. It lives on the BACK inside a
 * white rounded well (dark dot modules — maximum scanner contrast on every
 * style), error-correction level H.
 *
 * CORNER FIX (note #25-2): JPEG has no alpha — transparent canvas corners
 * rasterize BLACK in the PDF. The canvas is filled WHITE first, so the area
 * outside the rounded card is white/paper, never black.
 *
 * CODE PILL FIX (note #25-1): there is no pill/rectangle around the code at
 * all — the digits sit directly on the gradient in a high-contrast color,
 * centered, fully readable.
 *
 * PRE-PRINTED BLANK CARDS (pool): printBlankCardsPdf() reserves real cards
 * in the pool (src/lib/cardPool.js) — each with a unique 5-digit code and
 * its own QR token. When a student is registered the card is assigned and
 * the SAME printed QR resolves to that student.
 *
 * PDF: A4 portrait, 2 × 4 grid (8 cards/page) — page(s) of FRONTS followed
 * by page(s) of BACKS, dashed cut guides, English-only footer (jsPDF core
 * fonts cannot render Arabic — all Arabic lives inside the card images).
 */
import { getOrCreateStudentToken, buildStudentQRLink } from './qrPdfWhatsApp'
import { generateBlankCards } from './cardPool'

// ISO ID-1 in mm — do not change without changing the composer geometry.
export const CARD_W_MM = 85.6
export const CARD_H_MM = 53.98

// Canvas scale: 12 px per mm, rendered at 1.2× ≈ 366 DPI at print size.
const PX_PER_MM = 12
const CARD_W_PX = Math.round(CARD_W_MM * PX_PER_MM) // 1027
const CARD_H_PX = Math.round(CARD_H_MM * PX_PER_MM) // 648

const NAVY = '#142D62' // QR dot color on every style — scanner-safe contrast
const QR_PANEL_BG = '#FFFFFF'
const FONT = 'Cairo'
const MONO = `'DM Mono','JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`
const LOGO_URL = '/nokhba-mark.svg'

/* ── SELECTABLE GRADIENT STYLES (note #27-6) ─────────────────────────────── */
export const CARD_STYLES = {
  'navy-blue': {
    id: 'navy-blue',
    label: 'أ — كحلي/أزرق ملكي',
    swatch: ['#0E2350', '#2E6BC9'],
    gradient: ['#0B1F47', '#163C86', '#2E6BC9'],
    accent: '#FFC95C', // wordmark + hairlines on dark faces
    codeColor: '#FFE3A0',
    border: 'rgba(255,255,255,.28)',
    sub: 'rgba(255,255,255,.55)',
  },
  'ivory-gold': {
    id: 'ivory-gold',
    label: 'ب — عاجي/ذهبي',
    swatch: ['#FBFAF6', '#E9D8A6'],
    gradient: ['#FCFBF7', '#F4E9CF', '#E7D39B'],
    accent: '#142D62', // logo wordmark reads navy on the light face
    codeColor: '#142D62',
    border: 'rgba(20,45,98,.18)',
    sub: 'rgba(20,45,98,.45)',
  },
  'dark-emerald': {
    id: 'dark-emerald',
    label: 'ج — زمردي داكن',
    swatch: ['#06231C', '#1E8A6A'],
    gradient: ['#051E18', '#0E4D3C', '#1E8A6A'],
    accent: '#E9D8A6',
    codeColor: '#F2E6B8',
    border: 'rgba(255,255,255,.25)',
    sub: 'rgba(255,255,255,.55)',
  },
}

export const DEFAULT_CARD_STYLE = 'navy-blue'

export function normalizeCardStyle(style) {
  return CARD_STYLES[style] ? style : DEFAULT_CARD_STYLE
}

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
        '300 20px Cairo', '400 20px Cairo', '700 18px Cairo',
        '800 30px Cairo', '900 44px Cairo', '900 64px Cairo',
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

/* ── ROUNDED-DOT QR ────────────────────────────────────────────────────────
 * QRCode.create() gives the raw module matrix; every dark module becomes a
 * circle. The النخبة mark sits in a white rounded well at the centre —
 * safe at EC level H (30% damage tolerance).
 * SUPER-SAMPLING (review round 5): dots drawn directly at print size turn
 * mushy through JPEG + rasterization and scanners fail to read them — so
 * the matrix is painted on an offscreen canvas at 3× and downscaled, which
 * keeps every module crisp (verified: decodes at print size, logo well on).
 * */
async function drawDotQR(ctx, link, cx, cy, size, logoImg) {
  const QRCode = (await import('qrcode')).default
  const qr = QRCode.create(link, { errorCorrectionLevel: 'H' })
  const n = qr.modules.size
  const data = qr.modules.data
  const quiet = 2
  const SS = 3
  const px = Math.ceil(size * SS)
  const off = document.createElement('canvas')
  off.width = px
  off.height = px
  const octx = off.getContext('2d')
  const cell = px / (n + quiet * 2)
  // radius 0.50 = dots just touch: with 0.46 the inter-dot gaps survive the
  // JPEG/PDF resampling and BOTH jsQR and cv2 failed to read at some
  // sampling scales — touching dots read as solid modules at every scale.
  octx.fillStyle = NAVY
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (data[r * n + c]) {
        octx.beginPath()
        octx.arc((quiet + c + 0.5) * cell, (quiet + r + 0.5) * cell, cell * 0.5, 0, Math.PI * 2)
        octx.fill()
      }
    }
  }
  if (logoImg) {
    const ls = px * 0.22
    const lx = px / 2 - ls / 2
    const ly = px / 2 - ls / 2
    const pad = 7 * SS
    octx.save()
    roundRectPath(octx, lx - pad, ly - pad, ls + pad * 2, ls + pad * 2, 16 * SS)
    octx.fillStyle = '#FFFFFF'
    octx.fill()
    octx.drawImage(logoImg, lx, ly, ls, ls)
    octx.restore()
  }
  ctx.drawImage(off, cx - size / 2, cy - size / 2, size, size)
}

function newCardCanvas() {
  const SCALE = 1.2
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(CARD_W_PX * SCALE)
  canvas.height = Math.round(CARD_H_PX * SCALE)
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'top'
  // JPEG has no alpha: seed WHITE so the area outside the rounded card is
  // paper-white in the PDF — never black wedges (note #25-2).
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, CARD_W_PX, CARD_H_PX)
  return { canvas, ctx }
}

function paintFace(ctx, style) {
  const W = CARD_W_PX
  const H = CARD_H_PX
  // soft modern diagonal gradient (ivory→gold / navy→blue / dark→emerald)
  const g = ctx.createLinearGradient(W, 0, 0, H)
  g.addColorStop(0, style.gradient[0])
  g.addColorStop(0.55, style.gradient[1])
  g.addColorStop(1, style.gradient[2])
  roundRectPath(ctx, 0, 0, W, H, 44)
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = style.border
  ctx.lineWidth = 2.5
  roundRectPath(ctx, 4, 4, W - 8, H - 8, 40)
  ctx.stroke()
}

/**
 * FRONT (note #27): gradient face + logo lockup + 5-digit code — nothing
 * else. `code` is the card's permanent 5-digit pool code; when a student
 * has no assigned pool code yet the front stays logo-only.
 */
export async function paintCardFront({ code, style: styleId } = {}) {
  await loadFonts()
  const logoImg = await loadLogo()
  const style = CARD_STYLES[normalizeCardStyle(styleId)]
  const { canvas, ctx } = newCardCanvas()
  const W = CARD_W_PX
  const H = CARD_H_PX
  paintFace(ctx, style)

  // logo lockup — mark + wordmark, centered
  const markS = 74
  ctx.textAlign = 'center'
  ctx.fillStyle = style.accent
  ctx.font = `900 60px ${FONT}`
  const wordW = ctx.measureText('النخبة').width
  const groupW = markS + 18 + wordW
  const gx = W / 2 - groupW / 2
  if (logoImg) ctx.drawImage(logoImg, gx, H / 2 - markS - 66, markS, markS)
  ctx.fillText('النخبة', gx + markS + 18 + wordW / 2, H / 2 - markS - 58)

  // the 5-digit code — the ONE thing on the face besides the logo: big,
  // centered, high-contrast, NO rectangle behind it (note #25-1)
  const codeText = code ? String(code).trim() : ''
  if (codeText) {
    ctx.font = `800 74px ${MONO}`
    setLetterSpacing(ctx, '10px')
    ctx.fillStyle = style.codeColor
    ctx.fillText(codeText, W / 2, H / 2 + 8)
    setLetterSpacing(ctx, '0px')
    ctx.font = `300 20px ${FONT}`
    ctx.fillStyle = style.sub
    ctx.fillText('كود الكرت', W / 2, H / 2 + 108)
  }

  return canvas
}

/**
 * BACK (note #27): the QR — nothing else. Dot QR inside a white rounded
 * well, centered on the same gradient face.
 */
export async function paintCardBack({ link, style: styleId } = {}) {
  await loadFonts()
  const logoImg = await loadLogo()
  const style = CARD_STYLES[normalizeCardStyle(styleId)]
  const { canvas, ctx } = newCardCanvas()
  const W = CARD_W_PX
  const H = CARD_H_PX
  paintFace(ctx, style)

  const panel = Math.min(H - 72, 420)
  const px = W / 2 - panel / 2
  const py = H / 2 - panel / 2
  roundRectPath(ctx, px, py, panel, panel, 32)
  ctx.fillStyle = QR_PANEL_BG
  ctx.fill()
  if (link) {
    try {
      await drawDotQR(ctx, link, W / 2, H / 2, panel - 44, logoImg)
    } catch { /* leave the empty well on failure */ }
  }

  return canvas
}

/** Render one card face → JPEG data URL (0.92 keeps the sheet light). */
async function renderToImage(painter, opts) {
  const canvas = await painter(opts)
  return canvas.toDataURL('image/jpeg', 0.92)
}

/**
 * Resolve portal links for a list of students (concurrency 4).
 * @returns {Promise<{ entries: Array<{student, link}>, failed: number }>}
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
 * Compose the A4 sheet: 2 × 4 cards per page with dashed cut guides —
 * FRONTS page(s) first, then BACKS page(s) (note #27-5). `pairs` = array of
 * { front, back } image data URLs.
 */
async function composeCardsPdf({ pairs = [], fileName = 'nokhba-student-cards.pdf', download = true, label = 'student QR cards' } = {}) {
  if (!pairs.length) return { success: false, skipped: true }

  const jsPDF = await loadJsPDF()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()   // 210
  const pageH = doc.internal.pageSize.getHeight()  // 297

  const COLS = 2
  const ROWS = 4
  const PER_PAGE = COLS * ROWS
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

  const footer = (text) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(130)
    doc.text(text, pageW / 2, pageH - 6, { align: 'center' })
  }

  const placePage = (imgs, side) => {
    const pages = Math.ceil(imgs.length / PER_PAGE)
    for (let i = 0; i < imgs.length; i += 1) {
      const slot = i % PER_PAGE
      if (slot === 0) {
        if (i > 0) doc.addPage()
        drawGuides()
        footer(`Nokhba ${label} — ${side} — cut along the dashed lines`)
      }
      const r = Math.floor(slot / COLS)
      const c = slot % COLS
      const x = MARGIN_X + c * (CARD_W_MM + GAP_X)
      const y = MARGIN_Y + r * CELL_H
      doc.addImage(imgs[i], 'JPEG', x, y, CARD_W_MM, CARD_H_MM)
    }
    return pages
  }

  placePage(pairs.map((p) => p.front), 'FRONT')
  placePage(pairs.map((p) => p.back), 'BACK')

  if (download) {
    doc.save(fileName)
  }
  return { success: true, cards: pairs.length }
}

/**
 * Print ONE student's card (front + back). The student must be assigned a
 * pool card — the printed 5-digit code IS that card's code (note #27-4:
 * no printing for students without a card).
 */
export async function printStudentCardPdf(student, { style, download = true, poolCode } = {}) {
  if (!student?.id) return { success: false, reason: 'student' }
  const token = await getOrCreateStudentToken(student.id)
  if (!token) return { success: false, reason: 'token' }
  const link = buildStudentQRLink(token)
  const code = poolCode || student._poolCode || null
  const [front, back] = await Promise.all([
    renderToImage(paintCardFront, { code, style }),
    renderToImage(paintCardBack, { link, style }),
  ])
  const safeCode = String(code || student.code || student.id).replace(/[^A-Za-z0-9-]/g, '_')
  return composeCardsPdf({ pairs: [{ front, back }], fileName: `nokhba-card-${safeCode}.pdf`, download, label: 'student QR card' })
}

/**
 * Print cards for MANY students (bulk selection / whole center). Callers
 * pass ONLY students that are assigned a pool card (note #27-4) — each may
 * carry `_poolCode` so the printed face matches the physical card.
 */
export async function printStudentsCardsPdf(students, { style, download = true, onProgress } = {}) {
  const total = (students || []).filter(Boolean).length
  const { entries, failed } = await buildStudentCardEntries(students, {
    onProgress: (done, t) => onProgress?.(Math.round((done / Math.max(t, 1)) * 50), 100),
  })
  if (!entries.length) return { success: false, failed, printed: 0 }
  const pairs = []
  for (let i = 0; i < entries.length; i += 1) {
    const { student, link } = entries[i]
    const [front, back] = await Promise.all([
      renderToImage(paintCardFront, { code: student._poolCode || null, style }),
      renderToImage(paintCardBack, { link, style }),
    ])
    pairs.push({ front, back })
    onProgress?.(50 + Math.round(((i + 1) / entries.length) * 50), 100)
  }
  const res = await composeCardsPdf({ pairs, fileName: 'nokhba-student-cards.pdf', download })
  return { ...res, failed, printed: pairs.length }
}

/**
 * Print N blank cards from the PRE-PRINTED POOL (review round 4): every
 * card gets a unique 5-digit code (persisted in the pool) and the QR of its
 * own pool token — after assignment the SAME QR resolves to the student.
 * @param {string} teacherId  pool owner
 * @param {number} count      1–40 — 8 per A4 page.
 */
export async function printBlankCardsPdf(teacherId, count = 8, { style, download = true } = {}) {
  const n = Math.max(1, Math.min(40, Math.floor(Number(count) || 0)))
  const cards = await generateBlankCards(teacherId, n)
  if (!cards.length) return { success: false, failed: n, printed: 0 }
  const pairs = []
  for (const c of cards) {
    const link = buildStudentQRLink(c.token)
    const [front, back] = await Promise.all([
      renderToImage(paintCardFront, { code: c.code, style }),
      renderToImage(paintCardBack, { link, style }),
    ])
    pairs.push({ front, back })
  }
  const res = await composeCardsPdf({ pairs, fileName: 'nokhba-blank-cards.pdf', download, label: 'blank pool cards' })
  return { ...res, failed: 0, printed: pairs.length, cards }
}
