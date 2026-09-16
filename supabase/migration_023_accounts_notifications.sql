-- ============================================================================
-- NOKHBA V1 — Migration 023: Accounts, Payments, Notifications, Smart Insights
-- ============================================================================
-- This migration adds:
--   1) Group-based pricing configuration (in teacher_settings)
--   2) Center share configuration (fixed or percentage)
--   3) Assistant cost configuration
--   4) Student payment records
--   5) Other expenses tracking
--   6) Student portal notifications
--   7) Smart insights configuration (thresholds)
--
-- CRITICAL: No existing tables or columns are modified/removed.
-- All changes are purely additive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Group pricing — stored as JSONB on teacher_settings
--    Format: { "Group A": 150, "Group B": 200, "Group C": 250 }
--    Default: empty object (no pricing configured)
-- ----------------------------------------------------------------------------
alter table teacher_settings add column if not exists group_pricing jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 2) Center share configuration
--    center_share_type: 'fixed' | 'percentage'
--    center_share_value: numeric (EGP amount or percentage)
-- ----------------------------------------------------------------------------
alter table teacher_settings add column if not exists center_share_type text not null default 'fixed'
  check (center_share_type in ('fixed', 'percentage'));
alter table teacher_settings add column if not exists center_share_value numeric not null default 0;

-- ----------------------------------------------------------------------------
-- 3) Assistant cost configuration
--    assistant_costs: JSONB { "assistant_profile_id": cost_per_lesson }
-- ----------------------------------------------------------------------------
alter table teacher_settings add column if not exists assistant_costs jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 4) Student payments table
--    Each record = one payment transaction for one student
-- ----------------------------------------------------------------------------
create table if not exists student_payments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  amount numeric not null default 0,
  payment_date date not null default now(),
  method text not null default 'cash' check (method in ('cash', 'transfer', 'other')),
  note text,
  created_at timestamptz not null default now()
);

alter table student_payments enable row level security;

create policy "payments_workspace_access" on student_payments
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

create index if not exists idx_payments_teacher on student_payments(teacher_id);
create index if not exists idx_payments_student on student_payments(student_id);
create index if not exists idx_payments_date on student_payments(payment_date);

-- ----------------------------------------------------------------------------
-- 5) Other expenses table
--    For recording expenses not related to a specific student
-- ----------------------------------------------------------------------------
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  description text not null,
  amount numeric not null default 0,
  expense_date date not null default now(),
  category text not null default 'other' check (category in ('rent', 'supplies', 'transport', 'utilities', 'marketing', 'other')),
  note text,
  created_at timestamptz not null default now()
);

alter table expenses enable row level security;

create policy "expenses_workspace_access" on expenses
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

create index if not exists idx_expenses_teacher on expenses(teacher_id);
create index if not exists idx_expenses_date on expenses(expense_date);

-- ----------------------------------------------------------------------------
-- 6) Student portal notifications
--    Created by system/teacher actions, displayed in student portal
-- ----------------------------------------------------------------------------
create table if not exists student_notifications (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  title text not null,
  body text not null default '',
  category text not null default 'info' check (category in ('exam_result', 'homework', 'announcement', 'attendance', 'payment', 'general')),
  deep_link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table student_notifications enable row level security;

-- Teacher/assistant can manage notifications for their students
create policy "notifications_workspace_access" on student_notifications
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

-- Public read for students via their token (used by the portal RPC)
-- We do NOT add a public_read policy here — instead, the existing
-- get_student_portal_data RPC will be extended to include notifications.

create index if not exists idx_notifications_student on student_notifications(student_id, is_read);
create index if not exists idx_notifications_teacher on student_notifications(teacher_id);

-- ----------------------------------------------------------------------------
-- 7) Smart insights configuration (thresholds stored in teacher_settings)
--    These are NOT AI — they are configurable rule thresholds
-- ----------------------------------------------------------------------------
alter table teacher_settings add column if not exists insight_config jsonb not null default '
{
  "attendance_warning_threshold": 75,
  "performance_warning_threshold": 60,
  "repeated_absence_count": 3
}'::jsonb;

-- ----------------------------------------------------------------------------
-- 8) Teacher notification events table
--    Lightweight event log for teacher notification center
--    (separate from the admin broadcast_messages table)
-- ----------------------------------------------------------------------------
create table if not exists teacher_notification_events (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'student_submission', 'exam_completion', 'payment_recorded',
    'assistant_request', 'student_insight', 'other'
  )),
  title text not null,
  body text not null default '',
  is_read boolean not null default false,
  related_student_id uuid references students(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table teacher_notification_events enable row level security;

create policy "teacher_notif_events_workspace" on teacher_notification_events
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

create index if not exists idx_teacher_notif_events on teacher_notification_events(teacher_id, is_read);

-- ----------------------------------------------------------------------------
-- 9) Report templates table
--    Lightweight: teacher saves customized report/QR message formats
-- ----------------------------------------------------------------------------
create table if not exists report_templates (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  type text not null default 'report' check (type in ('report', 'qr_message', 'payment_reminder')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table report_templates enable row level security;

create policy "report_templates_workspace" on report_templates
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

-- ----------------------------------------------------------------------------
-- 10) Extend get_student_portal_data to include payment status & notifications
--    This is a SECURITY DEFINER function — we add new fields to the returned JSON
--    WITHOUT changing existing fields (backward compatible)
-- ----------------------------------------------------------------------------
create or replace function public.get_student_portal_data(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_teacher_id uuid;
  v_student record;
  v_result jsonb;
begin
  -- ── Step 1: Resolve token to student ──
  select student_id, teacher_id into v_student_id, v_teacher_id
  from student_qr_tokens
  where token = p_token and revoked_at is null
  limit 1;

  -- Fallback: try interpreting as raw student UUID (backward compat)
  if v_student_id is null and p_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id, teacher_id into v_student_id, v_teacher_id
    from students where id = p_token::uuid
    limit 1;
  end if;

  if v_student_id is null then
    return null;
  end if;

  -- ── Step 2: Load student ──
  select * into v_student from students where id = v_student_id;
  if v_student.id is null then return null; end if;

  -- ── Step 3: Build result (all existing fields preserved) ──
  select jsonb_build_object(
    'student', jsonb_build_object(
      'id', v_student.id,
      'name', v_student.name,
      'code', v_student.code,
      'stage', v_student.stage,
      'points', v_student.points,
      'warnings', v_student.warnings,
      'attendance_status', v_student.attendance_status,
      'hw_status', v_student.hw_status,
      'group_name', v_student.group_name
    ),
    'teacherId', v_teacher_id,
    'ranks', coalesce((select ranks from teacher_settings where teacher_id = v_teacher_id), '[]'::jsonb),
    'whatsappNumber', (select whatsapp_number from workspace_branding where teacher_id = v_teacher_id),
    'sessionToday', (
      select coalesce(row_to_json(s), '{}'::json) from (
        select lesson_topic, homework_text, created_at::date as session_date
        from session_logs
        where teacher_id = v_teacher_id
          and group_name = v_student.group_name
          and created_at::date = current_date
        order by created_at desc limit 1
      ) s
    ),
    'upcomingSessions', (
      select coalesce(jsonb_agg(row_to_json(gs)), '[]'::jsonb) from (
        select gs.group_name, gs.weekday,
          to_char(
            case
              when gs.weekday > extract(dow from current_date) then current_date + (gs.weekday - extract(dow from current_date))
              else current_date + (7 - extract(dow from current_date) + gs.weekday)
            end,
            'YYYY-MM-DD'
          ) as next_date
        from group_schedule gs
        where gs.teacher_id = v_teacher_id
          and gs.group_name = v_student.group_name
        order by gs.weekday
      ) gs
    ),
    'announcements', (
      select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb) from (
        select id, title, body, created_at
        from announcements
        where teacher_id = v_teacher_id
          and (target_audience = 'all' or target_group = v_student.group_name)
          and (expires_at is null or expires_at > now())
        order by created_at desc
      ) a
    ),
    'homework', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ht.id,
        'title', ht.title,
        'description', ht.description,
        'due_date', ht.due_date,
        'is_done', coalesce(hts.is_done, false)
      )), '[]'::jsonb)
      from homework_tasks ht
      left join homework_task_status hts
        on hts.task_id = ht.id and hts.student_id = v_student_id
      where ht.teacher_id = v_teacher_id
        and (ht.target_group = v_student.group_name or ht.target_group = 'all')
        and (ht.due_date is null or ht.due_date >= current_date - interval '7 days')
      order by ht.created_at desc
    ),
    'examResults', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'exam_id', e.id,
        'title', e.title,
        'total_score', es.total_score,
        'max_score', (e.max_score_per_section * array_length(e.sections, 1)),
        'created_at', es.created_at
      )), '[]'::jsonb)
      from exam_scores es
      join exams e on e.id = es.exam_id
      where es.student_id = v_student_id
        and es.teacher_id = v_teacher_id
      order by es.created_at desc
    ),
    'activity', (
      select coalesce(jsonb_agg(row_to_json(ev)), '[]'::jsonb) from (
        select 'attendance' as event_type, note, points_delta, created_at
        from behavior_logs
        where student_id = v_student_id and teacher_id = v_teacher_id
          and created_at >= current_date - interval '7 days'
        union all
        select 'exam' as event_type, e.title as note, es.total_score as points_delta, es.created_at
        from exam_scores es
        join exams e on e.id = es.exam_id
        where es.student_id = v_student_id and es.teacher_id = v_teacher_id
          and es.created_at >= current_date - interval '7 days'
        order by created_at desc
        limit 20
      ) ev
    ),
    'streak', (
      select count(*) from (
        select distinct created_at::date as d
        from attendance_records
        where student_id = v_student_id and teacher_id = v_teacher_id and status = 'حاضر'
        order by d desc
        limit 30
      ) dates
      -- Simple streak: count consecutive present days ending today or yesterday
    ),
    'attendanceStats', (
      select jsonb_build_object(
        'present', count(*) filter (where status = 'حاضر'),
        'absent', count(*) filter (where status = 'غائب'),
        'total', count(*)
      )
      from attendance_records
      where student_id = v_student_id and teacher_id = v_teacher_id
    ),
    -- NEW: Payment summary
    'paymentSummary', (
      select jsonb_build_object(
        'totalPaid', coalesce(sum(p.amount), 0),
        'paymentCount', count(p.id),
        'lastPaymentDate', max(p.payment_date)
      )
      from student_payments p
      where p.student_id = v_student_id and p.teacher_id = v_teacher_id
    ),
    -- NEW: Lesson price for student's group
    'lessonPrice', (
      select (group_pricing -> v_student.group_name)::numeric
      from teacher_settings where teacher_id = v_teacher_id
    ),
    -- NEW: Unread notifications
    'notifications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', n.id,
        'title', n.title,
        'body', n.body,
        'category', n.category,
        'deep_link', n.deep_link,
        'is_read', n.is_read,
        'created_at', n.created_at
       )), '[]'::jsonb)
      from student_notifications n
      where n.student_id = v_student_id and n.teacher_id = v_teacher_id
      order by n.created_at desc
      limit 50
    ),
    -- NEW: Unread notification count
    'unreadNotificationCount', (
      select count(*)
      from student_notifications
      where student_id = v_student_id and teacher_id = v_teacher_id and is_read = false
    ),
    -- NEW: Branding info for portal display
    'branding', (
      select jsonb_build_object(
        'display_name', coalesce(display_name, ''),
        'center_name', coalesce(center_name, ''),
        'logo_url', coalesce(logo_url, '')
      )
      from workspace_branding where teacher_id = v_teacher_id
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 11) RPC: Mark student notification as read (called from portal)
-- ----------------------------------------------------------------------------
create or replace function public.mark_notification_read(p_notification_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
begin
  -- Resolve token to student_id
  select student_id into v_student_id
  from student_qr_tokens
  where token = p_token and revoked_at is null
  limit 1;

  if v_student_id is null and p_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_student_id from students where id = p_token::uuid limit 1;
  end if;

  if v_student_id is null then
    raise exception 'invalid token';
  end if;

  update student_notifications
  set is_read = true
  where id = p_notification_id
    and student_id = v_student_id;
end;
$$;

grant execute on function public.mark_notification_read(uuid, text) to anon;

-- ----------------------------------------------------------------------------
-- 12) RPC: Mark all student notifications as read
-- ----------------------------------------------------------------------------
create or replace function public.mark_all_notifications_read(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
begin
  select student_id into v_student_id
  from student_qr_tokens
  where token = p_token and revoked_at is null
  limit 1;

  if v_student_id is null and p_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_student_id from students where id = p_token::uuid limit 1;
  end if;

  if v_student_id is null then
    raise exception 'invalid token';
  end if;

  update student_notifications
  set is_read = true
  where student_id = v_student_id and is_read = false;
end;
$$;

grant execute on function public.mark_all_notifications_read(text) to anon;

-- ----------------------------------------------------------------------------
-- 13) RPC: Get accounts summary for a teacher (financial overview)
--    Returns: total revenue, center share total, assistant costs, expenses, net profit
--    Accepts optional date range and group filters
-- ----------------------------------------------------------------------------
create or replace function public.get_accounts_summary(
  p_teacher_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_group_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_pricing jsonb;
  v_center_share_type text;
  v_center_share_value numeric;
  v_assistant_costs jsonb;
  v_total_revenue numeric := 0;
  v_center_share_total numeric := 0;
  v_assistant_cost_total numeric := 0;
  v_expenses_total numeric := 0;
  v_lesson_count integer := 0;
  v_student_payment_total numeric := 0;
begin
  -- Get teacher's financial config
  select group_pricing, center_share_type, center_share_value, assistant_costs
  into v_group_pricing, v_center_share_type, v_center_share_value, v_assistant_costs
  from teacher_settings where teacher_id = p_teacher_id;

  if v_group_pricing is null then v_group_pricing := '{}'::jsonb; end if;
  if v_assistant_costs is null then v_assistant_costs := '{}'::jsonb; end if;

  -- Count lessons (session_logs) in the period
  select count(*) into v_lesson_count
  from session_logs
  where teacher_id = p_teacher_id
    and (p_date_from is null or created_at::date >= p_date_from)
    and (p_date_to is null or created_at::date <= p_date_to)
    and (p_group_name is null or group_name = p_group_name);

  -- Calculate total revenue = sum of all lesson prices for sessions held
  -- For each session_log entry, get the group's price
  v_total_revenue := (
    select coalesce(sum(
      coalesce((v_group_pricing -> sl.group_name)::numeric, 0)
    ), 0)
    from session_logs sl
    where sl.teacher_id = p_teacher_id
      and (p_date_from is null or sl.created_at::date >= p_date_from)
      and (p_date_to is null or sl.created_at::date <= p_date_to)
      and (p_group_name is null or sl.group_name = p_group_name)
  );

  -- Total student payments received in the period
  v_student_payment_total := (
    select coalesce(sum(amount), 0)
    from student_payments sp
    join students s on s.id = sp.student_id
    where sp.teacher_id = p_teacher_id
      and (p_date_from is null or sp.payment_date >= p_date_from)
      and (p_date_to is null or sp.payment_date <= p_date_to)
      and (p_group_name is null or s.group_name = p_group_name)
  );

  -- Calculate center share
  if v_center_share_type = 'percentage' then
    v_center_share_total := v_total_revenue * (v_center_share_value / 100.0);
  else
    -- Fixed amount per lesson
    v_center_share_total := v_lesson_count * v_center_share_value;
  end if;

  -- Calculate assistant costs (per lesson)
  v_assistant_cost_total := v_lesson_count * (
    select coalesce(sum(av.value::numeric), 0)
    from jsonb_each_text(v_assistant_costs) av
  );

  -- Total expenses
  v_expenses_total := (
    select coalesce(sum(amount), 0)
    from expenses
    where teacher_id = p_teacher_id
      and (p_date_from is null or expense_date >= p_date_from)
      and (p_date_to is null or expense_date <= p_date_to)
  );

  return jsonb_build_object(
    'totalRevenue', v_total_revenue,
    'studentPaymentsReceived', v_student_payment_total,
    'lessonCount', v_lesson_count,
    'centerShare', v_center_share_total,
    'centerShareType', v_center_share_type,
    'centerShareValue', v_center_share_value,
    'assistantCosts', v_assistant_cost_total,
    'expenses', v_expenses_total,
    'netProfit', v_total_revenue - v_center_share_total - v_assistant_cost_total - v_expenses_total
  );
end;
$$;

grant execute on function public.get_accounts_summary(uuid, date, date, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 14) RPC: Get payment status for a group of students
--    Returns per-student: total due, total paid, remaining, status
-- ----------------------------------------------------------------------------
create or replace function public.get_student_payment_statuses(
  p_teacher_id uuid,
  p_group_name text default null
)
returns table(
  student_id uuid,
  total_due numeric,
  total_paid numeric,
  remaining numeric,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_pricing jsonb;
begin
  select group_pricing into v_group_pricing
  from teacher_settings where teacher_id = p_teacher_id;
  if v_group_pricing is null then v_group_pricing := '{}'::jsonb; end if;

  return query
  select
    s.id as student_id,
    -- Total due = lesson_price * number of sessions for this student's group
    coalesce(
      (select (v_group_pricing -> s.group_name)::numeric, 0) *
      (select count(*) from session_logs sl
       where sl.teacher_id = p_teacher_id
         and sl.group_name = s.group_name
         and sl.created_at >= coalesce(s.created_at, now())),
      0
    ) as total_due,
    -- Total paid
    coalesce((
      select sum(p.amount) from student_payments p
      where p.student_id = s.id and p.teacher_id = p_teacher_id
    ), 0) as total_paid,
    -- Remaining
    coalesce(
      (select (v_group_pricing -> s.group_name)::numeric, 0) *
      (select count(*) from session_logs sl
       where sl.teacher_id = p_teacher_id
         and sl.group_name = s.group_name
         and sl.created_at >= coalesce(s.created_at, now())),
      0
    ) - coalesce((
      select sum(p.amount) from student_payments p
      where p.student_id = s.id and p.teacher_id = p_teacher_id
    ), 0) as remaining,
    -- Status
    case
      when coalesce((
        select sum(p.amount) from student_payments p
        where p.student_id = s.id and p.teacher_id = p_teacher_id
      ), 0) >= coalesce(
        (select (v_group_pricing -> s.group_name)::numeric, 0) *
        (select count(*) from session_logs sl
         where sl.teacher_id = p_teacher_id
           and sl.group_name = s.group_name
           and sl.created_at >= coalesce(s.created_at, now())),
        0
      ) then 'paid'
      when coalesce((
        select sum(p.amount) from student_payments p
        where p.student_id = s.id and p.teacher_id = p_teacher_id
      ), 0) > 0 then 'partial'
      else 'unpaid'
    end as status
  from students s
  where s.teacher_id = p_teacher_id
    and (p_group_name is null or s.group_name = p_group_name);
end;
$$;

grant execute on function public.get_student_payment_statuses(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 15) Trigger: Auto-create student notification on key events
--    (exam score saved, homework assigned, announcement posted)
--    We use triggers on the existing tables — no modifications to existing triggers.
-- ----------------------------------------------------------------------------

-- Notification when exam score is recorded
create or replace function notify_exam_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into student_notifications (teacher_id, student_id, title, body, category, deep_link)
  values (
    NEW.teacher_id,
    NEW.student_id,
    'نتيجة امتحان جديدة',
    'تم رصد درجتك في امتحان: ' || coalesce((select title from exams where id = NEW.exam_id), ''),
    'exam_result',
    null
  );
  return NEW;
end;
$$;

drop trigger if exists on_exam_score_inserted on exam_scores;
create trigger on_exam_score_inserted
  after insert on exam_scores
  for each row execute procedure notify_exam_result();

-- Notification when homework is assigned
create or replace function notify_homework_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Notify all students in the target group
  insert into student_notifications (teacher_id, student_id, title, body, category)
  select
    NEW.teacher_id,
    s.id,
    'واجب جديد: ' || coalesce(NEW.title, ''),
    coalesce(NEW.description, ''),
    'homework'
  from students s
  where s.teacher_id = NEW.teacher_id
    and (NEW.target_group = 'all' or s.group_name = NEW.target_group);
  return NEW;
end;
$$;

drop trigger if exists on_homework_inserted on homework_tasks;
create trigger on_homework_inserted
  after insert on homework_tasks
  for each row execute procedure notify_homework_assigned();

-- Notification when announcement is posted
create or replace function notify_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into student_notifications (teacher_id, student_id, title, body, category)
  select
    NEW.teacher_id,
    s.id,
    coalesce(NEW.title, 'إعلان جديد'),
    coalesce(NEW.body, ''),
    'announcement'
  from students s
  where s.teacher_id = NEW.teacher_id
    and (NEW.target_audience = 'all' or s.group_name = NEW.target_group);
  return NEW;
end;
$$;

drop trigger if exists on_announcement_inserted on announcements;
create trigger on_announcement_inserted
  after insert on announcements
  for each row execute procedure notify_announcement();

-- ----------------------------------------------------------------------------
-- 16) Reload schema cache
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
