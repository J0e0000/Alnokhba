-- NOKHBA V2: fixed pricing rules, QR entry policy, lesson links, and teacher alerts

alter table public.teacher_settings
  add column if not exists pricing_rules jsonb not null default '[]'::jsonb;
alter table public.teacher_settings
  add column if not exists entry_policy jsonb not null default '{"max_warnings":3,"require_payment":true}'::jsonb;

-- Resolve one stable price by specificity: group+stage, group, stage, then default.
create or replace function public.resolve_student_price(p_teacher_id uuid, p_student_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (
      select (r->>'price')::numeric from jsonb_array_elements(coalesce(ts.pricing_rules,'[]'::jsonb)) r
      where coalesce(r->>'group_name','') = coalesce(s.group_name,'')
        and coalesce(r->>'stage','') = coalesce(s.stage,'')
        and coalesce(r->>'price','') ~ '^[0-9]+(\\.[0-9]+)?$'
      order by 1 desc limit 1
    ),
    (
      select (r->>'price')::numeric from jsonb_array_elements(coalesce(ts.pricing_rules,'[]'::jsonb)) r
      where coalesce(r->>'group_name','') = coalesce(s.group_name,'')
        and coalesce(r->>'stage','') = ''
        and coalesce(r->>'price','') ~ '^[0-9]+(\\.[0-9]+)?$'
      order by 1 desc limit 1
    ),
    (
      select (r->>'price')::numeric from jsonb_array_elements(coalesce(ts.pricing_rules,'[]'::jsonb)) r
      where coalesce(r->>'stage','') = coalesce(s.stage,'')
        and coalesce(r->>'group_name','') = ''
        and coalesce(r->>'price','') ~ '^[0-9]+(\\.[0-9]+)?$'
      order by 1 desc limit 1
    ),
    (ts.group_pricing -> s.group_name)::numeric,
    0
  )
  from public.students s join public.teacher_settings ts on ts.teacher_id=s.teacher_id
  where s.id=p_student_id and s.teacher_id=p_teacher_id;
$$;

-- Current-cycle payment status plus QR entry decision.
drop function if exists public.get_student_payment_statuses(uuid, text);
create function public.get_student_payment_statuses(
  p_teacher_id uuid,
  p_group_name text default null
) returns table(
  student_id uuid, total_due numeric, total_paid numeric, remaining numeric,
  status text, lesson_price numeric, entry_allowed boolean,
  blocked_by_warnings boolean, warnings integer
)
language sql security definer set search_path = public
as $$
  select s.id,
    public.resolve_student_price(p_teacher_id,s.id),
    coalesce((select sum(p.amount) from public.student_payments p where p.student_id=s.id and p.teacher_id=p_teacher_id and p.payment_date >= date_trunc('month', current_date)::date),0),
    greatest(0, public.resolve_student_price(p_teacher_id,s.id) - coalesce((select sum(p.amount) from public.student_payments p where p.student_id=s.id and p.teacher_id=p_teacher_id and p.payment_date >= date_trunc('month', current_date)::date),0)),
    case when coalesce((select sum(p.amount) from public.student_payments p where p.student_id=s.id and p.teacher_id=p_teacher_id and p.payment_date >= date_trunc('month', current_date)::date),0) >= public.resolve_student_price(p_teacher_id,s.id) and public.resolve_student_price(p_teacher_id,s.id)>0 then 'paid' when coalesce((select sum(p.amount) from public.student_payments p where p.student_id=s.id and p.teacher_id=p_teacher_id and p.payment_date >= date_trunc('month', current_date)::date),0)>0 then 'partial' else 'unpaid' end,
    public.resolve_student_price(p_teacher_id,s.id),
    (coalesce((select (ts.entry_policy->>'require_payment')::boolean from public.teacher_settings ts where ts.teacher_id=p_teacher_id),true)=false or public.resolve_student_price(p_teacher_id,s.id)<=0 or coalesce((select sum(p.amount) from public.student_payments p where p.student_id=s.id and p.teacher_id=p_teacher_id and p.payment_date >= date_trunc('month', current_date)::date),0) >= public.resolve_student_price(p_teacher_id,s.id)) and coalesce(s.warnings,0) < coalesce((select (ts.entry_policy->>'max_warnings')::integer from public.teacher_settings ts where ts.teacher_id=p_teacher_id),3),
    coalesce(s.warnings,0) >= coalesce((select (ts.entry_policy->>'max_warnings')::integer from public.teacher_settings ts where ts.teacher_id=p_teacher_id),3),
    coalesce(s.warnings,0)
  from public.students s where s.teacher_id=p_teacher_id and (p_group_name is null or s.group_name=p_group_name);
$$;
grant execute on function public.get_student_payment_statuses(uuid,text) to authenticated;

-- Replace the current-session projection in the public portal RPC by exposing the saved link.
create or replace function public.get_student_portal_access(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v uuid; t uuid; s record; ts record; price numeric; paid numeric; maxw integer;
begin
  select qt.student_id, s.teacher_id into v,t
  from public.student_qr_tokens qt
  join public.students s on s.id=qt.student_id
  where qt.token=p_token and qt.revoked_at is null
  limit 1;
  if v is null and p_token ~ '^[0-9a-f-]{36}$' then select id,teacher_id into v,t from students where id=p_token::uuid limit 1; end if;
  if v is null then return null; end if;
  select * into s from students where id=v and teacher_id=t; select * into ts from teacher_settings where teacher_id=t;
  price:=public.resolve_student_price(t,v); select coalesce(sum(amount),0) into paid from student_payments where student_id=v and teacher_id=t and payment_date>=date_trunc('month',current_date)::date; maxw:=coalesce((ts.entry_policy->>'max_warnings')::integer,3);
  return jsonb_build_object('lessonPrice',price,'paymentStatus',case when paid>=price and price>0 then 'paid' when paid>0 then 'partial' else 'unpaid' end,'totalPaid',paid,'entryAllowed',(coalesce((ts.entry_policy->>'require_payment')::boolean,true)=false or price<=0 or paid>=price) and coalesce(s.warnings,0)<maxw,'blockedByWarnings',coalesce(s.warnings,0)>=maxw,'warnings',coalesce(s.warnings,0),'maxWarnings',maxw,'sessionToday',(select coalesce(row_to_json(x),'{}') from (select lesson_topic,homework_text,video_link,session_date from session_logs where teacher_id=t and group_name=s.group_name order by session_date desc limit 1)x));
end; $$;
grant execute on function public.get_student_portal_access(text) to anon;

-- Teacher event rows for payments and blocked entry decisions.
create or replace function public.notify_payment_recorded() returns trigger language plpgsql security definer set search_path=public as $$
declare n text; begin select name into n from students where id=new.student_id; insert into teacher_notification_events(teacher_id,event_type,title,body,related_student_id) values(new.teacher_id,'payment_recorded','تم تسجيل دفعة','تم تسجيل دفعة بقيمة '||new.amount||' للطالب '||coalesce(n,''),new.student_id); return new; end; $$;
drop trigger if exists on_payment_recorded_teacher_event on student_payments;
create trigger on_payment_recorded_teacher_event after insert on student_payments for each row execute procedure notify_payment_recorded();
