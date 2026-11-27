-- migration_067: students(code) index + RLS audit for students & payments
-- Operator note (2026-11-27): "Check RLS on the students and payments tables,
-- and add an index on the QR/student code column."
--
-- Run in Supabase Dashboard → SQL Editor → New query → paste whole file → Run.
-- Everything is idempotent: safe to re-run, changes nothing if already applied.
--
-- AUDIT SUMMARY (from the repo's migration history 002→066):
--   students          RLS enabled (019 line 322, re-asserted 040) + policy
--                     "students_workspace_access" FOR ALL via
--                     can_access_workspace(teacher_id) (008→019→040). The old
--                     public-read policy was dropped in 019; the student
--                     portal now reads only through token-scoped SECURITY
--                     DEFINER RPCs (029/054/055).
--   student_payments  RLS enabled + policy "payments_workspace_access" FOR ALL
--                     via can_access_workspace(teacher_id) (023), with
--                     teacher/student/date indexes.
--   student_qr_tokens RLS enabled; the historical "qr_token_public_read
--                     using (true)" token-enumeration hole was closed by 042
--                     (now workspace-scoped with an EXISTS check) — portal
--                     clients resolve tokens exclusively through RPCs.
--   The ONE gap: students.code (added in 002) never got an index — every
--   search-by-code and code lookup scans the whole table.

-- ── 1) The ask: index the QR/student code column ───────────────────────────
create index if not exists idx_students_code
  on public.students (code);

-- ── 2) RLS hard guarantees (idempotent no-ops when already correct) ─────────
alter table public.students        enable row level security;
alter table public.student_payments enable row level security;

-- ── 3) Canonical policies, restored only if missing (no destructive drops) ──
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'students'
      and policyname = 'students_workspace_access'
  ) then
    create policy "students_workspace_access" on public.students
      for all using (can_access_workspace(teacher_id))
      with check (can_access_workspace(teacher_id));
    raise notice 'students: created missing policy students_workspace_access';
  else
    raise notice 'students: policy students_workspace_access present';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_payments'
      and policyname = 'payments_workspace_access'
  ) then
    create policy "payments_workspace_access" on public.student_payments
      for all using (can_access_workspace(teacher_id))
      with check (can_access_workspace(teacher_id));
    raise notice 'student_payments: created missing policy payments_workspace_access';
  else
    raise notice 'student_payments: policy payments_workspace_access present';
  end if;
end $$;

-- ── 4) Self-audit: prints the live state after running ──────────────────────
do $$
declare
  r record;
  bad int := 0;
begin
  for r in
    select c.relname,
           c.relrowsecurity as rls_on,
           (select count(*) from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname) as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('students', 'student_payments', 'student_qr_tokens')
    order by c.relname
  loop
    raise notice '% : RLS=%, policies=%', r.relname,
      case when r.rls_on then 'ON' else 'OFF' end, r.policies;
    if not r.rls_on or r.policies = 0 then bad := bad + 1; end if;
  end loop;

  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_students_code'
  ) then
    raise notice 'idx_students_code on students(code): PRESENT';
  else
    raise notice 'idx_students_code on students(code): MISSING!';
    bad := bad + 1;
  end if;

  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'student_qr_tokens'
      and indexdef like '%token%'
  ) then
    raise notice 'student_qr_tokens token lookup index: PRESENT';
  else
    raise notice 'student_qr_tokens token lookup index: MISSING!';
    bad := bad + 1;
  end if;

  if bad = 0 then
    raise notice 'تم — RLS شغّال على students و payments والفهارس مكتملة';
  else
    raise notice 'انتبه: % مشكلة/مشاكل فوق — راجع الملاحظات', bad;
  end if;
end $$;
