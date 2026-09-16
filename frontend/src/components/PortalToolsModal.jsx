/**
 * PortalToolsModal — teacher-side panel to:
 *  1) Send announcements (to all students, or one specific student) — shows
 *     up in each student's portal (/qr/:token) instantly, no WhatsApp needed.
 *  2) Create homework tasks for a group — students/parents check them off
 *     from their portal.
 *  3) Set/update the teacher's WhatsApp number used by the portal's
 *     "تواصل مع المستر" button.
 *
 * Self-contained: only needs `teacherId` + `students` (both already
 * available in Dashboard.jsx state) and `open`/`onClose`.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function PortalToolsModal({ open, onClose, teacherId, students = [] }) {
  const [tab, setTab] = useState('announcement') // announcement | homework | settings

  // Announcement form
  const [annTitle, setAnnTitle] = useState('')
  const [annMessage, setAnnMessage] = useState('')
  const [annTarget, setAnnTarget] = useState('all') // 'all' or student id
  const [annSending, setAnnSending] = useState(false)
  const [announcements, setAnnouncements] = useState([])

  // Homework form
  const groupNames = useMemo(() => {
    const set = new Set(students.map((s) => s.group_name).filter(Boolean))
    return Array.from(set)
  }, [students])
  const [hwGroup, setHwGroup] = useState('')
  const [hwTitle, setHwTitle] = useState('')
  const [hwDue, setHwDue] = useState('')
  const [hwSending, setHwSending] = useState(false)
  const [homeworkTasks, setHomeworkTasks] = useState([])

  // WhatsApp number setting
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [waSaving, setWaSaving] = useState(false)
  const [waSaved, setWaSaved] = useState(false)

  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!open || !teacherId) return
    ;(async () => {
      const [annRes, hwRes, settingsRes] = await Promise.all([
        supabase.from('announcements').select('id, title, message, student_id, created_at').eq('teacher_id', teacherId).order('created_at', { ascending: false }).limit(20),
        supabase.from('homework_tasks').select('id, group_name, title, due_date, created_at').eq('teacher_id', teacherId).order('created_at', { ascending: false }).limit(20),
        supabase.from('teacher_settings').select('whatsapp_number').eq('teacher_id', teacherId).maybeSingle(),
      ])
      setAnnouncements(annRes.data || [])
      setHomeworkTasks(hwRes.data || [])
      setWhatsappNumber(settingsRes.data?.whatsapp_number || '')
    })()
  }, [open, teacherId])

  if (!open) return null

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const handleSendAnnouncement = async () => {
    if (!annTitle.trim() || !annMessage.trim() || annSending) return
    setAnnSending(true)
    try {
      const { data, error } = await supabase.from('announcements').insert({
        teacher_id: teacherId,
        student_id: annTarget === 'all' ? null : annTarget,
        title: annTitle.trim(),
        message: annMessage.trim(),
      }).select().single()
      if (error) throw error
      setAnnouncements((prev) => [data, ...prev])
      setAnnTitle('')
      setAnnMessage('')
      showToast('تم إرسال الإعلان ✅')
    } catch (err) {
      console.error(err)
      showToast('حدث خطأ أثناء الإرسال')
    } finally {
      setAnnSending(false)
    }
  }

  const handleDeleteAnnouncement = async (id) => {
    await supabase.from('announcements').delete().eq('id', id)
    setAnnouncements((prev) => prev.filter((a) => a.id !== id))
  }

  const handleCreateHomework = async () => {
    if (!hwGroup || !hwTitle.trim() || hwSending) return
    setHwSending(true)
    try {
      const { data, error } = await supabase.from('homework_tasks').insert({
        teacher_id: teacherId,
        group_name: hwGroup,
        title: hwTitle.trim(),
        due_date: hwDue || null,
      }).select().single()
      if (error) throw error
      setHomeworkTasks((prev) => [data, ...prev])
      setHwTitle('')
      setHwDue('')
      showToast('تم إضافة الواجب ✅')
    } catch (err) {
      console.error(err)
      showToast('حدث خطأ أثناء الإضافة')
    } finally {
      setHwSending(false)
    }
  }

  const handleDeleteHomework = async (id) => {
    await supabase.from('homework_tasks').delete().eq('id', id)
    setHomeworkTasks((prev) => prev.filter((h) => h.id !== id))
  }

  const handleSaveWhatsapp = async () => {
    if (waSaving) return
    setWaSaving(true)
    try {
      const { error } = await supabase.from('teacher_settings')
        .upsert({ teacher_id: teacherId, whatsapp_number: whatsappNumber.trim() }, { onConflict: 'teacher_id' })
      if (error) throw error
      setWaSaved(true)
      showToast('تم الحفظ ✅')
      setTimeout(() => setWaSaved(false), 2000)
    } catch (err) {
      console.error(err)
      showToast('حدث خطأ أثناء الحفظ')
    } finally {
      setWaSaving(false)
    }
  }

  const studentName = (id) => students.find((s) => s.id === id)?.name || 'طالب محذوف'

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <h2 style={headerTitle}>أدوات البوابة</h2>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={tabRow}>
          <TabBtn active={tab === 'announcement'} onClick={() => setTab('announcement')}>الإعلانات</TabBtn>
          <TabBtn active={tab === 'homework'} onClick={() => setTab('homework')}>الواجبات</TabBtn>
          <TabBtn active={tab === 'settings'} onClick={() => setTab('settings')}>واتساب المستر</TabBtn>
        </div>

        <div style={body}>
          {tab === 'announcement' && (
            <>
              <label style={label}>عنوان الإعلان</label>
              <input style={input} value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} placeholder="مثال: موعد الامتحان الشهري" />

              <label style={label}>نص الإعلان</label>
              <textarea style={textarea} value={annMessage} onChange={(e) => setAnnMessage(e.target.value)} rows={3} placeholder="اكتب تفاصيل الإعلان هنا..." />

              <label style={label}>المستهدف</label>
              <select style={input} value={annTarget} onChange={(e) => setAnnTarget(e.target.value)}>
                <option value="all">كل الطلاب</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>

              <button style={primaryBtn} onClick={handleSendAnnouncement} disabled={annSending}>
                {annSending ? 'جاري الإرسال...' : 'إرسال الإعلان'}
              </button>

              <div style={divider} />
              <p style={listTitle}>آخر الإعلانات</p>
              <div style={list}>
                {announcements.length === 0 && <p style={emptyText}>لا توجد إعلانات بعد</p>}
                {announcements.map((a) => (
                  <div key={a.id} style={listItem}>
                    <div style={{ flex: 1 }}>
                      <p style={listItemTitle}>{a.title}</p>
                      <p style={listItemSub}>{a.student_id ? `لـ: ${studentName(a.student_id)}` : 'للكل'} · {new Date(a.created_at).toLocaleDateString('ar-EG')}</p>
                    </div>
                    <button style={deleteBtn} onClick={() => handleDeleteAnnouncement(a.id)}>حذف</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'homework' && (
            <>
              <label style={label}>المجموعة</label>
              <select style={input} value={hwGroup} onChange={(e) => setHwGroup(e.target.value)}>
                <option value="">اختر المجموعة...</option>
                {groupNames.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>

              <label style={label}>عنوان الواجب</label>
              <input style={input} value={hwTitle} onChange={(e) => setHwTitle(e.target.value)} placeholder="مثال: حل تدريبات الوحدة الثالثة" />

              <label style={label}>تاريخ التسليم (اختياري)</label>
              <input style={input} type="date" value={hwDue} onChange={(e) => setHwDue(e.target.value)} />

              <button style={primaryBtn} onClick={handleCreateHomework} disabled={hwSending}>
                {hwSending ? 'جاري الإضافة...' : 'إضافة الواجب'}
              </button>

              <div style={divider} />
              <p style={listTitle}>آخر الواجبات</p>
              <div style={list}>
                {homeworkTasks.length === 0 && <p style={emptyText}>لا توجد واجبات بعد</p>}
                {homeworkTasks.map((h) => (
                  <div key={h.id} style={listItem}>
                    <div style={{ flex: 1 }}>
                      <p style={listItemTitle}>{h.title}</p>
                      <p style={listItemSub}>{h.group_name} {h.due_date ? `· تسليم ${new Date(h.due_date).toLocaleDateString('ar-EG')}` : ''}</p>
                    </div>
                    <button style={deleteBtn} onClick={() => handleDeleteHomework(h.id)}>حذف</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'settings' && (
            <>
              <label style={label}>رقم واتساب المستر (بيظهر زرار "تواصل مع المستر" في بوابة كل طالب)</label>
              <input style={input} value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="مثال: 201012345678" dir="ltr" />
              <p style={hint}>اكتب الرقم بصيغة دولية من غير + أو مسافات (مصر: يبدأ بـ 20)</p>
              <button style={primaryBtn} onClick={handleSaveWhatsapp} disabled={waSaving}>
                {waSaving ? 'جاري الحفظ...' : waSaved ? '✓ تم الحفظ' : 'حفظ الرقم'}
              </button>
            </>
          )}
        </div>

        {toast && <div style={toastStyle}>{toast}</div>}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ ...tabBtn, ...(active ? tabBtnActive : {}) }}>
      {children}
    </button>
  )
}

// ─── styles ───
const NAVY = '#0E2954'
const GOLD = '#FFD700'

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
}
const modal = {
  width: '100%', maxWidth: 480, maxHeight: '86vh', overflowY: 'auto',
  background: '#0B1120', border: `1px solid rgba(255,215,0,0.2)`, borderRadius: 20,
  direction: 'rtl', fontFamily: "'Cairo', sans-serif", position: 'relative',
}
const header = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
}
const headerTitle = { color: GOLD, fontSize: 18, fontWeight: 800, margin: 0 }
const closeBtn = { background: 'transparent', border: 'none', color: '#94A3B8', fontSize: 18, cursor: 'pointer' }

const tabRow = { display: 'flex', gap: 6, padding: '12px 20px 0' }
const tabBtn = {
  flex: 1, padding: '9px 6px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)', color: '#CBD5E1', fontSize: 12.5, fontWeight: 700,
  cursor: 'pointer', fontFamily: "'Cairo', sans-serif",
}
const tabBtnActive = { background: GOLD, color: NAVY, border: `1px solid ${GOLD}` }

const body = { padding: '18px 20px 24px', display: 'flex', flexDirection: 'column' }
const label = { color: '#94A3B8', fontSize: 12.5, fontWeight: 700, marginTop: 12, marginBottom: 6 }
const input = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 14, fontFamily: "'Cairo', sans-serif",
}
const textarea = { ...input, resize: 'vertical', fontFamily: "'Cairo', sans-serif" }
const hint = { color: '#64748B', fontSize: 11, margin: '6px 0 0' }

const primaryBtn = {
  marginTop: 16, background: `linear-gradient(135deg, ${GOLD} 0%, #e6c200 100%)`, color: NAVY,
  border: 'none', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 800,
  cursor: 'pointer', fontFamily: "'Cairo', sans-serif",
}

const divider = { height: 1, background: 'rgba(255,255,255,0.08)', margin: '20px 0 14px' }
const listTitle = { color: '#94A3B8', fontSize: 12.5, fontWeight: 700, margin: '0 0 10px' }
const list = { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }
const listItem = {
  display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)',
  borderRadius: 10, padding: '10px 12px',
}
const listItemTitle = { color: '#fff', fontSize: 13, fontWeight: 700, margin: 0 }
const listItemSub = { color: '#64748B', fontSize: 11, margin: '2px 0 0' }
const deleteBtn = {
  background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#EF4444',
  borderRadius: 8, padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "'Cairo', sans-serif",
}
const emptyText = { color: '#64748B', fontSize: 12.5, textAlign: 'center', padding: '8px 0' }

const toastStyle = {
  position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  background: GOLD, color: NAVY, padding: '8px 18px', borderRadius: 20, fontSize: 12.5, fontWeight: 800,
}
