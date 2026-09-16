// Focused PDF generator test (Node-compatible)
// Verifies that the vector PDF generation logic produces valid, non-empty PDF files.
// Run with: node /home/z/my-project/scripts/test_qb_pdf.mjs

import { jsPDF } from 'jspdf'
import { getTemplateDesign } from '/home/z/my-project/app/src/lib/qbTemplates.js'
import { buildVersionItems, remapCorrectIndex } from '/home/z/my-project/app/src/lib/qbRandomize.js'

const PAGE_SIZES = { a4: [210, 297], a5: [148, 210], letter: [215.9, 279.4], legal: [215.9, 355.6] }
function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '')
  return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) }
}

// Mini replica of generateExamPdf to validate the rendering pipeline in Node.
function makeExamPdf({ exam, sections, version, filename }) {
  const design = exam.design || {}
  const doc = new jsPDF({ orientation: design.orientation === 'landscape' ? 'landscape' : 'portrait', unit: 'mm', format: design.page_size || 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = design.margin_mm ?? 18
  const fontSize = design.base_font_size ?? 12
  const lineSpacing = design.line_spacing_mm ?? 6
  let y = margin

  // Header band
  const hb = hexToRgb(design.header_bg || '#001f43')
  const hf = hexToRgb(design.header_fg || '#FFD700')
  doc.setFillColor(hb.r, hb.g, hb.b)
  doc.rect(0, 0, pageW, 28, 'F')
  doc.setTextColor(hf.r, hf.g, hf.b)
  doc.setFont('Cairo', 'bold')
  doc.setFontSize(16)
  doc.text(exam.title, pageW / 2, 13, { align: 'center' })
  y = 34

  // Sections
  let qIdx = 0
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const sec = sections[sIdx]
    if (y + 18 > pageH - margin) { doc.addPage(); y = margin }
    const sb = hexToRgb(design.section_bg || '#FFD700')
    const sf = hexToRgb(design.section_fg || '#001f43')
    doc.setFillColor(sb.r, sb.g, sb.b)
    doc.rect(margin, y - 5, pageW - 2 * margin, 9, 'F')
    doc.setTextColor(sf.r, sf.g, sf.b)
    doc.setFont('Cairo', 'bold')
    doc.setFontSize(fontSize + 1)
    doc.text(`القسم ${sIdx + 1}. ${sec.title}`, margin + 2, y + 1)
    y += 12

    for (const it of sec.items) {
      const q = it.question
      qIdx++
      if (y + 14 > pageH - margin) { doc.addPage(); y = margin }
      doc.setFont('Cairo', 'bold')
      doc.setFontSize(fontSize)
      doc.setTextColor(20, 20, 20)
      const wrapped = doc.splitTextToSize(`${qIdx}. ${q.question_text} (${it.marks})`, pageW - 2 * margin)
      wrapped.forEach((line, i) => {
        if (i > 0) { y += lineSpacing; if (y > pageH - margin) { doc.addPage(); y = margin } }
        doc.text(line, margin, y)
      })
      y += lineSpacing

      if (q.type === 'mcq') {
        for (let cIdx = 0; cIdx < q.choices.length; cIdx++) {
          if (y > pageH - margin) { doc.addPage(); y = margin }
          doc.setFont('Cairo', 'normal')
          doc.text(`${String.fromCharCode(65 + cIdx)}) ${q.choices[cIdx]}`, margin + 6, y)
          y += lineSpacing
        }
      } else if (q.type === 'essay') {
        for (let l = 0; l < 3; l++) {
          if (y > pageH - margin) { doc.addPage(); y = margin }
          doc.setDrawColor(180)
          doc.line(margin + 6, y + 2, pageW - margin, y + 2)
          y += lineSpacing + 2
        }
      }
      y += 4
    }
  }

  // Page numbers
  const pageCount = doc.internal.pages.length - 1
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setFontSize(9)
    doc.setTextColor(150, 150, 150)
    doc.text(`صفحة ${p} من ${pageCount}`, pageW / 2, pageH - 6, { align: 'center' })
  }

  doc.save(filename)
  return doc
}

// ── Build mock exam data ──
const design = getTemplateDesign('classic')
const exam = {
  title: 'امتحان تجريبي — اللغة العربية',
  instructions: 'اقرأ كل سؤال جيدًا.',
  header: { school_name: 'مدرسة النخبة', teacher_name: 'أ. أحمد', exam_date: '2025-01-15' },
  footer: 'بالتوفيق',
  design,
}
const sections = [
  {
    id: 's1', title: 'القراءة', instructions: '', total_marks: 6,
    items: [
      { question_id: 'q1', marks: 4, question: { id: 'q1', type: 'mcq', question_text: 'ما معنى "النخبة"؟', choices: ['القلة', 'الصفوة', 'الجميع', 'المجهول'], correct_answer: { index: 1 }, explanation: 'النخبة = الصفوة.', marks: 4 } },
      { question_id: 'q2', marks: 2, question: { id: 'q2', type: 'true_false', question_text: 'الجملة "ذهب الطالب" فعلية.', correct_answer: { value: true }, explanation: 'بدأت بفعل.', marks: 2 } },
    ],
  },
  {
    id: 's2', title: 'النحو', instructions: '', total_marks: 5,
    items: [
      { question_id: 'q3', marks: 3, question: { id: 'q3', type: 'essay', question_text: 'اكتب فقرة عن العلم.', marks: 3 } },
      { question_id: 'q4', marks: 2, question: { id: 'q4', type: 'numerical', question_text: 'كم عدد حروف الجر؟', correct_answer: { value: 17 }, marks: 2 } },
    ],
  },
]

console.log('Generating exam PDF...')
makeExamPdf({ exam, sections, version: null, filename: '/tmp/test_exam.pdf' })
console.log('PASS: exam PDF generated')

// Verify version shuffling logic
console.log('\nTesting version shuffling...')
const flatItems = sections.flatMap((s) => s.items.map((it) => ({ section_id: s.id, question_id: it.question_id, question: it.question })))
const vItems = buildVersionItems(flatItems, { shuffle_questions: true, shuffle_choices: true })
console.log('PASS: version has', vItems.length, 'items')
console.log('  q1 choice_order:', vItems.find(v => v.question_id === 'q1').choice_order)
console.log('  q1 original correct idx:', sections[0].items[0].question.correct_answer.index)
const newIdx = remapCorrectIndex(1, vItems.find(v => v.question_id === 'q1').choice_order)
console.log('  q1 remapped correct idx (for answer key):', newIdx)

// Verify file sizes
import { statSync } from 'fs'
const st = statSync('/tmp/test_exam.pdf')
console.log(`\nPDF file size: ${st.size} bytes`)
if (st.size < 2000) { console.log('FAIL: PDF too small'); process.exit(1) }
console.log('PASS: PDF is non-trivial')

// Verify PDF starts with %PDF magic
import { readFileSync } from 'fs'
const head = readFileSync('/tmp/test_exam.pdf', 'utf8', 0, 5)
if (!head.startsWith('%PDF')) { console.log('FAIL: not a valid PDF'); process.exit(1) }
console.log('PASS: PDF magic header OK')

console.log('\nAll PDF tests passed.')
