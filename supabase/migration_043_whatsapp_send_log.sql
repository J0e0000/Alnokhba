-- ============================================================================
-- Migration 043 — سجل إرسال واتساب (whatsapp_send_log)
-- اكتمال إصلاح قائمة تقارير واتساب — سبتمبر 2026
-- ============================================================================
-- التشغيل: Supabase Dashboard → SQL Editor → الصق الملف كامل → Run
-- الملف idempotent: آمن لإعادة التشغيل أكثر من مرة، ولا يمسح أو يعدّل أي بيانات قائمة.
--
-- ليه الملف ده؟
--   إصلاح قائمة الإرسال كان محفوظًا في المتصفح فقط (localStorage): بيقاوم
--   إعادة تحميل الصفحة، لكن لو المدرّس فتح اللوحة من جهاز تاني أو متصفح
--   تاني، أو اتّمسح التخزين المحلي — سجل «اتبعت/تخطّي» بيضيع، والمدرّس
--   ممكن يكرر إرسال نفس التقارير من تاني من غير ما يفتكر.
--   الجدول ده بيخلي السجل الدائم عند السيرفر (المصدر الوحيد للحقيقة):
--     • كل ضغطة إرسال/تخطّي داخل القائمة تتسجل هنا (insert فوري غير معيق —
--       لو فشل التسجيل القائمة تفضل شغالة عادي).
--     • وقت تجهيز أي قائمة جديدة، الطالب اللي استلم رسالة خلال آخر 24 ساعة
--       يظهر جنبُه تنبيه «تم إرسال حديثًا» في شاشة اختيار المستلمين —
--       حماية من التكرار بين الأجهزة (القرار يبقى بيد المدرّس دايمًا).
--
-- الحماية:
--   • RLS مفعّل: المدرّس يقرأ/يسجل صفوفه فقط، وأعضاء فريق العمل
--     (المساعدون) عبر can_access_workspace — نفس نمط باقي الجداول.
--   • الصفوف append-only: لا توجد سياسات update/delete للمستخدمين —
--     السجل التاريخي ما يتحوش، والخدمة (service-role) فقط تقدر تنظّفه.
--   • لا تُخزَّن أرقام هواتف هنا (student_id يكفي) — أقل قدر من البيانات.
--   • message_preview مقتطع 300 حرف من نص المدرّس نفسه (نفس تصنيف بيانات
--     القوالب في teacher_settings) ومحمي بنفس سياسات RLS.
-- ============================================================================

create table if not exists public.whatsapp_send_log (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  lesson_session_id uuid references public.lesson_sessions(id) on delete set null,
  group_name text,
  kind text not null default 'custom',          -- session_report | qr_link | welcome | custom
  status text not null check (status in ('sent', 'skipped', 'failed')),
  message_preview text check (char_length(message_preview) <= 500),
  created_at timestamptz not null default now()
);

-- فهارس على نمطي الاستعلام الفعليين فقط (لا فهارس عمياء):
--   1) «إيه اللي اتبعت مؤخرًا» عند تجهيز أي قائمة إرسال (لكل مدرّس)
--   2) «الطالب ده استلم إيه ومتى» في شاشة اختيار المستلمين (لكل طالب)
create index if not exists idx_whatsapp_send_log_teacher_created
  on public.whatsapp_send_log (teacher_id, created_at desc);
create index if not exists idx_whatsapp_send_log_student_created
  on public.whatsapp_send_log (student_id, created_at desc);

alter table public.whatsapp_send_log enable row level security;

drop policy if exists "whatsapp_log_owner_insert" on public.whatsapp_send_log;
create policy "whatsapp_log_owner_insert" on public.whatsapp_send_log
  for insert to authenticated with check (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

drop policy if exists "whatsapp_log_owner_read" on public.whatsapp_send_log;
create policy "whatsapp_log_owner_read" on public.whatsapp_send_log
  for select to authenticated using (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- فحص ذاتي بعد التشغيل — النتائج المتوقعة موضحة جوار كل استعلام
-- ═══════════════════════════════════════════════════════════════════════════
-- أ) السياسات — المتوقع: whatsapp_log_owner_insert (insert) و
--    whatsapp_log_owner_read (select) فقط، بلا أي update/delete:
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'whatsapp_send_log';

-- ب) الفهارس — المتوقع: idx_whatsapp_send_log_teacher_created و
--    idx_whatsapp_send_log_student_created:
select indexname
from pg_indexes
where schemaname = 'public' and tablename = 'whatsapp_send_log';

-- ج) الاختبار الحقيقي من التطبيق: بعد التشغيل، افتح أي قائمة إرسال وأكمل
--    أول رسالة — هتلاقي صف جديد هنا:
--    select kind, status, created_at from public.whatsapp_send_log order by created_at desc limit 5;
--
-- ملاحظة: لو مشغّلتش الملف ده، التطبيق يفضل شغال طبيعي 100% — التسجيل
-- عند السيرفر بيفشل بصمت والقائمة المحلية (localStorage) بتشتغل كالسابق.
