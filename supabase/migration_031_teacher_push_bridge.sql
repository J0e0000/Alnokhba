-- Migration 031: bridge portal notifications to teacher browser push
-- Student notifications are already created for attendance/homework/payment events.
-- Forward only newly-created rows into the teacher event stream; the existing
-- teacher_notification_push_job trigger then creates push_notification_jobs.

create or replace function public.bridge_student_notification_to_teacher_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.teacher_notification_events (
    teacher_id,
    event_type,
    title,
    body,
    related_student_id,
    category
  ) values (
    new.teacher_id,
    case
      when new.category = 'payment' then 'payment_recorded'
      when new.category = 'attendance' then 'other'
      else 'student_insight'
    end,
    coalesce(new.title, 'تنبيه جديد'),
    coalesce(new.body, ''),
    new.student_id,
    coalesce(new.category, 'general')
  );
  return new;
end;
$$;

drop trigger if exists student_notification_teacher_push_bridge on public.student_notifications;
create trigger student_notification_teacher_push_bridge
after insert on public.student_notifications
for each row execute procedure public.bridge_student_notification_to_teacher_push();

revoke all on function public.bridge_student_notification_to_teacher_push() from public;
revoke all on function public.bridge_student_notification_to_teacher_push() from anon;
revoke all on function public.bridge_student_notification_to_teacher_push() from authenticated;
grant execute on function public.bridge_student_notification_to_teacher_push() to service_role;
