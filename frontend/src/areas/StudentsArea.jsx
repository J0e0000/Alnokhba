import { useMemo, useState } from 'react'
import { useWorkspace, useWorkspaceMeta, normalizeArabicSearch } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import StudentModal from '../components/StudentModal'
import StudentQRModal from '../components/StudentQRModal'
import { SkeletonTableRows } from '../components/Skeleton'
import { checkAcademicWarning, getStudentRank, buildWhatsAppUrl, normalizeEgyptianPhone, isValidPhone, openWhatsAppUrl } from '../lib/helpers'

// ═══════════════════════════════════════════════════════════════════════════
// STUDENTS AREA — rebuilt around fast operations:
//  • search + filters (name / code / phone / stage / group / status)
//  • single add/edit (existing StudentModal logic)
//  • BULK ADD: multi-row grid → validate all → review → save all (rule 19)
//  • bulk selection: attendance, points, group move, WhatsApp queue
//  • WhatsApp + Call per student (existing wa.me behavior preserved)
// ═══════════════════════════════════════════════════════════════════════════
export default function StudentsArea() {
  const ws = useWorkspace()
  const wsMeta = useWorkspaceMeta()
  const ui = useUI()
  const { isArabic } = ws
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('الكل')
  const [groupFilter, setGroupFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState(new Set())
  const [studentModal, setStudentModal] = useState({ open: false, student: null })
  const [qrModal, setQrModal] = useState({ open: false, student: null })
  const [bulkAddOpen, setBulkAddOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = normalizeArabicSearch(search)
    return ws.students.filter((s) => {
      const searchable = normalizeArabicSearch([s.name, s.phone, s.code, s.stage, s.group_name].filter(Boolean).join(' '))
      if (q && !searchable.includes(q)) return false
      if (groupFilter !== 'all' && s.group_name !== groupFilter) return false
      if (stageFilter !== 'الكل' && !(s.stage || '').includes(stageFilter)) return false
      if (statusFilter === 'present' && s.attendance_status !== 'حاضر') return false
      if (statusFilter === 'absent' && s.attendance_status !== 'غائب') return false
      if (statusFilter === 'warning' && !checkAcademicWarning(ws.examScoresByStudent[s.id] || [])) return false
      if (statusFilter === 'hw_missing' && !(s.hw_status === 'لم يتم' || s.hw_status === 'ناقص')) return false
      return true
    })
  }, [ws.students, ws.examScoresByStudent, search, stageFilter, groupFilter, statusFilter])

  const toggleSelect = (id) => setSelected((prev) => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const sendWhatsApp = (student, message) => {
    const phone = normalizeEgyptianPhone(student.phone)
    if (!phone) { ws.showToast ? null : null; return }
    const url = buildWhatsAppUrl(phone, message)
    openWhatsAppUrl(url)
  }

  // QR button → opens the link card (visible link + copy + WhatsApp + QR download).
  // The actual WhatsApp send lives in StudentQRModal and ALWAYS appends the link
  // (buildQRMessage) — the old direct-send here dropped it when the saved
  // template had no {link} placeholder ("اللينك ما بيتباعش").
  const openStudentQR = (student) => setQrModal({ open: true, student })

  const bulkMessage = () => {
    const items = [...selected].map((id) => ws.students.find((s) => s.id === id)).filter((s) => s && s.phone && isValidPhone(s.phone))
      .map((s) => ({ student: s, phone: normalizeEgyptianPhone(s.phone), message: (ws.settings?.msg_welcome || 'مرحبًا {studentName}').replace('{studentName}', s.name) }))
    if (!items.length) { ws.showToast?.('لا يوجد طلاب محددين لديهم أرقام صحيحة', 'error'); return }
    ui.startQueue(items)
  }

  // PERF: bulk attendance marks run in parallel instead of one-by-one —
  // each student's write chain is independent (per-student RPC/points row).
  const bulkPresent = async () => {
    await Promise.all([...selected].map((id) => ws.setAttendance(id, 'حاضر')))
    setSelected(new Set())
  }
  const bulkAbsent = async () => {
    await Promise.all([...selected].map((id) => ws.setAttendance(id, 'غائب')))
    setSelected(new Set())
  }

  if (ws.loading) return <SkeletonTableRows rows={6} cols={5} />

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-lg font-black m-0">{isArabic ? 'الطلاب' : 'Students'}</h1>
        <div className="flex flex-wrap gap-2">
          <button className="btn-navy rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold" onClick={() => setStudentModal({ open: true, student: null })}>
            ＋ {isArabic ? 'طالب جديد' : 'Add student'}
          </button>
          <button className="btn-gold rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold" onClick={() => setBulkAddOpen(true)}>
            ＋＋ {isArabic ? 'إضافة عدة طلاب' : 'Bulk add'}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          className="glass-input rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-[190px]"
          placeholder={isArabic ? '🔍 بحث بالاسم أو الكود أو الهاتف...' : 'Search name / code / phone...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={isArabic ? 'بحث' : 'Search'}
        />
        <select className="glass-input rounded-xl px-3 py-2.5 text-[.78rem]" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label={isArabic ? 'المجموعة' : 'Group'}>
          <option value="all">{isArabic ? 'كل المجموعات' : 'All groups'}</option>
          {ws.groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="glass-input rounded-xl px-3 py-2.5 text-[.78rem]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={isArabic ? 'الحالة' : 'Status'}>
          <option value="all">{isArabic ? 'كل الحالات' : 'All statuses'}</option>
          <option value="present">{isArabic ? 'حاضر اليوم' : 'Present'}</option>
          <option value="absent">{isArabic ? 'غائب' : 'Absent'}</option>
          <option value="warning">{isArabic ? 'إنذار أكاديمي' : 'Academic warning'}</option>
          <option value="hw_missing">{isArabic ? 'واجب ناقص' : 'Homework missing'}</option>
        </select>
      </div>

      {/* Bulk selection bar */}
      {selected.size > 0 && (
        <div className="glass-card p-3 mb-3 flex flex-wrap items-center gap-2 animate-slide-up">
          <span className="nk-pill nk-pill-gold">{selected.size} {isArabic ? 'محدد' : 'selected'}</span>
          <button className="btn-ghost rounded-lg px-3 py-2 text-[.72rem] font-extrabold" onClick={bulkPresent}>✓ {isArabic ? 'حاضر' : 'Present'}</button>
          <button className="btn-ghost rounded-lg px-3 py-2 text-[.72rem] font-extrabold" onClick={bulkAbsent}>✗ {isArabic ? 'غائب' : 'Absent'}</button>
          <button className="btn-ghost rounded-lg px-3 py-2 text-[.72rem] font-extrabold" onClick={bulkMessage}>✆ {isArabic ? 'رسالة جماعية' : 'Bulk message'}</button>
          <button className="btn-ghost rounded-lg px-3 py-2 text-[.72rem] font-extrabold" onClick={() => setSelected(new Set())}>{isArabic ? 'إلغاء التحديد' : 'Clear'}</button>
        </div>
      )}

      {/* Student cards/rows */}
      <div className="grid gap-2">
        {filtered.map((s) => {
          const rank = getStudentRank(s.points || 0, ws.ranks)
          const isSel = selected.has(s.id)
          const isSavingRow = wsMeta.savingIds.has(s.id)
          return (
            <div
              key={s.id}
              className="nk-row !flex-wrap cursor-pointer select-none"
              style={isSel ? { borderColor: 'var(--brand-gold)', background: 'var(--brand-gold-surface)' } : undefined}
              onClick={(e) => {
                // Name → profile; anything else on the row → select.
                // Buttons/checkbox/links keep their own behavior.
                if (e.target.closest('button, input, a, label')) return
                toggleSelect(s.id)
              }}
            >
              <span className="flex items-center gap-2 min-w-0">
                <input type="checkbox" className="w-4 h-4 accent-[var(--brand-gold)] cursor-pointer" checked={isSel} onChange={() => toggleSelect(s.id)} onClick={(e) => e.stopPropagation()} aria-label={`تحديد ${s.name}`} />
                <button
                  className="bg-transparent border-0 p-0 m-0 text-right min-w-0 cursor-pointer font-[inherit] hover:underline underline-offset-4 decoration-2"
                  onClick={(e) => { e.stopPropagation(); ui.openStudentHistory(s.id) }}
                  title={isArabic ? 'فتح سجل الطالب' : 'Open student history'}
                >
                  <b className="truncate block" style={{ color: 'var(--fg)' }}>{s.name} {isSavingRow ? '…' : ''}</b>
                  <small className="block">{s.code || ''}{s.group_name ? ` · ${s.group_name}` : ''}{s.stage ? ` · ${s.stage}` : ''}</small>
                </button>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={`nk-pill ${s.attendance_status === 'حاضر' ? 'nk-pill-live' : s.attendance_status === 'غائب' ? 'nk-pill-danger' : 'nk-pill-neutral'}`}>
                  {s.attendance_status === 'حاضر' ? '✓ حاضر' : s.attendance_status === 'غائب' ? '✗ غائب' : 'لم يُرصد'}
                </span>
                <span className="nk-pill nk-pill-gold">{rank} · {s.points || 0}</span>
                {(s.warnings || 0) > 0 && <span className="nk-pill nk-pill-danger">⚠ {s.warnings}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 ms-auto">
                <button className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" disabled={isSavingRow} onClick={() => ws.setAttendance(s.id, 'حاضر')}>ح</button>
                <button className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" disabled={isSavingRow} onClick={() => ws.setAttendance(s.id, 'غائب')}>غ</button>
                <button className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" disabled={isSavingRow} onClick={() => ws.updateHW(s.id, 'مكتمل')}>و✓</button>
                <button
                  className="!min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold"
                  style={{ background: '#e7f8ee', color: '#0c6b50', border: '1px solid #b5e5d2' }}
                  onClick={() => sendWhatsApp(s, (ws.settings?.msg_welcome || 'مرحبًا {studentName}').replace('{studentName}', s.name))}
                  title="WhatsApp"
                >✆</button>
                <button
                  className="!min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold"
                  style={{ background: 'var(--info-bg)', color: 'var(--info-strong)', border: '1px solid var(--info-border)' }}
                  onClick={() => openStudentQR(s)}
                  title={isArabic ? 'رابط البوابة — نسخ / إرسال / تحميل QR' : 'Portal link — copy / send / download QR'}
                >QR</button>
                <button className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" onClick={() => setStudentModal({ open: true, student: s })}>✎</button>
                <button
                  className="!min-h-0 rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold"
                  style={{ background: 'var(--danger-bg)', color: 'var(--danger-strong)', border: '1px solid var(--danger-border)' }}
                  onClick={async () => {
                    const ok = await ui.askConfirm(`حذف الطالب ${s.name}؟ لا يمكن التراجع عن حذف سجلاته من السيرفر.`, { danger: true, confirmLabel: 'حذف' })
                    if (ok) ws.deleteStudent(s)
                  }}
                >🗑</button>
              </span>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="text-center py-8 text-sm text-fg-muted">{isArabic ? 'لا يوجد طلاب مطابقون' : 'No matching students'}</p>
        )}
      </div>

      <StudentModal
        open={studentModal.open}
        student={studentModal.student}
        groups={ws.groups}
        onClose={() => setStudentModal({ open: false, student: null })}
        onSave={async (form) => {
          const result = await ws.saveStudent(form, studentModal.student)
          if (result?.ok) setStudentModal({ open: false, student: null })
        }}
        isSaving={wsMeta.isSaving}
      />

      <StudentQRModal
        open={qrModal.open}
        student={qrModal.student}
        template={ws.settings?.qr_message_template || ''}
        onClose={() => setQrModal({ open: false, student: null })}
        showToast={ws.showToast}
      />

      {bulkAddOpen && <BulkAddModal onClose={() => setBulkAddOpen(false)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BULK ADD (rule 19): multi-row grid → VALIDATE ALL → REVIEW → SAVE ALL
// Detects: missing names, invalid phones, duplicates inside the list,
// and conflicts with existing students (name or phone). Never silently
// creates duplicates.
// ═══════════════════════════════════════════════════════════════════════════
function BulkAddModal({ onClose }) {
  const ws = useWorkspace()
  const { isArabic } = ws
  const [rows, setRows] = useState([
    { name: '', phone: '', stage: '', group: ws.groups[0] || '' },
    { name: '', phone: '', stage: '', group: ws.groups[0] || '' },
    { name: '', phone: '', stage: '', group: ws.groups[0] || '' },
  ])
  const [step, setStep] = useState('edit') // edit | review | saving
  const [problems, setProblems] = useState([])
  const [result, setResult] = useState(null)

  const setRow = (i, patch) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRow = () => setRows((prev) => [...prev, { name: '', phone: '', stage: '', group: ws.groups[0] || '' }])
  const removeRow = (i) => setRows((prev) => prev.filter((_, j) => j !== i))

  const filled = rows.filter((r) => String(r.name || '').trim() || String(r.phone || '').trim())

  const validateAll = () => {
    if (filled.length === 0) { setProblems([{ index: -1, reason: isArabic ? 'أدخل طالبًا واحدًا على الأقل' : 'Enter at least one student' }]); return }
    // PURE validation — nothing is written until "Save all".
    const found = ws.validateBulkRows(filled)
    if (found.length) setProblems(found)
    else { setProblems([]); setStep('review') }
  }

  const saveAll = async () => {
    setStep('saving')
    const res = await ws.bulkAddStudents(filled, () => {})
    if (res.ok) { setResult(res); setTimeout(onClose, 900) }
    else { setProblems(res.problems || []); setStep('edit') }
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center bg-black/50 p-3 sm:p-6 overflow-y-auto" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-card w-full max-w-2xl p-5 my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-base font-extrabold m-0">{isArabic ? 'إضافة عدة طلاب' : 'Bulk add students'}</h3>
          <button className="btn-ghost rounded-lg px-3 py-1.5 text-[.72rem] font-extrabold" onClick={onClose}>✕</button>
        </div>
        <p className="text-[.7rem] text-fg-muted mt-0 mb-4">
          {step === 'edit' && (isArabic ? 'أدخل الطلاب في صفوف سريعة، ثم تحقق من الكل ← راجع ← احفظ الجميع مرة واحدة.' : 'Enter students in fast rows, then validate all → review → save all at once.')}
          {step === 'review' && (isArabic ? 'كل الصفوف صحيحة — اضغط حفظ الجميع للإضافة دفعة واحدة.' : 'All rows valid — save all at once.')}
        </p>

        {problems.length > 0 && step === 'edit' && (
          <div className="nk-notice mb-3" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-strong)' }}>
            <b className="block mb-1">{isArabic ? 'أخطاء يجب إصلاحها قبل الحفظ:' : 'Fix before saving:'}</b>
            <ul className="list-disc ps-5 m-0">
              {problems.map((p, i) => <li key={i}>{p.index >= 0 ? `${isArabic ? 'صف' : 'Row'} ${p.index + 1}: ` : ''}{p.reason}{p.label ? ` (${p.label})` : ''}</li>)}
            </ul>
          </div>
        )}

        {step !== 'saving' && rows.map((row, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_0.8fr_0.9fr_auto] gap-2 mb-2 items-center">
            <input disabled={step === 'review'} className="glass-input rounded-xl px-3 py-2 text-sm" placeholder={isArabic ? `اسم الطالب ${i + 1}` : `Name ${i + 1}`} value={row.name} onChange={(e) => setRow(i, { name: e.target.value })} />
            <input dir="ltr" disabled={step === 'review'} className="glass-input rounded-xl px-3 py-2 text-sm" placeholder={isArabic ? 'الهاتف' : 'Phone'} value={row.phone} onChange={(e) => setRow(i, { phone: e.target.value })} />
            <select disabled={step === 'review'} className="glass-input rounded-xl px-2 py-2 text-[.72rem]" value={row.stage} onChange={(e) => setRow(i, { stage: e.target.value })}>
              <option value="">{isArabic ? 'المرحلة' : 'Stage'}</option>
              {['ابتدائي', 'إعدادي', 'ثانوي'].map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
            <select disabled={step === 'review'} className="glass-input rounded-xl px-2 py-2 text-[.72rem]" value={row.group} onChange={(e) => setRow(i, { group: e.target.value })}>
              <option value="">{isArabic ? 'المجموعة' : 'Group'}</option>
              {ws.groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <button disabled={step === 'review'} className="btn-ghost rounded-lg px-2.5 py-2 text-[.7rem] font-extrabold" onClick={() => removeRow(i)} aria-label={isArabic ? 'حذف الصف' : 'Remove row'}>✕</button>
          </div>
        ))}
        {step === 'saving' && <p className="text-center py-8 font-extrabold" style={{ color: 'var(--brand-gold)' }}>{isArabic ? 'جاري حفظ الجميع...' : 'Saving all...'}</p>}

        {step !== 'saving' && (
          <>
            <button className="btn-ghost rounded-xl px-4 py-2.5 text-[.75rem] font-extrabold mt-2" onClick={addRow}>
              ＋ {isArabic ? 'أضف صفًا آخر' : 'Add another'}
            </button>
            <div className="flex flex-wrap gap-2 mt-5 pt-4" style={{ borderTop: '1px solid var(--surface-border)' }}>
              {step === 'edit' && (
                <button className="btn-navy action-button !min-h-[3rem]" onClick={validateAll}>
                  ✓ {isArabic ? `تحقق من الكل (${filled.length})` : `Validate all (${filled.length})`}
                </button>
              )}
              {step === 'review' && (
                <button className="btn-gold action-button !min-h-[3rem]" onClick={saveAll}>
                  💾 {isArabic ? `احفظ الجميع (${filled.length})` : `Save all (${filled.length})`}
                </button>
              )}
              {step === 'review' && (
                <button className="btn-ghost action-button !min-h-[3rem]" onClick={() => setStep('edit')}>{isArabic ? 'رجوع للتعديل' : 'Back to edit'}</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
