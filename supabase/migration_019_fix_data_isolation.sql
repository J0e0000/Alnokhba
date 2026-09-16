-- ============================================================================
-- نظام النخبة — Migration 019: إصلاح عزل البيانات بين الحسابات (CRITICAL FIX)
-- ============================================================================
-- المشكلة:
--   migrations 014/015/016/017 أضافت سياسات "public_read" على جداول حساسة:
--     - students, attendance_records, behavior_logs, exams, exam_scores,
--       session_logs, group_schedule, teacher_settings,
--       announcements, homework_tasks, homework_task_status
--   سياسات public_read دي بتقول: for select using (true)
--   في Postgres RLS، لما تكون في أكتر من سياسة SELECT على الجدول،
--   بيتعملهم OR. يعني وجود using(true) بيخلي ANY row ظاهرة لأي حد
--   (anonymous OR authenticated) — وده بيكسر عزل بيانات المدرّسين تمامًا.
--   أي مدرّس يقدر يعمل:  supabase.from('students').select('*')
--   ويشوف كل طلاب كل المدرّسين في النظام. ده ثغرة أمن حرجة.
--
-- السبب الأصلي لضافة public_read:
--   صفحة /qr/:token (بوابة الطالب/ولي الأمر) محتاجة تقرأ بيانات الطالب
--   من غير ما المستخدم يكون مسجل دخول. الحل الصحيح مش نفتح القراءة
--   العامة على كل الجداول، إنما نعمل دالة RPC واحدة بـ SECURITY DEFINER
--   بتاخد التوكن، تتحقق منه، وترجع بيانات الطالب ده بس.
--
-- الحل:
--   1) نمسح كل سياسات public_read من الجداول الحساسة.
--   2) نعمل دالة get_student_portal_data(p_token text) بـ SECURITY DEFINER
--      بتتحقق من التوكن وترجع بيانات الطالب + سجلاته فقط.
--   3) نحتفظ بـ qr_token_public_read على student_qr_tokens عشان التطبيق
--      يقدر يتحقق من التوكن أولًا، لكن ندعم كمان المسار الجديد عبر RPC.
--   4) نقوّي دالة mark_homework_done عشان تشتغل بالـ token بس بدون
--      الحاجة لـ public_read على homework_task_status.
--
-- ملاحظات هامة:
--   * الـ migration ده مش بيمسح أي بيانات — بس بيمسح سياسات RLS وبيعملها تاني.
--   * الـ teacher_id موجود أصلاً على كل الجداول الحساسة، فمفيش حاجة
--     محتاجة تتعمل للبيانات القديمة — عزلها هيبقى شغال فورًا بعد تشغيل
--     الملف ده.
--   * بعد تشغيل الملف، لازم يتحدث الكود في frontend/src/pages/PublicQRPage.jsx
--     عشان يستخدم الـ RPC الجديد بدل القراءة المباشرة.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) مسح سياسات public_read من كل الجداول الحساسة
-- ----------------------------------------------------------------------------
drop policy if exists "students_public_read" on students;
drop policy if exists "attendance_records_public_read" on attendance_records;
drop policy if exists "behavior_logs_public_read" on behavior_logs;
drop policy if exists "exams_public_read" on exams;
drop policy if exists "exam_scores_public_read" on exam_scores;
drop policy if exists "session_logs_public_read" on session_logs;
drop policy if exists "group_schedule_public_read" on group_schedule;
drop policy if exists "teacher_settings_public_read" on teacher_settings;
drop policy if exists "announcements_public_read" on announcements;
drop policy if exists "homework_tasks_public_read" on homework_tasks;
drop policy if exists "homework_task_status_public_read" on homework_task_status;

-- ----------------------------------------------------------------------------
-- 2) التأكد من أن سياسات workspace_access لسه موجودة على كل الجداول
--    (migration_008 عملها قبل كده، بس نتأكد هنا إنها مش اتمسحت)
--    نستخدم drop policy if exists قبل create policy عشان نتجنب خطأ
--    "policy already exists" لو الـ migration اتشغل مرتين أو لو السياسة
--    موجودة من migration_008.
-- ----------------------------------------------------------------------------
drop policy if exists "groups_workspace_access" on groups;
create policy "groups_workspace_access" on groups
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "students_workspace_access" on students;
create policy "students_workspace_access" on students
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "attendance_workspace_access" on attendance_records;
create policy "attendance_workspace_access" on attendance_records
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "behavior_workspace_access" on behavior_logs;
create policy "behavior_workspace_access" on behavior_logs
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "settings_workspace_access" on teacher_settings;
create policy "settings_workspace_access" on teacher_settings
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "exams_workspace_access" on exams;
create policy "exams_workspace_access" on exams
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "exam_scores_workspace_access" on exam_scores;
create policy "exam_scores_workspace_access" on exam_scores
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "session_logs_workspace_access" on session_logs;
create policy "session_logs_workspace_access" on session_logs
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "group_schedule_workspace_access" on group_schedule;
create policy "group_schedule_workspace_access" on group_schedule
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

-- (سياسات الكتابة على announcements / homework_tasks / homework_task_status
--  لسه شغّالة بنفس الشكل: المدرّس يكتب بـ auth.uid() = teacher_id، والقراءة
--  هتتم عبر دالة RPC الجديدة من البوابة العامة.)

-- ----------------------------------------------------------------------------
-- 3) دالة RPC جديدة: get_student_portal_data(p_token text)
--    - بتشتغل بـ SECURITY DEFINER (بتتجاوز RLS لإنها بتقرأ بيانات لأي
--      مدرّس بناءً على التوكن، لكنها بترجع بيانات الطالب ده بس).
--    - بتتحقق إن التوكن موجود وغير ملغي في student_qr_tokens.
--    - بترجع JSON واحد فيه: الطالب + الإعدادات (ranks, whatsapp_number) +
--      آخر 15 سجل حضور + آخر 10 سجلات سلوك + الإعلانات + درجات الامتحانات +
--      الامتحانات + آخر سجل حصة + جدول المجموعة + الواجبات + حالة الواجبات.
--    - مفيش أي بيانات تانية بترجع — لو التوكن غلط بترجع null.
-- ----------------------------------------------------------------------------
create or replace function public.get_student_portal_data(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student record;
  v_teacher_id uuid;
  v_ranks jsonb;
  v_whatsapp text;
  v_report_fields text[];
  v_attendance jsonb;
  v_behavior jsonb;
  v_announcements jsonb;
  v_exam_scores jsonb;
  v_exams jsonb;
  v_session_log jsonb;
  v_schedule jsonb;
  v_homework_tasks jsonb;
  v_homework_status jsonb;
begin
  -- 1) Validate the token and load the student
  select s.id, s.name, s.points, s.group_name, s.attendance_status,
         s.hw_status, s.teacher_id, s.stage, s.code, s.warnings
    into v_student
  from students s
  inner join student_qr_tokens t on t.student_id = s.id
  where t.token = p_token
    and t.revoked_at is null
  limit 1;

  if v_student.id is null then
    return null;
  end if;

  v_teacher_id := v_student.teacher_id;

  -- 2) Teacher settings (only the public-facing columns needed by the portal)
  select ts.ranks, ts.whatsapp_number, ts.report_fields
    into v_ranks, v_whatsapp, v_report_fields
  from teacher_settings ts
  where ts.teacher_id = v_teacher_id;

  -- 3) Attendance (last 15 records for this student only)
  select coalesce(jsonb_agg(jsonb_build_object(
    'status', ar.status, 'recorded_at', ar.recorded_at
  ) order by ar.recorded_at desc), '[]'::jsonb) into v_attendance
  from attendance_records ar
  where ar.student_id = v_student.id
  limit 15;

  -- 4) Behavior logs (last 10 for this student only)
  select coalesce(jsonb_agg(jsonb_build_object(
    'note', bl.note, 'points_delta', bl.points_delta, 'created_at', bl.created_at
  ) order by bl.created_at desc), '[]'::jsonb) into v_behavior
  from behavior_logs bl
  where bl.student_id = v_student.id
  limit 10;

  -- 5) Announcements (public ones for this teacher + targeted at this student)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', an.id, 'title', an.title, 'message', an.message,
    'created_at', an.created_at, 'student_id', an.student_id
  ) order by an.created_at desc), '[]'::jsonb) into v_announcements
  from announcements an
  where an.teacher_id = v_teacher_id
    and (an.student_id is null or an.student_id = v_student.id)
  limit 15;

  -- 6) Exam scores for this student + the exam metadata (title, sections, max)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', es.id, 'exam_id', es.exam_id, 'total_score', es.total_score,
    'section_scores', es.section_scores, 'created_at', es.created_at,
    'exam_title', ex.title, 'exam_sections', ex.sections,
    'exam_max_per_section', ex.max_score_per_section
  ) order by es.created_at desc), '[]'::jsonb) into v_exam_scores
  from exam_scores es
  inner join exams ex on ex.id = es.exam_id
  where es.student_id = v_student.id
  limit 10;

  -- 7) Exams list for this teacher (needed by the portal to compute max score)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ex.id, 'title', ex.title, 'sections', ex.sections,
    'max_score_per_section', ex.max_score_per_section
  )), '[]'::jsonb) into v_exams
  from exams ex
  where ex.teacher_id = v_teacher_id;

  -- 8) Latest session log for this student's group (today's session)
  select to_jsonb(sl) into v_session_log
  from session_logs sl
  where sl.teacher_id = v_teacher_id
    and sl.group_name = v_student.group_name
  order by sl.session_date desc
  limit 1;

  -- 9) Group schedule (which weekdays this group meets)
  select coalesce(jsonb_agg(jsonb_build_object('weekday', gs.weekday)), '[]'::jsonb)
    into v_schedule
  from group_schedule gs
  where gs.teacher_id = v_teacher_id
    and gs.group_name = v_student.group_name;

  -- 10) Homework tasks for this group
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ht.id, 'title', ht.title, 'due_date', ht.due_date,
    'created_at', ht.created_at
  ) order by ht.created_at desc), '[]'::jsonb) into v_homework_tasks
  from homework_tasks ht
  where ht.teacher_id = v_teacher_id
    and ht.group_name = v_student.group_name
  limit 10;

  -- 11) Homework status for this student
  select coalesce(jsonb_agg(jsonb_build_object(
    'task_id', hts.task_id, 'done', hts.done
  )), '[]'::jsonb) into v_homework_status
  from homework_task_status hts
  where hts.student_id = v_student.id;

  -- 12) Build and return the portal payload
  return jsonb_build_object(
    'student', jsonb_build_object(
      'id', v_student.id,
      'name', v_student.name,
      'points', v_student.points,
      'group_name', v_student.group_name,
      'attendance_status', v_student.attendance_status,
      'hw_status', v_student.hw_status,
      'teacher_id', v_student.teacher_id,
      'stage', v_student.stage,
      'code', v_student.code,
      'warnings', v_student.warnings
    ),
    'ranks', coalesce(v_ranks, '[]'::jsonb),
    'whatsapp_number', coalesce(v_whatsapp, ''),
    'report_fields', coalesce(to_jsonb(v_report_fields), '[]'::jsonb),
    'attendance', v_attendance,
    'behavior', v_behavior,
    'announcements', v_announcements,
    'exam_scores', v_exam_scores,
    'exams', v_exams,
    'session_log', coalesce(v_session_log, 'null'::jsonb),
    'schedule', v_schedule,
    'homework_tasks', v_homework_tasks,
    'homework_status', v_homework_status,
    'token_source', 'db'
  );
end;
$$;

-- السماح لأي حد (حتى anon) ينادي الدالة — الدالة نفسها بتتحقق من التوكن
grant execute on function public.get_student_portal_data(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) تحسين دالة mark_homework_done (للأمان — تعمل verify للتوكن قبل التحديث)
--    موجودة أصلاً في migration_015، هنا بنعيد تعريفها للتأكد من صحتها.
-- ----------------------------------------------------------------------------
create or replace function public.mark_homework_done(p_task_id uuid, p_student_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_task_teacher_id uuid;
begin
  -- 1) Verify the token
  select t.student_id into v_student_id
  from student_qr_tokens t
  where t.token = p_student_token
    and t.revoked_at is null;

  if v_student_id is null then
    raise exception 'invalid token';
  end if;

  -- 2) Verify the task belongs to the same teacher as the student
  --    (prevents a token-holder from marking done a task owned by another teacher)
  select ht.teacher_id into v_task_teacher_id
  from homework_tasks ht
  where ht.id = p_task_id;

  if v_task_teacher_id is null then
    raise exception 'task not found';
  end if;

  if v_task_teacher_id <> (select s.teacher_id from students s where s.id = v_student_id) then
    raise exception 'not authorized';
  end if;

  -- 3) Upsert the homework status
  insert into homework_task_status (task_id, student_id, done, marked_by, updated_at)
  values (p_task_id, v_student_id, true, 'student', now())
  on conflict (task_id, student_id)
  do update set done = true, marked_by = 'student', updated_at = now();
end;
$$;

grant execute on function public.mark_homework_done(uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) تأكيد إضافي: RLS مفعل على كل الجداول الحساسة
--    (فيه احتمال إن migration قديم يكون قفله بالغلط)
-- ----------------------------------------------------------------------------
alter table profiles enable row level security;
alter table groups enable row level security;
alter table students enable row level security;
alter table attendance_records enable row level security;
alter table behavior_logs enable row level security;
alter table teacher_settings enable row level security;
alter table exams enable row level security;
alter table exam_scores enable row level security;
alter table session_logs enable row level security;
alter table group_schedule enable row level security;
alter table workspace_members enable row level security;
alter table admin_activity_log enable row level security;
alter table broadcast_messages enable row level security;
alter table feature_unlocks enable row level security;
alter table announcements enable row level security;
alter table homework_tasks enable row level security;
alter table homework_task_status enable row level security;
alter table student_qr_tokens enable row level security;

-- ----------------------------------------------------------------------------
-- 6) توثيق: استعلم عن سياسات RLS الموجودة بعد تطبيق الـ migration ده
--    (شغّل الاستعلام ده في SQL Editor للتأكد من النتيجة)
-- ----------------------------------------------------------------------------
-- select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, policyname;
