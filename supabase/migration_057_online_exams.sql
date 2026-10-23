-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 057 — ONLINE EXAMS (الامتحانات الأونلاين) — Phase 44c
-- امتحان داخل المنصة: المؤقت سيرفر-آثوريتيتف (deadline يُحسب عند البدء على
-- السيرفر) + autosave + تصحيح MCQ سيرفر-آثوريتيتف + سؤال واحد محاولة لكل طالب.
--
-- 1) online_exams          — الامتحان (أسئلة jsonb بنفس شكل الواجبات المُجرَّب)
-- 2) online_exam_attempts  — محاولة واحدة لكل (امتحان، طالب) بميعاد نهائي سيرفر
-- 3) RPCs للبوابة (توكن 2-مسار مثل 056): start / autosave / submit / list
--    • الأسئلة لا تُعاد أبدًا قبل بدء المحاولة (منع قراءة الأسئلة قبل التوقيت)
--    • لا تُعاد مفاتيح الإجابات أبدًا — فقط صح/خطأ لكل سؤال
--    • lazy-expire: أي محاولة عدّى موعدها بتتصحّح من آخر autosave تلقائيًا
-- 4) مدرّس: وصول مباشر عبر RLS (can_access_workspace) + حذف محاولة = إعادة تعيين
-- ═══════════════════════════════════════════════════════════════════════════

set check_function_bodies = false;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) ONLINE EXAMS — جدول الامتحانات الأونلاين
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.online_exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  instructions text,
  group_name text,                       -- null = كل المجموعات (نفس الواجبات)
  status text not null default 'open',   -- scheduled | open | closed
  opens_at timestamptz,                  -- نافذة اختيارية (إضافة على status)
  closes_at timestamptz,                 -- إغلاق صلب لبدء محاولات جديدة
  duration_minutes integer not null default 30 check (duration_minutes between 1 and 300),
  questions jsonb not null default '[]'::jsonb,  -- [{text,choices[],correct,marks}]
  shuffle_questions boolean not null default false,
  max_score numeric not null default 0,
  question_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint online_exams_status_ck check (status in ('scheduled','open','closed')),
  constraint online_exams_questions_ck check (jsonb_typeof(questions) = 'array')
);

create index if not exists idx_online_exams_teacher
  on public.online_exams (teacher_id, created_at desc);

alter table public.online_exams enable row level security;

drop policy if exists "online_exams_workspace_all" on public.online_exams;
create policy "online_exams_workspace_all" on public.online_exams
  for all to authenticated
  using (public.can_access_workspace(teacher_id))
  with check (public.can_access_workspace(teacher_id));
-- البوابة تصل عبر RPCs فقط — لا سياسات anon

-- ── Trigger تطبيع + تحقق: شكل الأسئلة، max_score، منع تعديل الأسئلة
--    أثناء وجود محاولات جارية (سلامة التصحيح)
create or replace function public.online_exams_normalize()
returns trigger
language plpgsql
set search_path to public
as $fn$
declare
  v_q jsonb;
  v_i int;
  v_n int;
  v_max numeric := 0;
  v_choices int;
  v_correct int;
  v_marks numeric;
begin
  if new.title is null or length(btrim(new.title)) = 0 then
    raise exception 'title_required';
  end if;

  if jsonb_typeof(new.questions) <> 'array' then
    raise exception 'invalid_questions';
  end if;

  v_n := jsonb_array_length(new.questions);
  if v_n > 200 then
    raise exception 'too_many_questions';
  end if;

  for v_i in 0 .. v_n - 1 loop
    v_q := new.questions->v_i;
    if v_q->>'text' is null or length(btrim(v_q->>'text')) = 0 then
      raise exception 'invalid_questions';
    end if;
    if v_q->'choices' is null or jsonb_typeof(v_q->'choices') <> 'array' then
      raise exception 'invalid_questions';
    end if;
    v_choices := jsonb_array_length(v_q->'choices');
    if v_choices < 2 or v_choices > 6 then
      raise exception 'invalid_questions';
    end if;
    v_correct := null;
    if v_q->>'correct' is not null and (v_q->>'correct') ~ '^[0-9]+$' then
      v_correct := (v_q->>'correct')::int;
    end if;
    if v_correct is null or v_correct < 0 or v_correct >= v_choices then
      raise exception 'invalid_questions';
    end if;
    v_marks := greatest(coalesce((v_q->>'marks')::numeric, 1), 0);
    v_max := v_max + v_marks;
  end loop;

  new.max_score := v_max;
  new.question_count := v_n;
  new.updated_at := now();

  -- منع تعديل الأسئلة أثناء وجود محاولة جارية (الأسئلة مجمدة للمحاولة)
  if tg_op = 'UPDATE' then
    if new.questions is distinct from old.questions
       and exists (select 1 from public.online_exam_attempts a
                   where a.exam_id = new.id and a.status = 'in_progress') then
      raise exception 'attempts_in_progress';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_online_exams_normalize on public.online_exams;
create trigger trg_online_exams_normalize
  before insert or update on public.online_exams
  for each row execute function public.online_exams_normalize();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) ONLINE EXAM ATTEMPTS — محاولة واحدة لكل (امتحان، طالب)
--    deadline_at يُحسب على السيرفر عند البدء — ساعة العميل عرض فقط
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.online_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.online_exams(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'in_progress',  -- in_progress | submitted | expired
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  answers jsonb not null default '[]'::jsonb,  -- بترتيب العرض (order) — int|null
  question_order jsonb not null default '[]'::jsonb, -- ترتيب العرض → فهرس السؤال
  score numeric,
  max_score numeric,
  correct_count integer,
  question_count integer,
  results jsonb,                               -- [true/false] لكل سؤال بالترتيب
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id),
  constraint online_exam_attempts_status_ck check (status in ('in_progress','submitted','expired'))
);

create index if not exists idx_online_exam_attempts_exam
  on public.online_exam_attempts (exam_id);
create index if not exists idx_online_exam_attempts_student
  on public.online_exam_attempts (student_id);
create index if not exists idx_online_exam_attempts_inprogress
  on public.online_exam_attempts (exam_id) where status = 'in_progress';

alter table public.online_exam_attempts enable row level security;

drop policy if exists "online_exam_attempts_workspace_all" on public.online_exam_attempts;
create policy "online_exam_attempts_workspace_all" on public.online_exam_attempts
  for all to authenticated
  using (public.can_access_workspace(teacher_id))
  with check (public.can_access_workspace(teacher_id));
-- البوابة تصل عبر RPCs فقط — لا سياسات anon

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) HELPER — تصحيح إجابات محاولة (بترتيب العرض) — داخلي فقط
--    يُستدعى من الـ RPCs (security definer) — ممنوع على anon/authenticated
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.online_exam_grade_answers(
  p_questions jsonb,
  p_order jsonb,
  p_answers jsonb
)
returns jsonb
language plpgsql
stable
set search_path to public
as $fn$
declare
  v_n int;
  v_i int;
  v_real int;
  v_q jsonb;
  v_marks numeric;
  v_choice int;
  v_correct int;
  v_score numeric := 0;
  v_max numeric := 0;
  v_correct_count int := 0;
  v_results jsonb := '[]'::jsonb;
begin
  v_n := jsonb_array_length(p_questions);
  for v_i in 0 .. v_n - 1 loop
    v_real := v_i;
    if jsonb_typeof(p_order) = 'array'
       and jsonb_array_length(p_order) = v_n
       and (p_order->>v_i) ~ '^[0-9]+$'
       and (p_order->>v_i)::int between 0 and v_n - 1 then
      v_real := (p_order->>v_i)::int;
    end if;
    v_q := p_questions->v_real;
    v_marks := greatest(coalesce((v_q->>'marks')::numeric, 1), 0);
    v_max := v_max + v_marks;

    v_choice := null;
    if p_answers->v_i is not null
       and jsonb_typeof(p_answers->v_i) = 'number'
       and (p_answers->>v_i) ~ '^-?[0-9]+$' then
      v_choice := (p_answers->>v_i)::int;
    end if;
    if v_choice is not null
       and (v_choice < 0 or v_choice >= coalesce(jsonb_array_length(v_q->'choices'), 0)) then
      raise exception 'invalid_answers';
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

  return jsonb_build_object(
    'score', v_score,
    'max_score', v_max,
    'correct_count', v_correct_count,
    'question_count', v_n,
    'results', v_results
  );
end;
$fn$;

revoke all on function public.online_exam_grade_answers(jsonb,jsonb,jsonb) from public;
revoke all on function public.online_exam_grade_answers(jsonb,jsonb,jsonb) from anon, authenticated;

-- ── Helper داخلي: تطبيع مصفوفة الإجابات (طول = عدد الأسئلة، أرقام صحيحة أو null)
--    التحقق من حدود الاختيار ضد السؤال الحقيقي (عبر ترتيب العرض) — نفس منطق التصحيح
create or replace function public.online_exam_validate_answers(
  p_questions jsonb,
  p_order jsonb,
  p_answers jsonb
)
returns jsonb
language plpgsql
stable
set search_path to public
as $fn$
declare
  v_n int;
  v_i int;
  v_v jsonb;
  v_parts text[] := '{}';
  v_real int;
  v_choices int;
begin
  v_n := jsonb_array_length(p_questions);
  if p_answers is null or jsonb_typeof(p_answers) <> 'array'
     or jsonb_array_length(p_answers) > v_n then
    raise exception 'invalid_answers';
  end if;
  for v_i in 0 .. v_n - 1 loop
    v_real := v_i;
    if jsonb_typeof(p_order) = 'array'
       and jsonb_array_length(p_order) = v_n
       and (p_order->>v_i) ~ '^[0-9]+$'
       and (p_order->>v_i)::int between 0 and v_n - 1 then
      v_real := (p_order->>v_i)::int;
    end if;
    v_v := p_answers->v_i;
    if v_v is null or jsonb_typeof(v_v) = 'null' then
      v_parts[v_i + 1] := 'null';
    elsif jsonb_typeof(v_v) = 'number' and (v_v::text) ~ '^-?[0-9]+$' then
      if (v_v::text)::int < 0 then
        raise exception 'invalid_answers';
      end if;
      v_choices := coalesce(jsonb_array_length(p_questions->v_real->'choices'), 0);
      if (v_v::text)::int >= v_choices then
        raise exception 'invalid_answers';
      end if;
      v_parts[v_i + 1] := v_v::text;
    else
      raise exception 'invalid_answers';
    end if;
  end loop;
  return ('[' || array_to_string(v_parts, ',') || ']')::jsonb;
end;
$fn$;

revoke all on function public.online_exam_validate_answers(jsonb,jsonb,jsonb) from public;
revoke all on function public.online_exam_validate_answers(jsonb,jsonb,jsonb) from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) HELPER داخلي — إقفال محاولة منتهية (lazy-expire) بالتصحيح من آخر autosave
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.online_exam_expire_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_a public.online_exam_attempts%rowtype;
  v_e public.online_exams%rowtype;
  v_grade jsonb;
begin
  select * into v_a from public.online_exam_attempts where id = p_attempt_id for update;
  if v_a.id is null then
    raise exception 'no_attempt';
  end if;
  if v_a.status <> 'in_progress' then
    return jsonb_build_object(
      'status', v_a.status, 'score', v_a.score, 'max_score', v_a.max_score,
      'correct_count', v_a.correct_count, 'question_count', v_a.question_count,
      'results', v_a.results, 'submitted_at', v_a.submitted_at
    );
  end if;

  select * into v_e from public.online_exams where id = v_a.exam_id;
  v_grade := public.online_exam_grade_answers(v_e.questions, v_a.question_order, v_a.answers);

  update public.online_exam_attempts
    set status = 'expired',
        submitted_at = now(),
        score = (v_grade->>'score')::numeric,
        max_score = (v_grade->>'max_score')::numeric,
        correct_count = (v_grade->>'correct_count')::int,
        question_count = (v_grade->>'question_count')::int,
        results = v_grade->'results',
        updated_at = now()
  where id = v_a.id;

  return jsonb_build_object(
    'status', 'expired', 'score', v_grade->'score', 'max_score', v_grade->'max_score',
    'correct_count', v_grade->'correct_count', 'question_count', v_grade->'question_count',
    'results', v_grade->'results', 'submitted_at', now()
  );
end;
$fn$;

revoke all on function public.online_exam_expire_attempt(uuid) from public;
revoke all on function public.online_exam_expire_attempt(uuid) from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) RPC — start_online_exam: بدء/استكمال محاولة
--    • exam مفتوح + نافذة سارية + مجموعة صحيحة (للبدء الجديد فقط)
--    • استكمال محاولة جارية مسموح حتى لو الامتحان اتقفل بعدها (بدأ قانوني)
--    • محاولة منتهية → النتيجة فقط (بدون إعادة)
--    • الأسئلة الآمنة فقط (بدون correct) + deadline سيرفر + server_now
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.start_online_exam(
  p_token text,
  p_exam_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_student_id uuid;
  v_teacher_id uuid;
  v_student public.students%rowtype;
  v_e public.online_exams%rowtype;
  v_a public.online_exam_attempts%rowtype;
  v_order jsonb;
  v_idx int;
  v_j int;
  v_tmp int;
  v_arr jsonb;
  v_safe jsonb;
  v_deadline timestamptz;
  v_result jsonb;
  v_i int;
  v_real int;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'invalid_token';
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
      and not exists (select 1 from public.student_qr_tokens t_rev
                      where t_rev.student_id = s.id and t_rev.revoked_at is not null)
    limit 1;
  end if;

  if v_student_id is null then
    raise exception 'invalid_token';
  end if;

  select * into v_student from public.students where id = v_student_id;

  select * into v_e from public.online_exams where id = p_exam_id;
  if v_e.id is null or v_e.teacher_id <> v_teacher_id then
    raise exception 'exam_not_found';
  end if;

  if v_e.group_name is not null and v_student.group_name <> v_e.group_name then
    raise exception 'not_for_your_group';
  end if;

  -- محاولة قائمة؟
  select * into v_a from public.online_exam_attempts
    where exam_id = v_e.id and student_id = v_student_id;

  if v_a.id is not null then
    if v_a.status <> 'in_progress' then
      return jsonb_build_object(
        'done', true, 'status', v_a.status,
        'score', v_a.score, 'max_score', v_a.max_score,
        'correct_count', v_a.correct_count, 'question_count', v_a.question_count,
        'results', v_a.results, 'submitted_at', v_a.submitted_at
      );
    end if;
    if now() >= v_a.deadline_at then
      v_result := public.online_exam_expire_attempt(v_a.id);
      return jsonb_build_object('done', true) || v_result;
    end if;
    -- استكمال — نفس الترتيب والإجابات المحفوظة (projection ببلوب — بدون lateral/aggregate)
    v_safe := '[]'::jsonb;
    for v_i in 0 .. v_e.question_count - 1 loop
      v_real := v_i;
      if jsonb_typeof(v_a.question_order) = 'array'
         and jsonb_array_length(v_a.question_order) = v_e.question_count
         and (v_a.question_order->>v_i) ~ '^[0-9]+$' then
        v_real := (v_a.question_order->>v_i)::int;
      end if;
      v_safe := v_safe || jsonb_build_object(
        'text', v_e.questions->v_real->>'text',
        'choices', v_e.questions->v_real->'choices',
        'marks', coalesce((v_e.questions->v_real->>'marks')::numeric, 1)
      );
    end loop;
    return jsonb_build_object(
      'resumed', true,
      'attempt_id', v_a.id,
      'deadline_at', v_a.deadline_at,
      'server_now', now(),
      'duration_minutes', v_e.duration_minutes,
      'order', v_a.question_order,
      'answers', v_a.answers,
      'questions', v_safe
    );
  end if;

  -- بدء جديد — الامتحان لازم يكون مفتوح والنافذة سارية
  if v_e.status <> 'open'
     or (v_e.opens_at is not null and now() < v_e.opens_at)
     or (v_e.closes_at is not null and now() >= v_e.closes_at) then
    raise exception 'exam_not_open';
  end if;
  if v_e.question_count = 0 then
    raise exception 'no_questions';
  end if;

  -- ترتيب العرض: عشوائي (shuffle) أو تسلسلي
  if v_e.shuffle_questions then
    v_arr := '[]'::jsonb;
    for v_idx in 0 .. v_e.question_count - 1 loop
      v_arr := v_arr || to_jsonb(v_idx);
    end loop;
    -- Fisher-Yates (REVERSE — يجب أن يكون BY موجبًا في plpgsql)
    for v_idx in reverse v_e.question_count - 1 .. 1 loop
      v_j := floor(random() * (v_idx + 1))::int;
      v_tmp := (v_arr->>v_idx)::int;
      v_arr := jsonb_set(v_arr, array[v_idx::text], to_jsonb((v_arr->>v_j)::int));
      v_arr := jsonb_set(v_arr, array[v_j::text], to_jsonb(v_tmp));
    end loop;
    v_order := v_arr;
  else
    select coalesce(jsonb_agg(to_jsonb(i) order by i), '[]'::jsonb)
      into v_order
    from generate_series(0, v_e.question_count - 1) as i;
  end if;

  v_deadline := now() + make_interval(mins => v_e.duration_minutes);

  insert into public.online_exam_attempts
    (exam_id, student_id, teacher_id, status, started_at, deadline_at, answers, question_order)
  values
    (v_e.id, v_student_id, v_teacher_id, 'in_progress', now(), v_deadline,
     jsonb_repeat_nulls(v_e.question_count), v_order)
  returning * into v_a;

  v_safe := '[]'::jsonb;
  for v_i in 0 .. v_e.question_count - 1 loop
    -- question_order لسه متبني بطول n مظبوط
    v_real := (v_a.question_order->>v_i)::int;
    v_safe := v_safe || jsonb_build_object(
      'text', v_e.questions->v_real->>'text',
      'choices', v_e.questions->v_real->'choices',
      'marks', coalesce((v_e.questions->v_real->>'marks')::numeric, 1)
    );
  end loop;

  return jsonb_build_object(
    'started', true,
    'attempt_id', v_a.id,
    'deadline_at', v_deadline,
    'server_now', now(),
    'duration_minutes', v_e.duration_minutes,
    'order', v_a.question_order,
    'answers', v_a.answers,
    'questions', v_safe
  );
end;
$fn$;

revoke all on function public.start_online_exam(text,uuid) from public;
grant execute on function public.start_online_exam(text,uuid) to anon, authenticated, service_role;

-- ── Helper صغير: مصفوفة nulls بطول n (بذرة الإجابات)
create or replace function public.jsonb_repeat_nulls(p_n int)
returns jsonb
language sql
immutable
set search_path to public
as $fn$
  -- to_jsonb(null::int) ترجع SQL NULL (و jsonb_agg يتخطى الـ NULL) — نبني بالنص
  select ('[' || array_to_string(array_fill('null'::text, ARRAY[greatest(p_n, 0)]), ',') || ']')::jsonb;
$fn$;

revoke all on function public.jsonb_repeat_nulls(int) from public;
revoke all on function public.jsonb_repeat_nulls(int) from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) RPC — autosave_online_exam_answers: حفظ تلقائي أثناء المحاولة
--    • المحاولة جارية فقط + قبل الـ deadline (سيرفر)
--    • عدّى الموعد → lazy-expire وترجيع النتيجة (بدون خطأ — العميل يوقف الحفظ)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.autosave_online_exam_answers(
  p_token text,
  p_exam_id uuid,
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
  v_a public.online_exam_attempts%rowtype;
  v_e public.online_exams%rowtype;
  v_norm jsonb;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'invalid_token';
  end if;

  select o_student_id, o_teacher_id
    into v_student_id, v_teacher_id
  from public.online_exam_resolve_student(p_token);

  select * into v_e from public.online_exams where id = p_exam_id;
  if v_e.id is null or v_e.teacher_id <> v_teacher_id then
    raise exception 'exam_not_found';
  end if;

  select * into v_a from public.online_exam_attempts
    where exam_id = v_e.id and student_id = v_student_id;

  if v_a.id is null then
    raise exception 'no_attempt';
  end if;

  if v_a.status <> 'in_progress' then
    return jsonb_build_object('ok', false, 'closed', true, 'status', v_a.status);
  end if;

  if now() >= v_a.deadline_at then
    v_norm := public.online_exam_expire_attempt(v_a.id);
    return jsonb_build_object('ok', false, 'expired', true) || v_norm;
  end if;

  v_norm := public.online_exam_validate_answers(v_e.questions, v_a.question_order, p_answers);

  update public.online_exam_attempts
    set answers = v_norm, updated_at = now()
  where id = v_a.id;

  return jsonb_build_object('ok', true, 'saved_at', now());
end;
$fn$;

revoke all on function public.autosave_online_exam_answers(text,uuid,jsonb) from public;
grant execute on function public.autosave_online_exam_answers(text,uuid,jsonb) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) RPC — submit_online_exam: تسليم نهائي + تصحيح سيرفر-آثوريتيتف
--    • قبل الـ deadline (+10 ثواني سماح للشبكة) → التصحيح من إجابات العميل
--    • بعده → التصحيح من آخر autosave المحفوظ على السيرفر (محاولة منتهية)
--    • idempotent: محاولة منتهية مسبقًا → نفس النتيجة بدون خطأ
--    • لا يُعيد مفاتيح الإجابات — نتائج صح/خطأ فقط
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.submit_online_exam(
  p_token text,
  p_exam_id uuid,
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
  v_a public.online_exam_attempts%rowtype;
  v_e public.online_exams%rowtype;
  v_norm jsonb;
  v_grade jsonb;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'invalid_token';
  end if;

  select o_student_id, o_teacher_id
    into v_student_id, v_teacher_id
  from public.online_exam_resolve_student(p_token);

  select * into v_e from public.online_exams where id = p_exam_id;
  if v_e.id is null or v_e.teacher_id <> v_teacher_id then
    raise exception 'exam_not_found';
  end if;

  select * into v_a from public.online_exam_attempts
    where exam_id = v_e.id and student_id = v_student_id for update;

  if v_a.id is null then
    raise exception 'no_attempt';
  end if;

  -- idempotent — النتيجة نفسها من غير خطأ
  if v_a.status <> 'in_progress' then
    return jsonb_build_object(
      'done', true, 'status', v_a.status,
      'score', v_a.score, 'max_score', v_a.max_score,
      'correct_count', v_a.correct_count, 'question_count', v_a.question_count,
      'results', v_a.results, 'submitted_at', v_a.submitted_at
    );
  end if;

  if now() > v_a.deadline_at + interval '10 seconds' then
    -- انتهى الوقت — التصحيح من آخر autosave على السيرفر
    v_norm := public.online_exam_expire_attempt(v_a.id);
    return jsonb_build_object('done', true) || v_norm;
  end if;

  v_norm := public.online_exam_validate_answers(v_e.questions, v_a.question_order, p_answers);
  v_grade := public.online_exam_grade_answers(v_e.questions, v_a.question_order, v_norm);

  update public.online_exam_attempts
    set status = 'submitted',
        submitted_at = now(),
        answers = v_norm,
        score = (v_grade->>'score')::numeric,
        max_score = (v_grade->>'max_score')::numeric,
        correct_count = (v_grade->>'correct_count')::int,
        question_count = (v_grade->>'question_count')::int,
        results = v_grade->'results',
        updated_at = now()
  where id = v_a.id;

  return jsonb_build_object(
    'done', true, 'status', 'submitted',
    'score', v_grade->'score', 'max_score', v_grade->'max_score',
    'correct_count', v_grade->'correct_count', 'question_count', v_grade->'question_count',
    'results', v_grade->'results', 'submitted_at', now()
  );
end;
$fn$;

revoke all on function public.submit_online_exam(text,uuid,jsonb) from public;
grant execute on function public.submit_online_exam(text,uuid,jsonb) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) HELPER داخلي — فكّ التوكن (2-مسار مثل 056) لتفصيل التكرار
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.online_exam_resolve_student(
  p_token text,
  out o_student_id uuid,
  out o_teacher_id uuid
)
language plpgsql
security definer
set search_path to public
as $fn$
begin
  o_student_id := null; o_teacher_id := null;
  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'invalid_token';
  end if;
  select q.student_id, s.teacher_id
    into o_student_id, o_teacher_id
  from public.student_qr_tokens q
  join public.students s on s.id = q.student_id
  where q.token = p_token and q.revoked_at is null
  limit 1;
  if o_student_id is null
     and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$' then
    select s.id, s.teacher_id
      into o_student_id, o_teacher_id
    from public.students s
    where s.id = p_token::uuid
      and not exists (select 1 from public.student_qr_tokens t_rev
                      where t_rev.student_id = s.id and t_rev.revoked_at is not null)
    limit 1;
  end if;
  if o_student_id is null then
    raise exception 'invalid_token';
  end if;
end;
$fn$;

revoke all on function public.online_exam_resolve_student(text) from public;
revoke all on function public.online_exam_resolve_student(text) from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9) RPC — get_student_online_exams: قائمة بوابة الطالب
--    • لا أسئلة هنا (تُجلب فقط عند بدء المحاولة) — منع القراءة قبل التوقيت
--    • lazy-expire للمحاولات اللي عدّى موعيدها
--    • server_now لتصحيح فرق ساعة الجهاز (المؤقت عرض فقط)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.get_student_online_exams(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_student_id uuid;
  v_teacher_id uuid;
  v_student public.students%rowtype;
  v_e public.online_exams%rowtype;
  v_a public.online_exam_attempts%rowtype;
  v_arr jsonb := '[]'::jsonb;
  v_available boolean;
begin
  select o_student_id, o_teacher_id
    into v_student_id, v_teacher_id
  from public.online_exam_resolve_student(p_token);
  select * into v_student from public.students where id = v_student_id;

  -- lazy-expire: أي محاولة جارية عدّى موعدها تتصحّح من آخر autosave
  perform public.online_exam_expire_attempt(a.id)
  from public.online_exam_attempts a
  where a.student_id = v_student_id
    and a.status = 'in_progress'
    and now() >= a.deadline_at;

  for v_e in
    select e.* from public.online_exams e
    where e.teacher_id = v_teacher_id
      and (e.group_name is null or e.group_name = v_student.group_name)
      and (e.status = 'open' or exists (
            select 1 from public.online_exam_attempts a
            where a.exam_id = e.id and a.student_id = v_student_id))
    order by e.created_at desc
  loop
    select * into v_a from public.online_exam_attempts
      where exam_id = v_e.id and student_id = v_student_id;

    v_available := (
      v_e.status = 'open'
      and (v_e.opens_at is null or now() >= v_e.opens_at)
      and (v_e.closes_at is null or now() < v_e.closes_at)
      and (v_a.id is null or v_a.status = 'in_progress')
    );

    v_arr := v_arr || jsonb_build_object(
      'id', v_e.id,
      'title', v_e.title,
      'instructions', v_e.instructions,
      'status', v_e.status,
      'group_name', v_e.group_name,
      'duration_minutes', v_e.duration_minutes,
      'max_score', v_e.max_score,
      'question_count', v_e.question_count,
      'opens_at', v_e.opens_at,
      'closes_at', v_e.closes_at,
      'available', v_available,
      'my', case
        when v_a.id is null then null
        else jsonb_build_object(
          'status', v_a.status,
          'started_at', v_a.started_at,
          'deadline_at', v_a.deadline_at,
          'submitted_at', v_a.submitted_at,
          'score', v_a.score,
          'max_score', v_a.max_score,
          'correct_count', v_a.correct_count,
          'question_count', v_a.question_count
        )
      end
    );
  end loop;

  return jsonb_build_object('server_now', now(), 'exams', v_arr);
end;
$fn$;

revoke all on function public.get_student_online_exams(text) from public;
grant execute on function public.get_student_online_exams(text) to anon, authenticated, service_role;

comment on table public.online_exams is
  '057: الامتحانات الأونلاين — أسئلة MCQ + مؤقت سيرفر-آثوريتيتف لكل محاولة (deadline عند البدء) + نافذة فتح/إغلاق اختيارية. الأسئلة نفس شكل واجبات 056. التعديل على الأسئلة ممنوع أثناء محاولات جارية.';
comment on table public.online_exam_attempts is
  '057: محاولة واحدة لكل (امتحان، طالب) — deadline سيرفر، autosave، تصحيح تلقائي، lazy-expire من آخر autosave. حذف الصف = إعادة تعيين المحاولة للطالب.';
