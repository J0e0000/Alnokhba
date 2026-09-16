-- ============================================================================
-- Migration 041 — الملف الرئيسي الموحّد (بديل migration_040)
-- اسم الملف: migration_041_master_fix_all.sql
-- ============================================================================
-- ⚠️ مهم: الملف ده هو البديل النهائي لـ migration_040_final_attendance_fix.sql
--    لو حاولت تشغّل 040 قبل كده وظهرلك الخطأ:
--        ERROR 42P13: cannot change return type of existing function
--        HINT: Use DROP FUNCTION upsert_lesson_attendance(uuid,uuid,text) first.
--    فدي بالظبط المشكلة اللي الملف ده بيحلها — شغّل ده بس ومتشتغلش 040 خالص.
--
-- سبب خطأ 42P13:
--    الدوال الثلاثة القديمة الموجودة على قاعدة البيانات الحقيقية
--    (upsert_lesson_attendance / upsert_lesson_homework / finalize_lesson_session)
--    ليها نوع إرجاع قديم مختلف، وPostgreSQL مش بيسمح لأمر CREATE OR REPLACE
--    يغيّر نوع الإرجاع لدالة موجودة — لازم تُسقَط الدالة الأول ثم تُبنى من جديد.
--    الجزء 0.0 هنا بيعمل السقوط ده بأمان قبل إعادة البناء.
--
-- والمشكلة الأصلية اللي الملف بيصلّحها (فحص 100 طالب / 105 سجل على قاعدة
-- البيانات الحقيقية):
--   * الطلاب عندهم سجلات حضور في أيام مختلفة عادي (الحفظ شغال عبر الأيام).
--   * لكن مفيش ولا طالب واحد عنده سجلين في نفس اليوم → فيه قيد/فهرس فريد
--     «سجل واحد لليوم» بيمنع تسجيل حضور/غياب حصة تانية لنفس الطالب في
--     نفس اليوم.
--   * النتيجة في الواجهة: الضغطة الثانية لحصة تانية في نفس اليوم بترجع
--     خطأ «تعذر حفظ حضور الطالب ده — حاول مرة أخرى»، الحالة بترجع لوضعها
--     القديم، ومفيش صف بيتسجل في قاعدة البيانات خالص.
--   * نفس القيد بيوّل «أنهِ الحصة» يفشل لو الطالب ليه سجل في حصة تانية
--     بنفس اليوم (تحويل غير المرصودين لغياب بيفشل).
--
-- الإصلاح (كله idempotent — آمن لإعادة التشغيل أكثر من مرة):
--   0) حارس 42P13: إسقاط الدوال القديمة بأمان قبل إعادة بنائها (مع
--      معالحة الكائنات المعتمدة عليها من غير فشل التشغيل).
--   1) تنظيف المكررات الفعلية (لو وجدت) بأمان — مع الاحتفاظ بالأحدث،
--      ومن غير مس أي تاريخ قديم مختلف اليوم.
--   2) إسقاط كل القيود/الفهارس الفريدة القديمة على attendance_records
--      بأسمائها الفعلية من الكتالوج (مش باسم متوقّع) — يشمل فهارس
--      التعابير زي «طالب × يوم».
--   3) فهرس فريد جديد: سجل واحد لكل (طالب × حصة) — يسمح بعدة حصص
--      في نفس اليوم ويمنع التكرار داخل نفس الحصة.
--   4) إعادة بناء upsert_lesson_attendance / upsert_lesson_homework /
--      finalize_lesson_session بنفس التواقيع القديمة بالظبط (الواجهة
--      المرفوعة هتشتغل من غير أي تعديل فيها):
--        * upsert_lesson_attendance(p_lesson_session_id, p_student_id, p_status)
--        * upsert_lesson_homework(p_lesson_session_id, p_student_id, p_homework_status)
--        * finalize_lesson_session(p_lesson_session_id) → {present_count, absent_count}
--   5) كل دالة بتزامن سجل الطالب (attendance_status / hw_status) بنفسها
--      عشان «السجل» و«الحصص» والبوابة يفضلوا متطابقين دايمًا.
--   6) بوليصات RLS تتأكد بنفس نمط migration 019.
--   7) فحص ذاتي بعد التشغيل: لو رجع أي فهرس فريد «سجل واحد لليوم»
--      مستقبلًا هيظهر كتحذير في مخرجات SQL Editor.
--
-- ملاحظات توافق:
--   * النقاط (students.points) متتلمسش من الدوال — الواجهة هي اللي
--     بتحدّثها بالفعل فمفيش احتمال عدّ مزدوج.
--   * إشعار «غياب/تسجيل حضور الطالب» بيفضل شغال بنفس التريجر القديم
--     (after insert) — مفيش تعديل عليه.
--   * الدوال security definer ومتحققة من صلاحية الوصول لمساحة العمل
--     (can_access_workspace) زي باقي النظام.
--   * الملف مستقل تمامًا: مش بيعتمد على أي migration قبله، ومش بيمسح
--     أي بيانات تاريخية صحيحة، وآمن لو جزء من 040 اشتغل قبل كده أو لأ.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0.0) حارس إصلاح خطأ النشر 42P13 — إسقاط الدوال القديمة قبل إعادة البناء
--      (لو فيه كائنات تانية معتمدة على دالة، بنسقطها معاها بأمان مع إشعار
--       NOTICE واضح — التشغيل ميفشلش في أي حالة)
-- ----------------------------------------------------------------------------
do $drop_guard$
begin
  begin
    drop function if exists public.upsert_lesson_attendance(uuid, uuid, text);
  exception
    when others then
      if sqlstate <> '2BP01' then
        raise;  -- أي خطأ غير «كائنات معتمدة» بنرميه زي ما هو
      end if;
      raise notice 'upsert_lesson_attendance: فيه كائنات معتمدة على الدالة — هتتسقط معاها (CASCADE)';
      drop function if exists public.upsert_lesson_attendance(uuid, uuid, text) cascade;
  end;

  begin
    drop function if exists public.upsert_lesson_homework(uuid, uuid, text);
  exception
    when others then
      if sqlstate <> '2BP01' then
        raise;
      end if;
      raise notice 'upsert_lesson_homework: فيه كائنات معتمدة على الدالة — هتتسقط معاها (CASCADE)';
      drop function if exists public.upsert_lesson_homework(uuid, uuid, text) cascade;
  end;

  begin
    drop function if exists public.finalize_lesson_session(uuid);
  exception
    when others then
      if sqlstate <> '2BP01' then
        raise;
      end if;
      raise notice 'finalize_lesson_session: فيه كائنات معتمدة على الدالة — هتتسقط معاها (CASCADE)';
      drop function if exists public.finalize_lesson_session(uuid) cascade;
  end;
end $drop_guard$;

-- ----------------------------------------------------------------------------
-- 0.1) تنظيف المكررات الفعلية قبل إنشاء الفهرس الفريد (idempotent)
-- ----------------------------------------------------------------------------
-- (أ) مكررات نفس (الطالب × الحصة): نحتفظ بالأحدث (recorded_at ثم id).
delete from public.attendance_records a
using public.attendance_records b
where a.student_id = b.student_id
  and a.lesson_session_id is not null
  and a.lesson_session_id = b.lesson_session_id
  and (a.recorded_at, a.id) < (b.recorded_at, b.id);

-- (ب) مكررات «نفس الطالب × نفس اليوم» للسجلات العامة القديمة (بدون حصة)
--     فقط — من غير مس أي سجل ليوم مختلف (الحفاظ على التاريخ كامل).
delete from public.attendance_records a
using public.attendance_records b
where a.student_id = b.student_id
  and a.lesson_session_id is null
  and b.lesson_session_id is null
  and (a.recorded_at at time zone 'UTC')::date
      = (b.recorded_at at time zone 'UTC')::date
  and (a.recorded_at, a.id) < (b.recorded_at, b.id);

-- ----------------------------------------------------------------------------
-- 0.2) إسقاط كل القيود/الفهارس الفريدة القديمة على attendance_records
--      (الكتالوج هو مصدر الحقيقة — مش أسماء متوقّعة)
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  -- قيود فريدة (constraints) غير المفتاح الأساسي
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.attendance_records'::regclass
      and contype in ('u', 'p')
      and conname <> 'attendance_records_pkey'
  loop
    execute format('alter table public.attendance_records drop constraint if exists %I', r.conname);
  end loop;

  -- فهارس فريدة غير فهرس المفتاح الأساسي (يشمل فهارس التعابير زي
  -- «طالب × يوم» اللي كانت بتمنع حصص متعددة في نفس اليوم)
  for r in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'attendance_records'
      and indexdef ilike 'create unique index%'
      and indexname not in (
        select conindid::regclass::text
        from pg_constraint
        where conrelid = 'public.attendance_records'::regclass and contype = 'p'
      )
  loop
    execute format('drop index if exists public.%I', r.indexname);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 0.3) الفهرس الفريد الجديد: سجل واحد لكل (طالب × حصة)
--      يسمح بعدة حصص لنفس الطالب في نفس اليوم، ويمنع التكرار داخل الحصة
-- ----------------------------------------------------------------------------
create unique index if not exists attendance_records_student_lesson_uniq
  on public.attendance_records (student_id, lesson_session_id)
  where lesson_session_id is not null;

-- فهارس عادية (غير فريدة) لتسريع استعلامات «كل سجلات حصة» و«كل سجلات طالب»
create index if not exists attendance_records_lesson_idx
  on public.attendance_records (lesson_session_id)
  where lesson_session_id is not null;
create index if not exists attendance_records_student_idx
  on public.attendance_records (student_id);

-- ----------------------------------------------------------------------------
-- 0.4) upsert_lesson_attendance — رصد حضور طالب داخل حصة (نسخة مُصلَّحة)
-- ----------------------------------------------------------------------------
create or replace function public.upsert_lesson_attendance(
  p_lesson_session_id uuid,
  p_student_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson public.lesson_sessions%rowtype;
  v_student public.students%rowtype;
  v_existing public.attendance_records%rowtype;
begin
  -- تسجيل الدخول إلزامي
  if auth.uid() is null then
    raise exception 'لازم تسجّل دخول الأول عشان تسجّل الحضور'
      using errcode = 'P0001';
  end if;

  -- الحالة مسموحة؟
  if p_status is null or p_status not in ('حاضر', 'غائب', 'لم يرصد') then
    raise exception 'حالة حضور غير صحيحة: %', coalesce(p_status, 'فارغة')
      using errcode = 'P0001';
  end if;

  -- الحصة موجودة؟
  select * into v_lesson from public.lesson_sessions
  where id = p_lesson_session_id;
  if v_lesson.id is null then
    raise exception 'الحصة دي مش موجودة — حدّث الصفحة وحاول تاني'
      using errcode = 'P0001';
  end if;

  -- صلاحية الوصول لمساحة عمل صاحب الحصة (المالك أو مساعده أو جلسة دعم نشطة)
  if not public.can_access_workspace(v_lesson.teacher_id) then
    raise exception 'الحصة دي مش متاحة لحسابك'
      using errcode = 'P0001';
  end if;

  -- الحصة المنتهية للقراءة فقط
  if v_lesson.status <> 'open' then
    raise exception 'الحصة دي خلصت خلاص — افتح حصة جديدة عشان تسجّل الحضور'
      using errcode = 'P0001';
  end if;

  -- الطالب موجود وينتمي لنفس مساحة العمل؟
  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null then
    raise exception 'الطالب ده مش موجود'
      using errcode = 'P0001';
  end if;
  if v_student.teacher_id <> v_lesson.teacher_id
     and not public.can_access_workspace(v_student.teacher_id) then
    raise exception 'الطالب ده مش من حسابك'
      using errcode = 'P0001';
  end if;

  -- السجل موجود لنفس (الطالب × الحصة)؟ حدّثه. لأ؟ أنشئه.
  -- ملاحظة: عمدًا منستخدمش ON CONFLICT — عشان الدالة تشتغل حتى لو
  -- الفهرس الفريد مش متطابق لأي سبب. سباق التزامن بيتغطى بالفهرس
  -- الفريد (unique_violation) فنحوّله لتحديث.
  begin
    select * into v_existing
    from public.attendance_records
    where student_id = p_student_id
      and lesson_session_id = p_lesson_session_id
    limit 1;

    if v_existing.id is not null then
      update public.attendance_records
      set status = p_status,
          recorded_at = now(),
          teacher_id = v_lesson.teacher_id
      where id = v_existing.id
      returning * into v_existing;
    else
      insert into public.attendance_records
        (teacher_id, student_id, lesson_session_id, status, homework_status, recorded_at)
      values
        (v_lesson.teacher_id, p_student_id, p_lesson_session_id, p_status, 'لم يرصد', now())
      returning * into v_existing;
    end if;
  exception
    when unique_violation then
      -- طلب متزامن سبقنا وأنشأ السجل — حدّثه بدل ما نفشل
      update public.attendance_records
      set status = p_status,
          recorded_at = now(),
          teacher_id = v_lesson.teacher_id
      where student_id = p_student_id
        and lesson_session_id = p_lesson_session_id
      returning * into v_existing;
  end;

  -- مزامنة سجل الطالب (السجل ↔ الحصص ↔ البوابة) — النقاط مسؤولية الواجهة
  update public.students
  set attendance_status = p_status,
      updated_at = now()
  where id = p_student_id
    and (attendance_status is distinct from p_status or updated_at < now() - interval '1 second');

  return to_jsonb(v_existing);
end;
$$;

revoke execute on function public.upsert_lesson_attendance(uuid, uuid, text) from public, anon;
grant execute on function public.upsert_lesson_attendance(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 0.5) upsert_lesson_homework — رصد واجب طالب داخل حصة (نسخة مُصلَّحة)
-- ----------------------------------------------------------------------------
create or replace function public.upsert_lesson_homework(
  p_lesson_session_id uuid,
  p_student_id uuid,
  p_homework_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson public.lesson_sessions%rowtype;
  v_student public.students%rowtype;
  v_existing public.attendance_records%rowtype;
begin
  if auth.uid() is null then
    raise exception 'لازم تسجّل دخول الأول عشان تسجّل الواجب'
      using errcode = 'P0001';
  end if;

  if p_homework_status is null or p_homework_status not in ('تم', 'ناقص', 'لم يتم', 'لم يرصد', 'مكتمل') then
    raise exception 'حالة واجب غير صحيحة: %', coalesce(p_homework_status, 'فارغة')
      using errcode = 'P0001';
  end if;

  select * into v_lesson from public.lesson_sessions
  where id = p_lesson_session_id;
  if v_lesson.id is null then
    raise exception 'الحصة دي مش موجودة — حدّث الصفحة وحاول تاني'
      using errcode = 'P0001';
  end if;

  if not public.can_access_workspace(v_lesson.teacher_id) then
    raise exception 'الحصة دي مش متاحة لحسابك'
      using errcode = 'P0001';
  end if;

  if v_lesson.status <> 'open' then
    raise exception 'الحصة دي خلصت خلاص — افتح حصة جديدة عشان تسجّل الواجب'
      using errcode = 'P0001';
  end if;

  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null then
    raise exception 'الطالب ده مش موجود'
      using errcode = 'P0001';
  end if;
  if v_student.teacher_id <> v_lesson.teacher_id
     and not public.can_access_workspace(v_student.teacher_id) then
    raise exception 'الطالب ده مش من حسابك'
      using errcode = 'P0001';
  end if;

  begin
    select * into v_existing
    from public.attendance_records
    where student_id = p_student_id
      and lesson_session_id = p_lesson_session_id
    limit 1;

    if v_existing.id is not null then
      update public.attendance_records
      set homework_status = p_homework_status,
          recorded_at = now(),
          teacher_id = v_lesson.teacher_id
      where id = v_existing.id
      returning * into v_existing;
    else
      -- تسجيل واجب قبل الحضور (مسموح) — سطر جديد بحضور «لم يرصد»
      insert into public.attendance_records
        (teacher_id, student_id, lesson_session_id, status, homework_status, recorded_at)
      values
        (v_lesson.teacher_id, p_student_id, p_lesson_session_id, 'لم يرصد', p_homework_status, now())
      returning * into v_existing;
    end if;
  exception
    when unique_violation then
      update public.attendance_records
      set homework_status = p_homework_status,
          recorded_at = now(),
          teacher_id = v_lesson.teacher_id
      where student_id = p_student_id
        and lesson_session_id = p_lesson_session_id
      returning * into v_existing;
  end;

  update public.students
  set hw_status = p_homework_status,
      updated_at = now()
  where id = p_student_id
    and (hw_status is distinct from p_homework_status or updated_at < now() - interval '1 second');

  return to_jsonb(v_existing);
end;
$$;

revoke execute on function public.upsert_lesson_homework(uuid, uuid, text) from public, anon;
grant execute on function public.upsert_lesson_homework(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 0.6) finalize_lesson_session — إنهاء الحصة (نسخة مُصلَّحة)
--      * يحوّل غير المرصودين في مجموعة الحصة إلى «غائب» (زي النسخة القديمة)
--      * يسمح بإنهاء حصص متعددة لنفس المجموعة في نفس اليوم
--      * يعيد {present_count, absent_count} للواجهة
-- ----------------------------------------------------------------------------
create or replace function public.finalize_lesson_session(
  p_lesson_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson public.lesson_sessions%rowtype;
  v_present integer := 0;
  v_absent integer := 0;
  v_auto_absent integer := 0;
begin
  if auth.uid() is null then
    raise exception 'لازم تسجّل دخول الأول عشان تنهي الحصة'
      using errcode = 'P0001';
  end if;

  select * into v_lesson from public.lesson_sessions
  where id = p_lesson_session_id;
  if v_lesson.id is null then
    raise exception 'الحصة دي مش موجودة'
      using errcode = 'P0001';
  end if;

  if not public.can_access_workspace(v_lesson.teacher_id) then
    raise exception 'الحصة دي مش متاحة لحسابك'
      using errcode = 'P0001';
  end if;

  -- idempotent: حصة خلصت خلاص؟ رجّع الأرقام الحالية من غير أي كتابة
  if v_lesson.status = 'completed' then
    select count(*) filter (where status = 'حاضر'),
           count(*) filter (where status = 'غائب')
    into v_present, v_absent
    from public.attendance_records
    where lesson_session_id = p_lesson_session_id;
    return jsonb_build_object('present_count', v_present, 'absent_count', v_absent, 'already_finalized', true);
  end if;

  -- 1) صفوف «لم يرصد» جوّه الحصة دي نفسها → غائب (تحديث بدون تريجر)
  update public.attendance_records
  set status = 'غائب', recorded_at = now()
  where lesson_session_id = p_lesson_session_id
    and status = 'لم يرصد';

  -- 2) طلاب مجموعة الحصة من غير أي صف للحصة دي → صف «غائب» جديد
  --    (التريجر القديم بيبعت إشعار الغياب للأهل تلقائيًا لكل صف جديد)
  insert into public.attendance_records
    (teacher_id, student_id, lesson_session_id, status, homework_status, recorded_at)
  select v_lesson.teacher_id, s.id, p_lesson_session_id, 'غائب', 'لم يرصد', now()
  from public.students s
  where s.teacher_id = v_lesson.teacher_id
    and s.group_name = v_lesson.group_name
    and not exists (
      select 1 from public.attendance_records ar
      where ar.student_id = s.id
        and ar.lesson_session_id = p_lesson_session_id
    );
  get diagnostics v_auto_absent = row_count;

  -- 3) مزامنة سجل كل طالب اتسجّل غيابه تلقائيًا (بدون لمس النقاط)
  update public.students s
  set attendance_status = 'غائب',
      updated_at = now()
  from public.attendance_records ar
  where ar.lesson_session_id = p_lesson_session_id
    and ar.student_id = s.id
    and ar.status = 'غائب'
    and s.attendance_status is distinct from 'غائب';

  -- 4) إنهاء الحصة نفسها
  update public.lesson_sessions
  set status = 'completed',
      ended_at = now(),
      updated_at = now()
  where id = p_lesson_session_id
  returning * into v_lesson;

  -- 5) الأرقام النهائية
  select count(*) filter (where status = 'حاضر'),
         count(*) filter (where status = 'غائب')
  into v_present, v_absent
  from public.attendance_records
  where lesson_session_id = p_lesson_session_id;

  return jsonb_build_object(
    'present_count', v_present,
    'absent_count', v_absent,
    'auto_absent_count', v_auto_absent
  );
end;
$$;

revoke execute on function public.finalize_lesson_session(uuid) from public, anon;
grant execute on function public.finalize_lesson_session(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 0.7) بوليصات RLS على attendance_records تتسق مع الوصول عبر مساحة العمل
--      (إعادة التأكيد — نفس نمط migration 019 بالظبط، idempotent)
-- ----------------------------------------------------------------------------
alter table public.attendance_records enable row level security;

drop policy if exists "attendance_workspace_access" on public.attendance_records;
create policy "attendance_workspace_access" on public.attendance_records
  for all
  using (public.can_access_workspace(teacher_id))
  with check (public.can_access_workspace(teacher_id));

-- ----------------------------------------------------------------------------
-- 0.8) حماية من قيد «سجل واحد لليوم» يرجع مستقبلًا: فحص ذاتي بعد التشغيل
--      (يظهر كتحذير في مخرجات SQL Editor لو حد عمل قيد يومي بعد كده)
-- ----------------------------------------------------------------------------
do $$
declare
  v_bad_count integer;
begin
  select count(*) into v_bad_count
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'attendance_records'
    and indexdef ilike 'create unique index%'
    and indexname <> 'attendance_records_student_lesson_uniq'
    and indexname <> 'attendance_records_pkey';
  if v_bad_count > 0 then
    raise warning 'فيه % فهرس فريد إضافي على attendance_records — راجعهم، ممكن يمنعوا تسجيل أكثر من حصة في اليوم', v_bad_count;
  end if;
end;
$$;
