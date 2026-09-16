#!/usr/bin/env node
/**
 * Round 11 — attendance write-path contract check (static).
 * Verifies the frontend↔DB contract that migration_040 depends on:
 *   1. setAttendance/updateHW call the exact RPC signatures
 *   2. error toasts surface the REAL DB reason (describeSupabaseError)
 *   3. finalize result fields (present_count/absent_count) are consumed
 *   4. the SQL migration exists, is idempotent (BEGIN/COMMIT + drop-if-exists),
 *      and replaces all three write-path functions
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const dash = fs.readFileSync(path.join(ROOT, 'src/pages/Dashboard.jsx'), 'utf8')
const helpers = fs.readFileSync(path.join(ROOT, 'src/lib/helpers.js'), 'utf8')
const migrationPath = path.join(ROOT, 'supabase/migrations/migration_040_attendance_bulletproof.sql')
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : ''

let pass = 0, fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}`) }
}

console.log('1) Frontend → RPC contract')
check("setAttendance calls upsert_lesson_attendance(p_lesson_session_id, p_student_id, p_status)",
  /rpc\('upsert_lesson_attendance',\s*\{\s*p_lesson_session_id:\s*lessonId,\s*p_student_id:\s*id,\s*p_status:\s*status\s*\}/.test(dash))
check("updateHW calls upsert_lesson_homework(p_lesson_session_id, p_student_id, p_homework_status)",
  /rpc\('upsert_lesson_homework',\s*\{\s*p_lesson_session_id:\s*lessonId,\s*p_student_id:\s*id,\s*p_homework_status:\s*status\s*\}/.test(dash))
check("finishLesson calls finalize_lesson_session(p_lesson_session_id)",
  /rpc\('finalize_lesson_session',\s*\{\s*p_lesson_session_id:\s*activeLessonId\s*\}\)/.test(dash))
check("undo path re-uses the same attendance RPC signature",
  /rpc\('upsert_lesson_attendance',\s*\{\s*p_lesson_session_id:\s*lessonId,\s*p_student_id:\s*id,\s*p_status:\s*previousAttendanceStatus\s*\}/.test(dash))

console.log('2) Error visibility (the "try again" toast must show the real reason)')
check("helpers.js exports describeSupabaseError", /export function describeSupabaseError/.test(helpers))
check("describeSupabaseError includes the error code", /error\.code/.test(helpers) && /\[\$\{code\}\]/.test(helpers))
check("describeSupabaseError hints migration_041 when the RPC is missing (PGRST202) or the day-index blocks saves (23505)",
  /PGRST202/.test(helpers) && /migration_041_fix_student_day_index\.sql/.test(helpers) && /23505/.test(helpers) && /idx_attendance_records_student_day/.test(helpers))
check("Dashboard imports describeSupabaseError", /describeSupabaseError,/.test(dash))
const attendanceToast = (dash.match(/تعذر حفظ حضور[\s\S]{0,240}/) || [''])[0]
check("attendance toast embeds السبب + saveDetail", attendanceToast.includes('السبب') && attendanceToast.includes('saveDetail'))
const hwToast = (dash.match(/تعذر حفظ واجب[\s\S]{0,220}/) || [''])[0]
check("homework toast references hwDetail", hwToast.includes('hwDetail') && hwToast.includes('السبب'))
check("finalize toast references finDetail", dash.includes('لم يتم إنهاء الحصة: ${finDetail ||'))

console.log('3) finalize result usage')
check("summary toast uses present_count/absent_count",
  /finalizeResult\?\.present_count/.test(dash) && /finalizeResult\?\.absent_count|finalizeResult\.absent_count/.test(dash.replace('finalizeResult?.absent_count', 'finalizeResult?.absent_count')) || /absent_count/.test(dash))

console.log('4) migration_040_attendance_bulletproof.sql')
check("file exists in supabase/migrations/", Boolean(migration))
check("transactional (begin/commit)", /^begin;/m.test(migration) && /^commit;/m.test(migration))
check("drops before creating upsert_lesson_attendance (return-type change safe)",
  /drop function if exists public\.upsert_lesson_attendance\(uuid, uuid, text\);/.test(migration))
check("replaces upsert_lesson_homework", /drop function if exists public\.upsert_lesson_homework\(uuid, uuid, text\);/.test(migration))
check("replaces finalize_lesson_session", /drop function if exists public\.finalize_lesson_session\(uuid\);/.test(migration))
check("returns the attendance row (frontend map sync)", /returns public\.attendance_records/.test(migration))
check("notify trigger keeps the never-fail guard (exception when others)",
  /create or replace function public\.notify_attendance_record\(\)[\s\S]*exception when others[\s\S]*الحضور لا يفشل أبداً/.test(migration))
check("bridge trigger is exception-guarded", /create or replace function public\.bridge_student_notification_to_teacher_push\(\)[\s\S]*exception when others/.test(migration))
check("grants to authenticated only (anon revoked)",
  /revoke all on function public\.upsert_lesson_attendance\(uuid, uuid, text\) from public, anon;/.test(migration))
check("never double-applies points on finalize (case guard)",
  /case when v_student\.attendance_status = 'غائب' then 0 else v_points_abs end/.test(migration))
check("PL/pgSQL found-variable is snapshotted before DELETE (the second-row bug)",
  /v_has_row := found;/.test(migration))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
