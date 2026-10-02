-- ============================================================================
-- RLS ISOLATION TEST SUITE — EL NO5BA (EDU + CENTERS)
-- ============================================================================
-- التشغيل: Supabase Dashboard → SQL Editor → الصق الملف كامل → Run
-- الغرض: إثبات عمليًا أن مستخدم مركز A لا يرى/لا يعدّل بيانات مركز B،
--        وأن مستخدم EDU لا يصل لبيانات مدرّس آخر، وأن الأدمن يرى الكل.
-- الملف للقراءة فقط (SELECT/ROLLBACK) — لا يعدّل أي بيانات حقيقية.
-- النتيجة: كل استعلام "يجب ألا يُرجع صفوف" اتحرج لو رجع فيه صف.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- كيفية الاختبار:
--   1) بدّل هوية مستخدم عبر SET LOCAL request.jwt.claims (محاكاة JWT).
--   2) نفّذ الاستعلام داخل معاملة تُلغى دائمًا (ROLLBACK).
--   3) النتيجة المتوقعة مكتوبة فوق كل استعلام.
-- ملاحظة: استبدل المعرفات التالية بمعرفات حقيقية من مشروعك قبل التشغيل.
-- ============================================================================

-- المعرفات (عدّلها):
--   :center_a        — uuid مركز A
--   :center_b        — uuid مركز B
--   :user_a_member   — uuid عضو في مركز A فقط
--   :center_a_student— uuid طالب في مركز A
--   :edu_teacher_1   — uuid مدرّس EDU رقم 1
--   :edu_teacher_2   — uuid مدرّس EDU رقم 2
--   :admin_user      — uuid أدمن المنصة

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 1 — عضو مركز A يحاول قراءة بيانات مركز B → يجب أن تُرجع 0 صفوف
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', ':user_a_member', 'role', 'authenticated')::text,
    true
  );

  -- يجب = 0
  select count(*) as must_be_zero_b_students from public.center_students where center_id = ':center_b'::uuid;
  -- يجب = 0
  select count(*) as must_be_zero_b_sessions from public.center_sessions where center_id = ':center_b'::uuid;
  -- يجب = 0
  select count(*) as must_be_zero_b_attendance from public.center_attendance where center_id = ':center_b'::uuid;
  -- يجب = 0 (حتى جدول العضوية نفسه لا يفشي قوائم المراكز الأخرى)
  select count(*) as must_be_zero_b_membership from public.center_members where center_id = ':center_b'::uuid;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 2 — عضو مركز A يحاول IDOR: تعديل/حذف صف مركز B مباشرة → يجب أن يُرجع 0
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', ':user_a_member', 'role', 'authenticated')::text,
    true
  );
  -- محاولة تعديل طالب في مركز B — يجب rows affected = 0
  update public.center_students set name = 'HACKED' where center_id = ':center_b'::uuid;
  -- محاولة حذف قاعة في مركز B — يجب rows affected = 0
  delete from public.center_rooms where center_id = ':center_b'::uuid;
  -- محاولة إنشاء حصة في مركز B (insert بمعرف مركز لا ينتمي له) → يجب أن يفشل
  -- (سياسات insert تتحقق من is_center_member(center_id))
  insert into public.center_sessions (center_id, group_id, session_date)
  select ':center_b'::uuid, id, current_date from public.center_groups where center_id = ':center_b'::uuid limit 1;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 3 — حارس أعمدة profiles (migration 042): مستخدم عادي يحاول ترقية نفسه
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', ':user_a_member', 'role', 'authenticated')::text,
    true
  );
  -- يجب أن يفشل بـ exception من تريجر الحارس
  update public.profiles set is_admin = true where id = ':user_a_member'::uuid;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 4 — EDU: مدرّس 1 لا يرى طلاب/حضور مدرّس 2
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', ':edu_teacher_1', 'role', 'authenticated')::text,
    true
  );
  -- يجب = 0
  select count(*) as must_be_zero_other_students from public.students where teacher_id = ':edu_teacher_2'::uuid;
  -- يجب = 0
  select count(*) as must_be_zero_other_sessions from public.lesson_sessions where teacher_id = ':edu_teacher_2'::uuid;
  -- يجب = 0
  select count(*) as must_be_zero_other_scores from public.exam_scores where teacher_id = ':edu_teacher_2'::uuid;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 5 — سجلات التدقيق: غير الأدمن لا يقرأ admin_audit_logs إطلاقًا
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', ':user_a_member', 'role', 'authenticated')::text,
    true
  );
  -- يجب = 0 (سياسة admin_audit_logs_admin_read: is_admin_user() فقط)
  select count(*) as must_be_zero_audit_rows from public.admin_audit_logs;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 6 — الأدمن يرى كل المراكز (وصول دعم مشروع فقط)
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', ':admin_user', 'role', 'authenticated')::text,
    true
  );
  -- يجب >= عدد المراكز الفعلي (الأدمن يرى الكل)
  select count(*) as admin_sees_all_centers from public.centers;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- TEST 7 — non-member يحاول تنفيذ admin_log_audit (حتى لو معه anon key)
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', ':user_a_member', 'role', 'authenticated')::text,
    true
  );
  -- يجب أن يفشل: admin_log_audit يتطلب is_admin للسياق المسجّل
  select public.admin_log_audit('test_action', null, null, 'must fail', '{}', ':user_a_member'::uuid, null, true, null);
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- النهاية — كل الاختبارات أعلاه ROLLBACK (لم يتغير أي شيء في قاعدة البيانات)
-- النتيجة المطلوبة عند التشغيل:
--   TEST 1: كل الأعمدة must_be_zero = 0
--   TEST 2: لا صفوف تتأثر، والـ insert يفشل
--   TEST 3: exception من حارس profiles
--   TEST 4: كل الأعمدة must_be_zero = 0
--   TEST 5: must_be_zero_audit_rows = 0
--   TEST 6: admin_sees_all_centers = العدد الكلي
--   TEST 7: exception "admin access required"
-- ============================================================================
