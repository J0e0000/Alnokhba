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
