-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 056 — EXAMS & HOMEWORK DEEP (Task 44 phase B)
-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1 — STANDALONE EXAMS UPGRADE (الامتحانات المنفصلة):
--   1A) concurrency versioning: version bigint + auto-bump triggers
--   1B) sections support: standalone_exams.sections jsonb [{name,max}]
--       + standalone_exam_scores.section_scores jsonb [number|null,...]
--       partial-section percentage semantics: النسبة تُحسب على الأقسام
--       اللي الطالب امتحن فيها فقط (المدخل الفارغ = قسم لم يُمتحن فيه)
--   1C) audit trail: standalone_exam_audit_logs (append-only) + triggers
--       تسجل كل تغيير (من/إمتى/القديم/الجديد) — قراءة لمساحة العمل فقط
--   1D) RPC save_standalone_score (sections-aware + version checks)
--   1E) RPC update_standalone_exam (version-checked meta patch)
--   1F) RPC ungrade_standalone_student (إلغاء درجة طالب مع تسبيق التدقيق)
--   1G) portal get_student_standalone_exams — نسخة أقسام + نسبة جزئية
--       (مع الحفاظ الكامل على بوابة النشر 055 وإبطال التوكن الاحتياطي)
-- PART 2 — HOMEWORK MCQ (الواجبات باختيار الإجابة):
--   2A) homework_tasks: description/questions/status/max_score/version/updated_at
--       + سياسات SELECT الناقصة للمدرس
--   2B) homework_submissions table + RLS
--   2C) RPC submit_homework_task_answers — تصحيح سيرفر-آثوريتيتف
--   2D) get_student_portal_data — إسقاط آمن للواجبات (بدون مفاتيح الإجابة!)
--       + واجبات «كل المجموعات» (group_name is null) + ملخص تسليم الطالب
-- كل التغييرات إضافية/آمنة للتكرار. لا حذف ولا تعديل بيانات قائمة.
-- ═══════════════════════════════════════════════════════════════════════════

set check_function_bodies = false;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1A) CONCURRENCY VERSIONING
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.standalone_exams
  add column if not exists version bigint not null default 1;
alter table public.standalone_exam_scores
  add column if not exists version bigint not null default 1;

create or replace function public.standalone_version_bump()
returns trigger language plpgsql
set search_path to public
as $fn$
begin
  new.version := old.version + 1;
  return new;
end;
$fn$;

drop trigger if exists trg_standalone_exams_version on public.standalone_exams;
create trigger trg_standalone_exams_version
  before update on public.standalone_exams
  for each row execute function public.standalone_version_bump();

drop trigger if exists trg_standalone_scores_version on public.standalone_exam_scores;
create trigger trg_standalone_scores_version
  before update on public.standalone_exam_scores
  for each row execute function public.standalone_version_bump();

-- ═══════════════════════════════════════════════════════════════════════════
-- 1B) SECTIONS + PARTIAL-PERCENTAGE SEMANTICS
--     sections = []  → الوضع القديم (max_score واحد، score واحد) — بدون أي تغيير
--     sections جdoby → [{name, max}] و max_score = مجموع أقصيات الأقسام
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.standalone_exams
  add column if not exists sections jsonb not null default '[]'::jsonb;
alter table public.standalone_exam_scores
  add column if not exists section_scores jsonb;

-- حارس الأقسام: طول المصفوفة = عدد الأقسام، كل قيمة null أو بين 0 وأقصى القسم،
-- والدرجة الكلية (score) تُزامن = مجموع القيم المُدخلة (الفارغ لا يُحتسب).
create or replace function public.standalone_sections_guard()
returns trigger language plpgsql
set search_path to public
as $fn$
declare
  v_sections jsonb;
  v_len int;
  v_i int;
  v_max numeric;
  v_total numeric := 0;
  v_any boolean := false;
begin
  if new.section_scores is null then
    return new; -- الوضع القديم — لا شيء يُفعل
  end if;
  if jsonb_typeof(new.section_scores) <> 'array' then
    raise exception 'section_scores_must_be_array';
  end if;
  select sections into v_sections from public.standalone_exams where id = new.exam_id;
  v_len := coalesce(jsonb_array_length(v_sections), 0);
  if v_len = 0 then
    -- الامتحان بدون أقسام: صفر القيم القديمة إن وُجدت
    new.section_scores := null;
    return new;
  end if;
  if jsonb_array_length(new.section_scores) <> v_len then
    raise exception 'section_scores_length_mismatch';
  end if;
  for v_i in 0 .. v_len - 1 loop
    v_max := coalesce((v_sections->v_i->>'max')::numeric, 0);
    if new.section_scores->v_i = 'null'::jsonb then
      continue;
    end if;
    begin
      if (new.section_scores->>v_i)::numeric < 0
         or (new.section_scores->>v_i)::numeric > v_max then
        raise exception 'section_score_out_of_range';
      end if;
    exception when invalid_text_representation then
      raise exception 'section_score_must_be_number';
    end;
    v_total := v_total + (new.section_scores->>v_i)::numeric;
    v_any := true;
  end loop;
  if not v_any then
    raise exception 'empty_section_scores';
  end if;
  new.score := v_total;
  return new;
end;
$fn$;

drop trigger if exists trg_standalone_scores_sections on public.standalone_exam_scores;
create trigger trg_standalone_scores_sections
  before insert or update of section_scores, score on public.standalone_exam_scores
  for each row execute function public.standalone_sections_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 1C) AUDIT TRAIL — append-only، الكتابة عبر التريجرات/الدوال فقط
-- ═══════════════════════════════════════════════════════════════════════════
-- ملاحظة: بلا مفاتيح أجنبية على exam_id/student_id/teacher_id — سجل تاريخي
-- append-only لا يجوز أن يعيق حذف الامتحان/الطالب (cascade) أو يسجل أثناءه.
create table if not exists public.standalone_exam_audit_logs (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null,
  actor_id uuid,
  change_type text not null check (change_type in
    ('student_score','ungrade','status','max_score','sections','scale','meta')),
  exam_id uuid not null,
  student_id uuid,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  exam_version bigint,
  created_at timestamptz not null default now()
);
-- لو النسخ السابقة أنشأت الجدول بمفاتيح أجنبية — تُزال (idempotent)
do $$ declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.standalone_exam_audit_logs'::regclass
             and contype = 'f' and conname <> 'standalone_exam_audit_logs_change_type_check'
  loop
    execute format('alter table public.standalone_exam_audit_logs drop constraint %I', c);
  end loop;
end $$;

create index if not exists idx_standalone_audit_exam
  on public.standalone_exam_audit_logs (exam_id, created_at desc);
create index if not exists idx_standalone_audit_teacher
  on public.standalone_exam_audit_logs (teacher_id, created_at desc);

alter table public.standalone_exam_audit_logs enable row level security;

drop policy if exists "standalone_audit_workspace_read" on public.standalone_exam_audit_logs;
create policy "standalone_audit_workspace_read" on public.standalone_exam_audit_logs
  for select to authenticated
  using (public.can_access_workspace(teacher_id));
-- لا سياسات كتابة: الكتابة من التريجرات/الدوال security definer فقط

-- تدقيق الدرجات: إدراج/تعديل = student_score، حذف = ungrade (بسبب اختياري)
create or replace function public.standalone_scores_audit()
returns trigger language plpgsql
set search_path to public
as $fn$
declare
  v_reason text := nullif(btrim(coalesce(current_setting('nokhba.audit_reason', true), '')), '');
  v_exam_id uuid;
begin
  v_exam_id := case when tg_op = 'DELETE' then old.exam_id else new.exam_id end;
  -- الامتحان بحالة حذف (cascade) → لا سجل تدقيق جديد (صف يتيم بعد حذف أبيه)
  if v_exam_id is null or not exists
     (select 1 from public.standalone_exams where id = v_exam_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    insert into public.standalone_exam_audit_logs
      (teacher_id, actor_id, change_type, exam_id, student_id, previous_value, new_value, reason, exam_version)
    values
      (old.teacher_id, auth.uid(), 'ungrade', old.exam_id, old.student_id,
       jsonb_build_object('score', old.score, 'section_scores', old.section_scores, 'version', old.version),
       null, v_reason,
       (select version from public.standalone_exams where id = old.exam_id));
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.score is not distinct from new.score
     and old.section_scores is not distinct from new.section_scores then
    return new; -- لا تغيير فعلي في الدرجة
  end if;

  insert into public.standalone_exam_audit_logs
    (teacher_id, actor_id, change_type, exam_id, student_id, previous_value, new_value, reason, exam_version)
  values
    (new.teacher_id, auth.uid(), 'student_score', new.exam_id, new.student_id,
     case when tg_op = 'UPDATE'
          then jsonb_build_object('score', old.score, 'section_scores', old.section_scores, 'version', old.version)
          else null end,
     jsonb_build_object('score', new.score, 'section_scores', new.section_scores, 'version', new.version),
     v_reason,
     (select version from public.standalone_exams where id = new.exam_id));
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists trg_standalone_scores_audit on public.standalone_exam_scores;
create trigger trg_standalone_scores_audit
  after insert or update or delete on public.standalone_exam_scores
  for each row execute function public.standalone_scores_audit();

create or replace function public.standalone_exams_purge_audit()
returns trigger language plpgsql
set search_path to public
as $fn$
begin
  delete from public.standalone_exam_audit_logs where exam_id = old.id;
  return old;
end;
$fn$;

drop trigger if exists trg_standalone_exams_purge_audit on public.standalone_exams;
create trigger trg_standalone_exams_purge_audit
  before delete on public.standalone_exams
  for each row execute function public.standalone_exams_purge_audit();

-- تدقيق بيانات الامتحان: status/max/sections/scale/meta
create or replace function public.standalone_exams_audit()
returns trigger language plpgsql
set search_path to public
as $fn$
declare
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_type text;
begin
  if old.title     is distinct from new.title then
    v_old := v_old || jsonb_build_object('title', old.title);
    v_new := v_new || jsonb_build_object('title', new.title);
  end if;
  if old.exam_date is distinct from new.exam_date then
    v_old := v_old || jsonb_build_object('exam_date', old.exam_date);
    v_new := v_new || jsonb_build_object('exam_date', new.exam_date);
  end if;
  if old.group_name is distinct from new.group_name then
    v_old := v_old || jsonb_build_object('group_name', old.group_name);
    v_new := v_new || jsonb_build_object('group_name', new.group_name);
  end if;
  if old.grade_scale is distinct from new.grade_scale then
    v_old := v_old || jsonb_build_object('grade_scale', old.grade_scale);
    v_new := v_new || jsonb_build_object('grade_scale', new.grade_scale);
  end if;
  if old.max_score is distinct from new.max_score then
    v_old := v_old || jsonb_build_object('max_score', old.max_score);
    v_new := v_new || jsonb_build_object('max_score', new.max_score);
  end if;
  if old.sections  is distinct from new.sections then
    v_old := v_old || jsonb_build_object('sections', old.sections);
    v_new := v_new || jsonb_build_object('sections', new.sections);
  end if;
  if old.status    is distinct from new.status then
    v_old := v_old || jsonb_build_object('status', old.status);
    v_new := v_new || jsonb_build_object('status', new.status);
  end if;

  if v_new = '{}'::jsonb then
    return new; -- لا تغيير على الحقول المتتبعة
  end if;

  v_type := case
    when v_new ? 'status'     then 'status'
    when v_new ? 'max_score'  then 'max_score'
    when v_new ? 'sections'   then 'sections'
    when v_new ? 'grade_scale' then 'scale'
    else 'meta' end;

  insert into public.standalone_exam_audit_logs
    (teacher_id, actor_id, change_type, exam_id, student_id, previous_value, new_value, exam_version)
  values
    (new.teacher_id, auth.uid(), v_type, new.id, null, v_old, v_new, new.version);
  return new;
end;
$fn$;

drop trigger if exists trg_standalone_exams_audit on public.standalone_exams;
create trigger trg_standalone_exams_audit
  after update on public.standalone_exams
  for each row execute function public.standalone_exams_audit();

-- ═══════════════════════════════════════════════════════════════════════════
-- 1D) RPC save_standalone_score — رصد/تعديل درجة (أقسام أو قديم) + تزامن
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.save_standalone_score(
  p_exam_id uuid,
  p_student_id uuid,
  p_score numeric default null,
  p_section_scores jsonb default null,
  p_expected_score_version bigint default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_exam public.standalone_exams%rowtype;
  v_student_teacher uuid;
  v_existing public.standalone_exam_scores%rowtype;
  v_row public.standalone_exam_scores%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_exam from public.standalone_exams where id = p_exam_id for update;
  if v_exam.id is null then
    raise exception 'exam_not_found';
  end if;
  if not public.can_access_workspace(v_exam.teacher_id) then
    raise exception 'not_authorized';
  end if;

  -- الطالب يجب أن يكون في نفس مساحة العمل (نفس حارس S7)
  select teacher_id into v_student_teacher
  from public.students where id = p_student_id;
  if v_student_teacher is null or v_student_teacher <> v_exam.teacher_id then
    raise exception 'student_not_in_workspace';
  end if;

  if v_exam.status <> 'open' then
    raise exception 'exam_closed';
  end if;

  select * into v_existing from public.standalone_exam_scores
  where exam_id = p_exam_id and student_id = p_student_id for update;

  if v_existing.id is not null
     and p_expected_score_version is not null
     and v_existing.version <> p_expected_score_version then
    raise exception 'version_conflict';
  end if;

  if coalesce(jsonb_array_length(v_exam.sections), 0) > 0 then
    -- وضع الأقسام: p_section_scores إجبارية (تحقق مسبق — التريجر يعيد الفحص)
    if p_section_scores is null or jsonb_typeof(p_section_scores) <> 'array' then
      raise exception 'section_scores_required';
    end if;
    declare
      v_len int := jsonb_array_length(v_exam.sections);
      v_i int;
      v_max numeric;
      v_total numeric := 0;
      v_any boolean := false;
    begin
      if jsonb_array_length(p_section_scores) <> v_len then
        raise exception 'section_scores_length_mismatch';
      end if;
      for v_i in 0 .. v_len - 1 loop
        if p_section_scores->v_i = 'null'::jsonb then continue; end if;
        v_max := coalesce((v_exam.sections->v_i->>'max')::numeric, 0);
        if (p_section_scores->>v_i)::numeric < 0
           or (p_section_scores->>v_i)::numeric > v_max then
          raise exception 'section_score_out_of_range';
        end if;
        v_total := v_total + (p_section_scores->>v_i)::numeric;
        v_any := true;
      end loop;
      if not v_any then
        raise exception 'empty_section_scores';
      end if;
    end;
  else
    -- الوضع القديم: درجة كلية واحدة
    if p_score is null or p_score < 0 or p_score > v_exam.max_score then
      raise exception 'invalid_score';
    end if;
  end if;

  insert into public.standalone_exam_scores as s
    (teacher_id, exam_id, student_id, score, section_scores)
  values
    (v_exam.teacher_id, p_exam_id, p_student_id,
     coalesce(p_score, 0),
     case when coalesce(jsonb_array_length(v_exam.sections), 0) > 0 then p_section_scores else null end)
  on conflict (exam_id, student_id) do update
    set score = excluded.score,
        section_scores = excluded.section_scores,
        updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'exam_id', v_row.exam_id, 'student_id', v_row.student_id,
    'score', v_row.score, 'section_scores', v_row.section_scores,
    'version', v_row.version, 'updated_at', v_row.updated_at
  );
end;
$fn$;

revoke all on function public.save_standalone_score(uuid,uuid,numeric,jsonb,bigint,text) from public, anon;
grant execute on function public.save_standalone_score(uuid,uuid,numeric,jsonb,bigint,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1E) RPC update_standalone_exam — تعديل بيانات محمي بالتزامن + تدقيق
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.update_standalone_exam(
  p_exam_id uuid,
  p_expected_version bigint,
  p_patch jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_exam public.standalone_exams%rowtype;
  v_row public.standalone_exams%rowtype;
  v_s jsonb;
  v_sum numeric := 0;
  v_i int;
  v_score public.standalone_exam_scores%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_exam from public.standalone_exams where id = p_exam_id for update;
  if v_exam.id is null then
    raise exception 'exam_not_found';
  end if;
  if not public.can_access_workspace(v_exam.teacher_id) then
    raise exception 'not_authorized';
  end if;
  if p_expected_version is not null and v_exam.version <> p_expected_version then
    raise exception 'version_conflict';
  end if;

  -- ── بناء الصف الجديد من الباتش المسموح فقط ──
  v_row := v_exam;
  if p_patch ? 'title' then
    if coalesce(btrim(p_patch->>'title'), '') = '' or length(p_patch->>'title') > 200 then
      raise exception 'invalid_title';
    end if;
    v_row.title := p_patch->>'title';
  end if;
  if p_patch ? 'exam_date' then
    begin
      v_row.exam_date := (p_patch->>'exam_date')::date;
    exception when others then raise exception 'invalid_exam_date'; end;
  end if;
  if p_patch ? 'group_name' then
    v_row.group_name := nullif(btrim(coalesce(p_patch->>'group_name', '')), '');
  end if;
  if p_patch ? 'status' then
    if p_patch->>'status' not in ('open','completed') then
      raise exception 'invalid_status';
    end if;
    v_row.status := p_patch->>'status';
  end if;
  if p_patch ? 'grade_scale' then
    if jsonb_typeof(p_patch->'grade_scale') <> 'array' then
      raise exception 'invalid_grade_scale';
    end if;
    v_row.grade_scale := p_patch->'grade_scale';
  end if;

  -- ── الأقسام: [{name, max}] — مجموع الأقصيات يصبح الدرجة النهائية ──
  if p_patch ? 'sections' then
    if jsonb_typeof(p_patch->'sections') <> 'array'
       or jsonb_array_length(p_patch->'sections') > 30 then
      raise exception 'invalid_sections';
    end if;
    if jsonb_array_length(p_patch->'sections') > 0 then
      v_sum := 0;
      for v_i in 0 .. jsonb_array_length(p_patch->'sections') - 1 loop
        v_s := p_patch->'sections'->v_i;
        if coalesce(btrim(coalesce(v_s->>'name', '')), '') = ''
           or coalesce((v_s->>'max')::numeric, 0) <= 0 then
          raise exception 'invalid_section_row';
        end if;
        v_sum := v_sum + (v_s->>'max')::numeric;
      end loop;
      v_row.sections := p_patch->'sections';
      v_row.max_score := v_sum;
      -- الأقسام الجديدة يجب أن تستوعب الدرجات المسجلة فعليًا
      for v_score in
        select * from public.standalone_exam_scores
        where exam_id = p_exam_id and section_scores is not null
      loop
        for v_i in 0 .. least(jsonb_array_length(v_row.sections), jsonb_array_length(v_score.section_scores)) - 1 loop
          if v_score.section_scores->v_i <> 'null'::jsonb
             and (v_score.section_scores->>v_i)::numeric
                 > coalesce((v_row.sections->v_i->>'max')::numeric, 0) then
            raise exception 'section_max_below_scores';
          end if;
        end loop;
      end loop;
    else
      -- الرجوع للوضع القديم (بدون أقسام)
      v_row.sections := '[]'::jsonb;
      if p_patch ? 'max_score' then
        if coalesce((p_patch->>'max_score')::numeric, 0) <= 0 then
          raise exception 'invalid_max_score';
        end if;
        v_row.max_score := (p_patch->>'max_score')::numeric;
      end if;
    end if;
  elsif p_patch ? 'max_score' then
    if coalesce((p_patch->>'max_score')::numeric, 0) <= 0 then
      raise exception 'invalid_max_score';
    end if;
    v_row.max_score := (p_patch->>'max_score')::numeric;
  end if;

  update public.standalone_exams set
    title = v_row.title,
    exam_date = v_row.exam_date,
    group_name = v_row.group_name,
    max_score = v_row.max_score,
    grade_scale = v_row.grade_scale,
    sections = v_row.sections,
    status = v_row.status,
    updated_at = now()
  where id = p_exam_id
  returning * into v_row;

  return jsonb_build_object('exam', to_jsonb(v_row), 'version', v_row.version);
end;
$fn$;

revoke all on function public.update_standalone_exam(uuid,bigint,jsonb,text) from public, anon;
grant execute on function public.update_standalone_exam(uuid,bigint,jsonb,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1F) RPC ungrade_standalone_student — إلغاء درجة طالب (مع تدقيق + سبب)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.ungrade_standalone_student(
  p_exam_id uuid,
  p_student_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_teacher_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select teacher_id into v_teacher_id from public.standalone_exams where id = p_exam_id;
  if v_teacher_id is null then
    raise exception 'exam_not_found';
  end if;
  if not public.can_access_workspace(v_teacher_id) then
    raise exception 'not_authorized';
  end if;

  -- السبب يصل لتريجر التدقيق عبر إعداد محلي للمعاملة
  perform set_config('nokhba.audit_reason', coalesce(btrim(coalesce(p_reason, '')), 'إلغاء درجة'), true);

  delete from public.standalone_exam_scores
  where exam_id = p_exam_id and student_id = p_student_id;
  return true;
end;
$fn$;

revoke all on function public.ungrade_standalone_student(uuid,uuid,text) from public, anon;
grant execute on function public.ungrade_standalone_student(uuid,uuid,text) to authenticated;

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

-- group_name كان NOT NULL في الجدول الأصلي — null = «كل المجموعات»
alter table public.homework_tasks alter column group_name drop not null;

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
      ) order by ord)
      from jsonb_array_elements(ht.questions) with ordinality as t(q, ord)
    ), '[]'::jsonb) end,
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
        else (select coalesce(sum(coalesce((e.sections->((idx-1)::int)->>'max')::numeric, 0)), 0)
              from jsonb_array_elements_text(
                case when jsonb_typeof(es.section_scores) = 'array' then es.section_scores else '[]'::jsonb end)
                with ordinality as t(v, idx)
              where v is not null) end,
      'percentage', case
        when coalesce(jsonb_array_length(e.sections), 0) = 0 then
          case when e.max_score > 0 then round(es.score / e.max_score * 100, 1) else 0 end
        else (
          select case when coalesce(sum(coalesce((e.sections->((idx-1)::int)->>'max')::numeric, 0)), 0) > 0
                      then round(es.score
                           / sum(coalesce((e.sections->((idx-1)::int)->>'max')::numeric, 0)) * 100, 1)
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
                   select case when sum(coalesce((e.sections->((idx-1)::int)->>'max')::numeric, 0)) > 0 then
                              es.score / sum(coalesce((e.sections->((idx-1)::int)->>'max')::numeric, 0)) * 100
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
