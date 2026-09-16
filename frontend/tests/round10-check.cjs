// Round 10 check — the 8 user requests + Round-9 reconstruction wiring.
// Verifies the full wiring at the source level:
//   R1: notification-enable banner at the TOP of the student portal
//   R2+R3: QR attendance panel always visible + live camera + image scan +
//       server-side resolution (resolve_student_by_qr)
//   R4: marked students hidden from the session list until lesson ends
//   R5: search bar in the exams list (منصة الامتحانات)
//   R6: homework مكتمل fix (RPC accepts all 4 statuses — migration 040)
//   R7: push notifications only for important categories (migration 040) +
//       warning notification on addWarning
//   R8: announcement deletion syncs everywhere (cascade + ping + realtime)
//   R9-reconstruction: set_student_attendance / remove_attendance /
//       import_exam_grades wired like the live Round-9 build
const fs = require('fs')

const read = (f) => fs.readFileSync(f, 'utf8')
const exists = (f) => fs.existsSync(f)
let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

console.log('Round 10 (8 user requests + Round-9 reconstruction) checks:')

// ── R1: notification banner at top of portal ──
const portal = read('src/pages/PublicQRPage.jsx')
check('R1: enable-notifications banner rendered before the student card', portal.indexOf('فعّل إشعارات ولي الأمر على هذا الجهاز') > -1 && portal.indexOf('فعّل إشعارات ولي الأمر على هذا الجهاز') < portal.indexOf('{/* Student Card */}'))
check('R1: banner gated on !parentPushEnabled', /!parentPushEnabled[\s\S]{0,2000}تفعيل الإشعارات الآن/.test(portal))
check('R1: old bottom enable-button removed (banner is the single entry)', (portal.match(/فعّل إشعارات ولي الأمر على هذا الجهاز/g) || []).length === 1)
check('R1: enabled-status line still shown in the notifications section', portal.includes('إشعارات المتصفح مفعّلة لهذا الطالب'))

// ── R2+R3: QR panel + scanner upgrade ──
const panel = read('src/components/QRAttendancePanel.jsx')
const scanner = read('src/components/QRScannerModal.jsx')
const qrLib = read('src/lib/qrAttendance.js')
const dash = read('src/pages/Dashboard.jsx')
check('R2: QRAttendancePanel component exists', exists('src/components/QRAttendancePanel.jsx'))
check('R2: panel embedded in the sessions workspace', (() => { const s = dash.indexOf("activeSection === 'sessions'"); const p = dash.indexOf('<QRAttendancePanel'); const e = dash.indexOf("activeSection === 'exams'"); return s > -1 && p > s && (e === -1 || p < e) })())
check('R2: panel auto-starts the camera when permission is granted', panel.includes("permissions?.query") && panel.includes("state === 'granted'"))
check('R2: panel pauses camera when the lesson closes', /activeLessonId[\s\S]{0,120}stopCamera/.test(panel))
check('R3: panel uses html5-qrcode camera scanning', panel.includes("new Html5Qrcode"))
check('R3: panel offers scan-from-image fallback', panel.includes('scanFile') && panel.includes('image/*'))
check('R3: scanner resolves codes server-side (Round-9 contract)', qrLib.includes('resolve_student_by_qr') && scanner.includes('handleScannedPayload'))
check('R3: scanner handles already_present_today (one-per-day)', qrLib.includes('already_present_today'))
check('R3: scanner has scan-from-image (modal)', scanner.includes('scanFile') && scanner.includes('qr-reader-file'))
check('R3: migration-missing guidance for resolve_student_by_qr', qrLib.includes('Migration 039'))
check('R3: shared pipeline for both surfaces', panel.includes('handleScannedPayload') && scanner.includes('handleScannedPayload'))

// ── R4: hide marked students until lesson ends ──
check('R4: visibleSessionStudents filters unmarked while lesson open', dash.includes("s.attendance_status === 'لم يرصد'") && dash.includes('visibleSessionStudents'))
check('R4: filter only applies to OPEN lessons (completed shows all)', dash.includes("activeLesson?.status === 'completed' || showMarkedStudents"))
check('R4: toggle button to show/hide marked students', dash.includes('setShowMarkedStudents'))
check('R4: counter of remaining unrecorded students', dash.includes('unrecordedSessionCount'))
check('R4: all-marked celebration state', dash.includes('تم رصد كل الطلاب'))
check('R4: session table renders the filtered list', /visibleSessionStudents\.map\(\(s, i\) =>/.test(dash))

// ── R5: exam search ──
const examsList = read('src/components/ExamsListModal.jsx')
check('R5: search bar at top of the exams list', examsList.includes('examSearch') && examsList.includes('type="search"'))
check('R5: search matches exam title + student names', examsList.includes('inTitle') && examsList.includes('inStudents'))
check('R5: empty-search result message', examsList.includes('مفيش نتيجة للبحث ده'))

// ── R6: homework مكتمل fix ──
const migration = read('supabase/migrations/migration_040_v2_round10_requests.sql')
check('R6: migration 040 v2 (42P13 fix) exists', exists('supabase/migrations/migration_040_v2_round10_requests.sql') && migration.includes('drop function if exists public.upsert_lesson_homework'))
check('R6: legacy CHECK constraints rejecting مكتمل get dropped', migration.includes('hw_status') && migration.includes("position('مكتمل' in r.def) = 0"))
check('R6: upsert_lesson_homework accepts all 4 statuses', migration.includes("'مكتمل', 'ناقص', 'لم يتم', 'لم يرصد'"))
check('R6: FE homework select still offers مكتمل (all four options)', /مكتمل[\s\S]{0,120}ناقص[\s\S]{0,120}لم يتم/.test(dash))

// ── R7: push only for important events ──
check('R7: queue_teacher_push_job filters by category allowlist', migration.includes("queue_teacher_push_job") && /not in \('attendance', 'exam_result', 'announcement', 'warning'\)/.test(migration))
check('R7: in-app feed unaffected (filter returns new early)', /return new;[\s\S]{0,80}end if[\s\S]{0,200}insert into public\.push_notification_jobs/.test(migration))
check('R7: addWarning now creates a warning notification for the parent', /addWarning[\s\S]{0,1400}student_notifications[\s\S]{0,260}category: 'warning'/.test(dash))

// ── R8: announcement delete sync ──
const annModal = read('src/components/AnnouncementsModal.jsx')
check('R8: migration re-asserts cascade FK on announcement delete', migration.includes('on delete cascade') && migration.includes('student_notifications_announcement_id_fkey'))
check('R8: legacy double-notify trigger dropped in migration', migration.includes('drop trigger if exists on_announcement_inserted'))
check('R8: announcements delete policy re-asserted', migration.includes('announcements_teacher_delete'))
check('R8: modal pings portals after delete', annModal.includes("pingPortalRefresh(teacherId, 'announcement-deleted')"))
check('R8: modal subscribes to announcements realtime while open', annModal.includes('postgres_changes') && annModal.includes('DELETE'))
check('R8: honest toast about already-delivered phone pushes', annModal.includes('مش بتتشال من شاشة الإشعارات'))

// ── Round-9 reconstruction wiring (live contracts) ──
check('R9: attendance saves via set_student_attendance RPC', dash.includes("rpc('set_student_attendance'"))
check('R9: offline queue uses set_student_attendance', dash.includes("rpcName: 'set_student_attendance'"))
check('R9: undo to «لم يرصد» uses remove_attendance', dash.includes("rpc('remove_attendance'"))
check('R9: authoritative new_points reconciled from the RPC response', dash.includes('new_points'))
check('R9: old upsert_lesson_attendance path fully removed', !dash.includes("rpc('upsert_lesson_attendance'") && !dash.includes("rpcName: 'upsert_lesson_attendance'"))
check('R9: manual attendance_records day-path writes removed (server owns it)', !/from\('attendance_records'\)[\s\S]{0,200}\.insert\(/.test(dash))
check('R9: Excel import modal exists', exists('src/components/ExcelGradeImportModal.jsx'))
check('R9: Excel import calls import_exam_grades with the live contract', examsList.includes('ExcelGradeImportModal') && read('src/components/ExcelGradeImportModal.jsx').includes("rpc('import_exam_grades'"))
check('R9: p_rows shape = student_id/score/row_index/row_label/allow_update', /student_id: st\.studentId[\s\S]{0,180}row_label[\s\S]{0,120}allow_update/.test(read('src/components/ExcelGradeImportModal.jsx')))
check('R9: import passes conflict_policy + expected_version', /p_expected_version[\s\S]{0,220}conflict_policy/.test(read('src/components/ExcelGradeImportModal.jsx')))
check('R9: per-exam import button in the exams list', examsList.includes('استيراد Excel'))
check('R9: import pings the portal after writing grades', read('src/components/ExcelGradeImportModal.jsx').includes("pingPortalRefresh"))
check('R9: scanner still mounted fullscreen with activeLessonId', /QRScannerModal[\s\S]{0,300}activeLessonId=\{activeLessonId\}/.test(dash))
check('R9: markPresent returns save success to the scanner (feedback)', /return Boolean\(await setAttendance/.test(dash))

// ── test wiring itself ──
const runner = read('tests/run-all.sh')
check('wired into run-all.sh', runner.includes('round10-check'))

console.log()
if (failures) {
  console.log(`${failures} ROUND-10 CHECKS FAILED`)
  process.exit(1)
} else {
  console.log('ALL Round-10 checks PASSED')
}
