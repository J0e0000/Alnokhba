-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 053 — Student archive (أرشفة الطلاب)
-- Task 42: "خلي النظام نفسه يشوف مين غايب عن آخر حصتين ويأرشفه —
--           مش بس يبدأ من الحصص الجاية" (auto-archive, retroactive)
--
-- The auto-archive engine lives in the client (WorkspaceStore): on every load
-- it finds each group's last 2 HELD lectures (completed, or date already
-- passed — future lectures never count) and archives students explicitly
-- marked غائب in BOTH. Archived students disappear from the active workflow
-- (grids, reports, pickers) but keep their history; restoring is one tap.
--
-- Columns:
--   archived            boolean  — hidden from active lists when true
--   archived_at         timestamptz — when the archive happened
--   archived_reason     text     — why (auto rule or manual)
--   auto_archive_marker timestamptz — last time the engine archived (or a
--                         restore suppressed it). Evidence is CONSUMED: the two
--                         lectures that caused an archive/restore never qualify
--                         again — only lectures held after the marker count.
--                         Restoring a student can never trigger an instant
--                         re-archive loop, and re-archiving requires two FRESH
--                         absences in lectures held after the marker.
--
-- Idempotent + safe to re-run. No RLS changes: column access inherits the
-- table's existing policies. No backfill: the first client load after deploy
-- scans the ALREADY-PAST lectures, so existing absentees are archived
-- immediately (retroactive by design).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.students add column if not exists archived boolean not null default false;
alter table public.students add column if not exists archived_at timestamptz;
alter table public.students add column if not exists archived_reason text;
alter table public.students add column if not exists auto_archive_marker timestamptz;

-- Small, targeted: the archive panel filters by teacher + archived.
create index if not exists idx_students_teacher_archived
  on public.students (teacher_id, archived)
  where archived = true;
