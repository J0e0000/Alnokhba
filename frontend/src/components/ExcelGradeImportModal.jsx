import { useCallback, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import Modal from './Modal'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { pingPortalRefresh } from '../lib/portalRealtime'
import { normalizeStudentName } from '../lib/qrAttendance'

/**
 * استيراد درجات Excel (Round 9 — إعادة بناء متطابقة مع سلوك الإنتاج).
 * المسار: رفع → مطابقة الأعمدة → مراجعة (تطابق الطلاب + السياسات) → استيراد.
 * السيرفر: rpc import_exam_grades({ p_exam_id, p_rows, p_expected_version,
 *   p_options: { filename, conflict_policy }, p_reason })
 *   p_rows = [{ student_id, score, row_index, row_label, allow_update }]
 */
const NAME_HEADERS = ['الاسم', 'اسم الطالب', 'الطالب', 'name', 'student', 'student name']
const GRADE_HEADERS = ['الدرجة', 'درجة', 'النتيجة', 'نتيجة', 'المجموع', 'المجموع الكلي', 'grade', 'score', 'mark', 'total']
const CODE_HEADERS = ['الكود', 'كود الطالب', 'كود', 'code', 'id', 'student code']
const GROUP_HEADERS = ['المجموعة', 'مجموعة', 'group', 'المجموعة الدراسية']

const headerKey = (h) => String(h || '').trim().toLowerCase().replace(/[\u064B-\u065F\u0640]/g, '')

const detectColumn = (headers, candidates) => {
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => headerKey(h) === headerKey(cand))
    if (idx >= 0) return headers[idx]
  }
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => headerKey(h).includes(headerKey(cand)))
    if (idx >= 0) return headers[idx]
  }
  return null
}

const parseScore = (raw, maxTotal) => {
  if (raw === null || raw === undefined || raw === '') return { ok: false, reason: 'empty' }
  const num = Number(String(raw).replace(/[٫,]/g, '.').replace(/[^\d.\-]/g, ''))
  if (!Number.isFinite(num)) return { ok: false, reason: 'not_number' }
  if (num < 0) return { ok: false, reason: 'negative' }
  if (maxTotal > 0 && num > maxTotal) return { ok: false, reason: 'over_max' }
  return { ok: true, value: Math.round(num * 100) / 100 }
}

export default function ExcelGradeImportModal({ open, onClose, exam, students, existingScoreStudentIds, absentStudentIds, teacherId, onDone }) {
  const { showToast } = useToast()
  const [step, setStep] = useState('upload') // upload | mapping | review | done
  const [fileName, setFileName] = useState('')
  const [rawRows, setRawRows] = useState([])
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({ name: '', grade: '', code: '', group: '' })
  const [rows, setRows] = useState([])
  const [policy, setPolicy] = useState('ask') // ask | skip | update
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const maxTotal = useMemo(() => {
    const per = Number(exam?.max_score_per_section) || 0
    const sections = exam?.sections?.length || 0
    return Math.round(per * sections * 100) / 100
  }, [exam])

  const reset = () => {
    setStep('upload'); setFileName(''); setRawRows([]); setHeaders([])
    setMapping({ name: '', grade: '', code: '', group: '' }); setRows([])
    setPolicy('ask'); setBusy(false); setResult(null)
  }

  const close = () => { reset(); onClose() }

  // ── الخطوة 1: قراءة الملف ──
  const onPickFile = useCallback(async (evt) => {
    const file = evt.target.files?.[0]
    evt.target.value = ''
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
      if (!json.length) { showToast('الملف فاضي — مفيش صفوف للقراءة.', 'error'); return }
      const cols = Object.keys(json[0] || {})
      const auto = {
        name: detectColumn(cols, NAME_HEADERS) || '',
        grade: detectColumn(cols, GRADE_HEADERS) || '',
        code: detectColumn(cols, CODE_HEADERS) || '',
        group: detectColumn(cols, GROUP_HEADERS) || '',
      }
      setFileName(file.name)
      setRawRows(json)
      setHeaders(cols)
      setMapping(auto)
      setStep('mapping')
    } catch (err) {
      console.error('Excel parse failed:', err)
      showToast('تعذر فتح الملف — تأكد إنه ملف Excel/CSV صحيح.', 'error')
    }
  }, [showToast])

  // ── الخطوة 2: بناء صفوف المراجعة ──
  const buildReview = useCallback(() => {
    if (!mapping.name) { showToast('اختار عمود الاسم الأول', 'error'); return }
    if (!mapping.grade) { showToast('اختار عمود الدرجة', 'error'); return }
    const base = rawRows
      .map((r, i) => ({
        rowIndex: i + 2, // +2 = صف العنوان + 1-based
        name: String(r[mapping.name] ?? '').trim(),
        code: mapping.code ? String(r[mapping.code] ?? '').trim() : '',
        group: mapping.group ? String(r[mapping.group] ?? '').trim() : '',
        rawScore: r[mapping.grade],
      }))
      .filter((r) => r.name)

    // كشف التكرار داخل الملف نفسه (نفس الاسم + الكود)
    const seen = new Map()
    base.forEach((r) => {
      const key = normalizeStudentName(r.name) + '|' + r.code
      seen.set(key, (seen.get(key) || 0) + 1)
    })

    // فهرس الطلاب للبحث السريع
    const byCode = new Map()
    const byName = new Map()
    students.forEach((s) => {
      if (s.code) byCode.set(String(s.code).trim(), s)
      const nk = normalizeStudentName(s.name)
      if (!byName.has(nk)) byName.set(nk, [])
      byName.get(nk).push(s)
    })

    const built = base.map((r) => {
      const grade = parseScore(r.rawScore, maxTotal)
      // التطابق: كود دقيق أولاً، بعدها الاسم المطبع
      let student = null
      let state = 'needs_decision'
      if (r.code && byCode.has(r.code)) {
        student = byCode.get(r.code)
        state = 'exact_code'
      } else {
        const candidates = byName.get(normalizeStudentName(r.name)) || []
        if (candidates.length === 1) {
          student = candidates[0]
          const inGroup = !r.group || normalizeStudentName(r.group) === normalizeStudentName(student.group_name || '')
          state = inGroup ? 'high' : 'medium'
        } else if (candidates.length > 1) {
          // لو فيه أكتر من طالب بنفس الاسم — حاول المجموعة تحسم
          const groupMatches = r.group
            ? candidates.filter((s) => normalizeStudentName(s.group_name || '') === normalizeStudentName(r.group))
            : []
          if (groupMatches.length === 1) { student = groupMatches[0]; state = 'high' }
          else state = 'needs_decision'
        } else {
          state = 'unmatched'
        }
      }
      const dupInFile = seen.get(normalizeStudentName(r.name) + '|' + r.code) > 1
      if (dupInFile && (state === 'exact_code' || state === 'high')) state = 'medium'
      return { ...r, grade, student, state, dupInFile, decision: null }
    })
    setRows(built)
    setStep('review')
  }, [mapping, rawRows, students, maxTotal, showToast])

  // ── حالة كل صف بعد القرارات والسياسة ──
  const existingIds = existingScoreStudentIds || null
  const absentIds = absentStudentIds || null
  const rowStatus = useCallback((row) => {
    if (!row.grade.ok) return { status: 'invalid' }
    if (row.decision === 'skip') return { status: 'skipped' }
    const studentId = row.decision?.studentId || row.student?.id || null
    if (!studentId) return { status: 'unmatched' }
    if (absentIds?.has?.(studentId)) return { status: 'absent', studentId }
    if (existingIds?.has?.(studentId)) {
      if (row.decision?.allowUpdate === true) return { status: 'ready', studentId, allowUpdate: true }
      if (policy === 'update') return { status: 'ready', studentId, allowUpdate: true }
      if (policy === 'skip') return { status: 'skipped', studentId }
      return { status: 'conflict', studentId }
    }
    return { status: 'ready', studentId }
  }, [existingIds, absentIds, policy])

  const stats = useMemo(() => {
    const s = { ready: 0, conflict: 0, needs_decision: 0, invalid: 0, absent: 0, skipped: 0, unmatched: 0 }
    rows.forEach((r) => {
      const st = rowStatus(r).status
      if (st === 'ready') s.ready++
      else if (st === 'conflict') s.conflict++
      else if (st === 'needs_decision' || st === 'unmatched') s.needs_decision++
      else if (st === 'invalid') s.invalid++
      else if (st === 'absent') s.absent++
      else s.skipped++
    })
    return s
  }, [rows, rowStatus])

  const setRowDecision = (rowIndex, decision) => {
    setRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, decision } : r)))
  }

  const skipAllDecisions = () => {
    setRows((prev) => prev.map((r) => {
      const st = rowStatus(r).status
      return (st === 'conflict' || st === 'needs_decision' || st === 'unmatched') ? { ...r, decision: 'skip' } : r
    }))
  }

  // ── الخطوة 3: الاستيراد ──
  const runImport = useCallback(async () => {
    if (!exam || busy) return
    const readyRows = []
    for (const row of rows) {
      const st = rowStatus(row)
      if (st.status === 'ready') {
        readyRows.push({
          student_id: st.studentId,
          score: row.grade.value,
          row_index: row.rowIndex,
          row_label: row.name,
          allow_update: st.allowUpdate === true,
        })
      }
    }
    if (!readyRows.length) { showToast('مفيش درجات جاهزة للاستيراد — راجع الصفوف الأول.', 'error'); return }
    if (new Set(readyRows.map((r) => r.student_id)).size !== readyRows.length) {
      showToast('فيه طالب مكرر في الاختيارات — راجع الصفوف.', 'error'); return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('import_exam_grades', {
        p_exam_id: exam.id,
        p_rows: readyRows,
        p_expected_version: exam.version ?? 1,
        p_options: {
          filename: fileName,
          conflict_policy: policy === 'update' ? 'update' : 'skip',
        },
        p_reason: 'استيراد Excel',
      })
      if (error) throw error
      setResult(data)
      setStep('done')
      showToast(`تم استيراد ${data?.inserted ?? 0} درجة جديدة وتحديث ${data?.updated ?? 0} (تخطي ${data?.skipped ?? 0}).`, 'success', 6000)
      try { if (teacherId) pingPortalRefresh(teacherId, 'excel-import') } catch { /* polling covers it */ }
      onDone?.()
    } catch (err) {
      const msg = String(err?.message || err || 'حدث خطأ')
      showToast(`الاستيراد رُفض بالكامل (مفيش أي حاجة اتكتبت): ${msg}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [exam, rows, rowStatus, busy, policy, fileName, teacherId, showToast, onDone])

  if (!exam) return null

  const policyOptions = [
    ['ask', 'اسأل لكل طالب (الأأمن)'],
    ['skip', 'تخطّي الكل'],
    ['update', 'استبدال الكل بـ Excel'],
  ]

  const stateBadge = {
    exact_code: { label: '🎯 تطابق بالكود', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
    high: { label: '✅ تطابق', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
    medium: { label: '⚠️ راجع التطابق', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
    needs_decision: { label: '❓ اختر الطالب', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
    unmatched: { label: '❓ اختر الطالب', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  }

  return (
    <Modal open={open} onClose={close} title={`استيراد درجات Excel — ${exam.title}`} wide>
      {step === 'upload' && (
        <div className="text-center py-6 space-y-3">
          <div className="text-4xl">📥</div>
          <p className="text-sm text-fg">ارفع ملف Excel فيه درجات الطلاب — اسم الطالب + الدرجة (والكود لو متاح).</p>
          <p className="text-[11px] text-fg-subtle leading-6">
            النظام بيكتشف الأعمدة لوحده (عربي/إنجليزي)، وبيطابق الطلاب بذكاء بالكود أو الاسم،
            وبيوريك مراجعة كاملة قبل كتابة أي درجة. الدرجة العظمى: {maxTotal}.
          </p>
          <label className="inline-block gap-2 rounded-xl px-6 py-3 text-sm font-black cursor-pointer btn-glow">
            📂 اختيار ملف Excel
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onPickFile} />
          </label>
        </div>
      )}

      {step === 'mapping' && (
        <div className="space-y-4">
          <p className="text-sm font-bold text-fg">📄 {fileName} — {rawRows.length} صف</p>
          <p className="text-[11px] text-fg-subtle leading-6">تأكد إن كل عمود متعين صح. الأعمدة المتكشفة تلقائيًا معلمة مسبقًا — عدّلها لو محتاج.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {(['name', 'grade', 'code', 'group'] ).map((key) => (
              <label key={key} className="text-xs font-bold text-fg-subtle">
                {key === 'name' ? 'عمود اسم الطالب *' : key === 'grade' ? 'عمود الدرجة *' : key === 'code' ? 'عمود الكود (اختياري)' : 'عمود المجموعة (اختياري)'}
                <select
                  value={mapping[key]}
                  onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
                  className="mt-1 w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none"
                >
                  <option value="">— غير محدد —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={buildReview} className="flex-1 btn-glow rounded-xl py-2.5 text-sm font-black">التالي: مراجعة الدرجات</button>
            <button type="button" onClick={reset} className="glass-input rounded-xl py-2.5 px-4 text-sm font-bold text-fg-subtle">إلغاء</button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black text-fg-subtle">السياسة عند وجود درجة قائمة:</span>
            {policyOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPolicy(value)}
                className={`flex-1 min-w-[120px] text-[11px] font-bold rounded-lg px-2 py-1.5 border transition-colors ${policy === value ? 'bg-brand-gold/20 border-brand-gold text-brand-gold-hover' : 'glass-input border-subtle text-fg-subtle'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center text-[11px] font-bold">
            <div className="glass-input border border-subtle rounded-xl p-2"><p className="text-lg font-black text-emerald-400">{stats.ready}</p><p className="text-fg-subtle">جاهزة</p></div>
            <div className="glass-input border border-subtle rounded-xl p-2"><p className="text-lg font-black text-amber-400">{stats.needs_decision}</p><p className="text-fg-subtle">تحتاج قرار</p></div>
            <div className="glass-input border border-subtle rounded-xl p-2"><p className="text-lg font-black text-violet-400">{stats.conflict}</p><p className="text-fg-subtle">تعارض</p></div>
            <div className="glass-input border border-subtle rounded-xl p-2"><p className="text-lg font-black text-rose-400">{stats.absent}</p><p className="text-fg-subtle">غايبين</p></div>
            <div className="glass-input border border-subtle rounded-xl p-2"><p className="text-lg font-black text-fg-muted">{stats.invalid}</p><p className="text-fg-subtle">درجة غير صالحة</p></div>
            <div className="glass-input border border-subtle rounded-xl p-2"><p className="text-lg font-black text-fg-muted">{stats.skipped}</p><p className="text-fg-subtle">متخطاة</p></div>
          </div>

          <div className="max-h-[46vh] overflow-y-auto space-y-2 pr-1">
            {rows.map((row) => {
              const st = rowStatus(row)
              const candidates = students.filter((s) => normalizeStudentName(s.name) === normalizeStudentName(row.name))
              return (
                <div key={row.rowIndex} className={`glass-input border rounded-xl p-2.5 flex flex-wrap items-center gap-2 ${st.status === 'ready' ? 'border-emerald-500/25' : st.status === 'invalid' || st.status === 'absent' ? 'border-rose-500/30' : 'border-amber-500/30'}`}>
                  <span className="text-[10px] font-mono text-fg-subtle w-8">#{row.rowIndex}</span>
                  <span className="text-xs font-bold text-fg min-w-[120px] truncate">{row.name}</span>
                  {row.code && <span className="text-[10px] font-mono text-fg-subtle" dir="ltr">{row.code}</span>}
                  <input
                    type="number"
                    step="0.5"
                    value={row.grade.ok ? row.grade.value : String(row.rawScore ?? '')}
                    onChange={(e) => {
                      const val = e.target.value
                      setRows((prev) => prev.map((r) => (r.rowIndex === row.rowIndex ? { ...r, rawScore: val, grade: parseScore(val, maxTotal) } : r)))
                    }}
                    className={`w-20 glass-input border rounded-lg px-2 py-1 text-xs text-center outline-none ${row.grade.ok ? 'border-subtle text-fg' : 'border-rose-500/50 text-rose-300'}`}
                    title={row.grade.ok ? '' : row.grade.reason === 'over_max' ? `أكبر من العظمى (${maxTotal})` : 'درجة غير صالحة'}
                  />
                  {row.student && !row.decision && <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 border ${stateBadge[row.state]?.cls || ''}`}>{stateBadge[row.state]?.label || row.state}</span>}
                  {row.student && <span className="text-[10px] text-fg-subtle truncate max-w-[140px]">→ {row.student.name} {row.student.group_name ? `· ${row.student.group_name}` : ''}</span>}

                  {(st.status === 'needs_decision' || st.status === 'unmatched' || row.state === 'needs_decision') && (
                    <select
                      value={row.decision?.studentId || ''}
                      onChange={(e) => setRowDecision(row.rowIndex, e.target.value ? { studentId: e.target.value } : null)}
                      className="glass-input border border-subtle rounded-lg px-2 py-1 text-[11px] text-fg outline-none min-w-[160px]"
                    >
                      <option value="">— اختر الطالب —</option>
                      {(candidates.length ? candidates : students).slice(0, 60).map((s) => (
                        <option key={s.id} value={s.id}>{s.name} {s.code ? `(${s.code})` : ''} {s.group_name ? `· ${s.group_name}` : ''}</option>
                      ))}
                    </select>
                  )}
                  {st.status === 'conflict' && row.decision?.studentId == null && (
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => setRowDecision(row.rowIndex, { studentId: st.studentId, allowUpdate: true })} className="text-[10px] font-black rounded-lg px-2 py-1 border border-violet-500/40 bg-violet-500/10 text-violet-300">↻ استبدال درجته</button>
                      <button type="button" onClick={() => setRowDecision(row.rowIndex, 'skip')} className="text-[10px] font-black rounded-lg px-2 py-1 border border-subtle glass-input text-fg-subtle">تخطي</button>
                    </div>
                  )}
                  {st.status === 'absent' && <span className="text-[10px] font-bold text-rose-300">⛔ غايب يوم الامتحان — مش هيترصد</span>}
                  {st.status === 'invalid' && <span className="text-[10px] font-bold text-rose-300">⛔ درجة غير صالحة</span>}
                  {row.decision === 'skip' && <span className="text-[10px] font-bold text-fg-subtle">متخطى</span>}
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-subtle">
            <button type="button" onClick={runImport} disabled={busy || stats.ready === 0} className="flex-1 btn-glow rounded-xl py-2.5 text-sm font-black disabled:opacity-40">
              {busy ? '⏳ جاري الاستيراد...' : `📥 استيراد ${stats.ready} درجة`}
            </button>
            <button type="button" onClick={skipAllDecisions} className="glass-input rounded-xl py-2.5 px-4 text-xs font-bold text-fg-subtle">تخطي كل القرارات المعلقة</button>
            <button type="button" onClick={reset} className="glass-input rounded-xl py-2.5 px-4 text-xs font-bold text-fg-subtle">ملف تاني</button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-6 space-y-4">
          <div className="text-4xl">🎉</div>
          <p className="text-sm font-black text-fg">تم استيراد درجات «{exam.title}» بنجاح</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="glass-input border border-subtle rounded-xl p-3">
              <p className="text-xl font-black text-emerald-400">{result?.inserted ?? 0}</p>
              <p className="text-[11px] text-fg-subtle">درجة جديدة</p>
            </div>
            <div className="glass-input border border-subtle rounded-xl p-3">
              <p className="text-xl font-black text-violet-400">{result?.updated ?? 0}</p>
              <p className="text-[11px] text-fg-subtle">تم تحديثها</p>
            </div>
            <div className="glass-input border border-subtle rounded-xl p-3">
              <p className="text-xl font-black text-fg-muted">{result?.skipped ?? 0}</p>
              <p className="text-[11px] text-fg-subtle">تم تخطيها</p>
            </div>
          </div>
          <button type="button" onClick={close} className="btn-glow rounded-xl px-6 py-2.5 text-sm font-black">تمام</button>
        </div>
      )}
    </Modal>
  )
}
