import { useEffect, useState, useCallback, useRef } from 'react'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import { SkeletonList } from '../Skeleton'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import { listQuestions, saveExam, getExamFull, deleteExam, listExams } from '../../lib/qbStore'
import { getTemplateDesign, DEFAULT_TEMPLATE_KEY } from '../../lib/qbTemplates'
import { L, humanizeError } from '../../lib/qbLabels'
import { prefetchFonts } from '../../lib/qbFontSetup'

const TYPE_LABELS = {
  mcq: 'type_mcq',
  true_false: 'type_true_false',
  short_answer: 'type_short_answer',
  essay: 'type_essay',
  numerical: 'type_numerical',
  matching: 'type_matching',
  custom: 'type_custom',
}

export default function ExamBuilderModal({ open, onClose, supabase, teacherId, onOpenDesigner, onOpenPreview, onOpenVersions, onSaved }) {
  const { showToast } = useToast()
  const { isArabic } = useLanguage()
  const [view, setView] = useState('list') // 'list' | 'edit'
  const [exams, setExams] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [confirmId, setConfirmId] = useState(null)

  // Edit state
  const [examId, setExamId] = useState(null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [instructions, setInstructions] = useState('')
  const [header, setHeader] = useState({
    school_name: '', center_name: '', teacher_name: '', exam_date: '',
    logo_url: '', show_student_name_field: true, show_class_field: true, show_date_field: true,
  })
  const [footer, setFooter] = useState('')
  const [design, setDesign] = useState(getTemplateDesign(DEFAULT_TEMPLATE_KEY))
  const [sections, setSections] = useState([{ id: null, title: isArabic ? 'القسم الأول' : 'Section 1', instructions: '', items: [] }])
  const [activeSectionIdx, setActiveSectionIdx] = useState(0)
  const [questionSearch, setQuestionSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  // Drag-and-drop state
  const [dragItem, setDragItem] = useState(null) // { secIdx, itemIdx }
  const [dragOverItem, setDragOverItem] = useState(null) // { secIdx, itemIdx } or null
  const [recentlyAdded, setRecentlyAdded] = useState(null) // { secIdx, itemIdx } — for flash animation

  const recentTimer = useRef(null)

  const loadExams = useCallback(async () => {
    if (!supabase || !teacherId) return
    setLoadingList(true)
    try {
      const data = await listExams(supabase, teacherId)
      setExams(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingList(false)
    }
  }, [supabase, teacherId])

  useEffect(() => { if (open) { loadExams(); prefetchFonts() } }, [open, loadExams])

  const resetEditor = () => {
    setExamId(null); setTitle(''); setSubject(''); setGrade(''); setInstructions('')
    setHeader({
      school_name: '', center_name: '', teacher_name: '', exam_date: '',
      logo_url: '', show_student_name_field: true, show_class_field: true, show_date_field: true,
    })
    setFooter('')
    setDesign(getTemplateDesign(DEFAULT_TEMPLATE_KEY))
    setSections([{ id: null, title: isArabic ? 'القسم الأول' : 'Section 1', instructions: '', items: [] }])
    setActiveSectionIdx(0)
    setErrors({})
    setDragItem(null)
    setDragOverItem(null)
    setRecentlyAdded(null)
  }

  const startNew = () => { resetEditor(); setView('edit') }

  const startEdit = async (id) => {
    try {
      const full = await getExamFull(supabase, id)
      setExamId(full.exam.id)
      setTitle(full.exam.title)
      setSubject(full.exam.subject || '')
      setGrade(full.exam.grade || '')
      setInstructions(full.exam.instructions || '')
      setHeader(full.exam.header || {})
      setFooter(full.exam.footer || '')
      setDesign({ ...getTemplateDesign(DEFAULT_TEMPLATE_KEY), ...(full.exam.design || {}) })
      const secs = full.sections.length > 0
        ? full.sections.sort((a, b) => a.order_idx - b.order_idx).map((s) => ({
            id: s.id,
            title: s.title,
            instructions: s.instructions || '',
            items: full.items
              .filter((it) => it.section_id === s.id)
              .sort((a, b) => a.order_idx - b.order_idx)
              .map((it) => ({ question_id: it.question_id, question: it.qb_questions, marks: Number(it.marks) })),
          }))
        : [{ id: null, title: isArabic ? 'القسم الأول' : 'Section 1', instructions: '', items: [] }]
      setSections(secs)
      setActiveSectionIdx(0)
      setView('edit')
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    }
  }

  const searchQuestions = async (q) => {
    setSearchLoading(true)
    try {
      const data = await listQuestions(supabase, teacherId, { search: q })
      const usedIds = new Set(sections.flatMap((s) => s.items.map((it) => it.question_id)))
      setSearchResults(data.filter((d) => !usedIds.has(d.id)))
    } catch (err) {
      console.error(err)
    } finally {
      setSearchLoading(false)
    }
  }

  useEffect(() => {
    if (!questionSearch) { setSearchResults([]); return }
    const id = setTimeout(() => searchQuestions(questionSearch), 250)
    return () => clearTimeout(id)
  }, [questionSearch])

  const addQuestionToActiveSection = (q) => {
    setSections((prev) => prev.map((s, i) => {
      if (i !== activeSectionIdx) return s
      return { ...s, items: [...s.items, { question_id: q.id, question: q, marks: Number(q.marks) || 1 }] }
    }))
    setSearchResults((prev) => prev.filter((r) => r.id !== q.id))
    // Visual feedback: flash the newly-added item
    const newItemIdx = sections[activeSectionIdx].items.length
    setRecentlyAdded({ secIdx: activeSectionIdx, itemIdx: newItemIdx })
    showToast(L('question_added', isArabic), 'success')
    clearTimeout(recentTimer.current)
    recentTimer.current = setTimeout(() => setRecentlyAdded(null), 1500)
  }

  const removeItem = (secIdx, itemIdx) => {
    setSections((prev) => prev.map((s, i) => {
      if (i !== secIdx) return s
      return { ...s, items: s.items.filter((_, j) => j !== itemIdx) }
    }))
  }

  // Move item within its own section (up/down)
  const moveItem = (secIdx, itemIdx, dir) => {
    setSections((prev) => prev.map((s, i) => {
      if (i !== secIdx) return s
      const items = [...s.items]
      const target = itemIdx + dir
      if (target < 0 || target >= items.length) return s
      ;[items[itemIdx], items[target]] = [items[target], items[itemIdx]]
      return { ...s, items }
    }))
  }

  // Move item to a DIFFERENT section
  const moveItemToSection = (fromSecIdx, itemIdx, toSecIdx) => {
    if (fromSecIdx === toSecIdx) return
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, items: [...s.items] }))
      const [moved] = next[fromSecIdx].items.splice(itemIdx, 1)
      next[toSecIdx].items.push(moved)
      return next
    })
    showToast(L('question_added', isArabic), 'success')
  }

  // Drag-and-drop handlers
  const onDragStart = (secIdx, itemIdx) => (e) => {
    setDragItem({ secIdx, itemIdx })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `${secIdx}:${itemIdx}`)
  }

  const onDragOver = (secIdx, itemIdx) => (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragItem || (dragItem.secIdx === secIdx && dragItem.itemIdx === itemIdx)) {
      setDragOverItem(null)
      return
    }
    setDragOverItem({ secIdx, itemIdx })
  }

  const onDragLeave = () => () => {
    setDragOverItem(null)
  }

  const onDrop = (secIdx, itemIdx) => (e) => {
    e.preventDefault()
    const from = dragItem
    if (!from) return
    setDragOverItem(null)
    setDragItem(null)
    if (from.secIdx === secIdx && from.itemIdx === itemIdx) return

    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, items: [...s.items] }))
      const [moved] = next[from.secIdx].items.splice(from.itemIdx, 1)
      // Adjust target index if same section and removed before target
      let adjustedIdx = itemIdx
      if (from.secIdx === secIdx && from.itemIdx < itemIdx) adjustedIdx--
      next[secIdx].items.splice(adjustedIdx, 0, moved)
      return next
    })
  }

  const setItemMarks = (secIdx, itemIdx, marks) => {
    setSections((prev) => prev.map((s, i) => {
      if (i !== secIdx) return s
      return {
        ...s,
        items: s.items.map((it, j) => {
          if (j !== itemIdx) return it
          const cap = Number(it.question?.marks) || 999
          const clamped = Math.min(Math.max(0, Number(marks) || 0), cap)
          return { ...it, marks: clamped }
        }),
      }
    }))
  }

  const addSection = () => {
    setSections((prev) => [...prev, { id: null, title: `${L('section_label', isArabic)} ${prev.length + 1}`, instructions: '', items: [] }])
    setActiveSectionIdx(sections.length)
  }
  const removeSection = (idx) => {
    if (sections.length === 1) { showToast(L('at_least_one_section', isArabic), 'error'); return }
    setSections((prev) => prev.filter((_, i) => i !== idx))
    if (activeSectionIdx >= idx) setActiveSectionIdx(Math.max(0, activeSectionIdx - 1))
  }
  const setSectionTitle = (idx, title) => setSections((prev) => prev.map((s, i) => i === idx ? { ...s, title } : s))
  const setSectionInstructions = (idx, instructions) => setSections((prev) => prev.map((s, i) => i === idx ? { ...s, instructions } : s))

  const sectionTotal = (s) => s.items.reduce((sum, it) => sum + (Number(it.marks) || 0), 0)
  const examTotal = sections.reduce((sum, s) => sum + sectionTotal(s), 0)
  const questionCount = sections.reduce((sum, s) => sum + s.items.length, 0)

  const invalidItems = []
  sections.forEach((s, si) => s.items.forEach((it, ii) => {
    if (Number(it.marks) > Number(it.question?.marks || 0)) {
      invalidItems.push({ si, ii, set: Number(it.marks), cap: Number(it.question?.marks || 0) })
    }
  }))

  const validate = () => {
    const errs = {}
    if (!title.trim()) errs.title = L('required_field', isArabic)
    if (sections.length === 0) errs.sections = L('err_no_sections', isArabic)
    if (sections.some((s) => !s.title.trim())) errs.section_titles = L('all_sections_need_title', isArabic)
    if (sections.some((s) => s.items.length === 0)) errs.empty_section = L('each_section_needs_question', isArabic)
    if (invalidItems.length > 0) errs.invalid_marks = `${invalidItems.length} ${L('items_exceed_max', isArabic)}`
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validate()) {
      showToast(L('fix_errors_first', isArabic), 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        id: examId,
        title: title.trim(),
        subject: subject.trim() || null,
        grade: grade.trim() || null,
        instructions: instructions.trim() || null,
        header,
        footer: footer.trim() || null,
        design,
        sections: sections.map((s) => ({
          title: s.title.trim(),
          instructions: s.instructions?.trim() || null,
          items: s.items.map((it) => ({ question_id: it.question_id, marks: Number(it.marks) || 1 })),
        })),
      }
      const result = await saveExam(supabase, teacherId, payload)
      setExamId(result.id)
      showToast(L('saved_success', isArabic), 'success')
      onSaved?.(result)
      loadExams()
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteExam(supabase, confirmId)
      showToast(L('deleted_success', isArabic), 'success')
      setConfirmId(null)
      loadExams()
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    }
  }

  // ── LIST VIEW ──
  if (view === 'list') {
    return (
      <Modal open={open} onClose={onClose} title={`📝 ${L('exams_list', isArabic)}`} wide>
        <div className='flex gap-2 mb-3'>
          <button onClick={startNew}
            className='text-xs btn-glow font-bold px-3 py-2 rounded-lg'>
            + {L('new_exam', isArabic)}
          </button>
        </div>
        {loadingList ? (
          <SkeletonList rows={4} />
        ) : exams.length === 0 ? (
          <div className='text-center py-10'>
            <div className='text-3xl mb-2'>📝</div>
            <p className='text-fg-subtle text-sm'>{L('no_exams_yet', isArabic)}</p>
          </div>
        ) : (
          <div className='space-y-2'>
            {exams.map((e) => {
              const sectionCount = e.qb_exam_sections?.length || 0
              const itemCount = e.qb_exam_sections?.reduce((sum, s) => sum + (s.qb_exam_items?.length || 0), 0) || 0
              return (
                <div key={e.id} className='glass-input border border-subtle rounded-lg p-3 flex items-center justify-between gap-2'>
                  <div className='flex-1 min-w-0'>
                    <p className='font-bold text-brand-gold-hover text-sm truncate'>{e.title}</p>
                    <p className='text-xs text-fg-subtle'>
                      {new Date(e.created_at).toLocaleDateString(isArabic ? 'ar-EG' : 'en')} ·
                      {' '}{sectionCount} {L('sections_label', isArabic)} ·
                      {' '}{itemCount} {L('questions_label', isArabic)} ·
                      {' '}{e.total_marks} {L('marks_label', isArabic)}
                    </p>
                  </div>
                  <div className='flex gap-1'>
                    <button onClick={() => startEdit(e.id)} title={L('edit', isArabic)}
                      className='text-brand-gold-hover hover:text-fg text-sm px-2'>✏️</button>
                    <button onClick={() => onOpenVersions(e.id)} title={L('versions_btn', isArabic)}
                      className='text-fg-subtle hover:text-fg text-sm px-2'>🔤</button>
                    <button onClick={() => onOpenPreview(e.id)} title={L('preview_btn', isArabic)}
                      className='text-emerald-400 hover:text-emerald-300 text-sm px-2'>👁️</button>
                    <button onClick={() => setConfirmId(e.id)} title={L('delete', isArabic)}
                      className='text-rose-400 hover:text-rose-300 text-sm px-2'>🗑️</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <ConfirmDialog
          open={!!confirmId}
          title={L('confirm_delete_exam_title', isArabic)}
          danger
          confirmLabel={L('delete_permanent', isArabic)}
          message={L('confirm_delete_exam_msg', isArabic)}
          onConfirm={handleDelete}
          onCancel={() => setConfirmId(null)}
        />
      </Modal>
    )
  }

  // ── EDIT VIEW ──
  return (
    <Modal open={open} onClose={onClose} title={examId ? L('edit_exam', isArabic) : L('new_exam', isArabic)} wide>
      <div className='space-y-3'>
        {/* Top: title + totals */}
        <div className='grid grid-cols-1 sm:grid-cols-3 gap-2'>
          <div className='sm:col-span-2'>
            <label className='block text-xs text-fg-subtle mb-1'>{L('exam_title', isArabic)}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className={`w-full glass-input border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold ${errors.title ? 'border-rose-500' : 'border-subtle'}`} />
            {errors.title && <p className='text-rose-400 text-[11px] mt-1'>{errors.title}</p>}
          </div>
          <div className='glass-input border border-subtle rounded-lg p-2 text-center'>
            <p className='text-[10px] text-fg-subtle'>{L('total_label', isArabic)}</p>
            <p className='text-lg font-black text-brand-gold-hover'>{examTotal}</p>
            <p className='text-[10px] text-fg-subtle'>{questionCount} {L('questions_label', isArabic)}</p>
          </div>
        </div>

        {/* Subject + grade + date */}
        <div className='grid grid-cols-3 gap-2'>
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder={L('subject', isArabic)}
            className='glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
          <input value={grade} onChange={(e) => setGrade(e.target.value)}
            placeholder={L('grade', isArabic)}
            className='glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
          <input value={header.exam_date || ''} onChange={(e) => setHeader({ ...header, exam_date: e.target.value })}
            placeholder={L('exam_date', isArabic)}
            className='glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
        </div>

        {/* Header info */}
        <details className='glass-input border border-subtle rounded-lg p-2'>
          <summary className='text-xs font-bold text-fg-subtle cursor-pointer'>{L('header_info', isArabic)}</summary>
          <div className='grid grid-cols-2 gap-2 mt-2'>
            <input value={header.school_name || ''} onChange={(e) => setHeader({ ...header, school_name: e.target.value })}
              placeholder={L('school_name', isArabic)}
              className='glass-input border border-subtle rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-gold' />
            <input value={header.center_name || ''} onChange={(e) => setHeader({ ...header, center_name: e.target.value })}
              placeholder={L('center_name', isArabic)}
              className='glass-input border border-subtle rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-gold' />
            <input value={header.teacher_name || ''} onChange={(e) => setHeader({ ...header, teacher_name: e.target.value })}
              placeholder={L('teacher_name', isArabic)}
              className='glass-input border border-subtle rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-gold' />
            <label className='text-xs text-fg-subtle flex items-center gap-1 cursor-pointer'>
              <input type='checkbox' checked={header.show_student_name_field || false}
                onChange={(e) => setHeader({ ...header, show_student_name_field: e.target.checked })}
                className='w-3 h-3 accent-amber-500' />
              {L('student_name_field', isArabic)}
            </label>
            <label className='text-xs text-fg-subtle flex items-center gap-1 cursor-pointer'>
              <input type='checkbox' checked={header.show_class_field || false}
                onChange={(e) => setHeader({ ...header, show_class_field: e.target.checked })}
                className='w-3 h-3 accent-amber-500' />
              {L('class_field', isArabic)}
            </label>
            <label className='text-xs text-fg-subtle flex items-center gap-1 cursor-pointer'>
              <input type='checkbox' checked={header.show_date_field || false}
                onChange={(e) => setHeader({ ...header, show_date_field: e.target.checked })}
                className='w-3 h-3 accent-amber-500' />
              {L('date_field', isArabic)}
            </label>
            <label className='text-xs text-fg-subtle col-span-2 cursor-pointer'>
              <input type='file' accept='image/*'
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  if (f.size > 1024 * 1024) { showToast(L('image_too_large', isArabic), 'error'); return }
                  const r = new FileReader()
                  r.onload = () => setHeader((h) => ({ ...h, logo_url: r.result }))
                  r.readAsDataURL(f)
                }}
                className='text-[10px]' />
              {header.logo_url && <span className='text-[10px] text-emerald-400'>✓ {L('done', isArabic)}</span>}
            </label>
          </div>
        </details>

        {/* Instructions */}
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2}
          placeholder={L('exam_instructions', isArabic)}
          className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />

        {/* Sections */}
        <div className='border-t border-subtle pt-3'>
          <p className='text-[10px] text-fg-subtle mb-1.5'>{L('drag_to_reorder', isArabic)}</p>
          <div className='flex items-center gap-2 mb-2 flex-wrap'>
            {sections.map((s, idx) => (
              <button key={idx} onClick={() => setActiveSectionIdx(idx)}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${activeSectionIdx === idx ? 'bg-brand-gold/15 text-brand-gold-hover border-brand-gold/40' : 'glass-input border-subtle text-fg-subtle'}`}>
                {s.title} ({s.items.length})
              </button>
            ))}
            <button onClick={addSection} className='text-xs text-brand-gold-hover font-bold'>+ {L('section_label', isArabic)}</button>
          </div>

          {/* Active section editor */}
          {sections[activeSectionIdx] && (
            <div className='glass-input border border-subtle rounded-lg p-3 space-y-2'>
              <div className='flex gap-2'>
                <input value={sections[activeSectionIdx].title}
                  onChange={(e) => setSectionTitle(activeSectionIdx, e.target.value)}
                  placeholder={L('section_title_label', isArabic)}
                  className={`flex-1 glass-input border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-brand-gold ${errors.section_titles ? 'border-rose-500' : 'border-subtle'}`} />
                <span className='text-xs text-fg-subtle self-center'>{sectionTotal(sections[activeSectionIdx])} {L('marks_label', isArabic)}</span>
                <button onClick={() => removeSection(activeSectionIdx)} className='text-rose-400 text-xs px-2'>🗑️</button>
              </div>
              <input value={sections[activeSectionIdx].instructions || ''}
                onChange={(e) => setSectionInstructions(activeSectionIdx, e.target.value)}
                placeholder={L('section_instructions', isArabic)}
                className='w-full glass-input border border-subtle rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-gold' />

              {/* Items list — drag-and-drop enabled */}
              <div className='space-y-1'>
                {sections[activeSectionIdx].items.length === 0 ? (
                  <p className='text-xs text-fg-subtle text-center py-2'>{L('search_bank', isArabic)}</p>
                ) : sections[activeSectionIdx].items.map((it, itemIdx) => {
                  const overCap = Number(it.marks) > Number(it.question?.marks || 0)
                  const isDragOver = dragOverItem?.secIdx === activeSectionIdx && dragOverItem?.itemIdx === itemIdx
                  const isDragging = dragItem?.secIdx === activeSectionIdx && dragItem?.itemIdx === itemIdx
                  const justAdded = recentlyAdded?.secIdx === activeSectionIdx && recentlyAdded?.itemIdx === itemIdx
                  return (
                    <div
                      key={itemIdx}
                      draggable
                      onDragStart={onDragStart(activeSectionIdx, itemIdx)}
                      onDragOver={onDragOver(activeSectionIdx, itemIdx)}
                      onDragLeave={onDragLeave()}
                      onDrop={onDrop(activeSectionIdx, itemIdx)}
                      className={`flex items-center gap-2 bg-black/20 rounded p-1.5 border transition-all ${
                        overCap ? 'border-rose-500/50' :
                        isDragOver ? 'border-brand-gold border-2 bg-brand-gold/10' :
                        justAdded ? 'border-emerald-500/60 bg-emerald-500/10 animate-pulse' :
                        'border-transparent'
                      } ${isDragging ? 'opacity-40' : ''}`}
                      style={{ cursor: 'grab' }}
                    >
                      <span className='text-fg-subtle text-xs select-none' title={L('drag_to_reorder', isArabic)}>⠿</span>
                      <span className='text-[10px] text-fg-subtle w-5 text-center'>{itemIdx + 1}</span>
                      <div className='flex-1 min-w-0'>
                        <p className='text-xs text-fg truncate'>{it.question?.question_text}</p>
                        <p className='text-[10px] text-fg-subtle'>{L(TYPE_LABELS[it.question?.type] || 'type_custom', isArabic)} · {L('max_marks_cap', isArabic)}: {it.question?.marks}</p>
                      </div>
                      <input type='number' step='0.5' min='0' max={it.question?.marks} value={it.marks} dir='ltr'
                        onChange={(e) => setItemMarks(activeSectionIdx, itemIdx, e.target.value)}
                        className={`w-16 text-center glass-input border rounded p-1 text-xs outline-none focus:border-brand-gold ${overCap ? 'border-rose-500' : 'border-subtle'}`} />
                      <span className='text-[10px] text-fg-subtle'>{L('marks_label', isArabic)}</span>
                      {/* Move to section dropdown */}
                      {sections.length > 1 && (
                        <select
                          value=''
                          onChange={(e) => {
                            const toIdx = Number(e.target.value)
                            if (!isNaN(toIdx)) moveItemToSection(activeSectionIdx, itemIdx, toIdx)
                          }}
                          className='text-[10px] glass-input border border-subtle rounded p-1 outline-none'
                          title={L('move_to_section', isArabic)}
                        >
                          <option value=''>↔</option>
                          {sections.map((_, idx) => idx !== activeSectionIdx ? (
                            <option key={idx} value={idx}>→ {sections[idx].title}</option>
                          ) : null)}
                        </select>
                      )}
                      <button onClick={() => moveItem(activeSectionIdx, itemIdx, -1)} disabled={itemIdx === 0}
                        className='text-fg-subtle hover:text-fg text-xs disabled:opacity-30' title={L('move_up', isArabic)}>↑</button>
                      <button onClick={() => moveItem(activeSectionIdx, itemIdx, 1)} disabled={itemIdx === sections[activeSectionIdx].items.length - 1}
                        className='text-fg-subtle hover:text-fg text-xs disabled:opacity-30' title={L('move_down', isArabic)}>↓</button>
                      <button onClick={() => removeItem(activeSectionIdx, itemIdx)}
                        className='text-rose-400 hover:text-rose-300 text-xs' title={L('remove_item', isArabic)}>✕</button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Search to add */}
          <div className='mt-2'>
            <input value={questionSearch} onChange={(e) => setQuestionSearch(e.target.value)}
              placeholder={L('search_bank', isArabic)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
            {searchLoading && <p className='text-[10px] text-fg-subtle mt-1'>⏳</p>}
            {searchResults.length > 0 && (
              <div className='mt-1 max-h-40 overflow-y-auto space-y-1'>
                {searchResults.slice(0, 20).map((q) => (
                  <button key={q.id} onClick={() => addQuestionToActiveSection(q)}
                    className='w-full text-right glass-input border border-subtle rounded p-1.5 hover:border-brand-gold/40 hover:bg-brand-gold/5 transition-all'>
                    <p className='text-xs text-fg truncate'>{q.question_text}</p>
                    <p className='text-[10px] text-fg-subtle'>
                      {L(TYPE_LABELS[q.type] || 'type_custom', isArabic)} · {q.marks} {L('marks_label', isArabic)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Errors */}
        {Object.keys(errors).length > 0 && (
          <div className='bg-rose-500/10 border border-rose-500/30 rounded-lg p-2 space-y-1'>
            {Object.entries(errors).map(([k, v]) => (
              <p key={k} className='text-rose-400 text-xs'>⚠️ {v}</p>
            ))}
          </div>
        )}

        {/* Footer */}
        <details className='glass-input border border-subtle rounded-lg p-2'>
          <summary className='text-xs font-bold text-fg-subtle cursor-pointer'>{L('exam_footer', isArabic)}</summary>
          <textarea value={footer} onChange={(e) => setFooter(e.target.value)} rows={2}
            placeholder={L('exam_footer_hint', isArabic)}
            className='w-full mt-2 glass-input border border-subtle rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-gold' />
        </details>

        {/* Actions */}
        <div className='flex gap-2 pt-2 flex-wrap'>
          <button onClick={() => setView('list')}
            className='flex-1 glass-input font-bold py-2.5 rounded-lg text-sm text-fg-subtle hover:bg-white/10 min-w-[100px]'>
            {L('back', isArabic)}
          </button>
          <button onClick={() => onOpenDesigner({ design, setDesign })}
            className='flex-1 glass-input font-bold py-2.5 rounded-lg text-sm text-fg-subtle hover:bg-white/10 min-w-[100px]'>
            {L('designer_btn', isArabic)}
          </button>
          <button onClick={handleSave} disabled={saving}
            className='flex-1 btn-glow font-bold py-2.5 rounded-lg text-sm disabled:opacity-40 min-w-[100px]'>
            {saving ? '⏳' : '💾'} {L('save', isArabic)}
          </button>
        </div>
      </div>
    </Modal>
  )
}
