-- ============================================================================
-- النخبة (Alnokhba) — Migration 039 (Round 10) — ملف واحد يجمع كل الإصلاحات
-- ============================================================================
-- الملف ده هو الملف الوحيد المطلوب تشغيله. بيصلح:
--
--   (A) خطأ 42P13 + فشل حفظ الحضور/الواجب:
--       "cannot change return type of existing function
--        Use DROP FUNCTION upsert_lesson_attendance(uuid,uuid,text) first"
--       → الدالتين بيتشالوا الأول (بكل توقيعاتهم الممكنة) ثم بيتعملوا من
--         جديد بشكل ذري وصحيح، مع فهرس فريد يمنع تكرار سجلات الحضور
--         لنفس (الطالب × الحصة) — وهو نفسه السبب اللي كان ممكن يخلي
--         الحفظ يفشل بـ unique constraint لو الدالة القديمة كانت بتعمل
--         INSERT عادي من غير ON CONFLICT.
--
--   (B) لوحة الإعلانات (Migration 037) — نفس المحتوى، آمن لإعادة التشغيل
--       لو كنت شغلته قبل كده.
--
--   (C) تعديل درجات الامتحانات (Migration 038) — نفس المحتوى، آمن
--       لإعادة التشغيل لو كنت شغلته قبل كده.
--
-- طريقة التشغيل: Supabase Dashboard → SQL Editor → الصق الملف كاملاً → Run.
-- آمن 100% لإعادة التشغيل أكثر من مرة (كل الأوامر idempotent).
-- لا يحذف أي بيانات إلا سجلات حضور مكررة لنفس (الطالب × الحصة) —
-- الاحتفاظ دايمًا بأحدث سجل (نفس اللي الواجهة بتعرضه أصلًا).
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- القسم A — إصلاح 42P13 + حفظ الحضور والواجب
-- ═══════════════════════════════════════════════════════════════════════════

-- A1) التأكد من عمودي الحصة والواجب في جدول الحضور
--     (لو موجودين أصلًا — ولا سطر بيتنفذ، تمامًا زي ما هو)
alter table public.attendance_records
  add column if not exists lesson_session_id uuid references public.lesson_sessions(id) on delete cascade;

alter table public.attendance_records
  add column if not exists homework_status text not null default 'لم يرصد';

create index if not exists idx_attendance_lesson_student
  on public.attendance_records(lesson_session_id, student_id);

-- A2) إزالة أي تكرار قديم لنفس (الطالب × الحصة) قبل الفهرس الفريد
--     بنحتفظ بأحدث سجل (recorded_at ثم id) — نفس السجل اللي الواجهة بتعرضه.
delete from public.attendance_records a
using public.attendance_records b
where a.lesson_session_id is not null
  and a.lesson_session_id = b.lesson_session_id
  and a.student_id = b.student_id
  and a.id <> b.id
  and (a.recorded_at, a.id) < (b.recorded_at, b.id);

-- A3) فهرس فريد: سجل واحد فقط لكل (طالب × حصة) — أساس الـ upsert الذري
--     (الصفوف القديمة بدون حصة lesson_session_id = NULL مش متأثرة خالص:
--      NULL مش بيتصادم مع NULL في Postgres)
create unique index if not exists uq_attendance_lesson_student
  on public.attendance_records(lesson_session_id, student_id);

-- A4) حذف الدالتين القديمتين بكل التوقيعات الممكنة —
--     ده هو إصلاح 42P13: ممنوع تغيير return type لعملية موجودة،
--     فبنشيلها الأول ثم ننشئها بالشكل الصحيح.
do $drop_overloads$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('upsert_lesson_attendance', 'upsert_lesson_homework')
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end
$drop_overloads$;

-- A5) الدالة الجديدة: تسجيل/تحديث حضور طالب في حصة (upsert ذري)
--     - بترجّع صف attendance_records نفسه (الواجهة بتستخدمه للتحديث الفوري)
--     - SECURITY DEFINER + can_access_workspace: نفس نظام صلاحيات باقي
--       الدوال (صاحب مساحة العمل أو أحد أعضائها) — ومش معتمدة على حالة
--       policies الجدول، عشان الحفظ ميقعش تاني لو policy اتكسرت
--     - ON CONFLICT على الفهرس الفريد: الضغطة التانية لنفس الطالب في
--       نفس الحصة بتحدّث الصف القديم بدل ما تفشل بـ duplicate key
create or replace function public.upsert_lesson_attendance(
  p_lesson_session_id uuid,
  p_student_id uuid,
  p_status text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_teacher_id uuid;
  v_row public.attendance_records;
begin
  -- الحصة موجودة؟ (ومنها بنجيب صاحب مساحة العمل المصرّح له)
  select ls.teacher_id into v_teacher_id
  from public.lesson_sessions ls
  where ls.id = p_lesson_session_id;

  if v_teacher_id is null then
    raise exception 'lesson_not_found';
  end if;

  -- الصلاحية: صاحب مساحة العمل أو أحد أعضائها (نفس can_access_workspace)
  if not public.can_access_workspace(v_teacher_id) then
    raise exception 'not_authorized';
  end if;

  -- تحقق قيمة الحالة (مثال: حاضر / غائب / لم يرصد)
  if p_status is null or length(btrim(p_status)) = 0 or length(p_status) > 60 then
    raise exception 'invalid_status';
  end if;

  -- upsert ذري: صف واحد لكل (طالب × حصة)
  insert into public.attendance_records as ar
    (teacher_id, student_id, lesson_session_id, status, homework_status, recorded_at)
  values
    (v_teacher_id, p_student_id, p_lesson_session_id, p_status, 'لم يرصد', now())
  on conflict (lesson_session_id, student_id)
  do update
    set status = excluded.status,
        recorded_at = now()
  returning ar.* into v_row;

  return v_row;
end;
$fn$;

-- A6) الدالة الجديدة: تقييم واجب طالب في حصة (نفس النمط — من غير ما
--     تلمس حالة الحضور المسجلة أصلًا)
create or replace function public.upsert_lesson_homework(
  p_lesson_session_id uuid,
  p_student_id uuid,
  p_homework_status text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_teacher_id uuid;
  v_row public.attendance_records;
begin
  select ls.teacher_id into v_teacher_id
  from public.lesson_sessions ls
  where ls.id = p_lesson_session_id;

  if v_teacher_id is null then
    raise exception 'lesson_not_found';
  end if;

  if not public.can_access_workspace(v_teacher_id) then
    raise exception 'not_authorized';
  end if;

  if p_homework_status is null or length(btrim(p_homework_status)) = 0 or length(p_homework_status) > 60 then
    raise exception 'invalid_homework_status';
  end if;

  insert into public.attendance_records as ar
    (teacher_id, student_id, lesson_session_id, status, homework_status, recorded_at)
  values
    (v_teacher_id, p_student_id, p_lesson_session_id, 'لم يرصد', p_homework_status, now())
  on conflict (lesson_session_id, student_id)
  do update
    set homework_status = excluded.homework_status
  returning ar.* into v_row;

  return v_row;
end;
$fn$;

-- A7) الصلاحيات: للمرخص لهم فقط (نفس نمط Migration 038)
revoke execute on function public.upsert_lesson_attendance(uuid, uuid, text) from public, anon;
revoke execute on function public.upsert_lesson_homework(uuid, uuid, text) from public, anon;
grant execute on function public.upsert_lesson_attendance(uuid, uuid, text) to authenticated;
grant execute on function public.upsert_lesson_homework(uuid, uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- القسم B — لوحة الإعلانات (كانت Migration 037 — محتوى مطابق، idempotent)
-- ═══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- النخبة (Alnokhba) — Migration 037
-- لوحة الإعلانات (Announcement Board): إرسال إعلان واحد لكل الطلاب
-- يظهر في بوابة الطالب (الإعلانات + التنبيهات) + إشعار Push على الموبايل
-- حتى لو المتصفح مقفول.
-- ============================================================================
-- آمن وتراكمي 100%: لا يحذف أي بيانات ولا يغير أي جدول قائم إلا بالإضافة.
-- يعمل مباشرة من Supabase SQL Editor (الصق الملف كاملاً ثم Run).
-- آمن لإعادة التشغيل أكثر من مرة (كل الأوامر idempotent).
--
-- المحتويات:
--   1) عمود broadcast على push_notification_jobs (إرسال جماعي بدفعة واحدة)
--   2) عمود portal_url على push_subscriptions + تعبئة تلقائية للروابط
--   3) تحديث register_student_push_subscription ليحفظ رابط بوابة الطالب
--   4) تحديث جسر تنبيهات المدرّس ليستثني إعلانات اللوحة (منع التكرار/الازدحام)
--   5) دالة send_announcement: إعلان + تنبيه لكل طالب + مهمة Push واحدة
--
-- ملاحظة مهمة: عشان الإشعار الجماعي يوصل فعلاً، انشر النسخة المحدّثة من
-- دالة send-push-notification (موجودة في مجلد supabase/functions) —
-- راجع ملف DEPLOY-STEPS.md. الإعلان نفسه بيظهر في البوابة فورًا حتى بدون
-- نشر الدالة.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) عمود broadcast على push_notification_jobs
--    broadcast = true  → دالة Edge تبعت لكل أجهزة طلاب المدرّس دفعة واحدة
--    broadcast = false → السلوك القديم (جهاز المدرّس أو طالب واحد محدد)
-- ----------------------------------------------------------------------------
alter table public.push_notification_jobs
  add column if not exists broadcast boolean not null default false;

create index if not exists idx_push_jobs_broadcast
  on public.push_notification_jobs(broadcast, processed_at);

-- ----------------------------------------------------------------------------
-- 2) عمود portal_url على push_subscriptions + تعبئة تلقائية
--    رابط بوابة الطالب الخاص بكل اشتراك — عشان الضغط على الإشعار يفتح
--    بوابة الطالب نفسها مباشرة بدل الصفحة الرئيسية.
-- ----------------------------------------------------------------------------
alter table public.push_subscriptions
  add column if not exists portal_url text;

-- تعبئة الاشتراكات الطلابية القائمة برابط آخر توكن ساري لكل طالب
update public.push_subscriptions s
set portal_url = '/qr/' || t.token
from (
  select distinct on (student_id) student_id, token
  from public.student_qr_tokens
  where revoked_at is null
  order by student_id, created_at desc
) t
where s.student_id = t.student_id
  and coalesce(s.portal_url, '') = '';

-- روابط QR القديمة كانت بتستخدم الـ UUID نفسه كتوكن — نستخدمه كاحتياط
update public.push_subscriptions
set portal_url = '/qr/' || student_id::text
where student_id is not null
  and coalesce(portal_url, '') = '';

-- ----------------------------------------------------------------------------
-- 3) تحديث register_student_push_subscription (نسخة Migration 032 + portal_url)
--    نفس المنطق القائم بالضبط + حفظ رابط بوابة الطالب مع الاشتراك.
-- ----------------------------------------------------------------------------
create or replace function public.register_student_push_subscription(
  p_token text,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_teacher_id uuid;
begin
  if coalesce(length(trim(p_token)), 0) = 0
     or coalesce(length(trim(p_endpoint)), 0) = 0
     or coalesce(length(trim(p_p256dh)), 0) = 0
     or coalesce(length(trim(p_auth)), 0) = 0 then
    return false;
  end if;

  select q.student_id, s.teacher_id
    into v_student_id, v_teacher_id
  from public.student_qr_tokens q
  join public.students s on s.id = q.student_id
  where q.token = p_token and q.revoked_at is null
  limit 1;

  -- Preserve support for old QR links whose token is the student UUID.
  if v_student_id is null and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$' then
    select s.id, s.teacher_id into v_student_id, v_teacher_id
    from public.students s where s.id = p_token::uuid limit 1;
  end if;

  if v_student_id is null or v_teacher_id is null then return false; end if;

  insert into public.push_subscriptions (teacher_id, student_id, endpoint, p256dh, auth, user_agent, portal_url, updated_at)
  values (v_teacher_id, v_student_id, trim(p_endpoint), trim(p_p256dh), trim(p_auth), p_user_agent, '/qr/' || trim(p_token), now())
  on conflict (teacher_id, endpoint) do update set
    student_id = excluded.student_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    portal_url = coalesce(public.push_subscriptions.portal_url, excluded.portal_url),
    updated_at = now();

  return true;
end;
$$;

revoke all on function public.register_student_push_subscription(text, text, text, text, text) from public;
revoke all on function public.register_student_push_subscription(text, text, text, text, text) from anon;
grant execute on function public.register_student_push_subscription(text, text, text, text, text) to anon;
grant execute on function public.register_student_push_subscription(text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) جسر تنبيهات المدرّس: استثناء إعلانات اللوحة
--    إعلانات لوحة الإعلانات بتتعامل معاها send_announcement مباشرة
--    (مهمة Push جماعية واحدة) — كنا هنعمل N حدث في مركز تنبيهات المدرّس
--    وN مهمة push لكل طالب + إشعار مكرر للطالب. الاستثناء ده بيمنع التكرار.
--    (فئة announcement مش مستخدمة في أي مسار قائم — اتحققت من الكود.)
-- ----------------------------------------------------------------------------
create or replace function public.bridge_student_notification_to_teacher_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- لوحة الإعلانات: الإرسال الجماعي بيتعمل من send_announcement مباشرة
  if new.category = 'announcement' then
    return new;
  end if;

  insert into public.teacher_notification_events (
    teacher_id,
    event_type,
    title,
    body,
    related_student_id,
    category
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
end;
$$;

drop trigger if exists student_notification_teacher_push_bridge on public.student_notifications;
create trigger student_notification_teacher_push_bridge
after insert on public.student_notifications
for each row execute procedure public.bridge_student_notification_to_teacher_push();

revoke all on function public.bridge_student_notification_to_teacher_push() from public;
revoke all on function public.bridge_student_notification_to_teacher_push() from anon;
revoke all on function public.bridge_student_notification_to_teacher_push() from authenticated;
grant execute on function public.bridge_student_notification_to_teacher_push() to service_role;

-- ----------------------------------------------------------------------------
-- 5) send_announcement: الإعلان + التنبيهات + مهمة Push — في معاملة واحدة
--    - p_student_id = null → إعلان عام لكل طلاب المدرّس (broadcast)
--    - p_student_id محدد → إعلان لطالب واحد (push فردي بالمسار القائم)
-- ----------------------------------------------------------------------------
-- ربط تنبيه الطالب بالإعلان: لو المدرّس حذف الإعلان من اللوحة، التنبيه
-- بيتشال تلقائيًا من بوابة الطالب (on delete cascade) — منع بقاء رسائل قديمة.
alter table public.student_notifications
  add column if not exists announcement_id uuid
  references public.announcements(id) on delete cascade;

create index if not exists idx_notifications_announcement
  on public.student_notifications(announcement_id);

create or replace function public.send_announcement(
  p_title text,
  p_message text,
  p_student_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher uuid := auth.uid();
  v_announcement_id uuid;
  v_students_notified int := 0;
  v_push_targets int := 0;
begin
  if v_teacher is null then
    raise exception 'يجب تسجيل الدخول أولًا';
  end if;

  if coalesce(length(btrim(coalesce(p_title, ''))), 0) = 0
     or coalesce(length(btrim(coalesce(p_message, ''))), 0) = 0 then
    raise exception 'العنوان ونص الرسالة مطلوبان';
  end if;

  -- نفس قواعد كتابة الإعلانات القائمة (Migration 015): المدرّس نفسه + اشتراك ساري
  if not exists (
    select 1 from public.profiles
    where id = v_teacher
      and subscription_status in ('trial', 'active')
      and subscription_expires_at > now()
  ) then
    raise exception 'الاشتراك غير سارٍ — راجع صفحة الاشتراك ثم أعد المحاولة';
  end if;

  -- لو الإعلان لطالب واحد: لازم يكون من طلاب المدرّس
  if p_student_id is not null and not exists (
    select 1 from public.students
    where id = p_student_id and teacher_id = v_teacher
  ) then
    raise exception 'الطالب المحدد غير موجود أو لا ينتمي لك';
  end if;

  -- أ) صف الإعلان نفسه (يظهر في قسم "الإعلانات" في بوابة الطالب)
  insert into public.announcements (teacher_id, student_id, title, message)
  values (v_teacher, p_student_id, btrim(p_title), btrim(p_message))
  returning id into v_announcement_id;

  -- ب) تنبيه لكل طالب مستهدف (يظهر في "التنبيهات" + عدّاد غير المقروء)
  with inserted as (
    insert into public.student_notifications (teacher_id, student_id, title, body, category, deep_link, announcement_id)
    select
      v_teacher,
      s.id,
      btrim(p_title),
      btrim(p_message),
      'announcement',
      '/qr/' || coalesce((
        select t.token
        from public.student_qr_tokens t
        where t.student_id = s.id and t.revoked_at is null
        order by t.created_at desc
        limit 1
      ), s.id::text),
      v_announcement_id
    from public.students s
    where s.teacher_id = v_teacher
      and (p_student_id is null or s.id = p_student_id)
    returning student_id
  )
  select count(*) into v_students_notified from inserted;

  -- ج) مهمة Push واحدة
  --    عام → broadcast = true (دالة Edge المحدثة تبعت لكل أجهزة الطلاب دفعة واحدة)
  --    فردي → student_id محدد (المسار القائم يوصله لأجهزة الطالب ده بس)
  insert into public.push_notification_jobs (teacher_id, student_id, title, body, url, broadcast)
  values (v_teacher, p_student_id, btrim(p_title), btrim(p_message), '/', p_student_id is null);

  -- عدد أجهزة الطلاب اللي هتحاول تبعتها الدالة (للعرض في الواجهة)
  select count(*) into v_push_targets
  from public.push_subscriptions ps
  where ps.teacher_id = v_teacher
    and (
      (p_student_id is not null and ps.student_id = p_student_id)
      or (p_student_id is null and ps.student_id is not null)
    );

  return jsonb_build_object(
    'announcement_id', v_announcement_id,
    'students_notified', v_students_notified,
    'push_targets', v_push_targets
  );
end;
$$;

revoke all on function public.send_announcement(text, text, uuid) from public;
revoke all on function public.send_announcement(text, text, uuid) from anon;
grant execute on function public.send_announcement(text, text, uuid) to authenticated;
grant execute on function public.send_announcement(text, text, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 6) صلاحية قراءة الإعلانات للمدرّس
--    Migration 019 شالت سياسة القراءة العامة، وسياستي التحديث/الحذف
--    موجودتين لكن مفيش سياسة SELECT للمدرّس نفسه — بدونها سجل لوحة
--    الإعلانات هيظهر فاضي. دي بتسمح للمدرّس بقراءة إعلاناته بس.
-- ----------------------------------------------------------------------------
drop policy if exists "announcements_teacher_read" on public.announcements;
create policy "announcements_teacher_read" on public.announcements
  for select using (auth.uid() = teacher_id);

-- ----------------------------------------------------------------------------
-- 7) صلاحية قراءة الاشتراكات/المهام للمدرّس (موجودة من 027 — لا تغيير)
--    يُعاد إنشاؤها هنا فقط لضمان بقائها بعد أي إعادة تشغيل للـ migration
-- ----------------------------------------------------------------------------
drop policy if exists push_subscriptions_owner on public.push_subscriptions;
create policy push_subscriptions_owner on public.push_subscriptions
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists push_notification_jobs_owner on public.push_notification_jobs;
create policy push_notification_jobs_owner on public.push_notification_jobs
  for select using (teacher_id = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════
-- القسم C — تعديل درجات الامتحانات (كانت Migration 038 — محتوى مطابق، idempotent)
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================================
-- النخبة (Alnokhba) — Migration 038
-- تعديل درجات الامتحانات: عمليتان منفصلتان تمامًا
--   A) تعديل الدرجة العظمى للامتحان كله (update_exam_max_score)
--   B) تعديل درجة طالب واحد في الامتحان (update_student_exam_score)
-- ============================================================================
-- آمن وتراكمي 100%: لا يحذف أي بيانات ولا يغير أي سجلات قائمة.
-- يعمل مباشرة من Supabase SQL Editor (الصق الملف كاملاً ثم Run).
-- آمن لإعادة التشغيل أكثر من مرة (كل الأوامر idempotent).
--
-- المحتويات:
--   1) عمودا version + updated_at على exams و exam_scores
--      (حماية التعديل المتزامن: لو اتنين فتحوا نفس الدرجة، التعديل القديم
--       بيرفض مش بيكتب فوق الجديد)
--   2) جدول exam_score_audit_logs: سجل تدقيق append-only لكل تعديل
--      (من عدّل / إمتى / القيمة القديمة / الجديدة / ليه)
--   3) دالة update_exam_max_score:
--      - بتغير الدرجة العظمى الكلية للامتحان (مثال: 40 → 50)
--      - درجات الطلاب المسجلة مبتتغيرش (الطالب اللي 32 من 40 يفضل 32 من 50)
--      - النسب المئوية والدرجات المشتقة بتتحسب من العظمى الجديدة تلقائيًا
--   4) دالة update_student_exam_score:
--      - بتغير درجة طالب واحد بس (الباقي مبيتأثروش خالص)
--      - بتتحقق إن الطالب حاضر يوم الامتحان (الغايب مياخدش درجة عادية)
--      - بتتأكد إن الدرجة الجديدة ≤ الدرجة العظمى ومش سالبة
--      - بتظبط نقاط الطالب بنفس معادلة الرصد الأصلية (الفرق فوق/تحت النص)
--   5) القسم (section_scores) بيتوزع نسبيًا على الأقسام عشان التقارير
--      تفضل متسقة مع المجموع الجديد
--
-- الصلاحيات: نفس نظام الصلاحيات الموجود (can_access_workspace) —
-- صاحب الامتحان أو عضو مساحة عمله أو جلسة دعم فنية نشطة. مفيش نظام
-- صلاحيات جديد (منع الازدواجية).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) أعمدة التزامن (concurrency) على exams و exam_scores
-- ----------------------------------------------------------------------------
alter table public.exams
  add column if not exists version bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

alter table public.exam_scores
  add column if not exists version bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_exam_scores_exam
  on public.exam_scores(exam_id);

-- ----------------------------------------------------------------------------
-- 2) سجل تدقيق تعديل الدرجات (append-only)
--    مفيش أي UPDATE/DELETE — الجدول بيزيد بس، والتغييرات بتتم عبر الدوال بس.
-- ----------------------------------------------------------------------------
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

-- قراءة: صاحب مساحة العمل بس (نفس نمط باقي الجداول)
drop policy if exists "exam_score_audit_workspace_read" on public.exam_score_audit_logs;
create policy "exam_score_audit_workspace_read" on public.exam_score_audit_logs
  for select using (can_access_workspace(teacher_id));

-- مفيش سياسات insert/update/delete: الكتابة من الدوال فقط (security definer)

-- ----------------------------------------------------------------------------
-- 3) العملية A: تعديل الدرجة العظمى للامتحان
--    p_exam_id            : الامتحان
--    p_new_max            : الدرجة العظمى الكلية الجديدة (رقم > 0)
--    p_expected_version   : رقم النسخة اللي شافها المستخدم (حماية التزامن)
--    p_reason             : سبب التعديل (اختياري — بيتسجل في سجل التدقيق)
-- ----------------------------------------------------------------------------
create or replace function public.update_exam_max_score(
  p_exam_id uuid,
  p_new_max numeric,
  p_expected_version bigint default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_id uuid;
  v_sections text[];
  v_old_per_section numeric;
  v_sections_count int;
  v_new_per_section numeric;
  v_old_max numeric;
  v_conflicts int;
  v_new_version bigint;
  v_scores_count int;
begin
  -- (1) تسجيل الدخول
  if auth.uid() is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;

  -- (2) الامتحان موجود؟ + بياناته المرجعية (server-side authoritative)
  --     for update = قفل الصف عشان تعديلين متزامنين ميتفيشوش على بعض
  select e.teacher_id, e.sections, e.max_score_per_section
    into v_teacher_id, v_sections, v_old_per_section
    from public.exams e
    where e.id = p_exam_id
    for update;
  if not found then
    raise exception 'الامتحان غير موجود';
  end if;

  -- (3) الصلاحية (نفس نظام الصلاحيات القائم — مفيش نظام جديد)
  if not can_access_workspace(v_teacher_id) then
    raise exception 'مش مسموح لك تعديل امتحان مش بتاعك';
  end if;

  -- (4) تحقق الدرجة الجديدة: رقمية وموجبة
  if p_new_max is null or p_new_max <> p_new_max or p_new_max <= 0 then
    raise exception 'الدرجة العظمى لازم تكون رقم أكبر من صفر';
  end if;

  v_sections_count := coalesce(array_length(v_sections, 1), 0);
  if v_sections_count <= 0 then
    raise exception 'الامتحان من غير أقسام — راجع بياناته الأول';
  end if;

  -- (5) لازم تقبل القسمة على عدد الأقسام عشان الدرجة لكل قسم تطلع رقم نظيف
  --     (زي 50 على 5 أقسام = 10 لكل قسم)
  if mod(p_new_max * 100, v_sections_count * 100) <> 0 then
    raise exception 'الدرجة العظمى (%) لازم تقبل القسمة على عدد الأقسام (%) عشان الدرجة لكل قسم تطلع رقم صحيح', p_new_max, v_sections_count;
  end if;

  v_new_per_section := p_new_max / v_sections_count;
  v_old_max := v_old_per_section * v_sections_count;

  -- (6) حماية من فساد البيانات التاريخية: مفيش درجة طالب أعلى من العظمى الجديدة
  select count(*) into v_conflicts
    from public.exam_scores s
    where s.exam_id = p_exam_id
      and s.total_score > p_new_max;
  if v_conflicts > 0 then
    raise exception 'فيه % درجة/درجات طلبة أعلى من العظمى الجديدة — عدّل درجاتهم الأول', v_conflicts;
  end if;

  -- (7) تحديث شرطي: بيوافق بس لو النسخة اللي شافها المستخدم هي الأحدث
  update public.exams
    set max_score_per_section = v_new_per_section,
        version = version + 1,
        updated_at = now()
    where id = p_exam_id
      and (p_expected_version is null or version = p_expected_version)
    returning version into v_new_version;

  if v_new_version is null then
    raise exception '[CONFLICT]الامتحان اتعدّل من مستخدم تاني — حدّث البيانات وجرب تاني';
  end if;

  -- (8) سجل التدقيق (append-only — ما بيمسحش أي حاجة تاريخية)
  insert into public.exam_score_audit_logs
    (teacher_id, actor_id, change_type, exam_id, student_id, previous_value, new_value, reason, exam_version)
  values
    (v_teacher_id, auth.uid(), 'max_score', p_exam_id, null, v_old_max, p_new_max,
     nullif(trim(coalesce(p_reason, '')), ''), v_new_version);

  select count(*) into v_scores_count from public.exam_scores where exam_id = p_exam_id;

  return jsonb_build_object(
    'ok', true,
    'exam_id', p_exam_id,
    'new_max_total', p_new_max,
    'per_section', v_new_per_section,
    'sections_count', v_sections_count,
    'version', v_new_version,
    'scores_affected', v_scores_count
  );
end $$;

revoke all on function public.update_exam_max_score(uuid, numeric, bigint, text) from public;
revoke all on function public.update_exam_max_score(uuid, numeric, bigint, text) from anon;
grant execute on function public.update_exam_max_score(uuid, numeric, bigint, text) to authenticated;
grant execute on function public.update_exam_max_score(uuid, numeric, bigint, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4) العملية B: تعديل درجة طالب واحد
--    p_score_id          : صف الدرجة بتاع الطالب في الامتحان ده
--    p_new_score         : الدرجة الجديدة (0 ≤ الدرجة ≤ العظمى)
--    p_expected_version  : رقم النسخة اللي شافها المستخدم (حماية التزامن)
--    p_reason            : سبب التعديل (اختياري — بيتسجل في سجل التدقيق)
-- ----------------------------------------------------------------------------
create or replace function public.update_student_exam_score(
  p_score_id uuid,
  p_new_score numeric,
  p_expected_version bigint default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score record;
  v_exam record;
  v_sections_count int;
  v_max_total numeric;
  v_passing numeric;
  v_points_delta int;
  v_new_version bigint;
  v_att_status text;
  v_keys text[];
  v_scale numeric;
  v_val numeric;
  v_running numeric;
  v_new_sections jsonb;
  v_total numeric;
  v_updated_at timestamptz;
begin
  -- (1) تسجيل الدخول
  if auth.uid() is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;

  -- (2) صف الدرجة موجود؟ (server-side authoritative fetch)
  select s.id, s.teacher_id, s.exam_id, s.student_id, s.section_scores, s.total_score, s.version
    into v_score
    from public.exam_scores s
    where s.id = p_score_id;
  if not found then
    raise exception 'درجة الطالب دي مش موجودة';
  end if;

  -- (3) الامتحان المرجعي
  select e.teacher_id, e.title, e.sections, e.max_score_per_section, e.created_at, e.lesson_session_id
    into v_exam
    from public.exams e
    where e.id = v_score.exam_id;
  if not found then
    raise exception 'الامتحان مش موجود';
  end if;

  -- (4) الصلاحية: نفس نظام الصلاحيات القائم
  if not can_access_workspace(v_score.teacher_id) then
    raise exception 'مش مسموح لك تعديل درجات مدرّس تاني';
  end if;

  -- (5) اتساق البيانات: صف الدرجة تابع لنفس مدرّس الامتحان
  if v_score.teacher_id <> v_exam.teacher_id then
    raise exception 'بيانات الدرجة مش متطابقة مع الامتحان';
  end if;

  v_sections_count := coalesce(array_length(v_exam.sections, 1), 0);
  v_max_total := v_exam.max_score_per_section * v_sections_count;

  -- (6) تحقق الدرجة الجديدة
  if p_new_score is null or p_new_score <> p_new_score then
    raise exception 'الدرجة لازم تكون رقم';
  end if;
  if p_new_score < 0 then
    raise exception 'الدرجة مينفعش تكون سالبة';
  end if;
  if p_new_score > v_max_total then
    raise exception 'الدرجة (%) أكبر من الدرجة العظمى (%)', p_new_score, v_max_total;
  end if;

  -- (7) حماية الغايب: الطالب لازم يكون حاضر يوم الامتحان
  --     (أ) لو الامتحان مرتبط بحصة → حضور الحصة
  select a.status into v_att_status
    from public.attendance_records a
    where a.lesson_session_id = v_exam.lesson_session_id
      and a.student_id = v_score.student_id
    order by a.recorded_at desc
    limit 1;

  --     (ب) لو مفيش صف حضور للحصة → أي رصد حضور في نفس يوم الامتحان
  if v_att_status is null then
    select a.status into v_att_status
      from public.attendance_records a
      where a.student_id = v_score.student_id
        and a.teacher_id = v_score.teacher_id
        and a.recorded_at::date = v_exam.created_at::date
      order by a.recorded_at desc
      limit 1;
  end if;

  if v_att_status = 'غائب' then
    raise exception 'الطالب غائب في يوم الامتحان — مينفعش ياخد درجة عادية';
  end if;

  -- (8) إعادة توزيع الأقسام نسبيًا عشان التقارير تفضل متسقة مع المجموع الجديد
  --     (آخر قسم بياخد الباقي بالظبط عشان مجموع الأقسام = المجموع الجديد)
  v_keys := coalesce(array(select jsonb_object_keys(v_score.section_scores)), '{}');
  if coalesce(array_length(v_keys, 1), 0) = 0 then
    v_new_sections := v_score.section_scores;
  elsif v_score.total_score > 0 then
    v_scale := p_new_score / v_score.total_score;
    v_new_sections := '{}'::jsonb;
    v_running := 0;
    for i in 1 .. array_length(v_keys, 1) loop
      if i < array_length(v_keys, 1) then
        v_val := round(coalesce((v_score.section_scores ->> v_keys[i])::numeric, 0) * v_scale, 2);
        if v_val < 0 then v_val := 0; end if;
        v_new_sections := v_new_sections || jsonb_build_object(v_keys[i], v_val);
        v_running := v_running + v_val;
      else
        v_new_sections := v_new_sections || jsonb_build_object(v_keys[i],
          greatest(round(p_new_score - v_running, 2), 0));
      end if;
    end loop;
  else
    -- الدرجة القديمة صفر: توزيع متساوي
    v_new_sections := '{}'::jsonb;
    v_running := 0;
    for i in 1 .. array_length(v_keys, 1) loop
      if i < array_length(v_keys, 1) then
        v_val := round(p_new_score / array_length(v_keys, 1), 2);
        v_new_sections := v_new_sections || jsonb_build_object(v_keys[i], v_val);
        v_running := v_running + v_val;
      else
        v_new_sections := v_new_sections || jsonb_build_object(v_keys[i],
          greatest(round(p_new_score - v_running, 2), 0));
      end if;
    end loop;
  end if;

  -- (9) تحديث شرطي (حماية التزامن): يوافق بس لو النسخة اللي شافها المستخدم أحدث واحدة
  update public.exam_scores
    set total_score = p_new_score,
        section_scores = v_new_sections,
        version = version + 1,
        updated_at = now()
    where id = p_score_id
      and (p_expected_version is null or version = p_expected_version)
    returning version, updated_at, total_score into v_new_version, v_updated_at, v_total;

  if v_new_version is null then
    raise exception '[CONFLICT]الدرجة اتعدّلت من مستخدم تاني — حدّث البيانات وجرب تاني';
  end if;

  -- (10) نقاط الطالب: نفس معادلة الرصد الأصلية بالظبط
  --      (النقاط = الدرجة − نصف العظمى، فيتم تعديل الفرق بس)
  v_passing := v_max_total / 2;
  v_points_delta := (round(p_new_score - v_passing) - round(v_score.total_score - v_passing))::int;
  if v_points_delta <> 0 then
    update public.students
      set points = points + v_points_delta,
          updated_at = now()
      where id = v_score.student_id;
  end if;

  -- (11) سجل التدقيق (append-only)
  insert into public.exam_score_audit_logs
    (teacher_id, actor_id, change_type, exam_id, student_id, previous_value, new_value, reason, exam_version)
  values
    (v_score.teacher_id, auth.uid(), 'student_score', v_score.exam_id, v_score.student_id,
     v_score.total_score, p_new_score,
     nullif(trim(coalesce(p_reason, '')), ''), v_new_version);

  return jsonb_build_object(
    'ok', true,
    'score_id', p_score_id,
    'exam_id', v_score.exam_id,
    'student_id', v_score.student_id,
    'total_score', v_total,
    'section_scores', v_new_sections,
    'max_total', v_max_total,
    'version', v_new_version,
    'updated_at', v_updated_at,
    'points_delta', v_points_delta
  );
end $$;

revoke all on function public.update_student_exam_score(uuid, numeric, bigint, text) from public;
revoke all on function public.update_student_exam_score(uuid, numeric, bigint, text) from anon;
grant execute on function public.update_student_exam_score(uuid, numeric, bigint, text) to authenticated;
grant execute on function public.update_student_exam_score(uuid, numeric, bigint, text) to service_role;

-- ----------------------------------------------------------------------------
-- 5) Realtime: سجل التدقيق + الامتحانات والدرجات يوصلوا لحظيًا
--    (غالبًا عضو أصلًا من Round 7 — التأكيد هنا idempotent)
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.exam_score_audit_logs;
exception
  when duplicate_object then null;  -- عضو أصلًا
end $$;

do $$
begin
  alter publication supabase_realtime add table public.exams;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.exam_scores;
exception
  when duplicate_object then null;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- القسم D — تحقق سريع بعد التشغيل (النتائج المفروض تشوفها)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) الدالتين بالتوقيع ونوع الإرجاع الصحيح (المفروض: attendance_records)
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as returns_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('upsert_lesson_attendance', 'upsert_lesson_homework');

-- 2) الفهرس الفريد (المفروض يظهر uq_attendance_lesson_student — unique)
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'attendance_records'
  and indexname = 'uq_attendance_lesson_student';

-- 3) صلاحيات التنفيذ (المفروض: authenticated = true / anon = false)
select has_function_privilege('authenticated', 'public.upsert_lesson_attendance(uuid, uuid, text)', 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('anon', 'public.upsert_lesson_attendance(uuid, uuid, text)', 'EXECUTE') as anon_can_execute;

-- 4) مفيش سجلات حضور مكررة لنفس (الطالب × الحصة) — المفروض النتيجة 0
select count(*) as duplicate_lesson_attendance_rows
from (
  select lesson_session_id, student_id
  from public.attendance_records
  where lesson_session_id is not null
  group by lesson_session_id, student_id
  having count(*) > 1
) d;
