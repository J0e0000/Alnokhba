-- ============================================================================
-- Migration 048 — سجل التجديدات + ضمان عدم حذف البيانات عند انتهاء الاشتراك
-- (Subscription renewals history + data-preservation guarantee)
-- سبتمبر 2026
-- ============================================================================
-- التشغيل: Supabase Dashboard → SQL Editor → الصق الملف كامل → Run
-- الملف idempotent: آمن لإعادة التشغيل، ولا يمس أو يحذف أي بيانات قائمة.
--
-- سياسة حفظ البيانات (قرار معتمد — قاعدة غير قابلة للكسر):
--   انتهاء الاشتراك = إيقاف مؤقت للوصول فقط (عبر RLS الموجود أصلًا
--   is_subscription_active). لا يوجد — ولن يُضاف — أي حذف تلقائي
--   للطلاب أو الحضور أو الدرجات أو الامتحانات أو الملاحظات أو التقارير
--   أو الإعدادات أو بيانات الحساب بسبب انتهاء الاشتراك.
--   الحذف يكون فقط بإجراء يدوي مقصود من الأدمن عبر لوحة الأدمن.
--
--   تدقيق أمني (سبتمبر 2026) أكّد:
--   • لا يوجد أي cron job يحذف بيانات (الوحيد الموجود: nokhba-backup-hourly
--     لإنشاء نسخ احتياطية — يُترك كما هو).
--   • لا يوجد أي trigger أو function يحذف بيانات عند انتهاء الاشتراك.
--   • لا يوجد أي cascade delete يشتغل بسبب انتهاء الاشتراك
--     (سلاسل on delete cascade من profiles لا تُفعّل أبدًا تلقائيًا —
--     لا يوجد كود في النظام كله يحذف صف profiles).
--
-- ما يفعله هذا الملف فعليًا:
--   1) جدول subscription_renewals — سجل دائم لكل تجديد:
--      تاريخ الانتهاء السابق، تاريخ التجديد، تاريخ الانتهاء الجديد، الباقة،
--      الأدمن الذي نفّذ التجديد، وحالة إرسال إيميل التجديد.
--      السجل تراكمي — لا يُستبدل ولا يُحذف.
--   2) دالة mark_expired_subscriptions() — تقلّب حالة الاشتراك إلى 'expired'
--      عند انتهاء التاريخ (تحديث حالة فقط — تحديث واحد، صفر حذف)،
--      وتُجدول تلقائيًا كل ساعة لو pg_cron متاح (بنفس أسلوب migration 036
--      الآمن: لو مش متاح، الملف يشتغل عادي والواجهة أصله بتعتبر الحساب
--      منتهيًا من التاريخ نفسه — الدالة دي للمطابقة الصريحة فقط).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) جدول سجل التجديدات
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.subscription_renewals (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  admin_id uuid references public.profiles(id) on delete set null,
  previous_expires_at timestamptz,
  previous_status text,
  new_expires_at timestamptz not null,
  new_status text not null default 'active',
  plan_name text,
  days_added integer,
  email_status text not null default 'not_sent'
    check (email_status in ('not_sent', 'sent', 'failed')),
  email_error text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.subscription_renewals is
  'سجل تجديدات الاشتراك — تراكمي دائم (لا يُستبدل ولا يُحذف). انتهاء الاشتراك لا يحذف أي بيانات إطلاقًا.';

alter table public.subscription_renewals enable row level security;

-- قراءة السجل: الأدمن فقط (الكتابة تتم من edge function بصلاحية service role)
drop policy if exists "subscription_renewals_admin_read" on public.subscription_renewals;
create policy "subscription_renewals_admin_read"
  on public.subscription_renewals
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );

create index if not exists idx_subscription_renewals_teacher
  on public.subscription_renewals (teacher_id, created_at desc);
create index if not exists idx_subscription_renewals_created
  on public.subscription_renewals (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) مطابقة صريحة للحالة «expired» — تحديث حالة فقط، ممنوع أي حذف
--    (الوصول للبيانات محكوم أصلًا بـ is_subscription_active في RLS)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mark_expired_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer := 0;
begin
  -- تحديث حالة فقط — لا delete ولا truncate ولا أي إزالة بيانات هنا.
  update public.profiles
    set subscription_status = 'expired'
    where subscription_expires_at < now()
      and subscription_status in ('trial', 'active');
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) جدولة الدالة كل ساعة لو pg_cron متاح (نفس أسلوب migration 036 الآمن)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  sqlerrm_text text;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- إلغاء أي جدولة قديمة بنفس الاسم ثم إعادة التسجيل (idempotent)
    begin
      perform cron.unschedule('nokhba-mark-expired-hourly');
    exception when others then null;
    end;
    perform cron.schedule('nokhba-mark-expired-hourly', '5 * * * *', 'select public.mark_expired_subscriptions();');
    raise notice 'mark_expired_subscriptions مجدولة كل ساعة (تحديث حالة فقط — صفر حذف).';
  else
    sqlerrm_text := 'pg_cron غير مفعّل';
    raise notice '% — تخطّي الجدولة. الواجهة تعتبر الحساب منتهيًا من التاريخ تلقائيًا، فلا تأثير تشغيلي.', sqlerrm_text;
  end if;
exception when others then
  sqlerrm_text := SQLERRM;
  raise notice 'pg_cron غير متاح (%). تخطّي الجدولة — لا تأثير على باقي الملف.', sqlerrm_text;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) فحص شفافية: عرض كل cron jobs الموجودة — للتأكد أنه لا يوجد أي job يحذف
--    (لأغراض التدقيق فقط، لا يغيّر شيئًا)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  job record;
  suspicious boolean;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for job in select jobname, command from cron.job loop
      suspicious := job.command ilike '%delete from public.students%'
                 or job.command ilike '%delete from public.attendance_records%'
                 or job.command ilike '%delete from public.profiles%'
                 or job.command ilike '%delete from public.exams%'
                 or job.command ilike '%delete from public.behavior_logs%'
                 or job.command ilike '%truncate%';
      raise notice 'CRON JOB: % | يحذف بيانات مستخدمين: %', job.jobname, case when suspicious then 'نعم — ⚠️ راجعه فورًا' else 'لا ✓' end;
    end loop;
  end if;
end $$;
