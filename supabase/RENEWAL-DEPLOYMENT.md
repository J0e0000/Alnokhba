# التجديد + إيميل التجديد + سجل التجديدات — خطوات التشغيل (Task 28)

## نظرة عامة على ما أُضيف

| المكوّن | الملف | طريقة التشغيل |
|---|---|---|
| جدول سجل التجديدات + مطابقة حالة `expired` (بدون أي حذف) | `supabase/migration_048_subscription_renewals.sql` | Supabase Dashboard → SQL Editor → لصق كامل → Run |
| تحديث Edge Function `admin-account-actions` (تجديد + إيميل + إعادة إرسال) | `supabase/functions/admin-account-actions/index.ts` | انظر الخطوة 2 |
| حزمة جاهزة للنشر بالنسخ | `supabase/admin_account_actions_deploy_renewal.json` | انظر الخطوة 2 |

> **قاعدة حفظ البيانات (ثابتة):** انتهاء الاشتراك = إيقاف وصول فقط. لا يوجد أي حذف تلقائي
> للطلاب/الحضور/الدرجات/الامتحانات/الملاحظات/التقارير/الإعدادات. الحذف اليدوي المقصود من
> الأدمن فقط (موجود أصلًا ولم يُمس). migration_048 تعرض في آخرها فحصًا شفافًا لكل cron
> jobs يؤكد أنه لا يوجد أي job يحذف بيانات.

---

## الخطوة 1 — تشغيل migration_048 (إلزامية قبل التجديد الأول)

Supabase Dashboard → SQL Editor → الصق محتوى `supabase/migration_048_subscription_renewals.sql` كاملًا → Run.

- الملف idempotent (آمن لإعادة التشغيل).
- لو ظهر NOTICE عن pg_cron غير متاح — تجاهله: الجدولة الاختيارية فقط، والواجهة تعتبر
  الحساب منتهيًا من التاريخ تلقائيًا كما كان.
- آخر جزء في الملف يطبع قائمة cron jobs الموجودة وحالة كل واحدة (يحذف بيانات: لا ✓).

## الخطوة 2 — تحديث Edge Function ‏admin-account-actions

الطريقة (نفس طريقة إصدارات send-push-notification السابقة — كود الدالة منسوخ بالكامل
داخل `supabase/admin_account_actions_deploy_renewal.json` في الحقل `files[0].content`):

1. افتح Supabase Dashboard → Edge Functions → `admin-account-actions`.
2. اختر **Edit/Delete & Redeploy** والصق محتوى `files[0].content` من ملف الحزمة
   (أو انسخ `supabase/functions/admin-account-actions/index.ts` كما هو) → Deploy.
3. الأكشنات الجديدة: `renew_subscription` و `retry_renewal_email` — الأكشنات القديمة
   (`confirm_account` / `set_password`) لم تُمس.

## الخطوة 3 — متغيرات البيئة (Secrets) لإيميل التجديد

Supabase Dashboard → Edge Functions → `admin-account-actions` → Secrets (أو
`supabase secrets set`):

| المتغير | إلزامي؟ | القيمة |
|---|---|---|
| `RESEND_API_KEY` | **إلزامي لإرسال الإيميل** | مفتاح API من resend.com |
| `RENEWAL_EMAIL_FROM` | اختياري | مثل `Alnokhba <noreply@yourdomain.com>` — الافتراضي `onboarding@resend.dev` يعمل في وضع اختبار Resend فقط |

**بدون المفتاح:** التجديد يعمل ويُحفظ طبيعي، لكن يُسجَّل في السجل «فشل الإيميل» مع
سبب واضح، ويظهر للأدمن زر «إعادة إرسال الإيميل» — بعد إضافة المفتاح اضغط الزر
فيُرسل الإيميل فورًا دون إعادة أي تجديد.

## الخطوة 4 — التحقق

1. لوحة الأدمن → المدرّسون → «✏️ تحديد الانتهاء» → تمديد بأيام (مثلًا 30) → حفظ.
   المتوقع: تنبيه «تم تجديد الاشتراك بنجاح — تاريخ الانتهاء الجديد: [تاريخ]».
2. تبويب «🔄 سجل التجديدات»: صف جديد فيه التاريخ السابق/الجديد، من قام بالتجديد،
   وحالة الإيميل (تم ✅ / فشل ⚠️ + زر إعادة الإرسال).
3. صندوق بريد صاحب الحساب: رسالة بعنوان **"Your subscription has been renewed"**
   فيها الاسم وتاريخ التجديد والانتهاء الجديد والباقة وتأكيد أن البيانات محفوظة.
4. تجربة فشل الإيميل (احذف `RESEND_API_KEY` مؤقتًا): التجديد يبقى ناجحًا، وتنبيه
   فشل الإيميل يظهر، وزر إعادة الإرسال يعمل بعد إعادة المفتاح.
