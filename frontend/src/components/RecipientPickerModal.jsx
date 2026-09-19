import { useMemo, useState } from 'react'
import Modal from './Modal'
import { normalizeArabicSearch } from '../store/WorkspaceStore'

// ═══════════════════════════════════════════════════════════════════════════
// RECIPIENT PICKER (spec 10–11, 14–15, 34) — WHO receives this batch.
//
// Every queue producer (absence reports, present reports, all students,
// QR links, welcome) routes through here BEFORE ui.startQueue, so the
// teacher always confirms the recipient list and can change it — the system
// only SUGGESTS the contextually right default (preselection), it never
// sends blindly. Nothing is sent until the teacher presses the primary
// button (spec 6: ready ≠ sent).
//
// candidates: [{ key, student, phone, message, qrUrl?, template?, lessonId?,
//                statusLabel?, statusType? 'present'|'absent'|'none',
//                disabled? (no valid phone) }]
// ═══════════════════════════════════════════════════════════════════════════
export default function RecipientPickerModal({ open, onClose, candidates = [], preselected, title, subtitle, onStart }) {
  const [selected, setSelected] = useState(() => {
    const init = new Set()
    for (const c of candidates) {
      if (c.disabled) continue
      if (typeof preselected === 'function' ? preselected(c) : (preselected ?? true)) init.add(c.key)
    }
    return init
  })
  const [scope, setScope] = useState('all') // all | present | absent | hasphone
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const q = normalizeArabicSearch(search)
    return candidates.filter((c) => {
      if (scope === 'present' && c.statusType !== 'present') return false
      if (scope === 'absent' && c.statusType !== 'absent') return false
      if (scope === 'hasphone' && c.disabled) return false
      if (q && !normalizeArabicSearch([c.student?.name, c.student?.code, c.phone].filter(Boolean).join(' ')).includes(q)) return false
      return true
    })
  }, [candidates, scope, search])

  const eligibleCount = candidates.filter((c) => !c.disabled).length
  const selectedCount = [...selected].filter((k) => candidates.some((c) => c.key === k && !c.disabled)).length

  const toggle = (key) => setSelected((prev) => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  const setScopeAndSelect = (key) => {
    setScope(key)
    const next = new Set()
    for (const c of candidates) {
      if (c.disabled) continue
      const inScope = key === 'all'
        || (key === 'hasphone' && !c.disabled)
        || (key === 'present' && c.statusType === 'present')
        || (key === 'absent' && c.statusType === 'absent')
      if (inScope) next.add(c.key)
    }
    setSelected(next)
  }

  const start = () => {
    // Strip the picker-only display fields before queueing; the queue item
    // shape stays exactly what MessageQueueModal expects.
    const items = candidates
      .filter((c) => selected.has(c.key) && !c.disabled)
      .map((c) => ({
        student: c.student, phone: c.phone, message: c.message,
        qrUrl: c.qrUrl, template: c.template, lessonId: c.lessonId,
      }))
    if (!items.length) return
    onStart(items)
  }

  const chip = (key, label, count) => (
    <button
      key={key}
      onClick={() => setScopeAndSelect(key)}
      aria-pressed={scope === key}
      className={scope === key ? 'nk-att-chip nk-att-chip--on' : 'nk-att-chip'}
    >
      {label}{typeof count === 'number' ? ` (${count})` : ''}
    </button>
  )

  return (
    <Modal open={open} onClose={onClose} title={title || 'اختر المستلمين'} wide>
      <p className="text-[.72rem] text-fg-muted m-0 mb-3">
        {subtitle || 'الاختيار مقترح تلقائيًا حسب السياق — عدّله كما تحب، ولن يُرسل شيء حتى تضغط متابعة.'}
      </p>

      <div className="nk-att-chips mb-2" role="group" aria-label="فلترة المستلمين">
        {chip('all', 'الكل', candidates.length)}
        {chip('present', 'الحاضرون', candidates.filter((c) => c.statusType === 'present').length)}
        {chip('absent', 'الغائبون', candidates.filter((c) => c.statusType === 'absent').length)}
        {chip('hasphone', 'لديهم رقم صحيح', eligibleCount)}
      </div>

      <input
        className="glass-input rounded-xl px-3.5 py-2.5 text-sm w-full mb-3"
        placeholder="🔍 بحث بالاسم أو الكود..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="بحث في المستلمين"
      />

      <div className="grid gap-1.5 max-h-[46vh] overflow-y-auto nk-picker-list">
        {visible.map((c) => {
          const isSel = selected.has(c.key)
          return (
            <label
              key={c.key}
              className={`nk-att-row !cursor-pointer ${c.disabled ? 'opacity-50' : ''}`}
              style={isSel && !c.disabled ? { borderColor: 'var(--brand-gold)', background: 'var(--brand-gold-surface)' } : undefined}
            >
              <span className="nk-att-row__name">
                <b className="truncate">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-[var(--brand-gold)] cursor-pointer me-2 align-middle"
                    checked={isSel && !c.disabled}
                    disabled={c.disabled}
                    onChange={() => toggle(c.key)}
                  />
                  {c.student?.name}
                  {(c.student?.warnings || 0) > 0 && (
                    <span className="nk-pill nk-pill-danger !text-[.6rem] ms-2 align-middle" title="الإنذارات المسجلة">⚠ {c.student.warnings}</span>
                  )}
                </b>
                <small className="truncate">
                  {c.disabled ? 'لا يوجد رقم واتساب صحيح' : [c.student?.code, c.phone && `+${c.phone}`].filter(Boolean).join(' · ')}
                </small>
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                {c.statusLabel && (
                  <span className={`nk-pill ${c.statusType === 'present' ? 'nk-pill-live' : c.statusType === 'absent' ? 'nk-pill-danger' : 'nk-pill-neutral'}`}>
                    {c.statusLabel}
                  </span>
                )}
                {c.qrUrl && <span className="nk-pill nk-pill-gold !text-[.6rem]">QR جاهز</span>}
              </span>
            </label>
          )
        })}
        {visible.length === 0 && <p className="text-center py-6 text-sm text-fg-muted">لا نتائج مطابقة</p>}
      </div>

      <div className="flex flex-wrap gap-2 items-center mt-4 pt-3" style={{ borderTop: '1px solid var(--surface-border)' }}>
        <button className="btn-ghost rounded-xl px-3.5 py-2.5 text-[.72rem] font-extrabold" onClick={onClose}>
          إلغاء
        </button>
        <span className="nk-pill nk-pill-gold me-auto">{selectedCount} محدد من {candidates.length}</span>
        <button className="btn-gold action-button !min-h-[2.9rem]" disabled={selectedCount === 0} onClick={start}>
          متابعة ← قائمة الإرسال ({selectedCount})
        </button>
      </div>
    </Modal>
  )
}
