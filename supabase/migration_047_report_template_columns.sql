-- ═══════════════════════════════════════════════════════════════════════════
-- migration_047_report_template_columns.sql
--
-- استوديو التقارير (Reports Studio, 2026-09): six customizable report types
-- need their own persistent templates on teacher_settings. The studio saves
-- these five NEW columns (the existing msg_attendance_present/absent pair is
-- reused for the session-update report and already exists via migration_046).
--
-- Columns:
--   msg_student_weekly    → 📊 التقرير الأسبوعي للطالب (WhatsApp)
--   msg_student_exam      → 📝 نتيجة اختبار (WhatsApp)
--   msg_teacher_session   → 📚 تقرير الجلسة للمدرس (bell + copy)
--   msg_teacher_weekly    → 📈 ملخص الأسبوع للمدرس (bell + copy)
--   msg_teacher_followup  → ⚠️ تنبيه المتابعة (bell + copy)
--
-- HOW TO APPLY (one time):
--   Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS).
-- Empty default ('') means "use the app's built-in Egyptian template" — the
-- studio seeds it on first open, so no backfill is needed.
-- RLS unchanged: new columns are covered by the existing teacher_settings
-- policies.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.teacher_settings
  ADD COLUMN IF NOT EXISTS msg_student_weekly   text DEFAULT '',
  ADD COLUMN IF NOT EXISTS msg_student_exam     text DEFAULT '',
  ADD COLUMN IF NOT EXISTS msg_teacher_session  text DEFAULT '',
  ADD COLUMN IF NOT EXISTS msg_teacher_weekly   text DEFAULT '',
  ADD COLUMN IF NOT EXISTS msg_teacher_followup text DEFAULT '';
