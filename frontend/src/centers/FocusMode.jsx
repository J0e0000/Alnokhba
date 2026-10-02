// ═══════════════════════════════════════════════════════════════════════════
// EL NO5BA CENTERS — FOCUS MODE
// The live-session workflow. Everything else is hidden; one workflow visible:
//   attendance taps (autosave) → notes (debounced autosave) → quick actions
//   → complete session → persistent success bar (طباعة / تراجع).
// Exit is always available and never discards work (autosave already wrote
// everything; exit just closes the focus overlay).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCenters } from './CentersStore'
import { attendanceFor, studentsOfGroup, saveSessionNotes } from './centersApi'
import { printSessionSummary } from './printCenters'

const GOLD = '#D4AF37'
const NAVY = '#0E2954'

const ATT_BTNS = [
  ['present', 'حاضر', '#16A34A'],
  ['late', 'متأخر', '#D97706'],
  ['absent', 'غائب', '#DC2626'],
  ['excused', 'إذن', '#2563EB'],
]

export default function FocusMode() {
  const { data, centerId, centers, focusSessionId, setFocusSessionId, markAttendance, saveNotes, changeStatus, changeTeacher, changeRoom, undo, redo, historyInfo, saveState } = useCenters()
  const session = data.sessions.find((s) => s.id === focusSessionId)
  const group = data.groups.find((g) => g.id === session?.group_id)
  const room = data.rooms.find((r) => r.id === session?.room_id)
  const teacher = data.teachers.find((t) => t.id === session?.teacher_id)
  const students = useMemo(() => (group ? studentsOfGroup(data.enrollments, data.students, group.id) : []), [data.enrollments, data.students, group])
  const rows = attendanceFor(data.attendance, focusSessionId)
  const attMap = useMemo(() => new Map(rows.map((a) => [a.student_id, a.status])), [rows])

  const [notes, setNotes] = useState(session?.notes || '')
  const [topic, setTopic] = useState(session?.topic || '')
  const lastSavedNotes = useRef(session?.notes || '')
  const [confirmExit, setConfirmExit] = useState(false)
  const [busyComplete, setBusyComplete] = useState(false)

  useEffect(() => {
    setNotes(session?.notes || '')
    setTopic(session?.topic || '')
    lastSavedNotes.current = session?.notes || ''
  }, [focusSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Z / Ctrl+Y global inside focus
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo().catch(() => {}) }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo().catch(() => {}) }
      if (e.key === 'Escape') setConfirmExit(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // FLUSH-ON-UNMOUNT: a note keystroke inside the 900ms autosave debounce
  // window must still land when Focus Mode closes (or the tab hides). Direct
  // save — no debounce — guarantees nothing is silently discarded.
  const latestRef = useRef({ id: null, notes: '', topic: '' })
  latestRef.current = { id: focusSessionId, notes, topic, baseNotes: session?.notes, baseTopic: session?.topic }
  useEffect(() => () => {
    const l = latestRef.current
    if (l.id && ((l.baseNotes || '') !== l.notes || (l.baseTopic || '') !== l.topic)) {
      saveSessionNotes(l.id, l.notes, l.topic).catch(() => {})
    }
  }, [])

  if (!session) return null

  const notesDirty = notes !== lastSavedNotes.current

  const onNotesChange = (v) => {
    setNotes(v)
    saveNotes(session.id, v, topic) // debounced inside store
    lastSavedNotes.current = v
  }
  const onTopicChange = (v) => {
    setTopic(v)
    saveNotes(session.id, notes, v)
  }

  const handleExit = () => {
    // Autosave already persisted everything; a keystroke still inside the
    // debounce window is flushed by the unmount effect (direct save).
    setConfirmExit(false)
    setFocusSessionId(null)
  }

  const complete = async () => {
    setBusyComplete(true)
    try {
      if (notesDirty) saveNotes(session.id, notes, topic)
      await changeStatus(session.id, 'completed', 'تم حفظ الحصة بنجاح')
    } catch { /* toast shown by caller shell */ }
    finally { setBusyComplete(false) }
  }

  const counts = { present: 0, late: 0, absent: 0, excused: 0 }
  students.forEach((s) => { counts[attMap.get(s.id) || 'absent'] += 1 })

  const saveDot = {
    idle: { c: '#94A3B8', t: '' },
    saving: { c: '#D97706', t: 'جاري الحفظ…' },
    saved: { c: '#16A34A', t: 'محفوظ ✓' },
    error: { c: '#DC2626', t: 'تعذر الحفظ' },
  }[saveState]

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: '#F1F5F9', overflowY: 'auto', direction: 'rtl', fontFamily: 'Cairo, Tahoma, sans-serif' }}>
      {/* Focus header — session identity + save state + undo + exit. No global nav. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: `linear-gradient(135deg, ${NAVY}, #142D62)`, color: '#fff', padding: '10px 14px', boxShadow: '0 2px 12px rgba(0,0,0,.25)' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>🎯 {group?.name || 'حصة'}</div>
            <div style={{ fontSize: 12, color: '#CBD5E1', marginTop: 2 }}>
              {teacher?.name || 'بدون معلم'} · {room?.name || 'بدون قاعة'} · {session.starts_at}–{session.ends_at} · {session.session_date}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,.1)', padding: '5px 10px', borderRadius: 999 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: saveDot.c, display: 'inline-block' }} />{saveDot.t}
            </span>
            <button onClick={() => undo().catch(() => {})} disabled={!historyInfo.canUndo}
              style={{ background: historyInfo.canUndo ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.06)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 10, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: historyInfo.canUndo ? 'pointer' : 'not-allowed' }}>
              ↩️ تراجع
            </button>
            <button onClick={() => setConfirmExit(true)}
              style={{ background: '#fff', color: NAVY, border: 0, borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
              ✕ خروج
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 880, margin: '14px auto', padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 1) Attendance — the #1 action */}
        <section style={{ background: '#fff', border: '1px solid rgba(14,41,84,.1)', borderRadius: 14, padding: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: NAVY, flex: 1 }}>✅ الحضور — رصد فوري</h3>
            <span style={{ fontSize: 11, color: '#64748B' }}>
              حاضر {counts.present} · متأخر {counts.late} · غائب {counts.absent} · إذن {counts.excused}
            </span>
          </div>
          {students.length === 0 && (
            <p style={{ fontSize: 13, color: '#64748B', margin: '6px 0' }}>لا يوجد طلاب مسجّلين في هذه المجموعة — أضفهم من تبويب «الطلاب والمعلمون».</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
            {students.map((s) => {
              const cur = attMap.get(s.id)
              return (
                <div key={s.id} style={{ border: `1px solid ${cur ? 'rgba(212,175,55,.55)' : 'rgba(14,41,84,.1)'}`, borderRadius: 12, padding: '8px 10px', background: cur ? 'rgba(212,175,55,.06)' : '#fff' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {ATT_BTNS.map(([val, label, color]) => (
                      <button key={val} onClick={() => markAttendance(session.id, s.id, val).catch(() => {})}
                        style={{
                          flex: 1, fontSize: 11, fontWeight: 800, padding: '6px 2px', borderRadius: 8, cursor: 'pointer',
                          border: `1.5px solid ${cur === val ? color : 'rgba(14,41,84,.15)'}`,
                          background: cur === val ? color : '#fff',
                          color: cur === val ? '#fff' : '#334155',
                        }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* 2) Notes + topic */}
        <section style={{ background: '#fff', border: '1px solid rgba(14,41,84,.1)', borderRadius: 14, padding: 14 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800, color: NAVY }}>📝 ملاحظات الحصة <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>(حفظ تلقائي)</span></h3>
          <input value={topic} onChange={(e) => onTopicChange(e.target.value)} placeholder="موضوع الحصة (اختياري)"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid rgba(14,41,84,.15)', borderRadius: 10, padding: '9px 12px', fontSize: 13, marginBottom: 8, fontFamily: 'inherit' }} />
          <textarea value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={3} placeholder="ما حدث في الحصة… الواجب… تنبيهات…"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid rgba(14,41,84,.15)', borderRadius: 10, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
        </section>

        {/* 3) Quick assignments + actions */}
        <section style={{ background: '#fff', border: '1px solid rgba(14,41,84,.1)', borderRadius: 14, padding: 14 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800, color: NAVY }}>⚡ إجراءات سريعة</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <label style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>
              المعلم
              <select value={session.teacher_id || ''} onChange={(e) => changeTeacher(session.id, e.target.value || null).catch(() => {})}
                style={{ display: 'block', marginTop: 4, border: '1px solid rgba(14,41,84,.15)', borderRadius: 10, padding: '8px 10px', fontSize: 13, minWidth: 150 }}>
                <option value="">— بدون —</option>
                {data.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>
              القاعة
              <select value={session.room_id || ''} onChange={(e) => changeRoom(session.id, e.target.value || null).catch(() => {})}
                style={{ display: 'block', marginTop: 4, border: '1px solid rgba(14,41,84,.15)', borderRadius: 10, padding: '8px 10px', fontSize: 13, minWidth: 150 }}>
                <option value="">— بدون —</option>
                {data.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <button onClick={() => printSessionSummary({
              centerName: centers.find((c) => c.id === centerId)?.name, session, group, teacher, room,
              students, attendanceRows: rows,
            })}
              style={{ alignSelf: 'flex-end', background: '#fff', border: `1.5px solid ${NAVY}`, color: NAVY, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
              🖨️ طباعة الملخص
            </button>
            {session.status !== 'cancelled' && (
              <button onClick={() => { changeStatus(session.id, 'cancelled').catch(() => {}); setFocusSessionId(null) }}
                style={{ alignSelf: 'flex-end', background: '#fff', border: '1.5px solid #DC2626', color: '#DC2626', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                🚫 إلغاء الحصة
              </button>
            )}
          </div>
        </section>

        {/* 4) Complete session — the finishing action */}
        {session.status !== 'completed' ? (
          <button onClick={complete} disabled={busyComplete}
            style={{ background: `linear-gradient(135deg, ${GOLD}, #E7C565)`, color: NAVY, border: 0, borderRadius: 14, padding: '15px 18px', fontSize: 16, fontWeight: 900, cursor: busyComplete ? 'wait' : 'pointer', boxShadow: '0 6px 18px rgba(212,175,55,.35)' }}>
            {busyComplete ? 'جاري الحفظ…' : '✅ إنهاء الحصة وحفظها'}
          </button>
        ) : (
          <div style={{ background: '#F0FDF4', border: '1.5px solid #16A34A', borderRadius: 14, padding: '13px 16px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ fontWeight: 800, color: '#166534', flex: 1 }}>✅ هذه الحصة محفوظة كـ«تمت»</span>
            <button onClick={() => printSessionSummary({ centerName: centers.find((c) => c.id === centerId)?.name, session, group, teacher, room, students, attendanceRows: rows })}
              style={{ background: GOLD, border: 0, color: NAVY, borderRadius: 10, padding: '8px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>🖨️ طباعة</button>
            <button onClick={() => changeStatus(session.id, 'live', null).catch(() => {})}
              style={{ background: '#fff', border: `1.5px solid ${NAVY}`, color: NAVY, borderRadius: 10, padding: '8px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>إعادة فتح</button>
          </div>
        )}
      </div>

      {/* Exit confirmation — never silently discard; autosave means this is safe */}
      {confirmExit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,16,32,.55)', zIndex: 90, display: 'grid', placeItems: 'center', padding: 16 }} onClick={() => setConfirmExit(false)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, maxWidth: 380, width: '100%', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 30 }}>🚪</div>
            <h3 style={{ margin: '8px 0 6px', color: NAVY, fontSize: 16, fontWeight: 800 }}>الخروج من الحصة؟</h3>
            <p style={{ fontSize: 13, color: '#475569', margin: '0 0 14px' }}>كل التعديلات محفوظة تلقائيًا. تقدر ترجع للحصة في أي وقت من تبويب «اليوم».</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setConfirmExit(false)} style={{ background: '#fff', border: `1.5px solid ${NAVY}`, color: NAVY, borderRadius: 10, padding: '9px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>بقاء</button>
              <button onClick={handleExit} style={{ background: NAVY, border: 0, color: '#fff', borderRadius: 10, padding: '9px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>خروج وحفظ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
