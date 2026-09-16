// Final Round check — the three user-reported bugs + iOS compatibility build.
// Verifies the full wiring at the source level:
//   1. Attendance fix: migration 041 exists, drops the per-day unique blocker,
//      rebuilds the three RPCs with the same signatures, keeps history
//      (same-day-only dedup), includes the 42P13 drop-guard (the deployment
//      error the user hit with migration 040), frontend explains save
//      failures with the migration hint, offline queue no longer uses a dead
//      onConflict target.
//   2. Exam counter (دفتر الدرجات) search bar restored: gradebook section
//      carries a search input + pass/fail counters + per-student results
//      table; ExamsListModal carries its own search bar; the lesson (sessions)
//      students table gets a search bar too.
//   3. iOS blank page: vite.config.js targets es2017/safari13, css-compat
//      post-build sweep is wired into the build, index.html has the ES5
//      loader + boot watchdog, main.jsx sets the boot flag.
const fs = require('fs')
const path = require('path')

const read = (f) => fs.readFileSync(f, 'utf8')
const exists = (f) => fs.existsSync(f)
let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

console.log('Final Round (attendance + search bar + iOS) checks:')

// ── 1. Attendance fix (migration 041) ──
const mig = 'supabase/migrations/migration_041_master_fix_all.sql'
check('migration 041 exists', exists(mig))
const sql = exists(mig) ? read(mig) : ''
check('migration 041: drops every unique constraint/index on attendance_records via catalog', sql.includes('pg_constraint') && sql.includes('pg_indexes'))
check('migration 041: new unique (student × lesson) partial index', sql.includes('attendance_records_student_lesson_uniq') && sql.includes('where lesson_session_id is not null'))
check('migration 041: rebuilds upsert_lesson_attendance(uuid, uuid, text)', sql.includes('create or replace function public.upsert_lesson_attendance'))
check('migration 041: rebuilds upsert_lesson_homework(uuid, uuid, text)', sql.includes('create or replace function public.upsert_lesson_homework'))
check('migration 041: rebuilds finalize_lesson_session(uuid)', sql.includes('create or replace function public.finalize_lesson_session'))
check('migration 041: 42P13 guard — drop-if-exists before each rebuild', sql.includes('drop function if exists public.upsert_lesson_attendance(uuid, uuid, text)') && sql.includes('drop function if exists public.upsert_lesson_homework(uuid, uuid, text)') && sql.includes('drop function if exists public.finalize_lesson_session(uuid)'))
check('migration 041: 42P13 guard — dependency fallback with 2BP01 check', sql.includes("sqlstate <> '2BP01'") && sql.includes('cascade'))
check('migration 041: unique_violation race fallback (no ON CONFLICT dependence)', sql.includes('when unique_violation then'))
check('migration 041: same-day-only null-lesson dedup (history preserved)', sql.includes("(a.recorded_at at time zone 'UTC')::date") && sql.includes('= (b.recorded_at at time zone'))
check('migration 041: RLS workspace policy', sql.includes('attendance_workspace_access'))
check('migration 041: idempotent (if not exists / drop policy if exists / create or replace)', sql.includes('drop policy if exists') && sql.includes('create or replace'))
check('migration 041: grants to authenticated only', sql.includes('revoke execute') && sql.includes('grant execute') && sql.includes('to authenticated'))
check('migration 041: self-check warning for future per-day constraints', sql.includes('raise warning'))
check('migration 041 replaces 040 — old broken file removed from package', !exists('supabase/migrations/migration_040_final_attendance_fix.sql'))

// ── 2. Frontend: Dashboard ──
const dash = read('src/pages/Dashboard.jsx')
check('Dashboard: explainSaveError maps unique-violation → migration 041 hint', dash.includes('explainSaveError') && dash.includes('migration_041'))
check('Dashboard: attendance toast appends السبب', dash.includes('السبب: ${reason}'))
check('Dashboard: offline attendance queue uses plain insert (no dead onConflict)', dash.includes("method: 'insert'") && !dash.includes("onConflict: 'teacher_id,student_id'"))
check('Dashboard: exam counter search state + input (data-tour exam-counter-search)', dash.includes('examSearch') && dash.includes('exam-counter-search'))
check('Dashboard: exam counter stat cards (passed/failed/rate)', dash.includes('examCounter.passed') && dash.includes('examCounter.failed') && dash.includes('examCounter.rate'))
check('Dashboard: per-student exam results table renders', dash.includes('examResults.map') && dash.includes('exam-counter-table'))
check('Dashboard: search matches name/code/phone/exam title', dash.includes('s.code, s.phone, s.group_name') || dash.includes('exams.map((ex) => ex.exam_title'))
check('Dashboard: sessions students search bar', dash.includes('sessionSearch') && dash.includes('session-students-search'))
check('Dashboard: session table renders searchedSessionStudents with empty state', dash.includes('searchedSessionStudents.map') && dash.includes('مفيش طالب مطابق'))

// ── 3. Frontend: ExamsListModal search ──
const list = read('src/components/ExamsListModal.jsx')
check('ExamsListModal: search bar present with placeholder', list.includes('ابحث بالامتحان / القسم / اسم الطالب'))
check('ExamsListModal: filters exams by title/sections/student names', list.includes('filteredExams') && list.includes('studentNames'))
check('ExamsListModal: empty search state', list.includes('مفيش امتحانات مطابقة'))

// ── 4. iOS compatibility build profile ──
check('vite.config.js exists', exists('vite.config.js'))
const vite = exists('vite.config.js') ? read('vite.config.js') : ''
check('vite.config.js: build.target es2017 (parse-safe iOS 11+)', vite.includes("target: 'es2017'"))
check('vite.config.js: build.cssTarget safari13 (static color fallbacks)', vite.includes("cssTarget: 'safari13'"))
check('vite.config.js: react + tailwind plugins wired', vite.includes('@vitejs/plugin-react') && vite.includes('@tailwindcss/vite'))
const pkg = JSON.parse(read('package.json'))
check('package.json: build chains css-compat sweep', String(pkg.scripts.build).includes('css-compat.mjs'))
check('scripts/css-compat.mjs exists', exists('scripts/css-compat.mjs'))
const compat = exists('scripts/css-compat.mjs') ? read('scripts/css-compat.mjs') : ''
check('css-compat: dvh/svh → vh fallback rewrite', compat.includes('dvh|svh|lvh') && compat.includes('$1vh'))
check('css-compat: fails the build if oklch survives', compat.includes('FATAL') && compat.includes('oklch'))

// ── 5. index.html boot layer ──
const html = read('index.html')
check('index.html: ES5 loader screen before JS', html.includes('__nokhbaBooted') && html.includes('paintLoader'))
check('index.html: 15s boot watchdog with Arabic fallback', html.includes('setTimeout') && html.includes('نظام الآيفون قديم شوية'))
check('index.html: viewport-fit=cover for notched iPhones', html.includes('viewport-fit=cover'))
const main = read('src/main.jsx')
check('main.jsx: sets window.__nokhbaBooted = true before render', main.includes('__nokhbaBooted = true'))

console.log('')
if (failures > 0) {
  console.log(`${failures} Final Round checks FAILED`)
  process.exit(1)
}
console.log('ALL Final Round checks PASSED')
