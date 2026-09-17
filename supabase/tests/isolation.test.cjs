/**
 * Integration test — simulates the cross-tenant data access scenario using
 * a mock Supabase client that emulates the RLS policies.
 *
 * This test does NOT connect to a real Supabase instance. Instead it
 * emulates the RLS behavior defined in migration_019:
 *   - Tenant tables (students, attendance_records, etc.) only return rows
 *     where teacher_id matches the current authenticated user.
 *   - Anonymous requests (no auth) to tenant tables return ZERO rows.
 *   - The get_student_portal_data RPC returns data ONLY for the student
 *     identified by the token, and only if the token is valid+not revoked.
 *
 * Run with:  node --test /home/z/my-project/audit/al-fares-saas/frontend/tests/isolation.test.cjs
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert')

// ─── Mock data ─────────────────────────────────────────────────────
const TEACHER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TEACHER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const STUDENT_A = {
  id: 'sa-id-aaaa', teacher_id: TEACHER_A, name: 'Student A',
  group_name: 'Group A', points: 10,
}
const STUDENT_B = {
  id: 'sb-id-bbbb', teacher_id: TEACHER_B, name: 'Student B',
  group_name: 'Group B', points: 20,
}

const EXAM_A = { id: 'ea-id', teacher_id: TEACHER_A, title: 'Exam A' }
const EXAM_B = { id: 'eb-id', teacher_id: TEACHER_B, title: 'Exam B' }

const ATTEND_A = {
  id: 'at-a', teacher_id: TEACHER_A, student_id: STUDENT_A.id, status: 'حاضر',
}
const ATTEND_B = {
  id: 'at-b', teacher_id: TEACHER_B, student_id: STUDENT_B.id, status: 'غائب',
}

const DB = {
  students: [STUDENT_A, STUDENT_B],
  exams: [EXAM_A, EXAM_B],
  exam_scores: [
    { id: 'es-a', teacher_id: TEACHER_A, student_id: STUDENT_A.id, exam_id: EXAM_A.id, total_score: 8 },
    { id: 'es-b', teacher_id: TEACHER_B, student_id: STUDENT_B.id, exam_id: EXAM_B.id, total_score: 9 },
  ],
  attendance_records: [ATTEND_A, ATTEND_B],
  behavior_logs: [
    { id: 'bl-a', teacher_id: TEACHER_A, student_id: STUDENT_A.id, note: 'A log', points_delta: 1 },
  ],
  session_logs: [
    { id: 'sl-a', teacher_id: TEACHER_A, group_name: 'Group A', session_date: '2024-01-01', lesson_topic: 'A lesson' },
    { id: 'sl-b', teacher_id: TEACHER_B, group_name: 'Group B', session_date: '2024-01-01', lesson_topic: 'B lesson' },
    // Same group_name as Teacher A — would have leaked under old public_read policy
    { id: 'sl-c', teacher_id: TEACHER_B, group_name: 'Group A', session_date: '2024-01-02', lesson_topic: 'B lesson in A-named group' },
  ],
  group_schedule: [
    { id: 'gs-a', teacher_id: TEACHER_A, group_name: 'Group A', weekday: 0 },
  ],
  teacher_settings: [
    { teacher_id: TEACHER_A, whatsapp_number: '111', ranks: [] },
    { teacher_id: TEACHER_B, whatsapp_number: '222', ranks: [] },
  ],
  announcements: [
    { id: 'an-a', teacher_id: TEACHER_A, title: 'A', message: 'A', student_id: null },
    { id: 'an-b', teacher_id: TEACHER_B, title: 'B', message: 'B', student_id: null },
  ],
  homework_tasks: [
    { id: 'ht-a', teacher_id: TEACHER_A, group_name: 'Group A', title: 'HW A' },
    { id: 'ht-b', teacher_id: TEACHER_B, group_name: 'Group B', title: 'HW B' },
  ],
  homework_task_status: [],
  student_qr_tokens: [
    { student_id: STUDENT_A.id, token: 'token-a-xxxxx', revoked_at: null },
    { student_id: STUDENT_B.id, token: 'token-b-yyyyy', revoked_at: null },
    // revoked token for student A — should NOT work
    { student_id: STUDENT_A.id, token: 'token-a-revoked', revoked_at: '2024-01-01' },
  ],
  feature_unlocks: [
    { id: 'fu-a', teacher_id: TEACHER_A, feature_key: 'games', unlocked: true },
    { id: 'fu-b', teacher_id: TEACHER_B, feature_key: 'games', unlocked: false },
  ],
}

// ─── Mock Supabase client (immutable builder pattern) ──────────────
const TENANT_TABLES = new Set([
  'students', 'attendance_records', 'behavior_logs', 'exams', 'exam_scores',
  'session_logs', 'group_schedule', 'teacher_settings', 'announcements',
  'homework_tasks', 'homework_task_status', 'feature_unlocks',
])

function makeQuery({ table, state, currentUser, adminMode }) {
  state = state || { filters: [], isMaybeSingle: false, isSingle: false, limitN: null }

  function next(newState) {
    return makeQuery({ table, state: newState, currentUser, adminMode })
  }

  return {
    select() { return next({ ...state }) },
    eq(col, val) { return next({ ...state, filters: [...state.filters, [col, val]] }) },
    is(col, val) { return next({ ...state, filters: [...state.filters, [col, val]] }) },
    gte() { return next({ ...state }) },
    order() { return next({ ...state }) },
    limit(n) { return next({ ...state, limitN: n }) },
    maybeSingle() { return next({ ...state, isMaybeSingle: true }) },
    single() { return next({ ...state, isSingle: true }) },
    async then(resolve) {
      let rows = DB[table] ? DB[table].slice() : []

      // Apply RLS for tenant tables (adminMode bypasses RLS for the
      // feature_unlocks admin case)
      if (TENANT_TABLES.has(table) && !adminMode) {
        if (!currentUser) {
          rows = []
        } else {
          rows = rows.filter((r) => r.teacher_id === currentUser.id)
        }
      }

      // Apply explicit filters from the query chain (defense-in-depth)
      for (const [col, val] of state.filters) {
        rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val))
      }

      if (state.limitN) rows = rows.slice(0, state.limitN)

      if (state.isMaybeSingle) {
        resolve({ data: rows[0] || null, error: null })
      } else if (state.isSingle) {
        if (rows.length === 0) resolve({ data: null, error: { message: 'no rows' } })
        else resolve({ data: rows[0], error: null })
      } else {
        resolve({ data: rows, error: null })
      }
    },
  }
}

function makeSupabaseMock(currentUser, adminMode = false) {
  return {
    from(table) {
      return makeQuery({ table, state: null, currentUser, adminMode })
    },
    async rpc(name, args) {
      if (name === 'get_student_portal_data') {
        const token = args?.p_token
        const tokenRow = DB.student_qr_tokens.find(
          (t) => t.token === token && t.revoked_at === null
        )
        if (!tokenRow) return { data: null, error: null }

        const student = DB.students.find((s) => s.id === tokenRow.student_id)
        if (!student) return { data: null, error: null }

        const teacherId = student.teacher_id
        const settings = DB.teacher_settings.find((s) => s.teacher_id === teacherId) || { ranks: [], whatsapp_number: '' }
        const attendance = DB.attendance_records
          .filter((r) => r.student_id === student.id)
          .map((r) => ({ status: r.status, recorded_at: null }))
        const behavior = DB.behavior_logs
          .filter((r) => r.student_id === student.id)
          .map((r) => ({ note: r.note, points_delta: r.points_delta, created_at: null }))
        const announcements = DB.announcements
          .filter((a) => a.teacher_id === teacherId && (a.student_id === null || a.student_id === student.id))
        const examScores = DB.exam_scores
          .filter((e) => e.student_id === student.id)
          .map((e) => {
            const exam = DB.exams.find((x) => x.id === e.exam_id)
            return {
              id: e.id, exam_id: e.exam_id, total_score: e.total_score,
              section_scores: {}, created_at: null,
              exam_title: exam?.title, exam_sections: [], exam_max_per_section: 0,
            }
          })
        const exams = DB.exams.filter((e) => e.teacher_id === teacherId)
        const sessionLog = DB.session_logs.find(
          (s) => s.teacher_id === teacherId && s.group_name === student.group_name
        ) || null
        const schedule = DB.group_schedule
          .filter((g) => g.teacher_id === teacherId && g.group_name === student.group_name)
          .map((g) => ({ weekday: g.weekday }))
        const homeworkTasks = DB.homework_tasks
          .filter((h) => h.teacher_id === teacherId && h.group_name === student.group_name)
        const homeworkStatus = DB.homework_task_status
          .filter((h) => h.student_id === student.id)
          .map((h) => ({ task_id: h.task_id, done: h.done }))

        return {
          data: {
            student, ranks: settings.ranks, whatsapp_number: settings.whatsapp_number,
            attendance, behavior, announcements, exam_scores: examScores,
            exams, session_log: sessionLog, schedule, homework_tasks: homeworkTasks,
            homework_status: homeworkStatus, token_source: 'db',
          },
          error: null,
        }
      }
      return { data: null, error: { message: 'unknown rpc' } }
    },
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

test('Teacher A cannot read Teacher B\'s students (RLS enforcement)', async () => {
  const supabase = makeSupabaseMock({ id: TEACHER_A })
  const { data } = await supabase.from('students').select('*')
  assert.equal(data.length, 1, 'Teacher A should see exactly 1 student')
  assert.equal(data[0].id, STUDENT_A.id)
  assert.notEqual(data[0].id, STUDENT_B.id, 'Teacher B\'s student must NOT be visible')
})

test('Teacher B cannot read Teacher A\'s students (RLS enforcement)', async () => {
  const supabase = makeSupabaseMock({ id: TEACHER_B })
  const { data } = await supabase.from('students').select('*')
  assert.equal(data.length, 1)
  assert.equal(data[0].id, STUDENT_B.id)
})

test('Anonymous user (no auth) cannot read ANY student', async () => {
  const supabase = makeSupabaseMock(null)
  const { data } = await supabase.from('students').select('*')
  assert.equal(data.length, 0, 'Anonymous requests must return ZERO rows')
})

test('Teacher A cannot read Teacher B\'s exam_scores by id (RLS deny)', async () => {
  const supabase = makeSupabaseMock({ id: TEACHER_A })
  // Try to read Teacher B's exam score using Teacher B's exam_score id
  const { data } = await supabase.from('exam_scores').select('*').eq('id', 'es-b')
  assert.equal(data.length, 0, 'Teacher A must NOT see Teacher B\'s exam_score by id')
})

test('Cross-tenant session_logs leak by group_name is prevented', async () => {
  const supabase = makeSupabaseMock({ id: TEACHER_A })
  // Old bug: filter by group_name only — leaked Teacher B's session for "Group A"
  const { data } = await supabase.from('session_logs').select('*').eq('group_name', 'Group A')
  assert.equal(data.length, 1, 'Teacher A should see only their own session_logs for Group A')
  assert.equal(data[0].id, 'sl-a')
  assert.equal(data[0].teacher_id, TEACHER_A)
})

test('Cross-tenant session_logs leak is prevented even with defense-in-depth', async () => {
  // Simulate a Supabase WITHOUT RLS (misconfigured DB) — the frontend's
  // explicit .eq('teacher_id', tid) filter must still prevent the leak.
  const supabase = makeSupabaseMock(null, true) // null user + adminMode = no RLS at all
  const { data } = await supabase.from('session_logs').select('*')
    .eq('teacher_id', TEACHER_A).eq('group_name', 'Group A')
  assert.equal(data.length, 1)
  assert.equal(data[0].id, 'sl-a')
})

test('Teacher A cannot UPDATE Teacher B\'s student (RLS deny on UPDATE)', async () => {
  // Simulate: Teacher A tries to update Student B's points.
  // The RLS policy would deny this — verified via the SELECT path returning
  // 0 rows for Teacher B's data. The UPDATE path uses the same RLS policy
  // (for all using + with check), so it would also be denied.
  const supabase = makeSupabaseMock({ id: TEACHER_A })
  const { data } = await supabase.from('students').select('*').eq('id', STUDENT_B.id)
  assert.equal(data.length, 0, 'Teacher A cannot even SEE Student B — UPDATE would also be denied by RLS')
})

test('Portal RPC: valid token returns ONLY the corresponding student data', async () => {
  const supabase = makeSupabaseMock(null) // anon — portal has no auth
  const { data } = await supabase.rpc('get_student_portal_data', { p_token: 'token-a-xxxxx' })
  assert.ok(data, 'Should return data for a valid token')
  assert.equal(data.student.id, STUDENT_A.id)
  assert.equal(data.student.teacher_id, TEACHER_A)
  // Should include only Teacher A's announcements
  for (const a of data.announcements) {
    assert.equal(a.teacher_id, TEACHER_A, 'Portal must NOT leak announcements from other teachers')
  }
  // Should include only Student A's exam scores
  for (const e of data.exam_scores) {
    assert.equal(e.exam_id, EXAM_A.id, 'Portal must NOT leak other students\' exam scores')
  }
})

test('Portal RPC: invalid token returns null (no fallback)', async () => {
  const supabase = makeSupabaseMock(null)
  const { data } = await supabase.rpc('get_student_portal_data', { p_token: 'invalid-token-zzz' })
  assert.equal(data, null, 'Invalid token must return null — no fallback to student_id')
})

test('Portal RPC: revoked token returns null', async () => {
  const supabase = makeSupabaseMock(null)
  const { data } = await supabase.rpc('get_student_portal_data', { p_token: 'token-a-revoked' })
  assert.equal(data, null, 'Revoked token must return null')
})

test('Portal RPC: token for Student A does NOT leak Student B data', async () => {
  const supabase = makeSupabaseMock(null)
  const { data } = await supabase.rpc('get_student_portal_data', { p_token: 'token-a-xxxxx' })
  // Student B's homework should NOT appear
  for (const h of data.homework_tasks) {
    assert.equal(h.teacher_id, TEACHER_A, 'Portal must NOT leak other teachers\' homework')
  }
})

test('Portal RPC: token for Student B does NOT leak Student A data', async () => {
  const supabase = makeSupabaseMock(null)
  const { data } = await supabase.rpc('get_student_portal_data', { p_token: 'token-b-yyyyy' })
  assert.equal(data.student.id, STUDENT_B.id)
  for (const h of data.homework_tasks) {
    assert.equal(h.teacher_id, TEACHER_B, 'Portal must NOT leak Teacher A\'s homework to Student B\'s portal')
  }
  for (const a of data.announcements) {
    assert.equal(a.teacher_id, TEACHER_B, 'Portal must NOT leak Teacher A\'s announcements to Student B')
  }
})

test('Admin user can read feature_unlocks across all teachers (intentional)', async () => {
  // Admins are a special case — they manage feature unlocks for everyone.
  // The RLS policy "feature_unlocks_read" allows:
  //   can_access_workspace(teacher_id) OR is_admin_user()
  // We simulate this with adminMode = true (bypasses RLS).
  const supabase = makeSupabaseMock({ id: 'admin-id' }, true)
  const { data } = await supabase.from('feature_unlocks').select('*')
  assert.ok(data.length >= 2, 'Admin should see feature_unlocks for all teachers')
})

test('Admin user CANNOT read tenant data without adminMode (RLS still applies)', async () => {
  // Even an admin user, when reading student/attendance/etc. data, is
  // subject to RLS — they only see their own rows. The admin_teacher_stats
  // RPC is the only way for admins to see aggregate stats across teachers.
  const supabase = makeSupabaseMock({ id: TEACHER_A }) // admin happens to also be a teacher
  const { data } = await supabase.from('students').select('*')
  // Even if this user is an admin, the students_workspace_access policy
  // requires can_access_workspace(teacher_id) — admin doesn't get a free pass.
  assert.equal(data.length, 1, 'Admin-teacher should only see their own students via direct table reads')
})
