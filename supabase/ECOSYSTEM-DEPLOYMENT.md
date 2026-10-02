# ECOSYSTEM HARDENING + CENTERS — DEPLOYMENT GUIDE

## الجزء الأول — تشغيل المايجريشن (SQL Editor — 5 دقائق)

1. افتح Supabase Dashboard → **SQL Editor** → New query.
2. الصق محتوى `supabase/migration_049_audit_rate_indexes.sql` كامل → **Run**.
   (يضيف: `admin_log_audit` RPC + `consume_rate_limit` محدد معدل + فهارس أداء).
3. الصق محتوى `supabase/migration_050_centers.sql` كامل → **Run**.
   (ينشئ: جداول المنتج الجديد centers كاملة + عزل RLS + تدقيق + `create_center` RPC).
4. (اختياري — اختبار العزل) الصق `supabase/rls_isolation_tests.sql` بعد تعديل
   المعرفات أعلى الملف بمعرفات حقيقية، وشغّله: كل الاختبارات ROLLBACK ولا تغيّر شيئًا.

الملفات idempotent — إعادة التشغيل آمنة ولا تحذف أي بيانات.

## الجزء الثاني — إعادة نشر Edge Function

بعد تعديل `admin-account-actions` (تدقيق + rate limit + تعطيل/تفعيل حساب):

1. افتح `supabase/admin_account_actions_deploy_renewal.json` (أُعيد توليده).
2. Supabase Dashboard → Edge Functions → `admin-account-actions` → Deploy
   (نفس خطوات RENEWAL-DEPLOYMENT.md) أو:
   `supabase functions deploy admin-account-actions --project pbsythpzncjoafpmijyd`
3. كرر نفس الشيء لو أردت تحديث `admin-backup` (أُضيف له audit للتنزيل + حدود
   معدل على create/restore — يعمل حتى بدون إعادة نشر لكن بدون الحدود الجديدة).

لا مفاتيح جديدة مطلوبة (RESEND_API_KEY كما هي).

## الجزء الثالث — النشر (Vercel)

النشر تلقائي بعد push (نفس مسار EDU). المنتج الجديد يعيش على نفس الموقع:

- **الرابط: `https://al-nokhbba.vercel.app/centers`**
- يتطلب تسجيل دخول (نفس حساب المنصة).
- أول مرة: المستخدم ينشئ مركزه من شاشة الترحيب.

## ملاحظات أمان

- كل بيانات المراكز محمية بـ RLS على مستوى قاعدة البيانات (عزل center_id +
  عضوية center_members) — لا اعتماد على الواجهة إطلاقًا.
- `admin_log_audit` يكتب في `admin_audit_logs` (للإضافة فقط — بلا update/delete).
- حدود المعدل في Edge Functions: 40 عملية أدمن/5د، 10 تغيير كلمة مرور/5د،
  6 نسخ احتياطية/30د، 3 استعادة/30د لكل أدمن.
- لا كلمات مرور ولا توكنات تُسجَّل في أي سجل — فقط الحدث والمعرفات.
