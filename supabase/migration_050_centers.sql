-- ============================================================================
-- Migration 050 — EL NO5BA CENTERS: multi-tenant schema + RLS isolation
-- ============================================================================
-- التشغيل: Supabase Dashboard → SQL Editor → الصق الملف كامل → Run
-- الملف idempotent: آمن لإعادة التشغيل، لا يحذف أي بيانات.
--
-- EL NO5BA CENTERS = منتج مستقل داخل نفس المنصة:
--   إدارة مراكز الدروس (قاعات + مجموعات + حصص يومية + حضور).
-- عزل المستأجرين (TENANT = CENTER):
--   • كل جدول يحمل center_id وسياسات RLS تمنع أي وصول خارج المركز.
--   • membership عبر center_members (owner / manager / staff).
--   • أدمن المنصة (profiles.is_admin) يرى الكل لأغراض الدعم فقط.
--   • لا يوجد أي RPC عام يرجع بيانات بدون center_id + فحص عضوية.
-- التدقيق: center_audit_logs — سجل للإضافة فقط (triggers تلتقط الحذف
--   والحساسية) + عمليات النسخ الاحتياطي تُسجَّل في admin_audit_logs.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) helpers
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.is_center_member(p_center_id uuid, p_user_id uuid default null)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.center_members m
    where m.center_id = p_center_id
      and m.user_id = coalesce(p_user_id, auth.uid())
  )
    or exists (
      select 1 from public.profiles p
      where p.id = coalesce(p_user_id, auth.uid())
        and coalesce(p.is_admin, false)
    )
$$;

create or replace function public.center_member_role(p_center_id uuid, p_user_id uuid default null)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select m.role from public.center_members m
  where m.center_id = p_center_id
    and m.user_id = coalesce(p_user_id, auth.uid())
  limit 1
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) الجداول
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.centers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.center_members (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  unique (center_id, user_id)
);

create table if not exists public.center_rooms (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  name text not null,
  capacity integer not null default 20,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.center_teachers (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  name text not null,
  phone text,
  subject text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.center_students (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  name text not null,
  phone text,
  parent_phone text,
  stage text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.center_groups (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  name text not null,
  subject text,
  grade text,
  teacher_id uuid references public.center_teachers(id) on delete set null,
  room_id uuid references public.center_rooms(id) on delete set null,
  capacity integer not null default 20,
  color text,
  schedule jsonb not null default '[]'::jsonb,  -- [{weekday:0..6, start:'17:30', end:'19:00'}]
  created_at timestamptz not null default now()
);

create table if not exists public.center_group_students (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  group_id uuid not null references public.center_groups(id) on delete cascade,
  student_id uuid not null references public.center_students(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, student_id)
);

create table if not exists public.center_sessions (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  group_id uuid not null references public.center_groups(id) on delete cascade,
  room_id uuid references public.center_rooms(id) on delete set null,
  teacher_id uuid references public.center_teachers(id) on delete set null,
  session_date date not null,
  starts_at text not null default '17:00',
  ends_at text not null default '18:30',
  status text not null default 'upcoming' check (status in ('upcoming','live','completed','cancelled')),
  topic text,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.center_attendance (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  session_id uuid not null references public.center_sessions(id) on delete cascade,
  student_id uuid not null references public.center_students(id) on delete cascade,
  status text not null default 'present' check (status in ('present','absent','late','excused')),
  note text,
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

-- سجل تدقيق المراكز — للإضافة فقط
create table if not exists public.center_audit_logs (
  id bigint generated always as identity primary key,
  center_id uuid references public.centers(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) الفهارس
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists idx_center_members_user on public.center_members (user_id);
create index if not exists idx_center_rooms_center on public.center_rooms (center_id);
create index if not exists idx_center_teachers_center on public.center_teachers (center_id);
create index if not exists idx_center_students_center on public.center_students (center_id, created_at desc);
create index if not exists idx_center_groups_center on public.center_groups (center_id);
create index if not exists idx_center_group_students_group on public.center_group_students (group_id);
create index if not exists idx_center_group_students_student on public.center_group_students (student_id);
create index if not exists idx_center_sessions_center_date on public.center_sessions (center_id, session_date desc);
create index if not exists idx_center_sessions_group on public.center_sessions (group_id, session_date desc);
create index if not exists idx_center_attendance_session on public.center_attendance (session_id);
create index if not exists idx_center_attendance_student on public.center_attendance (student_id, updated_at desc);
create index if not exists idx_center_audit_center on public.center_audit_logs (center_id, created_at desc);

-- updated_at تلقائي
create or replace function public.center_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_center_sessions_touch on public.center_sessions;
create trigger trg_center_sessions_touch before update on public.center_sessions
  for each row execute function public.center_touch_updated_at();

drop trigger if exists trg_center_attendance_touch on public.center_attendance;
create trigger trg_center_attendance_touch before update on public.center_attendance
  for each row execute function public.center_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) التدقيق (triggers على العمليات الحساسة)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.center_audit_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center uuid;
  v_type text;
  v_target text;
begin
  v_center := coalesce(new.center_id, old.center_id);
  v_type := tg_table_name;
  v_target := coalesce(new.name, old.name, new.id::text, old.id::text);
  insert into public.center_audit_logs (center_id, actor_id, action, target_type, target_id, details)
  values (
    v_center,
    auth.uid(),
    lower(tg_op) || '_' || v_type,
    v_type,
    coalesce(new.id::text, old.id::text),
    v_type || ': ' || v_target
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['center_students','center_groups','center_rooms','center_teachers','center_sessions','center_members']
  loop
    execute format('drop trigger if exists trg_center_audit_%s on public.%I', t, t);
    execute format(
      'create trigger trg_center_audit_%s after insert or delete on public.%I
       for each row execute function public.center_audit_write()', t, t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) RLS — عزل المستأجرين (أهم قسم في الملف)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.centers enable row level security;
alter table public.center_members enable row level security;
alter table public.center_rooms enable row level security;
alter table public.center_teachers enable row level security;
alter table public.center_students enable row level security;
alter table public.center_groups enable row level security;
alter table public.center_group_students enable row level security;
alter table public.center_sessions enable row level security;
alter table public.center_attendance enable row level security;
alter table public.center_audit_logs enable row level security;

-- ---- centers ----
drop policy if exists "centers_member_read" on public.centers;
create policy "centers_member_read" on public.centers
  for select using (public.is_center_member(id));

drop policy if exists "centers_owner_insert" on public.centers;
create policy "centers_owner_insert" on public.centers
  for insert with check (owner_id = auth.uid());

drop policy if exists "centers_owner_update" on public.centers;
create policy "centers_owner_update" on public.centers
  for update using (owner_id = auth.uid() or public.center_member_role(id) in ('owner','manager'))
  with check (owner_id = auth.uid() or public.center_member_role(id) in ('owner','manager'));

-- ---- center_members ----
drop policy if exists "center_members_read" on public.center_members;
create policy "center_members_read" on public.center_members
  for select using (public.is_center_member(center_id));

drop policy if exists "center_members_manage" on public.center_members;
create policy "center_members_manage" on public.center_members
  for insert with check (
    exists (select 1 from public.centers c where c.id = center_id and c.owner_id = auth.uid())
    or public.center_member_role(center_id) = 'owner'
  );

drop policy if exists "center_members_manage_update" on public.center_members;
create policy "center_members_manage_update" on public.center_members
  for update using (
    exists (select 1 from public.centers c where c.id = center_id and c.owner_id = auth.uid())
    or public.center_member_role(center_id) = 'owner'
  );

drop policy if exists "center_members_manage_delete" on public.center_members;
create policy "center_members_manage_delete" on public.center_members
  for delete using (
    exists (select 1 from public.centers c where c.id = center_id and c.owner_id = auth.uid())
    or public.center_member_role(center_id) = 'owner'
  );

-- ---- جداول البيانات العامة للمركز (rooms/teachers/students/groups/enrollment) ----
-- قراءة: أعضاء المركز. كتابة: أعضاء (المدير/المالك يحذفون).
do $$
declare t text;
begin
  foreach t in array array['center_rooms','center_teachers','center_students','center_groups','center_group_students']
  loop
    execute format('drop policy if exists "%s_member_read" on public.%I', t, t);
    execute format($f$
      create policy "%s_member_read" on public.%I
        for select using (public.is_center_member(center_id))
    $f$, t, t);

    execute format('drop policy if exists "%s_member_insert" on public.%I', t, t);
    execute format($f$
      create policy "%s_member_insert" on public.%I
        for insert with check (public.is_center_member(center_id))
    $f$, t, t);

    execute format('drop policy if exists "%s_member_update" on public.%I', t, t);
    execute format($f$
      create policy "%s_member_update" on public.%I
        for update using (public.is_center_member(center_id))
        with check (public.is_center_member(center_id))
    $f$, t, t);

    execute format('drop policy if exists "%s_lead_delete" on public.%I', t, t);
    execute format($f$
      create policy "%s_lead_delete" on public.%I
        for delete using (public.center_member_role(center_id) in ('owner','manager'))
    $f$, t, t);
  end loop;
end $$;

-- ---- center_sessions ----
drop policy if exists "center_sessions_member_read" on public.center_sessions;
create policy "center_sessions_member_read" on public.center_sessions
  for select using (public.is_center_member(center_id));

drop policy if exists "center_sessions_member_insert" on public.center_sessions;
create policy "center_sessions_member_insert" on public.center_sessions
  for insert with check (public.is_center_member(center_id));

drop policy if exists "center_sessions_member_update" on public.center_sessions;
create policy "center_sessions_member_update" on public.center_sessions
  for update using (public.is_center_member(center_id))
  with check (public.is_center_member(center_id));

drop policy if exists "center_sessions_lead_delete" on public.center_sessions;
create policy "center_sessions_lead_delete" on public.center_sessions
  for delete using (public.center_member_role(center_id) in ('owner','manager'));

-- ---- center_attendance ----
drop policy if exists "center_attendance_member_read" on public.center_attendance;
create policy "center_attendance_member_read" on public.center_attendance
  for select using (public.is_center_member(center_id));

drop policy if exists "center_attendance_member_write" on public.center_attendance;
create policy "center_attendance_member_write" on public.center_attendance
  for insert with check (public.is_center_member(center_id));

drop policy if exists "center_attendance_member_update" on public.center_attendance;
create policy "center_attendance_member_update" on public.center_attendance
  for update using (public.is_center_member(center_id))
  with check (public.is_center_member(center_id));

drop policy if exists "center_attendance_lead_delete" on public.center_attendance;
create policy "center_attendance_lead_delete" on public.center_attendance
  for delete using (public.center_member_role(center_id) in ('owner','manager'));

-- ---- center_audit_logs (للإضافة فقط عبر triggers الـ security definer) ----
drop policy if exists "center_audit_member_read" on public.center_audit_logs;
create policy "center_audit_member_read" on public.center_audit_logs
  for select using (public.is_center_member(center_id));
-- لا سياسات insert/update/delete للمستخدمين — الكتابة تتم عبر triggers فقط.

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) إنشاء مركز جديد (RPC — يتطلب مستخدمًا مسجّلًا ويجعله owner)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_center(p_name text, p_phone text default null, p_address text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid;
begin
  if auth.uid() is null then
    raise exception 'create_center: authentication required';
  end if;
  if p_name is null or length(btrim(p_name)) < 2 then
    raise exception 'create_center: name too short';
  end if;

  insert into public.centers (owner_id, name, phone, address)
  values (auth.uid(), btrim(p_name), p_phone, p_address)
  returning id into v_center_id;

  insert into public.center_members (center_id, user_id, role)
  values (v_center_id, auth.uid(), 'owner');

  insert into public.center_audit_logs (center_id, actor_id, action, details)
  values (v_center_id, auth.uid(), 'create_center', 'إنشاء مركز: ' || btrim(p_name));

  return v_center_id;
end;
$$;

grant execute on function public.create_center to authenticated;

do $$
begin
  raise notice 'Migration 050 applied: Centers schema + tenant RLS + audit triggers';
end $$;
