-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 063 — حد معدل الطلبات للدوال الطرفية (Edge rate limiting)
-- ═══════════════════════════════════════════════════════════════════════════
-- جدول edge_rate_limits موجود من جولة التدقيق (RLS مفعّل، صلاحيات صفرية
-- للعملاء). اللي ناقص: دالة ذرّية (atomic) بيزيد العداد ويرد بالقرار في
-- خطوة واحدة — بدون سباق (check-then-insert). الدوال الطرفية بتستدعيها
-- بحساب service_role فقط؛ العملاء لا يمكنهم تنفيذها إطلاقًا.
--
--   edge_rate_limit_hit(p_key, p_limit, p_window_secs) → boolean
--     نافذة ثابتة محاذاة للألف ثانية؛ count > limit ⇒ false (429)
--     fail-open في الدالة الطرفية نفسها: أي خطأ DB = السماح (لا حجب زائف)
--
-- ملاحظة: لا يمس أي جدول آخر، لا RLS يتغير، لا توكنات.
-- التشغيل: SQL Editor أو Management API (idempotent — آمن للتكرار)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) قيد فريد لازم للـ ON CONFLICT
create unique index if not exists edge_rate_limits_key_window_idx
  on public.edge_rate_limits (key, window_start);

-- 2) الدالة الذرّية
create or replace function public.edge_rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_secs integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_count integer;
begin
  if p_key is null or p_limit is null or p_window_secs is null
     or p_limit < 1 or p_window_secs < 1 then
    return true; -- إعدادات فاسدة = لا حجب (fail-open)
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from v_now) / p_window_secs) * p_window_secs
  );

  insert into public.edge_rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start)
  do update set count = public.edge_rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

-- 3) التنفيذ لـ service_role فقط (الدوال الطرفية). عملاء anon/authenticated ممنوعون.
revoke all on function public.edge_rate_limit_hit(text, integer, integer) from public;
revoke all on function public.edge_rate_limit_hit(text, integer, integer) from anon;
revoke all on function public.edge_rate_limit_hit(text, integer, integer) from authenticated;

-- 4) تنظيف دوري: صفوف نوافذ انتهت قبل ساعة — استدعاء رخيص من حافة الدوال
create or replace function public.edge_rate_limit_sweep()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.edge_rate_limits where window_start < now() - interval '1 hour';
$$;

revoke all on function public.edge_rate_limit_sweep() from public;
revoke all on function public.edge_rate_limit_sweep() from anon;
revoke all on function public.edge_rate_limit_sweep() from authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- فحص ذاتي
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'edge_rate_limit_hit'
  ) then
    raise exception 'Migration 063 FAILED: edge_rate_limit_hit missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'edge_rate_limits'
      and indexname = 'edge_rate_limits_key_window_idx'
  ) then
    raise exception 'Migration 063 FAILED: unique index missing';
  end if;
  raise notice 'Migration 063 applied: edge_rate_limit_hit + sweep + unique index';
end $$;
