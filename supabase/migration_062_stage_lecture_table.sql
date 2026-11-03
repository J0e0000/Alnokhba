-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 062 — جدول محاضرات المرحلة في بوابة الطالب (Portal stage schedule)
-- ═══════════════════════════════════════════════════════════════════════════
-- الطالب في البوابة يشوف جدول بكل محاضرات المستر اللي مرحلتها = مرحلته هو:
-- طالب «الأول الثانوي» → كل مجموعات المستر اللي stage بتاعها ثانوي، بالأيام.
--
--   • RPC جديد منفصل get_student_stage_schedule(p_token) — نمط 052 بالظبط:
--     بدون لمس get_student_portal_data القائمة إطلاقًا (صفر ريجريشن).
--   • المطابقة بتصنيف المرحلة (ابتدائي/إعدادي/ثانوي) — نفس منطق
--     stageCategoryOf/isStageCompatible في الفرونت بالظبط: مش مساواة
--     نصية، عشان البيانات القديمة («الأول الثانوي» / «ثانوي» / نص حر).
--   • security definer + توكن إجباري (نفس مسار 019/037/052): بيرجّع أسماء
--     المجموعات وأيامها لمرحلة الطالب ده بس — مفيش أي بيانات تانية.
--   • مفيش توكنات بتتغير، مفيش روابط QR بتتعدل، مفيش RLS policy بتتلمس.
--
-- التشغيل: Supabase → SQL Editor → لصق الملف كامل → Run (idempotent — آمن للتكرار)
-- ═══════════════════════════════════════════════════════════════════════════

-- ----------------------------------------------------------------------------
-- 1) تصنيف المرحلة — نفس stageCategoryOf في الفرونت (lib/helpers.js) بالظبط
--    يحوّل أي قيمة مخزنة («الأول الثانوي»، «ثانوي»، «اعدادي» بغير همزة، نص حر)
--    لتصنيفها: ابتدائي | إعدادي | ثانوي | '' (مش معروف)
-- ----------------------------------------------------------------------------
create or replace function public.stage_category_of(p_stage text)
returns text
language sql
immutable
as $$
  select case
    when p_stage is null or btrim(p_stage) = '' then ''
    when position('ابتدائي' in p_stage) > 0 then 'ابتدائي'
    when position('إعدادي' in p_stage) > 0 or position('اعدادي' in p_stage) > 0 then 'إعدادي'
    when position('ثانوي' in p_stage) > 0 then 'ثانوي'
    else ''
  end
$$;

-- ----------------------------------------------------------------------------
-- 2) RPC البوابة: الجدول الأسبوعي الكامل لمرحلة الطالب
--    بيرجّع: { stage: «نص مرحلة الطالب», category: «تصنيفها», schedule:
--    [ { group_name, weekday } ... ] } — weekday 0=الأحد .. 6=السبت
--    (نفس ترقيم group_schedule وترقيم getDay() في جافاسكريبت)
-- ----------------------------------------------------------------------------
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

  -- توكن البوابة → الطالب (نفس مسار 019/037/052 بالظبط)
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

  -- مرحلة الطالب: stage بتاعه أولاً — لو فاضي نرجع لـ stage مجموعته
  -- (نفس «المجموعة هي المرجع» في StudentModal — الجروب authoritative)
  if coalesce(btrim(coalesce(v_student_stage, '')), '') = '' then
    select g.stage into v_student_stage
    from public.groups g
    where g.teacher_id = v_teacher_id and g.name = v_own_group
    limit 1;
  end if;

  v_category := coalesce(public.stage_category_of(v_student_stage), '');
  if v_category = '' then
    -- مرحلة مش معروفة → جدول فاضي (البوابة تخبّي القسم خالص)
    return jsonb_build_object('stage', '', 'category', '', 'schedule', '[]'::jsonb);
  end if;

  -- الجدول الأسبوعي لكل مجموعات المستر اللي تصنيف مرحلتها = تصنيف مرحلة الطالب
  -- (المجموعة لازم تكون موجودة في groups فعليًا — صفوف الجدول اليتيمة تتجاهل)
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
        and gs.group_name in (
          select g.name from public.groups g
          where g.teacher_id = v_teacher_id
            and coalesce(public.stage_category_of(g.stage), '') = v_category
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
-- فحص ذاتي بعد التشغيل
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_student_stage_schedule'
  ) then
    raise exception 'Migration 062 FAILED: get_student_stage_schedule not created';
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'stage_category_of'
  ) then
    raise exception 'Migration 062 FAILED: stage_category_of not created';
  end if;
  raise notice 'Migration 062 applied: stage_category_of(text) + get_student_stage_schedule(text) — anon+authenticated';
end $$;
