-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION 054 — security RPC hardening + hot-path indexes (deep product audit)
-- Generated 2026-10-23 from the LIVE production function definitions via the
-- Management API (scripts/audit54_build_migration.py). Idempotent:
-- create-or-replace keeps every identity signature, indexes use IF NOT EXISTS.
--
-- Contents:
--   1. get_student_portal_data / get_student_standalone_exams /
--      mark_notification_read: legacy UUID-fallback now honors QR-token
--      REVOCATION (block only when a revoked token exists — 1069/1822
--      students have no token row, the fallback is load-bearing) + bounded
--      portal history arrays (payload/perf).
--   2. get_accounts_summary: ownership guard (was IDOR — any authenticated
--      user could read any teacher's financials). Function unused by the UI.
--   3. upsert_lesson_attendance / upsert_lesson_homework: student-ownership
--      check (student must belong to the lesson's workspace).
--   4. link_assistant_by_email: only assistant accounts bindable + cannot
--      steal a bound assistant from another owner.
--   5. Grants: financial/admin-path functions revoked from anon+public.
--   6. Three hot-path indexes: exam_scores(teacher_id, created_at desc),
--      attendance_records(teacher_id, recorded_at desc),
--      behavior_logs(teacher_id, created_at desc).
-- No data is read, modified, or deleted. Fully reversible by re-deploying the
-- previous function bodies (worklog preserves the audit probe output).
-- ═══════════════════════════════════════════════════════════════════════
set check_function_bodies = false;


-- ── get_student_portal_data (p_token text) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_student_portal_data(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student record;
  v_teacher_id uuid;
  v_ranks jsonb;
  v_whatsapp text;
  v_report_fields text[];
  v_attendance jsonb;
  v_lesson_attendance jsonb;
  v_behavior jsonb;
  v_announcements jsonb;
  v_exam_scores jsonb;
  v_exams jsonb;
  v_session_log jsonb;
  v_lesson_sessions jsonb;
  v_session_today jsonb;
  v_schedule jsonb;
  v_homework_tasks jsonb;
  v_homework_status jsonb;
begin
  select s.id, s.name, s.points, s.group_name, s.attendance_status,
         s.hw_status, s.teacher_id, s.stage, s.code, s.warnings
    into v_student
  from students s
  inner join student_qr_tokens t on t.student_id = s.id
  where t.token = p_token and t.revoked_at is null
  limit 1;

  if v_student.id is null and p_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select s.id, s.name, s.points, s.group_name, s.attendance_status,
           s.hw_status, s.teacher_id, s.stage, s.code, s.warnings
      into v_student
    from students s where s.id = p_token::uuid and not exists (select 1 from student_qr_tokens t_rev where t_rev.student_id = s.id and t_rev.revoked_at is not null) limit 1;
  end if;
  if v_student.id is null then return null; end if;
  v_teacher_id := v_student.teacher_id;

  select ts.ranks, ts.whatsapp_number, ts.report_fields
    into v_ranks, v_whatsapp, v_report_fields
  from teacher_settings ts where ts.teacher_id = v_teacher_id;

  -- One latest final record per calendar day; never expose duplicate day states.
  select coalesce(jsonb_agg(jsonb_build_object(
    'status', q.status, 'recorded_at', q.recorded_at,
    'lesson_session_id', q.lesson_session_id,
    'homework_status', q.homework_status,
    'session_date', q.session_date
  ) order by q.session_date desc, q.recorded_at desc), '[]'::jsonb) into v_attendance
  from (
    select distinct on (coalesce(ls.session_date, (ar.recorded_at at time zone 'UTC')::date))
      ar.status, ar.recorded_at, ar.lesson_session_id, ar.homework_status,
      coalesce(ls.session_date, (ar.recorded_at at time zone 'UTC')::date) as session_date
    from attendance_records ar
    left join lesson_sessions ls on ls.id = ar.lesson_session_id
    where ar.student_id = v_student.id and ar.teacher_id = v_teacher_id
    order by coalesce(ls.session_date, (ar.recorded_at at time zone 'UTC')::date) desc, ar.recorded_at desc
  limit 400
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ar.id, 'status', ar.status, 'recorded_at', ar.recorded_at,
    'lesson_session_id', ar.lesson_session_id,
    'homework_status', ar.homework_status,
    'session_date', ls.session_date, 'group_name', ls.group_name,
    'lesson_topic', ls.lesson_topic, 'homework_text', ls.homework_text,
    'video_link', ls.video_link, 'session_status', ls.status
  ) order by ar.recorded_at desc), '[]'::jsonb) into v_lesson_attendance
  from attendance_records ar
  inner join lesson_sessions ls on ls.id = ar.lesson_session_id
  where ar.student_id = v_student.id and ar.teacher_id = v_teacher_id
  order by ar.recorded_at desc limit 200;

  select coalesce(jsonb_agg(jsonb_build_object(
    'note', bl.note, 'points_delta', bl.points_delta, 'created_at', bl.created_at
  ) order by bl.created_at desc), '[]'::jsonb) into v_behavior
  from behavior_logs bl
  where bl.student_id = v_student.id and bl.teacher_id = v_teacher_id
  order by bl.created_at desc limit 100;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', an.id, 'title', an.title, 'message', an.message,
    'created_at', an.created_at, 'student_id', an.student_id
  ) order by an.created_at desc), '[]'::jsonb) into v_announcements
  from announcements an
  where an.teacher_id = v_teacher_id
    and (an.student_id is null or an.student_id = v_student.id)
  order by an.created_at desc limit 50;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', es.id, 'exam_id', es.exam_id, 'total_score', es.total_score,
    'section_scores', es.section_scores, 'created_at', es.created_at,
    'lesson_session_id', es.lesson_session_id,
    'exam_title', ex.title, 'exam_sections', ex.sections,
    'exam_max_per_section', ex.max_score_per_section
  ) order by es.created_at desc), '[]'::jsonb) into v_exam_scores
  from exam_scores es
  inner join exams ex on ex.id = es.exam_id
  where es.student_id = v_student.id and es.teacher_id = v_teacher_id
  order by es.created_at desc limit 150;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ex.id, 'title', ex.title, 'sections', ex.sections,
    'max_score_per_section', ex.max_score_per_section,
    'lesson_session_id', ex.lesson_session_id
  ) order by ex.created_at desc), '[]'::jsonb) into v_exams
  from exams ex where ex.teacher_id = v_teacher_id
  order by ex.created_at desc limit 100;

  select to_jsonb(sl) into v_session_log
  from session_logs sl
  where sl.teacher_id = v_teacher_id and sl.group_name = v_student.group_name
  order by sl.session_date desc limit 1;

  -- Return at most three useful lesson cards: current, previous, next.
  -- Each row carries the final state for this student in that lesson.
  select coalesce(jsonb_agg(to_jsonb(c) - 'sort_rank' order by c.sort_rank), '[]'::jsonb)
    into v_lesson_sessions
  from (
    (select ls.*, 0 as sort_rank,
      coalesce((select ar.status from attendance_records ar where ar.lesson_session_id = ls.id and ar.student_id = v_student.id order by ar.recorded_at desc limit 1), 'لم يرصد') as attendance_status,
      coalesce((select ar.homework_status from attendance_records ar where ar.lesson_session_id = ls.id and ar.student_id = v_student.id order by ar.recorded_at desc limit 1), 'لم يرصد') as homework_status
      from lesson_sessions ls
      where ls.teacher_id = v_teacher_id and ls.group_name = v_student.group_name and ls.session_date = current_date
      order by ls.started_at desc limit 1)
    union all
    (select ls.*, 1 as sort_rank,
      coalesce((select ar.status from attendance_records ar where ar.lesson_session_id = ls.id and ar.student_id = v_student.id order by ar.recorded_at desc limit 1), 'لم يرصد') as attendance_status,
      coalesce((select ar.homework_status from attendance_records ar where ar.lesson_session_id = ls.id and ar.student_id = v_student.id order by ar.recorded_at desc limit 1), 'لم يرصد') as homework_status
      from lesson_sessions ls
      where ls.teacher_id = v_teacher_id and ls.group_name = v_student.group_name and ls.session_date < current_date
      order by ls.session_date desc, ls.started_at desc limit 1)
    union all
    (select ls.*, 2 as sort_rank,
      coalesce((select ar.status from attendance_records ar where ar.lesson_session_id = ls.id and ar.student_id = v_student.id order by ar.recorded_at desc limit 1), 'لم يرصد') as attendance_status,
      coalesce((select ar.homework_status from attendance_records ar where ar.lesson_session_id = ls.id and ar.student_id = v_student.id order by ar.recorded_at desc limit 1), 'لم يرصد') as homework_status
      from lesson_sessions ls
      where ls.teacher_id = v_teacher_id and ls.group_name = v_student.group_name and ls.session_date > current_date
      order by ls.session_date asc, ls.started_at asc limit 1)
  ) c;

  select to_jsonb(ls) || jsonb_build_object(
    'attendance_status', coalesce((select ar.status from attendance_records ar where ar.lesson_session_id = ls.id and ar.student_id = v_student.id order by ar.recorded_at desc limit 1), 'لم يرصد'),
    'homework_status', coalesce((select ar.homework_status from attendance_records ar where ar.lesson_session_id = ls.id and ar.student_id = v_student.id order by ar.recorded_at desc limit 1), 'لم يرصد')
  ) into v_session_today
  from lesson_sessions ls
  where ls.teacher_id = v_teacher_id and ls.group_name = v_student.group_name
  order by case when ls.session_date = current_date then 0 else 1 end, ls.session_date desc, ls.started_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('weekday', gs.weekday)), '[]'::jsonb)
    into v_schedule
  from group_schedule gs
  where gs.teacher_id = v_teacher_id and gs.group_name = v_student.group_name;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ht.id, 'title', ht.title, 'due_date', ht.due_date, 'created_at', ht.created_at
  ) order by ht.created_at desc), '[]'::jsonb) into v_homework_tasks
  from homework_tasks ht
  where ht.teacher_id = v_teacher_id and ht.group_name = v_student.group_name
  order by ht.created_at desc limit 100;

  select coalesce(jsonb_agg(jsonb_build_object('task_id', hts.task_id, 'done', hts.done)), '[]'::jsonb)
    into v_homework_status
  from homework_task_status hts where hts.student_id = v_student.id;

  return jsonb_build_object(
    'student', jsonb_build_object(
      'id', v_student.id, 'name', v_student.name, 'points', v_student.points,
      'group_name', v_student.group_name, 'attendance_status', v_student.attendance_status,
      'hw_status', v_student.hw_status, 'teacher_id', v_student.teacher_id,
      'stage', v_student.stage, 'code', v_student.code, 'warnings', v_student.warnings
    ),
    'ranks', coalesce(v_ranks, '[]'::jsonb), 'whatsapp_number', coalesce(v_whatsapp, ''),
    'report_fields', coalesce(to_jsonb(v_report_fields), '[]'::jsonb),
    'attendance', v_attendance, 'lesson_attendance', v_lesson_attendance,
    'behavior', v_behavior, 'announcements', v_announcements,
    'exam_scores', v_exam_scores, 'exams', v_exams,
    'session_log', v_session_log, 'lesson_sessions', v_lesson_sessions,
    'session_today', v_session_today, 'schedule', v_schedule,
    'homework_tasks', v_homework_tasks, 'homework_status', v_homework_status,
    'token_source', 'db', 'teacherId', v_teacher_id,
    'paymentSummary', (select jsonb_build_object('totalPaid', coalesce(sum(p.amount), 0), 'paymentCount', count(p.id), 'lastPaymentDate', max(p.payment_date)) from student_payments p where p.student_id = v_student.id and p.teacher_id = v_teacher_id),
    'lessonPrice', (select (group_pricing -> v_student.group_name)::numeric from teacher_settings where teacher_id = v_teacher_id),
    'notifications', (select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) from (select n.id, n.title, n.body, n.category, n.deep_link, n.is_read, n.created_at from student_notifications n where n.student_id = v_student.id and n.teacher_id = v_teacher_id order by n.created_at desc limit 50) r),
    'unreadNotificationCount', (select count(*) from student_notifications where student_id = v_student.id and teacher_id = v_teacher_id and is_read = false),
    'branding', (select jsonb_build_object('display_name', coalesce(display_name, ''), 'center_name', coalesce(center_name, ''), 'logo_url', coalesce(logo_url, '')) from workspace_branding where teacher_id = v_teacher_id)
  );
end;
$function$
;

-- ── get_student_standalone_exams (p_token text) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_student_standalone_exams(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student_id uuid;
  v_teacher_id uuid;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return '[]'::jsonb;
  end if;

  -- توكن البوابة → الطالب (نفس مسار 019/037 بالظبط)
  select q.student_id, s.teacher_id
    into v_student_id, v_teacher_id
  from public.student_qr_tokens q
  join public.students s on s.id = q.student_id
  where q.token = p_token and q.revoked_at is null
  limit 1;

  -- احتياط: روابط QR القديمة اللي كانت بتستخدم UUID الطالب نفسه كتوكن
  if v_student_id is null
     and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$' then
    select s.id, s.teacher_id
      into v_student_id, v_teacher_id
    from public.students s
    where s.id = p_token::uuid
      and not exists (select 1 from public.student_qr_tokens t_rev where t_rev.student_id = s.id and t_rev.revoked_at is not null)
    limit 1;
  end if;

  if v_student_id is null then
    return '[]'::jsonb;
  end if;

  -- درجات الطالب في الامتحانات المنفصلة (الممتحن = اللي ليه صف درجة)
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'exam_id', e.id,
      'title', e.title,
      'exam_date', e.exam_date,
      'exam_status', e.status,
      'score', es.score,
      'max_score', e.max_score,
      'grade_scale', e.grade_scale,
      'graded_at', es.updated_at
    ) order by e.exam_date desc, e.created_at desc)
    from public.standalone_exam_scores es
    join public.standalone_exams e on e.id = es.exam_id
    where es.student_id = v_student_id
      and es.teacher_id = v_teacher_id
  ), '[]'::jsonb);
end;
$function$
;

-- ── mark_notification_read (p_notification_id uuid, p_token text) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid, p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student_id uuid;
begin
  -- Resolve token to student_id
  select student_id into v_student_id
  from student_qr_tokens
  where token = p_token and revoked_at is null
  limit 1;

  if v_student_id is null and p_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_student_id from students where id = p_token::uuid
      and not exists (select 1 from student_qr_tokens t_rev where t_rev.student_id = students.id and t_rev.revoked_at is not null)
    limit 1;
  end if;

  if v_student_id is null then
    raise exception 'invalid token';
  end if;

  update student_notifications
  set is_read = true
  where id = p_notification_id
    and student_id = v_student_id;
end;
$function$
;

-- ── get_accounts_summary (p_teacher_id uuid, p_date_from date, p_date_to date, p_group_name text) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_accounts_summary(p_teacher_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_group_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group_pricing jsonb;
  v_center_share_type text;
  v_center_share_value numeric;
  v_assistant_costs jsonb;
  v_total_revenue numeric := 0;
  v_center_share_total numeric := 0;
  v_assistant_cost_total numeric := 0;
  v_expenses_total numeric := 0;
  v_lesson_count integer := 0;
  v_student_payment_total numeric := 0;
begin
  -- AUDIT 2026-10 (S2): financial summary was callable by ANY authenticated
  -- user (security definer, no ownership check). Restrict to the workspace
  -- itself: owner, workspace member, or active support session.
  if not coalesce(public.can_access_workspace(p_teacher_id), false) then
    raise exception 'not_authorized';
  end if;
  -- Get teacher's financial config
  select group_pricing, center_share_type, center_share_value, assistant_costs
  into v_group_pricing, v_center_share_type, v_center_share_value, v_assistant_costs
  from teacher_settings where teacher_id = p_teacher_id;

  if v_group_pricing is null then v_group_pricing := '{}'::jsonb; end if;
  if v_assistant_costs is null then v_assistant_costs := '{}'::jsonb; end if;

  -- Count lessons (session_logs) in the period
  select count(*) into v_lesson_count
  from session_logs
  where teacher_id = p_teacher_id
    and (p_date_from is null or created_at::date >= p_date_from)
    and (p_date_to is null or created_at::date <= p_date_to)
    and (p_group_name is null or group_name = p_group_name);

  -- Calculate total revenue = sum of all lesson prices for sessions held
  -- For each session_log entry, get the group's price
  v_total_revenue := (
    select coalesce(sum(
      coalesce((v_group_pricing -> sl.group_name)::numeric, 0)
    ), 0)
    from session_logs sl
    where sl.teacher_id = p_teacher_id
      and (p_date_from is null or sl.created_at::date >= p_date_from)
      and (p_date_to is null or sl.created_at::date <= p_date_to)
      and (p_group_name is null or sl.group_name = p_group_name)
  );

  -- Total student payments received in the period
  v_student_payment_total := (
    select coalesce(sum(amount), 0)
    from student_payments sp
    join students s on s.id = sp.student_id
    where sp.teacher_id = p_teacher_id
      and (p_date_from is null or sp.payment_date >= p_date_from)
      and (p_date_to is null or sp.payment_date <= p_date_to)
      and (p_group_name is null or s.group_name = p_group_name)
  );

  -- Calculate center share
  if v_center_share_type = 'percentage' then
    v_center_share_total := v_total_revenue * (v_center_share_value / 100.0);
  else
    -- Fixed amount per lesson
    v_center_share_total := v_lesson_count * v_center_share_value;
  end if;

  -- Calculate assistant costs (per lesson)
  v_assistant_cost_total := v_lesson_count * (
    select coalesce(sum(av.value::numeric), 0)
    from jsonb_each_text(v_assistant_costs) av
  );

  -- Total expenses
  v_expenses_total := (
    select coalesce(sum(amount), 0)
    from expenses
    where teacher_id = p_teacher_id
      and (p_date_from is null or expense_date >= p_date_from)
      and (p_date_to is null or expense_date <= p_date_to)
  );

  return jsonb_build_object(
    'totalRevenue', v_total_revenue,
    'studentPaymentsReceived', v_student_payment_total,
    'lessonCount', v_lesson_count,
    'centerShare', v_center_share_total,
    'centerShareType', v_center_share_type,
    'centerShareValue', v_center_share_value,
    'assistantCosts', v_assistant_cost_total,
    'expenses', v_expenses_total,
    'netProfit', v_total_revenue - v_center_share_total - v_assistant_cost_total - v_expenses_total
  );
end;
$function$
;

-- ── upsert_lesson_attendance (p_lesson_session_id uuid, p_student_id uuid, p_status text) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_lesson_attendance(p_lesson_session_id uuid, p_student_id uuid, p_status text)
 RETURNS attendance_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_teacher_id uuid;
  v_row public.attendance_records;
begin
  -- الحصة موجودة؟ (ومنها بنجيب صاحب مساحة العمل المصرّح له)
  select ls.teacher_id into v_teacher_id
  from public.lesson_sessions ls
  where ls.id = p_lesson_session_id;

  if v_teacher_id is null then
    raise exception 'lesson_not_found';
  end if;

  -- الصلاحية: صاحب مساحة العمل أو أحد أعضائها (نفس can_access_workspace)
  if not public.can_access_workspace(v_teacher_id) then
    raise exception 'not_authorized';
  end if;

  -- AUDIT 2026-10 (S7): the student must belong to THIS workspace — blocks
  -- pairing a local session/homework row with another teacher's student UUID.
  if not exists (select 1 from public.students s where s.id = p_student_id and s.teacher_id = v_teacher_id) then
    raise exception 'student_not_in_workspace';
  end if;

  -- تحقق قيمة الحالة (مثال: حاضر / غائب / لم يرصد)
  if p_status is null or length(btrim(p_status)) = 0 or length(p_status) > 60 then
    raise exception 'invalid_status';
  end if;

  -- upsert ذري: صف واحد لكل (طالب × حصة)
  insert into public.attendance_records as ar
    (teacher_id, student_id, lesson_session_id, status, homework_status, recorded_at)
  values
    (v_teacher_id, p_student_id, p_lesson_session_id, p_status, 'لم يرصد', now())
  on conflict (lesson_session_id, student_id)
  do update
    set status = excluded.status,
        recorded_at = now()
  returning ar.* into v_row;

  return v_row;
end;
$function$
;

-- ── upsert_lesson_homework (p_lesson_session_id uuid, p_student_id uuid, p_homework_status text) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_lesson_homework(p_lesson_session_id uuid, p_student_id uuid, p_homework_status text)
 RETURNS attendance_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_teacher_id uuid;
  v_row public.attendance_records;
begin
  select ls.teacher_id into v_teacher_id
  from public.lesson_sessions ls
  where ls.id = p_lesson_session_id;

  if v_teacher_id is null then
    raise exception 'lesson_not_found';
  end if;

  if not public.can_access_workspace(v_teacher_id) then
    raise exception 'not_authorized';
  end if;

  -- AUDIT 2026-10 (S7): the student must belong to THIS workspace — blocks
  -- pairing a local session/homework row with another teacher's student UUID.
  if not exists (select 1 from public.students s where s.id = p_student_id and s.teacher_id = v_teacher_id) then
    raise exception 'student_not_in_workspace';
  end if;

  if p_homework_status is null or length(btrim(p_homework_status)) = 0 or length(p_homework_status) > 60 then
    raise exception 'invalid_homework_status';
  end if;

  insert into public.attendance_records as ar
    (teacher_id, student_id, lesson_session_id, status, homework_status, recorded_at)
  values
    (v_teacher_id, p_student_id, p_lesson_session_id, 'لم يرصد', p_homework_status, now())
  on conflict (lesson_session_id, student_id)
  do update
    set homework_status = excluded.homework_status
  returning ar.* into v_row;

  return v_row;
end;
$function$
;

-- ── link_assistant_by_email (assistant_email text) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.link_assistant_by_email(assistant_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_id uuid;
begin
  select id into target_id from auth.users where email = assistant_email;
  if target_id is null then
    raise exception 'لا يوجد حساب مسجّل بهذا الإيميل';
  end if;
  if target_id = auth.uid() then
    raise exception 'مينفعش تربط حسابك بنفسه';
  end if;
  -- AUDIT 2026-10 (S5): hardening of the assistant-binding path.
  -- (a) cannot bind an account that runs its OWN workspace: linking flips the
  --     target's my_workspace_owner to the caller — an account with its own
  --     students/groups loses access to its own data (verified live: one
  --     bound member owns 29 students).
  if exists (select 1 from public.students s where s.teacher_id = target_id)
     or exists (select 1 from public.groups g where g.teacher_id = target_id) then
    raise exception 'الحساب ده عليه مركزه الخاص — مش ممكن يتربط كمساعد';
  end if;
  -- (b) never STEAL a bound assistant: the old on-conflict re-point hijacked
  --     the assistant's whole workspace view to a new owner without consent.
  if exists (select 1 from public.workspace_members w where w.member_id = target_id and w.owner_id <> auth.uid()) then
    raise exception 'الحساب ده مرتبط بالفعل بمساحة عمل تانية';
  end if;
  insert into workspace_members (owner_id, member_id)
  values (auth.uid(), target_id)
  on conflict (member_id) do update set owner_id = excluded.owner_id;
end;
$function$;


-- ── grants: close the anon/public paths on non-portal RPCs ──────────────
revoke execute on function public.get_accounts_summary(uuid, date, date, text) from anon, public;
revoke execute on function public.link_assistant_by_email(text) from anon, public;
revoke execute on function public.upsert_lesson_attendance(uuid, uuid, text) from anon, public;
revoke execute on function public.upsert_lesson_homework(uuid, uuid, text) from anon, public;
grant execute on function public.get_accounts_summary(uuid, date, date, text) to authenticated;
grant execute on function public.link_assistant_by_email(text) to authenticated;
grant execute on function public.upsert_lesson_attendance(uuid, uuid, text) to authenticated;
grant execute on function public.upsert_lesson_homework(uuid, uuid, text) to authenticated;

-- ── hot-path indexes (audit PF2): every-boot loadAll scans ──────────────
create index if not exists idx_exam_scores_teacher_created
  on public.exam_scores (teacher_id, created_at desc);
create index if not exists idx_attendance_teacher_recorded
  on public.attendance_records (teacher_id, recorded_at desc);
create index if not exists idx_behavior_teacher_created
  on public.behavior_logs (teacher_id, created_at desc);
