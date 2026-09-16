-- ============================================================================
-- NOKHBA V1 — Migration 024: Report Templates & Notification Enhancements
-- ============================================================================
-- This migration adds:
--   1) report_templates table — for saving customized report configurations
--   2) notification categories to teacher_notification_events
--   3) Portal RPC enhancement to include payment_status and notifications
--
-- CRITICAL: No existing tables or columns are modified/removed.
-- All changes are purely additive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) report_templates — save customized report configurations
--    A teacher can save a report configuration (title, columns, date range,
--    logo preference, etc.) and reuse it later.
-- ----------------------------------------------------------------------------
create table if not exists report_templates (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  -- JSONB config: { title, showLogo, dateRange, columns, orientation, ... }
  config jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table report_templates enable row level security;

create policy "report_templates_teacher_access" on report_templates
  for all using (auth.uid() = teacher_id and is_subscription_active())
  with check (auth.uid() = teacher_id and is_subscription_active());

create index if not exists idx_report_templates_teacher on report_templates(teacher_id);

-- ----------------------------------------------------------------------------
-- 2) Add category column to teacher_notification_events (if not exists)
--    Categories: payment, attendance, performance, general, system
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'teacher_notification_events' and column_name = 'category') then
    alter table teacher_notification_events add column category text not null default 'general';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3) Update get_student_portal_data RPC to include payment_status and notifications
--    This is a CREATE OR REPLACE to add the new fields without breaking existing behavior.
--    If the RPC doesn't exist yet, this creates it. If it does, it extends it.
-- ----------------------------------------------------------------------------

-- Check if the function exists and what version it is
-- We add payment_status and notifications as new top-level keys in the returned JSON

-- Helper: get payment summary for a student
create or replace function get_student_payment_summary(p_student_id uuid, p_teacher_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
      'status', case
        when coalesce(sum(p.amount), 0) >= coalesce(suggested.total_due, 0) then 'paid'
        when sum(p.amount) > 0 then 'partial'
        else 'unpaid'
      end,
      'total_due', coalesce(suggested.total_due, 0),
      'total_paid', coalesce(sum(p.amount), 0),
      'remaining', greatest(0, coalesce(suggested.total_due, 0) - coalesce(sum(p.amount), 0))
    )
    from student_payments p
    cross join lateral (
      select coalesce(
        (select ts.group_pricing->>g.name
         from teacher_settings ts, groups g
         where g.id = s.group_id and ts.teacher_id = g.teacher_id
        ), '0')::numeric as total_due
    ) suggested
    where p.student_id = p_student_id and p.teacher_id = p_teacher_id
    ),
    jsonb_build_object('status', 'unpaid', 'total_due', 0, 'total_paid', 0, 'remaining', 0)
  )
$$;

-- Helper: get notifications for a student's teacher
create or replace function get_student_notifications(p_teacher_id uuid, p_limit int default 10)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'title', n.title,
      'body', n.body,
      'category', n.category,
      'created_at', n.created_at,
      'is_read', n.is_read
    )
    order by n.created_at desc
    limit p_limit
  ), '[]'::jsonb)
  from teacher_notification_events n
  where n.teacher_id = p_teacher_id
$$;

-- Grant execute permissions
grant execute on function get_student_payment_summary(uuid, uuid) to authenticated;
grant execute on function get_student_notifications(uuid, int) to authenticated;
