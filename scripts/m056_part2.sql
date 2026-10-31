
-- ═══════════════════════════════════════════════════════════════════════════
-- 2A) HOMEWORK TASKS — أعمدة أسئلة الاختيار + سياسات القراءة الناقصة
--     questions = null → الوضع القديم (تحديد كمكتمل) بدون أي تغيير
--     questions = [{text, choices[], correct, marks}] → واجب اختيار إجابة
--     (الملفات لاحقًا: إضافة حقل attachment اختياري في الأسئلة/الإجابات)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.homework_tasks
  add column if not exists description text,
  add column if not exists questions jsonb,
  add column if not exists status text not null default 'published',
  add column if not exists max_score numeric not null default 0,
  add column if not exists version bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

-- قيود القيم (idempotent — تُتجاهل لو موجودة)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'homework_tasks_status_ck') then
    alter table public.homework_tasks
      add constraint homework_tasks_status_ck check (status in ('published','closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'homework_tasks_questions_ck') then
    alter table public.homework_tasks
      add constraint homework_tasks_questions_ck
      check (questions is null or jsonb_typeof(questions) = 'array');
  end if;
end $$;

create index if not exists idx_homework_tasks_teacher
  on public.homework_tasks (teacher_id, created_at desc);

-- سياسات قراءة المدرس (كانت مفقودة — القراءة كانت عبر RPC فقط)
do $$
begin
  if not exists (select 1 from pg_policies
                 where tablename = 'homework_tasks' and policyname = 'homework_tasks_teacher_read') then
    create policy "homework_tasks_teacher_read" on public.homework_tasks
      for select to authenticated
      using (public.can_access_workspace(teacher_id));
  end if;
  if not exists (select 1 from pg_policies
                 where tablename = 'homework_task_status' and policyname = 'homework_task_status_read') then
    create policy "homework_task_status_read" on public.homework_task_status
      for select to authenticated
      using (exists (
        select 1 from public.homework_tasks ht
        where ht.id = homework_task_status.task_id
          and public.can_access_workspace(ht.teacher_id)
      ));
  end if;
end $$;

-- touch updated_at على الواجبات
create or replace function public.homework_tasks_touch()
returns trigger language plpgsql
set search_path to public
as $fn$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$fn$;

drop trigger if exists trg_homework_tasks_touch on public.homework_tasks;
create trigger trg_homework_tasks_touch
  before update on public.homework_tasks
  for each row execute function public.homework_tasks_touch();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2B) HOMEWORK SUBMISSIONS — تسليمات الطلاب (سطر واحد لكل طالب/واجب)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.homework_submissions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.homework_tasks(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  answers jsonb not null default '[]'::jsonb,
  score numeric not null default 0 check (score >= 0),
  max_score numeric not null default 0 check (max_score >= 0),
  correct_count integer not null default 0,
  question_count integer not null default 0,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, student_id)
);

create index if not exists idx_homework_submissions_task
  on public.homework_submissions (task_id);
create index if not exists idx_homework_submissions_student
  on public.homework_submissions (student_id, submitted_at desc);

alter table public.homework_submissions enable row level security;

drop policy if exists "homework_submissions_workspace_all" on public.homework_submissions;
create policy "homework_submissions_workspace_all" on public.homework_submissions
  for all to authenticated
  using (public.can_access_workspace(teacher_id))
  with check (public.can_access_workspace(teacher_id));
-- البوابة تصل عبر RPCs فقط — لا سياسات anon

-- ═══════════════════════════════════════════════════════════════════════════
-- 2C) RPC submit_homework_task_answers — تصحيح سيرفر-آثوريتيتف
--     المفتاح مشابه لمسار 052/055 (توكن البوابة + fallback UUID المُبطل)
--     لا يرجّع مفاتيح الإجابة أبدًا — يرجّع صح/خطأ لكل سؤال فقط
-- ═══════════════════════════════════════════════════════════════════════════
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
  v_task public.homework_tasks%rowtype;
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
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'invalid_token';
  end if;

  -- توكن البوابة → الطالب (نفس مسار 052)
  select q.student_id, s.teacher_id
    into v_student_id, v_teacher_id
  from public.student_qr_tokens q
  join public.students s on s.id = q.student_id
  where q.token = p_token and q.revoked_at is null
  limit 1;

  -- احتياط: روابط QR القديمة (UUID الطالب نفسه) مع إبطال مُحترم
  if v_student_id is null
     and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$' then
    select s.id, s.teacher_id
      into v_student_id, v_teacher_id
    from public.students s
    where s.id = p_token::uuid
      and not exists (select 1 from public.student_qr_tokens t_rev
                      where t_rev.student_id = s.id and t_rev.revoked_at is not null)
    limit 1;
  end if;

  if v_student_id is null then
    raise exception 'invalid_token';
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
  if v_task.group_name is not null
     and (select group_name from public.students where id = v_student_id) <> v_task.group_name then
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

  -- تسوية الإجابات: مصفوفة بطول الأسئلة (null = بدون إجابة)
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

  insert into public.homework_submissions as hs
    (teacher_id, task_id, student_id, answers, score, max_score, correct_count, question_count, submitted_at, updated_at)
  values
    (v_teacher_id, p_task_id, v_student_id, v_answers, v_score, v_max, v_correct_count, v_q_count, now(), now())
  on conflict (task_id, student_id) do update
    set answers = excluded.answers,
        score = excluded.score,
        max_score = excluded.max_score,
        correct_count = excluded.correct_count,
        question_count = excluded.question_count,
        submitted_at = now(),
        updated_at = now()
  returning * into v_sub;

  return jsonb_build_object(
    'task_id', p_task_id,
    'score', v_sub.score,
    'max_score', v_sub.max_score,
    'correct_count', v_sub.correct_count,
    'question_count', v_sub.question_count,
    'submitted_at', v_sub.submitted_at,
    'results', v_results
  );
end;
$fn$;

revoke all on function public.submit_homework_task_answers(text,uuid,jsonb) from public;
grant execute on function public.submit_homework_task_answers(text,uuid,jsonb) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2D) get_student_portal_data — إسقاط آمن وموسّع للواجبات
--     • لا يُسرّب correct أبدًا (text + choices + marks فقط)
--     • واجبات «كل المجموعات» (group_name is null) + المنشور فقط
--     • ملخص تسليم الطالب مع كل واجب
-- ═══════════════════════════════════════════════════════════════════════════
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

  -- TASK44: واجبات آمنة وموسّعة — بدون مفاتيح الإجابة (correct) إطلاقًا +
  -- واجبات «كل المجموعات» (group_name is null) + ملخص تسليم الطالب
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ht.id, 'title', ht.title, 'due_date', ht.due_date, 'created_at', ht.created_at,
    'description', ht.description, 'status', ht.status, 'max_score', ht.max_score,
    'has_questions', (ht.questions is not null),
    'questions', case when ht.questions is null then null else coalesce((
      select jsonb_agg(jsonb_build_object(
        'text', q->>'text',
        'choices', coalesce(q->'choices', '[]'::jsonb),
        'marks', greatest(coalesce((q->>'marks')::numeric, 1), 0)
      ) order by ord), '[]'::jsonb)
      from jsonb_array_elements(ht.questions) with ordinality as t(q, ord)
    ) end,
    'submission', (
      select jsonb_build_object(
        'score', hs.score, 'max_score', hs.max_score,
        'correct_count', hs.correct_count, 'question_count', hs.question_count,
        'submitted_at', hs.submitted_at
      )
      from homework_submissions hs
      where hs.task_id = ht.id and hs.student_id = v_student.id
      limit 1
    )
  ) order by ht.created_at desc), '[]'::jsonb) into v_homework_tasks
  from homework_tasks ht
  where ht.teacher_id = v_teacher_id
    and (ht.group_name = v_student.group_name or ht.group_name is null)
    and ht.status = 'published'
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 1G) get_student_standalone_exams — نسخة الأقسام + النسبة الجزئية
--     محافظة كاملًا على: بوابة النشر (completed فقط) + إبطال التوكن الاحتياطي
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.get_student_standalone_exams(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_student_id uuid;
  v_teacher_id uuid;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return '[]'::jsonb;
  end if;

  select q.student_id, s.teacher_id
    into v_student_id, v_teacher_id
  from public.student_qr_tokens q
  join public.students s on s.id = q.student_id
  where q.token = p_token and q.revoked_at is null
  limit 1;

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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'exam_id', e.id,
      'title', e.title,
      'exam_date', e.exam_date,
      'exam_status', e.status,
      'score', es.score,
      'max_score', e.max_score,
      'grade_scale', e.grade_scale,
      'graded_at', es.updated_at,
      -- TASK44: تفاصيل الأقسام + النسبة الجزئية (من المتاح فقط)
      'sections', e.sections,
      'section_scores', es.section_scores,
      'sections_count', coalesce(jsonb_array_length(e.sections), 0),
      'attempted_count', case
        when coalesce(jsonb_array_length(e.sections), 0) = 0 then null
        else (select count(*) from jsonb_array_elements_text(
                case when jsonb_typeof(es.section_scores) = 'array' then es.section_scores else '[]'::jsonb end) v
              where v is not null) end,
      'attempted_max', case
        when coalesce(jsonb_array_length(e.sections), 0) = 0 then e.max_score
        else (select coalesce(sum(coalesce((e.sections->(idx-1)->>'max')::numeric, 0)), 0)
              from jsonb_array_elements_text(
                case when jsonb_typeof(es.section_scores) = 'array' then es.section_scores else '[]'::jsonb end)
                with ordinality as t(v, idx)
              where v is not null) end,
      'percentage', case
        when coalesce(jsonb_array_length(e.sections), 0) = 0 then
          case when e.max_score > 0 then round(es.score / e.max_score * 100, 1) else 0 end
        else (
          select case when coalesce(sum(coalesce((e.sections->(idx-1)->>'max')::numeric, 0)), 0) > 0
                      then round(es.score
                           / sum(coalesce((e.sections->(idx-1)->>'max')::numeric, 0)) * 100, 1)
                     else 0 end
          from jsonb_array_elements_text(
                 case when jsonb_typeof(es.section_scores) = 'array' then es.section_scores else '[]'::jsonb end)
                 with ordinality as t(v, idx)
          where v is not null ) end,
      'grade', coalesce((
        select g.name
        from (select (js->>'name') name, coalesce((js->>'min')::numeric, 0) min,
                     row_number() over () rn
              from jsonb_array_elements(e.grade_scale) js) g
        where (case
                 when coalesce(jsonb_array_length(e.sections), 0) = 0 then
                   case when e.max_score > 0 then es.score / e.max_score * 100 else 0 end
                 else coalesce((
                   select case when sum(coalesce((e.sections->(idx-1)->>'max')::numeric, 0)) > 0 then
                              es.score / sum(coalesce((e.sections->(idx-1)->>'max')::numeric, 0)) * 100
                            else 0 end
                   from jsonb_array_elements_text(
                          case when jsonb_typeof(es.section_scores) = 'array' then es.section_scores else '[]'::jsonb end)
                          with ordinality as t2(v, idx)
                   where v is not null), 0) end
               ) >= g.min
        order by g.rn
        limit 1), '')
    ) order by e.exam_date desc, e.created_at desc)
    from public.standalone_exam_scores es
    join public.standalone_exams e on e.id = es.exam_id
    where es.student_id = v_student_id
      and es.teacher_id = v_teacher_id
      -- بوابة النشر (055): امتحان مفتوح (تحت التصحيح) نتائجه مبتنشرش
      and e.status = 'completed'
  ), '[]'::jsonb);
end;
$function$
;

grant execute on function public.get_student_standalone_exams(text) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- فحص ذاتي بعد التشغيل
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_count int;
begin
  select count(*) into v_count from information_schema.columns
  where table_schema='public' and table_name='standalone_exams'
    and column_name in ('version','sections');
  if v_count <> 2 then raise exception 'M056 FAILED: standalone_exams columns'; end if;

  select count(*) into v_count from information_schema.columns
  where table_schema='public' and table_name='standalone_exam_scores'
    and column_name in ('version','section_scores');
  if v_count <> 2 then raise exception 'M056 FAILED: standalone_exam_scores columns'; end if;

  select count(*) into v_count from information_schema.columns
  where table_schema='public' and table_name='homework_tasks'
    and column_name in ('description','questions','status','max_score','version','updated_at');
  if v_count <> 6 then raise exception 'M056 FAILED: homework_tasks columns'; end if;

  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='standalone_exam_audit_logs') then
    raise exception 'M056 FAILED: standalone_exam_audit_logs';
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='homework_submissions') then
    raise exception 'M056 FAILED: homework_submissions';
  end if;

  select count(*) into v_count from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('save_standalone_score','update_standalone_exam','ungrade_standalone_student',
                      'submit_homework_task_answers','get_student_standalone_exams','get_student_portal_data');
  if v_count < 6 then raise exception 'M056 FAILED: RPCs (%/6)', v_count; end if;

  select count(*) into v_count from pg_policies
  where tablename in ('homework_tasks','homework_task_status')
    and policyname in ('homework_tasks_teacher_read','homework_task_status_read');
  if v_count < 2 then raise exception 'M056 FAILED: read policies'; end if;

  raise notice 'Migration 056 applied: standalone versioning+audit+sections+ungrade, homework MCQ tables+RPC, safe portal projections';
end $$;
