-- ============================================================================
-- نظام النخبة — Migration 008: دمج حسابات (مدرّس + مساعد) على نفس البيانات
-- ============================================================================
-- الفكرة: حساب "مساعد" بينضم لمساحة عمل مدرّس معيّن، ويشتغل على نفس بياناته
-- (نفس teacher_id في كل الجداول)، وبيركب على نفس اشتراك المدرّس صاحب الحساب —
-- من غير ما نغيّر شكل أي جدول بيانات موجود، بس بنوسّع شرط الوصول (RLS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) جدول الأعضاء: كل مساعد مرتبط بمالك واحد بس
-- ----------------------------------------------------------------------------
create table if not exists workspace_members (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references profiles(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade unique,
  role text not null default 'assistant' check (role in ('assistant')),
  created_at timestamptz not null default now(),
  check (owner_id <> member_id)
);

alter table workspace_members enable row level security;

create policy "workspace_owner_manage" on workspace_members
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "workspace_member_read_own" on workspace_members
  for select using (auth.uid() = member_id);

-- ----------------------------------------------------------------------------
-- 2) دالة تربط مساعد بمالك عن طريق الإيميل (يستخدمها المدرّس نفسه من إعداداته)
-- ----------------------------------------------------------------------------
create or replace function link_assistant_by_email(assistant_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  select id into target_id from auth.users where email = assistant_email;
  if target_id is null then
    raise exception 'لا يوجد حساب مسجّل بهذا الإيميل';
  end if;
  if target_id = auth.uid() then
    raise exception 'مينفعش تربط حسابك بنفسه';
  end if;
  insert into workspace_members (owner_id, member_id)
  values (auth.uid(), target_id)
  on conflict (member_id) do update set owner_id = excluded.owner_id;
end;
$$;

grant execute on function link_assistant_by_email(text) to authenticated;

-- دالة يستخدمها التطبيق لمعرفة هل المستخدم الحالي مساعد عند حد، ومين هو
create or replace function my_workspace_owner()
returns uuid
language sql
security definer
set search_path = public
as $$
  select owner_id from workspace_members where member_id = auth.uid();
$$;

grant execute on function my_workspace_owner() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) دالة وصول موحّدة: صاحب البيانات نفسه، أو مساعد مربوط بيه، وبشرط اشتراك
--    صاحب البيانات (مش اشتراك المساعد) يكون سارٍ
-- ----------------------------------------------------------------------------
create or replace function can_access_workspace(check_teacher uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select (
      auth.uid() = check_teacher
      or exists (select 1 from workspace_members where owner_id = check_teacher and member_id = auth.uid())
    )
    and exists (
      select 1 from profiles
      where id = check_teacher
        and subscription_status in ('trial', 'active')
        and subscription_expires_at > now()
    );
$$;

grant execute on function can_access_workspace(uuid) to authenticated;

-- يسمح للمساعد بقراءة بروفايل صاحب مساحة العمل بس (عشان يعرف حالة الاشتراك واسمه)
create policy "profiles_read_as_assistant" on profiles
  for select using (
    exists (select 1 from workspace_members where owner_id = profiles.id and member_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 4) إعادة كتابة كل سياسات الوصول لتستخدم can_access_workspace بدل الشرط القديم
-- ----------------------------------------------------------------------------
drop policy if exists "groups_teacher_access" on groups;
create policy "groups_workspace_access" on groups
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "students_teacher_access" on students;
create policy "students_workspace_access" on students
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "attendance_teacher_access" on attendance_records;
create policy "attendance_workspace_access" on attendance_records
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "behavior_teacher_access" on behavior_logs;
create policy "behavior_workspace_access" on behavior_logs
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "settings_teacher_access" on teacher_settings;
create policy "settings_workspace_access" on teacher_settings
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "exams_teacher_access" on exams;
create policy "exams_workspace_access" on exams
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "exam_scores_teacher_access" on exam_scores;
create policy "exam_scores_workspace_access" on exam_scores
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "session_logs_teacher_access" on session_logs;
create policy "session_logs_workspace_access" on session_logs
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));

drop policy if exists "group_schedule_teacher_access" on group_schedule;
create policy "group_schedule_workspace_access" on group_schedule
  for all using (can_access_workspace(teacher_id)) with check (can_access_workspace(teacher_id));
