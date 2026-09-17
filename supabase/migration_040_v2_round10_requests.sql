-- ============================================================================
-- النخبة (Alnokhba) — Migration 040 (Round 10)
-- طلبات المستخدم الثلاث اللي محتاجة تغيير في قاعدة البيانات:
--   1) الإشعارات المهمة فقط توصل للهاتف (إنذار / حضور وإنهاء حصة / نتائج
--      امتحان / إعلان) — باقي الأنواع (واجب/دفع/متفرقات) بتفضل في تطبيق
--      البوابة من غير إزعاج بالـ Push.
--   2) إصلاح حالة الواجب «مكتمل» — القيود القديمة كانت بتمنعها.
--   3) حماية حذف الإعلانات: الحذف من لوحة المدرّس بيتزامن فورًا مع كل
--      البوابات (cascade + policies + منع تكرار تنبيهات الإعلانات).
-- ============================================================================
-- آمن وتراكمي 100%: لا يحذف أي بيانات ولا يغير أي سجلات قائمة.
-- يعمل مباشرة من Supabase SQL Editor (الصق الملف كاملاً ثم Run).
-- آمن لإعادة التشغيل أكثر من مرة (كل الأوامر idempotent).
--
-- v2 (إصلاح خطأ 42P13): النسخة الأولى كانت بتعرّف الدالة
-- upsert_lesson_homework بنوع إرجاع مختلف عن النسخة الموجودة في الإنتاج
-- (من Migration 039) — وPostgreSQL يرفض تغيير نوع الإرجاع ل دالة قائمة.
-- v2 بتعمل DROP للنسخة القديمة الأول ثم تعرّف الجديدة بنفس أسماء
-- المعاملات اللي الواجهة بتستخدمها بالفعل (p_lesson_session_id /
-- p_student_id / p_homework_status) — يعني الواجهة الشغالة حاليًا
-- هتفضل تشتغل من غير أي انقطاع.
-- ملاحظة: تشغيل النسخة الأولى عندك فشل واتراجع كله (transaction واحدة)
-- — مفيش أي جزء منها اتطبق، شغّل دي بس.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) فلتر الإشعارات المهمة (طلب المستخدم رقم 7)
--    queue_teacher_push_job هي البوابة الوحيدة اللي بتحول أي تنبيه لطالب
--    إلى مهمة Push على الهاتف. من دلوقتي بتفتح الباب للأنواع المهمة بس:
--      attendance    → تسجيل الحضور/الغياب + تحديث الحضور + إنهاء الحصة
--                      (إشعار «تحديث الحصة النهائي» فئته attendance)
--      exam_result   → نشر نتائج الامتحانات
--      announcement  → إعلانات لوحة الإعلانات (Broadcast من send_announcement)
--      warning       → الإنذارات (بتتسجل من الواجهة الجديدة Round 10)
--    باقي الفئات (homework / payment / عام...) بترجع new من غير مهمة Push —
--    يعني بتفضل ظاهرة في مركز تنبيهات المدرّس وبوابة الطالب، من غير هاتف
--    بيرن في وجوه الناس.
-- ----------------------------------------------------------------------------
create or replace function public.queue_teacher_push_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category is null
     or new.category not in ('attendance', 'exam_result', 'announcement', 'warning') then
    -- مش من الأنواع المهمة → مفيش Push (بس التطبيق/mركز التنبيهات زي ما هو)
    return new;
  end if;

  insert into public.push_notification_jobs(teacher_id, student_id, title, body, url, source_event_id)
  values(
    new.teacher_id,
    new.related_student_id,
    coalesce(new.title, 'تنبيه جديد'),
    coalesce(new.body, 'لديك تنبيه جديد'),
    '/',
    new.id
  );
  return new;
end;
$$;

-- (التريجر teacher_notification_push_job شغال على teacher_notification_events
--  من Migration 027 — تعريف الدالة الجديدة بيطبق عليه تلقائيًا.)

-- ----------------------------------------------------------------------------
-- 2) إصلاح «مكتمل» (طلب المستخدم رقم 6)
--    2-أ) إسقاط أي قيد CHECK على حالة الواجب مش بيعديها «مكتمل»
--         (السبب الجذري للـbug: القيد القديم كان بيقبل ناقص/لم يتم فقط).
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select conrelid::regclass as tbl,
           conname as name,
           pg_get_constraintdef(oid) as def
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.students'::regclass, 'public.attendance_records'::regclass)
      and pg_get_constraintdef(oid) ~ '(hw_status|homework_status)'
  loop
    -- لو التعريف مش محتوي على «مكتمل» فهو قيد قديم بيمنع الحالة — نشيله
    if position('مكتمل' in r.def) = 0 then
      execute format('alter table %s drop constraint if exists %I', r.tbl, r.name);
      raise notice 'dropped homework-status constraint % on %', r.name, r.tbl;
    end if;
  end loop;
exception when others then
  raise warning 'homework constraint cleanup skipped: %', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- 2-ب) إعادة تعريف upsert_lesson_homework بكل الحالات الأربعة
--      (مكتمل / ناقص / لم يتم / لم يرصد) — نفس سلوك الدالة القائمة مع
--      فتح الباب للحالة الناقصة، وبتفضل بترجع صف الحضور المحدّث.
-- ----------------------------------------------------------------------------
-- DROP الأول (إصلاح 42P13): النسخة القائمة من Migration 039 ليها نوع
-- إرجاع مختلف (مش attendance_records) — لازم تشيلها قبل التعريف الجديد.
-- الدالة بتتنادى من الواجهة بالاسم والمعاملات بس (مفيش تريجر ولا view
-- بيعتمد عليها) فالـ DROP آمن، والـ CREATE الجديد بيحصل في نفس الـ
-- transaction (DDL تراكمي في PostgreSQL) فمفيش لحظة تكون الدالة غايبة.
drop function if exists public.upsert_lesson_homework(uuid, uuid, text);

create or replace function public.upsert_lesson_homework(
  p_lesson_session_id uuid,
  p_student_id uuid,
  p_homework_status text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher uuid := auth.uid();
  v_row public.attendance_records;
  v_row_id uuid;
begin
  if v_teacher is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;

  if p_homework_status is null
     or p_homework_status not in ('مكتمل', 'ناقص', 'لم يتم', 'لم يرصد') then
    raise exception 'حالة الواجب غير صالحة: %', coalesce(p_homework_status, 'فارغة');
  end if;

  -- الحصة والطالب من مساحة عمل المدرّس الحالي بس
  if not exists (
    select 1 from public.lesson_sessions l
    where l.id = p_lesson_session_id and l.teacher_id = v_teacher
  ) then
    raise exception 'الحصة دي مش موجودة أو مش بتاعتك';
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.teacher_id = v_teacher
  ) then
    raise exception 'الطالب ده مش موجود أو مش بتاعك';
  end if;

  -- Upsert صريح (بدون ON CONFLICT target عشان يتوافق مع أي قيد فريد قائم
  -- على الجدول سواء قيد الحصة أو قيد «رصد واحد في اليوم»):
  --   (1) صف رصد موجود لنفس (المدرّس + الطالب + الحصة)؟ نحدّثه.
  --   (2) مفيش؟ نحاول نرصد جديد بحضور محايد «لم يرصد».
  --   (3) لو القيد الفريد رفض الإدراج (الطالب عنده رصد النهاردة من حصة
  --       تانية مثلًا) → نحدّث أحدث صف رصد للطالب النهاردة.
  select id into v_row_id
    from public.attendance_records
    where teacher_id = v_teacher
      and student_id = p_student_id
      and lesson_session_id = p_lesson_session_id
    order by recorded_at desc
    limit 1;

  if v_row_id is not null then
    update public.attendance_records
      set homework_status = p_homework_status,
          recorded_at = now()
      where id = v_row_id
      returning * into v_row;
  else
    begin
      insert into public.attendance_records
        (teacher_id, student_id, lesson_session_id, status, homework_status, recorded_at)
      values
        (v_teacher, p_student_id, p_lesson_session_id, 'لم يرصد', p_homework_status, now())
      returning * into v_row;
    exception when unique_violation then
      select id into v_row_id
        from public.attendance_records
        where teacher_id = v_teacher
          and student_id = p_student_id
          and recorded_at::date = current_date
        order by recorded_at desc
        limit 1;
      if v_row_id is null then
        raise;
      end if;
      update public.attendance_records
        set homework_status = p_homework_status,
            recorded_at = now()
        where id = v_row_id
        returning * into v_row;
    end;
  end if;

  -- مزامنة حالة الواجب على صف الطالب نفسه (عشان قائمة الطلاب والبوابة
  -- يظهروا آخر حالة من غير إعادة تحميل)
  update public.students
    set hw_status = p_homework_status,
        updated_at = now()
  where id = p_student_id and teacher_id = v_teacher;

  return v_row;
end;
$$;

revoke all on function public.upsert_lesson_homework(uuid, uuid, text) from public;
revoke all on function public.upsert_lesson_homework(uuid, uuid, text) from anon;
grant execute on function public.upsert_lesson_homework(uuid, uuid, text) to authenticated;
grant execute on function public.upsert_lesson_homework(uuid, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 3) حذف الإعلانات يتزامن مع الجميع (طلب المستخدم رقم 8)
--    3-أ) ربط cascade التنبيهات بالإعلان (لو موجود بالفعل بيتأكد بس)
--         → حذف الإعلان بيشيل التنبيه المرتبط معاه من بوابة كل طالب.
-- ----------------------------------------------------------------------------
alter table public.student_notifications
  add column if not exists announcement_id uuid;

do $$
declare
  r record;
begin
  -- نشيل أي FK قائم من student_notifications إلى announcements (بأي اسم)
  for r in
    select conrelid::regclass as tbl, conname as name
    from pg_constraint
    where contype = 'f'
      and conrelid = 'public.student_notifications'::regclass
      and confrelid = 'public.announcements'::regclass
  loop
    execute format('alter table %s drop constraint if exists %I', r.tbl, r.name);
  end loop;
end $$;

alter table public.student_notifications
  add constraint student_notifications_announcement_id_fkey
  foreign key (announcement_id)
  references public.announcements(id)
  on delete cascade;

create index if not exists idx_notifications_announcement
  on public.student_notifications(announcement_id);

-- ----------------------------------------------------------------------------
-- 3-ب) منع تكرار تنبيهات الإعلانات:
--      التريجر القديم on_announcement_inserted (Migration 023) كان بيعمل
--      تنبيه لكل طالب عند أي INSERT في جدول الإعلانات — send_announcement
--      (Migration 037) بتعمل التنبيهات بنفسها مع رابط الإعلان للـcascade.
--      لو التريجر القديم لسه موجود = إعلان واحد بيوصل مرتين. نشيله.
--      (drop if exists = لو متشال قبل كده مش هيحصل حاجة.)
-- ----------------------------------------------------------------------------
drop trigger if exists on_announcement_inserted on public.announcements;

-- ----------------------------------------------------------------------------
-- 3-ج) إعادة تأكيد سياسات الإعلانات (قراءة وحذف للمدرّس بس)
--      الحذف من الواجهة بيمشي على announcements_teacher_delete — لو السياسة
--      اتفكت في أي migration سابق، الحذف كان بيفشل بصمت. دي بتتأكد.
-- ----------------------------------------------------------------------------
drop policy if exists "announcements_teacher_read" on public.announcements;
create policy "announcements_teacher_read" on public.announcements
  for select using (auth.uid() = teacher_id);

drop policy if exists "announcements_teacher_delete" on public.announcements;
create policy "announcements_teacher_delete" on public.announcements
  for delete using (auth.uid() = teacher_id);

drop policy if exists "announcements_teacher_update" on public.announcements;
create policy "announcements_teacher_update" on public.announcements
  for update using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- ----------------------------------------------------------------------------
-- 3-د) البوابات المفتوحة بتتحدث فورًا عند الحذف (ping من الواجهة) —
--      والتغييرات على جدول الإعلانات نفسه بتوصل realtime للمدرّس المفتوح.
--      (الجدول عضو في publication من Round 7 — التأكيد idempotent.)
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.announcements;
exception
  when duplicate_object then null;  -- عضو أصلًا
  when undefined_table then null;    -- البيئة دي مش Supabase (تست محلي)
end $$;

-- ----------------------------------------------------------------------------
-- 4) ملاحظة نهاية: الإشعارات اللي وصلت قبل كده على شاشة الهاتف (Push
--    قديم) مش بتتشال — الحذف بينضف البوابة والتنبيات مستقبلًا.
--    migration_039 (QR attendance + Excel import) شغال في الإنتاج بالفعل —
--    مش محتاج أي خطوة هنا.
-- ----------------------------------------------------------------------------
