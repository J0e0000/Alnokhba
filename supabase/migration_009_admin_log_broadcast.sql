-- ============================================================================
-- نظام النخبة — Migration 009: سجل نشاط الأدمن + رسائل البث
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) سجل نشاط الأدمن: مين فعّل/مدّد/ألغى اشتراك مين وإمتى
-- ----------------------------------------------------------------------------
create table if not exists admin_activity_log (
  id uuid primary key default uuid_generate_v4(),
  admin_id uuid not null references profiles(id) on delete cascade,
  target_teacher_id uuid not null references profiles(id) on delete cascade,
  action text not null, -- 'extend' | 'cancel' | 'activate'
  details text,
  created_at timestamptz not null default now()
);

alter table admin_activity_log enable row level security;

create policy "admin_activity_log_admin_only" on admin_activity_log
  for all using (is_admin_user()) with check (is_admin_user() and admin_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2) رسائل بث: الأدمن يبعت رسالة تظهر لكل المدرّسين
-- ----------------------------------------------------------------------------
create table if not exists broadcast_messages (
  id uuid primary key default uuid_generate_v4(),
  admin_id uuid not null references profiles(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

alter table broadcast_messages enable row level security;

-- كل مستخدم مسجّل دخول يقدر يقرا الرسائل (مفيش بيانات حساسة فيها)
create policy "broadcast_messages_read_all" on broadcast_messages
  for select using (auth.role() = 'authenticated');

create policy "broadcast_messages_admin_write" on broadcast_messages
  for insert with check (is_admin_user() and admin_id = auth.uid());

create policy "broadcast_messages_admin_delete" on broadcast_messages
  for delete using (is_admin_user());
