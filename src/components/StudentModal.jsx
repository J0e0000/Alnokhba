import { useEffect, useMemo, useState, useRef } from 'react'
import Modal from './Modal'
import { sanitizePhone, isValidPhone, GRADES_BY_STAGE, formatWhatsAppPhone, isStageCompatible } from '../lib/helpers'

const FIRST_STAGE = Object.values(GRADES_BY_STAGE)[0][0]

// ═══════════════════════════════════════════════════════════════════════════
// STUDENT MODAL — create/edit with stage↔group consistency (spec 1–3, 26):
//  • Stage is ALWAYS a controlled selector (never free text).
//  • Selecting a group INHERITS the group's stage (group is authoritative).
//  • Selecting a stage filters the group list to compatible groups only —
//    an invalid stage/group combination cannot be created.
//  • Legacy dirty stage values (bare category / free text) still render
//    instead of breaking the select; compatibility is CATEGORY-based.
// ═══════════════════════════════════════════════════════════════════════════
export default function StudentModal({ open, onClose, onSave, student, groups, groupMeta, isSaving: externalSaving }) {
  const [form, setForm] = useState({ name: '', phone: '', stage: FIRST_STAGE, group: groups?.[0] || '' })
  const [errors, setErrors] = useState({})
  const [hasChanged, setHasChanged] = useState(false)
  const [stageInherited, setStageInherited] = useState(false)
  const [stageClearedGroup, setStageClearedGroup] = useState(false)
  const originalRef = useRef(null)
  const nameRef = useRef(null)

  const meta = groupMeta || {}

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
    setStageInherited(false)
    setStageClearedGroup(false)
    // Focus name input when modal opens
    setTimeout(() => nameRef.current?.focus(), 100)
  }, [student, open, groups])

  // Groups compatible with the currently selected stage (empty group stage =
  // compatible — legacy groups without a stage never block creation).
  const compatibleGroups = useMemo(
    () => (groups || []).filter((g) => isStageCompatible(form.stage, meta[g]?.stage)),
    [groups, meta, form.stage],
  )

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

  // Stage changed by hand → drop an incompatible group BEFORE it can be saved,
  // and tell the teacher why (spec 2: prevent invalid combinations silently
  // blocking save; spec 3: only compatible groups listed).
  const handleStageChange = (value) => {
    setStageInherited(false)
    const groupStillCompatible = !form.group || isStageCompatible(value, meta[form.group]?.stage)
    if (!groupStillCompatible) {
      setStageClearedGroup(true)
      handleChange('group', '')
    } else {
      setStageClearedGroup(false)
    }
    handleChange('stage', value)
  }

  // Group chosen → stage is INHERITED from the group (authoritative context).
  const handleGroupChange = (groupName) => {
    if (!groupName) { handleChange('group', ''); return }
    const groupStage = meta[groupName]?.stage || ''
    if (groupStage && !isStageCompatible(form.stage, groupStage)) {
      setStageInherited(true)
      setStageClearedGroup(false)
      setForm((prev) => {
        const next = { ...prev, group: groupName, stage: groupStage }
        if (originalRef.current) setHasChanged(Object.keys(next).some((k) => next[k] !== originalRef.current[k]))
        else setHasChanged(Object.values(next).some((v) => v !== ''))
        return next
      })
      if (errors.stage) setErrors((prev) => { const n = { ...prev }; delete n.stage; return n })
      return
    }
    if (groupStage && groupStage !== form.stage) setStageInherited(true)
    handleChange('group', groupName)
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
  // A legacy stage value (bare "ثانوي", free text) isn't in the canonical
  // optgroups — render it as an extra option so the select never lies.
  const stageIsCanonical = Object.values(GRADES_BY_STAGE).flat().includes(form.stage)
  const legacyStageLabel = stageIsCanonical ? null : (form.stage || '')

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
              value={form.stage} onChange={(e) => handleStageChange(e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold'
            >
              {legacyStageLabel && <option value={form.stage}>{legacyStageLabel}</option>}
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
              value={form.group} onChange={(e) => handleGroupChange(e.target.value)}
              className='w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold'
            >
              <option value=''>بدون مجموعة</option>
              {compatibleGroups.map((g) => <option key={g} value={g}>{g}{meta[g]?.stage ? ` — ${meta[g].stage}` : ''}</option>)}
              {!compatibleGroups.length && <option value=''>لا توجد مجموعات متوافقة بعد</option>}
            </select>
          </div>
        </div>
        {stageInherited && (
          <p className='text-[11px] m-0' style={{ color: 'var(--info-strong)' }}>
            ⓘ تم تحديد المرحلة تلقائيًا من المجموعة — المجموعة هي المرجع لمرحلة الطالب.
          </p>
        )}
        {stageClearedGroup && (
          <p className='text-[11px] m-0' style={{ color: 'var(--warn-strong)' }}>
            ⚠ المجموعة السابقة لا تطابق المرحلة المختارة — تم فصل الطالب عنها؛ اختر مجموعة متوافقة.
          </p>
        )}
        {student && student.group_name && form.group === student.group_name && !isStageCompatible(form.stage, meta[form.group]?.stage) && (
          <p className='text-[11px] m-0' style={{ color: 'var(--warn-strong)' }}>
            ⚠ بيانات قديمة: مرحلة الطالب ({form.stage}) لا تطابق مرحلة مجموعته ({meta[form.group]?.stage || 'غير محددة'}).
          </p>
        )}
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
