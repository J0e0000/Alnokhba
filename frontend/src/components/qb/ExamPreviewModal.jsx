import { useEffect, useState, useCallback } from 'react'
import Modal from '../Modal'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import { getExamFull, getVersionItems } from '../../lib/qbStore'
import { generateExamPdf, generateAnswerKeyPdf, validateExamForPdf } from '../../lib/qbPdf'
import { prefetchFonts, ensureArabicFonts } from '../../lib/qbFontSetup'
import { L, humanizeError } from '../../lib/qbLabels'

export default function ExamPreviewModal({ open, onClose, supabase, examId, presetVersion }) {
  const { showToast } = useToast()
  const { isArabic } = useLanguage()
  const [full, setFull] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [activeVersionId, setActiveVersionId] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)  // data: URL for embedded PDF
  const [validationErrors, setValidationErrors] = useState([])

  const load = async () => {
    if (!examId) return
    setLoading(true)
    setPreviewUrl(null)
    setValidationErrors([])
    try {
      const data = await getExamFull(supabase, examId)
      setFull(data)
      // Validate immediately so the teacher sees issues before clicking Generate
      const built = await buildSections(data, null)
      const v = validateExamForPdf(built.exam, built.sections, isArabic)
      if (!v.ok) setValidationErrors(v.errors)
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open && examId) load() }, [open, examId])
  useEffect(() => { if (open) prefetchFonts() }, [open])

  useEffect(() => {
    if (presetVersion) {
      setActiveVersionId(presetVersion.id)
    } else {
      setActiveVersionId(null)
    }
  }, [presetVersion])

  const buildSections = useCallback(async (data, versionId) => {
    if (!data) return { exam: null, sections: [], version: null }
    let version = null
    if (versionId) {
      version = data.versions.find((v) => v.id === versionId)
      if (version) {
        const items = await getVersionItems(supabase, version.id)
        version = { ...version, items }
      }
    }
    const sections = data.sections.map((s) => ({
      id: s.id,
      title: s.title,
      instructions: s.instructions,
      total_marks: s.total_marks,
      items: data.items
        .filter((it) => it.section_id === s.id)
        .sort((a, b) => a.order_idx - b.order_idx)
        .map((it) => ({ question_id: it.question_id, question: it.qb_questions, marks: Number(it.marks) })),
    }))
    return { exam: data.exam, sections, version }
  }, [supabase])

  // Generate PDF as a blob URL for in-browser preview (NOT a download).
  // Uses the generators' `returnDoc: true` option to get the jsPDF doc back
  // without triggering a download, then calls doc.output('bloburl').
  const generatePdfBlobUrl = async (kind) => {
    if (!full) return null
    const { exam, sections, version } = await buildSections(full, activeVersionId)

    // Validate before generating
    const v = validateExamForPdf(exam, sections, isArabic)
    if (!v.ok) {
      setValidationErrors(v.errors)
      showToast(L('fix_errors_first', isArabic), 'error')
      return null
    }

    await ensureArabicFonts()

    if (kind === 'exam') {
      const doc = await generateExamPdf({
        exam, sections, version,
        filename: 'preview.pdf',
        isArabic,
        returnDoc: true,
      })
      return doc ? doc.output('bloburl') : null
    } else {
      const doc = await generateAnswerKeyPdf({
        exam, sections, version,
        filename: 'preview_key.pdf',
        isArabic,
        returnDoc: true,
      })
      return doc ? doc.output('bloburl') : null
    }
  }

  const handlePreview = async () => {
    setGenerating(true)
    setValidationErrors([])
    try {
      const url = await generatePdfBlobUrl('exam')
      if (url) {
        setPreviewUrl(url)
        showToast(L('pdf_generated', isArabic), 'success')
      }
    } catch (err) {
      if (err?.errors) {
        setValidationErrors(err.errors)
        showToast(L('fix_errors_first', isArabic), 'error')
      } else {
        showToast(humanizeError(err, isArabic), 'error')
      }
    } finally {
      setGenerating(false)
    }
  }

  const handleDownloadExam = async () => {
    if (!full) return
    setGenerating(true)
    try {
      const { exam, sections, version } = await buildSections(full, activeVersionId)
      const v = validateExamForPdf(exam, sections, isArabic)
      if (!v.ok) {
        setValidationErrors(v.errors)
        showToast(L('fix_errors_first', isArabic), 'error')
        return
      }
      // Use the real save() path — triggers browser download
      const safeName = (exam.title || 'exam').replace(/[\\/:*?"<>|]/g, '_')
      await generateExamPdf({
        exam, sections, version,
        filename: `${safeName}${version?.label ? ` - ${L('pdf_version', isArabic)} ${version.label}` : ''}.pdf`,
        isArabic,
      })
      showToast(L('pdf_generated', isArabic), 'success')
    } catch (err) {
      if (err?.errors) {
        setValidationErrors(err.errors)
      }
      showToast(humanizeError(err, isArabic), 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleDownloadKey = async () => {
    if (!full) return
    setGenerating(true)
    try {
      const { exam, sections, version } = await buildSections(full, activeVersionId)
      const v = validateExamForPdf(exam, sections, isArabic)
      if (!v.ok) {
        setValidationErrors(v.errors)
        showToast(L('fix_errors_first', isArabic), 'error')
        return
      }
      const safeName = (exam.title || 'exam').replace(/[\\/:*?"<>|]/g, '_')
      await generateAnswerKeyPdf({
        exam, sections, version,
        filename: `${safeName} - ${L('pdf_answer_key_title', isArabic)}${version?.label ? ` - ${L('pdf_version', isArabic)} ${version.label}` : ''}.pdf`,
        isArabic,
      })
      showToast(L('answer_key_generated', isArabic), 'success')
    } catch (err) {
      if (err?.errors) {
        setValidationErrors(err.errors)
      }
      showToast(humanizeError(err, isArabic), 'error')
    } finally {
      setGenerating(false)
    }
  }

  const exam = full?.exam
  const totalMarks = exam?.total_marks || 0
  const questionCount = full?.sections.reduce((sum, s) => sum + (full.items.filter((it) => it.section_id === s.id)).length, 0) || 0

  return (
    <Modal open={open} onClose={onClose} title={`${L('preview_btn', isArabic)} · ${L('exam_preview', isArabic)}`} wide>
      {loading ? (
        <p className='text-center text-fg-subtle text-sm py-8'>⏳</p>
      ) : !full ? (
        <p className='text-center text-fg-subtle text-sm py-8'>—</p>
      ) : (
        <div className='space-y-3'>
          {/* Summary */}
          <div className='glass-input border border-subtle rounded-lg p-3'>
            <p className='font-bold text-brand-gold-hover text-base'>{exam.title}</p>
            <p className='text-xs text-fg-subtle mt-1'>
              {questionCount} {L('questions_label', isArabic)} ·
              {' '}{full.sections.length} {L('sections_label', isArabic)} ·
              {' '}{totalMarks} {L('total_marks', isArabic)}
            </p>
            {(exam.subject || exam.grade) && (
              <p className='text-xs text-fg-subtle mt-1'>
                {exam.subject} {exam.grade ? `· ${exam.grade}` : ''}
              </p>
            )}
          </div>

          {/* Validation errors (if any) */}
          {validationErrors.length > 0 && (
            <div className='bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 space-y-1'>
              <p className='text-rose-400 text-xs font-bold'>⚠️ {L('fix_errors_first', isArabic)}</p>
              {validationErrors.map((e, i) => (
                <p key={i} className='text-rose-400 text-xs'>• {e}</p>
              ))}
            </div>
          )}

          {/* Version selector */}
          {full.versions.length > 0 && (
            <div>
              <label className='block text-xs text-fg-subtle mb-1'>{L('select_version', isArabic)}</label>
              <div className='flex gap-2 flex-wrap'>
                <button onClick={() => { setActiveVersionId(null); setPreviewUrl(null) }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${activeVersionId === null ? 'bg-brand-gold/15 text-brand-gold-hover border-brand-gold/40' : 'glass-input border-subtle text-fg-subtle'}`}>
                  {L('original_version', isArabic)}
                </button>
                {full.versions.map((v) => (
                  <button key={v.id} onClick={() => { setActiveVersionId(v.id); setPreviewUrl(null) }}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${activeVersionId === v.id ? 'bg-brand-gold/15 text-brand-gold-hover border-brand-gold/40' : 'glass-input border-subtle text-fg-subtle'}`}>
                    {v.version_label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Embedded PDF preview (the REAL PDF, rendered in-browser) */}
          {previewUrl && (
            <div>
              <p className='text-xs text-fg-subtle mb-1'>{L('preview_note', isArabic)}</p>
              <iframe
                src={previewUrl}
                title='PDF Preview'
                className='w-full bg-white rounded-lg border border-subtle'
                style={{ height: '400px' }}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className='grid grid-cols-1 sm:grid-cols-3 gap-2'>
            <button onClick={handlePreview} disabled={generating || validationErrors.length > 0}
              className='glass-input font-bold py-2.5 rounded-lg text-sm text-fg-subtle hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed'>
              {generating ? '⏳' : '👁️'} {L('exam_preview', isArabic)}
            </button>
            <button onClick={handleDownloadExam} disabled={generating || validationErrors.length > 0}
              className='btn-glow font-bold py-2.5 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed'>
              {generating ? '⏳' : '📄'} {L('download_exam_pdf', isArabic)}
            </button>
            <button onClick={handleDownloadKey} disabled={generating || validationErrors.length > 0}
              className='bg-emerald-600 hover:bg-emerald-500 text-fg font-bold py-2.5 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors'>
              {generating ? '⏳' : '🔑'} {L('download_answer_key', isArabic)}
            </button>
          </div>
          <p className='text-[10px] text-fg-subtle text-center'>
            {L('pdf_vector_note', isArabic)}
          </p>
        </div>
      )}
    </Modal>
  )
}
