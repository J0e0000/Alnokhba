-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 063b — إلغاء آلية الحد الزائدة من 063 (تُستبدل بـ consume_rate_limit)
-- ═══════════════════════════════════════════════════════════════════════════
-- 063 أنشأ edge_rate_limit_hit (نافذة ثابتة). اتقرر توحيد الآلية على
-- consume_rate_limit (migration_049) الموجودة والمجربة — بنفس الجدول
-- edge_rate_limits ونفس النمط المستخدم في admin-account-actions وadmin-backup
-- منذ جولة التدقيق. 063b يشيل النسخة المكررة ويبقي الجدول والقيد الأساسي.
-- idempotent — آمن للتكرار. لا يمس أي شيء آخر.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.edge_rate_limit_hit(text, integer, integer);
drop function if exists public.edge_rate_limit_sweep();
drop index if exists public.edge_rate_limits_key_window_idx;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'edge_rate_limit_hit') then
    raise exception 'Migration 063b FAILED: edge_rate_limit_hit still present';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'consume_rate_limit') then
    raise exception 'Migration 063b FAILED: consume_rate_limit (049) missing — limiter would be gone';
  end if;
  raise notice 'Migration 063b applied: redundant 063 limiter dropped; consume_rate_limit (049) remains the single mechanism';
end $$;
