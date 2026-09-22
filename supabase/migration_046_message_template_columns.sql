-- ═══════════════════════════════════════════════════════════════════════════
-- migration_046_message_template_columns.sql
--
-- FIXES (verified live 2026-09-22): saving the message templates modal fails
-- with PostgREST PGRST204 / 42703 — "Could not find the 'msg_attendance_absent'
-- column of 'teacher_settings' in the schema cache".
--
-- Root cause: the templates modal saves 7 message columns in one update, but
-- 3 of them were never added to the production table:
--   msg_report_template     (قالب تقرير الطابور)
--   msg_attendance_present  (رسالة الحاضر)
--   msg_attendance_absent   (رسالة الغائب)
-- The other 4 (msg_welcome, msg_warning, msg_promotion, qr_message_template)
-- already exist and are untouched.
--
-- HOW TO APPLY (one time):
--   Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS).
-- RLS is unchanged: the new columns live on teacher_settings and are covered
-- by the table's existing policies.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.teacher_settings
  ADD COLUMN IF NOT EXISTS msg_report_template    text DEFAULT '',
  ADD COLUMN IF NOT EXISTS msg_attendance_present text DEFAULT '',
  ADD COLUMN IF NOT EXISTS msg_attendance_absent  text DEFAULT '';
