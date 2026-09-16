import { useState, useEffect } from 'react'
import Modal from '../Modal'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import { listBuiltinTemplates, getTemplateDesign, DEFAULT_TEMPLATE_KEY } from '../../lib/qbTemplates'
import { listTemplates, saveTemplate, deleteTemplate } from '../../lib/qbStore'
import { L, humanizeError } from '../../lib/qbLabels'

const PAGE_SIZES = [
  { value: 'a4', label: 'A4' },
  { value: 'a5', label: 'A5' },
  { value: 'letter', label: 'Letter' },
  { value: 'legal', label: 'Legal' },
]

const LANGUAGES = [
  { value: 'auto', labelKey: 'lang_auto' },
  { value: 'ar', labelKey: 'lang_arabic' },
  { value: 'en', labelKey: 'lang_english' },
]

export default function ExamDesignerModal({ open, onClose, supabase, teacherId, design, setDesign }) {
  const { showToast } = useToast()
  const { isArabic } = useLanguage()
  const [savedTemplates, setSavedTemplates] = useState([])
  const [newTplName, setNewTplName] = useState('')

  const loadTemplates = async () => {
    if (!supabase || !teacherId) return
    try {
      const data = await listTemplates(supabase, teacherId)
      setSavedTemplates(data)
    } catch (err) { console.error(err) }
  }

  useEffect(() => { if (open) loadTemplates() }, [open, supabase, teacherId])

  useEffect(() => {
    if (open && (!design || Object.keys(design).length === 0)) {
      setDesign(getTemplateDesign(DEFAULT_TEMPLATE_KEY))
    }
  }, [open])

  const set = (key, value) => {
    setDesign({ ...(design || {}), [key]: value })
  }

  const applyBuiltin = (key) => {
    setDesign(getTemplateDesign(key))
    showToast(L('template_applied', isArabic), 'success')
  }

  const applySaved = (tpl) => {
    setDesign(tpl.design || {})
    showToast(L('template_applied', isArabic), 'success')
  }

  const handleSaveTemplate = async () => {
    const name = newTplName.trim()
    if (!name) { showToast(L('template_name', isArabic), 'error'); return }
    try {
      await saveTemplate(supabase, teacherId, name, design)
      setNewTplName('')
      loadTemplates()
      showToast(L('template_saved', isArabic), 'success')
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    }
  }

  const handleDeleteTemplate = async (id) => {
    try {
      await deleteTemplate(supabase, id)
      loadTemplates()
    } catch (err) {
      showToast(L('template_delete_failed', isArabic), 'error')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`🎨 ${L('exam_designer', isArabic)}`} wide>
      <div className='space-y-3'>
        {/* Built-in templates */}
        <div>
          <p className='text-xs text-fg-subtle mb-1.5 font-bold'>{L('builtin_templates', isArabic)}</p>
          <div className='flex gap-2 flex-wrap'>
            {listBuiltinTemplates(isArabic).map((tpl) => (
              <button key={tpl.key} onClick={() => applyBuiltin(tpl.key)}
                className='text-xs glass-input border border-subtle rounded-lg px-3 py-1.5 text-fg-subtle hover:border-brand-gold transition-colors'>
                {tpl.name}
              </button>
            ))}
          </div>
        </div>

        {/* Saved templates */}
        {savedTemplates.length > 0 && (
          <div>
            <p className='text-xs text-fg-subtle mb-1.5 font-bold'>{L('your_templates', isArabic)}</p>
            <div className='flex gap-2 flex-wrap'>
              {savedTemplates.map((tpl) => (
                <div key={tpl.id} className='flex items-center gap-1'>
                  <button onClick={() => applySaved(tpl)}
                    className='text-xs bg-brand-gold/10 text-brand-gold-hover border border-brand-gold/40 rounded-lg px-3 py-1.5 hover:bg-brand-gold/20'>
                    {tpl.name}
                  </button>
                  <button onClick={() => handleDeleteTemplate(tpl.id)}
                    className='text-rose-400 hover:text-rose-300 text-xs px-1'>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Save current as template */}
        <div className='flex gap-2 items-center'>
          <input value={newTplName} onChange={(e) => setNewTplName(e.target.value)}
            placeholder={L('template_name', isArabic)}
            className='flex-1 glass-input border border-subtle rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-gold' />
          <button onClick={handleSaveTemplate}
            className='text-xs bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/40 px-3 py-1.5 rounded-lg font-bold hover:bg-brand-gold/25'>
            {L('save_current_template', isArabic)}
          </button>
        </div>

        <hr className='border-subtle' />

        {/* Language selector — NEW */}
        <div>
          <label className='block text-[11px] text-fg-subtle mb-1'>{L('language_label', isArabic)}</label>
          <select value={design?.language || 'auto'} onChange={(e) => set('language', e.target.value)}
            className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold'>
            {LANGUAGES.map((lng) => (
              <option key={lng.value} value={lng.value}>{L(lng.labelKey, isArabic)}</option>
            ))}
          </select>
          <p className='text-[10px] text-fg-subtle mt-1'>
            {isArabic
              ? 'تلقائي = يكتشف لغة كل نص على حدة. استخدم العربية أو English لفرض اتجاه واحد.'
              : 'Auto = detect each text independently. Use Arabic or English to force one direction.'}
          </p>
        </div>

        {/* Page setup */}
        <div className='grid grid-cols-2 sm:grid-cols-3 gap-2'>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('page_size', isArabic)}</label>
            <select value={design?.page_size || 'a4'} onChange={(e) => set('page_size', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold'>
              {PAGE_SIZES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('orientation', isArabic)}</label>
            <select value={design?.orientation || 'portrait'} onChange={(e) => set('orientation', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold'>
              <option value='portrait'>{L('portrait', isArabic)}</option>
              <option value='landscape'>{L('landscape', isArabic)}</option>
            </select>
          </div>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('margin_mm', isArabic)}</label>
            <input type='number' min='5' max='40' value={design?.margin_mm ?? 18} dir='ltr'
              onChange={(e) => set('margin_mm', Number(e.target.value))}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold' />
          </div>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('font_size', isArabic)}</label>
            <input type='number' min='8' max='18' value={design?.base_font_size ?? 12} dir='ltr'
              onChange={(e) => set('base_font_size', Number(e.target.value))}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold' />
          </div>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('q_spacing', isArabic)}</label>
            <input type='number' min='2' max='20' value={design?.question_spacing_mm ?? 8} dir='ltr'
              onChange={(e) => set('question_spacing_mm', Number(e.target.value))}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold' />
          </div>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('line_spacing', isArabic)}</label>
            <input type='number' min='3' max='12' value={design?.line_spacing_mm ?? 6} dir='ltr'
              onChange={(e) => set('line_spacing_mm', Number(e.target.value))}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold' />
          </div>
        </div>

        {/* Numbering */}
        <div className='grid grid-cols-2 gap-2'>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('question_numbering', isArabic)}</label>
            <select value={design?.question_numbering || '1,2,3...'} onChange={(e) => set('question_numbering', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold'>
              <option value='1,2,3...'>1, 2, 3...</option>
              <option value='circle'>(1), (2), (3)</option>
            </select>
          </div>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('section_numbering', isArabic)}</label>
            <select value={design?.section_numbering || 'roman'} onChange={(e) => set('section_numbering', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold'>
              <option value='roman'>I, II, III</option>
              <option value='alpha'>A, B, C</option>
              <option value='numeric'>1, 2, 3</option>
            </select>
          </div>
        </div>

        {/* Choices + columns */}
        <div className='grid grid-cols-2 gap-2'>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('choice_layout', isArabic)}</label>
            <select value={design?.choice_layout || 'vertical'} onChange={(e) => set('choice_layout', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold'>
              <option value='vertical'>{L('vertical', isArabic)}</option>
              <option value='horizontal_2col'>{L('horizontal_2col', isArabic)}</option>
            </select>
          </div>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('columns', isArabic)}</label>
            <input type='number' min='1' max='3' value={design?.columns ?? 1} dir='ltr'
              onChange={(e) => set('columns', Number(e.target.value))}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold' />
          </div>
        </div>

        {/* Colors */}
        <div className='grid grid-cols-2 sm:grid-cols-3 gap-2'>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('header_bg', isArabic)}</label>
            <input type='color' value={design?.header_bg || '#001f43'}
              onChange={(e) => set('header_bg', e.target.value)}
              className='w-full h-8 bg-transparent border border-subtle rounded cursor-pointer' />
          </div>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('header_fg', isArabic)}</label>
            <input type='color' value={design?.header_fg || '#FFD700'}
              onChange={(e) => set('header_fg', e.target.value)}
              className='w-full h-8 bg-transparent border border-subtle rounded cursor-pointer' />
          </div>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('section_bg', isArabic)}</label>
            <input type='color' value={design?.section_bg || '#FFD700'}
              onChange={(e) => set('section_bg', e.target.value)}
              className='w-full h-8 bg-transparent border border-subtle rounded cursor-pointer' />
          </div>
        </div>

        {/* Watermark */}
        <div className='grid grid-cols-2 gap-2'>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('watermark_text', isArabic)}</label>
            <input value={design?.watermark_text || ''} onChange={(e) => set('watermark_text', e.target.value)}
              placeholder={isArabic ? 'اختياري' : 'optional'}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold' />
          </div>
          <div>
            <label className='block text-[11px] text-fg-subtle mb-1'>{L('watermark_opacity', isArabic)}</label>
            <input type='number' step='0.01' min='0' max='0.3' value={design?.watermark_opacity ?? 0.06} dir='ltr'
              onChange={(e) => set('watermark_opacity', Number(e.target.value))}
              className='w-full glass-input border border-subtle rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand-gold' />
          </div>
        </div>

        {/* Toggles */}
        <div className='flex flex-wrap gap-3'>
          <label className='flex items-center gap-2 text-xs text-fg-muted cursor-pointer'>
            <input type='checkbox' checked={design?.show_borders ?? true}
              onChange={(e) => set('show_borders', e.target.checked)}
              className='w-4 h-4 accent-amber-500' />
            {L('show_borders', isArabic)}
          </label>
          <label className='flex items-center gap-2 text-xs text-fg-muted cursor-pointer'>
            <input type='checkbox' checked={design?.show_logo ?? true}
              onChange={(e) => set('show_logo', e.target.checked)}
              className='w-4 h-4 accent-amber-500' />
            {L('show_logo', isArabic)}
          </label>
        </div>

        <div className='flex gap-2 pt-2'>
          <button onClick={onClose}
            className='flex-1 btn-glow font-bold py-2.5 rounded-lg text-sm'>
            {L('done', isArabic)}
          </button>
        </div>
      </div>
    </Modal>
  )
}
