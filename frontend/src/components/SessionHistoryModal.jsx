import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Modal from './Modal'
import { useAuth } from '../context/AuthContext'

/**
 * سجل حصص المجموعة (دفتر اليوم).
 *
 * Round 7 (instant sync): while the modal is open it now subscribes to
 * session_logs changes for this teacher — when a lesson is finalized (from
 * THIS device, another device, or the offline-queue flush) the entry appears
 * here instantly. Previously the list was frozen at open time, so the سجل
 * looked "not in sync" with الحصص until the teacher closed and reopened it.
 */
export default function SessionHistoryModal({ open, onClose, groupName }) {
  const { effectiveTeacherId } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open || !groupName) return
    setLoading(true)
    // SECURITY (migration_019): filter by BOTH teacher_id AND group_name.
    // group_name is a free-text field that is NOT unique across teachers
    // (multiple teachers can have a group named "المجموعة الافتراضية").
    // Filtering by group_name alone would leak session history across
    // teachers — fixed here.
    if (!effectiveTeacherId) {
      setRows([])
      setLoading(false)
      return
    }
    supabase.from('session_logs')
      .select('*')
      .eq('teacher_id', effectiveTeacherId)
      .eq('group_name', groupName)
      .order('session_date', { ascending: false })
      .then(({ data }) => { setRows(data ?? []); setLoading(false) })
  }, [open, groupName, effectiveTeacherId])

  // Live updates while open (Round 7). The Arabic group name is compared
  // client-side because realtime text filters with non-ASCII values are not
  // reliably supported across realtime versions.
  useEffect(() => {
    if (!open || !groupName || !effectiveTeacherId) return undefined
    let channel
    try {
      channel = supabase.channel(`session-history-${effectiveTeacherId}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'session_logs', filter: `teacher_id=eq.${effectiveTeacherId}` }, (payload) => {
          const row = payload.eventType === 'DELETE' ? payload.old : payload.new
          if (!row || row.group_name !== groupName) return
          setRows((prev) => {
            if (payload.eventType === 'DELETE') return prev.filter((r) => r.id !== row.id)
            const idx = prev.findIndex((r) => r.id === row.id)
            if (idx === -1) {
              // New finalized lesson — insert in date order (newest first).
              const next = [row, ...prev]
              next.sort((a, b) => String(b.session_date || '').localeCompare(String(a.session_date || '')))
              return next
            }
            const copy = [...prev]
            copy[idx] = row
            return copy
          })
        })
        .subscribe()
    } catch {
      // realtime unavailable — the modal still shows the rows it loaded
    }
    return () => { try { supabase.removeChannel(channel) } catch { /* already closed */ } }
  }, [open, groupName, effectiveTeacherId])

  return (
    <Modal open={open} onClose={onClose} title={`سجل حصص: ${groupName || ''}`}>
      {loading ? (
        <p className="text-fg-subtle text-sm text-center py-4">جاري التحميل...</p>
      ) : rows.length === 0 ? (
        <p className="text-fg-subtle text-sm text-center py-4">لا يوجد سجل حصص لهذه المجموعة بعد.</p>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="glass-input border border-subtle rounded-lg p-3">
              <p className="text-xs text-fg-subtle font-bold mb-1">{new Date(r.session_date).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              {r.lesson_topic && <p className="text-sm text-fg"><span className="text-brand-gold-hover font-bold">📚 الدرس:</span> {r.lesson_topic}</p>}
              {r.homework_text && <p className="text-sm text-fg mt-1"><span className="text-brand-gold-hover font-bold">📝 الواجب:</span> {r.homework_text}</p>}
              {!r.lesson_topic && !r.homework_text && <p className="text-xs text-fg-subtle">لا توجد بيانات مسجّلة لهذا اليوم.</p>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
