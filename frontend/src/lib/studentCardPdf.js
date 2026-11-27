/**
 * Student QR CARDS — printable card + A4 sheet composer (Task 68).
 * ─────────────────────────────────────────────────────────────────────────
 * DESIGN v3 (review round 4 — owner spec): CLEAN, modern, chic — no tilt,
 * no diagonal. Rounded corners and rounded elements everywhere, varied type
 * scale (Cairo 900 display for the name, 300 light for labels, monospace
 * for the code). QR = ROUNDED-DOT modules with the النخبة mark in the
 * centre, error-correction level H, painted module-by-module from the raw
 * matrix (Canvas 2D — no html2canvas, deterministic, Arabic-native).
 *
 * The QR encodes the SAME portal URL the system already issues
 * (…/qr/<token>): phone camera → public portal page; Nokhba in-app scanner
 * → resolve_student_by_qr RPC → attendance.
 *
 * PRE-PRINTED BLANK CARDS (pool): printBlankCardsPdf() reserves real cards
 * in the pool (src/lib/cardPool.js) — each with a unique 5-digit code and
 * its own QR token. When a student is registered the card is assigned
 * (search by code / auto-assign / new-student form) and the SAME printed QR
 * resolves to that student.
 *
 * PDF: A4 portrait, 2 × 4 grid (8 cards/page) with dashed cut guides and
 * an English-only footer (jsPDF core fonts cannot render Arabic — all
 * Arabic text lives inside the card images).
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

const NAVY = '#142D62'
const NAVY_DEEP = '#0E2350'
const GOLD = '#C9971C' // print-safe gold (darker than UI gold for contrast)
const GOLD_SOFT = 'rgba(201,151,28,.4)'
const IVORY = '#FBFAF6'
const INK = '#1C2430'
const MUTED = '#8B93A1'
const HAIR = '#E7E3DA'
const FONT = 'Cairo'
const MONO = `'DM Mono','JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`
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
        '300 20px Cairo', '400 20px Cairo', '400 22px Cairo', '700 18px Cairo',
        '700 26px Cairo', '800 21px Cairo', '900 44px Cairo', '900 54px Cairo',
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
function fitFontSize(ctx, text, startSize, minSize, maxWidth, weight = '900') {
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

/* ── ROUNDED-DOT QR ────────────────────────────────────────────────────────
 * QRCode.create() gives the raw module matrix; every dark module becomes a
 * circle. The النخبة mark sits in a white rounded well at the centre —
 * safe at EC level H (30% damage tolerance). */
async function drawDotQR(ctx, link, cx, cy, size, logoImg) {
  const QRCode = (await import('qrcode')).default
  const qr = QRCode.create(link, { errorCorrectionLevel: 'H' })
  const n = qr.modules.size
  const data = qr.modules.data
  const quiet = 2
  const cell = size / (n + quiet * 2)
  const ox = cx - size / 2 + quiet * cell
  const oy = cy - size / 2 + quiet * cell
  ctx.fillStyle = NAVY
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
  }
}

/**
 * Paint the card (design v3 — clean/Tilda) on a canvas.
 * - Real card:  { student, link }                — name/code/group + dot QR.
 * - Pool blank: { placeholder: true, code, link } — dashed write-in lines,
 *   the 5-digit pool code printed in monospace, dot QR of the pool token.
 * - Legacy blank stock (no pool): { placeholder: true } — empty QR frame.
 */
export async function paintCardCanvas({ student, link, code, placeholder = false } = {}) {
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
  const M = 54
  const isBlank = !!placeholder

  // ── face: ivory, rounded, hairline border ──
  roundRectPath(ctx, 0, 0, W, H, 44)
  ctx.fillStyle = IVORY
  ctx.fill()
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 2
  roundRectPath(ctx, 2, 2, W - 4, H - 4, 42)
  ctx.stroke()

  // ── header: logo + wordmark (right, RTL), product label (left, light) ──
  const logoS = 54
  if (logoImg) ctx.drawImage(logoImg, W - M - logoS, 36, logoS, logoS)
  ctx.textAlign = 'right'
  ctx.fillStyle = NAVY
  ctx.font = `900 34px ${FONT}`
  ctx.fillText('النخبة', W - M - logoS - 14, 42)
  ctx.textAlign = 'left'
  ctx.fillStyle = MUTED
  ctx.font = `300 18px ${FONT}`
  setLetterSpacing(ctx, '6px')
  ctx.fillText('STUDENT CARD', M, 46)
  setLetterSpacing(ctx, '0px')
  ctx.fillStyle = GOLD
  ctx.font = `700 15px ${FONT}`
  ctx.fillText('NOKHBA', M, 72)

  // ── QR panel (left): white card, gold hairline ring, dot QR + centre mark ──
  const qrPanel = 252
  const qrX = M
  const qrY = 208
  roundRectPath(ctx, qrX, qrY, qrPanel, qrPanel, 28)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.strokeStyle = GOLD_SOFT
  ctx.lineWidth = 3
  roundRectPath(ctx, qrX + 7, qrY + 7, qrPanel - 14, qrPanel - 14, 22)
  ctx.stroke()
  // QR link: real cards + pool blanks encode their real /qr/<token> URL;
  // legacy blank stock (no pool) renders the empty dashed frame instead.
  const qrLink = link || ''
  if (qrLink) {
    try {
      await drawDotQR(ctx, qrLink, qrX + qrPanel / 2, qrY + qrPanel / 2, qrPanel - 40, logoImg)
    } catch { /* empty frame below on failure */ }
  }
  if (!qrLink) {
    const inner = qrPanel - 56
    ctx.strokeStyle = '#D8D2C6'
    ctx.lineWidth = 3
    ctx.setLineDash([10, 8])
    roundRectPath(ctx, qrX + 28, qrY + 28, inner, inner, 16)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.textAlign = 'center'
    ctx.fillStyle = MUTED
    ctx.font = `700 26px ${FONT}`
    ctx.fillText('QR الطالب', qrX + qrPanel / 2, qrY + qrPanel / 2 - 26)
    ctx.font = `400 16px ${FONT}`
    ctx.fillText(isBlank ? 'يُربط بالطالب عند التعيين' : 'يُطبع بعد تسجيل الطالب', qrX + qrPanel / 2, qrY + qrPanel / 2 + 10)
  }

  // ── identity (right, RTL): name display → code mono pill → meta ──
  const idRight = W - M
  const idLeft = qrX + qrPanel + 46
  const idMax = idRight - idLeft
  ctx.textAlign = 'right'
  let y = 172
  if (!isBlank) {
    const name = String(student?.name || '').trim() || '—'
    const size = fitFontSize(ctx, name, 50, 30, idMax)
    ctx.fillStyle = INK
    ctx.font = `900 ${size}px ${FONT}`
    ctx.fillText(name, idRight, y)
    y += Math.round(size * 1.35)
    // label (light) + code (mono, on a soft gold pill)
    ctx.font = `300 20px ${FONT}`
    ctx.fillStyle = MUTED
    const label = 'كود الطالب'
    ctx.fillText(label, idRight, y)
    y += 34
    ctx.font = `700 30px ${MONO}`
    const codeText = String(student?.code || '—')
    const pillW = Math.min(ctx.measureText(codeText).width + 36, idMax)
    const pillH = 48
    roundRectPath(ctx, idRight - pillW, y, pillW, pillH, 14)
    ctx.fillStyle = 'rgba(201,151,28,.12)'
    ctx.fill()
    ctx.fillStyle = NAVY
    ctx.fillText(codeText, idRight - pillW + 18, y + 9)
    y += pillH + 26
    const meta = [student?.group_name, student?.stage].filter(Boolean).join(' · ')
    if (meta) {
      ctx.font = `400 21px ${FONT}`
      ctx.fillStyle = MUTED
      ctx.fillText(meta, idRight, y)
    }
  } else {
    // blank stock: dashed write-in lines + printed pool code
    ctx.strokeStyle = '#C9C3B6'
    ctx.lineWidth = 3
    ctx.setLineDash([14, 10])
    ctx.beginPath(); ctx.moveTo(idRight, y + 46); ctx.lineTo(idLeft + 40, y + 46); ctx.stroke()
    y += 78
    ctx.beginPath(); ctx.moveTo(idRight, y + 40); ctx.lineTo(idLeft + 40, y + 40); ctx.stroke()
    ctx.setLineDash([])
    ctx.font = `300 19px ${FONT}`
    ctx.fillStyle = MUTED
    ctx.fillText('الاسم', idRight, y + 52)
    y += 96
    if (code) {
      // the pool code — what the teacher types to assign this exact card
      ctx.font = `700 40px ${MONO}`
      const codeText = String(code)
      const pillW = Math.min(ctx.measureText(codeText).width + 40, idMax)
      roundRectPath(ctx, idRight - pillW, y, pillW, 62, 16)
      ctx.fillStyle = NAVY
      ctx.fill()
      ctx.fillStyle = GOLD
      ctx.fillText(codeText, idRight - pillW + 20, y + 10)
      y += 84
    }
    ctx.font = `300 20px ${FONT}`
    ctx.fillStyle = MUTED
    ctx.fillText('المجموعة / المرحلة', idRight, y)
  }

  // ── bottom: rounded gold divider + scan note + site ──
  const dividerY = H - 92
  ctx.strokeStyle = GOLD_SOFT
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(M, dividerY)
  ctx.lineTo(W - M, dividerY)
  ctx.stroke()
  const note = isBlank
    ? 'بطاقة جاهزة — اربطها بالطالب من صفحة الطلاب بعد التسجيل ليشتغل QR الحضور'
    : 'امسح الكود بكاميرا النخبة داخل الحصة لتسجيل الحضور — أو امسحه بأي كاميرا وادخل على موقع النخبة'
  ctx.textAlign = 'right'
  ctx.font = `400 19px ${FONT}`
  ctx.fillStyle = MUTED
  const noteMax = W - M * 2 - 190
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
  const noteY = dividerY + 16
  lines.forEach((line, i) => ctx.fillText(line, W - M, noteY + i * 26))
  ctx.textAlign = 'left'
  ctx.fillStyle = GOLD
  ctx.font = `700 16px ${FONT}`
  setLetterSpacing(ctx, '1px')
  ctx.fillText('al-nokhbba.vercel.app', M, H - 34)
  setLetterSpacing(ctx, '0px')

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
 * Print ONE student's card (QR portal link + F-code). StudentQRModal.
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
 */
export async function printStudentsCardsPdf(students, { download = true, onProgress } = {}) {
  // Progress 0→50% tokens/links, 50→100% painting — big centers get live
  // feedback (Task 68 review note 3).
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
 * Print N blank cards from the PRE-PRINTED POOL (review round 4): every
 * card gets a unique 5-digit code (persisted in the pool) and the QR of its
 * own pool token — after assignment the SAME QR resolves to the student.
 * @param {string} teacherId  pool owner
 * @param {number} count      1–40 — 8 per A4 page.
 */
export async function printBlankCardsPdf(teacherId, count = 8, { download = true } = {}) {
  const n = Math.max(1, Math.min(40, Math.floor(Number(count) || 0)))
  const cards = await generateBlankCards(teacherId, n)
  if (!cards.length) return { success: false, failed: n, printed: 0 }
  const imgList = []
  for (const c of cards) {
    const link = buildStudentQRLink(c.token)
    imgList.push(await renderCardToImage({ placeholder: true, code: c.code, link }))
  }
  const res = await composeCardsPdf({ cards: imgList, fileName: 'nokhba-blank-cards.pdf', download })
  return { ...res, failed: 0, printed: imgList.length, cards }
}
