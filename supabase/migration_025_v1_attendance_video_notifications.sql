-- NOKHBA V1 additive enhancement migration
-- Safe to run after migrations 023/024. Does not change existing QR URLs or tables' existing behavior.

alter table public.session_logs add column if not exists video_link text;
alter table public.teacher_settings add column if not exists absence_warning_threshold integer not null default 2;
alter table public.teacher_settings add column if not exists absence_attention_threshold integer not null default 3;
alter table public.teacher_settings add column if not exists notification_preferences jsonb not null default '{"attendance":true,"homework":true,"exams":true,"lessons":true,"payments":true,"announcements":true}'::jsonb;

create index if not exists idx_attendance_teacher_student_date
  on public.attendance_records(teacher_id, student_id, recorded_at);

-- The teacher explicitly starts this action after the attendance window/session ends.
-- It is idempotent: an existing attendance record for that date is never duplicated.
create or replace function public.mark_group_absences(
  p_teacher_id uuid,
  p_group_name text,
  p_session_date date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student record;
  v_marked integer := 0;
begin
  if auth.uid() is null or not can_access_workspace(p_teacher_id) then
    raise exception 'not authorized';
  end if;

  for v_student in
    select s.id, s.name
    from public.students s
    where s.teacher_id = p_teacher_id
      and s.group_name = p_group_name
  loop
    if not exists (
      select 1 from public.attendance_records ar
      where ar.teacher_id = p_teacher_id
        and ar.student_id = v_student.id
        and ar.recorded_at::date = p_session_date
    ) then
      insert into public.attendance_records(teacher_id, student_id, status, recorded_at)
      values (p_teacher_id, v_student.id, 'غائب', p_session_date::timestamptz);
      update public.students
      set attendance_status = 'غائب', updated_at = now()
      where id = v_student.id and teacher_id = p_teacher_id;
      v_marked := v_marked + 1;
    end if;
  end loop;

  return jsonb_build_object('marked_absent', v_marked, 'group_name', p_group_name, 'session_date', p_session_date);
end;
$$;

grant execute on function public.mark_group_absences(uuid, text, date) to authenticated;

-- One notification per newly inserted attendance record. The message differs for
-- present and absent students and includes the existing lesson video when present.
create or replace function public.notify_attendance_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student record;
  v_session record;
  v_title text;
  v_body text;
  v_preferences jsonb;
begin
  select s.name, s.group_name into v_student
  from public.students s
  where s.id = new.student_id and s.teacher_id = new.teacher_id;

  select ts.notification_preferences into v_preferences
  from public.teacher_settings ts
  where ts.teacher_id = new.teacher_id;

  if coalesce((v_preferences->>'attendance')::boolean, true) = false then
    return new;
  end if;

  select sl.lesson_topic, sl.homework_text, sl.video_link into v_session
  from public.session_logs sl
  where sl.teacher_id = new.teacher_id
    and sl.group_name = v_student.group_name
    and sl.session_date = new.recorded_at::date
  limit 1;

  if new.status = 'غائب' then
    v_title := 'غياب الطالب: ' || coalesce(v_student.name, 'الطالب');
    v_body := 'لم يحضر الطالب حصة اليوم.';
    if coalesce(v_session.video_link, '') <> '' then
      v_body := v_body || ' يمكنك مشاهدة شرح الحصة من خلال رابط الفيديو.';
    end if;
  else
    v_title := 'تسجيل حضور: ' || coalesce(v_student.name, 'الطالب');
    v_body := 'تم تسجيل حضور الطالب في الحصة.';
  end if;

  insert into public.student_notifications(teacher_id, student_id, title, body, category, deep_link)
  values (
    new.teacher_id,
    new.student_id,
    v_title,
    v_body || case when coalesce(v_session.homework_text, '') <> '' then ' الواجب: ' || v_session.homework_text else '' end,
    'attendance',
    '/qr/' || new.student_id::text
  );
  return new;
exception when others then
  -- Attendance must never fail merely because an optional notification is unavailable.
  return new;
end;
$$;

drop trigger if exists on_attendance_recorded_notify on public.attendance_records;
create trigger on_attendance_recorded_notify
after insert on public.attendance_records
for each row execute procedure public.notify_attendance_record();
