-- ============================================================================
-- نظام النخبة — Migration 006: الجدول الأسبوعي للمجموعات
-- ============================================================================
create table if not exists group_schedule (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  group_name text not null,
  weekday int not null check (weekday between 0 and 6), -- 0=الأحد ... 6=السبت
  unique (teacher_id, group_name, weekday)
);

alter table group_schedule enable row level security;

create policy "group_schedule_teacher_access" on group_schedule
  for all using (auth.uid() = teacher_id and is_subscription_active())
  with check (auth.uid() = teacher_id and is_subscription_active());

create index if not exists idx_group_schedule_teacher on group_schedule(teacher_id);
