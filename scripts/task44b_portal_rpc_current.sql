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
