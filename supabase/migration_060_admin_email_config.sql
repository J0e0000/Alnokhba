-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 060 — Task 44j
-- admin_email_config: حيث يضبط الأدمن مفاتيح إرسال الإيميل (Resend) من داخل
-- لوحة الأدمن نفسها — بدون الحاجة لـ Dashboard أو supabase secrets CLI.
--
-- لماذا جدول؟ لما يوصل تجديد وإيميله يفشل بسبب «RESEND_API_KEY غير مضبوط»،
-- كان الأدمن محتاج يفتح Supabase Dashboard يدويًا. دلوقتي الدالة
-- admin-account-actions بتقرأ المفتاح من هنا كخيار ثانٍ بعد متغير البيئة،
-- والأدمن يلصق المفتاح من لوحة الأدمن → سجل التجديدات → ⚙️ إعدادات البريد.
--
-- الأمان: RLS مفعّل بلا أي policies → أنونيموث/مصّحّح مرفوضون تمامًا؛
-- القراءة والكتابة فقط عبر service role (داخل Edge Function بعد التحقق
-- من أن المستدعي أدمن). المفتاح لا يُعاد كاملًا أبدًا للعميل — نسخة مقنّعة فقط.
-- Idempotent — آمن لإعادة التشغيل.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.admin_email_config (
  key        text primary key
             check (key in ('resend_api_key', 'renewal_email_from')),
  value      text not null check (length(value) between 1 and 500),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.admin_email_config is
  'Task 44j — إعدادات إرسال الإيميل للتجديدات (Resend). يكتبها الأدمن من لوحة الأدمن عبر Edge Function بعد التحقق؛ لا قراءة مباشرة لأي دور (RLS deny-all، الوصول عبر service role فقط).';

alter table public.admin_email_config enable row level security;

-- deny-all: لا policies لأنونيموث ولا مصّحّح. مسح صريح للصلاحيات المباشرة
-- (الافتراضي إنكر للعام، لكن نكرّره كحماية مستقبلية لو أُعيدت صياغة الافتراضيات):
revoke all on public.admin_email_config from anon, authenticated;
grant all on public.admin_email_config to service_role;

-- نظافة: لو الحقل اتملّي قبل كده بقيمة فاضية من تجربة قديمة ننضّفه
delete from public.admin_email_config where length(trim(value)) = 0;

-- تقرير شفاف في آخر الملف
select
  'admin_email_config' as object,
  case when to_regclass('public.admin_email_config') is not null then 'موجود ✓' else 'مفقود ✗' end as state,
  (select count(*) from public.admin_email_config) as rows_stored,
  (select count(*) from pg_policies where tablename = 'admin_email_config') as policies_deny_all;
