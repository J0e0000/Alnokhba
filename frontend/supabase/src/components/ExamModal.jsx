import { useState, useRef, useEffect, useMemo } from 'react'
import Modal from './Modal'
import { useLanguage } from '../context/LanguageContext'

const DEFAULT_TEMPLATES_KEY = 'exam_templates_custom'

function loadCustomTemplates() {
  try { return JSON.parse(localStorage.getItem(DEFAULT_TEMPLATES_KEY) || '[]') } catch { return [] }
}

function saveCustomTemplates(templates) {
  localStorage.setItem(DEFAULT_TEMPLATES_KEY, JSON.stringify(templates))
}

const BUILTIN = {
  'شامل': { title: 'امتحان شامل', sections: 'نحو, نصوص, أدب, بلاغة, قراءة', max: 10 },
  'قراءة': { title: 'تطبيق قراءة', sections: 'قراءة, قصة', max: 15 },
  'تسميع': { title: 'تسميع سريع', sections: 'تسميع, بلاغة', max: 5 },
}

export default function ExamModal({ open, onClose, students, groups = [], onSave, isSaving: externalSaving }) {
  const { isArabic, t } = useLanguage()
  const [phase, setPhase] = useState('setup')
  const [title, setTitle] = useState('')
  const [sectionsStr, setSectionsStr] = useState('')
  const [maxScore, setMaxScore] = useState('')
  const [sections, setSections] = useState([])
  const [scores, setScores] = useState({})
  const [selectedGroups, setSelectedGroups] = useState([])
  const [errors, setErrors] = useState({})
  const [customTemplates, setCustomTemplates] = useState(loadCustomTemplates)
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [newTplName, setNewTplName] = useState('')
  const inputRefs = useRef({})
  const saving = externalSaving || false

  useEffect(() => { if (open) { setPhase('setup'); setTitle(''); setSectionsStr(''); setMaxScore(''); setSections([]); setScores({}); setSelectedGroups([]); setErrors({}); setShowNewTemplate(false); setNewTplName('') } }, [open])

  const examStudents = useMemo(() => selectedGroups.length > 0 ? students.filter((s) => selectedGroups.includes(s.group_name)) : [], [students, selectedGroups])
  const toggleGroup = (group) => setSelectedGroups((prev) => prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group])

  const focusCell = (row, col) => { const el = inputRefs.current[`${row}-${col}`]; if (el) el.focus() }
  const handleKeyDown = (e, row, col) => { if (e.key !== 'Enter') return; e.preventDefault(); if (col + 1 < sections.length) focusCell(row, col + 1); else if (row + 1 < examStudents.length) focusCell(row + 1, 0) }

  const applyTemplate = (tpl) => {
    setTitle(tpl.title); setSectionsStr(tpl.sections); setMaxScore(String(tpl.max))
  }

  const addCustomTemplate = () => {
    const name = newTplName.trim()
    const secs = sectionsStr.trim()
    const mx = maxScore.trim()
    if (!name || !secs || !mx) return
    const newTpl = { title: title.trim() || name, sections: secs, max: parseFloat(mx) || 10 }
    const updated = [...customTemplates, { name, ...newTpl }]
    setCustomTemplates(updated)
    saveCustomTemplates(updated)
    setShowNewTemplate(false)
    setNewTplName('')
  }

  const deleteCustomTemplate = (idx) => {
    const updated = customTemplates.filter((_, i) => i !== idx)
    setCustomTemplates(updated)
    saveCustomTemplates(updated)
  }

  const startGrading = () => {
    const errs = {}
    if (selectedGroups.length === 0) errs.groups = 'مطلوب'
    if (!title.trim()) errs.title = 'مطلوب'
    const secs = sectionsStr.split(',').map((s) => s.trim()).filter(Boolean)
    if (secs.length === 0) errs.sections = 'مطلوب'
    if (!maxScore || isNaN(parseFloat(maxScore)) || parseFloat(maxScore) <= 0) errs.max = 'مطلوب'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSections(secs)
    const initial = {}
    examStudents.forEach((s) => { initial[s.id] = Object.fromEntries(secs.map((sec) => [sec, ''])) })
    setScores(initial)
    setPhase('grading')
  }

  const rowTotal = (studentId) => Object.values(scores[studentId] || {}).reduce((sum, v) => sum + (parseFloat(v) || 0), 0)
  const setScore = (studentId, section, value) => { setScores((prev) => ({ ...prev, [studentId]: { ...prev[studentId], [section]: value } })) }

  const allScoresFilled = examStudents.length > 0 && examStudents.every((s) => sections.every((sec) => scores[s.id]?.[sec] !== '' && scores[s.id]?.[sec] !== undefined))

  const save = () => {
    if (saving) return
    const max = parseFloat(maxScore)
    const records = examStudents.map((s) => {
      const sectionScores = {}; let total = 0
      sections.forEach((sec) => { const v = parseFloat(scores[s.id]?.[sec]) || 0; sectionScores[sec] = v; total += v })
      return { studentId: s.id, sectionScores, total }
    })
    onSave({ title: title.trim(), sections, maxScorePerSection: max, records, groupNames: selectedGroups })
  }

  const handleClose = () => { onClose() }

  return (
    <Modal open={open} onClose={handleClose} title={isArabic ? 'رصد امتحان' : 'Record Exam'} wide>
      {phase === 'setup' ? (
        <div className='space-y-3'>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{isArabic ? 'المجموعات التي سيُرصد لها الامتحان' : 'Groups for this exam'}</label>
            <div className='grid grid-cols-2 gap-2 max-h-32 overflow-y-auto'>
              {groups.map((group) => <label key={group} className='flex items-center gap-2 glass-card rounded-lg px-2 py-2 text-xs cursor-pointer text-fg'><input type='checkbox' checked={selectedGroups.includes(group)} onChange={() => toggleGroup(group)} className='accent-[#D4A373]' />{group}</label>)}
            </div>
            {groups.length === 0 && <p className='text-rose-400 text-[11px] mt-1'>{isArabic ? 'أضف مجموعة أولاً' : 'Add a group first'}</p>}
            {errors.groups && <p className='text-rose-400 text-[11px] mt-1'>{isArabic ? 'اختر مجموعة واحدة على الأقل' : 'Choose at least one group'}</p>}
            {selectedGroups.length > 0 && <p className='text-fg-subtle text-[11px] mt-1'>{isArabic ? `سيتم رصد ${examStudents.length} طالب` : `${examStudents.length} students selected`}</p>}
          </div>

          {/* Built-in templates */}
          <div>
            <p className='text-xs text-fg-subtle mb-1.5 font-bold'>{isArabic ? 'قوالب جاهزة:' : 'Built-in Templates:'}</p>
            <div className='flex gap-2 flex-wrap'>
              {Object.keys(BUILTIN).map((k) => (
                <button key={k} type='button' onClick={() => applyTemplate(BUILTIN[k])}
                  className='text-xs glass-input border border-subtle rounded-lg px-3 py-1.5 text-fg-subtle hover:border-brand-gold transition-colors'>
                  {k}
                </button>
              ))}
            </div>
          </div>

          {/* Custom templates */}
          {customTemplates.length > 0 && (
            <div>
              <p className='text-xs text-fg-subtle mb-1.5 font-bold'>{isArabic ? 'قوالبك الخاصة:' : 'Your Templates:'}</p>
              <div className='flex gap-2 flex-wrap'>
                {customTemplates.map((tpl, idx) => (
                  <div key={idx} className='flex items-center gap-1'>
                    <button type='button' onClick={() => applyTemplate(tpl)}
                      className='text-xs bg-brand-gold/10 text-brand-gold-hover border border-brand-gold/40 rounded-lg px-3 py-1.5 hover:bg-brand-gold/20 transition-colors'>
                      {tpl.name}
                    </button>
                    <button type='button' onClick={() => deleteCustomTemplate(idx)}
                      className='text-rose-400 hover:text-rose-300 text-xs px-1'>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save as template */}
          {!showNewTemplate ? (
            <button type='button' onClick={() => setShowNewTemplate(true)}
              className='text-xs text-brand-gold-hover hover:text-fg font-bold border border-brand-gold/30 rounded-lg px-3 py-1.5 hover:bg-brand-gold/10 transition-colors'>
              + {isArabic ? 'حفظ القالب الحالي' : 'Save Current as Template'}
            </button>
          ) : (
            <div className='flex gap-2 items-center'>
              <input value={newTplName} onChange={(e) => setNewTplName(e.target.value)}
                placeholder={isArabic ? 'اسم القالب' : 'Template name'}
                className='flex-1 glass-input border border-subtle rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-gold' />
              <button type='button' onClick={addCustomTemplate}
                className='text-xs bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/40 px-3 py-1.5 rounded-lg font-bold hover:bg-brand-gold/25 transition-colors'>
                {isArabic ? 'حفظ' : 'Save'}
              </button>
              <button type='button' onClick={() => setShowNewTemplate(false)}
                className='text-xs text-fg-subtle glass-input border border-subtle px-2 py-1.5 rounded-lg hover:bg-white/10'>
                ✕
              </button>
            </div>
          )}

          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{isArabic ? 'عنوان الامتحان' : 'Exam Title'}</label>
            <input value={title} onChange={(e) => { setTitle(e.target.value); if (errors.title) setErrors((p) => { const n = {...p}; delete n.title; return n }) }}
              className={`w-full glass-input border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold ${errors.title ? 'border-rose-500' : 'border-subtle'}`} />
            {errors.title && <p className='text-rose-400 text-[11px] mt-1'>{isArabic ? 'عنوان الامتحان مطلوب' : 'Exam title is required'}</p>}
          </div>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{isArabic ? 'الأقسام (افصل بفاصلة)' : 'Sections (comma-separated)'}</label>
            <input value={sectionsStr} onChange={(e) => { setSectionsStr(e.target.value); if (errors.sections) setErrors((p) => { const n = {...p}; delete n.sections; return n }) }}
              className={`w-full glass-input border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold ${errors.sections ? 'border-rose-500' : 'border-subtle'}`} />
            {errors.sections && <p className='text-rose-400 text-[11px] mt-1'>{isArabic ? 'أضف قسم واحد على الأقل' : 'Add at least one section'}</p>}
          </div>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>{isArabic ? 'الدرجة العظمى لكل قسم' : 'Max Score Per Section'}</label>
            <input type='number' value={maxScore} onChange={(e) => { setMaxScore(e.target.value); if (errors.max) setErrors((p) => { const n = {...p}; delete n.max; return n }) }} dir='ltr'
              className={`w-full glass-input border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold ${errors.max ? 'border-rose-500' : 'border-subtle'}`} />
            {errors.max && <p className='text-rose-400 text-[11px] mt-1'>{isArabic ? 'أدخل درجة عظمى صحيحة' : 'Enter a valid max score'}</p>}
          </div>
          <button onClick={startGrading} className='w-full btn-glow font-bold py-3 rounded-xl text-sm'>
            {isArabic ? 'بدء الرصد' : 'Start Grading'}
          </button>
        </div>
      ) : (
        <div>
          <div className='overflow-x-auto max-h-[60vh]'>
            <table className='w-full text-sm'>
              <thead className='sticky top-0 bg-[var(--surface)] backdrop-blur'>
                <tr className='border-b border-subtle text-fg-subtle'>
                  <th className='p-2 text-right'>{isArabic ? 'الطالب' : 'Student'}</th>
                  {sections.map((sec) => <th key={sec} className='p-2 text-center'>{sec} ({maxScore})</th>)}
                  <th className='p-2 text-center'>{isArabic ? 'المجموع' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>
                {examStudents.map((s, rowIdx) => (
                  <tr key={s.id} className='border-b border-subtle'>
                    <td className='p-2 font-bold text-fg'>{s.name}</td>
                    {sections.map((sec, colIdx) => (
                      <td key={sec} className='p-1'>
                        <input
                          ref={(el) => { inputRefs.current[`${rowIdx}-${colIdx}`] = el }}
                          type='number' step='0.5' min='0' max={maxScore} dir='ltr'
                          value={scores[s.id]?.[sec] ?? ''}
                          onChange={(e) => setScore(s.id, sec, e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, rowIdx, colIdx)}
                          className='w-20 text-center glass-input border border-subtle rounded p-1.5 text-sm outline-none focus:border-brand-gold'
                        />
                      </td>
                    ))}
                    <td className='p-2 text-center font-black text-violet-400'>{rowTotal(s.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className='flex gap-2 mt-4'>
            <button onClick={() => setPhase('setup')} className='flex-1 glass-input font-bold py-2.5 rounded-lg text-sm text-fg-subtle hover:bg-white/10 transition-colors'>
              {isArabic ? 'رجوع' : 'Back'}
            </button>
            <button onClick={save} disabled={saving || !allScoresFilled}
              className='flex-1 bg-emerald-600 hover:bg-emerald-500 text-fg font-bold py-2.5 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-opacity'>
              {saving ? (isArabic ? '⏳ جاري الحفظ...' : '⏳ Saving...') : (isArabic ? '💾 حفظ الدرجات وتحديث النقاط' : '💾 Save Grades & Update Points')}
            </button>
          </div>
          {!allScoresFilled && (
            <p className='text-amber-400 text-[11px] text-center mt-2'>{isArabic ? 'املأ كل الدرجات عشان تقدر تحفظ' : 'Fill all grades to save'}</p>
          )}
        </div>
      )}
    </Modal>
  )
}
