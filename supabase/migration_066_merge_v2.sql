-- ═══════════════════════════════════════════════════════════════════════════
-- migration_066 — Task 66: merge_groups v2
-- 1) توحيد الطلاب المكررين عند الدمج: الطالب الموجود في المجموعتين (تطابق
--    بالتليفون بعد تنظيف الرقم، أو بالاسم بعد تطبيعه) بيتوحد في سجل واحد —
--    سجلات المجموعة المصدر (حضور، درجات، واجبات، سلوك، مدفوعات...) تنتقل
--    لسجل الهدف قبل حذف الصف المكرر، فولا درجة تضيع. عند تعارض (نفس الحصة/
--    الامتحان/الواجب للطالبين) سجل الهدف هو المرجع.
-- 2) سؤال الوقت: p_schedule_mode
--      'separate_times' → مواعيد المصدر تنتقل للمجموعة الهدف (المجموعة تبقى
--                          بمعادين/أكثر — أي يوم مكرر عند الهدف يُحذف من
--                          المصدر لتجنب تعارض الفهرس الفريد)
--      'same_time'      → مواعيد المصدر تُحذف (المجموعة الموحدة على وقت الهدف)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.merge_groups(
  p_teacher_id uuid,
  p_source text,
  p_target text,
  p_stage text default null,
  p_schedule_mode text default 'separate_times'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions int; v_hw int; v_sa int; v_oe int; v_students int; v_extras int;
  v_sched text; v_merged int := 0;
  d record; c uuid;
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

  -- ── 0) توحيد الطلاب المكررين: المصدر ↔ الهدف (تليفون مطابق أو اسم مطابق) ──
  for d in
    select s.id, s.phone, s.name
    from public.students s
    where s.teacher_id = p_teacher_id and s.group_name = p_source
  loop
    select k.id into c
    from public.students k
    where k.teacher_id = p_teacher_id and k.group_name = p_target
      and (
        (regexp_replace(coalesce(d.phone, ''), '\D', '', 'g') <> ''
          and regexp_replace(coalesce(k.phone, ''), '\D', '', 'g')
              = regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'))
        or (lower(regexp_replace(btrim(d.name), '\s+', ' ', 'g'))
            = lower(regexp_replace(btrim(k.name), '\s+', ' ', 'g')))
      )
    order by k.created_at
    limit 1;
    if c is not null then
      -- حضور: صف الهدف لكل حصة هو المرجع، والباقي ينتقل للموحّد
      delete from public.attendance_records ar
       where ar.student_id = d.id
         and exists (select 1 from public.attendance_records k
                      where k.student_id = c and k.lesson_session_id = ar.lesson_session_id);
      update public.attendance_records set student_id = c where student_id = d.id;
      -- واجب (حالة + تسليم + كويز)
      delete from public.homework_task_status x
       where x.student_id = d.id
         and exists (select 1 from public.homework_task_status k
                      where k.student_id = c and k.task_id = x.task_id);
      update public.homework_task_status set student_id = c where student_id = d.id;
      delete from public.homework_submissions x
       where x.student_id = d.id
         and exists (select 1 from public.homework_submissions k
                      where k.student_id = c and k.task_id = x.task_id);
      update public.homework_submissions set student_id = c where student_id = d.id;
      delete from public.homework_quiz_submissions x
       where x.student_id = d.id
         and exists (select 1 from public.homework_quiz_submissions k
                      where k.student_id = c and k.quiz_id = x.quiz_id);
      update public.homework_quiz_submissions set student_id = c where student_id = d.id;
      -- امتحانات منفصلة + أونلاين (نفس الامتحان → درجة الهدف هي المرجع)
      delete from public.standalone_exam_scores x
       where x.student_id = d.id
         and exists (select 1 from public.standalone_exam_scores k
                      where k.student_id = c and k.exam_id = x.exam_id);
      update public.standalone_exam_scores set student_id = c where student_id = d.id;
      delete from public.online_exam_attempts x
       where x.student_id = d.id
         and exists (select 1 from public.online_exam_attempts k
                      where k.student_id = c and k.exam_id = x.exam_id);
      update public.online_exam_attempts set student_id = c where student_id = d.id;
      -- درجات الحصص (بلا فهرس فريد — نقل مباشر) + السجلات الأخرى
      update public.exam_scores set student_id = c where student_id = d.id;
      update public.behavior_logs set student_id = c where student_id = d.id;
      update public.student_payments set student_id = c where student_id = d.id;
      update public.announcements set student_id = c where student_id = d.id;
      update public.whatsapp_send_log set student_id = c where student_id = d.id;
      update public.student_notifications set student_id = c where student_id = d.id;
      delete from public.students where id = d.id;
      v_merged := v_merged + 1;
    end if;
    c := null;
  end loop;

  -- ── 1) الحصص — الحضور والدرجات تتبعها تلقائيًا (بالـ lesson_session_id) ──
  update public.lesson_sessions set group_name = p_target, updated_at = now()
    where teacher_id = p_teacher_id and group_name = p_source;
  get diagnostics v_sessions = row_count;

  -- ── 2) الواجبات التفاعلية ──
  update public.homework_tasks set group_name = p_target, updated_at = now()
    where teacher_id = p_teacher_id and group_name = p_source;
  get diagnostics v_hw = row_count;

  -- ── 3) الامتحانات المنفصلة + الأونلاين ──
  update public.standalone_exams set group_name = p_target, updated_at = now()
    where teacher_id = p_teacher_id and group_name = p_source;
  get diagnostics v_sa = row_count;

  update public.online_exams set group_name = p_target, updated_at = now()
    where teacher_id = p_teacher_id and group_name = p_source;
  get diagnostics v_oe = row_count;

  -- ── 4) بقية طلاب المصدر (بعد استبعاد المكررين) — المرحلة تتوافق مع الهدف ──
  update public.students set group_name = p_target,
       stage = coalesce(nullif(btrim(p_stage), ''), stage), updated_at = now()
    where teacher_id = p_teacher_id and group_name = p_source;
  get diagnostics v_students = row_count;

  -- ── 5) المجموعات الإضافية: المصدر يختفي ويحل محله الهدف بلا تكرار ──
  update public.students set
       extra_groups = case
         when group_name = p_target then array_remove(extra_groups, p_source)
         when p_target = any(extra_groups) then array_remove(extra_groups, p_source)
         else array_replace(extra_groups, p_source, p_target)
       end,
       updated_at = now()
    where teacher_id = p_teacher_id and p_source = any(extra_groups);
  get diagnostics v_extras = row_count;

  -- ── 6) المواعيد الأسبوعية حسب اختيار المدرّس ──
  if p_schedule_mode = 'same_time' then
    delete from public.group_schedule where teacher_id = p_teacher_id and group_name = p_source;
    v_sched := 'deleted';
  else
    -- أيام موجودة أصلًا عند الهدف تُحذف من المصدر (فهرس فريد teacher+group+weekday)،
    -- والباقي ينتقل — المجموعة الموحدة تبقى بمعادين/أكثر.
    delete from public.group_schedule
     where teacher_id = p_teacher_id and group_name = p_source
       and weekday in (select weekday from public.group_schedule
                        where teacher_id = p_teacher_id and group_name = p_target);
    update public.group_schedule set group_name = p_target
      where teacher_id = p_teacher_id and group_name = p_source;
    v_sched := 'moved';
  end if;

  return jsonb_build_object(
    'sessions', v_sessions, 'homework', v_hw, 'standalone_exams', v_sa,
    'online_exams', v_oe, 'students', v_students, 'extra_rows', v_extras,
    'merged_duplicates', v_merged, 'schedule', v_sched);
end;
$$;

revoke all on function public.merge_groups(uuid, text, text, text, text) from public, anon;
grant execute on function public.merge_groups(uuid, text, text, text, text) to authenticated;

-- إزالة توقيع v1 (migration_065) — أي استدعاء قديم لازم يوصل لـ v2
drop function if exists public.merge_groups(uuid, text, text, text);

notify pgrst, 'reload schema';
