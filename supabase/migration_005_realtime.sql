-- ============================================================================
-- نظام النخبة — Migration 005: تفعيل التحديث اللحظي (Realtime)
-- ============================================================================
-- ده اللي بيخلي أي تغيير (زي تسجيل حضور بالـ QR من جهاز) يظهر فورًا على باقي
-- الأجهزة المسجّلة بنفس الحساب من غير ما تحتاج تعمل Refresh للصفحة.
-- شغّلها في Supabase → SQL Editor → New query → Run
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'students'
  ) then
    alter publication supabase_realtime add table students;
  end if;

  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'behavior_logs'
  ) then
    alter publication supabase_realtime add table behavior_logs;
  end if;

  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'session_logs'
  ) then
    alter publication supabase_realtime add table session_logs;
  end if;
end $$;
