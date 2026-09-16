// lib/qbImport.js
// Import questions from text paste, PDF, or image.
// PDF and image parsing are lazy-loaded so the main bundle stays small.
// Imported questions always go to qb_import_staging for REVIEW before promotion.

/**
 * Parse a plain-text block into questions.
 *
 * Supported simple format (one question per block, blank line between):
 *
 *   Q: ما عاصمة مصر؟
 *   A) القاهرة
 *   B) الإسكندرية
 *   C) الجيزة
 *   D) أسوان
 *   ANS: A
 *   MARKS: 2
 *   DIFF: easy
 *   EXPL: القاهرة هي عاصمة مصر السياسية والإدارية.
 *
 * Also supports:
 *   - True/False:  "Q: ... ANS: true"  (or false)
 *   - Short answer: "Q: ... ANS: نص قصير"
 *   - Essay (no ANS line)
 *   - Numerical: "Q: ... ANS: 42"
 *
 * Returns array of question objects (no DB writes).
 */
export function parseTextToQuestions(text) {
  if (!text || !text.trim()) return []
  // Split on blank lines, but each block may span multiple lines until the next "Q:".
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const out = []
  for (const block of blocks) {
    const q = parseBlock(block)
    if (q) out.push(q)
  }
  // Fallback: if no Q: markers, treat each non-empty line as a short_answer question
  if (out.length === 0) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    for (const line of lines) {
      if (line.length > 3) {
        out.push({
          type: 'short_answer',
          question_text: line,
          choices: [],
          correct_answer: {},
          marks: 1,
          difficulty: 'medium',
        })
      }
    }
  }
  return out
}

function parseBlock(block) {
  const lines = block.split('\n').map((l) => l.trim())
  let qText = null
  const choices = []
  let ans = null
  let marks = 1
  let difficulty = 'medium'
  let explanation = null
  let sourceRef = null

  for (const line of lines) {
    if (/^Q\s*[:.]/i.test(line)) {
      qText = line.replace(/^Q\s*[:.]\s*/i, '').trim()
    } else if (/^[A-D]\)\s*/i.test(line)) {
      const m = line.match(/^([A-D])\)\s*(.+)$/i)
      if (m) choices.push(m[2].trim())
    } else if (/^ANS\s*[:.]/i.test(line)) {
      ans = line.replace(/^ANS\s*[:.]\s*/i, '').trim()
    } else if (/^MARKS\s*[:.]/i.test(line)) {
      marks = Number(line.replace(/^MARKS\s*[:.]\s*/i, '').trim()) || 1
    } else if (/^DIFF\s*[:.]/i.test(line)) {
      const d = line.replace(/^DIFF\s*[:.]\s*/i, '').trim().toLowerCase()
      if (['easy', 'medium', 'hard'].includes(d)) difficulty = d
    } else if (/^EXPL\s*[:.]/i.test(line)) {
      explanation = line.replace(/^EXPL\s*[:.]\s*/i, '').trim()
    } else if (/^SRC\s*[:.]/i.test(line)) {
      sourceRef = line.replace(/^SRC\s*[:.]\s*/i, '').trim()
    } else if (qText) {
      // continuation of question text
      qText += ' ' + line
    }
  }

  if (!qText) return null

  // Determine type from ans/choices
  let type = 'mcq'
  let correctAnswer = {}
  if (choices.length > 0 && ans) {
    type = 'mcq'
    // ans may be "A", "B", ... or the text of the choice
    let idx = -1
    const letterMatch = ans.match(/^[A-D]$/i)
    if (letterMatch) {
      idx = ans.toUpperCase().charCodeAt(0) - 65
    } else {
      idx = choices.findIndex((c) => c === ans)
    }
    if (idx < 0) idx = 0
    correctAnswer = { index: idx }
  } else if (/^(true|false|صح|خطأ|صحيح|خاطئ)$/i.test(ans || '')) {
    type = 'true_false'
    const truthy = /^(true|صح|صحيح)$/i.test(ans)
    correctAnswer = { value: truthy }
  } else if (ans && !isNaN(Number(ans))) {
    type = 'numerical'
    correctAnswer = { value: Number(ans) }
  } else if (ans) {
    type = 'short_answer'
    correctAnswer = { value: ans }
  } else {
    type = 'essay'
    correctAnswer = {}
  }

  return {
    type,
    question_text: qText,
    choices,
    correct_answer: correctAnswer,
    marks,
    difficulty,
    explanation,
    source_ref: sourceRef,
    subject: 'عام',
  }
}

/**
 * Extract text from a PDF file using pdfjs-dist (lazy-loaded).
 * Returns the raw text. Caller then runs parseTextToQuestions on it.
 */
export async function extractTextFromPdf(file) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
  // Use the bundled worker via Vite's ?worker import
  // Fallback: disable worker (slower but works).
  try {
    const PdfWorker = (await import('pdfjs-dist/build/pdf.worker.mjs?worker')).default
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()
  } catch {
    pdfjs.GlobalWorkerOptions.workerSrc = ''
  }
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  let full = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const strings = content.items.map((it) => it.str)
    full += strings.join(' ') + '\n\n'
  }
  return full
}

/**
 * Extract text from an image using tesseract.js (lazy-loaded).
 * Default language: Arabic + English.
 */
export async function extractTextFromImage(file, onProgress) {
  const { default: Tesseract } = await import('tesseract.js')
  const { data } = await Tesseract.recognize(file, 'ara+eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof onProgress === 'function') {
        onProgress(m.progress)
      }
    },
  })
  return data.text || ''
}

/**
 * Convert a File to a base64 data URL (used for image embedding).
 */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
