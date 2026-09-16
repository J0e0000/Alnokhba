-- ============================================================================
-- النخبة (Alnokhba) — Migration 036
-- Admin Systems: Backup & Recovery + Team Management upgrade + Admin Support Access
-- ============================================================================
-- آمن وتراكمي 100%: لا يحذف أو يعدّل أي بيانات قائمة. يعمل فوق قاعدة البيانات
-- الحالية مباشرة من Supabase SQL Editor (الصق الملف كاملاً ثم Run).
--
-- المحتويات:
--   1) جدول backups + إعدادات النسخ backup_settings
--   2) Bucket تخزين خاص (غير عام) admin-backups
--   3) جدول جلسات وصول الدعم admin_support_sessions
--   4) جدول سجل التدقيق admin_audit_logs (للإضافة فقط — لا يمكن تعديله أو حذفه)
--   5) تطوير الفرق: أعمدة وصف/لون/شعار/حالة على admin_teams و admin_team_members
--   6) RPCs الفرق + البحث + وصول الدعم + التدقيق + دورة حياة النسخ + الاستعادة
--   7) مشغّل تدقيق تلقائي لكل عمليات الكتابة أثناء جلسة وصول الدعم
--   8) مجدول أسبوعي (الجمعة 22:00 Africa/Cairo) عبر pg_cron + pg_net
-- ============================================================================

create extension if not exists pg_net with schema extensions;

-- ----------------------------------------------------------------------------
-- 1) backups — سجل كل عملية نسخة احتياطية
-- ----------------------------------------------------------------------------
create table if not exists backups (
  id uuid primary key default uuid_generate_v4(),
  backup_type text not null default 'manual' check (backup_type in ('manual', 'weekly')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL')),
  file_name text,
  file_path text,
  file_size bigint,
  checksum text,
  sheet_count integer,
  users_count integer,
  teams_count integer,
  students_count integer,
  records_count integer,
  duration_ms integer,
  error_message text,
  retry_count integer not null default 0,
  created_by uuid references profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

alter table backups enable row level security;
create index if not exists idx_backups_created_at on backups(created_at desc);
create index if not exists idx_backups_status on backups(status);

-- القراءة للأدمن فقط؛ كل عمليات الكتابة تتم عبر RPCs محمية (ولا سياسة كتابة مباشرة).
drop policy if exists "backups_admin_read" on backups;
create policy "backups_admin_read" on backups
  for select using (is_admin_user());

-- ----------------------------------------------------------------------------
-- 2) backup_settings — إعدادات المجدول والاحتفاظ (صف واحد فقط)
-- ----------------------------------------------------------------------------
create table if not exists backup_settings (
  id integer primary key default 1 check (id = 1),
  schedule_enabled boolean not null default true,
  backup_day_of_week smallint not null default 5,   -- 0=الأحد .. 6=السبت (الافتراضي 5=الجمعة)
  backup_hour smallint not null default 22,          -- بتوقيت Africa/Cairo
  timezone text not null default 'Africa/Cairo',
  retention_count integer not null default 12,       -- الاحتفاظ بآخر 12 نسخة أسبوعية على الأقل
  auto_retry_max integer not null default 3,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

insert into backup_settings (id) values (1) on conflict (id) do nothing;

alter table backup_settings enable row level security;
drop policy if exists "backup_settings_admin_read" on backup_settings;
create policy "backup_settings_admin_read" on backup_settings
  for select using (is_admin_user());

-- ----------------------------------------------------------------------------
-- 3) Bucket تخزين خاص للنسخ — غير عام إطلاقاً، وبدون أي سياسة وصول عامة.
--    الرفع/التنزيل يتم فقط عبر Edge Function بمفتاح الخدمة (Service Role)
--    مع تحقق صلاحيات الأدمن، والتنزيل عبر روابط موقّعة قصيرة العمر.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('admin-backups', 'admin-backups', false)
on conflict (id) do nothing;

-- (لا نضيف أي سياسة على storage.objects لهذا الـ bucket — الوصول الافتراضي مرفوض للجميع)

-- ----------------------------------------------------------------------------
-- 4) admin_support_sessions — جلسات "وصول الدعم" المؤقتة للأدمن
-- ----------------------------------------------------------------------------
create table if not exists admin_support_sessions (
  id uuid primary key default uuid_generate_v4(),
  admin_user_id uuid not null references profiles(id) on delete cascade,
  target_user_id uuid not null references profiles(id) on delete cascade,
  reason text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  ended_at timestamptz,
  end_reason text check (end_reason in ('manual', 'timeout', 'superseded', 'signout')),
  status text not null default 'active' check (status in ('active', 'ended'))
);

alter table admin_support_sessions enable row level security;
create index if not exists idx_support_sessions_admin on admin_support_sessions(admin_user_id, status);
create index if not exists idx_support_sessions_target on admin_support_sessions(target_user_id, status);

-- الأدمن يرى الجلسات فقط (كل الكتابة عبر RPCs).
drop policy if exists "admin_support_sessions_admin_read" on admin_support_sessions;
create policy "admin_support_sessions_admin_read" on admin_support_sessions
  for select using (is_admin_user());

-- ----------------------------------------------------------------------------
-- 5) admin_audit_logs — سجل تدقيق دائم (للإضافة فقط: لا سياسات تعديل أو حذف)
-- ----------------------------------------------------------------------------
-- إدخالات النظام الآلي (المجدول) تُسجَّل بمعرّف أدمن فارغ — نسمح بذلك في السجل القديم
alter table admin_activity_log alter column admin_id drop not null;
alter table admin_activity_log alter column target_teacher_id drop not null;

create table if not exists admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_user_id uuid references profiles(id) on delete set null,
  target_user_id uuid references profiles(id) on delete set null,
  action text not null,
  reason text,
  details text,
  ip text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  support_session_id uuid references admin_support_sessions(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table admin_audit_logs enable row level security;
create index if not exists idx_audit_logs_created_at on admin_audit_logs(created_at desc);
create index if not exists idx_audit_logs_admin on admin_audit_logs(admin_user_id);
create index if not exists idx_audit_logs_target on admin_audit_logs(target_user_id);
create index if not exists idx_audit_logs_action on admin_audit_logs(action);
create index if not exists idx_audit_logs_session on admin_audit_logs(support_session_id);

-- قراءة: الأدمن فقط. إضافة: الأدمن باسمه هو فقط. (لا يوجد update/delete إطلاقاً)
drop policy if exists "admin_audit_logs_admin_read" on admin_audit_logs;
create policy "admin_audit_logs_admin_read" on admin_audit_logs
  for select using (is_admin_user());

drop policy if exists "admin_audit_logs_admin_insert" on admin_audit_logs;
create policy "admin_audit_logs_admin_insert" on admin_audit_logs
  for insert with check (is_admin_user() and admin_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 6) تطوير الفرق الحالية (admin_teams / admin_team_members موجودان بالفعل)
--    إضافي فقط: وصف، لون، شعار، حالة، محدَّث في.
-- ----------------------------------------------------------------------------
alter table admin_teams add column if not exists description text;
alter table admin_teams add column if not exists color text default '#D4AF37';
alter table admin_teams add column if not exists logo_url text;
alter table admin_teams add column if not exists status text not null default 'active'
  check (status in ('active', 'disabled'));
alter table admin_teams add column if not exists updated_at timestamptz not null default now();
alter table admin_teams add column if not exists created_by uuid references profiles(id) on delete set null;

alter table admin_team_members add column if not exists added_by uuid references profiles(id) on delete set null;

alter table admin_teams enable row level security;
alter table admin_team_members enable row level security;

drop policy if exists "admin_teams_admin_read" on admin_teams;
create policy "admin_teams_admin_read" on admin_teams
  for select using (is_admin_user());

drop policy if exists "admin_team_members_admin_read" on admin_team_members;
create policy "admin_team_members_admin_read" on admin_team_members
  for select using (is_admin_user());

-- ----------------------------------------------------------------------------
-- 7) وصول الدعم: دمج الجلسة المؤقتة في آلية مساحة العمل القائمة
--    (نفس مسار "المساعد" المجرَّب — بدون أي تغيير في جداول البيانات)
-- ----------------------------------------------------------------------------

-- my_workspace_owner: أولوية لجلسة وصول الدعم النشطة، وإلا الربط العادي (إن وجد)
create or replace function my_workspace_owner()
returns uuid
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select target_user_id from admin_support_sessions
      where admin_user_id = auth.uid() and status = 'active' and expires_at > now()
      order by started_at desc limit 1),
    (select owner_id from workspace_members where member_id = auth.uid())
  );
$$;

grant execute on function my_workspace_owner() to authenticated;

-- can_access_workspace: نفس السلوك الأصلي + فرع جلسة وصول الدعم
-- (الوصول عبر الدعم لا يشترط اشتراكًا ساريًا حتى يمكن فحص الحسابات المنتهية)
create or replace function can_access_workspace(check_teacher uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    (
      (
        auth.uid() = check_teacher
        or exists (select 1 from workspace_members where owner_id = check_teacher and member_id = auth.uid())
      )
      and exists (
        select 1 from profiles
        where id = check_teacher
          and subscription_status in ('trial', 'active')
          and subscription_expires_at > now()
      )
    )
    or exists (
      select 1 from admin_support_sessions
      where admin_user_id = auth.uid()
        and target_user_id = check_teacher
        and status = 'active'
        and expires_at > now()
    );
$$;

grant execute on function can_access_workspace(uuid) to authenticated;

-- قراءة بروفايل المستخدم المستهدف أثناء جلسة الدعم (بروفايل فقط — لا بيانات سرية)
drop policy if exists "profiles_read_as_support" on profiles;
create policy "profiles_read_as_support" on profiles
  for select using (
    exists (
      select 1 from admin_support_sessions
      where admin_user_id = auth.uid() and target_user_id = profiles.id
        and status = 'active' and expires_at > now()
    )
  );

-- my_support_session: الجلسة النشطة الحالية للمستخدم (إن وُجدت) كـ JSON
create or replace function my_support_session()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row admin_support_sessions;
begin
  select * into v_row from admin_support_sessions
  where admin_user_id = auth.uid() and status = 'active'
  order by started_at desc limit 1;

  if v_row.id is null then return null; end if;

  -- انتهت صلاحيتها؟ أغلقها كـ timeout وأبلغ التطبيق أنها انتهت.
  if v_row.expires_at <= now() then
    update admin_support_sessions
      set status = 'ended', ended_at = now(), end_reason = 'timeout'
      where id = v_row.id;
    return null;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'admin_user_id', v_row.admin_user_id,
    'target_user_id', v_row.target_user_id,
    'reason', v_row.reason,
    'started_at', v_row.started_at,
    'expires_at', v_row.expires_at
  );
end;
$$;

grant execute on function my_support_session() to authenticated;

-- ----------------------------------------------------------------------------
-- 8) RPCs عامة
-- ----------------------------------------------------------------------------

-- تسجيل حدث تدقيق (يستخدمه التطبيق و Edge Function)
create or replace function admin_log_audit(
  p_action text,
  p_target_user_id uuid default null,
  p_reason text default null,
  p_details text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_support_session_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_user() then
    raise exception 'Admin access required';
  end if;
  insert into admin_audit_logs (admin_user_id, target_user_id, action, reason, details, metadata, support_session_id)
  values (auth.uid(), p_target_user_id, p_action, p_reason, p_details, p_metadata, p_support_session_id);
end;
$$;

grant execute on function admin_log_audit(text, uuid, text, text, jsonb, uuid) to authenticated;

-- بحث المستخدمين (لإضافة أعضاء الفرق ولوصول الدعم): بالاسم أو الهاتف أو الإيميل أو المعرف
create or replace function admin_search_users(p_query text, p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q text := trim(coalesce(p_query, ''));
  v_uuid uuid := null;
  v_results jsonb;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;
  if v_q = '' then return '[]'::jsonb; end if;
  begin
    v_uuid := v_q::uuid;
  exception when others then
    v_uuid := null;
  end;

  select coalesce(jsonb_agg(row_json order by is_exact desc, full_name), '[]'::jsonb) into v_results
  from (
    select
      (p.id = v_uuid) as is_exact,
      jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
        'account_type', p.account_type, 'subscription_status', p.subscription_status,
        'subscription_expires_at', p.subscription_expires_at,
        'is_verified', p.is_verified, 'is_admin', p.is_admin,
        'team_ids', coalesce((select array_agg(tm.team_id) from admin_team_members tm where tm.profile_id = p.id), array[]::uuid[]),
        'created_at', p.created_at
      ) as row_json,
      p.full_name
    from profiles p
    where p.id = v_uuid
       or p.full_name ilike '%' || v_q || '%'
       or p.email ilike '%' || v_q || '%'
       or p.phone ilike '%' || v_q || '%'
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  ) sub;

  return v_results;
end;
$$;

grant execute on function admin_search_users(text, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 9) RPCs الفرق
-- ----------------------------------------------------------------------------

create or replace function admin_teams_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;

  select jsonb_build_object(
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'description', t.description, 'color', t.color,
        'logo_url', t.logo_url, 'status', t.status, 'created_by', t.created_by,
        'created_at', t.created_at,
        'member_count', (select count(*) from admin_team_members m where m.team_id = t.id)
      ) order by t.created_at desc)
      from admin_teams t
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'team_id', m.team_id, 'profile_id', m.profile_id, 'added_at', m.created_at,
        'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
        'is_verified', p.is_verified, 'subscription_status', p.subscription_status,
        'is_admin', p.is_admin,
        'student_count', s.student_count,
        'last_activity', s.last_activity
      ) order by p.full_name nulls last)
      from admin_team_members m
      join profiles p on p.id = m.profile_id
      left join admin_teacher_stats() s on s.teacher_id = m.profile_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function admin_teams_overview() to authenticated;

-- إنشاء/تعديل فريق (p_id = null → إنشاء جديد)
create or replace function admin_upsert_team(
  p_id uuid default null,
  p_name text,
  p_description text default null,
  p_color text default null,
  p_logo_url text default null,
  p_status text default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_action text;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'اسم الفريق مطلوب'; end if;
  if p_status not in ('active', 'disabled') then raise exception 'حالة الفريق غير صحيحة'; end if;

  if p_id is null then
    insert into admin_teams (name, description, color, logo_url, status, created_by)
    values (trim(p_name), p_description, coalesce(p_color, '#D4AF37'), p_logo_url, p_status, auth.uid())
    returning id into v_id;
    v_action := 'team_created';
  else
    update admin_teams set
      name = trim(p_name),
      description = p_description,
      color = coalesce(p_color, color),
      logo_url = p_logo_url,
      status = p_status,
      updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'الفريق غير موجود'; end if;
    v_action := 'team_updated';
  end if;

  insert into admin_audit_logs (admin_user_id, action, details, metadata)
  values (auth.uid(), v_action, coalesce('فريق: ' || trim(p_name), ''),
          jsonb_build_object('team_id', v_id, 'name', trim(p_name), 'status', p_status));
  return v_id;
end;
$$;

grant execute on function admin_upsert_team(uuid, text, text, text, text, text) to authenticated;

-- إضافة أعضاء (يتجاهل الموجودين منهم مسبقاً) — العضوية تنظيمية فقط بلا أي صلاحيات إضافية
create or replace function admin_team_add_members(p_team_id uuid, p_profile_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added integer := 0;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;
  if not exists (select 1 from admin_teams where id = p_team_id) then
    raise exception 'الفريق غير موجود';
  end if;

  insert into admin_team_members (team_id, profile_id, added_by)
  select p_team_id, pid, auth.uid()
  from unnest(coalesce(p_profile_ids, array[]::uuid[])) as pid
  where exists (select 1 from profiles where id = pid)
    and not exists (
      select 1 from admin_team_members
      where team_id = p_team_id and profile_id = pid
    );
  get diagnostics v_added = row_count;

  insert into admin_audit_logs (admin_user_id, action, details, metadata)
  values (auth.uid(), 'team_members_added', 'إضافة ' || v_added || ' عضو للفريق',
          jsonb_build_object('team_id', p_team_id, 'added_count', v_added));
  return v_added;
end;
$$;

grant execute on function admin_team_add_members(uuid, uuid[]) to authenticated;

create or replace function admin_team_remove_member(p_team_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;
  delete from admin_team_members where team_id = p_team_id and profile_id = p_profile_id;
  if not found then raise exception 'العضو غير موجود في هذا الفريق'; end if;
  insert into admin_audit_logs (admin_user_id, action, details, metadata)
  values (auth.uid(), 'team_member_removed', 'إزالة عضو من الفريق',
          jsonb_build_object('team_id', p_team_id, 'profile_id', p_profile_id));
end;
$$;

grant execute on function admin_team_remove_member(uuid, uuid) to authenticated;

-- حذف فريق (لا يحذف الأعضاء أنفسهم إطلاقاً — تُزال العضويات فقط)
create or replace function admin_delete_team_v2(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_members integer;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;
  select name, (select count(*) from admin_team_members m where m.team_id = admin_teams.id)
    into v_name, v_members from admin_teams where id = p_team_id;
  if v_name is null then raise exception 'الفريق غير موجود'; end if;

  delete from admin_team_members where team_id = p_team_id;
  delete from admin_teams where id = p_team_id;

  insert into admin_audit_logs (admin_user_id, action, details, metadata)
  values (auth.uid(), 'team_deleted', 'حذف فريق: ' || v_name || ' (' || v_members || ' عضوية أُزيلت — لم يُحذف أي مستخدم)',
          jsonb_build_object('team_id', p_team_id, 'name', v_name, 'memberships_removed', v_members));
end;
$$;

grant execute on function admin_delete_team_v2(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 10) RPCs وصول الدعم (Impersonation)
-- ----------------------------------------------------------------------------

create or replace function admin_start_support_session(
  p_target_user_id uuid,
  p_reason text,
  p_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target profiles;
  v_auth_exists boolean;
  v_session_id uuid;
  v_minutes integer;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب الوصول مطلوب — يجب توثيق كل عملية وصول دعم';
  end if;

  select * into v_target from profiles where id = p_target_user_id;
  if v_target.id is null then raise exception 'المستخدم المستهدف غير موجود'; end if;

  select exists (select 1 from auth.users where id = p_target_user_id) into v_auth_exists;
  if not v_auth_exists then raise exception 'حساب المستخدم المستهدف محذوف من نظام المصادقة'; end if;

  if p_target_user_id = v_admin_id then
    raise exception 'لا يمكن فتح وصول دعم على حسابك أنت';
  end if;
  if v_target.is_admin then
    raise exception 'وصول الدعم غير مسموح على حسابات الأدمن — محظور لأسباب أمنية';
  end if;

  v_minutes := greatest(least(coalesce(p_minutes, 30), 120), 5);

  -- منع الجلسات المتزامنة: أي جلسة نشطة سابقة تُغلق تلقائياً (تُسجَّل في التدقيق)
  update admin_support_sessions
    set status = 'ended', ended_at = now(), end_reason = 'superseded'
  where admin_user_id = v_admin_id and status = 'active';

  insert into admin_support_sessions (admin_user_id, target_user_id, reason, expires_at)
  values (v_admin_id, p_target_user_id, trim(p_reason), now() + (v_minutes || ' minutes')::interval)
  returning id into v_session_id;

  insert into admin_audit_logs (admin_user_id, target_user_id, action, reason, support_session_id, metadata)
  values (v_admin_id, p_target_user_id, 'support_access_started', trim(p_reason), v_session_id,
          jsonb_build_object('minutes', v_minutes, 'target_name', v_target.full_name));

  return jsonb_build_object(
    'session_id', v_session_id,
    'target_user_id', p_target_user_id,
    'target_name', v_target.full_name,
    'expires_at', now() + (v_minutes || ' minutes')::interval
  );
end;
$$;

grant execute on function admin_start_support_session(uuid, text, integer) to authenticated;

create or replace function admin_end_support_session(
  p_session_id uuid default null,
  p_reason text default 'manual'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target uuid;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;

  if p_session_id is not null then
    select target_user_id into v_target from admin_support_sessions
    where id = p_session_id and admin_user_id = v_admin_id;
    if v_target is null then raise exception 'الجلسة غير موجودة أو ليست لك'; end if;
    update admin_support_sessions
      set status = 'ended', ended_at = now(),
          end_reason = case when p_reason in ('manual', 'timeout', 'superseded', 'signout') then p_reason else 'manual' end
    where id = p_session_id and status = 'active';
    if found then
      insert into admin_audit_logs (admin_user_id, target_user_id, action, reason, support_session_id)
      values (v_admin_id, v_target, 'support_access_ended', p_reason, p_session_id);
    end if;
  else
    for p_session_id, v_target in
      select id, target_user_id from admin_support_sessions
      where admin_user_id = v_admin_id and status = 'active'
    loop
      update admin_support_sessions
        set status = 'ended', ended_at = now(),
            end_reason = case when p_reason in ('manual', 'timeout', 'superseded', 'signout') then p_reason else 'manual' end
      where id = p_session_id;
      insert into admin_audit_logs (admin_user_id, target_user_id, action, reason, support_session_id)
      values (v_admin_id, v_target, 'support_access_ended', p_reason, p_session_id);
    end loop;
  end if;
end;
$$;

grant execute on function admin_end_support_session(uuid, text) to authenticated;

-- سجل التدقيق مع فلاتر (أدمن/مستخدم/إجراء/تاريخ/فريق/جلسة دعم)
create or replace function admin_get_audit_logs(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(least(coalesce((p_filters->>'limit')::int, 100), 500), 1);
  v_offset integer := greatest(coalesce((p_filters->>'offset')::int, 0), 0);
  v_result jsonb;
  v_team_id uuid := null;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;
  if p_filters ? 'team_id' then
    v_team_id := (p_filters->>'team_id')::uuid;
  end if;

  with base as (
    select l.*,
      a.full_name as admin_name, a.email as admin_email,
      t.full_name as target_name, t.email as target_email
    from admin_audit_logs l
    left join profiles a on a.id = l.admin_user_id
    left join profiles t on t.id = l.target_user_id
    where (not p_filters ? 'admin_user_id' or l.admin_user_id = (p_filters->>'admin_user_id')::uuid)
      and (not p_filters ? 'target_user_id' or l.target_user_id = (p_filters->>'target_user_id')::uuid)
      and (not p_filters ? 'action' or l.action ilike (p_filters->>'action') || '%')
      and (not p_filters ? 'date_from' or l.created_at >= ((p_filters->>'date_from')::date)::timestamptz)
      and (not p_filters ? 'date_to' or l.created_at < (((p_filters->>'date_to')::date + 1)::timestamptz))
      and (not p_filters ? 'support_session_id' or l.support_session_id = (p_filters->>'support_session_id')::uuid)
      and (
        v_team_id is null
        or exists (
          select 1 from admin_team_members tm
          where tm.team_id = v_team_id and tm.profile_id = l.target_user_id
        )
      )
    order by l.created_at desc
    limit 2000
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'admin_user_id', b.admin_user_id, 'admin_name', coalesce(b.admin_name, 'النظام'),
        'target_user_id', b.target_user_id, 'target_name', b.target_name,
        'action', b.action, 'reason', b.reason, 'details', b.details,
        'metadata', b.metadata, 'support_session_id', b.support_session_id,
        'created_at', b.created_at
      ) order by b.created_at desc)
      from (select * from base offset v_offset limit v_limit) b
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function admin_get_audit_logs(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 11) RPCs دورة حياة النسخ الاحتياطية
-- ----------------------------------------------------------------------------

-- بداية تنفيذ نسخة: انتقال ذرّي PENDING/FAILED → RUNNING يمنع تشغيل نسختين معاً
create or replace function admin_backup_begin(p_backup_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row backups;
  v_updated integer;
begin
  select * into v_row from backups where id = p_backup_id;
  if v_row.id is null then raise exception 'النسخة غير موجودة'; end if;

  -- التفويض: الأدمن يبدأ أي نسخة؛ الجهاز المجدول (بلا JWT) يبدأ النسخ المجدولة فقط
  if not (is_admin_user() or v_row.backup_type = 'weekly') then
    raise exception 'Admin access required';
  end if;

  if v_row.status = 'SUCCESS' then
    raise exception 'هذه النسخة اكتملت بنجاح بالفعل';
  end if;

  -- قفل منطقي: لا نسخة أخرى قيد التشغيل خلال آخر 30 دقيقة
  if exists (
    select 1 from backups
    where status = 'RUNNING' and id <> p_backup_id
      and started_at > now() - interval '30 minutes'
  ) then
    return false;
  end if;

  update backups
    set status = 'RUNNING', started_at = now(), error_message = null
  where id = p_backup_id
    and (
      status in ('PENDING', 'FAILED')
      or (status = 'RUNNING' and started_at < now() - interval '30 minutes')
    );
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return false; -- تنفيذ مكرر أو نسخة غير قابلة للبدء
  end if;
  return true;
end;
$$;

grant execute on function admin_backup_begin(uuid) to authenticated;

-- إتمام النسخة بعد التحقق منها + تشغيل سياسة الاحتفاظ تلقائياً
create or replace function admin_backup_complete(
  p_backup_id uuid,
  p_file_name text,
  p_file_path text,
  p_file_size bigint,
  p_checksum text,
  p_sheet_count integer,
  p_users_count integer,
  p_teams_count integer,
  p_students_count integer,
  p_records_count integer,
  p_partial boolean default false,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row backups;
begin
  select * into v_row from backups where id = p_backup_id;
  if v_row.id is null then raise exception 'النسخة غير موجودة'; end if;
  if not (is_admin_user() or v_row.backup_type = 'weekly') then
    raise exception 'Admin access required';
  end if;
  if v_row.status <> 'RUNNING' then raise exception 'النسخة ليست قيد التشغيل'; end if;

  update backups set
    status = case when p_partial then 'PARTIAL' else 'SUCCESS' end,
    completed_at = now(),
    file_name = p_file_name,
    file_path = p_file_path,
    file_size = p_file_size,
    checksum = p_checksum,
    sheet_count = p_sheet_count,
    users_count = p_users_count,
    teams_count = p_teams_count,
    students_count = p_students_count,
    records_count = p_records_count,
    duration_ms = greatest(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000, 0)::int,
    metadata = p_metadata
  where id = p_backup_id;

  insert into admin_audit_logs (admin_user_id, action, details, metadata)
  values (coalesce(auth.uid(), v_row.created_by),
          case when p_partial then 'backup_completed_partial' else 'backup_completed' end,
          'نسخة احتياطية ' || case when p_partial then 'جزئية' else 'ناجحة' end || ': ' || coalesce(p_file_name, ''),
          jsonb_build_object('backup_id', p_backup_id, 'users', p_users_count, 'records', p_records_count,
                             'file_size', p_file_size, 'checksum', p_checksum));

  perform admin_backup_apply_retention();
end;
$$;

grant execute on function admin_backup_complete(uuid, text, text, bigint, text, integer, integer, integer, integer, integer, boolean, jsonb) to authenticated;

-- فشل النسخة: تسجيل السبب + تنبيه إداري (يظهر في لوحة النسخ وفي سجل النشاط)
create or replace function admin_backup_fail(p_backup_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row backups;
  v_msg text;
begin
  select * into v_row from backups where id = p_backup_id;
  if v_row.id is null then raise exception 'النسخة غير موجودة'; end if;
  if not (is_admin_user() or v_row.backup_type = 'weekly') then
    raise exception 'Admin access required';
  end if;

  v_msg := left(coalesce(p_error, 'خطأ غير معروف'), 500);

  update backups set
    status = 'FAILED',
    completed_at = now(),
    error_message = v_msg,
    duration_ms = greatest(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000, 0)::int
  where id = p_backup_id;

  -- تنبيه إداري حرج
  insert into admin_activity_log (admin_id, target_teacher_id, action, details)
  values (null, null, 'backup_failed', 'فشل النسخة الاحتياطية (' || coalesce(v_row.backup_type, '') || ') — السبب: ' || v_msg || ' — المحاولات: ' || v_row.retry_count);

  insert into admin_audit_logs (admin_user_id, action, details, metadata)
  values (coalesce(auth.uid(), v_row.created_by), 'backup_failed', 'فشل النسخة الاحتياطية: ' || v_msg,
          jsonb_build_object('backup_id', p_backup_id, 'retry_count', v_row.retry_count));
end;
$$;

grant execute on function admin_backup_fail(uuid, text) to authenticated;

-- إعادة محاولة نسخة فاشلة يدوياً من لوحة الأدمن
create or replace function admin_backup_reset_for_retry(p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;
  update backups
    set status = 'PENDING', error_message = null, started_at = null, completed_at = null, retry_count = 0
  where id = p_backup_id and status in ('FAILED', 'PARTIAL');
  if not found then raise exception 'لا يمكن إعادة المحاولة — الحالة الحالية غير مسموح بها'; end if;
end;
$$;

grant execute on function admin_backup_reset_for_retry(uuid) to authenticated;

-- حذف نسخة (يدوي): لا يُسمح بحذف آخر نسخة ناجحة أو النسخة الوحيدة المتبقية
create or replace function admin_delete_backup(p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row backups;
  v_success_count integer;
  v_latest_success uuid;
  v_path text;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;

  select * into v_row from backups where id = p_backup_id;
  if v_row.id is null then raise exception 'النسخة غير موجودة'; end if;

  select count(*),
    (select id from backups where status in ('SUCCESS', 'PARTIAL') order by created_at desc limit 1)
  into v_success_count, v_latest_success
  from backups where status in ('SUCCESS', 'PARTIAL');

  if v_row.status in ('SUCCESS', 'PARTIAL') then
    if v_success_count <= 1 then
      raise exception 'لا يمكن حذف آخر نسخة متبقية — احتفظ بنسخة واحدة على الأقل للاسترداد';
    end if;
    if v_latest_success = p_backup_id then
      raise exception 'لا يمكن حذف أحدث نسخة ناجحة — احذف نسخة أقدم أو أنشئ نسخة جديدة أولاً';
    end if;
  end if;
  if v_row.status = 'RUNNING' then
    raise exception 'لا يمكن حذف نسخة قيد التشغيل';
  end if;

  v_path := v_row.file_path;

  delete from backups where id = p_backup_id;

  begin
    if v_path is not null then
      delete from storage.objects where bucket_id = 'admin-backups' and name = v_path;
    end if;
  exception when others then
    raise warning 'backup file deletion failed (ignored): %', sqlerrm;
  end;

  insert into admin_audit_logs (admin_user_id, action, details, metadata)
  values (auth.uid(), 'backup_deleted', 'حذف نسخة احتياطية: ' || coalesce(v_row.file_name, v_row.id::text),
          jsonb_build_object('backup_id', p_backup_id, 'file_size', v_row.file_size));
end;
$$;

grant execute on function admin_delete_backup(uuid) to authenticated;

-- سياسة الاحتفاظ: احذف الأقدم بعد تجاوز العدد، مع حماية دائمة لآخر نسخة ناجحة
create or replace function admin_backup_apply_retention()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retention integer;
  v_ids uuid[];
  v_id uuid;
  v_path text;
begin
  select greatest(coalesce(retention_count, 12), 1) into v_retention from backup_settings where id = 1;
  if v_retention is null then v_retention := 12; end if;

  with keep as (
    select id from backups
    where status in ('SUCCESS', 'PARTIAL')
    order by created_at desc
    limit v_retention
  )
  select array_agg(id) into v_ids
  from backups b
  where b.status in ('SUCCESS', 'PARTIAL')
    and b.id not in (select id from keep)
    and b.id <> (select id from backups where status in ('SUCCESS', 'PARTIAL') order by created_at desc limit 1);

  if v_ids is null or array_length(v_ids, 1) = 0 then return 0; end if;

  foreach v_id in array v_ids loop
    select file_path into v_path from backups where id = v_id;
    insert into admin_audit_logs (admin_user_id, action, details, metadata)
    values (null, 'backup_deleted_retention', 'حذف تلقائي وفق سياسة الاحتفاظ (' || v_retention || ' نسخة)',
            jsonb_build_object('backup_id', v_id, 'file_path', v_path));
    delete from backups where id = v_id;
    begin
      if v_path is not null then
        delete from storage.objects where bucket_id = 'admin-backups' and name = v_path;
      end if;
    exception when others then
      raise warning 'retention file deletion failed (ignored): %', sqlerrm;
    end;
  end loop;

  return array_length(v_ids, 1);
end;
$$;

-- ----------------------------------------------------------------------------
-- 12) الاستعادة (Restore) — استعادة انتقائية آمنة بدون أي حذف
-- ----------------------------------------------------------------------------

-- جداول قابلة للاستعادة (قائمة بيضاء ثابتة داخل الدالة — لا تُقبل من العميل)
-- بالترتيب الصحيح للعلاقات: المجموعات ثم الحصص ثم الطلاب ثم بقية البيانات
create or replace function admin_restore_apply(
  p_backup_id uuid,
  p_teacher_id uuid,
  p_rows jsonb,
  p_strategy text default 'skip'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tables constant text[] := array[
    'groups', 'lesson_sessions', 'students', 'attendance_records', 'behavior_logs',
    'homework_tasks', 'student_payments', 'announcements', 'exams', 'exam_scores',
    'student_notifications', 'student_qr_tokens', 'report_templates', 'group_schedule',
    'session_logs', 'feature_unlocks', 'qb_questions', 'qb_exams', 'teacher_settings'
  ];
  v_table text;
  v_row jsonb;
  v_id uuid;
  v_row_id text;
  v_exists boolean;
  v_cols text[];
  v_set_clause text;
  v_col text;
  v_result jsonb := '{}'::jsonb;
  v_summary jsonb;
  v_json_value text;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;
  if p_strategy not in ('skip', 'overwrite') then raise exception 'استراتيجية غير صحيحة (skip أو overwrite)'; end if;
  if not exists (select 1 from profiles where id = p_teacher_id) then
    raise exception 'المستخدم المستهدف غير موجود';
  end if;
  if not exists (select 1 from backups where id = p_backup_id) then
    raise exception('النسخة الاحتياطية غير موجودة');
  end if;

  foreach v_table in array v_tables loop
    if p_rows ? v_table and jsonb_typeof(p_rows->v_table) = 'array' then
      v_summary := jsonb_build_object('inserted', 0, 'updated', 0, 'skipped_existing', 0, 'rejected', 0, 'errors', 0, 'error_messages', '[]'::jsonb);

      for v_row in select * from jsonb_array_elements(p_rows->v_table) loop
        begin
          -- حماية أساسية: أي صف يخص مدرّساً آخر يُرفض نهائياً
          if v_row ? 'teacher_id' and v_row->>'teacher_id' is not null
             and v_row->>'teacher_id' <> p_teacher_id::text then
            v_summary := jsonb_set(v_summary, '{rejected}', to_jsonb((v_summary->>'rejected')::int + 1));
            continue;
          end if;

          v_row_id := v_row->>'id';
          v_id := null;
          if v_row_id is not null then
            begin
              v_id := v_row_id::uuid;
            exception when others then
              v_id := null;
            end;
          end if;

          execute format('select exists (select 1 from public.%I where id = $1)', v_table) into v_exists using v_id;

          if v_exists then
            if p_strategy = 'overwrite' then
              -- تحديث الأعمدة الموجودة في الصف فقط (باستثناء id)
              select array_agg(key) into v_cols
              from jsonb_object_keys(v_row) key
              where key <> 'id' and not (key = 'teacher_id');
              if v_cols is not null then
                v_set_clause := '';
                foreach v_col in array v_cols loop
                  if v_set_clause <> '' then v_set_clause := v_set_clause || ', '; end if;
                  v_set_clause := v_set_clause || format('%I = src.%I', v_col, v_col);
                end loop;
                v_json_value := v_row::text;
                execute format(
                  'update public.%I set %s from (select * from jsonb_populate_record(null::public.%I, $1)) as src where public.%I.id = $2',
                  v_table, v_set_clause, v_table, v_table
                ) using v_json_value::jsonb, v_id;
              end if;
              v_summary := jsonb_set(v_summary, '{updated}', to_jsonb((v_summary->>'updated')::int + 1));
            else
              v_summary := jsonb_set(v_summary, '{skipped_existing}', to_jsonb((v_summary->>'skipped_existing')::int + 1));
            end if;
          else
            execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', v_table, v_table)
              using v_row;
            v_summary := jsonb_set(v_summary, '{inserted}', to_jsonb((v_summary->>'inserted')::int + 1));
          end if;
        exception when others then
          v_summary := jsonb_set(v_summary, '{errors}', to_jsonb((v_summary->>'errors')::int + 1));
          v_summary := jsonb_set(v_summary, '{error_messages}',
            (v_summary->'error_messages') || to_jsonb(left(sqlerrm, 200)));
        end;
      end loop;

      v_result := v_result || jsonb_build_object(v_table, v_summary);
    end if;
  end loop;

  insert into admin_audit_logs (admin_user_id, target_user_id, action, reason, details, metadata)
  values (auth.uid(), p_teacher_id, 'restore_applied', 'استعادة بيانات من نسخة احتياطية',
          'استعادة انتقائية — الاستراتيجية: ' || p_strategy,
          jsonb_build_object('backup_id', p_backup_id, 'strategy', p_strategy, 'result', v_result));

  return v_result;
end;
$$;

grant execute on function admin_restore_apply(uuid, uuid, jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 13) إعدادات المجدول (قابلة للتغيير من لوحة الأدمن)
-- ----------------------------------------------------------------------------
create or replace function admin_set_backup_schedule(
  p_enabled boolean default null,
  p_day_of_week smallint default null,
  p_hour smallint default null,
  p_retention_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row backup_settings;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;

  if p_day_of_week is not null and (p_day_of_week < 0 or p_day_of_week > 6) then
    raise exception 'رقم اليوم غير صحيح (0=الأحد .. 6=السبت)';
  end if;
  if p_hour is not null and (p_hour < 0 or p_hour > 23) then
    raise exception 'الساعة غير صحيحة (0-23)';
  end if;
  if p_retention_count is not null and p_retention_count < 1 then
    raise exception 'الاحتفاظ يجب أن يكون نسخة واحدة على الأقل';
  end if;

  update backup_settings set
    schedule_enabled = coalesce(p_enabled, schedule_enabled),
    backup_day_of_week = coalesce(p_day_of_week, backup_day_of_week),
    backup_hour = coalesce(p_hour, backup_hour),
    retention_count = coalesce(p_retention_count, retention_count),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1;

  select * into v_row from backup_settings where id = 1;

  insert into admin_audit_logs (admin_user_id, action, details, metadata)
  values (auth.uid(), 'backup_schedule_updated', 'تحديث إعدادات النسخ الاحتياطي',
          jsonb_build_object('enabled', v_row.schedule_enabled, 'day', v_row.backup_day_of_week,
                             'hour', v_row.backup_hour, 'retention', v_row.retention_count));

  return jsonb_build_object(
    'schedule_enabled', v_row.schedule_enabled,
    'backup_day_of_week', v_row.backup_day_of_week,
    'backup_hour', v_row.backup_hour,
    'timezone', v_row.timezone,
    'retention_count', v_row.retention_count,
    'auto_retry_max', v_row.auto_retry_max
  );
end;
$$;

grant execute on function admin_set_backup_schedule(boolean, smallint, smallint, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 14) مشغّل التدقيق التلقائي: يسجّل كل عمليات الكتابة أثناء جلسة وصول الدعم
--     (يظل صامتاً تماماً في التشغيل العادي — فحص واحد مفهرس لكل عملية كتابة)
-- ----------------------------------------------------------------------------
create or replace function audit_support_mode_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session admin_support_sessions;
begin
  begin
    select * into v_session from admin_support_sessions
    where admin_user_id = auth.uid() and status = 'active' and expires_at > now()
    order by started_at desc limit 1;

    if v_session.id is null then
      return coalesce(new, old);
    end if;

    insert into admin_audit_logs (admin_user_id, target_user_id, action, details, metadata, support_session_id)
    values (
      v_session.admin_user_id,
      v_session.target_user_id,
      'support_' || lower(TG_OP) || '_' || TG_TABLE_NAME::text,
      case TG_OP
        when 'INSERT' then 'إضافة صف في ' || TG_TABLE_NAME::text
        when 'UPDATE' then 'تعديل صف في ' || TG_TABLE_NAME::text
        else 'حذف صف في ' || TG_TABLE_NAME::text
      end,
      jsonb_build_object(
        'table', TG_TABLE_NAME::text,
        'operation', TG_OP,
        'row_id', coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id')
      ),
      v_session.id
    );
  exception when others then
    raise warning 'audit_support_mode_write failed: %', sqlerrm;
  end;
  return coalesce(new, old);
end;
$$;

do $$
declare
  v_table text;
  v_tables constant text[] := array[
    'students', 'groups', 'attendance_records', 'behavior_logs', 'lesson_sessions',
    'homework_tasks', 'student_payments', 'announcements', 'exams', 'exam_scores'
  ];
begin
  foreach v_table in array v_tables loop
    begin
      execute format('drop trigger if exists trg_support_audit_%1$s on public.%1$s', v_table);
      execute format(
        'create trigger trg_support_audit_%1$s
         after insert or update or delete on public.%1$s
         for each row execute function audit_support_mode_write()', v_table);
    exception when others then
      raise notice 'support audit trigger skipped for %: %', v_table, sqlerrm;
    end;
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 15) المجدول الأسبوعي (الجمعة 22:00 بتوقيت القاهرة افتراضياً)
--     pg_cron يعمل بتوقيت UTC، لذلك يشغّل الدالة كل ساعة وهي نفسها تتحقق
--     من "هل نحن الآن في نافذة الجمعة 22:00 بتوقيت Africa/Cairo؟" —
--     هذا يتعامل تلقائياً مع أي تغيير في التوقيت الصيفي/الشتوي لمصر.
-- ----------------------------------------------------------------------------

-- إرسال أمر التنفيذ إلى Edge Function (نفس نمط migration_033 المجرب)
create or replace function dispatch_backup_edge(p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_request_id bigint;
begin
  select net.http_post(
    url := 'https://pbsythpzncjoafpmijyd.supabase.co/functions/v1/admin-backup',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('action', 'scheduled', 'backupId', p_backup_id)
  ) into v_request_id;
exception when others then
  raise warning 'dispatch_backup_edge failed: %', sqlerrm;
end;
$$;

-- نقطة دخول المجدول (كل ساعة)
create or replace function scheduled_backup_fire()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings backup_settings;
  v_dow int;
  v_hour int;
  v_backup_id uuid;
  v_stale_id uuid;
begin
  begin
    select * into v_settings from backup_settings where id = 1;
    if v_settings.id is null or not v_settings.schedule_enabled then
      return;
    end if;

    -- 1) إعادة إرسال النسخ المعلّقة (PENDING) الأقدم من 10 دقائق — إعادة محاولة تلقائية
    for v_stale_id in
      select id from backups
      where status = 'PENDING'
        and created_at < now() - interval '10 minutes'
        and retry_count < v_settings.auto_retry_max
      order by created_at asc
    loop
      update backups set retry_count = retry_count + 1 where id = v_stale_id;
      perform dispatch_backup_edge(v_stale_id);
    end loop;

    -- 2) أي نسخة معلّقة تجاوزت حد المحاولات → FAILED مع تنبيه إداري
    update backups
      set status = 'FAILED', completed_at = now(),
          error_message = 'تجاوز الحد الأقصى للمحاولات التلقائية (' || v_settings.auto_retry_max || ')'
      where status = 'PENDING' and retry_count >= v_settings.auto_retry_max;
    if found then
      insert into admin_activity_log (admin_id, target_teacher_id, action, details)
      values (null, null, 'backup_failed', 'فشل النسخة الاحتياطية الأسبوعية تلقائياً بعد استنفاد المحاولات — أعد المحاولة من لوحة الأدمن');
    end if;

    -- 3) هل نحن داخل نافذة الموعد الأسبوعي (بتوقيت القاهرة)؟
    select extract(dow from (now() at time zone v_settings.timezone))::int,
           extract(hour from (now() at time zone v_settings.timezone))::int
      into v_dow, v_hour;

    if v_dow <> v_settings.backup_day_of_week or v_hour <> v_settings.backup_hour then
      return;
    end if;

    -- 4) مرة واحدة أسبوعياً على الأكثر
    if exists (
      select 1 from backups
      where backup_type = 'weekly' and status in ('SUCCESS', 'PARTIAL', 'RUNNING', 'PENDING')
        and created_at > now() - interval '6 days'
    ) then
      return;
    end if;

    -- 5) إنشاء النسخة وإرسالها للتنفيذ
    insert into backups (backup_type, status) values ('weekly', 'PENDING') returning id into v_backup_id;
    perform dispatch_backup_edge(v_backup_id);
  exception when others then
    raise warning 'scheduled_backup_fire failed: %', sqlerrm;
  end;
end;
$$;

-- تفعيل pg_cron + تسجيل المهمة كل ساعة
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    raise notice 'pg_cron غير متاح (%). شغّله من Supabase Dashboard → Database → Extensions ثم أعد تشغيل هذا القسم الأخير فقط.', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('nokhba-backup-hourly');
    exception when others then
      null; -- المهمة غير مسجلة بعد — هذا طبيعي في أول تشغيل
    end;
    perform cron.schedule('nokhba-backup-hourly', '0 * * * *', 'select public.scheduled_backup_fire();');
    raise notice 'تم تسجيل المجدول: nokhba-backup-hourly (كل ساعة، والتنفيذ الفعلي في نافذة الجمعة 22:00 بتوقيت القاهرة)';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 16) سياسات قراءة إضافية لوصول الدعم على الجداول ذات السياسات الخاصة
--     (سياسات SELECT فقط، إضافية — لا تمس السياسات القائمة وتُدمج معها بـ OR)
--     الجداول الأساسية (students/groups/attendance/...) مغطاة بالفعل عبر
--     can_access_workspace المعرفة أعلاه.
-- ----------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_tables constant text[] := array[
    'lesson_sessions', 'homework_tasks', 'announcements', 'student_notifications',
    'student_payments', 'report_templates', 'feature_unlocks', 'qb_questions', 'qb_exams'
  ];
  v_has_teacher_col boolean;
begin
  foreach v_table in array v_tables loop
    begin
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = v_table and column_name = 'teacher_id'
      ) into v_has_teacher_col;

      if v_has_teacher_col then
        execute format('drop policy if exists "support_read_%1$s" on public.%1$s', v_table);
        execute format(
          'create policy "support_read_%1$s" on public.%1$s
           for select using (
             exists (
               select 1 from admin_support_sessions
               where admin_user_id = auth.uid()
                 and target_user_id = public.%1$s.teacher_id
                 and status = ''active''
                 and expires_at > now()
             )
           )', v_table);
      else
        raise notice 'skip support_read_% (no teacher_id column)', v_table;
      end if;
    exception when others then
      raise notice 'support_read_% skipped: %', v_table, sqlerrm;
    end;
  end loop;
end
$$;


-- معلومات النظام لورقة Backup Info داخل ملف الإكسل
create or replace function admin_db_info()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'postgres_version', current_setting('server_version'),
    'database', current_database(),
    'schema_version', '036'
  );
$$;

grant execute on function admin_db_info() to authenticated;

-- ============================================================================
-- نهاية Migration 036
-- ملاحظات النشر:
--   • شغّل هذا الملف كاملاً في Supabase → SQL Editor → Run (آمن لإعادة التشغيل).
--   • انشر Edge Function الجديدة admin-backup (مجلد functions/admin-backup).
--   • المجدول يعمل تلقائياً بعد تفعيل pg_cron (القسم 15 يفعّله ويضيفه).
-- ============================================================================
