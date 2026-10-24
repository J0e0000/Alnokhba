/**
 * Task 44g — إشعارات «في حاجة نزلت» للطلاب (من جهاز المدرس مباشرة)
 * ═══════════════════════════════════════════════════════════════════════════
 * المدرس يعمل/ينشر واجب أو امتحان أونلاين → نرسل لكل طالب في النطاق إشعار
 * student_notifications فيه:
 *   • category صحيح ضمن CHECK constraint (homework / announcement)
 *   • deep_link رابط مطلق يفتح المكان مباشرة:
 *       - واجب:   {origin}/hw/{portalToken}/{taskId}  → يفتح الواجب نفسه
 *       - امتحان: {origin}/qr/{portalToken}?exam={id} → يستكمل أو يبرز الامتحان
 *
 * التوكنات: student_qr_tokens (قراءة عامة حسب RLS — qr_token_public_read).
 * اللي ملوش توكن = معندوش بوابة أصلًا فمفيش لازمة إشعار → يتخطى ويعدّ.
 *
 * حماية سبام: نفس deep_link لنفس الطالب خلال آخر 12 ساعة → يتسقط تلقائيًا
 * (يعني الضغط مرتين بالغلط أو نشر بعد تعديل مايضاعفش الإشعارات).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { supabase } from './supabaseClient'

const CHUNK = 150
const DEDUP_WINDOW_HOURS = 12

const chunkOf = (arr, size) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** توكن البوابة لكل طالب (دفعة واحدة بدل RPC لكل طالب) */
export async function fetchStudentTokens(studentIds) {
  const map = new Map()
  const ids = (studentIds || []).filter(Boolean)
  if (!ids.length) return map
  for (const slice of chunkOf(ids, CHUNK)) {
    try {
      const { data, error } = await supabase
        .from('student_qr_tokens')
        .select('student_id, token')
        .in('student_id', slice)
        .is('revoked_at', null)
      if (error) { console.warn('[notifyStudents] token fetch failed:', error.message); continue }
      for (const row of data || []) {
        if (row?.student_id && row?.token) map.set(row.student_id, row.token)
      }
    } catch (err) {
      console.warn('[notifyStudents] token fetch threw:', err)
    }
  }
  return map
}

/** مفاتيح (student_id|deep_link) بعتّها خلال آخر 12 ساعة — لمنع التكرار */
async function fetchRecentKeys(teacherId, studentIds) {
  const keys = new Set()
  if (!teacherId || !(studentIds || []).length) return keys
  const since = new Date(Date.now() - DEDUP_WINDOW_HOURS * 3600 * 1000).toISOString()
  for (const slice of chunkOf(studentIds, CHUNK)) {
    try {
      const { data, error } = await supabase
        .from('student_notifications')
        .select('student_id, deep_link')
        .eq('teacher_id', teacherId)
        .gte('created_at', since)
        .in('student_id', slice)
      if (error) { console.warn('[notifyStudents] dedup read failed:', error.message); continue }
      for (const row of data || []) {
        if (row?.student_id && row?.deep_link) keys.add(`${row.student_id}|${row.deep_link}`)
      }
    } catch (err) {
      console.warn('[notifyStudents] dedup read threw:', err)
    }
  }
  return keys
}

async function insertRows(rows) {
  let sent = 0
  for (const slice of chunkOf(rows, 200)) {
    try {
      const { error } = await supabase.from('student_notifications').insert(slice)
      if (error) { console.warn('[notifyStudents] insert failed:', error.message); continue }
      sent += slice.length
    } catch (err) {
      console.warn('[notifyStudents] insert threw:', err)
    }
  }
  return sent
}

async function sendBuilt({
  teacherId, students, build, dedupLink,
}) {
  const targets = (students || []).filter((s) => s && s.id && !s.archived)
  if (!targets.length) return { sent: 0, skipped: 0, total: 0 }
  const tokens = await fetchStudentTokens(targets.map((s) => s.id))
  const withToken = targets.filter((s) => tokens.has(s.id))
  if (!withToken.length) return { sent: 0, skipped: targets.length, total: targets.length }
  const recent = await fetchRecentKeys(teacherId, withToken.map((s) => s.id))
  const rows = []
  let dupes = 0
  for (const s of withToken) {
    const link = dedupLink(tokens.get(s.id))
    if (recent.has(`${s.id}|${link}`)) { dupes += 1; continue }
    const row = build(s, tokens.get(s.id), link)
    if (row) rows.push(row)
  }
  const sent = await insertRows(rows)
  return { sent, skipped: targets.length - sent, dupes, total: targets.length }
}

/**
 * إشعار «في واجب نزل» — للطلاب اللي عليه الواجب (المجموعة أو الكل).
 * يُستدعى تلقائيًا بعد النشر (لو المدرس فعّلها) ومن زر الإعادة في صفحة الواجب.
 */
export async function sendHomeworkNotifications({ teacherId, task, students }) {
  if (!task?.id || !teacherId) return { sent: 0, skipped: 0, total: 0 }
  const due = task.due_date ? ` — آخر موعد: ${task.due_date}` : ''
  return sendBuilt({
    teacherId,
    students,
    dedupLink: (token) => `${window.location.origin}/hw/${token}/${task.id}`,
    build: (s, _token, link) => ({
      teacher_id: teacherId,
      student_id: s.id,
      title: '📚 في واجب نزل',
      body: `«${task.title}»${due} — افتح اللينك وحلّه: تسليم مرة واحدة بس والتصحيح تلقائي على السيرفر.`,
      category: 'homework',
      deep_link: link,
    }),
  })
}

/**
 * إشعار «امتحان أونلاين نزل» بلينك — لطلاب المجموعة أو الكل.
 * اللينك يفتح البوابة: لو في محاولة شغالة يستكمل فورًا، لو لأ يتبرز الامتحان.
 */
export async function sendExamNotifications({ teacherId, exam, students }) {
  if (!exam?.id || !teacherId) return { sent: 0, skipped: 0, total: 0 }
  const qCount = Number(exam.question_count) || (Array.isArray(exam.questions) ? exam.questions.length : 0)
  const windowBit = exam.closes_at
    ? ` — بيّقفل ${safeTime(exam.closes_at)}`
    : (exam.opens_at ? ` — بيفتح ${safeTime(exam.opens_at)}` : '')
  return sendBuilt({
    teacherId,
    students,
    dedupLink: (token) => `${window.location.origin}/qr/${token}?exam=${exam.id}`,
    build: (s, _token, link) => ({
      teacher_id: teacherId,
      student_id: s.id,
      title: '📝 امتحان أونلاين نزل',
      body: `«${exam.title}» — ${qCount} سؤال · ${exam.duration_minutes} دقيقة${windowBit}. افتح اللينك: الوقت بيحسبه السيرفر من لحظة ما تبدأ.`,
      category: 'announcement',
      deep_link: link,
    }),
  })
}

function safeTime(ts) {
  try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) } catch { return '' }
}
