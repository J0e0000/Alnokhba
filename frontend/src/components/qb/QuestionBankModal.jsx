import { useEffect, useState, useCallback } from 'react'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import { SkeletonList } from '../Skeleton'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import {
  listQuestions, deleteQuestion, duplicateQuestion, toggleFavorite, getQuestionTags,
} from '../../lib/qbStore'
import { L, humanizeError } from '../../lib/qbLabels'

const TYPE_LABEL_KEYS = {
  mcq: 'type_mcq',
  true_false: 'type_true_false',
  short_answer: 'type_short_answer',
  essay: 'type_essay',
  numerical: 'type_numerical',
  matching: 'type_matching',
  custom: 'type_custom',
}

const DIFF_LABEL_KEYS = {
  easy: 'diff_easy',
  medium: 'diff_medium',
  hard: 'diff_hard',
}

const DIFF_COLORS = {
  easy: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  hard: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
}

export default function QuestionBankModal({ open, onClose, supabase, teacherId, onEdit, onAddNew, onImport, onPickForExam, refreshKey }) {
  const { showToast } = useToast()
  const { isArabic } = useLanguage()
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ subject: '', grade: '', difficulty: '', type: '', favorite_only: false })
  const [confirmId, setConfirmId] = useState(null)
  const [tagMap, setTagMap] = useState({})

  const load = useCallback(async () => {
    if (!supabase || !teacherId) return
    setLoading(true)
    try {
      const data = await listQuestions(supabase, teacherId, { ...filters, search })
      setQuestions(data)
      const tagEntries = await Promise.all(
        data.map(async (q) => {
          try {
            const tags = await getQuestionTags(supabase, q.id)
            return [q.id, tags.map((tg) => tg.name)]
          } catch {
            return [q.id, []]
          }
        })
      )
      setTagMap(Object.fromEntries(tagEntries))
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    } finally {
      setLoading(false)
    }
  }, [supabase, teacherId, filters, search, isArabic, showToast])

  useEffect(() => { if (open) load() }, [open, load, refreshKey])

  const handleDelete = async () => {
    try {
      await deleteQuestion(supabase, confirmId)
      showToast(L('deleted_success', isArabic), 'success')
      setConfirmId(null)
      load()
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    }
  }

  const handleDuplicate = async (q) => {
    try {
      await duplicateQuestion(supabase, q.id)
      showToast(L('duplicated_success', isArabic), 'success')
      load()
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    }
  }

  const handleFav = async (q) => {
    try {
      await toggleFavorite(supabase, q.id, q.is_favorite)
      load()
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    }
  }

  const subjects = [...new Set(questions.map((q) => q.subject).filter(Boolean))]
  const grades = [...new Set(questions.map((q) => q.grade).filter(Boolean))]

  return (
    <Modal open={open} onClose={onClose} title={`📚 ${L('question_bank', isArabic)}`} wide>
      {/* Toolbar */}
      <div className='flex flex-wrap gap-2 mb-3'>
        <button onClick={onAddNew}
          className='text-xs btn-glow font-bold px-3 py-2 rounded-lg'>
          + {L('new_question', isArabic)}
        </button>
        <button onClick={onImport}
          className='text-xs bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/40 px-3 py-2 rounded-lg font-bold hover:bg-brand-gold/25'>
          ⬆️ {L('import_questions', isArabic)}
        </button>
      </div>

      {/* Search + filters */}
      <div className='grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3'>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={L('search_placeholder', isArabic)}
          className='glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold' />
        <select value={filters.difficulty} onChange={(e) => setFilters({ ...filters, difficulty: e.target.value })}
          className='glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none'>
          <option value=''>{L('all_difficulties', isArabic)}</option>
          <option value='easy'>{L('diff_easy', isArabic)}</option>
          <option value='medium'>{L('diff_medium', isArabic)}</option>
          <option value='hard'>{L('diff_hard', isArabic)}</option>
        </select>
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          className='glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none'>
          <option value=''>{L('all_types', isArabic)}</option>
          {Object.entries(TYPE_LABEL_KEYS).map(([k, lblKey]) => <option key={k} value={k}>{L(lblKey, isArabic)}</option>)}
        </select>
        <select value={filters.subject} onChange={(e) => setFilters({ ...filters, subject: e.target.value })}
          className='glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none'>
          <option value=''>{L('all_subjects', isArabic)}</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.grade} onChange={(e) => setFilters({ ...filters, grade: e.target.value })}
          className='glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none'>
          <option value=''>{L('all_grades', isArabic)}</option>
          {grades.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <label className='flex items-center gap-2 text-xs text-fg-muted cursor-pointer px-2'>
          <input type='checkbox' checked={filters.favorite_only}
            onChange={(e) => setFilters({ ...filters, favorite_only: e.target.checked })}
            className='w-4 h-4 accent-amber-500' />
          {L('favorites_only', isArabic)}
        </label>
      </div>

      {/* List */}
      {loading ? (
        <SkeletonList rows={5} />
      ) : questions.length === 0 ? (
        <div className='text-center py-10'>
          <div className='text-3xl mb-2'>📚</div>
          <p className='text-fg-subtle text-sm'>{L('no_questions_yet', isArabic)}</p>
        </div>
      ) : (
        <div className='space-y-2 max-h-[55vh] overflow-y-auto pl-1'>
          {questions.map((q) => (
            <div key={q.id} className='glass-input border border-subtle rounded-lg p-3 hover:border-brand-gold/40 transition-colors'>
              <div className='flex items-start justify-between gap-2'>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2 flex-wrap mb-1'>
                    <span className='text-[10px] font-bold px-1.5 py-0.5 rounded border bg-brand-gold/10 text-brand-gold-hover border-brand-gold/30'>
                      {L(TYPE_LABEL_KEYS[q.type] || 'type_custom', isArabic)}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${DIFF_COLORS[q.difficulty] || ''}`}>
                      {L(DIFF_LABEL_KEYS[q.difficulty] || 'diff_medium', isArabic)}
                    </span>
                    <span className='text-[10px] text-fg-subtle'>{q.marks} {L('marks_label', isArabic)}</span>
                    {q.subject && <span className='text-[10px] text-fg-subtle'>· {q.subject}</span>}
                    {q.grade && <span className='text-[10px] text-fg-subtle'>· {q.grade}</span>}
                    {q.usage_count > 0 && <span className='text-[10px] text-fg-subtle'>· {L('used_times', isArabic)} {q.usage_count}×</span>}
                  </div>
                  <p className='text-sm text-fg font-semibold line-clamp-2'>{q.question_text}</p>
                  {(tagMap[q.id] || []).length > 0 && (
                    <div className='flex gap-1 flex-wrap mt-1.5'>
                      {(tagMap[q.id] || []).map((tg) => (
                        <span key={tg} className='text-[10px] bg-white/5 text-fg-subtle px-1.5 py-0.5 rounded'>#{tg}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className='flex flex-col gap-1 shrink-0'>
                  <button onClick={() => handleFav(q)} title={L('favorite', isArabic)}
                    className={`text-sm ${q.is_favorite ? 'text-amber-400' : 'text-fg-subtle hover:text-amber-400'}`}>
                    {q.is_favorite ? '★' : '☆'}
                  </button>
                  {onPickForExam && (
                    <button onClick={() => onPickForExam(q)} title={L('add_to_exam', isArabic)}
                      className='text-emerald-400 hover:text-emerald-300 text-sm'>＋</button>
                  )}
                </div>
              </div>
              <div className='flex gap-2 mt-2 pt-2 border-t border-subtle'>
                <button onClick={() => onEdit(q)}
                  className='text-[11px] text-brand-gold-hover hover:text-fg font-bold'>✏️ {L('edit', isArabic)}</button>
                <button onClick={() => handleDuplicate(q)}
                  className='text-[11px] text-fg-subtle hover:text-fg'>⧉ {L('duplicate', isArabic)}</button>
                <button onClick={() => setConfirmId(q.id)}
                  className='text-[11px] text-rose-400 hover:text-rose-300 mr-auto'>🗑️ {L('delete', isArabic)}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className='mt-3 text-xs text-fg-subtle text-center'>
        {questions.length} {L('question_count', isArabic)}
      </div>

      <ConfirmDialog
        open={!!confirmId}
        title={L('confirm_delete_question_title', isArabic)}
        danger
        confirmLabel={L('delete_permanent', isArabic)}
        message={L('confirm_delete_question_msg', isArabic)}
        onConfirm={handleDelete}
        onCancel={() => setConfirmId(null)}
      />
    </Modal>
  )
}
