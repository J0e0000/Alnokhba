-- Migration 035: backfill legacy session_logs into lesson_sessions
-- Keeps existing saved lessons visible in the new workflow and links legacy
-- attendance rows to the matching teacher/group/date where it is unambiguous.

insert into public.lesson_sessions (
  teacher_id, group_name, session_date, status, lesson_topic, homework_text,
  video_link, started_at, ended_at, created_at, updated_at
)
select
  sl.teacher_id,
  sl.group_name,
  sl.session_date,
  'completed',
  coalesce(sl.lesson_topic, ''),
  coalesce(sl.homework_text, ''),
  coalesce(sl.video_link, ''),
  coalesce(sl.updated_at, sl.session_date::timestamptz),
  coalesce(sl.updated_at, sl.session_date::timestamptz),
  coalesce(sl.updated_at, sl.session_date::timestamptz),
  coalesce(sl.updated_at, sl.session_date::timestamptz)
from public.session_logs sl
where not exists (
  select 1
  from public.lesson_sessions ls
  where ls.teacher_id = sl.teacher_id
    and ls.group_name = sl.group_name
    and ls.session_date = sl.session_date
);

update public.attendance_records ar
set lesson_session_id = ls.id
from public.students s, public.lesson_sessions ls
where ar.student_id = s.id
  and ar.lesson_session_id is null
  and ls.teacher_id = ar.teacher_id
  and ls.group_name = s.group_name
  and ls.session_date = (ar.recorded_at at time zone 'UTC')::date;
