-- ═══════════════════════════════════════════════════════════════════════════
--  النخبة (Alnokhba) — حزمة التشغيل الشاملة: MIGRATIONS 049 + 050 + 051 + 052
--  ONE-PASTE BUNDLE — الصق الملف كامل في SQL Editor وشغّله مرة واحدة
-- ═══════════════════════════════════════════════════════════════════════════
--  • آمن 100%: لا يحذف أي بيانات ولا يغيّر أي جدول قائم إلا بالإضافة.
--  • idempotent: لو شغّلته أكتر من مرة أو كان جزء منه متطبق — يكمل عادي.
--  • الترتيب مهم: 049 ثم 050 ثم 051 ثم 052 (محفوظ تلقائيًا تحت).
--
--  ماذا يضيف هذا الملف؟
--   1) (049) سجل تدقيق للأدمن + حدود معدل للدوال السحابية + 9 فهارس أداء
--   2) (050) منتج EL NO5BA CENTERS كامل (إدارة مراكز — معزول بالمستأجر)
--   3) (051) الامتحانات المنفصلة: زر «إنشاء امتحان منفصل» يشتغل ببيانات حقيقية
--   4) (052) نتائج الامتحانات المنفصلة تظهر في بوابة الطالب/ولي الأمر
--
--  بعد التشغيل: افتح التطبيق وجرّب «إنشاء امتحان منفصل» — كل حاجة هتشتغل.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  MIGRATION 049 — سجل التدقيق + حدود المعدل + فهارس الأداء (audit trail + rate limits + perf indexes)
-- ═══════════════════════════════════════════════════════════════════════

-- ============================================================================
-- Migration 049 — ECOSYSTEM HARDENING: audit completion + rate limits + indexes
-- ============================================================================
-- التشغيل: Supabase Dashboard → SQL Editor → الصق الملف كامل → Run
-- الملف idempotent: آمن لإعادة التشغيل، لا يحذف ولا يغيّر أي بيانات قائمة.
--
-- المحتويات:
--   1) admin_log_audit() — RPC موحّد لكتابة سجلات التدقيق من Edge Functions
--      (service-role) ومن الأدمن نفسه. يكتب في admin_audit_logs الموجود
--      (migration 036 — جدول للإضافة فقط، لا يوجد update/delete إطلاقًا).
--   2) consume_rate_limit() — محدّد معدل ذرّي (sliding window) للـ Edge
--      Functions الحساسة (backup/restore/account actions). يمنع إساءة
--      الاستخدام حتى بجلسة أدمن مسروقة.
--   3) فهارس الأداء على الجداول الساخنة (exam_scores / attendance_records /
--      lesson_sessions / students / group_schedule / teacher_settings) —
--      كلها "if not exists" فلا تكرار ولا ضرر.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) RPC كتابة التدقيق الموحّد
-- ═══════════════════════════════════════════════════════════════════════════
-- القواعد:
--   • auth.uid() null  → سياق service-role (Edge Function) — مسموح فقط لو
--     مرّر actor_id صريح (الـ Edge Function تتحقق من الأدمن قبل الاستدعاء).
--   • auth.uid() موجود → يجب أن يكون أدمنًا، ويُسجَّل باسمه هو (لا انتحال).
create or replace function public.admin_log_audit(
  p_action text,
  p_target_user_id uuid default null,
  p_reason text default null,
  p_details text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_id uuid default null,
  p_actor_email text default null,
  p_success boolean default true,
  p_support_session_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_id bigint;
begin
  v_uid := auth.uid();

  if v_uid is null then
    -- service-role context: يتطلب معرّف فاعل صريح (نمنع سجلات مجهولة المصدر)
    if p_actor_id is null then
      raise exception 'admin_log_audit: service-role calls must pass p_actor_id';
    end if;
    v_uid := p_actor_id;
  else
    -- سياق مستخدم مسجّل: أدمن فقط، والفاعل = هو نفسه دائمًا
    select coalesce(is_admin, false) into v_is_admin
    from public.profiles where id = v_uid;
    if not v_is_admin then
      raise exception 'admin_log_audit: admin access required';
    end if;
  end if;

  insert into admin_audit_logs
    (admin_user_id, target_user_id, action, reason, details, metadata, support_session_id)
  values
    (v_uid, p_target_user_id,
     case when p_success then p_action else p_action || '_failed' end,
     p_reason, p_details, p_metadata, p_support_session_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_log_audit from public, anon;
grant execute on function public.admin_log_audit to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) محدّد المعدل الذرّي (للـ Edge Functions)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.edge_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

revoke all on public.edge_rate_limits from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count integer;
begin
  if p_max is null or p_max < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'consume_rate_limit: invalid arguments';
  end if;

  insert into edge_rate_limits (key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set window_start = case
          when edge_rate_limits.window_start + make_interval(secs => p_window_seconds) < v_now
          then v_now
          else edge_rate_limits.window_start
        end,
        count = case
          when edge_rate_limits.window_start + make_interval(secs => p_window_seconds) < v_now
          then 1
          else edge_rate_limits.count + 1
        end
  returning count into v_count;

  -- تنظيف عابر: نوافذ قديمة لمفاتيح أخرى (احتمال ضئيل، تكلفة زهيدة)
  delete from edge_rate_limits
   where key <> p_key
     and window_start + make_interval(secs => greatest(p_window_seconds * 4, 3600)) < v_now;

  return v_count <= p_max;
end;
$$;

revoke all on function public.consume_rate_limit from public, anon, authenticated;
grant execute on function public.consume_rate_limit to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) فهارس الأداء (الجداول الساخنة — كلها if not exists)
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists idx_exam_scores_student_date
  on public.exam_scores (student_id, created_at desc);
create index if not exists idx_exam_scores_exam
  on public.exam_scores (exam_id);
create index if not exists idx_attendance_records_session
  on public.attendance_records (lesson_session_id);
create index if not exists idx_attendance_records_student_date
  on public.attendance_records (student_id, attendance_date desc);
create index if not exists idx_lesson_sessions_teacher_date
  on public.lesson_sessions (teacher_id, session_date desc);
create index if not exists idx_students_teacher_created
  on public.students (teacher_id, created_at desc);
create index if not exists idx_group_schedule_teacher
  on public.group_schedule (teacher_id);
create index if not exists idx_teacher_settings_teacher
  on public.teacher_settings (teacher_id);
create index if not exists idx_student_notifications_student
  on public.student_notifications (student_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) سجل نتائج التشغيل
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  raise notice 'Migration 049 applied: admin_log_audit + consume_rate_limit + performance indexes';
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  MIGRATION 050 — إل نوخبا سنترز — مخطط المراكز وعزل المستأجرين (centers schema + tenant RLS)
-- ═══════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════
--  MIGRATION 051 — الامتحانات المنفصلة — جدولا الامتحانات والدرجات + RLS (standalone exams)
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 051 — الامتحانات المنفصلة (Standalone Exams)
-- ═══════════════════════════════════════════════════════════════════════════
-- امتحانات مستقلة تمامًا عن الحصص (لا attendance ولا lesson_session):
--   • اللي امتحن هو اللي حضر — الطالب الوحيد اللي ليه سجل هو اللي رُصدت درجته
--   • سلم تقديرات قابل للتعديل بالكامل (الاسم + الحد الأدنى + العدد) مخزن
--     على الامتحان نفسه كنسب مئوية من الدرجة النهائية (80% من 100 = 80)
--   • unique (exam_id, student_id) → تسجيل الدرجات upsert علطول
-- العزل: teacher_id + RLS بنفس نمط 042/043/044 (can_access_workspace للمساعدين)
-- تشغيل: SQL Editor — idempotent (آمن للتكرار)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) جدول الامتحانات ──────────────────────────────────────────────────────
create table if not exists public.standalone_exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  exam_date date not null default current_date,
  -- null = كل الطلاب (اختيار المجموعة فلتر فقط — مش ربط بحصة)
  group_name text,
  max_score numeric not null default 100 check (max_score > 0),
  -- [{name: 'ممتاز', min: 80}, {name: 'جيد', min: 70}, ...] — نسب مئوية، الحد
  -- الأدنى لكل تقدير، والأول اللي يحققه الطالب من الأعلى للأسفل هو تقديره
  grade_scale jsonb not null
    default '[{"name":"ممتاز","min":80},{"name":"جيد","min":70},{"name":"مقبول","min":60},{"name":"ضعيف","min":0}]'::jsonb
    check (jsonb_typeof(grade_scale) = 'array'),
  -- open = جاري الرصد (قابل للتعديل) | completed = منتهي (يُفتح للتعديل صراحة)
  status text not null default 'open' check (status in ('open', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 2) جدول الدرجات — امتحن = حضر ───────────────────────────────────────────
create table if not exists public.standalone_exam_scores (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  exam_id uuid not null references public.standalone_exams(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  score numeric not null default 0 check (score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id)
);

-- ── 3) updated_at triggers ──────────────────────────────────────────────────
create or replace function public.touch_standalone_exam_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_standalone_exams_touch on public.standalone_exams;
create trigger trg_standalone_exams_touch
  before update on public.standalone_exams
  for each row execute function public.touch_standalone_exam_updated_at();

drop trigger if exists trg_standalone_exam_scores_touch on public.standalone_exam_scores;
create trigger trg_standalone_exam_scores_touch
  before update on public.standalone_exam_scores
  for each row execute function public.touch_standalone_exam_updated_at();

-- ── 4) فهارس أنماط الاستعلام الفعلية ────────────────────────────────────────
create index if not exists idx_standalone_exams_teacher_date
  on public.standalone_exams (teacher_id, exam_date desc, created_at desc);
create index if not exists idx_standalone_exam_scores_exam
  on public.standalone_exam_scores (exam_id);
create index if not exists idx_standalone_exam_scores_student
  on public.standalone_exam_scores (student_id, created_at desc);

-- ── 5) RLS — نفس نمط 042/043/044 (المالك أو المساعد المصرّح له) ────────────
alter table public.standalone_exams enable row level security;
alter table public.standalone_exam_scores enable row level security;

drop policy if exists "standalone_exams_owner_all" on public.standalone_exams;
create policy "standalone_exams_owner_all" on public.standalone_exams
  for all to authenticated using (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  ) with check (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

drop policy if exists "standalone_exam_scores_owner_all" on public.standalone_exam_scores;
create policy "standalone_exam_scores_owner_all" on public.standalone_exam_scores
  for all to authenticated using (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  ) with check (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- فحص ذاتي بعد التشغيل
-- ═══════════════════════════════════════════════════════════════════════════
-- select policyname, cmd, roles from pg_policies
--   where tablename in ('standalone_exams','standalone_exam_scores');
-- المتوقع: standalone_exams_owner_all (ALL) + standalone_exam_scores_owner_all (ALL)
-- select tablename from pg_tables
--   where tablename in ('standalone_exams','standalone_exam_scores');
-- المتوقع: الصفين موجودين و rowsecurity = true

-- ═══════════════════════════════════════════════════════════════════════
--  MIGRATION 052 — بوابة الطالب — RPC نتائج الامتحانات المنفصلة (portal exam results RPC)
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 052 — نتائج الامتحانات المنفصلة في بوابة الطالب (Portal access)
-- ═══════════════════════════════════════════════════════════════════════════
-- RPC مخصص جديد يرجّع درجات الطالب في الامتحانات المنفصلة (migration 051)
-- حسب توكن البوابة — بدون لمس get_student_portal_data القائمة إطلاقًا.
--   • security definer + توكن إجباري: لا تسريب بيانات، الطالب يشوف درجاته فقط
--   • سلم التقديرات بيرجع مع الصف — البوابة تحسب اسم التقدير على العميل
--     بنفس معادلة لوحة المدرس (أول صف من الأعلى تحققه النسبة هو التقدير)
--   • اللي امتحن هو اللي حضر: الصفوف = الطلاب اللي ليهم درجة فقط
-- التشغيل: SQL Editor — idempotent (آمن للتكرار)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_student_standalone_exams(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_teacher_id uuid;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return '[]'::jsonb;
  end if;

  -- توكن البوابة → الطالب (نفس مسار 019/037 بالظبط)
  select q.student_id, s.teacher_id
    into v_student_id, v_teacher_id
  from public.student_qr_tokens q
  join public.students s on s.id = q.student_id
  where q.token = p_token and q.revoked_at is null
  limit 1;

  -- احتياط: روابط QR القديمة اللي كانت بتستخدم UUID الطالب نفسه كتوكن
  if v_student_id is null
     and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$' then
    select s.id, s.teacher_id
      into v_student_id, v_teacher_id
    from public.students s
    where s.id = p_token::uuid
    limit 1;
  end if;

  if v_student_id is null then
    return '[]'::jsonb;
  end if;

  -- درجات الطالب في الامتحانات المنفصلة (الممتحن = اللي ليه صف درجة)
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'exam_id', e.id,
      'title', e.title,
      'exam_date', e.exam_date,
      'exam_status', e.status,
      'score', es.score,
      'max_score', e.max_score,
      'grade_scale', e.grade_scale,
      'graded_at', es.updated_at
    ) order by e.exam_date desc, e.created_at desc)
    from public.standalone_exam_scores es
    join public.standalone_exams e on e.id = es.exam_id
    where es.student_id = v_student_id
      and es.teacher_id = v_teacher_id
  ), '[]'::jsonb);
end;
$$;

-- صلاحيات التنفيذ: anon (بوابة الطالب من غير تسجيل دخول) + authenticated
revoke all on function public.get_student_standalone_exams(text) from public;
revoke all on function public.get_student_standalone_exams(text) from anon;
revoke all on function public.get_student_standalone_exams(text) from authenticated;
grant execute on function public.get_student_standalone_exams(text) to anon;
grant execute on function public.get_student_standalone_exams(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- فحص ذاتي بعد التشغيل
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_student_standalone_exams'
  ) then
    raise exception 'Migration 052 FAILED: get_student_standalone_exams not created';
  end if;
  raise notice 'Migration 052 applied: portal RPC get_student_standalone_exams(text) — anon+authenticated';
end $$;



-- ═══════════════════════════════════════════════════════════════════════════
-- فحص ذاتي نهائي — النتايج المتوقعة تحت (شوف سجل الرسائل Messages)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_missing text := '';
begin
  -- الجداول الأربعة الأساسية
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'edge_rate_limits') then
    v_missing := v_missing || 'edge_rate_limits(m049) ';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'centers') then
    v_missing := v_missing || 'centers(m050) ';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'standalone_exams') then
    v_missing := v_missing || 'standalone_exams(m051) ';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'standalone_exam_scores') then
    v_missing := v_missing || 'standalone_exam_scores(m051) ';
  end if;
  -- الدوال
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'admin_log_audit') then
    v_missing := v_missing || 'admin_log_audit(m049) ';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'consume_rate_limit') then
    v_missing := v_missing || 'consume_rate_limit(m049) ';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'create_center') then
    v_missing := v_missing || 'create_center(m050) ';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'get_student_standalone_exams') then
    v_missing := v_missing || 'get_student_standalone_exams(m052) ';
  end if;

  if v_missing <> '' then
    raise exception 'فحص ذاتي فشل — ناقص: %', v_missing;
  end if;
  raise notice '════════════════════════════════════════════════';
  raise notice '  تم تطبيق كل المايجريشنز بنجاح (049 + 050 + 051 + 052)';
  raise notice '  كل الجداول والدوال المطلوبة موجودة — كله تمام ✓';
  raise notice '════════════════════════════════════════════════';
end $$;
