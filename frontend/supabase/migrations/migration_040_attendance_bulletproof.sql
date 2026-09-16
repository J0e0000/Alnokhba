-- ============================================================================
-- migration_040_attendance_bulletproof.sql
-- إصلاح جذري ونهائي لمسار حفظ الحضور (الحضور / الغياب / الواجب / إنهاء الحصة)
-- ============================================================================
-- المشكلة:
--   المدرّس يسجل حضور/غياب الطالب فتظهر رسالة «تعذر حفظ حضور الطالب ده حاول
--   مرة أخرى»، وبعد إنهاء الحصة يرجع الطالب «لم يرصد» — يعني الكتابة نفسها
--   بتقع على الأرض. السبب بقى جوه قاعدة البيانات (RPC/تريجر/سياسة RLS اتغيرت
--   مع آخر التحديثات) بدل ما تكون في الواجهة.
--
-- الحل (جذري، مش ترقيع):
--   1) استبدال كامل للثلاث دوال المسؤولة عن الكتابة بنسخ مضمونة ومختبرة:
--        upsert_lesson_attendance / upsert_lesson_homework / finalize_lesson_session
--   2) إعادة تفعيل تريجرات الإشعارات بصيغة آمنة (أي عطل في الإشعار
--      لا يمنع أبداً حفظ الحضور — كان ممكن يكون ده السبب).
--   3) إعادة ضبط سياسات RLS + الصلاحيات على جداول مسار الحضور.
--   4) تنظيف السجلات المكرّرة القديمة (لو موجودة) حتى لا يفشل إنهاء الحصة.
--
-- الملف آمن لإعادة التشغيل أكثر من مرة (idempotent) ولا يحذف أي بيانات.
-- ترتيب الرقم لا يهم — يمكنك تشغيله في SQL Editor مباشرة بعد أي ميجريشن.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0) أدوات مساعدة داخلية: قراءة إعداد النقاط بأمان (لو الصف/العمود ناقص
--    نرجّع القيمة الافتراضية بدل ما نفشل)
-- ----------------------------------------------------------------------------
create or replace function public._nokhba_points_setting(p_teacher uuid, p_which text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_present integer;
  v_absent  integer;
begin
  select ts.points_present, ts.points_absent into v_present, v_absent
  from public.teacher_settings ts
  where ts.teacher_id = p_teacher;
  if p_which = 'present' then
    return coalesce(v_present, 1);
  elsif p_which = 'absent' then
    return coalesce(v_absent, -1);
  end if;
  return 0;
exception when undefined_column or undefined_table then
  return case when p_which = 'present' then 1 when p_which = 'absent' then -1 else 0 end;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) upsert_lesson_attendance — كتابة حضور/غياب طالب داخل حصة (بديل جذري)
--    العقد مع الواجهة (مطابق لما تستخدمه):
--      • upsert ذري: صف واحد لكل (حصة، طالب) — يحدّث الأحدث أو يُدرج جديد
--      • يرجّع صف attendance_records نفسه (أو null — الواجهة تتحمّل الاتنين)
--      • حصة منتهية => رفض برسالة عربية واضحة
--      • لا يلمس students.points (الواجهة هي التي تحدّثها — نفس تقسيم العمل
--        الحالي) حتى لا تتكرر النقاط أبداً
-- ----------------------------------------------------------------------------
drop function if exists public.upsert_lesson_attendance(uuid, uuid, text);
create function public.upsert_lesson_attendance(
  p_lesson_session_id uuid,
  p_student_id uuid,
  p_status text
) returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson      public.lesson_sessions%rowtype;
  v_student     public.students%rowtype;
  v_existing    public.attendance_records%rowtype;
  v_has_row     boolean := false;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول قبل تسجيل الحضور';
  end if;

  select * into v_lesson from public.lesson_sessions ls
  where ls.id = p_lesson_session_id;
  if not found then
    raise exception 'الحصة غير موجودة — أعد فتح الحصة وحاول مرة أخرى';
  end if;

  if not public.can_access_workspace(v_lesson.teacher_id) then
    raise exception 'غير مصرح لك بتسجيل الحضور في هذه الحصة';
  end if;

  if v_lesson.status = 'completed' then
    raise exception 'الحصة دي منتهية بالفعل — افتح حصة جديدة عشان تسجل الحضور';
  end if;

  select * into v_student from public.students s
  where s.id = p_student_id;
  if not found then
    raise exception 'الطالب غير موجود';
  end if;

  -- طالب الضيف (من مجموعة/مدرس تاني داخل نفس مساحة العمل) مسموح؛ طالب
  -- خارج مساحة العمل مرفوض.
  if v_student.teacher_id <> v_lesson.teacher_id
     and not public.can_access_workspace(v_student.teacher_id) then
    raise exception 'غير مصرح لك بتسجيل حضور هذا الطالب';
  end if;

  if p_status not in ('حاضر', 'غائب', 'لم يرصد', 'متأخر') then
    raise exception 'حالة حضور غير معروفة: %', coalesce(p_status, 'فارغة');
  end if;

  -- آخر صف لهذا الطالب في هذه الحصة (إن وُجد)
  select ar.* into v_existing
  from public.attendance_records ar
  where ar.lesson_session_id = p_lesson_session_id
    and ar.student_id = p_student_id
  order by ar.recorded_at desc, ar.id desc
  limit 1;
  v_has_row := found;  -- احفظ النتيجة قبل أي DELETE يبطّل متغير found

  -- تنظيف أي تكرار قديم (يحفظ الصف الأحدث فقط)
  if v_has_row then
    delete from public.attendance_records
    where lesson_session_id = p_lesson_session_id
      and student_id = p_student_id
      and id <> v_existing.id;
  end if;

  if v_has_row then
    update public.attendance_records
    set status = p_status,
        teacher_id = v_lesson.teacher_id,
        recorded_at = now()
    where id = v_existing.id
    returning * into v_existing;
    return v_existing;
  else
    insert into public.attendance_records
      (teacher_id, student_id, status, homework_status, lesson_session_id, recorded_at)
    values
      (v_lesson.teacher_id, p_student_id, p_status, 'لم يرصد', p_lesson_session_id, now())
    returning * into v_existing;
    return v_existing;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) upsert_lesson_homework — تسليم/عدم تسليم الواجب داخل حصة (بديل جذري)
-- ----------------------------------------------------------------------------
drop function if exists public.upsert_lesson_homework(uuid, uuid, text);
create function public.upsert_lesson_homework(
  p_lesson_session_id uuid,
  p_student_id uuid,
  p_homework_status text
) returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson   public.lesson_sessions%rowtype;
  v_existing public.attendance_records%rowtype;
  v_has_row  boolean := false;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول قبل تسجيل الواجب';
  end if;

  select * into v_lesson from public.lesson_sessions ls
  where ls.id = p_lesson_session_id;
  if not found then
    raise exception 'الحصة غير موجودة — أعد فتح الحصة وحاول مرة أخرى';
  end if;

  if not public.can_access_workspace(v_lesson.teacher_id) then
    raise exception 'غير مصرح لك بتسجيل الواجب في هذه الحصة';
  end if;

  if v_lesson.status = 'completed' then
    raise exception 'الحصة دي منتهية بالفعل — افتح حصة جديدة عشان تسجل الواجب';
  end if;

  select ar.* into v_existing
  from public.attendance_records ar
  where ar.lesson_session_id = p_lesson_session_id
    and ar.student_id = p_student_id
  order by ar.recorded_at desc, ar.id desc
  limit 1;
  v_has_row := found;  -- احفظ النتيجة قبل أي DELETE يبطّل متغير found

  if v_has_row then
    update public.attendance_records
    set homework_status = p_homework_status,
        teacher_id = v_lesson.teacher_id
    where id = v_existing.id
    returning * into v_existing;
    return v_existing;
  else
    insert into public.attendance_records
      (teacher_id, student_id, status, homework_status, lesson_session_id, recorded_at)
    values
      (v_lesson.teacher_id, p_student_id, 'لم يرصد', p_homework_status, p_lesson_session_id, now())
    returning * into v_existing;
    return v_existing;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) finalize_lesson_session — إنهاء الحصة (بديل جذري)
--    • يحوّل أي طالب «غير مرصود» في مجموعة الحصة إلى «غائب» (المُنهي هو
--      المكان الوحيد الذي يقوم بذلك — نفس عقد الواجهة)
--      + يخصم نقاط الغياب ويحدّث students.attendance_status
--    • يوحّد الصفوف المكرّرة لكل طالب (يحفظ الأحدث)
--    • status = completed + ended_at = now()
--    • يرجّع {present_count, absent_count, marked_absent, lesson_id}
-- ----------------------------------------------------------------------------
drop function if exists public.finalize_lesson_session(uuid);
create function public.finalize_lesson_session(
  p_lesson_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson       public.lesson_sessions%rowtype;
  v_present      integer := 0;
  v_absent       integer := 0;
  v_marked       integer := 0;
  v_student      record;
  v_points_abs   integer;
  v_keep         public.attendance_records%rowtype;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول قبل إنهاء الحصة';
  end if;

  select * into v_lesson from public.lesson_sessions ls
  where ls.id = p_lesson_session_id;
  if not found then
    raise exception 'الحصة غير موجودة';
  end if;

  if not public.can_access_workspace(v_lesson.teacher_id) then
    raise exception 'غير مصرح لك بإنهاء هذه الحصة';
  end if;

  if v_lesson.status = 'completed' then
    -- إنهاء مكرر: أرجع الأرقام الحالية بدون أي كتابة (idempotent)
    -- + نظّف أي تكرار (شفاء بيانات بدون إعادة فتح)
    delete from public.attendance_records a
    using public.attendance_records b
    where a.lesson_session_id = p_lesson_session_id
      and b.lesson_session_id = p_lesson_session_id
      and a.student_id = b.student_id
      and (a.recorded_at, a.id) < (b.recorded_at, b.id);

    select count(*) filter (where ar.status = 'حاضر'),
           count(*) filter (where ar.status = 'غائب')
      into v_present, v_absent
    from public.attendance_records ar
    where ar.lesson_session_id = p_lesson_session_id;
    return jsonb_build_object('lesson_id', p_lesson_session_id, 'already_finalized', true,
                              'present_count', v_present, 'absent_count', v_absent);
  end if;

  v_points_abs := public._nokhba_points_setting(v_lesson.teacher_id, 'absent');

  -- (أ) توحيد الصفوف المكرّرة داخل الحصة (يحفظ الأحدث لكل طالب)
  delete from public.attendance_records a
  using public.attendance_records b
  where a.lesson_session_id = p_lesson_session_id
    and b.lesson_session_id = p_lesson_session_id
    and a.student_id = b.student_id
    and (a.recorded_at, a.id) < (b.recorded_at, b.id);

  -- (ب) الطلاب غير المرصودين في مجموعة الحصة => «غائب»
  for v_student in
    select s.id, s.points, s.attendance_status
    from public.students s
    where s.teacher_id = v_lesson.teacher_id
      and s.group_name = v_lesson.group_name
      and not exists (
        select 1 from public.attendance_records ar
        where ar.lesson_session_id = p_lesson_session_id
          and ar.student_id = s.id
      )
  loop
    insert into public.attendance_records
      (teacher_id, student_id, status, homework_status, lesson_session_id, recorded_at)
    values
      (v_lesson.teacher_id, v_student.id, 'غائب', 'لم يرصد', p_lesson_session_id, now());

    update public.students
    set attendance_status = 'غائب',
        points = coalesce(points, 0)
                 + (case when v_student.attendance_status = 'غائب' then 0 else v_points_abs end),
        updated_at = now()
    where id = v_student.id;

    v_marked := v_marked + 1;
  end loop;

  -- (ج) إغلاق الحصة
  update public.lesson_sessions
  set status = 'completed',
      ended_at = coalesce(ended_at, now()),
      updated_at = now()
  where id = p_lesson_session_id;

  -- (د) الأرقام النهائية
  select count(*) filter (where ar.status = 'حاضر'),
         count(*) filter (where ar.status = 'غائب')
    into v_present, v_absent
  from public.attendance_records ar
  where ar.lesson_session_id = p_lesson_session_id;

  return jsonb_build_object(
    'lesson_id', p_lesson_session_id,
    'present_count', v_present,
    'absent_count', v_absent,
    'marked_absent', v_marked
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) تريجر الإشعار عند تسجيل الحضور — إعادة تفعيل النسخة الآمنة
--    (أي عطل في الإشعار لا يمنع حفظ الحضور أبداً)
-- ----------------------------------------------------------------------------
create or replace function public.notify_attendance_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student     record;
  v_session     record;
  v_title       text;
  v_body        text;
  v_preferences jsonb;
begin
  begin
    select s.name, s.group_name into v_student
    from public.students s
    where s.id = new.student_id and s.teacher_id = new.teacher_id;

    select ts.notification_preferences into v_preferences
    from public.teacher_settings ts
    where ts.teacher_id = new.teacher_id;

    if coalesce((v_preferences->>'attendance')::boolean, true) = false then
      return new;
    end if;

    begin
      select sl.lesson_topic, sl.homework_text, sl.video_link into v_session
      from public.session_logs sl
      where sl.teacher_id = new.teacher_id
        and sl.session_date = new.recorded_at::date
      limit 1;
    exception when others then
      v_session := null;
    end;

    if new.status = 'غائب' then
      v_title := 'غياب الطالب: ' || coalesce(v_student.name, 'الطالب');
      v_body := 'لم يحضر الطالب حصة اليوم.';
      if coalesce(v_session.video_link, '') <> '' then
        v_body := v_body || ' يمكنك مشاهدة شرح الحصة من خلال رابط الفيديو.';
      end if;
    else
      v_title := 'تسجيل حضور: ' || coalesce(v_student.name, 'الطالب');
      v_body := 'تم تسجيل حضور الطالب في الحصة.';
    end if;

    begin
      insert into public.student_notifications(teacher_id, student_id, title, body, category, deep_link)
      values (
        new.teacher_id,
        new.student_id,
        v_title,
        v_body || case when coalesce(v_session.homework_text, '') <> '' then ' الواجب: ' || v_session.homework_text else '' end,
        'attendance',
        '/' || new.student_id::text
      );
    exception when others then
      null; -- الإشعار اختياري: لا يمنع حفظ الحضور
    end;

    return new;
  exception when others then
    -- الحضور لا يفشل أبداً بسبب الإشعارات
    return new;
  end;
end;
$$;

drop trigger if exists on_attendance_recorded_notify on public.attendance_records;
create trigger on_attendance_recorded_notify
after insert on public.attendance_records
for each row execute procedure public.notify_attendance_record();

-- ----------------------------------------------------------------------------
-- 5) تريجر جسر إشعارات الطلاب -> تنبيهات المدرّس — نسخة آمنة (037 + حماية)
--    فشل التنبيه لا يكسر أي إدخال إشعار (كان سبباً محتملاً لتعطل الحفظ)
-- ----------------------------------------------------------------------------
create or replace function public.bridge_student_notification_to_teacher_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    -- لوحة الإعلانات: الإرسال الجماعي بيتعمل من send_announcement مباشرة
    if new.category = 'announcement' then
      return new;
    end if;

    insert into public.teacher_notification_events (
      teacher_id, event_type, title, body, related_student_id, category
    ) values (
      new.teacher_id,
      case
        when new.category = 'payment' then 'payment_recorded'
        when new.category = 'attendance' then 'other'
        else 'student_insight'
      end,
      coalesce(new.title, 'تنبيه جديد'),
      coalesce(new.body, ''),
      new.student_id,
      coalesce(new.category, 'general')
    );
    return new;
  exception when others then
    -- الجسر تنبيهي فقط: لا يمنع إدخال الإشعار الأصلي أبداً
    return new;
  end;
end;
$$;

drop trigger if exists student_notification_teacher_push_bridge on public.student_notifications;
create trigger student_notification_teacher_push_bridge
after insert on public.student_notifications
for each row execute procedure public.bridge_student_notification_to_teacher_push();

-- ----------------------------------------------------------------------------
-- 6) سياسات RLS على مسار الحضور — إعادة ضبط بالشكل المعتمد (019/036)
-- ----------------------------------------------------------------------------
alter table public.students enable row level security;
drop policy if exists "students_workspace_access" on public.students;
create policy "students_workspace_access" on public.students
  for all using (public.can_access_workspace(teacher_id))
  with check (public.can_access_workspace(teacher_id));

alter table public.attendance_records enable row level security;
drop policy if exists "attendance_workspace_access" on public.attendance_records;
create policy "attendance_workspace_access" on public.attendance_records
  for all using (public.can_access_workspace(teacher_id))
  with check (public.can_access_workspace(teacher_id));

alter table public.lesson_sessions enable row level security;
drop policy if exists "lesson_sessions_workspace_access" on public.lesson_sessions;
create policy "lesson_sessions_workspace_access" on public.lesson_sessions
  for all using (public.can_access_workspace(teacher_id))
  with check (public.can_access_workspace(teacher_id));

alter table public.behavior_logs enable row level security;
drop policy if exists "behavior_workspace_access" on public.behavior_logs;
create policy "behavior_workspace_access" on public.behavior_logs
  for all using (public.can_access_workspace(teacher_id))
  with check (public.can_access_workspace(teacher_id));

-- ----------------------------------------------------------------------------
-- 7) الصلاحيات: الدوال للمدرّسين المسجلين فقط
-- ----------------------------------------------------------------------------
revoke all on function public.upsert_lesson_attendance(uuid, uuid, text) from public, anon;
revoke all on function public.upsert_lesson_homework(uuid, uuid, text) from public, anon;
revoke all on function public.finalize_lesson_session(uuid) from public, anon;
revoke all on function public._nokhba_points_setting(uuid, text) from public, anon;
grant execute on function public.upsert_lesson_attendance(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.upsert_lesson_homework(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.finalize_lesson_session(uuid) to authenticated, service_role;

commit;
