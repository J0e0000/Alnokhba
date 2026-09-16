import { useEffect, useState } from 'react'
import Modal from '../Modal'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import { createStaging, listStaging, updateStagingParsed, promoteStaging, deleteStaging } from '../../lib/qbStore'
import { parseTextToQuestions, extractTextFromPdf, extractTextFromImage } from '../../lib/qbImport'

export default function ImportReviewModal({ open, onClose, supabase, teacherId, onImported }) {
  const { showToast } = useToast()
  const { isArabic, t } = useLanguage()
  const [tab, setTab] = useState('paste') // 'paste' | 'file' | 'history'
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [staging, setStaging] = useState([])

  const loadStaging = async () => {
    try {
      const data = await listStaging(supabase, teacherId)
      setStaging(data)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (open) {
      setText(''); setParsed([]); setProgress(0)
      loadStaging()
    }
  }, [open, supabase, teacherId])

  const handleParse = () => {
    const qs = parseTextToQuestions(text)
    setParsed(qs)
    if (qs.length === 0) {
      showToast(isArabic ? 'لم يتم العثور على أسئلة' : 'No questions found', 'error')
    } else {
      showToast(isArabic ? `تم تحليل ${qs.length} سؤال` : `Parsed ${qs.length} questions`, 'success')
    }
  }

  const handleFile = async (file) => {
    if (!file) return
    setBusy(true); setProgress(0)
    try {
      let extracted = ''
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        extracted = await extractTextFromPdf(file)
      } else if (file.type.startsWith('image/')) {
        extracted = await extractTextFromImage(file, (p) => setProgress(Math.round(p * 100)))
      } else {
        // Treat as text
        extracted = await file.text()
      }
      setText(extracted)
      const qs = parseTextToQuestions(extracted)
      setParsed(qs)
      showToast(isArabic ? `تم استخراج ${qs.length} سؤال — راجعهم` : `Extracted ${qs.length} questions — review them`, 'success')
    } catch (err) {
      console.error(err)
      showToast(isArabic ? 'فشل الاستخراج' : 'Extraction failed', 'error')
    } finally {
      setBusy(false); setProgress(0)
    }
  }

  const updateParsedItem = (idx, patch) => {
    setParsed((prev) => prev.map((p, i) => i === idx ? { ...p, ...patch } : p))
  }

  const removeParsedItem = (idx) => {
    setParsed((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSaveToStaging = async () => {
    if (parsed.length === 0) {
      showToast(isArabic ? 'لا يوجد أسئلة للحفظ' : 'No questions to save', 'error')
      return
    }
    setBusy(true)
    try {
      const kind = tab === 'file' ? 'pdf' : 'text'
      await createStaging(supabase, teacherId, kind, text, parsed)
      showToast(isArabic ? '✅ تم الحفظ في قائمة المراجعة' : '✅ Saved to review queue', 'success')
      setParsed([]); setText('')
      loadStaging()
      setTab('history')
    } catch (err) {
      console.error(err)
      showToast(isArabic ? 'فشل الحفظ' : 'Save failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handlePromote = async (id) => {
    setBusy(true)
    try {
      // If parsed was edited locally, push the latest version to staging first
      const st = staging.find((s) => s.id === id)
      if (!st) return
      await updateStagingParsed(supabase, id, st.parsed_questions)
      await promoteStaging(supabase, id)
      showToast(isArabic ? '✅ تمت الإضافة لبنك الأسئلة' : '✅ Added to bank', 'success')
      loadStaging()
      onImported?.()
    } catch (err) {
      console.error(err)
      showToast(isArabic ? 'فشل الإضافة' : 'Promotion failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteStaging = async (id) => {
    try {
      await deleteStaging(supabase, id)
      loadStaging()
    } catch (err) {
      showToast(isArabic ? 'فشل الحذف' : 'Delete failed', 'error')
    }
  }

  const updateStagingParsedLocal = (id, parsed) => {
    setStaging((prev) => prev.map((s) => s.id === id ? { ...s, parsed_questions: parsed } : s))
  }

  return (
    <Modal open={open} onClose={onClose} title={isArabic ? '⬆️ استيراد أسئلة' : '⬆️ Import Questions'} wide>
      {/* Tabs */}
      <div className='flex gap-2 mb-3 border-b border-subtle'>
        {[
          ['paste', isArabic ? '📋 لصق نص' : '📋 Paste Text'],
          ['file', isArabic ? '📁 ملف PDF/صورة' : '📁 PDF/Image File'],
          ['history', isArabic ? '🕐 المراجعة' : 'Review Queue'],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${tab === k ? 'border-brand-gold text-brand-gold-hover' : 'border-transparent text-fg-subtle hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'paste' && (
        <div className='space-y-3'>
          <p className='text-xs text-fg-subtle'>
            {isArabic
              ? 'الصق الأسئلة بهذا الشكل (سؤال لكل كتلة، سطر فارغ بين الكتل):'
              : 'Paste questions in this format (one block per question, blank line between):'}
          </p>
          <pre className='text-[10px] bg-black/30 border border-subtle rounded p-2 text-fg-subtle overflow-x-auto' dir='ltr'>
{`Q: ما عاصمة مصر؟
A) القاهرة
B) الإسكندرية
C) الجيزة
D) أسوان
ANS: A
MARKS: 2
DIFF: easy
EXPL: القاهرة هي عاصمة مصر.

Q: كم 2+2؟
ANS: 4`}
          </pre>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
            placeholder='Q: ...'
            className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold font-mono' dir='ltr' />
          <button onClick={handleParse}
            className='text-xs bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/40 px-3 py-2 rounded-lg font-bold hover:bg-brand-gold/25'>
            🔍 {isArabic ? 'تحليل' : 'Parse'}
          </button>
        </div>
      )}

      {tab === 'file' && (
        <div className='space-y-3'>
          <p className='text-xs text-fg-subtle'>
            {isArabic
              ? 'ارفع ملف PDF أو صورة. سيتم استخراج النص آليًا ثم تحليله. ملاحظة: الاستخراج قد لا يكون دقيقًا 100% — راجع الأسئلة قبل الحفظ.'
              : 'Upload a PDF or image file. Text will be extracted automatically then parsed. Note: extraction may not be 100% accurate — review before saving.'}
          </p>
          <input type='file' accept='.pdf,image/*'
            onChange={(e) => handleFile(e.target.files?.[0])}
            className='text-xs text-fg-subtle' />
          {busy && progress > 0 && (
            <div className='w-full bg-black/30 rounded-full h-2 overflow-hidden'>
              <div className='bg-brand-gold h-full transition-all' style={{ width: `${progress}%` }} />
            </div>
          )}
          {busy && progress === 0 && <p className='text-xs text-brand-gold animate-pulse'>⏳ {isArabic ? 'جاري المعالجة...' : 'Processing...'}</p>}
        </div>
      )}

      {tab === 'history' && (
        <div className='space-y-3'>
          {staging.length === 0 ? (
            <div className='text-center py-8'>
              <div className='text-3xl mb-2'>📥</div>
              <p className='text-fg-subtle text-sm'>{isArabic ? 'لا توجد استيرادات بانتظار المراجعة.' : 'No imports pending review.'}</p>
            </div>
          ) : (
            staging.map((st) => (
              <div key={st.id} className='glass-input border border-subtle rounded-lg p-3'>
                <div className='flex items-center justify-between mb-2'>
                  <div className='text-xs'>
                    <span className='font-bold text-fg'>{st.source_kind}</span>
                    <span className='text-fg-subtle'> · {new Date(st.created_at).toLocaleString(isArabic ? 'ar-EG' : 'en')}</span>
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold ${st.status === 'imported' ? 'bg-emerald-500/10 text-emerald-400' : st.status === 'rejected' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'}`}>
                      {st.status}
                    </span>
                  </div>
                  <button onClick={() => handleDeleteStaging(st.id)}
                    className='text-rose-400 hover:text-rose-300 text-xs'>🗑️</button>
                </div>
                <div className='space-y-1.5 max-h-40 overflow-y-auto'>
                  {(st.parsed_questions || []).map((q, idx) => (
                    <div key={idx} className='flex items-center gap-2 bg-black/20 rounded p-1.5'>
                      <input value={q.question_text || ''} dir='ltr'
                        onChange={(e) => {
                          const next = [...(st.parsed_questions || [])]
                          next[idx] = { ...q, question_text: e.target.value }
                          updateStagingParsedLocal(st.id, next)
                        }}
                        className='flex-1 bg-transparent text-xs outline-none text-fg' />
                      <span className='text-[10px] text-fg-subtle'>{q.type}</span>
                      <button onClick={() => {
                        const next = (st.parsed_questions || []).filter((_, i) => i !== idx)
                        updateStagingParsedLocal(st.id, next)
                      }}
                        className='text-rose-400 text-xs'>✕</button>
                    </div>
                  ))}
                </div>
                {st.status !== 'imported' && (st.parsed_questions || []).length > 0 && (
                  <button onClick={() => handlePromote(st.id)} disabled={busy}
                    className='mt-2 text-xs btn-glow font-bold px-3 py-1.5 rounded-lg disabled:opacity-40'>
                    ✅ {isArabic ? 'إضافة لبنك الأسئلة' : 'Add to bank'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Parsed preview */}
      {parsed.length > 0 && tab !== 'history' && (
        <div className='mt-4 border-t border-subtle pt-3'>
          <div className='flex items-center justify-between mb-2'>
            <p className='text-xs font-bold text-fg-subtle'>
              {isArabic ? `معاينة (${parsed.length})` : `Preview (${parsed.length})`}
            </p>
            <button onClick={() => setParsed([])}
              className='text-xs text-rose-400 hover:text-rose-300'>✕ {isArabic ? 'مسح' : 'Clear'}</button>
          </div>
          <div className='space-y-1.5 max-h-40 overflow-y-auto'>
            {parsed.map((q, idx) => (
              <div key={idx} className='flex items-center gap-2 bg-black/20 rounded p-1.5'>
                <input value={q.question_text || ''} dir='ltr'
                  onChange={(e) => updateParsedItem(idx, { question_text: e.target.value })}
                  className='flex-1 bg-transparent text-xs outline-none text-fg' />
                <span className='text-[10px] text-fg-subtle'>{q.type}</span>
                <button onClick={() => removeParsedItem(idx)}
                  className='text-rose-400 text-xs'>✕</button>
              </div>
            ))}
          </div>
          <button onClick={handleSaveToStaging} disabled={busy || parsed.length === 0}
            className='mt-2 w-full btn-glow font-bold py-2 rounded-lg text-sm disabled:opacity-40'>
            {busy ? '⏳' : '💾'} {isArabic ? 'حفظ في قائمة المراجعة' : 'Save to Review Queue'}
          </button>
        </div>
      )}
    </Modal>
  )
}
