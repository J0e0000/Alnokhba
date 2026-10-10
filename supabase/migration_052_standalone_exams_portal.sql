-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 052 — نتائج الامتحانات المنفصلة في بوابة الطالب (Portal access)
-- ═══════════════════════════════════════════════════════════════════════════
-- RPC مخصص جديد يرجّع درجات الطالب في الامتحانات المنفصلة (migration 051)
-- حسب توكن البوابة — بدون لمس get_student_portal_data القائمة إطلاقًا.
--   • security definer + توكن إجباري: لا تسريب بيانات، الطالب يشوف درجاته فقط
--   • سلم التقديرات بيرجع مع الصف — البوابة تحسب اسم التقدير على العميل
--     بنفس معادلة لوحة المدرس (أول صف من الأعلى تحققه النسبة هو التقدير)
--   • اللي امتحن هو اللي حضر: الصفوف = الطلاب اللي ليهم درجة فقط
-- التشغيل: SQL Editor — idempotent (آمن للتكرار)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_student_standalone_exams(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- صلاحيات التنفيذ: anon (بوابة الطالب من غير تسجيل دخول) + authenticated
revoke all on function public.get_student_standalone_exams(text) from public;
revoke all on function public.get_student_standalone_exams(text) from anon;
revoke all on function public.get_student_standalone_exams(text) from authenticated;
grant execute on function public.get_student_standalone_exams(text) to anon;
grant execute on function public.get_student_standalone_exams(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- فحص ذاتي بعد التشغيل
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_student_standalone_exams'
  ) then
    raise exception 'Migration 052 FAILED: get_student_standalone_exams not created';
  end if;
  raise notice 'Migration 052 applied: portal RPC get_student_standalone_exams(text) — anon+authenticated';
end $$;
