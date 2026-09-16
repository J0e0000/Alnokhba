import { useEffect, useState } from 'react'
import Modal from '../Modal'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import { createQuestion, updateQuestion, getQuestionTags, setQuestionTags } from '../../lib/qbStore'
import { L, humanizeError } from '../../lib/qbLabels'
import { GRADES_BY_STAGE } from '../../lib/helpers'

const DIFFICULTIES = [
  { value: 'easy', labelKey: 'diff_easy' },
  { value: 'medium', labelKey: 'diff_medium' },
  { value: 'hard', labelKey: 'diff_hard' },
]

const TYPES = [
  { value: 'mcq', labelKey: 'type_mcq' },
  { value: 'true_false', labelKey: 'type_true_false' },
  { value: 'short_answer', labelKey: 'type_short_answer' },
  { value: 'essay', labelKey: 'type_essay' },
  { value: 'numerical', labelKey: 'type_numerical' },
  { value: 'matching', labelKey: 'type_matching' },
  { value: 'custom', labelKey: 'type_custom' },
]

const ALL_GRADES = Object.values(GRADES_BY_STAGE).flat()

function emptyForm() {
  return {
    subject: 'عام',
    grade: '',
    unit: '',
    lesson: '',
    topic: '',
    difficulty: 'medium',
    type: 'mcq',
    question_text: '',
    image_url: '',
    choices: ['', '', '', ''],
    correct_answer: { index: 0 },
    explanation: '',
    marks: 1,
    source_ref: '',
    is_favorite: false,
    tags: [],
  }
}

export default function QuestionEditModal({ open, onClose, supabase, teacherId, question, onSaved }) {
  const { showToast } = useToast()
  const { isArabic, t } = useLanguage()
  const [form, setForm] = useState(emptyForm())
  const [errors, setErrors] = useState({})
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (question) {
      const f = {
        ...emptyForm(),
        ...question,
        choices: Array.isArray(question.choices) && question.choices.length > 0
          ? question.choices
          : (question.type === 'mcq' ? ['', '', '', ''] : []),
        correct_answer: question.correct_answer || { index: 0 },
        tags: [],
      }
      setForm(f)
      // Load existing tags
      getQuestionTags(supabase, question.id).then((tags) => {
        setForm((prev) => ({ ...prev, tags: tags.map((tg) => tg.name) }))
      }).catch(() => {})
    } else {
      setForm(emptyForm())
    }
    setErrors({})
    setTagInput('')
  }, [open, question, supabase])

  const set = (k, v) => {
    setForm((prev) => ({ ...prev, [k]: v }))
    if (errors[k]) setErrors((prev) => { const n = { ...prev }; delete n[k]; return n })
  }

  const setChoice = (idx, val) => {
    setForm((prev) => {
      const choices = [...prev.choices]
      choices[idx] = val
      return { ...prev, choices }
    })
  }

  const addChoice = () => setForm((prev) => ({ ...prev, choices: [...prev.choices, ''] }))
  const removeChoice = (idx) => setForm((prev) => {
    const choices = prev.choices.filter((_, i) => i !== idx)
    let correct_answer = prev.correct_answer
    if (correct_answer?.index === idx) correct_answer = { index: 0 }
    else if (correct_answer?.index > idx) correct_answer = { index: correct_answer.index - 1 }
    return { ...prev, choices, correct_answer }
  })

  const addTag = () => {
    const name = tagInput.trim()
    if (!name) return
    if (!form.tags.includes(name)) {
      setForm((prev) => ({ ...prev, tags: [...prev.tags, name] }))
    }
    setTagInput('')
  }
  const removeTag = (name) => setForm((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== name) }))

  const validate = () => {
    const errs = {}
    if (!form.question_text.trim()) errs.question_text = L('required_field', isArabic)
    if (form.type === 'mcq') {
      const filled = form.choices.filter((c) => c.trim())
      if (filled.length < 2) errs.choices = L('at_least_2_choices', isArabic)
    }
    if (!form.marks || Number(form.marks) <= 0) errs.marks = L('marks_must_be_positive', isArabic)
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        ...form,
        choices: form.type === 'mcq' ? form.choices.filter((c) => c.trim()) : [],
        marks: Number(form.marks) || 1,
      }
      let saved
      if (question) {
        saved = await updateQuestion(supabase, question.id, payload)
        await setQuestionTags(supabase, question.id, teacherId, form.tags)
      } else {
        saved = await createQuestion(supabase, teacherId, payload)
      }
      showToast(L('saved_success', isArabic), 'success')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      console.error(err)
      showToast(humanizeError(err, isArabic), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 1024 * 1024) {
      showToast(L('image_too_large', isArabic), 'error')
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('image_url', reader.result)
    reader.readAsDataURL(file)
  }

  return (
    <Modal open={open} onClose={onClose} title={question ? L('edit_question', isArabic) : L('new_question', isArabic)} wide>
      <form onSubmit={submit} className='space-y-3'>
        {/* Type + Difficulty */}
        <div className='grid grid-cols-2 gap-3'>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('question_type', isArabic)}</label>
            <select value={form.type} onChange={(e) => set('type', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold'>
              {TYPES.map((tp) => <option key={tp.value} value={tp.value}>{L(tp.labelKey, isArabic)}</option>)}
            </select>
          </div>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('difficulty', isArabic)}</label>
            <select value={form.difficulty} onChange={(e) => set('difficulty', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold'>
              {DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{L(d.labelKey, isArabic)}</option>)}
            </select>
          </div>
        </div>

        {/* Categorization */}
        <div className='grid grid-cols-2 sm:grid-cols-3 gap-3'>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('subject', isArabic)}</label>
            <input value={form.subject} onChange={(e) => set('subject', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
          </div>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('grade', isArabic)}</label>
            <select value={form.grade} onChange={(e) => set('grade', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold'>
              <option value=''>—</option>
              {ALL_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('unit', isArabic)}</label>
            <input value={form.unit} onChange={(e) => set('unit', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
          </div>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('lesson', isArabic)}</label>
            <input value={form.lesson} onChange={(e) => set('lesson', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
          </div>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('topic', isArabic)}</label>
            <input value={form.topic} onChange={(e) => set('topic', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
          </div>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('marks_label', isArabic)}</label>
            <input type='number' step='0.5' min='0' value={form.marks} dir='ltr'
              onChange={(e) => set('marks', e.target.value)}
              className={`w-full glass-input border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold ${errors.marks ? 'border-rose-500' : 'border-subtle'}`} />
            {errors.marks && <p className='text-rose-400 text-[11px] mt-1'>{errors.marks}</p>}
          </div>
        </div>

        {/* Question text */}
        <div>
          <label className='block text-sm text-fg-subtle mb-1'>{L('question_text', isArabic)}</label>
          <textarea value={form.question_text} onChange={(e) => set('question_text', e.target.value)} rows={3}
            className={`w-full glass-input border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold ${errors.question_text ? 'border-rose-500' : 'border-subtle'}`} />
          {errors.question_text && <p className='text-rose-400 text-[11px] mt-1'>{L('question_text_required', isArabic)}</p>}
        </div>

        {/* Image */}
        <div>
          <label className='block text-sm text-fg-subtle mb-1'>{L('image_optional', isArabic)}</label>
          <input type='file' accept='image/*' onChange={handleImageUpload}
            className='text-xs text-fg-subtle' />
          {form.image_url && (
            <div className='mt-2 flex items-center gap-2'>
              <img src={form.image_url} alt='q' className='w-20 h-20 object-cover rounded border border-subtle' />
              <button type='button' onClick={() => set('image_url', '')}
                className='text-rose-400 text-xs hover:text-rose-300'>✕ {L('remove_image', isArabic)}</button>
            </div>
          )}
        </div>

        {/* Choices for MCQ */}
        {form.type === 'mcq' && (
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('choices_label', isArabic)}</label>
            <div className='space-y-2'>
              {form.choices.map((c, idx) => (
                <div key={idx} className='flex items-center gap-2'>
                  <button type='button' onClick={() => set('correct_answer', { index: idx })}
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${form.correct_answer?.index === idx ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-subtle text-fg-subtle'}`}>
                    {String.fromCharCode(65 + idx)}
                  </button>
                  <input value={c} onChange={(e) => setChoice(idx, e.target.value)}
                    placeholder={`${L('type_mcq', isArabic)} ${String.fromCharCode(65 + idx)}`}
                    className='flex-1 glass-input border border-subtle rounded-lg px-3 py-1.5 text-sm outline-none focus:border-brand-gold' />
                  {form.choices.length > 2 && (
                    <button type='button' onClick={() => removeChoice(idx)} className='text-rose-400 text-sm'>✕</button>
                  )}
                </div>
              ))}
            </div>
            <button type='button' onClick={addChoice}
              className='text-xs text-brand-gold-hover hover:text-fg font-bold mt-2'>+ {L('add_choice', isArabic)}</button>
            {errors.choices && <p className='text-rose-400 text-[11px] mt-1'>{errors.choices}</p>}
          </div>
        )}

        {/* True/False correct */}
        {form.type === 'true_false' && (
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('correct_answer', isArabic)}</label>
            <div className='flex gap-2'>
              <button type='button' onClick={() => set('correct_answer', { value: true })}
                className={`px-4 py-2 rounded-lg text-sm font-bold ${form.correct_answer?.value === true ? 'bg-emerald-600 text-white' : 'glass-input text-fg-subtle'}`}>
                {L('true_label', isArabic)}
              </button>
              <button type='button' onClick={() => set('correct_answer', { value: false })}
                className={`px-4 py-2 rounded-lg text-sm font-bold ${form.correct_answer?.value === false ? 'bg-rose-600 text-white' : 'glass-input text-fg-subtle'}`}>
                {L('false_label', isArabic)}
              </button>
            </div>
          </div>
        )}

        {/* Short / Numerical answer */}
        {(form.type === 'short_answer' || form.type === 'numerical') && (
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('correct_answer', isArabic)}</label>
            <input value={form.correct_answer?.value ?? ''} dir='ltr'
              onChange={(e) => set('correct_answer', { value: form.type === 'numerical' ? Number(e.target.value) : e.target.value })}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
          </div>
        )}

        {/* Matching pairs */}
        {form.type === 'matching' && (
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{L('type_matching', isArabic)}</label>
            <textarea value={form.choices.join('\n')} onChange={(e) => set('choices', e.target.value.split('\n'))} rows={4}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
          </div>
        )}

        {/* Explanation */}
        <div>
          <label className='block text-sm text-fg-subtle mb-1'>{L('explanation', isArabic)}</label>
          <textarea value={form.explanation} onChange={(e) => set('explanation', e.target.value)} rows={2}
            className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
        </div>

        {/* Source ref */}
        <div>
          <label className='block text-sm text-fg-subtle mb-1'>{L('source_ref', isArabic)}</label>
          <input value={form.source_ref} onChange={(e) => set('source_ref', e.target.value)}
            className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
        </div>

        {/* Tags */}
        <div>
          <label className='block text-sm text-fg-subtle mb-1'>{L('tags', isArabic)}</label>
          <div className='flex gap-2 flex-wrap mb-2'>
            {form.tags.map((tg) => (
              <span key={tg} className='bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/30 px-2 py-1 rounded-full text-xs flex items-center gap-1'>
                {tg}
                <button type='button' onClick={() => removeTag(tg)} className='hover:text-rose-400'>✕</button>
              </span>
            ))}
          </div>
          <div className='flex gap-2'>
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              placeholder={L('add_tag_prompt', isArabic)}
              className='flex-1 glass-input border border-subtle rounded-lg px-3 py-1.5 text-sm outline-none focus:border-brand-gold' />
            <button type='button' onClick={addTag}
              className='text-xs bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/40 px-3 py-1.5 rounded-lg font-bold hover:bg-brand-gold/25'>
              {L('add_tag_btn', isArabic)}
            </button>
          </div>
        </div>

        {/* Favorite */}
        <label className='flex items-center gap-2 text-sm text-fg-muted cursor-pointer'>
          <input type='checkbox' checked={form.is_favorite} onChange={(e) => set('is_favorite', e.target.checked)}
            className='w-4 h-4 accent-amber-500' />
          {L('favorite', isArabic)}
        </label>

        {/* Actions */}
        <div className='flex gap-2 pt-2'>
          <button type='button' onClick={onClose}
            className='flex-1 glass-input font-bold py-3 rounded-xl text-sm text-fg-subtle hover:bg-white/10 transition-colors'>
            {L('cancel', isArabic)}
          </button>
          <button type='submit' disabled={saving}
            className='flex-1 btn-glow font-bold py-3 rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-opacity'>
            {saving ? '⏳' : '💾'} {L('save', isArabic)}
          </button>
        </div>
      </form>
    </Modal>
  )
}
