-- Migration 034: make Lessons group metadata and time persistence explicit
-- Safe: adds nullable/defaulted columns only; existing students and history remain untouched.
alter table public.teacher_settings
  add column if not exists group_meta jsonb not null default '{}'::jsonb;

alter table public.group_schedule
  add column if not exists lesson_time time;

comment on column public.teacher_settings.group_meta is 'Per-group lesson metadata: stage, weekday, and display time';
comment on column public.group_schedule.lesson_time is 'Optional lesson start time for the scheduled group';
