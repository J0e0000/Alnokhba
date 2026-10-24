-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 058 — HOMEWORK UX POLISH (Task 44d)
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبات المستر المباشرة:
--   1) homework_tasks.video_url — لينك فيديو الشرح: الطالب مايشوفهش
--      إلا بعد ما يسلّم الواجب (مقفول قبل التسليم — السيرفر هو اللي بيفتحه).
--   2) homework_submissions.results — صح/خطأ لكل سؤال محفوظة مع التسليم
--      عشان مراجعة النتيجة تفضل موجودة بعد إعادة تحميل الصفحة.
--   3) submit_homework_task_answers — التسليم مرة واحدة بس:
--      • لو الطالب سلّم قبل كده → status='already_submitted' + نتيجته المحفوظة
--        (مفيش إعادة تصحيح ولا إعادة إرسال — ممنوع الإعادة نهائيًا).
--      • أول تسليم → تخزين results + تسجيل الواجب تلقائيًا في الحصة الجاية:
--        «واجب إلكتروني: X/Y (P%)» على سجل يوم الحصة الجاية (نفس قفل صف
--        _upsert_attendance_day — لما المدرس يرصد الحضور بعدين، الواجب يفضل).
--   4) get_student_portal_data — يرجّع results + video_url (بعد التسليم فقط).
-- كل شيء idempotent — آمن لإعادة التشغيل.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) فيديو الشرح المقفول
alter table public.homework_tasks
  add column if not exists video_url text;

-- 2) مراجعة الإجابات المحفوظة (مصفوفة true/false بنفس ترتيب الأسئلة)
alter table public.homework_submissions
  add column if not exists results jsonb;

-- ═══════════════════════════════════════════════════════════════════════
-- 3) submit_homework_task_answers — نسخة «تسليم واحد + تسجيل تلقائي»
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.submit_homework_task_answers(
  p_token text,
  p_task_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_student_id uuid;
  v_teacher_id uuid;
  v_group_name text;
  v_task public.homework_tasks%rowtype;
  v_existing public.homework_submissions%rowtype;
  v_sub public.homework_submissions%rowtype;
  v_q jsonb;
  v_i int;
  v_choice int;
  v_correct int;
  v_marks numeric;
  v_score numeric := 0;
  v_max numeric := 0;
  v_correct_count int := 0;
  v_q_count int;
  v_results jsonb := '[]'::jsonb;
  v_answers jsonb;
  v_next_session_id uuid;
  v_next_session_date date;
  v_hw_text text;
  v_recorded boolean := false;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'invalid_token';
  end if;

  -- توكن البوابة → الطالب (نفس مسار 052/056)
  select q.student_id, s.teacher_id, s.group_name
    into v_student_id, v_teacher_id, v_group_name
  from public.student_qr_tokens q
  join public.students s on s.id = q.student_id
  where q.token = p_token and q.revoked_at is null
  limit 1;

  -- احتياط: روابط QR القديمة (UUID الطالب نفسه) مع إبطال مُحترم
  if v_student_id is null
     and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$' then
    select s.id, s.teacher_id, s.group_name
      into v_student_id, v_teacher_id, v_group_name
    from public.students s
    where s.id = p_token::uuid
      and not exists (select 1 from public.student_qr_tokens t_rev
                      where t_rev.student_id = s.id and t_rev.revoked_at is not null)
    limit 1;
  end if;

  if v_student_id is null then
    raise exception 'invalid_token';
  end if;

  -- ═══ ممنوع الإعادة: لو فيه تسليم محفوظ رجّعه زي ما هو (بدون تصحيح جديد) ═══
  select * into v_existing
  from public.homework_submissions
  where task_id = p_task_id and student_id = v_student_id
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'status', 'already_submitted',
      'task_id', p_task_id,
      'score', v_existing.score,
      'max_score', v_existing.max_score,
      'correct_count', v_existing.correct_count,
      'question_count', v_existing.question_count,
      'submitted_at', v_existing.submitted_at,
      'results', v_existing.results,
      'answers', v_existing.answers
    );
  end if;

  select * into v_task from public.homework_tasks where id = p_task_id;
  if v_task.id is null or v_task.teacher_id <> v_teacher_id then
    raise exception 'task_not_found';
  end if;
  if v_task.status <> 'published' then
    raise exception 'task_closed';
  end if;
  if v_task.questions is null or jsonb_typeof(v_task.questions) <> 'array' then
    raise exception 'no_questions';
  end if;
  if v_task.group_name is not null and v_task.group_name <> v_group_name then
    raise exception 'not_for_your_group';
  end if;

  v_q_count := jsonb_array_length(v_task.questions);
  if v_q_count = 0 or v_q_count > 100 then
    raise exception 'no_questions';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array'
     or jsonb_array_length(p_answers) > v_q_count then
    raise exception 'invalid_answers';
  end if;

  -- تسوية الإجابات + التصحيح (نفس منطق 056 — نص السؤال اختياري)
  v_answers := p_answers;
  for v_i in 0 .. v_q_count - 1 loop
    v_q := v_task.questions->v_i;
    v_marks := greatest(coalesce((v_q->>'marks')::numeric, 1), 0);
    v_max := v_max + v_marks;

    v_choice := null;
    if v_answers->v_i is not null
       and jsonb_typeof(v_answers->v_i) = 'number'
       and (v_answers->>v_i) ~ '^-?[0-9]+$' then
      v_choice := (v_answers->>v_i)::int;
    end if;

    if v_choice is not null then
      if v_choice < 0
         or v_choice >= coalesce(jsonb_array_length(v_q->'choices'), 0) then
        raise exception 'invalid_answers';
      end if;
    end if;

    v_correct := null;
    if v_q->>'correct' is not null and (v_q->>'correct') ~ '^[0-9]+$' then
      v_correct := (v_q->>'correct')::int;
    end if;

    if v_choice is not null and v_correct is not null and v_choice = v_correct then
      v_score := v_score + v_marks;
      v_correct_count := v_correct_count + 1;
      v_results := v_results || to_jsonb(true);
    else
      v_results := v_results || to_jsonb(false);
    end if;
  end loop;

  -- تسليم واحد فقط: إدخال بدون تجاوز التعارض — لو حصل سباق (جهازين في نفس
  -- اللحظة) يرجّع تسليم اللي سبق بدون إعادة تصحيح.
  insert into public.homework_submissions
    (teacher_id, task_id, student_id, answers, score, max_score,
     correct_count, question_count, results, submitted_at, updated_at)
  values
    (v_teacher_id, p_task_id, v_student_id, v_answers, v_score, v_max,
     v_correct_count, v_q_count, v_results, now(), now())
  on conflict (task_id, student_id) do nothing
  returning * into v_sub;

  if v_sub.id is null then
    select * into v_existing
    from public.homework_submissions
    where task_id = p_task_id and student_id = v_student_id
    limit 1;
    return jsonb_build_object(
      'status', 'already_submitted',
      'task_id', p_task_id,
      'score', v_existing.score,
      'max_score', v_existing.max_score,
      'correct_count', v_existing.correct_count,
      'question_count', v_existing.question_count,
      'submitted_at', v_existing.submitted_at,
      'results', v_existing.results,
      'answers', v_existing.answers
    );
  end if;

  -- ═══ التسجيل التلقائي في الحصة الجاية (طلب المستر) ═══
  -- أول حصة ل_GROUPS الطالب بتاريخ >= النهاردة لسه متلغاتش (open) —
  -- لو الحصة النهاردة لسه شغالة تتسجل فيها على طول، وإلا في أول حصة جاية.
  select ls.id, ls.session_date
    into v_next_session_id, v_next_session_date
  from public.lesson_sessions ls
  where ls.teacher_id = v_teacher_id
    and ls.group_name = v_group_name
    and ls.session_date >= current_date
    and coalesce(ls.status, 'open') <> 'completed'
  order by ls.session_date asc, ls.started_at asc
  limit 1;

  if v_next_session_id is not null then
    v_hw_text := 'واجب إلكتروني: ' || v_score::text || '/' || v_max::text
                 || ' (' || round(v_score / nullif(v_max, 0) * 100)::int || '%)';
    -- نفس قفل صف _upsert_attendance_day: لو المدرس رصد الحضور بعدين،
    -- homework_status يفضل محفوظ (coalesce) وحالة الحضور مش بتتلمس.
    perform public._upsert_attendance_day(
      v_teacher_id, v_student_id, null, v_next_session_id, null, v_hw_text);
    v_recorded := true;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'task_id', p_task_id,
    'score', v_sub.score,
    'max_score', v_sub.max_score,
    'correct_count', v_sub.correct_count,
    'question_count', v_sub.question_count,
    'submitted_at', v_sub.submitted_at,
    'results', v_results,
    'answers', v_sub.answers,
    'next_session_recorded', v_recorded
  );
end;
$fn$;

revoke all on function public.submit_homework_task_answers(text,uuid,jsonb) from public;
revoke all on function public.submit_homework_task_answers(text,uuid,jsonb) from anon;
grant execute on function public.submit_homework_task_answers(text,uuid,jsonb)
  to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4) get_student_portal_data — إسقاط الواجبات: results + video_url
--    (video_url يظهر بعد التسليم فقط — القفل على السيرفر)
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.get_student_portal_data(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to public
as $function$
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
  limit 200;

  select coalesce(jsonb_agg(jsonb_build_object(
    'note', bl.note, 'points_delta', bl.points_delta, 'created_at', bl.created_at
  ) order by bl.created_at desc), '[]'::jsonb) into v_behavior
  from behavior_logs bl
  where bl.student_id = v_student.id and bl.teacher_id = v_teacher_id
  limit 100;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', an.id, 'title', an.title, 'message', an.message,
    'created_at', an.created_at, 'student_id', an.student_id
  ) order by an.created_at desc), '[]'::jsonb) into v_announcements
  from announcements an
  where an.teacher_id = v_teacher_id
    and (an.student_id is null or an.student_id = v_student.id)
  limit 50;

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
  limit 150;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ex.id, 'title', ex.title, 'sections', ex.sections,
    'max_score_per_section', ex.max_score_per_section,
    'lesson_session_id', ex.lesson_session_id
  ) order by ex.created_at desc), '[]'::jsonb) into v_exams
  from exams ex where ex.teacher_id = v_teacher_id
  limit 100;

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

  -- TASK44/058: واجبات آمنة وموسّعة — بدون مفاتيح الإجابة (correct) إطلاقًا +
  -- واجبات «كل المجموعات» (group_name is null) + ملخص تسليم الطالب مع مراجعة
  -- الإجابات (results) + لينك الفيديو بعد التسليم فقط.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ht.id, 'title', ht.title, 'due_date', ht.due_date, 'created_at', ht.created_at,
    'description', ht.description, 'status', ht.status, 'max_score', ht.max_score,
    'video_url', case when v_sub.id is not null then ht.video_url else null end,
    'has_questions', (ht.questions is not null),
    'questions', case when ht.questions is null then null else coalesce((
      select jsonb_agg(jsonb_build_object(
        'text', q->>'text',
        'choices', coalesce(q->'choices', '[]'::jsonb),
        'marks', greatest(coalesce((q->>'marks')::numeric, 1), 0)
      ) order by ord)
      from jsonb_array_elements(ht.questions) with ordinality as t(q, ord)
    ), '[]'::jsonb) end,
    'submission', case when v_sub.id is not null then jsonb_build_object(
      'score', v_sub.score, 'max_score', v_sub.max_score,
      'correct_count', v_sub.correct_count, 'question_count', v_sub.question_count,
      'submitted_at', v_sub.submitted_at, 'results', v_sub.results, 'answers', v_sub.answers
    ) else null end
  ) order by ht.created_at desc), '[]'::jsonb) into v_homework_tasks
  from homework_tasks ht
  left join lateral (
    select hs.* from homework_submissions hs
    where hs.task_id = ht.id and hs.student_id = v_student.id
    limit 1
  ) v_sub on true
  where ht.teacher_id = v_teacher_id
    and (ht.group_name = v_student.group_name or ht.group_name is null)
    and ht.status = 'published'
  limit 100;

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
