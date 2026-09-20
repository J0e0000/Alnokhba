-- ============================================================================
-- Migration 042 — SECURITY HARDENING (نتيجة تدقيق أمني شامل — سبتمبر 2026)
-- ============================================================================
-- التشغيل: Supabase Dashboard → SQL Editor → الصق الملف كامل → Run
-- الملف idempotent: آمن لإعادة التشغيل أكثر من مرة، ولا يمسح أي بيانات.
--
-- ما يصلحه الملف (بترتيب الخطورة):
--   1) CRITICAL — منع ترقية الصلاحيات الذاتية على profiles:
--      كان أي مستخدم مسجّل يقدر يعدّل صفه الشخصي ويجعل نفسه
--      is_admin=true / is_verified=true / اشتراك active حتى 2099
--      (تم إثباتها عمليًا أثناء التدقيق ثم التراجع فورًا).
--      الحل: تريجر حارس يمنع غير الأدمن من تغيير الأعمدة الحساسة.
--      الخدمات (service-role عبر Edge Functions) والأدمن يمررون طبيعي.
--
--   2) CRITICAL — إغلاق القراءة العامة على student_qr_tokens:
--      كانت سياسة "qr_token_public_read" تسمح لأي زائر مجهول بجلب
--      كل توكنات بوابة الطلاب (699 توكن نشط وقت التدقيق!) ومعها
--      student_id — يعني وصول كامل لبوابة كل طالب في المنصة.
--      البوابة نفسها تستخدم get_student_portal_data (RPC آمن بالتوكن)
--      لذلك سياسة القراءة العامة لم تعد لها حاجة، ويبقى وصول
--      المدرّس/المساعد عبر سياسة workspace الجديدة.
--
--   3) MEDIUM — صلاحيات التخزين teacher-logos:
--      السياسات القديمة كانت تسمح لأي مستخدم مسجّل بالكتابة/الحذف على
--      أي شعار (الشعار يظهر على بوابة الطلاب — خطر تشويه). الجديد:
--      كل مدرّس يملك مجلده فقط (auth.uid كأول مجلد في المسار) + قائمة
--      أنواع ملفات صور آمنة عند الرفع (png/jpeg/webp — بدون SVG لمنع
--      تنفيذ سكربتات داخل ملفات SVG العامة).
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) حارس أعمدة profiles الحساسة
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.guard_profiles_sensitive_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  -- سياق service-role (Edge Functions، SQL Editor، النداءات الخلفية):
  -- لا يوجد auth.uid() — سياق موثوق يتجاوز RLS أصلًا، يمر عادي.
  if auth.uid() is null then
    return new;
  end if;

  select coalesce(is_admin, false) into v_is_admin
  from public.profiles where id = auth.uid();
  if v_is_admin then
    return new;  -- الأدمن يدير الاشتراكات والتفعيل بشكل مشروع
  end if;

  -- أي مستخدم آخر (حتى على صفه الشخصي) ممنوع من الأعمدة الحساسة.
  -- تعديل الأعمدة العادية (full_name/phone/...) يبقى مسموحًا كالسابق.
  if new.is_admin is distinct from old.is_admin
     or new.is_verified is distinct from old.is_verified
     or new.subscription_status is distinct from old.subscription_status
     or new.subscription_expires_at is distinct from old.subscription_expires_at
     or new.account_type is distinct from old.account_type
  then
    raise exception 'غير مسموح بتعديل حقول الاشتراك أو الصلاحيات'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_sensitive on public.profiles;
create trigger trg_profiles_guard_sensitive
  before update on public.profiles
  for each row execute function public.guard_profiles_sensitive_update();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) سحب القراءة العامة من student_qr_tokens + سياسة workspace للمدرّس
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "qr_token_public_read" on public.student_qr_tokens;
drop policy if exists "qr_token_workspace_read" on public.student_qr_tokens;

create policy "qr_token_workspace_read" on public.student_qr_tokens
  for select using (
    auth.uid() is not null
    and exists (
      select 1 from public.students s
      where s.id = student_qr_tokens.student_id
        and (s.teacher_id = auth.uid()
             or public.can_access_workspace(s.teacher_id))
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) حصر teacher-logos على مالك المجلد + أنواع صور آمنة
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "teacher_logos_owner_upload" on storage.objects;
drop policy if exists "teacher_logos_owner_update" on storage.objects;
drop policy if exists "teacher_logos_owner_delete" on storage.objects;

create policy "teacher_logos_owner_upload"
  for insert to authenticated with check (
    bucket_id = 'teacher-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and coalesce(metadata->>'mimetype', '') in ('image/png', 'image/jpeg', 'image/webp')
  );

create policy "teacher_logos_owner_update"
  for update to authenticated
  using (
    bucket_id = 'teacher-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'teacher-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "teacher_logos_owner_delete"
  for delete to authenticated using (
    bucket_id = 'teacher-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) فحص ذاتي بعد التشغيل — النتائج المتوقعة موضحة جوار كل استعلام
--    (شغّلها يدويًا في SQL Editor بعد الملف للتأكد)
-- ═══════════════════════════════════════════════════════════════════════════
-- أ) سياسات student_qr_tokens — المتوقع: qr_token_workspace_read (select)
--    و qr_token_teacher_insert و qr_token_teacher_update فقط، بلا أي public_read:
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'student_qr_tokens';

-- ب) تريجر الحارس على profiles — المتوقع: trg_profiles_guard_sensitive:
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.profiles'::regclass and not tgisinternal;

-- ج) سياسات teacher-logos — المتوقع: upload/update/delete restricted to authenticated:
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'teacher_logos%';

-- د) الاختبار الحقيقي: من التطبيق، أي مستخدم غير أدمن يحاول تغيير
--    اشتراكه يجب أن يفشل بخطأ 42501 (التريجر يعمل في سياق المستخدم).
