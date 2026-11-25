-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 064 — Multi-group enrollment (students.extra_groups text[])
-- ═══════════════════════════════════════════════════════════════════════════
-- الطلب: «خليني اقدر احط نفس الطالب في اكتر من مجموعة فنفس الوقت».
--
-- الموديل الحالي: students.group_name (نص) = المجموعة الأساسية، والمجموعات
-- نفسها أسماء لكل مدرس (جدول groups فاضي في الإنتاج، والمجموعات بتتشق من
-- قيم group_name + group_schedule). فالحل الأنسب: عمود مصفوفة إضافية على
-- students بدل جدول ربط — يعدي مع RLS وbackups وrestore الحاليين بدون
-- أي تغيير في سياسات الصفوف.
--
-- قراءة «كل مجموعات الطالب» = [group_name, ...extra_groups] (بدون تكرار).
-- الواجهة بتفعّل الميزة فقط لو العمود موجود (probe مرة واحدة) — فالنشر
-- الأمامي قبل تشغيل المايجريشن آمن وسلوك الشاشات زي ما هو.
--
-- لا يغيّر: RLS policies (عمود جديد داخل نفس الصف)، بوابة QR للطالب
-- (بتفضل تعرض المجموعة الأساسية)، ولا أي توكن/لينك للطلاب.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.students
  add column if not exists extra_groups text[] not null default '{}';

comment on column public.students.extra_groups is
  'Multi-group enrollment: additional group names beyond the primary group_name. Read as [group_name, ...extra_groups]; frontend gates on column existence.';

-- العمود الجديد داخل منح الجدول الحالية؛ منح صريح للتوثيق ولتفادي أي فرق
-- في مشاريع/بيئات فيها grants على مستوى أعمدة.
grant select, insert, update, delete on public.students to authenticated;

-- PostgREST: أعد تحميل المخطط فورًا (السوبربايز بتعمل reload تلقائي على DDL،
-- الـ NOTIFY ضمانة إضافية).
notify pgrst, 'reload schema';
