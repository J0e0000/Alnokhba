-- ============================================================================
-- migration_041_fix_student_day_index.sql
-- الإصلاح النهائي لخطأ «تعذر حفظ حضور الطالب» عند فتح حصة ثانية في نفس اليوم
-- ============================================================================
-- المشكلة (مُثبتة على قاعدة البيانات الحقيقية بتاريخ 2026-09-10):
--   يوجد فهرس فريد باسم idx_attendance_records_student_day على الأعمدة
--   (student_id, attendance_date) — يعني «صف حضور واحد فقط للطالب في اليوم كله».
--   لكن المنصة تسمح بفتح أكثر من حصة في اليوم لنفس المجموعة (زر «فتح حصة جديدة»)
--   أو لمجموعات مختلفة. النتيجة: أول حصة في اليوم تُحفظ عادي، وأي حصة تانية
--   لأي طالب له سجل اليوم تفشل بالخطأ:
--     [23505] duplicate key value violates unique constraint
--             "idx_attendance_records_student_day"
--   ونفس الخطأ يضرب «التحويل التلقائي للغائب» عند إنهاء الحصة — فيرجع الطالب
--   «لم يرصد» ويظهر «تعذر حفظ حضور الطالب ده حاول مرة أخرى».
--
-- الحل (جذري):
--   1) حذف أي تفرّد على (student_id, attendance_date) — فهرس كان أو قيد جدول،
--      مهما كان اسمه.
--   2) التفرّد الصحيح: صف واحد لكل (lesson_session_id, student_id) — لأن
--      الحصة هي وحدة التسجيل الحقيقية.
--   3) إعادة بناء الدوال الثلاث بـ ON CONFLICT الذريّة:
--      لا سباق (double-tap) ولا 23505 ولا صفوف مكرّرة — نهائياً.
--   4) تنظيف أي تكرار قديم قبل بناء الفهرس (شفاء بيانات بدون حذف أي سجل صحيح).
--
-- الملف آمن لإعادة التشغيل أكثر من مرة (idempotent) ولا يحذف أي بيانات.
-- شغّله في Supabase → SQL Editor → New query → الصق الملف كله → Run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0) أدوات مساعدة داخلية: قراءة إعداد النقاط بأمان (نفس نسخة 040)
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
-- 1) شفاء البيانات: توحيد الصفوف المكرّرة لكل (حصة، طالب) — يحفظ الأحدث
--    (ضروري قبل إنشاء الفهرس الفريد؛ لا يمسّ الصفوف ذات lesson_session_id
--    الفارغ من الأنظمة القديمة)
-- ----------------------------------------------------------------------------
delete from public.attendance_records a
using public.attendance_records b
where a.lesson_session_id is not null
  and b.lesson_session_id = a.lesson_session_id
  and a.student_id = b.student_id
  and (a.recorded_at, a.id) < (b.recorded_at, b.id);

-- ----------------------------------------------------------------------------
-- 2) حذف التفرّد اليومي الخاطئ (student_id, attendance_date)
--    أ) بالاسم المعروف، ب) بأي اسم آخر لفهرس فريد على نفس العمودين،
--    ج) وأي قيد UNIQUE على مستوى الجدول بنفس العمودين
-- ----------------------------------------------------------------------------
-- (أ)
drop index if exists public.idx_attendance_records_student_day;

-- (ب) أي فهرس فريد آخر يحتوي student_id + attendance_date (أي ترتيب)
do $$
declare
  v_idx record;
begin
  for v_idx in
    select i.indexname, i.indexdef
    from pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'attendance_records'
      and i.indexdef ~* 'unique'
      and i.indexdef ~* 'student_id'
      and i.indexdef ~* 'attendance_date'
      and i.indexname <> 'uq_attendance_lesson_student'
  loop
    execute format('drop index if exists public.%I', v_idx.indexname);
  end loop;
exception when others then
  raise notice 'فهرس يومي إضافي: %', sqlerrm;
end $$;

-- (ج) أي قيد UNIQUE على الجدول على (student_id, attendance_date)
do $$
declare
  v_con record;
begin
  for v_con in
    select con.conname, con.oid
    from pg_constraint con
    where con.conrelid = 'public.attendance_records'::regclass
      and con.contype = 'u'
      and (select array_agg(a.attname order by a.attnum)
           from unnest(con.conkey) with ordinality k(attnum, ord)
           join pg_attribute a
             on a.attrelid = con.conrelid and a.attnum = k.attnum)::text
          in ('{student_id,attendance_date}', '{attendance_date,student_id}')
  loop
    execute format('alter table public.attendance_records drop constraint if exists %I', v_con.conname);
  end loop;
exception when others then
  raise notice 'قيد يومي إضافي: %', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- 3) التفرّد الصحيح: صف واحد لكل (حصة، طالب)
--    (الصفوف القديمة ذات lesson_session_id فارغ لا تتعارض — PostgreSQL
--     يعتبر NULL قيمة مختلفة دائماً)
-- ----------------------------------------------------------------------------
create unique index if not exists uq_attendance_lesson_student
  on public.attendance_records(lesson_session_id, student_id);

-- ----------------------------------------------------------------------------
-- 4) upsert_lesson_attendance — نسخة ذرّية ON CONFLICT
--    • نفس عقد 040 بالضبط: نفس الأسماء، نفس الرسائل العربية، يرجّع الصف
--    • إضافي: محصّن ضد الضغطة المزدوجة (double-tap) وضد أي تكرار قديم
--    • كتابة ذرّية واحدة: صف جديد أو تحديث الصف الموجود لنفس (الحصة،
--      الطالب) — أي حصة تانية في نفس اليوم تمرّ بدون أي تعارض
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
  v_lesson  public.lesson_sessions%rowtype;
  v_student public.students%rowtype;
  v_row     public.attendance_records%rowtype;
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

  if v_student.teacher_id <> v_lesson.teacher_id
     and not public.can_access_workspace(v_student.teacher_id) then
    raise exception 'غير مصرح لك بتسجيل حضور هذا الطالب';
  end if;

  if p_status not in ('حاضر', 'غائب', 'لم يرصد', 'متأخر') then
    raise exception 'حالة حضور غير معروفة: %', coalesce(p_status, 'فارغة');
  end if;

  insert into public.attendance_records
    (teacher_id, student_id, status, homework_status, lesson_session_id,
     recorded_at, attendance_date)
  values
    (v_lesson.teacher_id, p_student_id, p_status, 'لم يرصد', p_lesson_session_id,
     now(), v_lesson.session_date)
  on conflict (lesson_session_id, student_id)
  do update set
    status      = excluded.status,
    teacher_id  = excluded.teacher_id,
    recorded_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) upsert_lesson_homework — نسخة ذرّية ON CONFLICT (تحافظ على حالة الحضور)
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
  v_lesson public.lesson_sessions%rowtype;
  v_row    public.attendance_records%rowtype;
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

  if p_homework_status not in ('مكتمل', 'ناقص', 'لم يتم', 'لم يرصد') then
    raise exception 'حالة واجب غير معروفة: %', coalesce(p_homework_status, 'فارغة');
  end if;

  insert into public.attendance_records
    (teacher_id, student_id, status, homework_status, lesson_session_id,
     recorded_at, attendance_date)
  values
    (v_lesson.teacher_id, p_student_id, 'لم يرصد', p_homework_status,
     p_lesson_session_id, now(), v_lesson.session_date)
  on conflict (lesson_session_id, student_id)
  do update set
    homework_status = excluded.homework_status,
    teacher_id      = excluded.teacher_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) finalize_lesson_session — نسخة ذرّية
--    • نفس عقد 040: التحويل التلقائي للغائب + خصم النقاط مرة واحدة
--      (بحرس الحالة) + إغلاق الحصة + إعادة الإنشاء idempotent
--    • التحديثات كلها ON CONFLICT DO NOTHING/UPDATE — لا 23505 أبداً
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
  v_lesson    public.lesson_sessions%rowtype;
  v_present   integer := 0;
  v_absent    integer := 0;
  v_marked    integer := 0;
  v_student   record;
  v_points_abs integer;
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
    -- إنهاء مكرر: أرجع الأرقام الحالية بدون أي كتابة
    select count(*) filter (where ar.status = 'حاضر'),
           count(*) filter (where ar.status = 'غائب')
      into v_present, v_absent
    from public.attendance_records ar
    where ar.lesson_session_id = p_lesson_session_id;
    return jsonb_build_object('lesson_id', p_lesson_session_id, 'already_finalized', true,
                              'present_count', v_present, 'absent_count', v_absent);
  end if;

  v_points_abs := public._nokhba_points_setting(v_lesson.teacher_id, 'absent');

  -- (ب) الطلاب غير المرصودين في مجموعة الحصة => «غائب» (بشكل ذرّي)
  --     يشمل: الطالب بلا سجل أصلاً + الطالب له سجل «لم يرصد» (واجب فقط بدون
  --     حضور) — عقد الواجهة يتطلب أن كل طلاب المجموعة يخرجوا من الإنهاء
  --     «حاضر» أو «غائب» وإلا ترفض الواجهة إرسال التحديث النهائي.
  for v_student in
    select s.id, s.points, s.attendance_status, ar.status as lesson_status
    from public.students s
    left join lateral (
      select ar2.status
      from public.attendance_records ar2
      where ar2.lesson_session_id = p_lesson_session_id
        and ar2.student_id = s.id
      order by ar2.recorded_at desc, ar2.id desc
      limit 1
    ) ar on true
    where s.teacher_id = v_lesson.teacher_id
      and s.group_name = v_lesson.group_name
      and (ar.status is null or ar.status = 'لم يرصد')
  loop
    insert into public.attendance_records
      (teacher_id, student_id, status, homework_status, lesson_session_id,
       recorded_at, attendance_date)
    values
      (v_lesson.teacher_id, v_student.id, 'غائب', 'لم يرصد',
       p_lesson_session_id, now(), v_lesson.session_date)
    on conflict (lesson_session_id, student_id)
    do update set
      status      = 'غائب',
      teacher_id  = excluded.teacher_id,
      recorded_at = now();

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
-- 7) تريجر الإشعار — نفس نسخة 040 الآمنة (فشل الإشعار لا يمنع الحفظ أبداً)
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
-- 8) جسر إشعارات الطلاب -> تنبيهات المدرّس — نفس نسخة 040 الآمنة
-- ----------------------------------------------------------------------------
create or replace function public.bridge_student_notification_to_teacher_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
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
    return new;
  end;
end;
$$;

drop trigger if exists student_notification_teacher_push_bridge on public.student_notifications;
create trigger student_notification_teacher_push_bridge
after insert on public.student_notifications
for each row execute procedure public.bridge_student_notification_to_teacher_push();

-- ----------------------------------------------------------------------------
-- 9) الصلاحيات: الدوال للمدرّسين المسجلين فقط (مثل 040)
-- ----------------------------------------------------------------------------
revoke all on function public.upsert_lesson_attendance(uuid, uuid, text) from public, anon;
revoke all on function public.upsert_lesson_homework(uuid, uuid, text) from public, anon;
revoke all on function public.finalize_lesson_session(uuid) from public, anon;
revoke all on function public._nokhba_points_setting(uuid, text) from public, anon;
grant execute on function public.upsert_lesson_attendance(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.upsert_lesson_homework(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.finalize_lesson_session(uuid) to authenticated, service_role;

commit;
