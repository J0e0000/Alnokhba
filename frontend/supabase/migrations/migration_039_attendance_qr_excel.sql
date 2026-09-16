-- ============================================================================
-- النخبة (Alnokhba) — Migration 039
-- سلامة الحضور (سجل واحد لكل طالب يوميًا) + فك كود QR من السيرفر
-- + إلغاء الحضور فعليًا + استيراد درجات Excel ذريًا
-- ============================================================================
-- آمن وتراكمي 100%: لا يحذف أي بيانات نهائيًا (النسخ المكررة بتتأرشف)،
-- وكل الأوامر idempotent — يعمل من Supabase SQL Editor (الصق الملف كاملاً ثم Run)
-- وآمن لإعادة التشغيل أكثر من مرة.
--
-- المحتويات:
--   1) عمود attendance_date + فهرس فريد (student_id, attendance_date):
--      طالب واحد = سجل حضور واحد لكل يوم تقويمي (على مستوى قاعدة البيانات،
--      فمستحيل يتكرر السجل حتى لو اتنين مسحوا نفس الطالب في نفس اللحظة)
--   2) أرشفة النسخ المكررة القديمة في attendance_records_archive (مش حذف)
--      + تقرير تكامل في attendance_integrity_report
--   3) دوال الحضور اليومية (كلها race-safe بالمعاملات والقفل):
--      - set_student_attendance : رصد/تعديل + نقاط + سجل نشاط + إشعار الأهل
--      - upsert_lesson_attendance (توافق قديم — نفس التوقيع + منطق اليوم)
--      - upsert_lesson_homework  (توافق قديم — الواجب على سجل اليوم)
--      - remove_attendance      : إلغاء الرصد (حذف السجل + تأرشيف + رجوع النقاط)
--      - finalize_lesson_session: إنهاء الحصة بمنطق اليوم الواحد
--      - mark_group_absences    : غياب المجموعة بمنطق اليوم الواحد
--   4) resolve_student_by_qr : فك الكود المسوح (توكن / رابط بوابة / UUID)
--      من السيرفر مع التحقق الكامل — الماسح بقى يقبل بطاقة الطالب نفسها
--   5) import_exam_grades : استيراد درجات Excel في معاملة واحدة ذرية
--      (تحقق من: الطالب + الصلاحية + الحضور + الدرجة + عدم الكتم فوق درجات قائمة)
--      + سجل استيراد grade_import_logs + تدقيق في exam_score_audit_logs
--
-- الصلاحيات: نفس نظام can_access_workspace القائم — مفيش نظام جديد.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) احتياط: أعمدة الحصة/الواجب على attendance_records (موجودة في الحي)
-- ----------------------------------------------------------------------------
alter table public.attendance_records add column if not exists lesson_session_id uuid;
alter table public.attendance_records add column if not exists homework_status text;

-- ----------------------------------------------------------------------------
-- 1) عمود اليوم التقويمي attendance_date
-- ----------------------------------------------------------------------------
alter table public.attendance_records add column if not exists attendance_date date;

-- تعبئة السجلات القديمة: سجل مرتبط بحصة → تاريخ الحصة؛ غير مرتبط → تاريخ
-- الرصد (UTC — نفس اليوم اللي الجدول بيستخدمه في session_date).
update public.attendance_records ar
  set attendance_date = coalesce(
    (select ls.session_date from public.lesson_sessions ls where ls.id = ar.lesson_session_id limit 1),
    (ar.recorded_at at time zone 'utc')::date
  )
  where ar.attendance_date is null;

-- ----------------------------------------------------------------------------
-- 2) أرشفة النسخ المكررة (بدون حذف نهائي) + تقرير تكامل
--    القاعدة: آخر رصد في اليوم هو الفعّال (نفس اللي الشاشة بتعرضه أصلًا)،
--    والباقي يتأرشف بالكامل مع سبب واضح.
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_records_archive (
  id uuid primary key,
  teacher_id uuid not null,
  student_id uuid not null,
  status text not null,
  recorded_at timestamptz not null,
  lesson_session_id uuid,
  homework_status text,
  attendance_date date,
  archived_at timestamptz not null default now(),
  archive_reason text not null default 'day_uniqueness_migration'
);
create index if not exists idx_att_archive_student_day
  on public.attendance_records_archive(student_id, attendance_date);
alter table public.attendance_records_archive enable row level security;
-- قراءة/كتابة للمالك فقط (postgres/service_role) — ده أرشيف تدقيق.

create table if not exists public.attendance_integrity_report (
  id uuid primary key default uuid_generate_v4(),
  ran_at timestamptz not null default now(),
  total_records integer not null default 0,
  duplicate_groups integer not null default 0,
  duplicate_rows integer not null default 0,
  archived_rows integer not null default 0,
  details jsonb
);
alter table public.attendance_integrity_report enable row level security;

do $$
declare
  v_total int;
  v_groups int;
  v_dup_rows int;
  v_archived int;
begin
  select count(*) into v_total from public.attendance_records;

  select count(*) into v_groups from (
    select 1 from public.attendance_records
    where attendance_date is not null
    group by student_id, attendance_date
    having count(*) > 1
  ) d;

  if v_groups > 0 then
    -- تأرشف كل النسخ ما عدا الأحدث لكل (طالب + يوم)
    with ranked as (
      select id, row_number() over (
        partition by student_id, attendance_date
        order by recorded_at desc, id desc
      ) as rn
      from public.attendance_records
      where attendance_date is not null
    ),
    doomed as (
      select r.id from ranked r where r.rn > 1
    )
    insert into public.attendance_records_archive
      (id, teacher_id, student_id, status, recorded_at, lesson_session_id, homework_status, attendance_date, archive_reason)
    select ar.id, ar.teacher_id, ar.student_id, ar.status, ar.recorded_at,
           ar.lesson_session_id, ar.homework_status, ar.attendance_date, 'day_uniqueness_migration'
    from public.attendance_records ar
    join doomed d on d.id = ar.id
    on conflict (id) do nothing;

    get diagnostics v_archived = row_count;

    with ranked as (
      select id, row_number() over (
        partition by student_id, attendance_date
        order by recorded_at desc, id desc
      ) as rn
      from public.attendance_records
      where attendance_date is not null
    )
    delete from public.attendance_records
    where id in (select r.id from ranked r where r.rn > 1);

    select coalesce(sum(c) - count(distinct (student_id, attendance_date)), 0) into v_dup_rows
    from (select count(*) as c, student_id, attendance_date
          from public.attendance_records_archive
          where archive_reason = 'day_uniqueness_migration'
          group by student_id, attendance_date) t;

    insert into public.attendance_integrity_report
      (total_records, duplicate_groups, duplicate_rows, archived_rows, details)
    values (v_total, v_groups, v_dup_rows, v_archived,
      jsonb_build_object('note', 'تم أرشفة السجلات المكررة القديمة — راجع attendance_records_archive'));

    raise notice '⚠️ تم اكتشاف % مجموعة أيام بها سجلات مكررة (% سجل مؤرشف) — محفوظة كاملة في attendance_records_archive', v_groups, v_archived;
  else
    insert into public.attendance_integrity_report
      (total_records, duplicate_groups, duplicate_rows, archived_rows, details)
    values (v_total, 0, 0, 0, jsonb_build_object('note', 'لا توجد سجلات مكررة'));
    raise notice '✅ لا توجد سجلات حضور مكررة لنفس الطالب في نفس اليوم';
  end if;
end $$;

-- الآن اليوم مضمون فريد لكل طالب: NOT NULL + فهرس فريد (حماية مستوى القاعدة)
alter table public.attendance_records alter column attendance_date set not null;
alter table public.attendance_records alter column attendance_date set default ((now() at time zone 'utc')::date);
create unique index if not exists idx_attendance_records_student_day
  on public.attendance_records(student_id, attendance_date);

-- ----------------------------------------------------------------------------
-- 3) الدالة الداخلية: رصد/تحديث سجل اليوم (واحد فقط — سباق آمن)
--    النقاط والإشعارات دي شغل الدوال العامة فوقها.
-- ----------------------------------------------------------------------------
create or replace function public._upsert_attendance_day(
  p_teacher_id uuid,
  p_student_id uuid,
  p_status text,
  p_lesson_session_id uuid default null,
  p_attendance_date date default null,
  p_homework_status text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_lesson_day date;
  v_existing record;
  v_row record;
  v_created boolean := false;
  v_previous_status text;
begin
  -- اليوم المرجعي: تاريخ الحصة > التاريخ المُمرر > اليوم (UTC)
  if p_lesson_session_id is not null then
    select ls.session_date into v_lesson_day
      from public.lesson_sessions ls where ls.id = p_lesson_session_id;
  end if;
  v_day := coalesce(v_lesson_day, p_attendance_date, (now() at time zone 'utc')::date);

  -- null = الحالة الحالية تفضل زي ما هي (مسار الواجب)
  if p_status is not null and p_status not in ('حاضر', 'غائب', 'لم يرصد') then
    raise exception 'حالة حضور غير صحيحة: %', p_status;
  end if;

  -- سجل اليوم الحالي (قفل الصف = حماية التزامن)
  select ar.id, ar.status, ar.homework_status, ar.teacher_id, ar.lesson_session_id
    into v_existing
    from public.attendance_records ar
    where ar.student_id = p_student_id and ar.attendance_date = v_day
    for update;

  if found then
    v_previous_status := v_existing.status;
    update public.attendance_records
      set status = coalesce(p_status, v_existing.status),
          homework_status = coalesce(p_homework_status, v_existing.homework_status),
          lesson_session_id = coalesce(p_lesson_session_id, v_existing.lesson_session_id),
          recorded_at = now()
      where id = v_existing.id
      returning id, teacher_id, student_id, status, homework_status, lesson_session_id, recorded_at, attendance_date
      into v_row;
  else
    begin
      insert into public.attendance_records
        (teacher_id, student_id, status, homework_status, lesson_session_id, attendance_date, recorded_at)
      values (p_teacher_id, p_student_id, coalesce(p_status, 'لم يرصد'),
              coalesce(p_homework_status, 'لم يرصد'),
              p_lesson_session_id, v_day, now())
      returning id, teacher_id, student_id, status, homework_status, lesson_session_id, recorded_at, attendance_date
      into v_row;
      v_created := true;
      v_previous_status := null;
    exception when unique_violation then
      -- جهازين سجّلا نفس الطالب في نفس اللحظة: القيد الفريد بيرد واحد منهم
      -- لهنا — نحوّله لتحديث فيبقى سجل واحد فقط.
      select ar.id, ar.status, ar.homework_status, ar.teacher_id, ar.lesson_session_id
        into v_existing
        from public.attendance_records ar
        where ar.student_id = p_student_id and ar.attendance_date = v_day
        for update;
      if not found then
        raise exception 'تعذر رصد الحضور (سباق غير متوقع) — جرب تاني';
      end if;
      v_previous_status := v_existing.status;
      update public.attendance_records
        set status = coalesce(p_status, v_existing.status),
            homework_status = coalesce(p_homework_status, v_existing.homework_status),
            lesson_session_id = coalesce(p_lesson_session_id, v_existing.lesson_session_id),
            recorded_at = now()
        where id = v_existing.id
        returning id, teacher_id, student_id, status, homework_status, lesson_session_id, recorded_at, attendance_date
        into v_row;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'teacher_id', v_row.teacher_id,
    'student_id', v_row.student_id,
    'status', v_row.status,
    'homework_status', v_row.homework_status,
    'lesson_session_id', v_row.lesson_session_id,
    'recorded_at', v_row.recorded_at,
    'attendance_date', v_row.attendance_date,
    'previous_status', v_previous_status,
    'created', v_created
  );
end $$;

revoke all on function public._upsert_attendance_day(uuid, uuid, text, uuid, date, text) from public;
revoke all on function public._upsert_attendance_day(uuid, uuid, text, uuid, date, text) from anon;
revoke all on function public._upsert_attendance_day(uuid, uuid, text, uuid, date, text) from authenticated;

-- ----------------------------------------------------------------------------
-- 4) الدالة العامة: رصد/تعديل حضور طالب (نقاط + سجل + إشعار — كله من السيرفر)
--    p_student_id       : الطالب
--    p_status           : 'حاضر' | 'غائب'
--    p_lesson_session_id: الحصة (اختياري — بدون حصة = رصد يوم مستقل)
--    p_attendance_date  : يوم الرصد (اختياري — للأرصدة المؤجلة من وضع الأوفلاين)
-- ----------------------------------------------------------------------------
create or replace function public.set_student_attendance(
  p_student_id uuid,
  p_status text,
  p_lesson_session_id uuid default null,
  p_attendance_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_student_name text;
  v_points_present int;
  v_points_absent int;
  v_result jsonb;
  v_prev text;
  v_points_delta int := 0;
  v_new_points int;
begin
  if auth.uid() is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;
  if p_status not in ('حاضر', 'غائب') then
    raise exception 'حالة الحضور لازم تكون حاضر أو غائب';
  end if;

  select s.teacher_id, s.name into v_owner, v_student_name
    from public.students s where s.id = p_student_id;
  if v_owner is null then
    raise exception 'الطالب غير موجود';
  end if;
  if not can_access_workspace(v_owner) then
    raise exception 'مش مسموح لك تسجل حضور طالب مش في مساحتك';
  end if;
  if p_attendance_date is not null and abs(p_attendance_date - (now() at time zone 'utc')::date) > 2 then
    raise exception 'تاريخ الرصد بعيد جدًا عن اليوم — راجعه';
  end if;

  select coalesce(ts.points_present, 1), coalesce(ts.points_absent, -1)
    into v_points_present, v_points_absent
    from public.teacher_settings ts where ts.teacher_id = v_owner;

  v_result := public._upsert_attendance_day(v_owner, p_student_id, p_status, p_lesson_session_id, p_attendance_date, null);
  v_prev := v_result ->> 'previous_status';

  -- النقاط: فرق موثّق من حالة اليوم السابقة على السيرفر
  -- (يمنع تكرار النقاط لو الحصة اتفتحت تاني أو رصد من جهاز تاني)
  if v_prev = 'حاضر' then v_points_delta := v_points_delta - v_points_present; end if;
  if v_prev = 'غائب'  then v_points_delta := v_points_delta - v_points_absent;  end if;
  if p_status = 'حاضر' then v_points_delta := v_points_delta + v_points_present; end if;
  if p_status = 'غائب'  then v_points_delta := v_points_delta + v_points_absent;  end if;

  if v_points_delta <> 0 then
    update public.students
      set points = points + v_points_delta, updated_at = now()
      where id = p_student_id
      returning points into v_new_points;
  else
    select points into v_new_points from public.students where id = p_student_id;
  end if;

  update public.students
    set attendance_status = p_status, updated_at = now()
    where id = p_student_id and attendance_status is distinct from p_status;

  -- إشعار الأهل عند تغيير حالة اليوم (الرصد الجديد بيتنبّه له تريجر الإدراج)
  if v_prev is not null and v_prev <> p_status then
    begin
      insert into public.student_notifications (teacher_id, student_id, title, body, category, deep_link)
      values (v_owner, p_student_id, 'تحديث الحضور',
              format('تم تحديث حضور الطالب %s: %s.', v_student_name, p_status),
              'attendance', '/');
    exception when others then
      null; -- الإشعار اختياري — مش بيوقف الرصد
    end;
  end if;

  insert into public.behavior_logs (teacher_id, student_id, note, points_delta)
  values (v_owner, p_student_id, 'تسجيل الحضور: ' || p_status, v_points_delta);

  return v_result || jsonb_build_object(
    'points_delta', v_points_delta,
    'new_points', v_new_points,
    'student_name', v_student_name
  );
end $$;

revoke all on function public.set_student_attendance(uuid, text, uuid, date) from public;
revoke all on function public.set_student_attendance(uuid, text, uuid, date) from anon;
grant execute on function public.set_student_attendance(uuid, text, uuid, date) to authenticated;
grant execute on function public.set_student_attendance(uuid, text, uuid, date) to service_role;

-- ----------------------------------------------------------------------------
-- 5) إلغاء رصد الحضور (حذف حقيقي للسجل + تأرشيف + رجوع النقاط)
--    بعد الإلغاء: الطالب «لم يرصد» — المؤشر الأخضر بيختفي فعليًا والتحديث
--    بيرجّع نفس الحالة (مفيش سجل يرجّعه تاني).
-- ----------------------------------------------------------------------------
create or replace function public.remove_attendance(
  p_student_id uuid,
  p_lesson_session_id uuid default null,
  p_attendance_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_lesson_day date;
  v_day date;
  v_rec record;
  v_points_present int;
  v_points_absent int;
  v_points_delta int := 0;
  v_new_points int;
begin
  if auth.uid() is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;

  select s.teacher_id into v_owner from public.students s where s.id = p_student_id;
  if v_owner is null then
    raise exception 'الطالب غير موجود';
  end if;
  if not can_access_workspace(v_owner) then
    raise exception 'مش مسموح لك تلغي حضور طالب مش في مساحتك';
  end if;

  if p_lesson_session_id is not null then
    select ls.session_date into v_lesson_day
      from public.lesson_sessions ls where ls.id = p_lesson_session_id;
  end if;
  v_day := coalesce(v_lesson_day, p_attendance_date, (now() at time zone 'utc')::date);

  select ar.id, ar.teacher_id, ar.student_id, ar.status, ar.homework_status, ar.recorded_at, ar.lesson_session_id, ar.attendance_date
    into v_rec
    from public.attendance_records ar
    where ar.student_id = p_student_id and ar.attendance_date = v_day
    for update;

  if not found then
    return jsonb_build_object('ok', true, 'removed', false, 'previous_status', null, 'points_delta', 0);
  end if;

  select coalesce(ts.points_present, 1), coalesce(ts.points_absent, -1)
    into v_points_present, v_points_absent
    from public.teacher_settings ts where ts.teacher_id = v_owner;

  if v_rec.status = 'حاضر' then v_points_delta := - v_points_present; end if;
  if v_rec.status = 'غائب'  then v_points_delta := - v_points_absent;  end if;

  -- تأرشف السجل الملغي (مش حذف أعمى) قبل حذفه من الجدول الحي
  insert into public.attendance_records_archive
    (id, teacher_id, student_id, status, recorded_at, lesson_session_id, homework_status, attendance_date, archive_reason)
  values (v_rec.id, v_rec.teacher_id, v_rec.student_id, v_rec.status, v_rec.recorded_at,
          v_rec.lesson_session_id, v_rec.homework_status, v_rec.attendance_date, 'removed_by_user')
  on conflict (id) do nothing;

  delete from public.attendance_records where id = v_rec.id;

  if v_points_delta <> 0 then
    update public.students
      set points = points + v_points_delta, attendance_status = 'لم يرصد', updated_at = now()
      where id = p_student_id
      returning points into v_new_points;
  else
    update public.students
      set attendance_status = 'لم يرصد', updated_at = now()
      where id = p_student_id
      returning points into v_new_points;
  end if;

  insert into public.behavior_logs (teacher_id, student_id, note, points_delta)
  values (v_owner, p_student_id, 'إلغاء رصد الحضور: كان ' || v_rec.status, v_points_delta);

  return jsonb_build_object(
    'ok', true,
    'removed', true,
    'record_id', v_rec.id,
    'previous_status', v_rec.status,
    'previous_homework', v_rec.homework_status,
    'attendance_date', v_rec.attendance_date,
    'points_delta', v_points_delta,
    'new_points', v_new_points
  );
end $$;

revoke all on function public.remove_attendance(uuid, uuid, date) from public;
revoke all on function public.remove_attendance(uuid, uuid, date) from anon;
grant execute on function public.remove_attendance(uuid, uuid, date) to authenticated;
grant execute on function public.remove_attendance(uuid, uuid, date) to service_role;

-- ----------------------------------------------------------------------------
-- 6) توافق قديم: upsert_lesson_attendance (نفس التوقيع القائم + منطق اليوم)
--    النقاط والحالة العامة بيتظبطوا من set_student_attendance في الواجهة
--    الجديدة؛ ده شيم للأمان لو أي مسار قديم لسه بيناديه.
-- ----------------------------------------------------------------------------
create or replace function public.upsert_lesson_attendance(
  p_lesson_session_id uuid,
  p_student_id uuid,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;
  if p_status not in ('حاضر', 'غائب', 'لم يرصد') then
    raise exception 'حالة حضور غير صحيحة: %', p_status;
  end if;
  select s.teacher_id into v_owner from public.students s where s.id = p_student_id;
  if v_owner is null then
    raise exception 'الطالب غير موجود';
  end if;
  if not can_access_workspace(v_owner) then
    raise exception 'غير مصرح';
  end if;
  return public._upsert_attendance_day(v_owner, p_student_id, p_status, p_lesson_session_id, null, null);
end $$;

revoke all on function public.upsert_lesson_attendance(uuid, uuid, text) from public;
revoke all on function public.upsert_lesson_attendance(uuid, uuid, text) from anon;
grant execute on function public.upsert_lesson_attendance(uuid, uuid, text) to authenticated;
grant execute on function public.upsert_lesson_attendance(uuid, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 7) توافق قديم: upsert_lesson_homework (الواجب على سجل اليوم — بدون تكرار)
-- ----------------------------------------------------------------------------
create or replace function public.upsert_lesson_homework(
  p_lesson_session_id uuid,
  p_student_id uuid,
  p_homework_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;
  select s.teacher_id into v_owner from public.students s where s.id = p_student_id;
  if v_owner is null then
    raise exception 'الطالب غير موجود';
  end if;
  if not can_access_workspace(v_owner) then
    raise exception 'غير مصرح';
  end if;
  if not exists (select 1 from public.lesson_sessions ls where ls.id = p_lesson_session_id) then
    raise exception 'الحصة غير موجودة';
  end if;
  return public._upsert_attendance_day(v_owner, p_student_id, null, p_lesson_session_id, null, p_homework_status);
end $$;

revoke all on function public.upsert_lesson_homework(uuid, uuid, text) from public;
revoke all on function public.upsert_lesson_homework(uuid, uuid, text) from anon;
grant execute on function public.upsert_lesson_homework(uuid, uuid, text) to authenticated;
grant execute on function public.upsert_lesson_homework(uuid, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 8) finalize_lesson_session: إنهاء الحصة بمنطق اليوم الواحد
--    (نفس التوقيع القائم) — الطلاب غير المرصودين نهائيًا في يوم الحصة
--    بيتسجلوا غايبين؛ الطالب اللي ليه سجل اليوم (حتى لو مرتبط بحصة تانية
--    — ضيف مثلًا) مش بيتلمس خالص. النقاط بتتظبط زي الرصد اليدوي بالظبط.
-- ----------------------------------------------------------------------------
create or replace function public.finalize_lesson_session(
  p_lesson_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson record;
  v_day date;
  v_present int := 0;
  v_absent int := 0;
  v_newly_absent int := 0;
  v_points_absent int;
  v_new_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;

  select ls.id, ls.teacher_id, ls.group_name, ls.session_date, ls.status
    into v_lesson
    from public.lesson_sessions ls
    where ls.id = p_lesson_session_id
    for update;
  if not found then
    raise exception 'الحصة غير موجودة';
  end if;
  if not can_access_workspace(v_lesson.teacher_id) then
    raise exception 'مش مسموح لك تنهي حصة مش في مساحتك';
  end if;

  v_day := v_lesson.session_date;

  if v_lesson.status = 'completed' then
    select
      count(*) filter (where ar.status = 'حاضر'),
      count(*) filter (where ar.status = 'غائب')
    into v_present, v_absent
    from public.attendance_records ar
    join public.students s on s.id = ar.student_id
    where s.teacher_id = v_lesson.teacher_id
      and s.group_name = v_lesson.group_name
      and ar.attendance_date = v_day;
    return jsonb_build_object('ok', true, 'already_finalized', true,
      'present_count', v_present, 'absent_count', v_absent, 'session_date', v_day);
  end if;

  select coalesce(ts.points_absent, -1) into v_points_absent
    from public.teacher_settings ts where ts.teacher_id = v_lesson.teacher_id;

  -- (أ) تسجيل غياب من ليس له أي سجل في يوم الحصة (سجل واحد فقط — القيد الفريد)
  --     وإحصاء من أُدرج فعلًا (عشان النقاط تتطبق مرة واحدة فقط)
  with ins as (
    insert into public.attendance_records
      (teacher_id, student_id, status, homework_status, lesson_session_id, attendance_date, recorded_at)
    select v_lesson.teacher_id, s.id, 'غائب', 'لم يرصد', p_lesson_session_id, v_day, now()
    from public.students s
    where s.teacher_id = v_lesson.teacher_id
      and s.group_name = v_lesson.group_name
      and not exists (
        select 1 from public.attendance_records ar
        where ar.student_id = s.id and ar.attendance_date = v_day
      )
    on conflict (student_id, attendance_date) do nothing
    returning student_id
  )
  select coalesce(array_agg(student_id), '{}') into v_new_ids from ins;
  -- (التريجر بيوجّه إشعار الأهل لكل غياب جديد مُدرج)

  -- (ب) نقاط وسجل النشاط للغياب المُدرج جديد فقط (نفس معادلة الرصد اليدوي)
  --     اللي اترصدوا غياب يدويًا قبل كده خدوا نقاطهم من set_student_attendance
  if coalesce(array_length(v_new_ids, 1), 0) > 0 then
    update public.students s
      set points = s.points + v_points_absent, updated_at = now()
      where s.id = any(v_new_ids);
    insert into public.behavior_logs (teacher_id, student_id, note, points_delta)
    select v_lesson.teacher_id, sid, 'غياب نهائي الحصة: ' || v_lesson.group_name, v_points_absent
      from unnest(v_new_ids) as sid;
    v_newly_absent := array_length(v_new_ids, 1);
  end if;

  -- (ب-2) مزامنة حالة العرض لكل طلاب المجموعة المرصودين في اليوم
  update public.students s
    set attendance_status = ar.status, updated_at = now()
    from public.attendance_records ar
    where s.id = ar.student_id
      and ar.attendance_date = v_day
      and s.teacher_id = v_lesson.teacher_id
      and s.group_name = v_lesson.group_name
      and s.attendance_status is distinct from ar.status;

  -- (ج) إنهاء الحصة
  update public.lesson_sessions
    set status = 'completed', ended_at = now(), updated_at = now()
    where id = p_lesson_session_id;

  -- (د) الأعداد النهائية (على مستوى اليوم لمجموعة الحصة)
  select
    count(*) filter (where ar.status = 'حاضر'),
    count(*) filter (where ar.status = 'غائب')
  into v_present, v_absent
  from public.attendance_records ar
  join public.students s on s.id = ar.student_id
  where s.teacher_id = v_lesson.teacher_id
    and s.group_name = v_lesson.group_name
    and ar.attendance_date = v_day;

  return jsonb_build_object(
    'ok', true,
    'present_count', v_present,
    'absent_count', v_absent,
    'newly_marked_absent', v_newly_absent,
    'session_date', v_day
  );
end $$;

revoke all on function public.finalize_lesson_session(uuid) from public;
revoke all on function public.finalize_lesson_session(uuid) from anon;
grant execute on function public.finalize_lesson_session(uuid) to authenticated;
grant execute on function public.finalize_lesson_session(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 9) mark_group_absences: نفس التوقيع القائم + attendance_date صريح
-- ----------------------------------------------------------------------------
create or replace function public.mark_group_absences(
  p_teacher_id uuid,
  p_group_name text,
  p_session_date date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marked int := 0;
begin
  if auth.uid() is null or not can_access_workspace(p_teacher_id) then
    raise exception 'غير مصرح';
  end if;

  with ins as (
    insert into public.attendance_records
      (teacher_id, student_id, status, homework_status, attendance_date, recorded_at)
    select p_teacher_id, s.id, 'غائب', 'لم يرصد', p_session_date, now()
    from public.students s
    where s.teacher_id = p_teacher_id
      and s.group_name = p_group_name
      and not exists (
        select 1 from public.attendance_records ar
        where ar.student_id = s.id and ar.attendance_date = p_session_date
      )
    on conflict (student_id, attendance_date) do nothing
    returning student_id
  )
  select count(*) into v_marked from ins;

  return jsonb_build_object('marked_absent', v_marked, 'group_name', p_group_name, 'session_date', p_session_date);
end $$;

revoke all on function public.mark_group_absences(uuid, text, date) from public;
revoke all on function public.mark_group_absences(uuid, text, date) from anon;
grant execute on function public.mark_group_absences(uuid, text, date) to authenticated;
grant execute on function public.mark_group_absences(uuid, text, date) to service_role;

-- ----------------------------------------------------------------------------
-- 10) تريجر الإشعار: سجل «لم يرصد» (واجب فقط) مينفعش يبعت إشعار حضور
--     + قراءة بيانات الحصة من lesson_sessions الحالية (بدل session_logs القديم)
-- ----------------------------------------------------------------------------
create or replace function public.notify_attendance_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student record;
  v_lesson record;
  v_title text;
  v_body text;
  v_preferences jsonb;
begin
  -- سجل الواجب فقط (بدون حضور) مش بيوجّه إشعار حضور
  if new.status = 'لم يرصد' then
    return new;
  end if;

  select s.name, s.group_name into v_student
    from public.students s
    where s.id = new.student_id and s.teacher_id = new.teacher_id;

  select ts.notification_preferences into v_preferences
    from public.teacher_settings ts
    where ts.teacher_id = new.teacher_id;

  if coalesce((v_preferences ->> 'attendance')::boolean, true) = false then
    return new;
  end if;

  select ls.lesson_topic, ls.homework_text, ls.video_link into v_lesson
    from public.lesson_sessions ls
    where ls.id = new.lesson_session_id;

  if new.status = 'غائب' then
    v_title := 'غياب الطالب: ' || coalesce(v_student.name, 'الطالب');
    v_body := 'لم يحضر الطالب حصة اليوم.';
    if coalesce(v_lesson.video_link, '') <> '' then
      v_body := v_body || ' يمكنك مشاهدة شرح الحصة من خلال رابط الفيديو.';
    end if;
  else
    v_title := 'تسجيل حضور: ' || coalesce(v_student.name, 'الطالب');
    v_body := 'تم تسجيل حضور الطالب في الحصة.';
  end if;

  insert into public.student_notifications(teacher_id, student_id, title, body, category, deep_link)
  values (
    new.teacher_id,
    new.student_id,
    v_title,
    v_body || case when coalesce(v_lesson.homework_text, '') <> '' then ' الواجب: ' || v_lesson.homework_text else '' end,
    'attendance',
    '/'
  );
  return new;
exception when others then
  -- الحضور مينفعش يفشل علشان إشعار اختياري
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 11) resolve_student_by_qr: فك كود QR من السيرفر
--     الكود المسوح ممكن يكون:
--       (أ) رابط بوابة الطالب https://.../qr/TOKEN  ← ده اللي مكتوب على
--           بطاقة الطالب فعلًا — كان الماسح بيرفضه قبل كده!
--       (ب) التوكن نفسه (TOKEN)
--       (ج) معرّف الطالب UUID (توافق قديم)
--     التحقق كله سيرفر-سايد: التوكن فعال + الطالب موجود + الماسح مصرح له
--     (can_access_workspace) — مفيش بيانات حساسة جوه الكود نفسه.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_student_by_qr(p_payload text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text;
  v_code text;
  v_source text;
  v_student record;
  v_today_status text;
  v_day date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_raw := btrim(coalesce(p_payload, ''));
  if v_raw = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_payload');
  end if;

  v_code := v_raw;

  -- رابط بوابة؟ استخرج التوكن بعد /qr/
  if position('/qr/' in v_raw) > 0 then
    v_code := coalesce((regexp_match(v_raw, '/qr/([^?#\s]+)'))[1], '');
    v_code := btrim(v_code);
    if v_code = '' then
      return jsonb_build_object('ok', false, 'error', 'invalid_payload');
    end if;
  elsif v_raw ~ '^https?://' then
    -- رابط تاني مش بتاع البوابة — غير مدعوم
    return jsonb_build_object('ok', false, 'error', 'unsupported_url');
  end if;

  if v_code ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    -- UUID: مرجع طالب مباشر (توافق قديم) — لازم موجود + مصرح
    v_source := 'uuid';
    select s.id, s.teacher_id, s.name, s.code, s.group_name, s.stage, s.points, s.warnings, s.attendance_status
      into v_student
      from public.students s
      where s.id = v_code::uuid;
  else
    -- توكن: مرجع آمن مبهم — البحث من السيرفر فقط
    if length(v_code) < 6 or length(v_code) > 64 then
      return jsonb_build_object('ok', false, 'error', 'invalid_payload');
    end if;
    v_source := 'token';
    select s.id, s.teacher_id, s.name, s.code, s.group_name, s.stage, s.points, s.warnings, s.attendance_status
      into v_student
      from public.student_qr_tokens t
      join public.students s on s.id = t.student_id
      where t.token = v_code
        and t.revoked_at is null
      limit 1;
  end if;

  if v_student.id is null then
    return jsonb_build_object('ok', false, 'error',
      case when v_source = 'token' then 'token_invalid' else 'student_not_found' end);
  end if;

  -- الماسح لازم يكون صاحب الطالب أو مساعد في مساحته
  if not can_access_workspace(v_student.teacher_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select ar.status into v_today_status
    from public.attendance_records ar
    where ar.student_id = v_student.id and ar.attendance_date = v_day;

  return jsonb_build_object(
    'ok', true,
    'source', v_source,
    'student', jsonb_build_object(
      'id', v_student.id,
      'teacher_id', v_student.teacher_id,
      'name', v_student.name,
      'code', v_student.code,
      'group_name', v_student.group_name,
      'stage', v_student.stage,
      'points', v_student.points,
      'warnings', v_student.warnings,
      'attendance_status', v_student.attendance_status
    ),
    'today_status', coalesce(v_today_status, 'لم يرصد'),
    'already_present_today', (v_today_status = 'حاضر'),
    'attendance_date', v_day
  );
end $$;

revoke all on function public.resolve_student_by_qr(text) from public;
revoke all on function public.resolve_student_by_qr(text) from anon;
grant execute on function public.resolve_student_by_qr(text) to authenticated;
grant execute on function public.resolve_student_by_qr(text) to service_role;

-- ============================================================================
-- استيراد درجات Excel — الذرية والتدقيق
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 12) أعمدة التزامن + سجل تدقيق الدرجات (موجودة من 038 — تأكيد idempotent
--     عشان 039 يشتغل حتى لو 038 لسه مش شغال في بيئة معينة)
-- ----------------------------------------------------------------------------
alter table public.exams
  add column if not exists version bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

alter table public.exam_scores
  add column if not exists version bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.exam_score_audit_logs (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  change_type text not null check (change_type in ('max_score', 'student_score')),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  previous_value numeric,
  new_value numeric,
  reason text,
  exam_version bigint,
  created_at timestamptz not null default now()
);
create index if not exists idx_exam_audit_exam
  on public.exam_score_audit_logs(exam_id, created_at desc);
create index if not exists idx_exam_audit_teacher
  on public.exam_score_audit_logs(teacher_id, created_at desc);
alter table public.exam_score_audit_logs enable row level security;
drop policy if exists "exam_score_audit_workspace_read" on public.exam_score_audit_logs;
create policy "exam_score_audit_workspace_read" on public.exam_score_audit_logs
  for select using (can_access_workspace(teacher_id));

-- عمود المصدر: منين جه التعديل (يدوي / استيراد Excel)
alter table public.exam_score_audit_logs add column if not exists source text;

-- ----------------------------------------------------------------------------
-- 13) سجل عمليات الاستيراد (ملخص كل عملية استيراد — append-only)
-- ----------------------------------------------------------------------------
create table if not exists public.grade_import_logs (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  exam_id uuid not null references public.exams(id) on delete cascade,
  source_filename text,
  total_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  skipped_rows integer not null default 0,
  rejected_rows integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_grade_import_exam
  on public.grade_import_logs(exam_id, created_at desc);
alter table public.grade_import_logs enable row level security;
drop policy if exists "grade_import_workspace_read" on public.grade_import_logs;
create policy "grade_import_workspace_read" on public.grade_import_logs
  for select using (can_access_workspace(teacher_id));
-- مفيش سياسات insert/update/delete: الكتابة من دالة الاستيراد فقط

-- ----------------------------------------------------------------------------
-- 14) import_exam_grades: الاستيراد الذري
--     p_exam_id          : الامتحان
--     p_rows             : مصفوفة [{ student_id, score, row_index?, row_label?, allow_update? }]
--     p_expected_version : نسخة الامتحان اللي شافها المستخدم (حماية التزامن)
--     p_options          : { filename?, conflict_policy? } — السياسة الافتراضية
--                          الآمنة: درجة قائمة بدون allow_update = تخطي (مش كتم)
--     p_reason           : سبب/ملاحظة (اختياري)
--
--     كل التحقق سيرفر-سايد: الصلاحية + نطاق الطلاب + حضور يوم الامتحان +
--     الدرجة (0..العظمى) + منع التكرار داخل الاستيراد + حماية الدرجات القائمة.
--     أي صف غير صالح = رفض العملية كلها (لا استيراد جزئي أبدًا).
-- ----------------------------------------------------------------------------
create or replace function public.import_exam_grades(
  p_exam_id uuid,
  p_rows jsonb,
  p_expected_version bigint default null,
  p_options jsonb default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam record;
  v_row record;
  v_score_row record;
  v_student record;
  v_att_status text;
  v_max_total numeric;
  v_sections_count int;
  v_score numeric;
  v_existing_total numeric;
  v_action text;
  v_keys text[];
  v_scale numeric;
  v_val numeric;
  v_running numeric;
  v_new_sections jsonb;
  v_points_delta int;
  v_inserted int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_filename text;
  v_policy text;
  v_label text;
  v_seen_students text[];
  v_allow_update boolean;
begin
  if auth.uid() is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;

  -- الامتحان + القفل (تزامن مع تعديل العظمى/الدرجات)
  select e.teacher_id, e.title, e.sections, e.max_score_per_section, e.created_at, e.lesson_session_id, e.version
    into v_exam
    from public.exams e
    where e.id = p_exam_id
    for update;
  if not found then
    raise exception 'الامتحان غير موجود';
  end if;
  if not can_access_workspace(v_exam.teacher_id) then
    raise exception 'مش مسموح لك تستورد درجات في امتحان مش في مساحتك';
  end if;
  if p_expected_version is not null and v_exam.version <> p_expected_version then
    raise exception '[CONFLICT]الامتحان اتعدّل من مستخدم تاني أثناء الاستيراد — حدّث البيانات وجرب تاني';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'مفيش صفوف للاستيراد';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'الملف كبير جدًا (% صف) — قسّمه على دفعات', jsonb_array_length(p_rows);
  end if;

  v_filename := nullif(btrim(coalesce(p_options ->> 'filename', '')), '');
  v_policy := coalesce(nullif(btrim(coalesce(p_options ->> 'conflict_policy', '')), ''), 'skip');

  v_sections_count := coalesce(array_length(v_exam.sections, 1), 0);
  v_max_total := v_exam.max_score_per_section * v_sections_count;

  -- التحقق الكامل من كل صف قبل كتابة أي حاجة
  for v_row in select value as elem from jsonb_array_elements(p_rows) loop
    v_label := coalesce(nullif(btrim(coalesce(v_row.elem ->> 'row_label', '')), ''),
                        'صف ' || coalesce(v_row.elem ->> 'row_index', '?'));
    v_allow_update := coalesce((v_row.elem ->> 'allow_update')::boolean, false);

    -- (1) الدرجة: رقمية وموجبة وضمن العظمى (ممنوع القص التلقائي)
    begin
      v_score := nullif(btrim(coalesce(v_row.elem ->> 'score', '')), '')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'الدرجة في «%» مش رقم صحيح', v_label;
    end;
    if v_score < 0 then
      raise exception 'الدرجة في «%» سالبة (%) — مرفوضة', v_label, v_score;
    end if;
    if v_score > v_max_total then
      raise exception 'درجة غير صالحة: % بتتجاوز العظمى % (في «%»)', v_score, v_max_total, v_label;
    end if;

    -- (2) الطالب: موجود + في نطاق صاحب الامتحان + مش مكرر في نفس الاستيراد
    select s.id, s.name, s.teacher_id into v_student
      from public.students s
      where s.id = (v_row.elem ->> 'student_id')::uuid;
    if v_student.id is null then
      raise exception 'الطالب في «%» غير موجود', v_label;
    end if;
    if v_student.teacher_id <> v_exam.teacher_id then
      raise exception 'الطالب «%» مش تابع لمساحة الامتحان ده', v_label;
    end if;
    if v_student.id::text = any(coalesce(v_seen_students, '{}')) then
      raise exception 'الطالب «%» مكرر في الملف — راجع الصفوف', v_label;
    end if;
    v_seen_students := array_append(coalesce(v_seen_students, '{}'), v_student.id::text);

    -- (3) حضور يوم الامتحان (نفس منطق update_student_exam_score)
    v_att_status := null;
    if v_exam.lesson_session_id is not null then
      select a.status into v_att_status
        from public.attendance_records a
        where a.lesson_session_id = v_exam.lesson_session_id
          and a.student_id = v_student.id
        order by a.recorded_at desc
        limit 1;
    end if;
    if v_att_status is null then
      select a.status into v_att_status
        from public.attendance_records a
        where a.student_id = v_student.id
          and a.teacher_id = v_exam.teacher_id
          and a.attendance_date = (v_exam.created_at at time zone 'utc')::date
        order by a.recorded_at desc
        limit 1;
    end if;
    if v_att_status = 'غائب' then
      raise exception 'الطالب «%» غائب في يوم الامتحان — مينفعش ياخد درجة عادية', v_label;
    end if;

    -- (4) درجة قائمة؟ (حماية من الكتم الصامت)
    select es.id, es.total_score, es.section_scores into v_score_row
      from public.exam_scores es
      where es.exam_id = p_exam_id and es.student_id = v_student.id
      limit 1;

    if v_score_row.id is not null and not v_allow_update then
      if v_policy = 'error' then
        raise exception 'الطالب «%» عنده درجة قائمة (%) — الاستيراد مش هيكتب فوقها بدون إذنك', v_label, v_score_row.total_score;
      end if;
      -- السياسة الآمنة: تخطي (تُحسب في النتيجة)
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- توزيع الأقسام: نسبي للقديم / قسمة متساوية على أقسام الامتحان للجديد
    v_keys := coalesce(array(select jsonb_object_keys(coalesce(v_score_row.section_scores, '{}'::jsonb))), '{}');
    if coalesce(array_length(v_keys, 1), 0) = 0 then
      -- مفيش أقسام قديمة → وزّع على أقسام الامتحان نفسه
      v_keys := coalesce(v_exam.sections, '{}');
    end if;
    if coalesce(array_length(v_keys, 1), 0) = 0 then
      v_new_sections := '{}'::jsonb;
    else
      v_new_sections := '{}'::jsonb;
      v_running := 0;
      if v_score_row.id is not null and coalesce(v_score_row.total_score, 0) > 0 then
        v_scale := v_score / v_score_row.total_score;
        for i in 1 .. array_length(v_keys, 1) loop
          if i < array_length(v_keys, 1) then
            v_val := round(coalesce((v_score_row.section_scores ->> v_keys[i])::numeric, 0) * v_scale, 2);
            if v_val < 0 then v_val := 0; end if;
            v_new_sections := v_new_sections || jsonb_build_object(v_keys[i], v_val);
            v_running := v_running + v_val;
          else
            v_new_sections := v_new_sections || jsonb_build_object(v_keys[i],
              greatest(round(v_score - v_running, 2), 0));
          end if;
        end loop;
      else
        for i in 1 .. array_length(v_keys, 1) loop
          if i < array_length(v_keys, 1) then
            v_val := round(v_score / array_length(v_keys, 1), 2);
            v_new_sections := v_new_sections || jsonb_build_object(v_keys[i], v_val);
            v_running := v_running + v_val;
          else
            v_new_sections := v_new_sections || jsonb_build_object(v_keys[i],
              greatest(round(v_score - v_running, 2), 0));
          end if;
        end loop;
      end if;
    end if;

    -- النقاط: نفس معادلة الرصد الأصلي (الدرجة − نصف العظمى)
    if v_score_row.id is not null then
      v_points_delta := (round(v_score - v_max_total / 2) - round(coalesce(v_score_row.total_score, 0) - v_max_total / 2))::int;
    else
      v_points_delta := round(v_score - v_max_total / 2)::int;
    end if;

    if v_score_row.id is not null then
      update public.exam_scores
        set total_score = v_score,
            section_scores = v_new_sections,
            version = version + 1,
            updated_at = now()
        where id = v_score_row.id;
      v_updated := v_updated + 1;
    else
      insert into public.exam_scores
        (teacher_id, exam_id, student_id, lesson_session_id, section_scores, total_score)
      values (v_exam.teacher_id, p_exam_id, v_student.id, v_exam.lesson_session_id,
              coalesce(v_new_sections, '{}'::jsonb), v_score);
      v_inserted := v_inserted + 1;
    end if;

    if v_points_delta <> 0 then
      update public.students
        set points = points + v_points_delta, updated_at = now()
        where id = v_student.id;
    end if;

    insert into public.behavior_logs (teacher_id, student_id, note, points_delta)
    values (v_exam.teacher_id, v_student.id,
            'استيراد Excel (' || coalesce(v_filename, 'ملف') || ' — ' || v_exam.title || '): الدرجة ' || v_score,
            v_points_delta);

    insert into public.exam_score_audit_logs
      (teacher_id, actor_id, change_type, exam_id, student_id, previous_value, new_value, reason, exam_version, source)
    values
      (v_exam.teacher_id, auth.uid(), 'student_score', p_exam_id, v_student.id,
       v_score_row.total_score, v_score,
       nullif(btrim(coalesce(p_reason, '')), '') || coalesce(v_filename, ''),
       v_exam.version, 'excel_import');
  end loop;

  -- ملخص العملية (append-only)
  insert into public.grade_import_logs
    (teacher_id, actor_id, exam_id, source_filename, total_rows, inserted_rows, updated_rows, skipped_rows, rejected_rows)
  values
    (v_exam.teacher_id, auth.uid(), p_exam_id, v_filename,
     jsonb_array_length(p_rows), v_inserted, v_updated, v_skipped, 0);

  return jsonb_build_object(
    'ok', true,
    'exam_id', p_exam_id,
    'exam_version', v_exam.version,
    'total', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'rejected', 0,
    'filename', v_filename
  );
end $$;

revoke all on function public.import_exam_grades(uuid, jsonb, bigint, jsonb, text) from public;
revoke all on function public.import_exam_grades(uuid, jsonb, bigint, jsonb, text) from anon;
grant execute on function public.import_exam_grades(uuid, jsonb, bigint, jsonb, text) to authenticated;
grant execute on function public.import_exam_grades(uuid, jsonb, bigint, jsonb, text) to service_role;

-- ----------------------------------------------------------------------------
-- 15) Realtime: الحضور وسجل الاستيراد يوصلوا لحظيًا (idempotent)
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.attendance_records;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.grade_import_logs;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.students;
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 16) تريجر إشعار الحضور (drop+create — نفس اسم 025، idempotent)
-- ----------------------------------------------------------------------------
drop trigger if exists on_attendance_recorded_notify on public.attendance_records;
create trigger on_attendance_recorded_notify
after insert on public.attendance_records
for each row execute function public.notify_attendance_record();
