-- Fix: student_qr_tokens stores student_id, not teacher_id.
create or replace function public.get_portal_teacher_name(p_token text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.full_name
  from public.student_qr_tokens qt
  join public.students s on s.id = qt.student_id
  join public.profiles p on p.id = s.teacher_id
  where qt.token = p_token
    and qt.revoked_at is null
  limit 1;
$$;

grant execute on function public.get_portal_teacher_name(text) to anon;
