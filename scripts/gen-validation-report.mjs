// ALNOKHBA EDU — Smart Insights Validation Report (Arabic RTL, docx)
// Recipe: R1 (Pure Paragraph Left) + DM-1 palette · 3-section architecture
// Run: node scripts/gen-validation-report.mjs
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, TableLayoutType, SectionType,
  TableOfContents, PageBreak,
} from 'docx'
import fs from 'node:fs'
import * as C from './report-content.mjs'

// ── palette DM-1 (Deep Cyan) ──────────────────────────────────────────────
const P = {
  bg: '162235', accent: '37DCF2',
  cover: { titleColor: 'FFFFFF', subtitleColor: 'B0B8C0', metaColor: '90989F', footerColor: '687078' },
  table: { headerBg: '1B6B7A', headerText: 'FFFFFF', accentLine: '1B6B7A', innerLine: 'C8DDE2', surface: 'EDF3F5' },
  headingColor: '162235',
}
const ARF = { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial' }
const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const noBorders = { top: NB, bottom: NB, left: NB, right: NB }
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB }

// ── RTL helpers ───────────────────────────────────────────────────────────
const ar = (text, o = {}) => new TextRun({
  text, rightToLeft: true, font: ARF,
  size: o.size || 24, sizeComplexScript: o.size || 24,
  bold: o.bold || false, boldComplexScript: o.bold || false,
  italics: o.italics || false, color: o.color || '000000',
})
const body = (text, o = {}) => new Paragraph({
  bidirectional: true,
  alignment: o.alignment || AlignmentType.JUSTIFIED,
  spacing: { line: 312, after: o.after ?? 120, before: o.before ?? 0 },
  children: [ar(text, o)],
})
const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, bidirectional: true,
  spacing: { before: 360, after: 160, line: 312 },
  children: [ar(text, { bold: true, size: 30, color: P.headingColor })],
})
const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2, bidirectional: true,
  spacing: { before: 240, after: 120, line: 312 },
  children: [ar(text, { bold: true, size: 26, color: P.headingColor })],
})

// ── RTL table builder (percentage widths, WPS-safe) ───────────────────────
function table(cfg) {
  const cell = (text, o = {}) => new TableCell({
    width: { size: o.w, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill } : undefined,
    children: [new Paragraph({
      bidirectional: true, spacing: { line: 276 },
      children: [ar(String(text), { size: 20, bold: o.bold, color: o.color || '000000' })],
    })],
  })
  return [
    new Paragraph({ keepNext: true, bidirectional: true, spacing: { before: 160, after: 80, line: 312 }, children: [ar(cfg.title, { bold: true, size: 21, color: P.headingColor })] }),
    new Table({
      visuallyRightToLeft: true,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
        left: NB, right: NB,
        insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
        insideVertical: NB,
      },
      rows: [
        new TableRow({
          tableHeader: true, cantSplit: true,
          children: cfg.headers.map((t, i) => cell(t, { w: cfg.widths[i], bold: true, color: P.table.headerText, fill: P.table.headerBg })),
        }),
        ...cfg.rows.map((r, ri) => new TableRow({
          cantSplit: true,
          children: r.map((t, i) => cell(t, { w: cfg.widths[i], fill: ri % 2 ? P.table.surface : undefined })),
        })),
      ],
    }),
    new Paragraph({ bidirectional: true, spacing: { after: 160, line: 312 }, children: [] }),
  ]
}

// ── cover: calcTitleLayout + calcCoverSpacing (from design-system.md) ─────
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title]
  const breakAfter = new Set([...'،。؛：!؟', ...'-_—–·/', ...' \t'])
  const lines = []
  let remaining = title
  while (remaining.length > charsPerLine) {
    let breakAt = -1
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3))
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break }
      }
    }
    if (breakAt === -1) breakAt = charsPerLine
    lines.push(remaining.slice(0, breakAt).trim())
    remaining = remaining.slice(breakAt).trim()
  }
  if (remaining) lines.push(remaining)
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop()
    lines[lines.length - 1] += ' ' + last
  }
  return lines
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / (pt * 20))
  let titlePt = preferredPt
  let lines
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt)
    if (cpl < 2) { titlePt -= 2; continue }
    lines = splitTitleLines(title, cpl)
    if (lines.length <= 3) break
    titlePt -= 2
  }
  if (!lines || lines.length > 3) { lines = splitTitleLines(title, charsPerLine(minPt)); titlePt = minPt }
  return { titlePt, titleLines: lines }
}
function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false, metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params
  const SAFETY = 1200
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY
  const titleHeight = titleLineCount * (titlePt * 23 + 200)
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0
  const metaHeight = metaLineCount * (10 * 23 + 100)
  const implicitParaHeight = 3 * 300
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight
  const safeRemaining = Math.max(usableHeight - contentHeight, 400)
  const FOOTER_MIN = 800
  const rawTop = Math.floor(safeRemaining * 0.45)
  const rawBottom = Math.floor(safeRemaining * 0.45)
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN)
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400)
  return { topSpacing, bottomSpacing }
}
function buildCoverR1(config) {
  const padL = 1200, padR = 800
  const availableWidth = 11906 - padL - padR - 300
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24)
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  })
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 }
  const children = []
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }))
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split('').join('  '), size: 18, color: P.accent, font: ARF, characterSpacing: 40 })],
    }))
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      bidirectional: true, indent: { left: padL, right: padR },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: 'atLeast' },
      children: [ar(titleLines[i], { bold: true, size: titlePt * 2, color: P.cover.titleColor })],
    }))
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      bidirectional: true, indent: { left: padL, right: padR }, spacing: { after: 800, line: 400, lineRule: 'atLeast' },
      children: [ar(config.subtitle, { size: 24, color: P.cover.subtitleColor })],
    }))
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      bidirectional: true, indent: { left: padL + 200, right: padR }, spacing: { after: 80, line: 300, lineRule: 'atLeast' },
      border: { left: accentLeft },
      children: [ar(line, { size: 22, color: P.cover.metaColor })],
    }))
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }))
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || '', size: 16, color: P.cover.footerColor, font: ARF }),
      new TextRun({ text: '                                        ' }),
      new TextRun({ text: config.footerRight || '', size: 16, color: P.cover.footerColor, font: ARF }),
    ],
  }))
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: 'exact' },
      children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders, children })],
    })],
  })]
}

// ── assemble body children ────────────────────────────────────────────────
const bodyChildren = []
bodyChildren.push(h1('الملخص التنفيذي'))
C.EXEC_SUMMARY.forEach((t) => bodyChildren.push(body(t)))

bodyChildren.push(h1('١. بيئة الاختبار وتحديد نطاق السلامة (البند صفر)'))
C.S1.forEach((t) => bodyChildren.push(body(t)))

bodyChildren.push(h1('٢. البيانات المولّدة وفحوصات السلامة'))
C.S2.forEach((t) => bodyChildren.push(body(t)))
bodyChildren.push(...table(C.S2_TABLE))

bodyChildren.push(h1('٣. السيناريوهات المزروعة عمدًا'))
C.S3.forEach((t) => bodyChildren.push(body(t)))
bodyChildren.push(...table(C.S3_TABLE))

bodyChildren.push(h1('٤. النتائج المتوقعة (مواصفة الحقيقة الأرضية)'))
C.S4.forEach((t) => bodyChildren.push(body(t)))
bodyChildren.push(...table(C.S4_TABLE))

bodyChildren.push(h1('٥. النتائج الفعلية: الجولات الأسبوعية ودورة الحياة'))
C.S5.forEach((t) => bodyChildren.push(body(t)))
bodyChildren.push(...table(C.GT_TABLE))

bodyChildren.push(h1('٦. مصفوفة التحقق: المتوقع مقابل الفعلي'))
bodyChildren.push(body('تُلخّص المصفوفة التالية حكم التحقق على كل سيناريو بعد مقارنة المخرجات الفعلية للمحرّك بالمواصفة المتوقعة (جدول ٣). التصنيفات الأربعة المعتمدة: إصابة صحيحة (True Positive)، استبعاد صحيح (True Negative)، إنذار كاذب (False Positive)، نتيجة فائتة (False Negative).'))
bodyChildren.push(...table(C.S6_MATRIX))

bodyChildren.push(h1('٧. الإنذارات الكاذبة'))
C.S7.forEach((t) => bodyChildren.push(body(t)))

bodyChildren.push(h1('٨. النتائج الفائتة والحالات الحدّية'))
C.S8.forEach((t) => bodyChildren.push(body(t)))

bodyChildren.push(h1('٩. بطاقة جودة الرؤى'))
C.S9.forEach((t) => bodyChildren.push(body(t)))
bodyChildren.push(...table(C.S9_TABLE))

bodyChildren.push(h1('١٠. الأداء وقابلية التوسّع'))
C.S10.forEach((t) => bodyChildren.push(body(t)))
bodyChildren.push(...table(C.S10_TABLE))

bodyChildren.push(h1('١١. الأمان والعزل'))
C.S11.forEach((t) => bodyChildren.push(body(t)))
bodyChildren.push(...table(C.S11_TABLE))

bodyChildren.push(h1('١٢. التوصيات'))
C.S12.forEach((t) => bodyChildren.push(body(t)))

bodyChildren.push(h1('١٣. الحكم النهائي: هل فريق التحليل يفهم المشكلة فعلًا؟'))
C.S13.forEach((t) => bodyChildren.push(body(t)))

// ── document ──────────────────────────────────────────────────────────────
const pgSize = { width: 11906, height: 16838 }
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 }
const pageFooter = () => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '808080', font: ARF })],
  })],
})
const pageHeader = () => new Header({
  children: [new Paragraph({
    bidirectional: true, alignment: AlignmentType.CENTER, spacing: { after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine, space: 4 } },
    children: [ar('تقرير التحقق الشامل من فريق التحليل الذكي — منصة النخبة', { size: 18, color: '808080' })],
  })],
})

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: ARF, size: 24, color: '000000' },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: { run: { font: ARF, size: 30, bold: true, color: P.headingColor }, paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 } },
      heading2: { run: { font: ARF, size: 26, bold: true, color: P.headingColor }, paragraph: { spacing: { before: 240, after: 120, line: 312 }, outlineLevel: 1 } },
    },
  },
  sections: [
    { // Section 1: cover — margin 0, no footer, no pageNumbers
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: 'تقرير التحقق الشامل من فريق التحليل الذكي',
        subtitle: 'محاكاة ١٢ أسبوعًا من النشاط لـ ١٠٠٠ طالب — والتحقق من صدق الاستنتاجات مقابل الحقيقة الأرضية',
        englishLabel: 'SMART INSIGHTS VALIDATION',
        metaLines: [
          'المنصة: النخبة التعليمية — al-nokhbba.vercel.app',
          'نوع الاختبار: محاكاة حتمية معزولة + فحوصات إنتاج قراءة فقط',
          'حجم البيانات: ١٠٠٠ طالب · ٨ مجموعات · ١٩٢ حصة · ٢٤٠٠٠ سجل حضور',
          'تاريخ التنفيذ: ٢١ سبتمبر ٢٠٢٦',
        ],
        footerLeft: 'Alnokhba Edu — Smart Insights Validation',
        footerRight: '2026-09-21',
      }),
    },
    { // Section 2: TOC — no footer (report scene: TOC page numbers optional)
      properties: { type: SectionType.NEXT_PAGE, page: { size: pgSize, margin: pgMargin } },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 480, after: 360 },
          children: [ar('المحتويات', { bold: true, size: 32, color: P.headingColor })],
        }),
        new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
        new Paragraph({
          bidirectional: true, spacing: { before: 200 },
          children: [ar('ملاحظة: هذا الجدول مولّد بحقول تلقائية؛ لضمان دقة أرقام الصفحات بعد أي تعديل، انقر بزر الفأرة الأيمن على الجدول واختر «تحديث الحقل».', { italics: true, size: 18, color: '888888' })],
        }),
      ],
    },
    { // Section 3: body — Arabic numerals from 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: pageHeader() },
      footers: { default: pageFooter() },
      children: bodyChildren,
    },
  ],
})

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync('/home/z/my-project/download/تقرير-التحقق-الشامل-فريق-التحليل-الذكي.docx', buf)
  console.log('report written:', buf.length, 'bytes')
})
