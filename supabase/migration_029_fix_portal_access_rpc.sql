-- Fix the already-deployed portal access RPC.
-- student_qr_tokens has student_id, not teacher_id.
create or replace function public.get_student_portal_access(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid;
  t uuid;
  s record;
  ts record;
  price numeric := 0;
  paid numeric := 0;
  maxw integer := 3;
begin
  select qt.student_id, st.teacher_id
    into v, t
  from public.student_qr_tokens qt
  join public.students st on st.id = qt.student_id
  where qt.token = p_token
    and qt.revoked_at is null
  limit 1;

  if v is null and p_token ~ '^[0-9a-f-]{36}$' then
    select st.id, st.teacher_id into v, t
    from public.students st
    where st.id = p_token::uuid
    limit 1;
  end if;

  if v is null then return null; end if;

  select * into s from public.students where id = v and teacher_id = t;
  select * into ts from public.teacher_settings where teacher_id = t;
  if s.id is null then return null; end if;

  price := coalesce(public.resolve_student_price(t, v), 0);
  select coalesce(sum(sp.amount), 0)
    into paid
  from public.student_payments sp
  where sp.student_id = v
    and sp.teacher_id = t
    and sp.payment_date >= date_trunc('month', current_date)::date;

  maxw := coalesce((ts.entry_policy->>'max_warnings')::integer, 3);

  return jsonb_build_object(
    'lessonPrice', price,
    'paymentStatus', case when paid >= price and price > 0 then 'paid' when paid > 0 then 'partial' else 'unpaid' end,
    'totalPaid', paid,
    'entryAllowed', (coalesce((ts.entry_policy->>'require_payment')::boolean, true) = false or price <= 0 or paid >= price) and coalesce(s.warnings, 0) < maxw,
    'blockedByWarnings', coalesce(s.warnings, 0) >= maxw,
    'warnings', coalesce(s.warnings, 0),
    'maxWarnings', maxw,
    'sessionToday', (select coalesce(row_to_json(x), '{}') from (
      select lesson_topic, homework_text, video_link, session_date
      from public.session_logs
      where teacher_id = t and group_name = s.group_name
      order by session_date desc
      limit 1
    ) x)
  );
end;
$$;

grant execute on function public.get_student_portal_access(text) to anon;
