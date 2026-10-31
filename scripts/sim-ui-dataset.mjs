// Generates a 1,000-student demo-mode localStorage DB for UI performance tests
// (§21-23) in the SANDBOX ONLY — the demo client never touches production.
// Same entity shapes as src/demo/demoClient.js seed(). Deterministic.
import fs from 'node:fs'

const T = 'a0000000-0000-4000-8000-00000000c0de'
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20260921)
const iso = (offsetMinutes = 0) => new Date(Date.now() + offsetMinutes * 60000).toISOString()
const dayStr = (offsetDays = 0) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const today = dayStr(0)
let uidN = 0
const uid = () => `t${(++uidN).toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`

const GROUPS = Array.from({ length: 8 }, (_, i) => `TEST-المجموعة ${['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'][i]}${i > 0 ? ` ${i + 1}` : ''}`)
const STAGES = ['الأول الإعدادي', 'الثاني الإعدادي', 'الثالث الإعدادي', 'الأول الثانوي', 'الثاني الثانوي', 'الثالث الثانوي']

// students: 125 per group = 1000
const students = []
for (let g = 0; g < 8; g++) {
  for (let i = 0; i < 125; i++) {
    const n = students.length + 1
    students.push({
      id: `TEST-STUDENT-${String(n).padStart(4, '0')}`, teacher_id: T, code: `T-${String(n).padStart(5, '0')}`,
      name: `TEST-STUDENT-${String(n).padStart(4, '0')}`, phone: '01' + String(100000000 + Math.floor(rnd() * 899999999)),
      stage: STAGES[g % STAGES.length], group_name: GROUPS[g], points: Math.floor(rnd() * 60), warnings: rnd() < 0.08 ? 1 : 0,
      attendance_status: 'لم يرصد', hw_status: 'لم يرصد', created_at: iso(-60 * 24 * 90), updated_at: iso(-60),
    })
  }
}

// group_schedule: 2 days per group
const group_schedule = []
for (let g = 0; g < 8; g++) {
  for (const wd of [0, 3]) group_schedule.push({ id: uid(), teacher_id: T, group_name: GROUPS[g], weekday: wd, lesson_time: '16:30' })
}

// lesson_sessions: 12 weeks × 8 groups × 2 (Fri+Mon approximated as last Friday + this Monday... use actual recent dates)
const lesson_sessions = []
const sessionDates = [] // {date, groupIdx}
for (let w = 12; w >= 1; w--) {
  for (let g = 0; g < 8; g++) {
    for (const off of [-7 * w, -7 * w + 3]) {
      const date = dayStr(off)
      const isOpen = off === 0 && g === 0
      lesson_sessions.push({
        id: `SES-${g}-${off}`, teacher_id: T, group_name: GROUPS[g], stage: STAGES[g % STAGES.length],
        session_date: date, status: isOpen ? 'open' : off === 0 ? 'open' : 'completed',
        lesson_topic: 'TEST', homework_text: 'TEST', video_link: '',
        started_at: iso(-60 * 24 * 7 * w), ended_at: null, created_at: iso(-60 * 24 * 7 * w), updated_at: iso(-60),
      })
      sessionDates.push({ id: `SES-${g}-${off}`, date, g })
    }
  }
}

// attendance_records: last 8 weeks only (localStorage quota) — patterned per group
const attendance_records = []
const ATT_WEEKS = 6
for (const sd of sessionDates) {
  const daysAgo = Math.round((new Date(sd.date) - new Date(today)) / 86400000)
  if (daysAgo < -7 * ATT_WEEKS) continue
  const absBase = [0.09, 0.09, 0.08, [0, 0.12, 0.18, 0.24, 0.32, 0.42, 0.5, 0.5][Math.min(7, Math.floor((daysAgo + 7) / -7) * -1 + 7)] || 0.3, 0.13, 0.09, 0.08, 0.09][sd.g] ?? 0.1
  for (let i = 0; i < 125; i++) {
    const st = students[sd.g * 125 + i]
    const absent = rnd() < absBase
    attendance_records.push({
      id: uid(), teacher_id: T, student_id: st.id, lesson_session_id: sd.id,
      status: absent ? 'غائب' : 'حاضر', homework_status: absent ? 'لم يتم' : rnd() < 0.85 ? 'مكتمل' : rnd() < 0.5 ? 'ناقص' : 'لم يتم',
      recorded_at: `${sd.date}T16:00:00Z`, attendance_date: sd.date,
    })
  }
}

// exams + scores: 4 per group
const exams = []
const exam_scores = []
for (let g = 0; g < 8; g++) {
  for (const w of [3, 6, 9, 12]) {
    const eid = `EX-${g}-${w}`
    const ses = lesson_sessions.find((s) => s.id === `SES-${g}-${-7 * w}`)
    exams.push({ id: eid, teacher_id: T, title: `امتحان أسبوع ${w}`, sections: ['عام'], max_score_per_section: 10, lesson_session_id: ses.id, version: 1, created_at: `${ses.session_date}T18:00:00Z`, updated_at: `${ses.session_date}T18:00:00Z` })
    for (let i = 0; i < 125; i++) {
      const st = students[g * 125 + i]
      const pct = 55 + rnd() * 35
      const sc = Math.round(pct) / 10
      exam_scores.push({ id: uid(), teacher_id: T, exam_id: eid, student_id: st.id, lesson_session_id: ses.id, section_scores: { عام: sc }, total_score: sc, version: 1, created_at: `${ses.session_date}T18:00:00Z`, updated_at: `${ses.session_date}T18:00:00Z` })
    }
  }
}

// behavior noise
const behavior_logs = []
for (let i = 0; i < 400; i++) {
  const st = students[Math.floor(rnd() * students.length)]
  behavior_logs.push({ id: uid(), teacher_id: T, student_id: st.id, note: 'TEST', points_delta: rnd() < 0.3 ? -1 : 2, created_at: iso(-60 * 24 * rnd() * 30) })
}

const settings = {
  teacher_id: T, groups: GROUPS,
  group_meta: Object.fromEntries(GROUPS.map((g, i) => [g, { stage: STAGES[i % STAGES.length], day: 0, time: '16:30' }])),
  points_present: 1, points_absent: -1, points_interact: 3, points_interrupt: -3,
  ranks: [{ min: 0, title: 'مبتدئ' }, { min: 10, title: 'مجتهد' }, { min: 20, title: 'متفوق' }, { min: 30, title: 'متميز' }, { min: 40, title: 'نجم الصف' }, { min: 50, title: 'أسطورة' }, { min: 60, title: 'المتنبي' }],
  msg_welcome: 'مرحباً {studentName}', msg_warning: 'إنذار {studentName}', msg_promotion: 'مبروك {studentName}',
  msg_report_template: '', report_fields: ['rank', 'position', 'points', 'warnings', 'attendance', 'homework', 'session', 'logs'],
  insight_config: { attendance_warning_threshold: 75, performance_warning_threshold: 60, repeated_absence_count: 3, max_warnings: 3 },
  notification_preferences: { attendance: true, homework: true, exams: true, lessons: true, payments: true, announcements: true },
  whatsapp_number: '201000000000', qr_message_template: 'مرحباً {studentName}', absence_warning_threshold: 2, absence_attention_threshold: 3,
}
const branding = { teacher_id: T, display_name: 'TEST', center_name: 'TEST-CENTER', logo_url: '', palette_key: 'nokhba-navy-gold', language: 'ar' }

const db = {
  profiles: [{ id: T, full_name: 'TEST Teacher', email: 'test@example.com', phone: '201000000000', is_admin: false, is_verified: true, subscription_status: 'active', subscription_expires_at: iso(60 * 24 * 365), account_type: 'teacher', created_at: iso(-60 * 24 * 90) }],
  students, group_schedule, lesson_sessions, attendance_records, exams, exam_scores, behavior_logs,
  teacher_settings: [settings], workspace_branding: [branding], broadcast_messages: [],
  student_qr_tokens: [], student_notifications: [], teacher_notification_events: [],
  session_logs: [], homework_tasks: [], homework_task_status: [], announcements: [],
}

const json = JSON.stringify(db)
const mb = (json.length / 1048576).toFixed(2)
fs.writeFileSync('/home/z/my-project/.local-tmp/demo-db.json', json)
console.log(`demo db: students=${students.length} sessions=${lesson_sessions.length} attendance=${attendance_records.length} scores=${exam_scores.length} exams=${exams.length} → ${mb} MB`)
if (parseFloat(mb) > 4.8) console.log('WARNING: over typical 5MB localStorage quota — trim ATT_WEEKS')
