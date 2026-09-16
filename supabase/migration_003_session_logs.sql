-- ============================================================================
-- نظام الفارس — Migration 003: سجل الحصة اليومي (الدرس والواجب لكل مجموعة)
-- ============================================================================
-- إضافي بس، شغّله في Supabase → SQL Editor → New query → Run
-- ============================================================================

create table if not exists session_logs (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  group_name text not null,
  session_date date not null default current_date,
  lesson_topic text,
  homework_text text,
  updated_at timestamptz not null default now(),
  unique (teacher_id, group_name, session_date)
);

alter table session_logs enable row level security;

create policy "session_logs_teacher_access" on session_logs
  for all using (auth.uid() = teacher_id and is_subscription_active())
  with check (auth.uid() = teacher_id and is_subscription_active());

create index if not exists idx_session_logs_teacher_group on session_logs(teacher_id, group_name);
create index if not exists idx_session_logs_date on session_logs(session_date);
