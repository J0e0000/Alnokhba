import { useMemo, useState } from 'react'
import { useWorkspace, useWorkspaceMeta, normalizeArabicSearch } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import StudentModal from '../components/StudentModal'
import StudentQRModal from '../components/StudentQRModal'
import CustomMessageModal from '../components/CustomMessageModal'
import { SkeletonTableRows } from '../components/Skeleton'
import { checkAcademicWarning, buildWhatsAppUrl, normalizeEgyptianPhone, isValidPhone, openWhatsAppUrl, GRADES_BY_STAGE, STAGE_CATEGORIES, stageCategoryOf, isStageCompatible } from '../lib/helpers'
import { getOrCreateStudentToken, buildStudentQRLink, buildQRMessage } from '../lib/qrPdfWhatsApp'
import { downloadCSV } from '../lib/csv'

// ═══════════════════════════════════════════════════════════════════════════
// STUDENTS AREA — student-management round (spec 3–8, 21–26):
//  • Stage SEGMENTED FILTER (الكل / ابتدائي / إعدادي / ثانوي) — stages are
//    visually separated, no giant mixed list unless "الكل" is chosen (spec 4).
//  • Bulk toolbar appears ONLY when records are selected (spec 22): one
//    primary action + "More" menu — compact bottom bar on phones (spec 25).
//  • Batch operations (spec 24): group assignment & deletion are ONE .in()
//    round-trip; failures are counted and reported, never silent.
//  • Consequential bulk actions confirm with the exact scope (spec 23).
//  • BULK ADD ends in a result screen with ready-to-send QR/messages and
//    per-student selection (spec 5–7) — nothing sends automatically.
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
  const [assignOpen, setAssignOpen] = useState(false)
  const [customComposer, setCustomComposer] = useState(null) // selected students → CustomMessageModal
  const [moreOpen, setMoreOpen] = useState(false)
  const [busyBulk, setBusyBulk] = useState('')

  const filtered = useMemo(() => {
    const q = normalizeArabicSearch(search)
    return ws.students.filter((s) => {
      const searchable = normalizeArabicSearch([s.name, s.phone, s.code, s.stage, s.group_name].filter(Boolean).join(' '))
      if (q && !searchable.includes(q)) return false
      if (groupFilter !== 'all' && s.group_name !== groupFilter) return false
      // Stage filter is CATEGORY-based so it matches both full grades
      // ("الثالث الإعدادي") and legacy category values ("إعدادي").
      if (stageFilter !== 'الكل' && stageCategoryOf(s.stage) !== stageFilter) return false
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

  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id))
  const toggleSelectAll = () => setSelected((prev) => {
    if (filtered.every((s) => prev.has(s.id))) {
      const n = new Set(prev)
      filtered.forEach((s) => n.delete(s.id))
      return n
    }
    return new Set([...prev, ...filtered.map((s) => s.id)])
  })

  const selectedStudents = useMemo(
    () => [...selected].map((id) => ws.students.find((s) => s.id === id)).filter(Boolean),
    [selected, ws.students],
  )

  const sendWhatsApp = (student, message) => {
    const phone = normalizeEgyptianPhone(student.phone)
    if (!phone) return
    const url = buildWhatsAppUrl(phone, message)
    openWhatsAppUrl(url)
  }

  // QR button → opens the link card (visible link + copy + WhatsApp + QR download).
  const openStudentQR = (student) => setQrModal({ open: true, student })

  // ── Bulk actions (spec 21–24) ─────────────────────────────────────────
  // Bulk message (owner request: "send messages to specific people"): the
  // selected students go to the CUSTOM COMPOSER first — write the text once,
  // placeholders ({studentName} {group} {date}) personalize it per student,
  // and the send queue stays the only sender. The old behavior blindly queued
  // the welcome template with no chance to write an actual message.
  const bulkMessage = () => {
    const targets = selectedStudents.filter((s) => s.phone && isValidPhone(s.phone))
    if (!targets.length) { ws.showToast?.('لا يوجد طلاب محددون لديهم أرقام صحيحة', 'error'); return }
    setMoreOpen(false)
    setCustomComposer(targets)
  }

  const bulkAssignGroup = async (groupName) => {
    setAssignOpen(false)
    const groupStage = ws.groupMeta[groupName]?.stage || ''
    const stageChanges = selectedStudents.filter((s) => groupStage && s.stage !== groupStage).length
    const ok = await ui.askConfirm(
      isArabic
        ? `سيتم نقل ${selectedStudents.length} طالب إلى مجموعة «${groupName}»${stageChanges > 0 ? ` وتحديث مرحلة ${stageChanges} طالب لتطابق مرحلة المجموعة (${groupStage})` : ''}.`
        : `Move ${selectedStudents.length} students to "${groupName}"${stageChanges > 0 ? ` and align ${stageChanges} stages to the group's stage (${groupStage})` : ''}.`,
      { title: isArabic ? 'تغيير مجموعة الطلاب' : 'Change student group', confirmLabel: isArabic ? 'نقل الطلاب' : 'Move students' },
    )
    if (!ok) return
    setBusyBulk('assign')
    const res = await ws.bulkAssignGroup([...selected], groupName, groupStage)
    setBusyBulk('')
    if (res.ok > 0) {
      ws.showToast?.(isArabic ? `تم نقل ${res.ok} طالب${res.failed ? ` — فشل ${res.failed}` : ''}` : `Moved ${res.ok} students${res.failed ? ` — ${res.failed} failed` : ''}`, res.failed ? 'info' : 'success')
      setSelected(new Set())
    }
  }

  const bulkQRQueue = async () => {
    setMoreOpen(false)
    const targets = selectedStudents.filter((s) => s.phone && isValidPhone(s.phone))
    if (!targets.length) { ws.showToast?.('لا يوجد طلاب محددون لديهم أرقام صحيحة', 'error'); return }
    setBusyBulk('qr')
    // PERF: token ops are independent per-student row upserts — run them in
    // parallel instead of one await per student (N× round-trip → 1×).
    const template = ws.settings?.qr_message_template || ''
    const results = await Promise.all(targets.map(async (s) => {
      const token = await getOrCreateStudentToken(s.id)
      if (!token) return null
      const link = buildStudentQRLink(token)
      return { key: s.id, kind: 'qr_link', student: s, phone: normalizeEgyptianPhone(s.phone), message: buildQRMessage(s.name, link, template), qrUrl: link, template }
    }))
    const items = results.filter(Boolean)
    setBusyBulk('')
    if (!items.length) { ws.showToast?.('تعذر تجهيز روابط البوابة', 'error'); return }
    ui.startQueue(items)
  }

  const bulkExportCSV = () => {
    setMoreOpen(false)
    const rows = selectedStudents.map((s) => [s.name, s.code || '', s.phone || '', s.stage || '', s.group_name || '', s.points || 0, s.warnings || 0])
    downloadCSV('students_selected.csv', ['الاسم', 'الكود', 'الهاتف', 'المرحلة', 'المجموعة', 'النقاط', 'الإنذارات'], rows)
    ws.showToast?.('تم تحميل ملف CSV ✓', 'success')
  }

  const bulkDelete = async () => {
    setMoreOpen(false)
    const ok = await ui.askConfirm(
      isArabic
        ? `سيتم حذف ${selectedStudents.length} طالب نهائيًا من السيرفر مع سجلات حضورهم ودرجاتهم. لا يمكن التراجع عن حذف سجلاتهم من السيرفر (التراجع من الشاشة متاح للحفظ المؤقت فقط).`
        : `${selectedStudents.length} students will be permanently deleted with their records.`,
      { title: isArabic ? 'حذف الطلاب المحددين' : 'Delete selected students', confirmLabel: isArabic ? 'حذف نهائي' : 'Delete permanently', danger: true },
    )
    if (!ok) return
    setBusyBulk('delete')
    const res = await ws.bulkDeleteStudents(selectedStudents)
    setBusyBulk('')
    if (res.ok > 0) {
      ws.showToast?.(isArabic ? `تم حذف ${res.ok} طالب${res.failed ? ` — فشل ${res.failed}` : ''}` : `Deleted ${res.ok} students${res.failed ? ` — ${res.failed} failed` : ''}`, res.failed ? 'info' : 'success')
      setSelected(new Set())
    }
  }

  // NOTE: attendance & homework are SESSION-ONLY actions (الحصة) — they are
  // deliberately NOT available from this table (neither per-row nor bulk),
  // per teacher request. This table is identity/contact management only.

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
      <div className="flex flex-wrap gap-2 mb-2">
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

      {/* Stage separation (spec 4): segmented category filter — each stage is
          one tap away, "الكل" is the only mixed view. */}
      <div className="nk-att-chips mb-3" role="group" aria-label={isArabic ? 'فلترة المرحلة' : 'Stage filter'}>
        {['الكل', ...STAGE_CATEGORIES].map((cat) => {
          const count = cat === 'الكل' ? ws.students.length : ws.students.filter((s) => stageCategoryOf(s.stage) === cat).length
          return (
            <button
              key={cat}
              onClick={() => setStageFilter(cat)}
              aria-pressed={stageFilter === cat}
              className={stageFilter === cat ? 'nk-att-chip nk-att-chip--on' : 'nk-att-chip'}
            >
              {cat === 'الكل' ? (isArabic ? `الكل (${count})` : `All (${count})`) : `${cat} (${count})`}
            </button>
          )
        })}
      </div>

      {/* Select-all chip (spec 21): only meaningful with results */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <button className="nk-att-chip" onClick={toggleSelectAll} aria-pressed={allFilteredSelected}>
            {allFilteredSelected ? (isArabic ? '☑ إلغاء تحديد الكل' : '☑ Unselect all') : (isArabic ? `☐ تحديد الكل (${filtered.length})` : `☐ Select all (${filtered.length})`)}
          </button>
        </div>
      )}

      {/* Student cards/rows */}
      <div className="grid gap-2 pb-20 lg:pb-0">
        {filtered.map((s) => {
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
              {/* Points ONLY — no attendance/homework status pill here (it
                  lives in the session); warnings stay visible when present. */}
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="nk-pill nk-pill-gold">{s.points || 0}</span>
                {(s.warnings || 0) > 0 && <span className="nk-pill nk-pill-danger">⚠ {s.warnings}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 ms-auto">
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

      {/* Contextual bulk toolbar (spec 22/25): renders ONLY when records are
          selected — one primary action + More menu; compact fixed bar on
          phones so the rest of the screen stays usable. */}
      {selected.size > 0 && (
        <div className="nk-bulkbar glass-card animate-slide-up" role="toolbar" aria-label={isArabic ? 'إجراءات المحددين' : 'Bulk actions'}>
          <span className="nk-pill nk-pill-gold shrink-0">{selected.size} {isArabic ? 'محدد' : 'selected'}</span>
          <button className="btn-gold rounded-xl px-3.5 py-2 text-[.72rem] font-extrabold shrink-0" disabled={busyBulk === 'assign'} onClick={() => setAssignOpen(true)}>
            ♦ {isArabic ? 'تعيين مجموعة' : 'Assign group'}
          </button>
          <button className="btn-ghost rounded-xl px-3 py-2 text-[.72rem] font-extrabold shrink-0" onClick={bulkMessage}>✆ {isArabic ? 'رسالة' : 'Message'}</button>
          <div className="nk-menu-wrap ms-auto">
            <button className="btn-ghost rounded-xl px-3 py-2 text-[.72rem] font-extrabold shrink-0" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
              {isArabic ? 'المزيد' : 'More'} ▾
            </button>
            {moreOpen && (
              <>
                <div className="nk-menu-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />
                <div className="nk-menu-sheet" role="menu" aria-label={isArabic ? 'المزيد من الإجراءات' : 'More actions'}>
                  <button role="menuitem" disabled={busyBulk === 'qr'} onClick={bulkQRQueue}>⛶ {isArabic ? 'إرسال روابط البوابة (QR)' : 'Send portal links (QR)'}</button>
                  <button role="menuitem" onClick={bulkExportCSV}>⬇ {isArabic ? 'تصدير المحددين CSV' : 'Export selected (CSV)'}</button>
                  <button role="menuitem" className="nk-menu-danger" disabled={busyBulk === 'delete'} onClick={bulkDelete}>🗑 {isArabic ? 'حذف المحددين' : 'Delete selected'}</button>
                  <button role="menuitem" onClick={() => { setSelected(new Set()); setMoreOpen(false) }}>✕ {isArabic ? 'إلغاء التحديد' : 'Clear selection'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <StudentModal
        open={studentModal.open}
        student={studentModal.student}
        groups={ws.groups}
        groupMeta={ws.groupMeta}
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

      {/* Assign-group modal (spec 2/3): only stage-compatible groups are
          offered; the confirm shows the exact consequence. */}
      {assignOpen && (
        <AssignGroupModal
          count={selected.size}
          groups={ws.groups}
          groupMeta={ws.groupMeta}
          currentStages={selectedStudents.map((s) => s.stage).filter(Boolean)}
          onClose={() => setAssignOpen(false)}
          onPick={bulkAssignGroup}
        />
      )}

      {bulkAddOpen && <BulkAddModal onClose={() => setBulkAddOpen(false)} />}

      {/* Custom message to the SELECTED students (owner request) */}
      {customComposer && (
        <CustomMessageModal
          open
          onClose={() => setCustomComposer(null)}
          students={customComposer}
          settings={ws.settings}
          onSend={(items) => { setCustomComposer(null); ui.startQueue(items) }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGN GROUP modal — groups are filtered to stage-compatible options and the
// consequence (stage realignment count) is stated before applying (spec 2).
// ─────────────────────────────────────────────────────────────────────────────
function AssignGroupModal({ count, groups, groupMeta, currentStages, onClose, onPick }) {
  const [groupName, setGroupName] = useState('')
  const meta = groupMeta || {}
  // Majority category of the selection drives the compatibility filter.
  const counts = {}
  for (const st of currentStages) {
    const cat = stageCategoryOf(st)
    if (cat) counts[cat] = (counts[cat] || 0) + 1
  }
  const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  const compatible = (groups || []).filter((g) => !majority || !meta[g]?.stage || stageCategoryOf(meta[g]?.stage) === majority)
  const rest = (groups || []).filter((g) => !compatible.includes(g))
  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-extrabold m-0 mb-1">تعيين مجموعة لـ {count} طالب</h3>
        <p className="text-[.72rem] text-fg-muted mt-0 mb-3">مرحلة الطالب ستُحدَّث لتطابق مرحلة المجموعة المختارة — المجموعة هي المرجع.</p>
        <select className="glass-input rounded-xl px-3 py-2.5 text-sm w-full mb-3" value={groupName} onChange={(e) => setGroupName(e.target.value)} autoFocus>
          <option value="">اختر المجموعة...</option>
          {compatible.length > 0 && <optgroup label="متوافقة مع مرحلة المحددين">
            {compatible.map((g) => <option key={g} value={g}>{g}{meta[g]?.stage ? ` — ${meta[g].stage}` : ''}</option>)}
          </optgroup>}
          {rest.length > 0 && <optgroup label="مراحل أخرى">
            {rest.map((g) => <option key={g} value={g}>{g}{meta[g]?.stage ? ` — ${meta[g].stage}` : ''}</option>)}
          </optgroup>}
        </select>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1 rounded-xl px-4 py-2.5 text-[.75rem] font-extrabold" onClick={onClose}>إلغاء</button>
          <button className="btn-gold flex-1 rounded-xl px-4 py-2.5 text-[.75rem] font-extrabold" disabled={!groupName} onClick={() => onPick(groupName)}>متابعة</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BULK ADD (rule 19 + spec 5–7): multi-row grid → VALIDATE ALL → REVIEW →
// SAVE ALL → RESULT SCREEN. The result screen is the spec-5 "Students Added
// Successfully" state: per-student QR/message generation (existing token/link
// architecture — no second QR system), per-student selection, copy actions,
// and explicit send into the existing WhatsApp queue. NOTHING sends without
// the teacher pressing the send button (spec 6).
// ═══════════════════════════════════════════════════════════════════════════
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch { return false }
  }
}

function BulkAddModal({ onClose }) {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [rows, setRows] = useState([
    blankRow(ws.groups[0]), blankRow(ws.groups[0]), blankRow(ws.groups[0]),
  ])
  const [step, setStep] = useState('edit') // edit | review | saving | result
  const [problems, setProblems] = useState([])
  const [result, setResult] = useState(null)
  const [created, setCreated] = useState([]) // students from the save
  const [links, setLinks] = useState({}) // id → { status: pending|ready|error, link, message }
  const [picked, setPicked] = useState(() => new Set())
  const [linkFilter, setLinkFilter] = useState('all') // all | ready | nophone

  const meta = ws.groupMeta || {}

  const setRow = (i, patch) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRow = () => setRows((prev) => [...prev, blankRow(ws.groups[0])])
  const removeRow = (i) => setRows((prev) => prev.filter((_, j) => j !== i))

  function blankRow(defaultGroup) {
    return { name: '', phone: '', stage: '', group: defaultGroup || '' }
  }

  // Row-level group change inherits the group's stage (spec 2) and row stage
  // change filters the group options (spec 3) — same rules as StudentModal.
  const setRowGroup = (i, groupName) => {
    const groupStage = meta[groupName]?.stage || ''
    setRow(i, groupStage ? { group: groupName, stage: groupStage } : { group: groupName })
  }
  const setRowStage = (i, stage) => {
    const row = rows[i]
    const compatible = !row.group || isStageCompatible(stage, meta[row.group]?.stage)
    setRow(i, compatible ? { stage } : { stage, group: '' })
  }

  const groupsForStage = (stage) => (ws.groups || []).filter((g) => isStageCompatible(stage, meta[g]?.stage))

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
    if (res.ok) {
      setResult(res)
      setCreated(res.students || [])
      setPicked(new Set((res.students || []).map((s) => s.id)))
      setStep('result')
      generateLinks(res.students || [])
    } else {
      setProblems(res.problems || [])
      setStep('edit')
    }
  }

  // Generate portal links/messages for the created students (spec 5) —
  // sequential with a small concurrency window; failures stay per-row
  // retryable, one bad token never blocks the rest (spec 24 partial failure).
  const generateLinks = async (students) => {
    const template = ws.settings?.qr_message_template || ''
    setLinks(Object.fromEntries(students.filter((s) => isValidPhone(s.phone)).map((s) => [s.id, { status: 'pending', link: '', message: '' }])))
    const queue = students.filter((s) => isValidPhone(s.phone))
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift()
        try {
          const token = await getOrCreateStudentToken(s.id)
          if (!token) throw new Error('no token')
          const link = buildStudentQRLink(token)
          const message = buildQRMessage(s.name, link, template)
          setLinks((prev) => ({ ...prev, [s.id]: { status: 'ready', link, message } }))
        } catch {
          setLinks((prev) => ({ ...prev, [s.id]: { status: 'error', link: '', message: '' } }))
        }
      }
    }
    await Promise.all([worker(), worker()])
  }

  const retryLink = async (s) => {
    setLinks((prev) => ({ ...prev, [s.id]: { status: 'pending', link: '', message: '' } }))
    try {
      const token = await getOrCreateStudentToken(s.id)
      if (!token) throw new Error('no token')
      const link = buildStudentQRLink(token)
      const message = buildQRMessage(s.name, link, ws.settings?.qr_message_template || '')
      setLinks((prev) => ({ ...prev, [s.id]: { status: 'ready', link, message } }))
    } catch {
      setLinks((prev) => ({ ...prev, [s.id]: { status: 'error', link: '', message: '' } }))
    }
  }

  const visibleCreated = created.filter((s) => {
    if (linkFilter === 'ready') return links[s.id]?.status === 'ready'
    if (linkFilter === 'nophone') return !isValidPhone(s.phone)
    return true
  })

  const readyCount = created.filter((s) => links[s.id]?.status === 'ready').length
  const pickedReady = created.filter((s) => picked.has(s.id) && links[s.id]?.status === 'ready')

  const togglePicked = (id) => setPicked((prev) => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const sendSelected = () => {
    if (!pickedReady.length) { ws.showToast?.(isArabic ? 'لا يوجد رسائل جاهزة للمحددين' : 'No ready messages for the selection', 'error'); return }
    const items = pickedReady.map((s) => ({ key: s.id, kind: 'qr_link', student: s, phone: normalizeEgyptianPhone(s.phone), message: links[s.id].message, qrUrl: links[s.id].link, template: ws.settings?.qr_message_template || '' }))
    ui.startQueue(items)
    onClose()
  }

  const copySelected = async () => {
    const targets = created.filter((s) => picked.has(s.id) && (links[s.id]?.status === 'ready' || isValidPhone(s.phone)))
    const text = targets.map((s) => {
      const msg = links[s.id]?.message
      if (msg) return `${s.name}\n${msg}`
      return `${s.name}\n${(ws.settings?.msg_welcome || 'مرحبًا {studentName}').replace('{studentName}', s.name)}`
    }).join('\n\n———\n\n')
    const ok = await copyText(text)
    ws.showToast?.(ok ? (isArabic ? `تم نسخ رسائل ${targets.length} طالب` : `Copied ${targets.length} messages`) : (isArabic ? 'تعذر النسخ' : 'Copy failed'), ok ? 'success' : 'error')
  }

  const problemsList = (list) => (
    <div className="nk-notice mb-3" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-strong)' }}>
      <b className="block mb-1">{isArabic ? 'أخطاء يجب إصلاحها قبل الحفظ:' : 'Fix before saving:'}</b>
      <ul className="list-disc ps-5 m-0">
        {list.map((p, i) => <li key={i}>{p.index >= 0 ? `${isArabic ? 'صف' : 'Row'} ${p.index + 1}: ` : ''}{p.reason}{p.label ? ` (${p.label})` : ''}</li>)}
      </ul>
    </div>
  )

  // ── RESULT SCREEN (spec 5–7) ───────────────────────────────────────────────
  if (step === 'result' && result) {
    return (
      <div className="fixed inset-0 z-[85] flex items-start justify-center bg-black/50 p-3 sm:p-6 overflow-y-auto" onClick={onClose} role="dialog" aria-modal="true">
        <div className="glass-card w-full max-w-2xl p-5 my-4" onClick={(e) => e.stopPropagation()}>
          <div className="text-center mb-4">
            <div className="text-3xl mb-1" aria-hidden="true">🎉</div>
            <h3 className="text-base font-black m-0">{isArabic ? 'تمت إضافة الطلاب بنجاح' : 'Students added successfully'}</h3>
            <p className="text-[.74rem] text-fg-muted m-0 mt-1">{isArabic ? `تمت إضافة ${created.length} طالب. جهّز رسائل الدخول وأرسلها للمحدد — لن يُرسل شيء تلقائيًا.` : `${created.length} students added. Prepare the access messages and send to your selection — nothing sends automatically.`}</p>
          </div>

          <div className="nk-att-chips mb-2">
            {[
              ['all', isArabic ? `الكل (${created.length})` : `All (${created.length})`],
              ['ready', isArabic ? `جاهزة للإرسال (${readyCount})` : `Ready (${readyCount})`],
              ['nophone', isArabic ? `بلا رقم صحيح (${created.filter((s) => !isValidPhone(s.phone)).length})` : `No phone (${created.filter((s) => !isValidPhone(s.phone)).length})`],
            ].map(([key, label]) => (
              <button key={key} onClick={() => setLinkFilter(key)} aria-pressed={linkFilter === key} className={linkFilter === key ? 'nk-att-chip nk-att-chip--on' : 'nk-att-chip'}>
                {label}
              </button>
            ))}
            <button className="nk-att-chip" onClick={() => setPicked(new Set(visibleCreated.filter((s) => links[s.id]?.status === 'ready' || isValidPhone(s.phone)).map((s) => s.id)))}>
              {isArabic ? '☐ تحديد الظاهرين' : '☐ Select visible'}
            </button>
          </div>

          <div className="grid gap-1.5 max-h-[44vh] overflow-y-auto mb-3">
            {visibleCreated.map((s) => {
              const link = links[s.id]
              const hasPhone = isValidPhone(s.phone)
              const isPicked = picked.has(s.id)
              return (
                <div key={s.id} className="nk-att-row" style={isPicked && hasPhone ? { borderColor: 'var(--brand-gold)', background: 'var(--brand-gold-surface)' } : undefined}>
                  <span className="nk-att-row__name">
                    <b className="truncate">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-[var(--brand-gold)] cursor-pointer me-2 align-middle"
                        checked={isPicked && hasPhone}
                        disabled={!hasPhone}
                        onChange={() => togglePicked(s.id)}
                      />
                      {s.name}
                    </b>
                    <small className="truncate">
                      {hasPhone ? `+${normalizeEgyptianPhone(s.phone)} · ${s.group_name || ''}${s.stage ? ` · ${s.stage}` : ''}` : (isArabic ? 'لا يوجد رقم واتساب صحيح' : 'No valid WhatsApp phone')}
                    </small>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {!hasPhone && <span className="nk-pill nk-pill-neutral">—</span>}
                    {hasPhone && link?.status === 'pending' && <span className="nk-pill nk-pill-neutral">… {isArabic ? 'جاري التجهيز' : 'Preparing'}</span>}
                    {hasPhone && link?.status === 'ready' && <span className="nk-pill nk-pill-live">✓ {isArabic ? 'جاهزة' : 'Ready'}</span>}
                    {hasPhone && link?.status === 'error' && (
                      <button className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.64rem] font-extrabold" onClick={() => retryLink(s)}>
                        ⟲ {isArabic ? 'إعادة المحاولة' : 'Retry'}
                      </button>
                    )}
                    {link?.status === 'ready' && (
                      <button
                        className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1.5 text-[.64rem] font-extrabold"
                        onClick={async () => { const ok = await copyText(link.message); ws.showToast?.(ok ? 'تم نسخ الرسالة ✓' : 'تعذر النسخ', ok ? 'success' : 'error') }}
                        title={isArabic ? 'نسخ الرسالة' : 'Copy message'}
                      >⧉</button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Message preview for the first ready student (context, spec 6) */}
          {pickedReady[0] && links[pickedReady[0].id]?.message && (
            <div className="rounded-xl p-3 mb-3 text-[.72rem] leading-6 whitespace-pre-line" style={{ background: 'var(--surface-container-high)', border: '1px solid var(--surface-border)' }}>
              <b className="block mb-1 text-[.68rem] text-fg-muted">{isArabic ? `معاينة رسالة ${pickedReady[0].name}:` : `Preview — ${pickedReady[0].name}:`}</b>
              {links[pickedReady[0].id].message}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-3" style={{ borderTop: '1px solid var(--surface-border)' }}>
            <button className="btn-gold action-button !min-h-[3rem]" disabled={pickedReady.length === 0} onClick={sendSelected}>
              ✆ {isArabic ? `إرسال إلى المحدد (${pickedReady.length})` : `Send to selected (${pickedReady.length})`}
            </button>
            <button className="btn-ghost action-button !min-h-[3rem]" onClick={copySelected}>
              ⧉ {isArabic ? 'نسخ الرسائل' : 'Copy messages'}
            </button>
            <button className="btn-ghost action-button !min-h-[3rem] ms-auto" onClick={onClose}>
              {isArabic ? 'عدم الإرسال الآن' : "Don't send now"}
            </button>
          </div>
          <p className="text-[.66rem] text-fg-muted m-0 mt-2">
            {isArabic ? 'الإرسال يفتح واتساب لكل طالب على حدة عبر قائمة الإرسال المعتادة — نفس نظام QR الحالي.' : 'Sending opens WhatsApp per student via the usual queue — the same existing QR system.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center bg-black/50 p-3 sm:p-6 overflow-y-auto" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-card w-full max-w-2xl p-5 my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-base font-extrabold m-0">{isArabic ? 'إضافة عدة طلاب' : 'Bulk add students'}</h3>
          <button className="btn-ghost rounded-lg px-3 py-1.5 text-[.72rem] font-extrabold" onClick={onClose}>✕</button>
        </div>
        <p className="text-[.7rem] text-fg-muted mt-0 mb-4">
          {step === 'edit' && (isArabic ? 'أدخل الطلاب في صفوف سريعة، ثم تحقق من الكل ← راجع ← احفظ الجميع مرة واحدة. اختيار المجموعة يحدد المرحلة تلقائيًا.' : 'Enter students in fast rows, then validate all → review → save all at once. Picking a group sets the stage automatically.')}
          {step === 'review' && (isArabic ? 'كل الصفوف صحيحة — اضغط حفظ الجميع للإضافة دفعة واحدة.' : 'All rows valid — save all at once.')}
        </p>

        {problems.length > 0 && step === 'edit' && problemsList(problems)}

        {step !== 'saving' && rows.map((row, i) => {
          const compatible = groupsForStage(row.stage)
          const rest = (ws.groups || []).filter((g) => !compatible.includes(g))
          return (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-2 mb-2 items-center">
              <input disabled={step === 'review'} className="glass-input rounded-xl px-3 py-2 text-sm" placeholder={isArabic ? `اسم الطالب ${i + 1}` : `Name ${i + 1}`} value={row.name} onChange={(e) => setRow(i, { name: e.target.value })} />
              <input dir="ltr" disabled={step === 'review'} className="glass-input rounded-xl px-3 py-2 text-sm" placeholder={isArabic ? 'الهاتف' : 'Phone'} value={row.phone} onChange={(e) => setRow(i, { phone: e.target.value })} />
              {/* Full-grade stage select (spec 1) — same canonical values as
                  single-add, not the bare category words. */}
              <select disabled={step === 'review'} className="glass-input rounded-xl px-2 py-2 text-[.72rem]" value={row.stage} onChange={(e) => setRowStage(i, e.target.value)}>
                <option value="">{isArabic ? 'المرحلة' : 'Stage'}</option>
                {Object.entries(GRADES_BY_STAGE).map(([category, grades]) => (
                  <optgroup key={category} label={category}>
                    {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                  </optgroup>
                ))}
              </select>
              <select disabled={step === 'review'} className="glass-input rounded-xl px-2 py-2 text-[.72rem]" value={row.group} onChange={(e) => setRowGroup(i, e.target.value)} title={isArabic ? 'المجموعة تحدد المرحلة' : 'The group determines the stage'}>
                <option value="">{isArabic ? 'المجموعة' : 'Group'}</option>
                {compatible.length > 0 && <optgroup label={isArabic ? 'متوافقة' : 'Compatible'}>
                  {compatible.map((g) => <option key={g} value={g}>{g}</option>)}
                </optgroup>}
                {rest.length > 0 && <optgroup label={isArabic ? 'مراحل أخرى' : 'Other stages'}>
                  {rest.map((g) => <option key={g} value={g}>{g}</option>)}
                </optgroup>}
              </select>
              <button disabled={step === 'review'} className="btn-ghost rounded-lg px-2.5 py-2 text-[.7rem] font-extrabold" onClick={() => removeRow(i)} aria-label={isArabic ? 'حذف الصف' : 'Remove row'}>✕</button>
            </div>
          )
        })}
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
