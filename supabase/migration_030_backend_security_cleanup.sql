-- Backend security cleanup: keep only token-based portal RPCs public.
revoke execute on function public.accept_assistant_request(uuid) from anon;
revoke execute on function public.admin_teacher_stats() from anon;
revoke execute on function public.can_access_workspace(uuid) from anon;
revoke execute on function public.get_accounts_summary(uuid, date, date, text) from anon;
revoke execute on function public.get_or_create_student_qr_token(uuid) from anon;
revoke execute on function public.get_student_notifications(uuid, integer) from anon;
revoke execute on function public.get_student_payment_statuses(uuid, text) from anon;
revoke execute on function public.get_student_payment_summary(uuid, uuid) from anon;
revoke execute on function public.handle_new_user() from anon;

create or replace function public.qb_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
