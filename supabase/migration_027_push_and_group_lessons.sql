-- V3: real browser push subscriptions, persistent QR message template, and push jobs
alter table public.teacher_settings add column if not exists qr_message_template text not null default 'مرحباً {studentName}\nرابط متابعة الطالب:';

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_owner on public.push_subscriptions;
create policy push_subscriptions_owner on public.push_subscriptions for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

create table if not exists public.push_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  url text not null default '/',
  source_event_id uuid,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.push_notification_jobs enable row level security;
drop policy if exists push_notification_jobs_owner on public.push_notification_jobs;
create policy push_notification_jobs_owner on public.push_notification_jobs for select using (teacher_id = auth.uid());

create or replace function public.queue_teacher_push_job() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.push_notification_jobs(teacher_id,title,body,url,source_event_id)
  values(new.teacher_id, coalesce(new.title,'تنبيه جديد'), coalesce(new.body,'لديك تنبيه جديد'), '/', new.id);
  return new;
end; $$;
drop trigger if exists teacher_notification_push_job on public.teacher_notification_events;
create trigger teacher_notification_push_job after insert on public.teacher_notification_events for each row execute procedure public.queue_teacher_push_job();

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.push_notification_jobs to authenticated;
