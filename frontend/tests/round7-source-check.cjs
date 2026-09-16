// ============================================================================
// Round 7 — QR scanner acceptance + attendance lifecycle (source checks)
// ============================================================================
// Locks in the two Round 7 behaviors at the source level:
//   1. The teacher's QR scanner accepts ANY student QR (portal URL, bare
//      token, card UUID) and resolves it via student_qr_tokens instead of
//      dead-ending with "ده رابط بوابة الطالب".
//   2. The attendance lifecycle: PRESENT marks auto-open the student's group
//      lesson; ending a lesson resets every marked student to neutral
//      (لم يرصد) in السجل and in the lesson view while the saved data stays.
// Also guards: PublicQRPage.jsx must stay untouched (portal stability).
// ============================================================================
const fs = require('fs')

const read = (p) => fs.readFileSync(p, 'utf8')
const must = (source, value, label) => {
  if (!source.includes(value)) throw new Error(`missing: ${label} (expected "${value.slice(0, 60)}…")`)
}
const mustNot = (source, value, label) => {
  if (source.includes(value)) throw new Error(`forbidden: ${label} (found "${value.slice(0, 60)}…")`)
}

// ── 1. Token resolver exists in the QR lib ──────────────────────────────────
const lib = read('src/lib/qrPdfWhatsApp.js')
must(lib, 'export async function resolveStudentIdByToken', 'token resolver export')
must(lib, ".eq('token', clean)", 'resolver queries student_qr_tokens by token')
must(lib, ".is('revoked_at', null)", 'resolver filters revoked tokens')

// ── 2. Scanner resolves tokens instead of dead-ending ──────────────────────
const scanner = read('src/components/QRScannerModal.jsx')
must(scanner, 'resolveStudentIdByToken', 'scanner imports/uses the token resolver')
mustNot(scanner, "❌ ده رابط بوابة الطالب", 'old portal-QR dead-end error message removed')
must(scanner, "rawCode.includes('/qr/')", 'scanner still extracts tokens from portal URLs')

// ── 3. Dashboard: scan counts attendance without an open lesson ────────────
const dash = read('src/pages/Dashboard.jsx')
must(dash, 'onMarkPresent={(id) => setAttendance(id, \'حاضر\', activeLessonId || undefined)}', 'scanner wiring passes smart routing (no "open lesson first" gate)')
mustNot(dash, 'افتح الحصة أولاً قبل مسح QR', 'scanner no-lesson block removed')

// ── 4. Dashboard: PRESENT mark auto-opens the group lesson ─────────────────
must(dash, "status === 'حاضر' && isOnline", 'auto-open guarded to PRESENT marks while online')
must(dash, 'openLessonForGroup(targetGroupName, { silent: true, forceNew: true })', 'auto-open uses the lesson creator (forceNew, silent)')

// ── 5. Dashboard: end-of-lesson neutral reset ──────────────────────────────
must(dash, 'attendance_status: \'لم يرصد\'', 'neutral status used for resets')
must(dash, 'const resetIds = Object.keys(finalMap)', 'online reset covers all marked students (incl. guests)')
must(dash, "update({ attendance_status: 'لم يرصد', updated_at: endedAt }).in('id', resetIds)", 'online reset writes the neutral status to the students table')
must(dash, 'offlineResetIds', 'offline reset queued after the finalizer')
must(dash, "lessonEnded ? 'لم يرصد'", 'completed lessons display neutral in the lesson view')
must(dash, 'lessonMarksSavedAtRef', 'lesson-attendance loader race guard present')

// ── 6. Student portal untouched (stability guard) ───────────────────────────
const portal = read('src/pages/PublicQRPage.jsx')
for (const value of ['get_student_portal_data', 'registerStudentPush', '/qr/']) {
  must(portal, value, `portal source still intact (${value})`)
}
// The portal derives today's status from lesson records — NOT from
// students.attendance_status — so the neutral reset cannot change it.
mustNot(portal, 'sessionToday?.attendance_status ? sessionToday', 'sanity: portal status derivation unchanged')
must(portal, 'const finalAttendanceStatus = (rawAtt && rawAtt !== \'لم يرصد\') ? rawAtt : (attendance[0]?.status || lessonAttendance[0]?.status || \'لم يرصد\')', 'portal keeps deriving status from records (untouched)')

console.log('ROUND7_SOURCE_CHECK_OK — scanner accepts any student QR; present marks auto-open lessons; ended lessons reset to neutral; portal untouched.')
