/**
 * Student QR CARDS — Visa-style printable card + A4 sheet composer (Task 68).
 * ─────────────────────────────────────────────────────────────────────────
 * One physical card per student, ISO ID-1 proportions (85.6 × 53.98 mm —
 * the exact size of a bank card), navy face + gold accents matching the
 * brand (flat, no gradients — print-friendly). The QR encodes the SAME
 * portal URL the system already issues (…/qr/<20-char token>), so scanning
 * behaves exactly like every other QR in the product:
 *   • Normal phone camera  → opens the student's public portal page.
 *   • Nokhba in-app scanner → resolve_student_by_qr RPC → attendance.
 * Card shows the student's F-code (student.code) so the teacher can match
 * a physical card to a row even when the QR is damaged.
 *
 * PDF: A4 portrait, 2 × 4 grid (8 cards/page) with dashed cut guides and
 * an English-only footer (jsPDF core fonts cannot render Arabic — all
 * Arabic text lives inside the card images, rendered via html2canvas-pro).
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

// DOM rendering scale: 12 px per mm → 1027×648 px card, rendered by
// html2canvas at scale 1.2 ≈ 366 DPI at print size.
const PX_PER_MM = 12
const CARD_W_PX = Math.round(CARD_W_MM * PX_PER_MM) // 1027
const CARD_H_PX = Math.round(CARD_H_MM * PX_PER_MM) // 648

const NAVY = '#142D62'
const GOLD = '#F5C542'
const FONT = "Cairo, 'Segoe UI', Tahoma, Arial, sans-serif"

const escapeHtml = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Build the Visa-style card DOM (not attached to the document).
 * @param {object} opts
 * @param {object} [opts.student]      student row (name/code/group/stage) — omit for placeholder
 * @param {string} [opts.qrDataUrl]    QR image data URL — omit for placeholder
 * @param {boolean} [opts.placeholder] blank stock card
 */
export function buildCardDom({ student, qrDataUrl, placeholder = false } = {}) {
  const container = document.createElement('div')
  container.setAttribute('dir', 'rtl')
  container.style.cssText = `position:fixed;top:0;left:0;width:${CARD_W_PX}px;opacity:0.01;pointer-events:none;z-index:-1;`

  const name = escapeHtml(student?.name || '')
  const code = escapeHtml(student?.code || '')
  const meta = [student?.group_name, student?.stage].filter(Boolean).map(escapeHtml).join(' · ')

  const chipInner = `
    <div style="position:absolute;inset:14px;border:2px solid rgba(20,45,98,.55);border-radius:10px;"></div>
    <div style="position:absolute;top:50%;left:0;right:0;height:2px;background:rgba(20,45,98,.55);"></div>
    <div style="position:absolute;top:0;bottom:0;left:50%;width:2px;background:rgba(20,45,98,.55);"></div>`

  const qrPanel = placeholder
    ? `<div style="width:250px;height:250px;border-radius:28px;background:#FFFFFF;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;">
         <div style="width:196px;height:196px;border:3px dashed #B6C2D8;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">
           <div style="font-size:30px;font-weight:800;color:#8B99B4;">QR الطالب</div>
           <div style="font-size:17px;font-weight:700;color:#A5B1C6;">يُطبع بعد تسجيل الطالب</div>
         </div>
       </div>`
    : `<div style="width:250px;height:250px;border-radius:28px;background:#FFFFFF;display:flex;align-items:center;justify-content:center;">
         ${qrDataUrl ? `<img src="${qrDataUrl}" width="218" height="218" style="display:block;border-radius:6px;" alt="QR" />` : ''}
       </div>`

  const identity = placeholder
    ? `
      <div style="position:absolute;top:344px;right:56px;left:360px;">
        <div style="height:58px;border-bottom:3px dashed rgba(255,255,255,.55);"></div>
        <div style="margin-top:22px;font-size:26px;font-weight:700;color:rgba(255,255,255,.85);">كود الطالب: <span style="color:${GOLD};font-weight:800;letter-spacing:2px;">F-&#8226;&#8226;&#8226;&#8226;&#8226;</span></div>
        <div style="margin-top:14px;font-size:22px;font-weight:700;color:rgba(255,255,255,.6);">المجموعة / المرحلة: ..................</div>
      </div>`
    : `
      <div style="position:absolute;top:344px;right:56px;left:360px;">
        <div style="font-size:44px;font-weight:800;color:#FFFFFF;line-height:1.3;max-height:118px;overflow:hidden;">${name || '—'}</div>
        <div style="margin-top:16px;font-size:26px;font-weight:700;color:rgba(255,255,255,.85);">كود الطالب: <span style="color:${GOLD};font-weight:800;letter-spacing:2px;">${code || '—'}</span></div>
        ${meta ? `<div style="margin-top:12px;font-size:22px;font-weight:700;color:rgba(255,255,255,.6);">${meta}</div>` : ''}
      </div>`

  const stripNote = placeholder
    ? 'كرت جاهز للتسليم — بعد تسجيل الطالب اطبع كرته الرسمية بـ QR الحضور من صفحة الطلاب'
    : 'امسح الكود بكاميرا النخبة داخل الحصة لتسجيل الحضور — أو افتح الرابط بأي كاميرا'

  container.innerHTML = `
    <div style="position:relative;width:${CARD_W_PX}px;height:${CARD_H_PX}px;overflow:hidden;border-radius:48px;background:${NAVY};font-family:${FONT};color:#FFFFFF;">
      <div style="position:absolute;top:0;right:0;left:0;height:8px;background:${GOLD};"></div>
      <div style="position:absolute;inset:6px;border:2px solid rgba(245,197,66,.4);border-radius:44px;pointer-events:none;"></div>

      <div style="position:absolute;top:44px;right:56px;display:flex;align-items:center;gap:18px;">
        <div style="font-size:52px;font-weight:900;color:${GOLD};line-height:1;">النخبة</div>
        <div style="width:2px;height:40px;background:rgba(255,255,255,.25);"></div>
        <div style="font-size:20px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:7px;">NOKHBA</div>
      </div>
      <div style="position:absolute;top:56px;left:56px;font-size:21px;font-weight:800;color:rgba(255,255,255,.62);letter-spacing:1px;">كرت طالب · STUDENT CARD</div>

      <div style="position:absolute;top:206px;right:56px;width:118px;height:92px;border-radius:18px;background:${GOLD};">${chipInner}</div>

      <div style="position:absolute;top:168px;left:56px;">${qrPanel}</div>

      ${identity}

      <div style="position:absolute;bottom:0;left:0;right:0;height:112px;background:rgba(255,255,255,.06);border-top:1px solid rgba(245,197,66,.45);display:flex;align-items:center;justify-content:space-between;padding:0 56px;">
        <div style="font-size:21px;font-weight:700;color:rgba(255,255,255,.85);max-width:640px;line-height:1.45;">${stripNote}</div>
        <div dir="ltr" style="font-size:18px;font-weight:700;color:${GOLD};letter-spacing:1px;">al-nokhbba.vercel.app</div>
      </div>
    </div>`

  return container
}

/** Render one card DOM → canvas data URL via html2canvas-pro. */
async function renderCardToImage(opts) {
  const html2canvas = (await import('html2canvas-pro')).default
  const container = buildCardDom(opts)
  document.body.appendChild(container)
  try {
    const canvas = await html2canvas(container.firstElementChild, { scale: 1.2, useCORS: true, logging: false, backgroundColor: NAVY })
    return canvas.toDataURL('image/png')
  } finally {
    if (container.parentNode) container.parentNode.removeChild(container)
  }
}

/** Generate the portal QR for a student token (high-res for print). */
async function qrForLink(link) {
  const QRCode = (await import('qrcode')).default
  return QRCode.toDataURL(link, {
    width: 512, margin: 2,
    color: { dark: NAVY, light: '#FFFFFF' },
    errorCorrectionLevel: 'M',
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

  // Pre-render placeholder stock images (identical visual, no per-card data).
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
    doc.addImage(img, 'PNG', x, y, CARD_W_MM, CARD_H_MM)
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
