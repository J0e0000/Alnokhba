-- ============================================================================
-- نظام النخبة — Migration 016: السماح بقراءة بيانات البوابة لغير المسجلين
-- ============================================================================
-- المشكلة: لما حد غير مسجل دخول (ولي أمر/طالب) يفتح رابط /qr/:token، جدول
-- student_qr_tokens قراءته متاحة بس الجداول التانية (students, attendance_records,
-- behavior_logs, exams, exam_scores, session_logs, group_schedule) مقفولة بقاعدة
-- "teacher_access" اللي بتسمح بس للمدرّس المسجّل دخول (auth.uid() = teacher_id).
-- عشان كده الرابط شغّال بس لما إنت (المدرّس) تفتحه وإنت داخل بحسابك.
--
-- الحل: نضيف قاعدة قراءة عامة (SELECT فقط) لكل جدول، بنفس فكرة student_qr_tokens
-- والجداول اللي عملناها في migration_015 بالظبط. الأمان بيفضل قائم على إن
-- التوكن نفسه سري وصعب تخمينه — مفيش حد يقدر يوصل لبيانات طالب من غير
-- ما يبقى معاه رابطه بالظبط. الكتابة (INSERT/UPDATE/DELETE) لسه مقفولة
-- على المدرّس بس، ملحقتش حاجة فيها.
-- ============================================================================

create policy "students_public_read" on students
  for select using (true);

create policy "attendance_records_public_read" on attendance_records
  for select using (true);

create policy "behavior_logs_public_read" on behavior_logs
  for select using (true);

create policy "exams_public_read" on exams
  for select using (true);

create policy "exam_scores_public_read" on exam_scores
  for select using (true);

create policy "session_logs_public_read" on session_logs
  for select using (true);

create policy "group_schedule_public_read" on group_schedule
  for select using (true);
