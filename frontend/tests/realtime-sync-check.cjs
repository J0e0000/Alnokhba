// Round 7 check — Instant sync (لحظي) + WhatsApp report reliability.
// Verifies at the source level:
//   1. portalRealtime module: broadcast ping/subscribe helpers with safe
//      fallbacks (no crash when realtime is unavailable).
//   2. Dashboard: realtime subscriptions cover ALL data tables that used to
//      go stale (lesson_sessions/الحصص, attendance_records/الحضور,
//      exam_scores/الدرجات, group_schedule/الجدول, teacher_settings,
//      broadcast_messages) + every handler pings the student portal.
//   3. Student portal: instant refresh via teacher pings + visibilitychange
//      + polling backstop (the poll interval was NOT shortened — the ping is
//      the fast path, polling stays the safety net).
//   4. SessionHistoryModal: live refresh while open (سجل الحصص).
//   5. AnnouncementsModal: pings open portals right after send/delete.
//   6. WhatsApp honesty: callers no longer claim "تم الإرسال" when the only
//      working path is the tappable handoff bar (iPhone async flows).
//   7. The existing Round 4 WhatsApp guarantees are still intact (wa.me,
//      handoff bar on every send, real <a> in the queue).
const fs = require('fs')

const read = (f) => fs.readFileSync(f, 'utf8')
let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

console.log('Instant sync + WhatsApp (Round 7) checks:')

// ── 1. portalRealtime module ──
const portalRealtime = read('src/lib/portalRealtime.js')
check('portalRealtime.js exists and exports subscribePortalRefresh', portalRealtime.includes('export function subscribePortalRefresh'))
check('portalRealtime.js exports pingPortalRefresh', portalRealtime.includes('export function pingPortalRefresh'))
check('ping payload carries no student data (source + timestamp only)', /payload = \{ source, at: Date\.now\(\) \}/.test(portalRealtime))
check('sender buffers pings until the channel is subscribed', portalRealtime.includes('entry.subscribed') && portalRealtime.includes('flushPending'))
check('subscribe swallows listener errors', /listener errors must never break the channel/.test(portalRealtime))
check('channel name is teacher-scoped', portalRealtime.includes("'portal-refresh-'"))
check('receiver drops only strictly OLDER pings (same-ms pings kept)', /at && at < lastPingAt/.test(portalRealtime))

// ── 2. Dashboard realtime coverage ──
const dash = read('src/pages/Dashboard.jsx')
check('Dashboard imports pingPortalRefresh', dash.includes("import { pingPortalRefresh } from '../lib/portalRealtime'"))
const dashTables = [
  ['students', 'students'],
  ['behavior_logs', 'behavior_logs'],
  ['session_logs', 'session_logs'],
  ['lesson_sessions', 'lesson_sessions (الحصص)'],
  ['attendance_records', 'attendance_records (الحضور)'],
  ['exam_scores', 'exam_scores (الدرجات)'],
  ['group_schedule', 'group_schedule (الجدول)'],
  ['teacher_settings', 'teacher_settings (الإعدادات)'],
  ['broadcast_messages', 'broadcast_messages (الرسائل العامة)'],
]
for (const [table, label] of dashTables) {
  check(`Dashboard subscribes to ${label}`, new RegExp(`table: '${table}'`).test(dash))
}
check('every realtime handler pings the portal (≥8 ping call sites)', (dash.match(/ping\('(students|behavior_logs|session_logs|lesson_sessions|attendance_records|exam_scores|group_schedule|teacher_settings|broadcast_messages)'\)/g) || []).length >= 8)
check('lesson_sessions DELETE clears activeLessonId', /setActiveLessonId\(\(cur\) => \(cur === deletedId \? '' : cur\)\)/.test(dash))
check('lesson_sessions INSERT/UPDATE merges into lessonSessions', /setLessonSessions\(\(prev\) => \{\s*const idx = prev\.findIndex/.test(dash))
check('attendance events only merge into the ACTIVE lesson map', /activeLessonIdRef/.test(dash) && /trackedLesson/.test(dash) === false || /row\.lesson_session_id/.test(dash))
check('attendance events recompute absence streaks (debounced)', /refreshAbsenceStreak/.test(dash) && /streakTimersRef/.test(dash))
check('exam_scores DELETE removes the row from the map', /list\.filter\(\(r\) => r\.id !== payload\.old\.id\)/.test(dash))
check('session_logs handler keeps today entry over older dates', /current\.session_date === today && row\.session_date !== today/.test(dash))
check('session_logs DELETE removes the group entry', /prev\[removed\.group_name\]\?\.id === removed\.id/.test(dash))
check('teacher_settings UPDATE reloads settings', /refreshSettings\?\.\(\)/.test(dash))
check('group_schedule changes refresh today groups', /refreshTodayGroups\(\)/.test(dash))

// ── 3. Student portal instant refresh ──
const portal = read('src/pages/PublicQRPage.jsx')
check('portal imports subscribePortalRefresh', portal.includes("import { subscribePortalRefresh } from '../lib/portalRealtime'"))
check('portal subscribes using the payload teacher id', /subscribePortalRefresh\(portalTeacherId/.test(portal))
check('portal refresh is debounced (450ms)', /setTimeout\(\(\) => \{[\s\S]*?load\(true, reason\)[\s\S]*?\}, 450\)/.test(portal))
check('portal refreshes when the tab becomes visible', /visibilitychange/.test(portal) && /document\.visibilityState === 'visible'/.test(portal))
check('portal keeps the 10s polling safety net', /const REFRESH_MS = 10000/.test(portal))
check('portal double-refresh guard (1.5s window)', /lastInstantRefreshAtRef/.test(portal))

// ── 4. SessionHistoryModal live refresh ──
const shModal = read('src/components/SessionHistoryModal.jsx')
check('SessionHistoryModal subscribes to session_logs while open', /table: 'session_logs'/.test(shModal))
check('SessionHistoryModal filters rows client-side by group name', /row\.group_name !== groupName/.test(shModal))
check('SessionHistoryModal handles DELETE + INSERT + UPDATE', /payload\.eventType === 'DELETE'/.test(shModal) && /copy\[idx\] = row/.test(shModal))

// ── 5. AnnouncementsModal instant ping ──
const annModal = read('src/components/AnnouncementsModal.jsx')
check('AnnouncementsModal pings portals after send', /pingPortalRefresh\(teacherId, 'announcement'\)/.test(annModal))
check('AnnouncementsModal pings portals after delete', /pingPortalRefresh\(teacherId, 'announcement-deleted'\)/.test(annModal))

// ── 6. WhatsApp honest handoff reporting ──
const helpers = read('src/lib/helpers.js')
check('helpers exports lastWhatsAppHandoffInfo', helpers.includes('export function lastWhatsAppHandoffInfo'))
check('openWhatsAppUrl records each layer outcome', /recordHandoff\(true, 'reused_window'\)/.test(helpers) && /recordHandoff\(true, 'window_open'\)/.test(helpers) && /recordHandoff\(true, 'anchor_click'\)/.test(helpers) && /recordHandoff\(false, 'blocked'\)/.test(helpers))
check('needsTap is true when only the bar can open WhatsApp on handhelds', /needsTap: !ok \|\| \(method === 'anchor_click' && isHandheldBrowser\(\)\)/.test(helpers))
check('invalid input also records the handoff', /recordHandoff\(false, 'invalid_input'\)/.test(helpers))
check('Dashboard imports lastWhatsAppHandoffInfo', dash.includes('lastWhatsAppHandoffInfo'))
check('report toast guides to the bar when needsTap', /handoff\.needsTap/.test(dash) && /اضغط زر «فتح واتساب»/.test(dash))
check('individual/template sends guide to the bar too', (dash.match(/lastWhatsAppHandoffInfo\(\)\.needsTap/g) || []).length >= 2)

// ── 7. Round 4 guarantees intact ──
// Strip comments WITHOUT eating URLs: `//` is only a comment when NOT part
// of a protocol (`://`). Block comments are stripped wholesale.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*$/gm, '$1')
const functionalWhatsAppSrc = stripComments(helpers) + stripComments(read('src/lib/qrPdfWhatsApp.js'))
check('wa.me universal links still used (no api.whatsapp.com/send in code)', functionalWhatsAppSrc.includes('wa.me/') && !functionalWhatsAppSrc.includes('api.whatsapp.com/send'))
check('sendWhatsApp still shows the handoff bar before opening', /showWhatsAppHandoff\(url, \{ message \}\)/.test(helpers))
check('handoff bar still renders a real <a> with the wa.me href', read('src/components/WhatsAppHandoffBar.jsx').includes('href={handoff.waUrl}'))
const queueModal = read('src/components/MessageQueueModal.jsx')
check('message queue still uses real <a> links (not window.open buttons)', queueModal.includes('href={waHref}'))

console.log('')
if (failures > 0) {
  console.log(`${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('All instant sync + WhatsApp checks passed ✓')
