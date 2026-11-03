-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 062b — إصلاح مصدر تصنيف المرحلة في get_student_stage_schedule
-- ═══════════════════════════════════════════════════════════════════════════
-- المشكلة في 062: المطابقة كانت مشروطة بموجود المجموعات في جدول groups —
-- على الإنتاج جدول groups فاضي (0 صفوف) وبيانات المرحلة موجودة على
-- students.stage لكل طالب، فكان الـ RPC بيرجّع جدول فاضي دايمًا.
--
-- الحل: تصنيف المجموعة يُشتق من مرحلة طلابها الفعليين (students.group_name
-- + students.stage) — نفس دلالات الفرونت: تصنيف المرحلة (ابتدائي/إعدادي/ثانوي)
-- مش مساواة نصية. مجموعة فيها أي طالب من مرحلة الطالب تظهر؛ مجموعته هو
-- تظهر حتمًا لأنه نفسه من طلابها.
--
-- نفس شكل الاستجابة بالظبط: { stage, category, schedule:[{group_name, weekday}] }
-- مفيش توكنات بتتغير، مفيش QR، مفيش RLS. idempotent — آمن للتكرار.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_student_stage_schedule(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_teacher_id uuid;
  v_own_group text;
  v_student_stage text;
  v_category text;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return null;
  end if;

  -- توكن البوابة → الطالب (نفس مسار 019/037/052)
  select q.student_id, s.teacher_id, s.group_name, s.stage
    into v_student_id, v_teacher_id, v_own_group, v_student_stage
  from public.student_qr_tokens q
  join public.students s on s.id = q.student_id
  where q.token = p_token and q.revoked_at is null
  limit 1;

  -- احتياط: روابط QR القديمة اللي كانت بتستخدم UUID الطالب نفسه كتوكن
  if v_student_id is null
     and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$' then
    select s.id, s.teacher_id, s.group_name, s.stage
      into v_student_id, v_teacher_id, v_own_group, v_student_stage
    from public.students s
    where s.id = p_token::uuid
    limit 1;
  end if;

  if v_student_id is null then
    return null;
  end if;

  -- مرحلة الطالب: stage بتاعه أولاً — لو فاضي نرجع لـ stage طلاب مجموعته
  if coalesce(btrim(coalesce(v_student_stage, '')), '') = '' then
    select coalesce(max(s2.stage), '') into v_student_stage
    from public.students s2
    where s2.teacher_id = v_teacher_id
      and s2.group_name = v_own_group
      and coalesce(btrim(coalesce(s2.stage, '')), '') <> ''
    limit 1;
  end if;

  v_category := coalesce(public.stage_category_of(v_student_stage), '');
  if v_category = '' then
    -- مرحلة مش معروفة → جدول فاضي (البوابة تخبّي القسم خالص)
    return jsonb_build_object('stage', '', 'category', '', 'schedule', '[]'::jsonb);
  end if;

  -- الجدول الأسبوعي لكل مجموعات المستر اللي عندها طلاب من نفس تصنيف المرحلة.
  -- تصنيف المجموعة من مرحلة طلابها الفعليين (الإنتاج: groups فاضي — students هو المرجع).
  return jsonb_build_object(
    'stage', coalesce(v_student_stage, ''),
    'category', v_category,
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_name', gs.group_name,
        'weekday', gs.weekday
      ) order by gs.weekday asc, gs.group_name asc)
      from public.group_schedule gs
      where gs.teacher_id = v_teacher_id
        and exists (
          select 1 from public.students s2
          where s2.teacher_id = v_teacher_id
            and s2.group_name = gs.group_name
            and coalesce(public.stage_category_of(s2.stage), '') = v_category
        )
    ), '[]'::jsonb)
  );
end;
$$;

-- صلاحيات التنفيذ: anon (بوابة الطالب من غير تسجيل دخول) + authenticated
revoke all on function public.get_student_stage_schedule(text) from public;
revoke all on function public.get_student_stage_schedule(text) from anon;
revoke all on function public.get_student_stage_schedule(text) from authenticated;
grant execute on function public.get_student_stage_schedule(text) to anon;
grant execute on function public.get_student_stage_schedule(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- فحص ذاتي
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_student_stage_schedule'
  ) then
    raise exception 'Migration 062b FAILED: get_student_stage_schedule missing';
  end if;
  raise notice 'Migration 062b applied: schedule derived from students.stage (production data model)';
end $$;
