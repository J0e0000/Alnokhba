-- ============================================================================
-- النخبة — Migration 061: Security audit patch (applied to production 2026-10-26)
-- ============================================================================
-- 1) student_qr_tokens: drop the legacy `qr_token_public_read` policy
--    (SELECT using(true)) that let ANY anonymous visitor list every portal
--    token (769 rows) — breaking the "token secrecy" model the student
--    portal relies on. Replaced by `qr_token_workspace_read` (from the
--    previously-written migration_042, which was never applied): the teacher
--    app keeps full read access (owner / workspace members / admin support
--    session via can_access_workspace), anon gets nothing. The portal itself
--    never reads this table directly (it uses the token-parameter RPCs
--    get_student_portal_data / get_student_portal_access / ...), so printed
--    QR links are unaffected. NO tokens were rotated by design.
--
-- 2) edge_rate_limits: enable RLS (defense in depth — grants already
--    blocked anon; edge functions use service_role which bypasses RLS).
-- ============================================================================

begin;

drop policy if exists "qr_token_public_read" on public.student_qr_tokens;

create policy "qr_token_workspace_read" on public.student_qr_tokens
  for select using (
    auth.uid() is not null
    and exists (
      select 1 from public.students s
      where s.id = student_qr_tokens.student_id
        and (s.teacher_id = auth.uid() or public.can_access_workspace(s.teacher_id))
    )
  );

alter table public.edge_rate_limits enable row level security;

commit;
