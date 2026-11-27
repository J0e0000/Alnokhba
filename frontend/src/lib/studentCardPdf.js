/**
 * Student QR CARDS — printable card + A4 sheet composer (Task 68).
 * ─────────────────────────────────────────────────────────────────────────
 * DESIGN v5 (review round 6 — owner spec, relay note #32): the card-linking
 * idea is CANCELLED — every student keeps their OWN F-code and their OWN QR
 * token (the QR-modal link and the printed card QR are the same, always).
 *   FRONT = النخبة logo lockup + student NAME + F-code over a thin accent
 *           line + stage/group — on a soft modern gradient.
 *   BACK  = the QR in a white rounded tile — nothing else.
 *   BLANK STOCK = simple placeholder cards (dashed write-in lines + dashed
 *           empty QR tile), printed before students exist.
 * Four selectable gradient styles — A Midnight Blue, B Ivory Gold (DEFAULT),
 * C Emerald Night, D Sunset Violet — chosen in the cards modal and persisted
 * per device; getSavedCardStyle() drives every print path that doesn't pass
 * an explicit style (note #31-2: the choice must drive EVERY path).
 *
 * PDF PAGE FIX (note #31-1): the backs section previously overprinted the
 * fronts on page 1 (no addPage between the two sections). Pages are now
 * started unconditionally: page 1 = fronts, page 2 = backs (verified with
 * pdfinfo: exactly 2 pages for one 8-card batch).
 *
 * CORNERS (note #25-2): JPEG has no alpha — transparent canvas corners
 * rasterize BLACK. The canvas is filled WHITE first → paper-white corners.
 *
 * QR (note #25 + #31): dot matrix painted on a 3× offscreen canvas and
 * downscaled (at-size dots turn mushy through JPEG), radius 0.50 so dots
 * touch (0.46 gaps failed decode at some sampling scales). Verified: the A4
 * PDF raster decodes the exact portal URL with jsQR and OpenCV.
 */
import { getOrCreateStudentToken, buildStudentQRLink } from './qrPdfWhatsApp'

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

/* ── SELECTABLE GRADIENT STYLES (notes #30/#32: four, default B) ─────────── */
export const CARD_STYLES = {
  'midnight-blue': {
    id: 'midnight-blue',
    label: 'أ — أزرق منتصف الليل',
    swatch: ['#0B1F47', '#2E6BC9'],
    gradient: ['#0B1F47', '#163C86', '#2E6BC9'],
    accent: '#FFC95C',
    nameColor: '#FFFFFF',
    codeColor: '#FFE3A0',
    border: 'rgba(255,255,255,.28)',
    sub: 'rgba(255,255,255,.62)',
  },
  'ivory-gold': {
    id: 'ivory-gold',
    label: 'ب — عاجي/ذهبي',
    swatch: ['#FBFAF6', '#E9D8A6'],
    gradient: ['#FCFBF7', '#F4E9CF', '#E7D39B'],
    accent: '#142D62',
    nameColor: '#142D62',
    codeColor: '#8A6A1C',
    border: 'rgba(20,45,98,.18)',
    sub: 'rgba(20,45,98,.5)',
  },
  'emerald-night': {
    id: 'emerald-night',
    label: 'ج — زمردي ليلي',
    swatch: ['#06231C', '#1E8A6A'],
    gradient: ['#051E18', '#0E4D3C', '#1E8A6A'],
    accent: '#E9D8A6',
    nameColor: '#F6F3E7',
    codeColor: '#F2E6B8',
    border: 'rgba(255,255,255,.25)',
    sub: 'rgba(255,255,255,.6)',
  },
  'sunset-violet': {
    id: 'sunset-violet',
    label: 'د — بنفسجي الغروب',
    swatch: ['#1E1B4B', '#DB2777'],
    gradient: ['#1E1B4B', '#6D28D9', '#DB2777'],
    accent: '#FCD34D',
    nameColor: '#FFFFFF',
    codeColor: '#FFE9F5',
    border: 'rgba(255,255,255,.28)',
    sub: 'rgba(255,255,255,.62)',
  },
}

export const DEFAULT_CARD_STYLE = 'ivory-gold' // notes #30/#32: B is the default

const STYLE_LS_KEY = 'alnokhba_card_style'

export function normalizeCardStyle(style) {
  return CARD_STYLES[style] ? style : DEFAULT_CARD_STYLE
}

/** The teacher's persisted style choice — used by EVERY print path that is
 * not given an explicit style (QR-modal single card, etc.). */
export function getSavedCardStyle() {
  try { return normalizeCardStyle(localStorage.getItem(STYLE_LS_KEY)) } catch { return DEFAULT_CARD_STYLE }
}

export function saveCardStyle(style) {
  const id = normalizeCardStyle(style)
  try { localStorage.setItem(STYLE_LS_KEY, id) } catch { /* private mode */ }
  return id
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
        '800 30px Cairo', '900 44px Cairo', '900 54px Cairo',
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
 * `text` within `maxWidth`, never falling below `minSize`. */
function fitFontSize(ctx, text, startSize, minSize, maxWidth) {
  let size = startSize
  ctx.font = `900 ${size}px ${FONT}`
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 2
    ctx.font = `900 ${size}px ${FONT}`
  }
  return size
}

/* ── ROUNDED-DOT QR (3× supersampled — see header) ───────────────────────── */
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

/** Draw the النخبة logo lockup (mark + wordmark) centered at (cx, cy). */
function drawLogoLockup(ctx, logoImg, style, cx, cy) {
  const markS = 72
  ctx.textAlign = 'center'
  ctx.fillStyle = style.accent
  ctx.font = `900 58px ${FONT}`
  const wordW = ctx.measureText('النخبة').width
  const gx = cx - (markS + 18 + wordW) / 2
  if (logoImg) ctx.drawImage(logoImg, gx, cy - markS / 2, markS, markS)
  ctx.fillText('النخبة', gx + markS + 18 + wordW / 2, cy - 29)
}

/**
 * FRONT (note #32-2): logo + student NAME + F-code over a thin accent line
 * + stage/group — the student's own identity; their own QR on the back.
 */
export async function paintCardFront({ student, style: styleId } = {}) {
  await loadFonts()
  const logoImg = await loadLogo()
  const style = CARD_STYLES[normalizeCardStyle(styleId)]
  const { canvas, ctx } = newCardCanvas()
  const W = CARD_W_PX
  paintFace(ctx, style)

  drawLogoLockup(ctx, logoImg, style, W / 2, 118)

  const name = String(student?.name || '').trim()
  const code = String(student?.code || '').trim()
  const meta = [student?.group_name, student?.stage].filter(Boolean).join(' — ')

  ctx.textAlign = 'center'
  if (name) {
    const size = fitFontSize(ctx, name, 56, 30, W - 160)
    ctx.font = `900 ${size}px ${FONT}`
    ctx.fillStyle = style.nameColor
    ctx.fillText(name, W / 2, 208)
  }
  if (code) {
    // F-code over a thin accent line (note #30) — no dark rectangle (#25-1)
    ctx.font = `800 40px ${MONO}`
    setLetterSpacing(ctx, '6px')
    ctx.fillStyle = style.codeColor
    ctx.fillText(code, W / 2, 306)
    setLetterSpacing(ctx, '0px')
    const codeW = Math.min(ctx.measureText(code).width + 48, W - 200)
    ctx.fillStyle = style.accent
    roundRectPath(ctx, W / 2 - codeW / 2, 368, codeW, 3.5, 2)
    ctx.fill()
  }
  if (meta) {
    ctx.font = `300 24px ${FONT}`
    ctx.fillStyle = style.sub
    ctx.fillText(meta, W / 2, 404)
  }
  return canvas
}

/**
 * BACK (note #32-2): the student's own QR in a white rounded tile — the
 * SAME token the QR modal shows (getOrCreateStudentToken is the only source).
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

/**
 * BLANK STOCK CARD (note #32-6): simple placeholder — dashed write-in lines
 * (name / F-code / stage-group) on the front, a dashed empty QR tile on the
 * back. Printed BEFORE students exist; the real card comes from the
 * student's own page afterwards.
 */
export async function paintBlankFront({ style: styleId } = {}) {
  await loadFonts()
  const logoImg = await loadLogo()
  const style = CARD_STYLES[normalizeCardStyle(styleId)]
  const { canvas, ctx } = newCardCanvas()
  const W = CARD_W_PX
  paintFace(ctx, style)
  drawLogoLockup(ctx, logoImg, style, W / 2, 118)

  ctx.textAlign = 'center'
  ctx.strokeStyle = style.sub
  ctx.lineWidth = 2.5
  ctx.setLineDash([12, 10])
  const line = (y) => { ctx.beginPath(); ctx.moveTo(W / 2 - 300, y); ctx.lineTo(W / 2 + 300, y); ctx.stroke() }
  line(248)
  line(338)
  line(424)
  ctx.setLineDash([])
  ctx.font = `300 22px ${FONT}`
  ctx.fillStyle = style.sub
  ctx.fillText('الاسم', W / 2 - 334, 218)
  ctx.fillText('كود الطالب', W / 2 - 334, 308)
  ctx.fillText('المجموعة / المرحلة', W / 2 - 334, 394)
  return canvas
}

export async function paintBlankBack({ style: styleId } = {}) {
  await loadFonts()
  const style = CARD_STYLES[normalizeCardStyle(styleId)]
  const { canvas, ctx } = newCardCanvas()
  const W = CARD_W_PX
  const H = CARD_H_PX
  paintFace(ctx, style)
  ctx.textAlign = 'center'
  ctx.strokeStyle = style.sub
  ctx.lineWidth = 3
  ctx.setLineDash([14, 11])
  roundRectPath(ctx, W / 2 - 190, H / 2 - 190, 380, 380, 32)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.font = `300 26px ${FONT}`
  ctx.fillStyle = style.sub
  ctx.fillText('QR الطالب', W / 2, H / 2 + 212)
  return canvas
}

/** Render one card face → JPEG data URL (0.92 keeps the sheet light). */
async function renderToImage(painter, opts) {
  const canvas = await painter(opts)
  return canvas.toDataURL('image/jpeg', 0.92)
}

/**
 * Resolve portal links for a list of students (concurrency 4). Each entry
 * uses the student's OWN token — the same one the QR modal shows
 * (note #31-3: modal link, WhatsApp share and printed card must match).
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
 * Compose the A4 sheet: 2 × 4 cards per page with dashed cut guides.
 * PAGE LAYOUT (note #31-1 bug fix): page 1..n = FRONTS, then n+1.. = BACKS —
 * a new page is started UNCONDITIONALLY whenever a section (or a full page)
 * begins, so backs never overprint fronts (pdfinfo: exactly 2 pages for one
 * 8-card batch).
 * `pairs` = array of { front, back } image data URLs.
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

  let pageStarted = false
  const startPage = (side) => {
    if (pageStarted) doc.addPage()
    pageStarted = true
    drawGuides()
    footer(`Nokhba ${label} — ${side} — cut along the dashed lines`)
  }

  const placeFaces = (imgs, side) => {
    for (let i = 0; i < imgs.length; i += 1) {
      const slot = i % PER_PAGE
      if (slot === 0) startPage(side)
      const r = Math.floor(slot / COLS)
      const c = slot % COLS
      const x = MARGIN_X + c * (CARD_W_MM + GAP_X)
      const y = MARGIN_Y + r * CELL_H
      doc.addImage(imgs[i], 'JPEG', x, y, CARD_W_MM, CARD_H_MM)
    }
  }

  placeFaces(pairs.map((p) => p.front), 'FRONT')
  placeFaces(pairs.map((p) => p.back), 'BACK')

  if (download) {
    doc.save(fileName)
  }
  return { success: true, cards: pairs.length, pages: doc.getNumberOfPages() }
}

/**
 * Print ONE student's card (front + back) — the student's OWN QR token, so
 * the printed QR is identical to the QR-modal link and WhatsApp share.
 */
export async function printStudentCardPdf(student, { style, download = true } = {}) {
  if (!student?.id) return { success: false, reason: 'student' }
  const token = await getOrCreateStudentToken(student.id)
  if (!token) return { success: false, reason: 'token' }
  const link = buildStudentQRLink(token)
  const chosen = style || getSavedCardStyle()
  const [front, back] = await Promise.all([
    renderToImage(paintCardFront, { student, style: chosen }),
    renderToImage(paintCardBack, { link, style: chosen }),
  ])
  const safeCode = String(student.code || student.id).replace(/[^A-Za-z0-9-]/g, '_')
  return composeCardsPdf({ pairs: [{ front, back }], fileName: `nokhba-card-${safeCode}.pdf`, download, label: 'student QR card' })
}

/**
 * Print cards for MANY students (bulk selection / whole center) — ALL
 * selected students print (note #32-5: no card-holding filter).
 */
export async function printStudentsCardsPdf(students, { style, download = true, onProgress } = {}) {
  const { entries, failed } = await buildStudentCardEntries(students, {
    onProgress: (done, t) => onProgress?.(Math.round((done / Math.max(t, 1)) * 50), 100),
  })
  if (!entries.length) return { success: false, failed, printed: 0 }
  const chosen = style || getSavedCardStyle()
  const pairs = []
  for (let i = 0; i < entries.length; i += 1) {
    const { student, link } = entries[i]
    const [front, back] = await Promise.all([
      renderToImage(paintCardFront, { student, style: chosen }),
      renderToImage(paintCardBack, { link, style: chosen }),
    ])
    pairs.push({ front, back })
    onProgress?.(50 + Math.round(((i + 1) / entries.length) * 50), 100)
  }
  const res = await composeCardsPdf({ pairs, fileName: 'nokhba-student-cards.pdf', download })
  return { ...res, failed, printed: pairs.length }
}

/**
 * Print N BLANK placeholder cards (note #32-6): simple stock — dashed
 * write-in lines + dashed empty QR tile, same selected style. Printed
 * BEFORE students exist; no codes, no pool, no bookkeeping.
 * @param {number} count 1–40 — 8 per A4 page (fronts page + backs page).
 */
export async function printPlaceholderCardsPdf(count = 8, { style, download = true } = {}) {
  const n = Math.max(1, Math.min(40, Math.floor(Number(count) || 0)))
  const chosen = style || getSavedCardStyle()
  const pairs = []
  for (let i = 0; i < n; i += 1) {
    const [front, back] = await Promise.all([
      renderToImage(paintBlankFront, { style: chosen }),
      renderToImage(paintBlankBack, { style: chosen }),
    ])
    pairs.push({ front, back })
  }
  return composeCardsPdf({ pairs, fileName: 'nokhba-blank-cards.pdf', download, label: 'blank stock cards' })
}
