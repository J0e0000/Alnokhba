-- ═══════════════════════════════════════════════════════════════════════════
-- migration_065 — Task 65
-- 1) lesson_sessions.extra_dates date[]: معاد إضافي للحصة الواحدة (نفس الدرس
--    بيتلقى في أكثر من موعد) — الحصة تظهر في المعاد الأساسي وكل المواعيد
--    الإضافية، والحضور والدرجات مشتركة (صف واحد لكل طالب × حصة).
-- 2) merge_groups(): دمج مجموعتين ذريًا — حصص/واجبات/امتحانات/طلاب المصدر
--    تنتقل للمجموعة الهدف، ومواعيد المصدر تُنقل (أو تُحذف لو للهدف مواعيد)،
--    وextra_groups تُنظّف — كل ذلك داخل معاملة واحدة، بلا حالات نصف مدموجة.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.lesson_sessions
  add column if not exists extra_dates date[] not null default '{}';

grant select, insert, update, delete on public.lesson_sessions to authenticated;

comment on column public.lesson_sessions.extra_dates is
  'معادون إضافيون للحصة الواحدة (نفس الدرس يُلقى في أكثر من موعد) — 065';

create or replace function public.merge_groups(
  p_teacher_id uuid,
  p_source text,
  p_target text,
  p_stage text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions int; v_hw int; v_sa int; v_oe int; v_students int; v_extras int; v_sched text;
begin
  if auth.uid() is null then
    raise exception 'لازم تسجّل دخول الأول عشان تدمج المجموعات' using errcode = 'P0001';
  end if;
  if not public.can_access_workspace(p_teacher_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_source is null or p_target is null or btrim(p_source) = '' or btrim(p_target) = ''
     or p_source = p_target then
    raise exception 'merge_groups: source and target must be two different non-empty group names'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.lesson_sessions where teacher_id = p_teacher_id and group_name = p_source limit 1)
     and not exists (select 1 from public.students where teacher_id = p_teacher_id and group_name = p_source limit 1)
     and not exists (select 1 from public.group_schedule where teacher_id = p_teacher_id and group_name = p_source limit 1) then
    raise exception 'merge_groups: source group has no data' using errcode = 'P0001';
  end if;

  -- 1) الحصص — الحضور والدرجات تتبعها تلقائيًا (بالـ lesson_session_id)
  update public.lesson_sessions set group_name = p_target, updated_at = now()
    where teacher_id = p_teacher_id and group_name = p_source;
  get diagnostics v_sessions = row_count;

  -- 2) الواجبات التفاعلية
  update public.homework_tasks set group_name = p_target, updated_at = now()
    where teacher_id = p_teacher_id and group_name = p_source;
  get diagnostics v_hw = row_count;

  -- 3) الامتحانات المنفصلة + الأونلاين
  update public.standalone_exams set group_name = p_target, updated_at = now()
    where teacher_id = p_teacher_id and group_name = p_source;
  get diagnostics v_sa = row_count;

  update public.online_exams set group_name = p_target, updated_at = now()
    where teacher_id = p_teacher_id and group_name = p_source;
  get diagnostics v_oe = row_count;

  -- 4) الطلاب الأساسيون في المصدر — مرحلتهم تتوافق مع مرحلة المجموعة الهدف
  update public.students set group_name = p_target,
       stage = coalesce(nullif(btrim(p_stage), ''), stage), updated_at = now()
    where teacher_id = p_teacher_id and group_name = p_source;
  get diagnostics v_students = row_count;

  -- 5) المجموعات الإضافية: المصدر يختفي ويحل محله الهدف بلا تكرار
  update public.students set
       extra_groups = case
         when group_name = p_target then array_remove(extra_groups, p_source)
         when p_target = any(extra_groups) then array_remove(extra_groups, p_source)
         else array_replace(extra_groups, p_source, p_target)
       end,
       updated_at = now()
    where teacher_id = p_teacher_id and p_source = any(extra_groups);
  get diagnostics v_extras = row_count;

  -- 6) المواعيد الأسبوعية: للهدف مواعيد؟ مواعيد المصدر تُحذف — وإلا تُنقل له
  if exists (select 1 from public.group_schedule where teacher_id = p_teacher_id and group_name = p_target) then
    delete from public.group_schedule where teacher_id = p_teacher_id and group_name = p_source;
    v_sched := 'deleted';
  else
    update public.group_schedule set group_name = p_target
      where teacher_id = p_teacher_id and group_name = p_source;
    v_sched := 'moved';
  end if;

  return jsonb_build_object(
    'sessions', v_sessions, 'homework', v_hw, 'standalone_exams', v_sa,
    'online_exams', v_oe, 'students', v_students, 'extra_rows', v_extras, 'schedule', v_sched);
end;
$$;

revoke all on function public.merge_groups(uuid, text, text, text) from public, anon;
grant execute on function public.merge_groups(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
