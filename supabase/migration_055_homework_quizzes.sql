-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 055 — الواجب الإلكتروني بالاختيارات (Homework MCQ quizzes)
-- ═══════════════════════════════════════════════════════════════════════════
-- المطلوب (Task 44 — homework MCQ):
--   • المدرس يعمل واجب اختيارات لكل حصة — نص السؤال اختياري (الواجب ممكن
--     يكون في كتاب)، الاختيارات جاهزة a/b/c/d أو صح/غلط، والمدرس يحدد
--     الإجابات الصحيحة ويعدّلها بعدين.
--   • لينك عام يبعته للطلاب: الطالب يكتب رقمه (تليفون أو كود) بس ويسلّم.
--   • كل جهاز = تسليم واحد لكل واجب + ممنوع الإعادة نهائيًا (unique x2).
--   • الرصد يتم على السيرفر (correct_options عمرها ما تُرسل للطالب قبل التسليم).
--   • الدرجة تتحفظ تلقائيًا وتتسجّل في "الحصة اللي وراها" (homework_status='تم'
--     + homework_grade=% على attendance_records للحصة التالية).
--   • فيديو الشرح يظهر للطالب فقط بعد التسليم.
--   • تحليل بسيط للواجب (أكتر الأسئلة فيها مشاكل) — يُحسب من التسليمات.
-- التشغيل: Management API / SQL Editor — idempotent (آمن للتكرار)
-- ═══════════════════════════════════════════════════════════════════════════

set check_function_bodies = false;

-- ── 1) الجداول ──────────────────────────────────────────────────────────────

-- واجب الاختيارات — واحد كحد أقصى لكل حصة (unique lesson_session_id)
create table if not exists public.homework_quizzes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  lesson_session_id uuid not null references public.lesson_sessions(id) on delete cascade,
  title text,
  instructions text,
  access_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  is_published boolean not null default false,
  video_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint homework_quizzes_session_uniq unique (lesson_session_id)
);

-- أسئلة الواجب — نص السؤال اختياري (nullable) عشان الواجب اللي في الكتاب
create table if not exists public.homework_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.homework_quizzes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  position int not null default 0,
  question_text text,                                   -- اختياري عمدًا
  kind text not null default 'mcq' check (kind in ('mcq', 'true_false')),
  options jsonb not null default '[]'::jsonb,           -- [{"id":"a","label":"أ"},...]
  correct_options jsonb not null default '[]'::jsonb,   -- ["a"] — سرّي قبل التسليم
  explanation text,                                     -- اختياري — تظهر بعد التسليم
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- التسليمات — الطالب مرة واحدة + الجهاز مرة واحدة (ممنوع الإعادة نهائيًا)
create table if not exists public.homework_quiz_submissions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.homework_quizzes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  device_fingerprint text not null default '',
  answers jsonb not null default '{}'::jsonb,           -- {"<question-uuid>": ["a"]}
  score numeric not null default 0,
  max_score numeric not null default 0,
  correct_count int not null default 0,
  question_count int not null default 0,
  submitted_at timestamptz not null default now(),
  constraint homework_quiz_submissions_student_uniq unique (quiz_id, student_id),
  constraint homework_quiz_submissions_device_uniq unique (quiz_id, device_fingerprint)
);

-- درجة الواجب المسجّلة تلقائيًا في الحصة التالية (%)
alter table public.attendance_records
  add column if not exists homework_grade numeric;

create index if not exists idx_homework_quizzes_teacher on public.homework_quizzes(teacher_id);
create index if not exists idx_homework_quizzes_session on public.homework_quizzes(lesson_session_id);
create index if not exists idx_homework_quiz_questions_quiz on public.homework_quiz_questions(quiz_id);
create index if not exists idx_homework_quiz_submissions_teacher on public.homework_quiz_submissions(teacher_id);
create index if not exists idx_homework_quiz_submissions_student on public.homework_quiz_submissions(student_id);

-- ── 2) RLS — نفس نمط 051: المدرس/المساعد عبر can_access_workspace،
--        و anon عمره ما يشوف الجداول (الدخول عبر RPCs المؤمنة بالتوكن فقط) ──
alter table public.homework_quizzes enable row level security;
alter table public.homework_quiz_questions enable row level security;
alter table public.homework_quiz_submissions enable row level security;

drop policy if exists "homework_quizzes_workspace" on public.homework_quizzes;
create policy "homework_quizzes_workspace" on public.homework_quizzes
  for all to authenticated
  using (teacher_id = auth.uid() or public.can_access_workspace(teacher_id))
  with check (teacher_id = auth.uid() or public.can_access_workspace(teacher_id));

drop policy if exists "homework_quiz_questions_workspace" on public.homework_quiz_questions;
create policy "homework_quiz_questions_workspace" on public.homework_quiz_questions
  for all to authenticated
  using (teacher_id = auth.uid() or public.can_access_workspace(teacher_id))
  with check (teacher_id = auth.uid() or public.can_access_workspace(teacher_id));

drop policy if exists "homework_quiz_submissions_workspace" on public.homework_quiz_submissions;
create policy "homework_quiz_submissions_workspace" on public.homework_quiz_submissions
  for all to authenticated
  using (teacher_id = auth.uid() or public.can_access_workspace(teacher_id))
  with check (teacher_id = auth.uid() or public.can_access_workspace(teacher_id));

-- ── 3) Realtime (اختياري — لو الفيشن مش موجود نتخطاه بأمان) ─────────────────
do $$
begin
  begin
    alter publication supabase_realtime add table public.homework_quiz_submissions;
  exception when duplicate_object then null;
  when undefined_object then null;
  end;
end $$;

-- ── 4) helper: نتيجة تسليم جاهزة (تُستخدم من get/submit — مش عامة) ──────────
create or replace function public.hw_quiz_result_json(p_submission_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'score', s.score,
    'max_score', s.max_score,
    'percentage', case when s.max_score > 0 then round(s.score / s.max_score * 100)::int else 0 end,
    'correct_count', s.correct_count,
    'question_count', s.question_count,
    'submitted_at', s.submitted_at,
    'video_url', q.video_url,
    'quiz_title', q.title,
    'per_question', coalesce((
      select jsonb_agg(jsonb_build_object(
          'question_id', qq.id,
          'position', qq.position,
          'question_text', qq.question_text,
          'kind', qq.kind,
          'options', qq.options,
          'correct_options', qq.correct_options,
          'explanation', qq.explanation,
          'chosen', (s.answers ->> qq.id::text)
        ) order by qq.position, qq.created_at)
      from public.homework_quiz_questions qq
      where qq.quiz_id = s.quiz_id
    ), '[]'::jsonb)
  )
  from public.homework_quiz_submissions s
  join public.homework_quizzes q on q.id = s.quiz_id
  where s.id = p_submission_id
$$;

revoke all on function public.hw_quiz_result_json(uuid) from public;
revoke all on function public.hw_quiz_result_json(uuid) from anon;
revoke all on function public.hw_quiz_result_json(uuid) from authenticated;

-- ── 5) RPC عام: تحميل الواجب قبل التسليم (بدون الإجابات الصحيحة!) ───────────
create or replace function public.get_homework_quiz_public(p_token text, p_device text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_quiz record;
  v_device text;
  v_device_used boolean := false;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return jsonb_build_object('status', 'not_found', 'message', 'الرابط غير صالح');
  end if;

  select q.id, q.title, q.instructions, q.video_url,
         ls.group_name, ls.session_date
    into v_quiz
  from public.homework_quizzes q
  join public.lesson_sessions ls on ls.id = q.lesson_session_id
  where q.access_token = btrim(p_token) and q.is_published
  limit 1;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'الرابط غير صالح أو الواجب مش منشور بعد');
  end if;

  v_device := left(coalesce(btrim(p_device), ''), 120);
  if v_device <> '' then
    if exists (select 1 from public.homework_quiz_submissions s
               where s.quiz_id = v_quiz.id and s.device_fingerprint = v_device) then
      v_device_used := true;
    end if;
  end if;

  return jsonb_build_object(
    'status', case when v_device_used then 'already_submitted_device' else 'ok' end,
    'quiz', jsonb_build_object(
      'id', v_quiz.id,
      'title', v_quiz.title,
      'instructions', v_quiz.instructions,
      'group_name', v_quiz.group_name,
      'session_date', v_quiz.session_date,
      -- الفيديو مقفول لحد ما الطالب يسلّم (بناية طلب المستر)
      'video_url', case when v_device_used then v_quiz.video_url else null end,
      'question_count', (select count(*)::int from public.homework_quiz_questions qq where qq.quiz_id = v_quiz.id)
    ),
    -- الأسئلة من غير correct_options ولا explanation (مفيش تسريب قبل التسليم)
    'questions', case when v_device_used then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', qq.id, 'position', qq.position,
          'question_text', qq.question_text, 'kind', qq.kind,
          'options', qq.options
        ) order by qq.position, qq.created_at)
      from public.homework_quiz_questions qq
      where qq.quiz_id = v_quiz.id
    ), '[]'::jsonb) end,
    -- لو الجهاز ده سلّم: نرجّع نتيجته المحفوظة (نفس الصفحة = نفس النتيجة)
    'result', case when v_device_used
      then (select public.hw_quiz_result_json(s2.id)
            from public.homework_quiz_submissions s2
            where s2.quiz_id = v_quiz.id and s2.device_fingerprint = v_device
            order by s2.submitted_at desc limit 1)
      else null end
  );
end;
$$;

-- ── 6) RPC عام: التسليم (الرصد على السيرفر + منع الإعادة + التسجيل التلقائي) ─
create or replace function public.submit_homework_quiz(
  p_token text, p_student_number text, p_answers jsonb, p_device text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz record;
  v_num text;
  v_student record;
  v_match_count int := 0;
  v_device text;
  v_questions jsonb;
  v_qtotal int := 0;
  v_score numeric := 0;
  v_max numeric := 0;
  v_correct int := 0;
  v_per_question jsonb := '[]'::jsonb;
  v_pct numeric := 0;
  v_src_date date;
  v_src_ts timestamptz;
  v_next record;
  v_inserted boolean := false;
begin
  if p_token is null or length(btrim(p_token)) = 0
     or p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('status', 'error', 'message', 'بيانات ناقصة — أعد تحميل الصفحة');
  end if;

  select q.id, q.title, q.video_url, q.lesson_session_id,
         ls.group_name as _group, ls.teacher_id as _teacher
    into v_quiz
  from public.homework_quizzes q
  join public.lesson_sessions ls on ls.id = q.lesson_session_id
  where q.access_token = btrim(p_token) and q.is_published
  limit 1;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'الرابط غير صالح أو الواجب مش منشور بعد');
  end if;

  -- الرقم: أرقام هندية/عربية → لاتيني + إزالة كل ما عدا الأرقام
  v_num := regexp_replace(
    translate(coalesce(p_student_number, ''),
      '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '\D', '', 'g');

  -- الطالب: داخل مجموعة الحصة فقط — بالتليفون أولًا ثم بالكود
  if length(v_num) >= 4 then
    select count(*) into v_match_count
    from public.students s
    where s.teacher_id = v_quiz._teacher
      and s.group_name = v_quiz._group
      and regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') = v_num;
    if v_match_count = 1 then
      select s.id, s.name into v_student
      from public.students s
      where s.teacher_id = v_quiz._teacher
        and s.group_name = v_quiz._group
        and regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') = v_num
      limit 1;
    end if;
  end if;
  if v_match_count = 0 and coalesce(btrim(p_student_number), '') <> '' then
    select count(*) into v_match_count
    from public.students s
    where s.teacher_id = v_quiz._teacher
      and s.group_name = v_quiz._group
      and btrim(coalesce(s.code, '')) = btrim(p_student_number);
    if v_match_count = 1 then
      select s.id, s.name into v_student
      from public.students s
      where s.teacher_id = v_quiz._teacher
        and s.group_name = v_quiz._group
        and btrim(coalesce(s.code, '')) = btrim(p_student_number)
      limit 1;
    end if;
  end if;

  if v_match_count = 0 then
    return jsonb_build_object('status', 'student_not_found',
      'message', 'الرقم ده مش موجود في مجموعة الواجب — اتأكد منه أو كلم المستر');
  end if;
  if v_match_count > 1 then
    return jsonb_build_object('status', 'ambiguous_student',
      'message', 'الرقم مكرر عند أكتر من طالب في المجموعة — كلم المستر يظبط الحسابات');
  end if;

  -- ممنوع الإعادة: الطالب سلم بالفعل → نرجّع نتيجته المحفوظة
  if exists (select 1 from public.homework_quiz_submissions s
             where s.quiz_id = v_quiz.id and s.student_id = v_student.id) then
    return jsonb_build_object('status', 'already_submitted',
      'message', 'الواجب ده اتسلّم بالفعل من الطالب ده — مش مسموح بالإعادة',
      'student_name', v_student.name,
      'result', (select public.hw_quiz_result_json(s2.id)
                 from public.homework_quiz_submissions s2
                 where s2.quiz_id = v_quiz.id and s2.student_id = v_student.id
                 order by s2.submitted_at desc limit 1));
  end if;

  -- كل جهاز = تسليم واحد لكل واجب (بناية طلب المستر)
  v_device := left(coalesce(btrim(p_device), ''), 120);
  if v_device <> '' and exists (select 1 from public.homework_quiz_submissions s
      where s.quiz_id = v_quiz.id and s.device_fingerprint = v_device) then
    return jsonb_build_object('status', 'device_used',
      'message', 'الجهاز ده سلّم الواجب ده بالفعل — كل جهاز ليه تسليم واحد بس');
  end if;

  -- الرصد على السيرفر (الإجابات الصحيحة عمرها ما وصلت للعميل)
  select coalesce(jsonb_agg(to_jsonb(qq) order by qq.position, qq.created_at), '[]'::jsonb)
    into v_questions
  from public.homework_quiz_questions qq
  where qq.quiz_id = v_quiz.id;
  v_qtotal := jsonb_array_length(v_questions);

  for i in 0 .. greatest(v_qtotal - 1, 0) loop
    declare
      qq jsonb := v_questions -> i;
      qid text := qq ->> 'id';
      pts numeric := coalesce((qq ->> 'points')::numeric, 1);
      v_chosen jsonb := p_answers -> qid;
      v_answer jsonb := qq -> 'correct_options';
      v_ok boolean := false;
    begin
      v_max := v_max + pts;
      if v_chosen is not null and jsonb_typeof(v_chosen) = 'array'
         and v_answer is not null and jsonb_typeof(v_answer) = 'array'
         and jsonb_array_length(v_chosen) > 0 and jsonb_array_length(v_answer) > 0 then
        select (select jsonb_agg(x order by x) from jsonb_array_elements_text(v_chosen) x)
             = (select jsonb_agg(x order by x) from jsonb_array_elements_text(v_answer) x)
          into v_ok;
      end if;
      if v_ok then v_score := v_score + pts; v_correct := v_correct + 1; end if;
      v_per_question := v_per_question || jsonb_build_object(
        'question_id', qq ->> 'id', 'position', qq ->> 'position',
        'question_text', qq ->> 'question_text', 'kind', qq ->> 'kind',
        'options', qq -> 'options', 'correct_options', v_answer,
        'explanation', qq ->> 'explanation', 'chosen', v_chosen, 'is_correct', v_ok);
    end;
  end loop;

  v_pct := case when v_max > 0 then round(v_score / v_max * 100) else 0 end;

  begin
    insert into public.homework_quiz_submissions
      (quiz_id, teacher_id, student_id, device_fingerprint, answers,
       score, max_score, correct_count, question_count)
    values
      (v_quiz.id, v_quiz._teacher, v_student.id, v_device, p_answers,
       v_score, v_max, v_correct, v_qtotal);
    v_inserted := true;
  exception when unique_violation then
    return jsonb_build_object('status', 'already_submitted',
      'message', 'الواجب ده اتسلّم بالفعل — مش مسموح بالإعادة',
      'student_name', v_student.name,
      'result', (select public.hw_quiz_result_json(s2.id)
                 from public.homework_quiz_submissions s2
                 where s2.quiz_id = v_quiz.id and s2.student_id = v_student.id
                 order by s2.submitted_at desc limit 1));
  end;

  -- ── التسجيل التلقائي في "الحصة اللي وراها": homework_status='تم' + الدرجة % ──
  select s2.session_date, coalesce(s2.started_at, s2.created_at) as ts
    into v_src_date, v_src_ts
  from public.lesson_sessions s2
  where s2.id = v_quiz.lesson_session_id;

  if v_src_date is not null then
    select ls.* into v_next
    from public.lesson_sessions ls
    where ls.teacher_id = v_quiz._teacher
      and ls.group_name = v_quiz._group
      and (ls.session_date > v_src_date
           or (ls.session_date = v_src_date
               and coalesce(ls.started_at, ls.created_at) > v_src_ts))
    order by ls.session_date asc, coalesce(ls.started_at, ls.created_at) asc
    limit 1;

    if found then
      update public.attendance_records a
        set homework_status = 'تم',
            homework_grade = v_pct,
            recorded_at = now()
      where a.lesson_session_id = v_next.id
        and a.student_id = v_student.id
        and coalesce(a.homework_status, '') not in ('تم', 'مكتمل');
      if not found and not exists (
        select 1 from public.attendance_records a
        where a.lesson_session_id = v_next.id and a.student_id = v_student.id) then
        insert into public.attendance_records
          (teacher_id, student_id, lesson_session_id, status,
           homework_status, homework_grade, recorded_at, attendance_date)
        values
          (v_quiz._teacher, v_student.id, v_next.id, 'لم يرصد',
           'تم', v_pct, now(), v_next.session_date);
      end if;
    end if;
  end if;

  -- إشعار للمدرس (سنتر الإشعارات + الـ push الموجودين) + إشعار للطالب
  insert into public.teacher_notification_events
    (teacher_id, event_type, title, body, related_student_id)
  values
    (v_quiz._teacher, 'student_submission', 'واجب إلكتروني جديد',
     v_student.name || ' سلّم «' || coalesce(v_quiz.title, 'واجب الحصة') || '» — '
       || v_score::text || ' من ' || v_max::text || ' (' || v_pct::text || '%)',
     v_student.id);

  insert into public.student_notifications
    (teacher_id, student_id, title, body, category, deep_link)
  values
    (v_quiz._teacher, v_student.id, 'تم استلام واجبك',
     'نتيجتك في «' || coalesce(v_quiz.title, 'واجب الحصة') || '»: '
       || v_score::text || ' من ' || v_max::text || ' (' || v_pct::text || '%)',
     'homework', '/');

  return jsonb_build_object('status', 'ok', 'student_name', v_student.name,
    'result', jsonb_build_object(
      'score', v_score, 'max_score', v_max, 'percentage', v_pct::int,
      'correct_count', v_correct, 'question_count', v_qtotal,
      'video_url', v_quiz.video_url, 'quiz_title', v_quiz.title,
      'submitted_at', now(), 'per_question', v_per_question));
end;
$$;

-- ── 7) RPC للمدرس: مزامنة تسليمات واجبات المجموعة القديمة على حصة معينة ─────
-- (تشتغل عند فتح تاب الواجب — idempotent: ما بتكسرش اللي رصده المدرس بنفسه)
create or replace function public.sync_homework_quiz_results(p_lesson_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_quiz record;
  v_sub record;
  v_pct numeric;
  v_applied int := 0;
begin
  if p_lesson_session_id is null then
    return jsonb_build_object('applied', 0);
  end if;

  select * into v_session from public.lesson_sessions where id = p_lesson_session_id;
  if not found then return jsonb_build_object('applied', 0); end if;

  if not public.can_access_workspace(v_session.teacher_id) then
    raise exception 'لا تملك صلاحية على هذه الحصة' using errcode = '42501';
  end if;

  for v_quiz in
    select q.id
    from public.homework_quizzes q
    join public.lesson_sessions ls on ls.id = q.lesson_session_id
    where ls.teacher_id = v_session.teacher_id
      and ls.group_name = v_session.group_name
      and q.is_published
      and (ls.session_date < v_session.session_date
           or (ls.session_date = v_session.session_date
               and coalesce(ls.started_at, ls.created_at)
                 < coalesce(v_session.started_at, v_session.created_at)))
  loop
    for v_sub in
      select * from public.homework_quiz_submissions
      where quiz_id = v_quiz.id
    loop
      v_pct := case when v_sub.max_score > 0
                    then round(v_sub.score / v_sub.max_score * 100) else 0 end;

      if not exists (select 1 from public.attendance_records a
                     where a.lesson_session_id = p_lesson_session_id
                       and a.student_id = v_sub.student_id) then
        insert into public.attendance_records
          (teacher_id, student_id, lesson_session_id, status,
           homework_status, homework_grade, recorded_at, attendance_date)
        values
          (v_session.teacher_id, v_sub.student_id, p_lesson_session_id, 'لم يرصد',
           'تم', v_pct, now(), v_session.session_date);
        v_applied := v_applied + 1;
      elsif exists (select 1 from public.attendance_records a
                    where a.lesson_session_id = p_lesson_session_id
                      and a.student_id = v_sub.student_id
                      and coalesce(a.homework_status, '') not in ('تم', 'مكتمل')) then
        update public.attendance_records a
          set homework_status = 'تم', homework_grade = v_pct, recorded_at = now()
        where a.lesson_session_id = p_lesson_session_id
          and a.student_id = v_sub.student_id;
        v_applied := v_applied + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('applied', v_applied);
end;
$$;

-- ── 8) الصلاحيات ────────────────────────────────────────────────────────────
revoke all on function public.get_homework_quiz_public(text, text) from public;
revoke all on function public.get_homework_quiz_public(text, text) from anon;
revoke all on function public.get_homework_quiz_public(text, text) from authenticated;
grant execute on function public.get_homework_quiz_public(text, text) to anon;
grant execute on function public.get_homework_quiz_public(text, text) to authenticated;

revoke all on function public.submit_homework_quiz(text, text, jsonb, text) from public;
revoke all on function public.submit_homework_quiz(text, text, jsonb, text) from anon;
revoke all on function public.submit_homework_quiz(text, text, jsonb, text) from authenticated;
grant execute on function public.submit_homework_quiz(text, text, jsonb, text) to anon;
grant execute on function public.submit_homework_quiz(text, text, jsonb, text) to authenticated;

revoke all on function public.sync_homework_quiz_results(uuid) from public;
revoke all on function public.sync_homework_quiz_results(uuid) from anon;
revoke all on function public.sync_homework_quiz_results(uuid) from authenticated;
grant execute on function public.sync_homework_quiz_results(uuid) to authenticated;

-- ── 9) فحص ذاتي ─────────────────────────────────────────────────────────────
do $$
declare
  v_count int;
begin
  select count(*) into v_count from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('get_homework_quiz_public', 'submit_homework_quiz',
                      'sync_homework_quiz_results', 'hw_quiz_result_json');
  if v_count < 4 then
    raise exception 'Migration 055 FAILED: RPCs missing (%)', v_count;
  end if;
  select count(*) into v_count from information_schema.tables
  where table_schema = 'public'
    and table_name in ('homework_quizzes', 'homework_quiz_questions', 'homework_quiz_submissions');
  if v_count < 3 then
    raise exception 'Migration 055 FAILED: tables missing (%)', v_count;
  end if;
  raise notice 'Migration 055 applied: homework MCQ quizzes — 3 tables + attendance.homework_grade + 4 RPCs (anon: get/submit, auth: sync)';
end $$;
