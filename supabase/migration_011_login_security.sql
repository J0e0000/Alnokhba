-- ============================================================================
-- نظام النخبة — Migration 011: أمان الدخول (قفل بعد محاولات فاشلة + سجل نشاط)
-- ============================================================================

create table if not exists login_attempts (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  success boolean not null,
  created_at timestamptz not null default now()
);

alter table login_attempts enable row level security;

-- أي حد (حتى قبل تسجيل الدخول) يقدر يسجّل محاولة — ده طبيعي، هي بيانات محاولة دخول بس
create policy "login_attempts_insert_anyone" on login_attempts
  for insert with check (true);

-- بس الأدمن يقدر يشوف السجل
create policy "login_attempts_admin_read" on login_attempts
  for select using (is_admin_user());

-- قفل مؤقت: 5 محاولات فاشلة خلال 15 دقيقة
create or replace function is_locked_out(check_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select count(*) >= 5
  from login_attempts
  where email = check_email and success = false and created_at > now() - interval '15 minutes';
$$;

grant execute on function is_locked_out(text) to anon, authenticated;
grant insert on login_attempts to anon, authenticated;

create index if not exists idx_login_attempts_email_time on login_attempts(email, created_at);
