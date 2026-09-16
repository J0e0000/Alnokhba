// lib/qbPdf.js
// Vector PDF generator for Nokhba QB exams and answer keys.
//
// CRITICAL FIX (v2):
//   1. Embeds the Amiri Arabic TTF font (via qbFontSetup.js) — Arabic now renders
//      correctly instead of falling back to helvetica (which has no Arabic glyphs).
//   2. Runs all text through BiDi reordering + Arabic shaping (via qbArabicText.js)
//      so mixed Arabic+English content displays in the correct visual order with
//      properly connected Arabic letters.
//   3. Uses the ACTUAL saved exam data loaded from the database — never placeholder
//      data, never internal component state that may disappear.
//   4. Validates the exam before generating — never silently produces an empty PDF.
//   5. All user-facing strings come from qbLabels.js — no internal code names leak.
//
// The pipeline: Exam Builder → Save → Database → Load Saved Exam → PDF Generator → Final PDF.

import jsPDF from 'jspdf'
import { ensureArabicFonts, fontFamilyForLanguage, registerFontsOnDoc } from './qbFontSetup'
import { prepareTextForPdf, containsArabic, alignForText, detectLanguage } from './qbArabicText'
import { L } from './qbLabels'

const PAGE_SIZES = {
  a4: [210, 297],
  a5: [148, 210],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
}

function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '')
  if (h.length < 6) return { r: 0, g: 0, b: 0 }
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

/**
 * Validate that an exam has everything needed to generate a PDF.
 * Returns { ok: true } or { ok: false, errors: [string, ...] }.
 * Errors are human-readable (Arabic-aware via the isArabic flag).
 */
export function validateExamForPdf(exam, sections, isArabic = true) {
  const errors = []
  if (!exam) {
    errors.push(L('err_exam_not_found', isArabic))
    return { ok: false, errors }
  }
  if (!exam.title || !exam.title.trim()) {
    errors.push(L('exam_title', isArabic) + ' — ' + L('required_field', isArabic))
  }
  if (!sections || sections.length === 0) {
    errors.push(L('err_no_sections', isArabic))
  } else {
    for (const s of sections) {
      if (!s.items || s.items.length === 0) {
        errors.push(L('err_empty_section', isArabic) + ' (' + s.title + ')')
      }
      for (const it of s.items) {
        if (!it.question) {
          errors.push(L('err_invalid_marks', isArabic))
          break
        }
        const marks = Number(it.marks)
        if (isNaN(marks) || marks < 0) {
          errors.push(L('err_invalid_marks', isArabic))
          break
        }
      }
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

/**
 * Cursor / page-break context.
 */
function makeCtx(doc, pageH, margin) {
  return {
    y: margin,
    break(needed = 10) {
      if (this.y + needed > pageH - margin - 6) {
        doc.addPage()
        this.y = margin
      }
    },
  }
}

/**
 * Helper: render a text line with proper Arabic/BiDi processing + font.
 * Uses the Amiri font for Arabic content, helvetica for pure English.
 *
 * @param {jsPDF} doc
 * @param {string} text — raw text (may be Arabic, English, or mixed)
 * @param {number} x — anchor X
 * @param {number} y — anchor Y
 * @param {object} opts — { align, font_family, font_style, font_size, language }
 */
function drawText(doc, text, x, y, opts = {}) {
  if (!text) return
  const language = opts.language || 'auto'
  const processed = prepareTextForPdf(String(text), language)
  const fontFamily = opts.font_family || fontFamilyForLanguage(language === 'en' ? 'en' : 'ar')
  const fontStyle = opts.font_style || 'normal'
  doc.setFont(fontFamily, fontStyle)
  if (opts.font_size) doc.setFontSize(opts.font_size)
  doc.text(processed, x, y, { align: opts.align || alignForText(text, language) })
}

/**
 * Helper: split text to size with proper font measurement.
 * Uses the active font's metrics.
 */
function wrapText(doc, text, maxWidth, opts = {}) {
  if (!text) return []
  const language = opts.language || 'auto'
  const processed = prepareTextForPdf(String(text), language)
  const fontFamily = opts.font_family || fontFamilyForLanguage(language === 'en' ? 'en' : 'ar')
  const fontStyle = opts.font_style || 'normal'
  doc.setFont(fontFamily, fontStyle)
  return doc.splitTextToSize(processed, maxWidth)
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAM PDF
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the exam paper PDF.
 *
 * @param {Object} opts
 *   - exam: { title, subject, grade, instructions, header, footer, design }
 *   - sections: [{ title, instructions, total_marks, items: [{ question, marks }] }]
 *   - version: optional { label, items: [{ question_id, order_idx, choice_order }] }
 *   - filename
 *   - isArabic: UI language for any labels rendered inside the PDF (page numbers, etc.)
 *   - returnDoc: if true, returns the jsPDF doc WITHOUT calling doc.save() (for in-app preview)
 *
 * The PDF is generated from the ACTUAL saved exam data passed in — no placeholders.
 */
export async function generateExamPdf(opts) {
  const { exam, sections, version, filename = 'exam.pdf', isArabic = true, returnDoc = false } = opts

  // 1. Validate before doing anything
  const validation = validateExamForPdf(exam, sections, isArabic)
  if (!validation.ok) {
    const err = new Error('VALIDATION_FAILED')
    err.errors = validation.errors
    throw err
  }

  // 2. Load Arabic fonts (loads base64 into memory)
  await ensureArabicFonts()

  const design = exam.design || {}
  const examLanguage = design.language || 'auto' // 'auto' | 'ar' | 'en'

  // 3. Create the doc
  const doc = new jsPDF({
    orientation: design.orientation === 'landscape' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: design.page_size || 'a4',
  })

  // 3b. Register Amiri fonts ON THIS DOC INSTANCE (jsPDF fonts are per-doc, not global)
  await registerFontsOnDoc(doc)

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = design.margin_mm ?? 18
  const fontSize = design.base_font_size ?? 12
  const qSpacing = design.question_spacing_mm ?? 8
  const lineSpacing = design.line_spacing_mm ?? 6
  const header = exam.header || {}
  const ctx = makeCtx(doc, pageH, margin)

  // ── Watermark (drawn first, behind everything) ──
  if (design.watermark_text) {
    const wm = hexToRgb('#999999')
    doc.setTextColor(wm.r, wm.g, wm.b)
    doc.setFontSize(60)
    doc.setFont(fontFamilyForLanguage(examLanguage), 'normal')
    doc.setGState(doc.GState({ opacity: design.watermark_opacity ?? 0.06 }))
    const wmText = prepareTextForPdf(design.watermark_text, examLanguage)
    doc.text(wmText, pageW / 2, pageH / 2, { align: 'center', angle: 45 })
    doc.setGState(doc.GState({ opacity: 1 }))
  }

  // ── Header band ──
  const hasHeaderContent = header.school_name || header.center_name ||
    header.teacher_name || header.exam_date || exam.title
  if (hasHeaderContent) {
    const headerH = 28
    const hb = hexToRgb(design.header_bg || '#001f43')
    const hf = hexToRgb(design.header_fg || '#FFD700')
    doc.setFillColor(hb.r, hb.g, hb.b)
    doc.rect(0, 0, pageW, headerH, 'F')

    // Logo
    if (design.show_logo && header.logo_url) {
      try {
        const fmt = header.logo_url.startsWith('data:image/png') ? 'PNG' : 'JPEG'
        const logoH = design.logo_height_mm || 16
        const logoW = logoH // square
        doc.addImage(header.logo_url, fmt, margin, 6, logoW, logoH)
      } catch (e) {
        // Don't silently swallow — caller can surface a warning
        console.warn('[qbPdf] logo embed failed:', e?.message)
      }
    }

    // Title
    doc.setTextColor(hf.r, hf.g, hf.b)
    const titleY = header.logo_url ? 12 : 13
    drawText(doc, exam.title || L('pdf_exam_title_fallback', isArabic), pageW / 2, titleY, {
      align: 'center',
      font_style: 'bold',
      font_size: 16,
      language: examLanguage,
    })

    // Sub-header: school · center · teacher · date
    const subParts = [
      header.school_name,
      header.center_name,
      header.teacher_name ? `${L('pdf_teacher', isArabic)} ${header.teacher_name}` : null,
      header.exam_date ? `${L('pdf_date', isArabic)} ${header.exam_date}` : null,
    ].filter(Boolean)
    if (subParts.length > 0) {
      const sub = subParts.join('  •  ')
      drawText(doc, sub, pageW / 2, titleY + 7, {
        align: 'center',
        font_size: 10,
        language: examLanguage,
      })
    }
    ctx.y = headerH + 6
  }

  // ── Student info fields ──
  if (header.show_student_name_field || header.show_class_field || header.show_date_field) {
    doc.setTextColor(20, 20, 20)
    let x = margin
    if (header.show_student_name_field) {
      drawText(doc, L('pdf_student_name', isArabic), x, ctx.y + 5, { font_size: fontSize, language: examLanguage })
      x += 22
      doc.setDrawColor(120)
      doc.line(x, ctx.y + 6, x + 50, ctx.y + 6)
      x += 54
    }
    if (header.show_class_field) {
      drawText(doc, L('pdf_class', isArabic), x, ctx.y + 5, { font_size: fontSize, language: examLanguage })
      x += 14
      doc.line(x, ctx.y + 6, x + 30, ctx.y + 6)
      x += 34
    }
    if (header.show_date_field) {
      drawText(doc, L('pdf_date', isArabic), x, ctx.y + 5, { font_size: fontSize, language: examLanguage })
      x += 14
      doc.line(x, ctx.y + 6, x + 30, ctx.y + 6)
    }
    ctx.y += 12
  }

  // ── Exam instructions ──
  if (exam.instructions) {
    doc.setTextColor(80, 80, 80)
    const wrapped = wrapText(doc, exam.instructions, pageW - 2 * margin, { font_style: 'italic', font_size: fontSize - 1, language: examLanguage })
    wrapped.forEach((line) => {
      ctx.break(lineSpacing)
      drawText(doc, line, margin, ctx.y, { font_style: 'italic', font_size: fontSize - 1, language: examLanguage })
      ctx.y += lineSpacing
    })
    ctx.y += 4
  }

  // ── Version banner ──
  if (version?.label) {
    doc.setTextColor(180, 0, 0)
    drawText(doc, `${L('pdf_version', isArabic)} ${version.label}`, pageW - margin, ctx.y, {
      align: 'right', font_style: 'bold', font_size: fontSize, language: examLanguage,
    })
    doc.setTextColor(20, 20, 20)
    ctx.y += 6
  }

  // Build version lookup
  const versionItemsByQid = new Map()
  if (version?.items) {
    version.items.forEach((vi) => versionItemsByQid.set(vi.question_id, vi))
  }

  // ── Sections ──
  let qGlobalIdx = 0
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const sec = sections[sIdx]
    ctx.break(18)

    // Section header bar
    const sb = hexToRgb(design.section_bg || '#FFD700')
    const sf = hexToRgb(design.section_fg || '#001f43')
    doc.setFillColor(sb.r, sb.g, sb.b)
    doc.rect(margin, ctx.y - 5, pageW - 2 * margin, 9, 'F')
    doc.setTextColor(sf.r, sf.g, sf.b)

    const sectionLabel = sectionNumberLabel(sIdx, design.section_numbering)
    const sectionTitleText = `${sectionLabel} ${sec.title}`
    drawText(doc, sectionTitleText, margin + 2, ctx.y + 1, {
      font_style: 'bold', font_size: fontSize + 1, language: examLanguage,
    })
    const marksLabel = `[${sec.total_marks || 0} ${L('pdf_section_marks', isArabic)}]`
    drawText(doc, marksLabel, pageW - margin - 2, ctx.y + 1, {
      align: 'right', font_style: 'bold', font_size: fontSize + 1, language: examLanguage,
    })
    ctx.y += 12

    // Section instructions
    if (sec.instructions) {
      doc.setTextColor(80, 80, 80)
      const wrapped = wrapText(doc, sec.instructions, pageW - 2 * margin, { font_style: 'italic', font_size: fontSize - 1, language: examLanguage })
      wrapped.forEach((line) => {
        ctx.break(lineSpacing)
        drawText(doc, line, margin, ctx.y, { font_style: 'italic', font_size: fontSize - 1, language: examLanguage })
        ctx.y += lineSpacing
      })
      ctx.y += 2
    }

    // Reorder items for this section if a version is provided
    let sectionItems = sec.items
    if (version?.items) {
      const orderedQids = version.items.map((vi) => vi.question_id)
      sectionItems = sec.items.slice().sort((a, b) =>
        orderedQids.indexOf(a.question.id) - orderedQids.indexOf(b.question.id)
      )
    }

    // Render each question
    for (let i = 0; i < sectionItems.length; i++) {
      const it = sectionItems[i]
      const q = it.question
      const vItem = versionItemsByQid.get(q.id)
      const choiceOrder = vItem?.choice_order || []
      qGlobalIdx++
      ctx.break(14)

      // Question number + text + marks (on same line if fits)
      doc.setTextColor(20, 20, 20)
      const qLabel = questionNumberLabel(qGlobalIdx, design.question_numbering)
      const qHeader = `${qLabel}. `
      // Measure with the appropriate font
      const qLang = examLanguage === 'en' ? 'en' : 'auto'
      doc.setFont(fontFamilyForLanguage(qLang), 'bold')
      doc.setFontSize(fontSize)
      const headerW = doc.getTextWidth(prepareTextForPdf(qHeader, qLang))

      const marksLabel = `(${it.marks} ${L('pdf_marks', isArabic)})`
      doc.setFont(fontFamilyForLanguage(qLang), 'italic')
      const marksW = doc.getTextWidth(prepareTextForPdf(marksLabel, qLang))

      const availW = pageW - 2 * margin - headerW - marksW - 4
      const wrapped = wrapText(doc, q.question_text, availW, { font_style: 'normal', font_size: fontSize, language: qLang })

      // Draw question number
      drawText(doc, qHeader, margin, ctx.y, { font_style: 'bold', font_size: fontSize, language: qLang })
      // Draw question text
      wrapped.forEach((line, idx) => {
        if (idx > 0) { ctx.break(lineSpacing) }
        drawText(doc, line, margin + headerW, ctx.y, { font_style: 'normal', font_size: fontSize, language: qLang })
        ctx.y += lineSpacing
      })
      // Draw marks (right-aligned at the first line's Y)
      drawText(doc, marksLabel, pageW - margin, ctx.y - lineSpacing, {
        align: 'right', font_style: 'italic', font_size: fontSize, language: qLang,
      })

      // Image
      if (q.image_url) {
        try {
          const fmt = q.image_url.startsWith('data:image/png') ? 'PNG' : 'JPEG'
          const imgW = 60, imgH = 40
          ctx.break(imgH + 4)
          doc.addImage(q.image_url, fmt, margin + headerW, ctx.y, imgW, imgH)
          ctx.y += imgH + 3
        } catch (e) {
          console.warn('[qbPdf] question image embed failed:', e?.message)
        }
      }

      // Answer area (depends on question type)
      if (q.type === 'mcq' && Array.isArray(q.choices) && q.choices.length > 0) {
        const reordered = choiceOrder.length === q.choices.length
          ? choiceOrder.map((oldIdx) => q.choices[oldIdx])
          : q.choices
        if (design.choice_layout === 'horizontal_2col') {
          const colW = (pageW - 2 * margin) / 2
          let col = 0
          let rowY = ctx.y
          for (let cIdx = 0; cIdx < reordered.length; cIdx++) {
            if (col === 2) { col = 0; rowY += lineSpacing; ctx.break(lineSpacing); ctx.y = rowY }
            const letter = String.fromCharCode(65 + cIdx)
            const txt = `${letter}) ${reordered[cIdx]}`
            const wrappedC = wrapText(doc, txt, colW - 4, { font_size: fontSize, language: qLang })
            drawText(doc, wrappedC[0] || '', margin + col * colW, rowY, { font_size: fontSize, language: qLang })
            col++
          }
          ctx.y = rowY + lineSpacing
        } else {
          for (let cIdx = 0; cIdx < reordered.length; cIdx++) {
            const letter = String.fromCharCode(65 + cIdx)
            const txt = `${letter}) ${reordered[cIdx]}`
            const wrappedC = wrapText(doc, txt, pageW - 2 * margin - 8, { font_size: fontSize, language: qLang })
            wrappedC.forEach((line, idx) => {
              if (idx > 0) ctx.y += lineSpacing
              ctx.break(lineSpacing)
              drawText(doc, line, margin + 6, ctx.y, { font_size: fontSize, language: qLang })
            })
            ctx.y += lineSpacing - 1
          }
        }
      } else if (q.type === 'true_false') {
        const tfText = `☐ ${L('pdf_true', isArabic)}    ☐ ${L('pdf_false', isArabic)}`
        drawText(doc, tfText, margin + 6, ctx.y, { font_size: fontSize, language: examLanguage })
        ctx.y += lineSpacing
      } else if (q.type === 'short_answer') {
        ctx.break(8)
        doc.setDrawColor(120)
        doc.line(margin + 6, ctx.y + 2, pageW - margin, ctx.y + 2)
        ctx.y += lineSpacing + 2
      } else if (q.type === 'essay') {
        for (let l = 0; l < 3; l++) {
          ctx.break(4)
          doc.setDrawColor(180)
          doc.line(margin + 6, ctx.y + 2, pageW - margin, ctx.y + 2)
          ctx.y += lineSpacing + 2
        }
      } else if (q.type === 'numerical') {
        drawText(doc, `${L('pdf_answer_label', isArabic)} ____________`, margin + 6, ctx.y, { font_size: fontSize, language: examLanguage })
        ctx.y += lineSpacing
      } else if (q.type === 'matching') {
        const pairs = q.choices || []
        for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
          ctx.break(lineSpacing)
          drawText(doc, `___  ${pairs[pIdx]}`, margin + 6, ctx.y, { font_size: fontSize, language: qLang })
          ctx.y += lineSpacing
        }
      }

      ctx.y += qSpacing
    }
    ctx.y += 4
  }

  // ── Footer ──
  if (exam.footer) {
    ctx.break(8)
    doc.setTextColor(120, 120, 120)
    const wrapped = wrapText(doc, exam.footer, pageW - 2 * margin, { font_style: 'italic', font_size: fontSize - 2, language: examLanguage })
    wrapped.forEach((line) => {
      ctx.break(lineSpacing)
      drawText(doc, line, margin, ctx.y, { font_style: 'italic', font_size: fontSize - 2, language: examLanguage })
      ctx.y += lineSpacing - 2
    })
  }

  // ── Page numbers (on every page) ──
  const pageCount = doc.internal.pages.length - 1
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setTextColor(150, 150, 150)
    const pn = `${L('pdf_page', isArabic)} ${p} ${L('pdf_of', isArabic)} ${pageCount}`
    drawText(doc, pn, pageW / 2, pageH - 6, {
      align: 'center', font_size: 9, language: isArabic ? 'ar' : 'en',
    })
  }

  if (!returnDoc) {
    doc.save(filename)
  }
  return doc
}

// ─────────────────────────────────────────────────────────────────────────────
// ANSWER KEY PDF
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the answer key PDF. Same data source as the exam PDF.
 */
export async function generateAnswerKeyPdf(opts) {
  const { exam, sections, version, filename = 'answer_key.pdf', isArabic = true, returnDoc = false } = opts

  const validation = validateExamForPdf(exam, sections, isArabic)
  if (!validation.ok) {
    const err = new Error('VALIDATION_FAILED')
    err.errors = validation.errors
    throw err
  }

  await ensureArabicFonts()

  const design = exam.design || {}
  const examLanguage = design.language || 'auto'
  const doc = new jsPDF({
    orientation: design.orientation === 'landscape' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: design.page_size || 'a4',
  })

  // Register Amiri fonts on this doc instance
  await registerFontsOnDoc(doc)

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = design.margin_mm ?? 18
  const fontSize = design.base_font_size ?? 12
  const qSpacing = design.question_spacing_mm ?? 8
  const lineSpacing = design.line_spacing_mm ?? 6
  const ctx = makeCtx(doc, pageH, margin)

  // Banner
  doc.setFillColor(180, 30, 30)
  doc.rect(0, 0, pageW, 18, 'F')
  doc.setTextColor(255, 255, 255)
  const bannerText = `${L('pdf_answer_key_title', isArabic)} — ${exam.title}`
  drawText(doc, bannerText, pageW / 2, 12, {
    align: 'center', font_style: 'bold', font_size: 16, language: examLanguage,
  })
  ctx.y = 24

  if (version?.label) {
    doc.setTextColor(180, 0, 0)
    drawText(doc, `${L('pdf_version', isArabic)} ${version.label}`, pageW - margin, ctx.y, {
      align: 'right', font_size: fontSize, language: examLanguage,
    })
    ctx.y += 6
  }

  const versionItemsByQid = new Map()
  if (version?.items) {
    version.items.forEach((vi) => versionItemsByQid.set(vi.question_id, vi))
  }

  let qGlobalIdx = 0
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const sec = sections[sIdx]
    ctx.break(12)
    doc.setTextColor(20, 20, 20)
    const secText = `${sectionNumberLabel(sIdx, design.section_numbering)} ${sec.title}`
    drawText(doc, secText, margin, ctx.y, { font_style: 'bold', font_size: fontSize + 1, language: examLanguage })
    ctx.y += 8

    let sectionItems = sec.items
    if (version?.items) {
      const orderedQids = version.items.map((vi) => vi.question_id)
      sectionItems = sec.items.slice().sort((a, b) =>
        orderedQids.indexOf(a.question.id) - orderedQids.indexOf(b.question.id)
      )
    }

    for (let i = 0; i < sectionItems.length; i++) {
      const it = sectionItems[i]
      const q = it.question
      const vItem = versionItemsByQid.get(q.id)
      const choiceOrder = vItem?.choice_order || []
      qGlobalIdx++
      ctx.break(12)

      doc.setTextColor(20, 20, 20)
      const qLabel = questionNumberLabel(qGlobalIdx, design.question_numbering)
      const qText = `${qLabel}. ${q.question_text}`
      const wrapped = wrapText(doc, qText, pageW - 2 * margin, { font_style: 'bold', font_size: fontSize, language: examLanguage })
      wrapped.forEach((line, idx) => {
        if (idx > 0) ctx.y += lineSpacing
        ctx.break(lineSpacing)
        drawText(doc, line, margin, ctx.y, { font_style: 'bold', font_size: fontSize, language: examLanguage })
      })
      ctx.y += lineSpacing

      // Correct answer
      doc.setTextColor(0, 120, 0)
      let answerLine = ''
      if (q.type === 'mcq' && Array.isArray(q.choices)) {
        const origIdx = q.correct_answer?.index ?? 0
        let renderedIdx = origIdx
        if (choiceOrder.length === q.choices.length) {
          renderedIdx = choiceOrder.indexOf(origIdx)
          if (renderedIdx < 0) renderedIdx = origIdx
        }
        const letter = String.fromCharCode(65 + renderedIdx)
        answerLine = `☑ ${L('pdf_correct_answer', isArabic)} ${letter}) ${q.choices[origIdx]}`
      } else if (q.type === 'true_false') {
        const truthy = q.correct_answer?.value === true
        answerLine = `☑ ${L('pdf_correct_answer', isArabic)} ${truthy ? L('pdf_true', isArabic) : L('pdf_false', isArabic)}`
      } else if (q.type === 'numerical') {
        answerLine = `☑ ${L('pdf_correct_answer', isArabic)} ${q.correct_answer?.value ?? ''}`
      } else {
        answerLine = `☑ ${L('pdf_correct_answer', isArabic)} ${q.correct_answer?.value ?? '—'}`
      }
      const aWrapped = wrapText(doc, answerLine, pageW - 2 * margin - 4, { font_style: 'bold', font_size: fontSize, language: examLanguage })
      aWrapped.forEach((line) => {
        ctx.break(lineSpacing)
        drawText(doc, line, margin + 4, ctx.y, { font_style: 'bold', font_size: fontSize, language: examLanguage })
        ctx.y += lineSpacing
      })

      // Explanation
      if (q.explanation) {
        doc.setTextColor(80, 80, 80)
        const eText = `${L('pdf_explanation', isArabic)} ${q.explanation}`
        const eWrapped = wrapText(doc, eText, pageW - 2 * margin - 4, { font_style: 'italic', font_size: fontSize - 1, language: examLanguage })
        eWrapped.forEach((line) => {
          ctx.break(lineSpacing - 1)
          drawText(doc, line, margin + 4, ctx.y, { font_style: 'italic', font_size: fontSize - 1, language: examLanguage })
          ctx.y += lineSpacing - 1
        })
      }
      ctx.y += qSpacing
    }
  }

  // Page numbers
  const pageCount = doc.internal.pages.length - 1
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setTextColor(150, 150, 150)
    const pn = `${L('pdf_page', isArabic)} ${p} ${L('pdf_of', isArabic)} ${pageCount}`
    drawText(doc, pn, pageW / 2, pageH - 6, {
      align: 'center', font_size: 9, language: isArabic ? 'ar' : 'en',
    })
  }

  if (!returnDoc) {
    doc.save(filename)
  }
  return doc
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sectionNumberLabel(idx, scheme) {
  if (scheme === 'roman') return toRoman(idx + 1) + '.'
  if (scheme === 'alpha') return String.fromCharCode(65 + idx) + '.'
  return `${idx + 1}.`
}

function questionNumberLabel(idx, scheme) {
  if (scheme === 'circle') return `(${idx})`
  return `${idx}`
}

function toRoman(num) {
  const map = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let out = ''
  for (const [v, s] of map) { while (num >= v) { out += s; num -= v } }
  return out
}
