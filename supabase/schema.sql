-- ============================================================================
-- نظام الفارس — Database Schema (Supabase / Postgres)
-- ============================================================================
-- كيفية الاستخدام:
-- 1. افتح مشروعك على supabase.com
-- 2. من القائمة الجانبية: SQL Editor → New query
-- 3. الصق هذا الملف كاملاً واضغط Run
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1) profiles — حساب المدرّس (يمتد من نظام تسجيل الدخول الجاهز في Supabase)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  -- trial: فترة تجربة مجانية | active: مشترك فعليًا | expired: انتهى | cancelled: ألغى
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'expired', 'cancelled')),
  subscription_expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2) groups — مجموعات الطلاب (كل مجموعة تخص مدرّس واحد)
-- ----------------------------------------------------------------------------
create table if not exists groups (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  stage text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3) students
-- ----------------------------------------------------------------------------
create table if not exists students (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  group_id uuid references groups(id) on delete set null,
  name text not null,
  phone text,
  stage text,
  points integer not null default 0,
  attendance_status text not null default 'غائب',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4) attendance_records — سجل تاريخي لكل مرة اتسجل فيها حضور/غياب
-- ----------------------------------------------------------------------------
create table if not exists attendance_records (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  status text not null,
  recorded_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 5) behavior_logs — سجل النقاط والسلوك
-- ----------------------------------------------------------------------------
create table if not exists behavior_logs (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  note text,
  points_delta integer not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security — هنا الحماية الحقيقية
-- كل مدرّس يقدر يشوف/يعدّل بياناته هو بس، ومفيش وصول أصلاً من غير اشتراك سارٍ.
-- ============================================================================
alter table profiles enable row level security;
alter table groups enable row level security;
alter table students enable row level security;
alter table attendance_records enable row level security;
alter table behavior_logs enable row level security;

-- كل مستخدم يدير ملفه الشخصي بس
create policy "profiles_self_access" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- دالة مساعدة: هل اشتراك المستخدم الحالي سارٍ؟
create or replace function is_subscription_active()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and subscription_status in ('trial', 'active')
      and subscription_expires_at > now()
  );
$$;

-- كل الجداول التالية: وصول للمدرّس صاحب البيانات فقط، وبشرط اشتراك سارٍ
create policy "groups_teacher_access" on groups
  for all using (auth.uid() = teacher_id and is_subscription_active())
  with check (auth.uid() = teacher_id and is_subscription_active());

create policy "students_teacher_access" on students
  for all using (auth.uid() = teacher_id and is_subscription_active())
  with check (auth.uid() = teacher_id and is_subscription_active());

create policy "attendance_teacher_access" on attendance_records
  for all using (auth.uid() = teacher_id and is_subscription_active())
  with check (auth.uid() = teacher_id and is_subscription_active());

create policy "behavior_teacher_access" on behavior_logs
  for all using (auth.uid() = teacher_id and is_subscription_active())
  with check (auth.uid() = teacher_id and is_subscription_active());

-- ============================================================================
-- عند تسجيل مدرّس جديد، ننشئ له صف profile تلقائيًا (تجربة مجانية 7 أيام)
-- ============================================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================================
-- فهارس لتحسين الأداء
-- ============================================================================
create index if not exists idx_students_teacher on students(teacher_id);
create index if not exists idx_students_group on students(group_id);
create index if not exists idx_groups_teacher on groups(teacher_id);
create index if not exists idx_attendance_student on attendance_records(student_id);
create index if not exists idx_attendance_teacher on attendance_records(teacher_id);
create index if not exists idx_behavior_student on behavior_logs(student_id);
