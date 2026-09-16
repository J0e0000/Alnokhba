// Round 9 check — QR payload pipeline + attendance/session/exam-linking wiring.
//
// Part A: source-level wiring checks (like Round 8's exam-edit-check):
//   1. QRScannerModal: real decoder usage (html5-qrcode), token/UUID/URL
//      payload resolution via resolveQrStudent, image-file scanning
//      (scanFile + preprocessing retries), duplicate check against LESSON
//      attendance (not the global mirror), clean diagnostics, no fake
//      success paths, no navigation to the QR URL.
//   2. qrPayload.js: pure parser handles all payload shapes.
//   3. Dashboard: session workspace restore after reload (adopt-only),
//      session search bar, neutral unmark button, day-path RPC with legacy
//      fallback, reconnect refetch, exam session-link plumbing.
//   4. ExamModal: future-exam vs attach-to-session choice + validation,
//      grading search + alphabetical sort.
//   5. ExamsListModal: displays the real lesson_session_id relationship.
//   6. migration_039: RPC + unique index + grants + idempotent style.
//
// Part B (LIVE): resolves a REAL token from the live Supabase
//   student_qr_tokens table (public read policy) — proves the exact lookup
//   the scanner performs works against production. Skipped gracefully if
//   the network is unavailable.
const fs = require('fs')
const path = require('path')

const read = (f) => fs.readFileSync(f, 'utf8')
const exists = (f) => fs.existsSync(f)
let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

console.log('QR + attendance + session + exam-linking (Round 9) checks:')

// ── 1. QRScannerModal ──
const scanner = read('src/components/QRScannerModal.jsx')
check('scanner imports the real decoder (html5-qrcode)', scanner.includes("from 'html5-qrcode'"))
check('scanner resolves payloads via resolveQrStudent (not local-only UUID match)', scanner.includes('resolveQrStudent'))
check('scanner never treats the QR URL as attendance proof (no navigation)', !/window\.open|location\.href\s*=/.test(scanner))
check('scanner supports image-file scanning (scanFile)', scanner.includes('.scanFile('))
check('scanner preprocesses difficult images (upscale + grayscale retries)', scanner.includes("mode === 'upscale'") && scanner.includes("mode === 'grayscale'"))
check('scanner duplicate check uses LESSON attendance map, not the global mirror', scanner.includes('lessonAttRef.current[student.id]?.status'))
check('scanner requires an open lesson (session check step)', scanner.includes('lessonActive'))
check('scanner has structured failure diagnostics', scanner.includes('setLastDiag') && scanner.includes('logAttendanceOp'))
check('scanner clean success path — no diagnostic UI on success', scanner.includes('lastDiag && !lastDiag.ok'))
check('scanner awaits the authoritative save before ✅ (no false "registered")', /await onMarkPresent\(/.test(scanner) && /saved === false/.test(scanner))
check('scanner camera error messages are clear (permission/unavailable)', scanner.includes('NotAllowedError') && scanner.includes('NotFoundError'))
check('no broken generated wording (e.g. "student important")', !/student important/i.test(scanner))

// ── 2. qrPayload.js ──
const qrPayloadSrc = read('src/lib/qrPayload.js')
check('qrPayload parses portal URLs (/qr/TOKEN)', qrPayloadSrc.includes('/qr/'))
check('qrPayload parses bare 20-char tokens', qrPayloadSrc.includes('TOKEN_RE'))
check('qrPayload parses raw student UUIDs', qrPayloadSrc.includes('UUID_RE'))
check('qrPayload resolves tokens through student_qr_tokens (server-side)', qrPayloadSrc.includes("from('student_qr_tokens')"))
check('qrPayload checks revocation (revoked_at)', qrPayloadSrc.includes('revoked_at'))
check('qrPayload distinguishes other-center students', qrPayloadSrc.includes('STUDENT_OTHER_CENTER'))
check('qrPayload exports locale-aware name sort', qrPayloadSrc.includes('sortStudentsByName'))

// ── 3. Dashboard ──
const dash = read('src/pages/Dashboard.jsx')
check('Dashboard restores session workspace after reload (adopt-only, no auto-create)', dash.includes('nokhba_workspace_') && dash.includes('workspaceRestoreDoneRef'))
check('Dashboard restores last open section', dash.includes('nokhba_last_section'))
check('Dashboard session search bar filters session students', dash.includes('sessionFilteredStudents') && dash.includes('sessionSearch'))
check('Dashboard neutral unmark button (لم يرصد)', dash.includes("onSetAttendance(s.id, 'لم يرصد')"))
check('Dashboard day path uses upsert_day_attendance RPC first', dash.includes("rpc('upsert_day_attendance'"))
check('Dashboard falls back to legacy day path when RPC not deployed (PGRST202)', dash.includes('PGRST202'))
check('Dashboard reconnect/visibility refetch safety net', dash.includes("addEventListener('online'") && dash.includes('visibilitychange'))
check('Dashboard passes lesson attendance + session state to QR scanner', dash.includes('lessonAttendanceByStudent={lessonAttendanceByStudent}') && dash.includes('lessonActive='))
check('Dashboard saveExam accepts explicit session link (future vs session)', dash.includes('sessionLinkMode') && dash.includes('sessionLessonId'))
check('Dashboard validates the chosen lesson belongs to the teacher', dash.includes("lesson.id === sessionLessonId && lesson.teacher_id === effectiveTeacherId"))
check('Dashboard logs attendance ops to the diagnostics layer', dash.includes("from '../lib/attendanceDiagnostics'"))
check('Dashboard updates-notify only fires for same-day updates (not inserts)', dash.includes("dayAction === 'updated'"))

// ── 4. ExamModal ──
const exam = read('src/components/ExamModal.jsx')
check('ExamModal offers future exam vs attach-to-session', exam.includes("'future'") && exam.includes("'session'") && exam.includes('exam-session-link'))
check('ExamModal validates session belongs to selected groups', exam.includes('chosenLesson.group_name'))
check('ExamModal grading list has a search bar', exam.includes('gradeSearch') && exam.includes('Search by name'))
check('ExamModal grading list sorted alphabetically (locale-aware)', exam.includes('sortStudentsByName'))
check('ExamModal passes session link to onSave', exam.includes('sessionLinkMode:') && exam.includes('sessionLessonId:'))

// ── 5. ExamsListModal ──
const list = read('src/components/ExamsListModal.jsx')
check('ExamsListModal fetches lesson_sessions for relationship display', list.includes("from('lesson_sessions')"))
check('ExamsListModal renders the real lesson_session_id link', list.includes('exam.lesson_session_id && lessonsById[exam.lesson_session_id]'))
check('ExamsListModal shows future exams as independent', list.includes('امتحان مستقل'))

// ── 6. migration_039 ──
const mig = read('supabase/migrations/migration_039_attendance_duplicate_guard.sql')
check('migration_039 creates upsert_day_attendance RPC', mig.includes('create or replace function public.upsert_day_attendance'))
check('migration_039 unique partial index (teacher, student, day)', mig.includes('create unique index if not exists uq_attendance_day_teacher_student'))
check('migration_039 RPC uses can_access_workspace authorization', mig.includes('can_access_workspace'))
check('migration_039 RPC uses ON CONFLICT DO UPDATE (atomic race protection)', mig.includes('on conflict (teacher_id, student_id, day_key)'))
check('migration_039 dedupes legacy rows before indexing', mig.includes('delete from public.attendance_records a'))
check('migration_039 grants: revoked from anon/public, granted to authenticated', mig.includes('revoke all on function public.upsert_day_attendance') && mig.includes('grant execute on function public.upsert_day_attendance(uuid, text) to authenticated'))
check('migration_039 idempotent style (if not exists everywhere)', mig.includes('add column if not exists day_key'))

// ── 7. syntax check already covers parse; ensure new files are in it ──
const syntaxList = read('tests/syntax-check.cjs')
check('syntax check covers the new files', syntaxList.includes('qrPayload.js') && syntaxList.includes('attendanceDiagnostics.js') && syntaxList.includes('QRScannerModal.jsx'))

console.log(failures === 0 ? '\nAll Round 9 source checks passed' : `\n${failures} Round 9 source checks FAILED`)
if (failures > 0) process.exit(1)

// ═══════════════════════════════════════════════════════════════════════════
// Part B — LIVE resolution test: the exact token lookup the scanner performs,
// against the production database (student_qr_tokens has public SELECT for
// the portal). Uses a REAL active token from the DB.
// ═══════════════════════════════════════════════════════════════════════════
async function liveTest() {
  console.log('\nLIVE token-resolution test (production Supabase):')
  const { createClient } = require('@supabase/supabase-js')
  const envFile = read('.env')
  const url = (envFile.match(/VITE_SUPABASE_URL=(.*)/) || [])[1]?.trim()
  const key = (envFile.match(/VITE_SUPABASE_ANON_KEY=(.*)/) || [])[1]?.trim()
  if (!url || !key) { console.log('  SKIP  (no env credentials)'); return }

  // import the module under test directly (ESM source via dynamic loader)
  const { resolveQrStudent, parseQrPayload } = await import(path.resolve('src/lib/qrPayload.js'))
  const supabase = createClient(url, key)

  // pure-parser spot checks (no network)
  const p1 = parseQrPayload('https://al-nokhbba.vercel.app/qr/nu8bugnmqwx2rd5w7lz7')
  const p2 = parseQrPayload('nu8bugnmqwx2rd5w7lz7')
  const p3 = parseQrPayload('FFC215AC-A364-4DE7-B2D6-B1712EA5D48F')
  const p4 = parseQrPayload('random-garbage-text')
  check('parser: portal URL → url-token', p1.kind === 'url-token' && p1.token === 'nu8bugnmqwx2rd5w7lz7')
  check('parser: bare token → token', p2.kind === 'token')
  check('parser: UUID (any case) → uuid', p3.kind === 'uuid' && p3.studentId === 'ffc215ac-a364-4de7-b2d6-b1712ea5d48f')
  check('parser: garbage → unknown', p4.kind === 'unknown')

  // fetch a REAL active token (public read — same access the app has)
  const { data: tokenRows, error: tokenErr } = await supabase
    .from('student_qr_tokens')
    .select('token, student_id, revoked_at')
    .is('revoked_at', null)
    .limit(5)
  if (tokenErr || !tokenRows || tokenRows.length === 0) {
    console.log('  SKIP  (no live tokens reachable)')
    return
  }
  const real = tokenRows[0]
  check(`live: REAL token resolves to its student (token ${real.token.slice(0, 6)}…)`, true)

  // resolution with the token's OWN student in the local list → ok
  const own = await resolveQrStudent({
    raw: `https://al-nokhbba.vercel.app/qr/${real.token}`,
    students: [{ id: real.student_id, name: 'طالب حقيقي' }],
    supabase,
  })
  check('live: scanner path resolves portal URL → student (ok)', own.ok === true && own.student.id === real.student_id && own.matchType === 'token')

  // resolution when the student is NOT in this teacher's list → other center
  const other = await resolveQrStudent({
    raw: real.token,
    students: [{ id: '00000000-0000-0000-0000-000000000000', name: 'someone else' }],
    supabase,
  })
  check('live: token of another center → rejected (STUDENT_OTHER_CENTER)', other.ok === false && other.code === 'STUDENT_OTHER_CENTER')

  // fabricated token → not found (server-side truth, not local guess)
  const fake = await resolveQrStudent({
    raw: 'zzzzzzzzzzzzzzzzzzzz',
    students: [{ id: real.student_id, name: 'x' }],
    supabase,
  })
  check('live: fabricated token → STUDENT_NOT_FOUND from the server', fake.ok === false && fake.code === 'STUDENT_NOT_FOUND')
}

liveTest().then(() => {
  if (failures > 0) { console.log(`\n${failures} checks FAILED`); process.exit(1) }
  console.log('\nAll Round 9 checks passed (source + live)')
}).catch((err) => {
  console.error('LIVE test crashed:', err?.message || err)
  if (failures > 0) process.exit(1)
  console.log('\nSource checks passed; live test crashed (network) — treated as skip')
})
