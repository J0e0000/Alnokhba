import { useEffect, useState, useRef } from 'react'
import Modal from './Modal'
import { sanitizePhone, isValidPhone, GRADES_BY_STAGE, formatWhatsAppPhone } from '../lib/helpers'

const FIRST_STAGE = Object.values(GRADES_BY_STAGE)[0][0]

export default function StudentModal({ open, onClose, onSave, student, groups, isSaving: externalSaving }) {
  const [form, setForm] = useState({ name: '', phone: '', stage: FIRST_STAGE, group: groups?.[0] || '' })
  const [errors, setErrors] = useState({})
  const [hasChanged, setHasChanged] = useState(false)
  const originalRef = useRef(null)
  const nameRef = useRef(null)

  useEffect(() => {
    if (student) {
      const f = { name: student.name || '', phone: student.phone || '', stage: student.stage || FIRST_STAGE, group: student.group_name || student.group || groups?.[0] || '' }
      setForm(f)
      originalRef.current = f
    } else {
      const f = { name: '', phone: '', stage: FIRST_STAGE, group: groups?.[0] || '' }
      setForm(f)
      originalRef.current = f
    }
    setErrors({})
    setHasChanged(false)
    // Focus name input when modal opens
    setTimeout(() => nameRef.current?.focus(), 100)
  }, [student, open, groups])

  const handleChange = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      if (originalRef.current) {
        setHasChanged(Object.keys(next).some((k) => next[k] !== originalRef.current[k]))
      } else {
        setHasChanged(Object.values(next).some((v) => v !== ''))
      }
      return next
    })
    // Clear error for this field
    if (errors[field]) setErrors((prev) => { const n = { ...prev }; delete n[field]; return n })
  }

  const validate = () => {
    const errs = {}
    if (!form.name.trim()) errs.name = 'مطلوب'
    if (form.phone && !isValidPhone(form.phone)) {
      errs.phone = 'رقم غير صحيح'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }


  const submit = (e) => {
    e.preventDefault()
    if (!validate()) return
    onSave({ ...form, phone: sanitizePhone(form.phone) })
  }

  const saving = externalSaving || false
  const canSave = hasChanged && !saving && Object.keys(errors).length === 0

  return (
    <Modal open={open} onClose={onClose} title={student ? 'تعديل بيانات الطالب' : 'إضافة طالب'}>
      <form onSubmit={submit} className='space-y-3'>
        <div>
          <label className='block text-sm text-fg-subtle mb-1'>اسم الطالب</label>
          <input
            ref={nameRef}
            required value={form.name} onChange={(e) => handleChange('name', e.target.value)}
            className={`w-full glass-input border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold ${errors.name ? 'border-rose-500' : 'border-subtle'}`}
          />
          {errors.name && <p className='text-rose-400 text-[11px] mt-1'>اسم الطالب مطلوب</p>}
        </div>
        <div>
          <label className='block text-sm text-fg-subtle mb-1'>رقم الهاتف (واتساب)</label>
          <input
            value={form.phone} onChange={(e) => handleChange('phone', e.target.value)} dir='ltr'
            placeholder='01xxxxxxxxx'
            className={`w-full glass-input border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold ${errors.phone ? 'border-rose-500' : 'border-subtle'}`}
          />
          {errors.phone && <p className='text-rose-400 text-[11px] mt-1'>رقم الهاتف غير صحيح أو يجب أن يكون رقمًا مصريًا من 11 رقمًا</p>}
          {form.phone && !errors.phone && <p className='text-emerald-400 text-[11px] mt-1' dir='ltr'>WhatsApp: {formatWhatsAppPhone(form.phone)}</p>}
        </div>

        <div className='grid grid-cols-2 gap-3'>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>المرحلة</label>
            <select
              value={form.stage} onChange={(e) => handleChange('stage', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold'
            >
              {Object.entries(GRADES_BY_STAGE).map(([category, grades]) => (
                <optgroup key={category} label={category}>
                  {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className='block text-sm text-fg-subtle mb-1'>المجموعة</label>
            <select
              value={form.group} onChange={(e) => handleChange('group', e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold'
            >
              {(groups || []).map((g) => <option key={g} value={g}>{g}</option>)}
              {!groups?.length && <option value=''>لا توجد مجموعات بعد</option>}
            </select>
          </div>
        </div>
        <div className='flex gap-2'>
          <button
            type='button'
            onClick={onClose}
            className='flex-1 glass-input font-bold py-3 rounded-xl text-sm text-fg-subtle hover:bg-white/10 transition-colors'
          >
            إلغاء
          </button>
          <button
            type='submit'
            disabled={!canSave}
            className='flex-1 btn-glow font-bold py-3 rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-opacity'
          >
            {saving ? '⏳ جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
