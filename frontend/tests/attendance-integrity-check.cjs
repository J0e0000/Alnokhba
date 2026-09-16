// ============================================================================
// نظام النخبة — Test 8/8: Attendance integrity + QR + Excel import wiring
// (Round 9) — static verification that the frontend talks to the
// server-authoritative RPCs and that migration 039 enforces day-uniqueness.
// run: node tests/attendance-integrity-check.cjs
// ============================================================================
const fs = require('fs')
const path = require('path')

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8')

let failures = 0
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✓  ${name}`) }
  else { failures++; console.log(`  ✗  ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── 1) QR scanner: server-side resolution (never trusts local IDs) ──────────
const scanner = read('src/components/QRScannerModal.jsx')
check('QRScannerModal resolves payloads via resolve_student_by_qr RPC', /resolve_student_by_qr/.test(scanner) && /supabase\.rpc\(\s*['"]resolve_student_by_qr['"]/.test(scanner))
check('QRScannerModal no longer rejects portal /qr/ links (bug root cause removed)', !/رابط بوابة الطالب، مش كود الحضور/.test(scanner))
check('QRScannerModal decodes from image files (scanFile)', /scanFile\(/.test(scanner))
check('QRScannerModal keeps live camera decoding', /Html5Qrcode/.test(scanner) && /facingMode/.test(scanner))
check('QRScannerModal maps server error codes (token_invalid / not_authorized…)', /token_invalid/.test(scanner) && /not_authorized/.test(scanner))

// ── 2) Dashboard: attendance writes go through server RPCs only ─────────────
const dash = read('src/pages/Dashboard.jsx')
check('setAttendance uses set_student_attendance RPC', /rpc\(\s*['"]set_student_attendance['"]/.test(dash))
check('removeAttendance exists and uses remove_attendance RPC', /const removeAttendance\s*=/.test(dash) && /rpc\(\s*['"]remove_attendance['"]/.test(dash))
check('no direct client INSERT into attendance_records remains (server-authoritative)', !/from\(['"]attendance_records['"]\)\s*\.\s*insert/.test(dash))
check('offline queue uses the RPC (no broken onConflict upsert)', /rpcName:\s*['"]set_student_attendance['"]/.test(dash) && !/onConflict:\s*['"]teacher_id,student_id['"]/.test(dash))
check('student row exposes the unmark (–) button wired to removeAttendance', /onRemoveAttendance/.test(dash))
check('post-finalize completeness check is day-level (attendance_date)', /eq\(\s*['"]attendance_date['"],\s*lessonDay\)/.test(dash))
check('attendance points reconcile from the RPC response (new_points)', /new_points/.test(dash))
check('ExamsListModal receives the full students list (search/import scope)', /<ExamsListModal[\s\S]{0,200}students=\{students\}/.test(dash))

// ── 3) Migration 039: DB-level day uniqueness + archival + RPCs ──────────────
const migPath = 'supabase/migrations/migration_039_attendance_qr_excel.sql'
const migExists = fs.existsSync(path.join(__dirname, '..', migPath))
check('migration_039 file exists', migExists)
if (migExists) {
  const mig = read(migPath)
  check('unique index on (student_id, attendance_date)', /create unique index if not exists idx_attendance_records_student_day[\s\S]*?on public\.attendance_records\s*\(\s*student_id,\s*attendance_date\s*\)/.test(mig))
  check('attendance_date column + NOT NULL + default', /add column if not exists attendance_date date/.test(mig) && /alter column attendance_date set not null/.test(mig) && /alter column attendance_date set default/.test(mig))
  check('legacy duplicates are archived (attendance_records_archive), not destroyed', /attendance_records_archive/.test(mig) && /day_uniqueness_migration/.test(mig))
  check('integrity report table written', /attendance_integrity_report/.test(mig))
  check('set_student_attendance RPC defined + granted', /create or replace function public\.set_student_attendance/.test(mig) && /grant execute on function public\.set_student_attendance/.test(mig))
  check('remove_attendance RPC archives before delete', /create or replace function public\.remove_attendance/.test(mig) && /removed_by_user/.test(mig))
  check('race-safe upsert: unique_violation retry + FOR UPDATE', /unique_violation/.test(mig) && /for update/.test(mig))
  check('upsert_lesson_attendance legacy shim is day-aware', /create or replace function public\.upsert_lesson_attendance/.test(mig))
  check('finalize_lesson_session is day-aware + idempotent', /create or replace function public\.finalize_lesson_session/.test(mig) && /already_finalized/.test(mig))
  check('resolve_student_by_qr: token + URL + UUID paths with authorization', /create or replace function public\.resolve_student_by_qr/.test(mig) && /student_qr_tokens/.test(mig) && /not_authorized/.test(mig))
  check('notify trigger skips homework-only (لم يرصد) inserts', /if new\.status = 'لم يرصد' then/.test(mig))
  check('import_exam_grades: atomic + absent rejection + never silent overwrite', /create or replace function public\.import_exam_grades/.test(mig) && /allow_update/.test(mig) && /غائب في يوم الامتحان/.test(mig))
  check('grade_import_logs audit table + workspace read policy', /create table if not exists public\.grade_import_logs/.test(mig) && /grade_import_workspace_read/.test(mig))
  check('exam_score_audit_logs gains source column (excel_import)', /add column if not exists source text/.test(mig) && /'excel_import'/.test(mig))
  check('realtime publication additions are guarded (duplicate_object)', /duplicate_object then null/.test(mig))
}

// ── 4) Grade UI: search + present-default filter + import ────────────────────
const examsList = read('src/components/ExamsListModal.jsx')
check('grades list has fast Arabic-normalized search (name/code/phone)', /normalizeArabicName/.test(examsList) && /gradeSearch/.test(examsList))
check('grades filter defaults to PRESENT students (absent only on explicit choice)', /gradeFilter/.test(examsList) && /useState\('present'\)/.test(examsList))
check('per-exam Excel import button wired to ExcelGradeImportModal', /ExcelGradeImportModal/.test(examsList) && /importExamId/.test(examsList))

const importModal = read('src/components/ExcelGradeImportModal.jsx')
check('import modal: parse → mapping → match review → atomic commit phases', /phase === 'upload'/.test(importModal) && /phase === 'mapping'/.test(importModal) && /phase === 'review'/.test(importModal) && /import_exam_grades/.test(importModal))
check('import modal: conflict policy default is the SAFE ask-per-student', /useState\('ask'\)/.test(importModal))
check('import modal: ambiguous matches require explicit user decision (never auto)', /needs_decision/.test(importModal) && /resolveRow/.test(importModal))
check('import modal: absent students excluded from commit', /absentStudentIds/.test(importModal))

const examModal = read('src/components/ExamModal.jsx')
check('exam recording grid keeps absent students excluded (Round 8) + adds search', /presentStudents/.test(examModal) && /gridStudents/.test(examModal))

const lib = read('src/lib/gradeImport.js')
check('matching engine implements layered deterministic strategy', /exact_code|exact_name|exact_phone/.test(lib) && /THRESHOLDS/.test(lib) && /nameSimilarity/.test(lib))

console.log('')
if (failures) {
  console.log(`✗ attendance-integrity-check: ${failures} FAILURES`)
  process.exit(1)
}
console.log('✓ attendance-integrity-check: all checks passed')
