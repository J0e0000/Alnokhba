// Round 8 check — Exam score editing (two independent operations).
// Verifies the full wiring at the source level:
//   1. ExamsListModal: separate max-score edit (Operation A) and per-student
//      grade edit (Operation B) with the right RPCs, version-based concurrency,
//      conflict handling + reload, instant local update from the RPC response,
//      absent-student lock, audit log UI, realtime subscription, NO blocking
//      full-screen dialog for simple edits (inline editors), toasts.
//   2. ExamModal: absent students excluded from the grading list + note.
//   3. Dashboard: attendance map passed to ExamModal; version fields flow
//      through loadAll + the realtime handler.
//   4. Backend: migration 038 exists with both RPCs, audit table, grants,
//      realtime publication; no INSERT/DELETE policy on the audit table
//      (append-only).
//   5. i18n: ar + en keys for the absent-student note.
const fs = require('fs')
const path = require('path')

const read = (f) => fs.readFileSync(f, 'utf8')
const exists = (f) => fs.existsSync(f)
let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

console.log('Exam score editing (Round 8) checks:')

// ── 1. ExamsListModal ──
const list = read('src/components/ExamsListModal.jsx')
check('ExamsListModal uses update_exam_max_score RPC', list.includes("rpc('update_exam_max_score'"))
check('ExamsListModal uses update_student_exam_score RPC', list.includes("rpc('update_student_exam_score'"))
check('A: passes p_expected_version (exam version)', /p_exam_id[^;]*?p_new_max[^;]*?p_expected_version:\s*exam\.version/s.test(list))
check('B: passes p_expected_version (score row version)', /p_score_id[^;]*?p_new_score[^;]*?p_expected_version:\s*row\.version/s.test(list))
check('conflict detection + message cleaning', list.includes('CONFLICT') && list.includes('isConflict'))
check('conflict → reload authoritative data', /isConflict[^}]*\{[^}]*setMaxEdit\(null\);\s*load\(\)/s.test(list) || /if \(isConflict\) \{[^}]*load\(\)/s.test(list))
check('instant local state update from RPC response (scores)', /setScoresByExam\(\(prev\)[\s\S]{0,700}data\?\.total_score/.test(list))
check('instant local state update from RPC response (exams max)', /setExams\(\(prev\)[\s\S]{0,500}data\?\.per_section/.test(list))
check('absent students: edit disabled + badge', list.includes('disabled={absent}') && list.includes('>غائب<'))
check('absence detection mirrors RPC logic (lesson first, then exam day)', list.includes('lessonAtt') && list.includes('dayAtt'))
check('audit log UI (سجل التعديلات)', list.includes('exam_score_audit_logs') && list.includes('سجل التعديلات'))
check('NO blocking full-screen dialog for simple grade edits (inline inputs)', /maxEdit[\s\S]{0,600}<input/.test(list) && !/ConfirmDialog[\s\S]{0,300}update_student_exam_score/.test(list))
check('confirm dialog only for exam DELETE', /ConfirmDialog[\s\S]{0,200}حذف الامتحان/.test(list))
check('toast on success (grade)', /درجة \$\{row\.student_name\} اتحدثت/.test(list))
check('toast on success (max)', /العظمى لـ «\$\{exam\.title\}» اتحدثت/.test(list))
check('realtime subscription while modal open', list.includes('postgres_changes') && list.includes('exams-list-'))
check('portal refresh ping after grade edit', list.includes("pingPortalRefresh(effectiveTeacherId, 'exam-score')"))
check('behavior note logged like original recording', list.includes('تعديل درجة امتحان'))
check('teacher scope on every query', (list.match(/\.eq\('teacher_id', effectiveTeacherId\)/g) || []).length >= 3)

// ── 2. ExamModal ──
const modal = read('src/components/ExamModal.jsx')
check('ExamModal accepts attendanceByStudent prop', modal.includes('attendanceByStudent = {}'))
check('grading list = present students only', modal.includes('presentStudents.map') && modal.includes("attendanceByStudent[s.id] !== 'غائب'"))
check('absent students shown separately with names', modal.includes('absentStudents') && modal.includes("absentStudents.map((s) => s.name)"))
check('absent note translation used', modal.includes("t('exam_absent_note')"))
check('save() records present students only', /const records = presentStudents\.map/.test(modal))
check('allScoresFilled computed on present students', /allScoresFilled = presentStudents\.length > 0/.test(modal))

// ── 3. Dashboard ──
const dash = read('src/pages/Dashboard.jsx')
check('Dashboard builds exam attendance map', /const examAttendanceByStudent = useMemo/.test(dash))
check('Dashboard passes attendance map to ExamModal', /ExamModal[\s\S]{0,200}attendanceByStudent=\{examAttendanceByStudent\}/.test(dash))
check('examScoresByStudent rows carry version + exam_id (loadAll)', /scoresMap\[row\.student_id\]\.push\(\{ id: row\.id, exam_id: row\.exam_id[\s\S]{0,200}version: row\.version/.test(dash))
check('realtime handler carries version + exam_id', /const mapped = \{ id: row\.id, exam_id: row\.exam_id[\s\S]{0,400}version: row\.version/.test(dash))

// ── 4. Backend deliverables ──
const mig = exists('supabase/migrations/migration_038_exam_score_editing.sql') ? read('supabase/migrations/migration_038_exam_score_editing.sql') : ''
check('migration 038 exists', mig.length > 1000)
check('migration: update_exam_max_score RPC', mig.includes('create or replace function public.update_exam_max_score'))
check('migration: update_student_exam_score RPC', mig.includes('create or replace function public.update_student_exam_score'))
check('migration: audit table exam_score_audit_logs', mig.includes('create table if not exists public.exam_score_audit_logs'))
check('migration: audit append-only (select policy only, no update/delete policies)', (() => { const policies = mig.split('\n').filter((l) => /create policy/i.test(l)); return policies.length > 0 && policies.every((l) => !/for (update|delete)/i.test(l)) })())
check('migration: version columns on both tables', /alter table public\.exams[\s\S]{0,200}add column if not exists version bigint/.test(mig) && /alter table public\.exam_scores[\s\S]{0,200}add column if not exists version bigint/.test(mig))
check('migration: conditional update (optimistic concurrency) on exams', /where id = p_exam_id[\s\S]{0,150}\(p_expected_version is null or version = p_expected_version\)/.test(mig))
check('migration: conditional update (optimistic concurrency) on scores', /where id = p_score_id[\s\S]{0,150}\(p_expected_version is null or version = p_expected_version\)/.test(mig))
check('migration: [CONFLICT] markers for both RPCs', (mig.match(/\[CONFLICT\]/g) || []).length === 2)
check('migration: absent protection (attendance check)', mig.includes("v_att_status = 'غائب'"))
check('migration: server-side authorization via can_access_workspace', (mig.match(/can_access_workspace\(/g) || []).length >= 2)
check('migration: score > max rejection', mig.includes('أكبر من الدرجة العظمى'))
check('migration: historical corruption guard', mig.includes('أعلى من العظمى الجديدة'))
check('migration: grants revoked from anon/public', /revoke all on function public\.update_exam_max_score[\s\S]{0,120}from anon/.test(mig) && /revoke all on function public\.update_student_exam_score[\s\S]{0,120}from anon/.test(mig))
check('migration: grants to authenticated', /grant execute on function public\.update_exam_max_score[\s\S]{0,120}to authenticated/.test(mig))
check('migration: idempotent (if not exists / create or replace / drop policy if exists)', mig.includes('drop policy if exists') && mig.includes('add column if not exists'))
check('migration: realtime publication guards', (mig.match(/alter publication supabase_realtime add table/g) || []).length === 3)
check('migration: RPC A does NOT touch points (spec: earned points unchanged)', !/update public\.students[\s\S]{0,250}points/s.test(mig.split('create or replace function public.update_student_exam_score')[0].split('create or replace function public.update_exam_max_score')[1] || ''))
check('migration: RPC B adjusts points with the original model', /v_points_delta := \(round\(p_new_score - v_passing\) - round\(v_score\.total_score - v_passing\)\)::int/.test(mig))
check('apply.json for 038 exists (SQL-runner page format)', exists('supabase/migrations/migration_038_apply.json'))

// ── 5. i18n ──
const i18n = read('src/lib/i18n.js')
check('i18n: ar absent-student keys', i18n.includes('exam_absent_note') && i18n.includes('exam_absent_students'))
check('i18n: en absent-student keys', i18n.includes("exam_absent_note: 'Mark the student present first"))

console.log(`\n${failures === 0 ? 'ALL exam-edit checks PASSED' : failures + ' CHECKS FAILED'}\n`)
process.exit(failures === 0 ? 0 : 1)
