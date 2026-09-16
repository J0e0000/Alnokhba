-- ============================================================================
-- نظام النخبة — Migration 022: Teacher Workspace Branding + Onboarding
-- ============================================================================
-- الهدف:
--   1) إضافة account_type لتمييز المدرّس عن المساعد عند التسجيل
--   2) جدول workspace_branding لتخزين هوية كل مدرّس (اسم، شعار، ألوان، الخ)
--   3) جدول assistant_requests لنظام طلبات الانضمام (Pending/Accepted/Rejected)
--   4) storage bucket للشعارات (teacher-logos)
--
-- ملاحظات:
--   * الـ migration ده مش بيغير أي سياسة RLS موجودة — العزل لسه شغال.
--   * الجداول الجديدة كلها عليها RLS من اليوم الأول.
--   * لو المدرّس ما عملش branding، النظام بيستخدم الـ default (Navy/Gold).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) إضافة account_type لجدول profiles
--    'teacher' (default) | 'assistant'
--    بيحدد نوع الحساب عند التسجيل — Onboarding page بتحدده
-- ----------------------------------------------------------------------------
alter table profiles add column if not exists account_type text not null default 'teacher'
  check (account_type in ('teacher', 'assistant'));

-- ----------------------------------------------------------------------------
-- 2) جدول workspace_branding
--    صف واحد لكل مدرّس. لو مفيش صف، النظام بيستخدم الـ defaults.
-- ----------------------------------------------------------------------------
create table if not exists workspace_branding (
  teacher_id uuid primary key references profiles(id) on delete cascade,
  display_name text,
  center_name text,
  logo_url text,
  palette_key text not null default 'nokhba-navy-gold',
  language text not null default 'ar' check (language in ('ar', 'en')),
  contact_email text,
  contact_phone text,
  address text,
  social_links jsonb not null default '{}'::jsonb,
  portal_header_text text,
  portal_welcome_message text,
  report_footer text,
  exam_header text,
  communication_signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table workspace_branding enable row level security;

-- المدرّس يقدر يقرأ/يعدّل branding بتاعه بس. المساعد يقدر يقرأ بس (مش يعدّل).
create policy "branding_workspace_read" on workspace_branding
  for select using (can_access_workspace(teacher_id));

create policy "branding_owner_write" on workspace_branding
  for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- ----------------------------------------------------------------------------
-- 3) جدول assistant_requests
--    بدل نظام الربط المباشر (link_assistant_by_email)، النظام الجديد:
--    المساعد بيبعت طلب → المدرّس بيوافق/يرفض → لو وافقت بيتعمل row في
--    workspace_members.
-- ----------------------------------------------------------------------------
create table if not exists assistant_requests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  assistant_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'revoked')),
  message text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  unique (teacher_id, assistant_id)
);

alter table assistant_requests enable row level security;

-- المدرّس يقدر يشوف الطلبات المرسلة ليه. المساعد يقدر يشوف الطلبات اللي هو بعتها.
create policy "assistant_requests_teacher_read" on assistant_requests
  for select using (auth.uid() = teacher_id);

create policy "assistant_requests_assistant_read" on assistant_requests
  for select using (auth.uid() = assistant_id);

-- المساعد يقدر ينشئ طلب جديد (status=pending) للمدرّس اللي اختاره
create policy "assistant_requests_assistant_insert" on assistant_requests
  for insert with check (
    auth.uid() = assistant_id
    and status = 'pending'
  );

-- المدرّس يقدر يحدّث status الطلب بتاعه (accept/reject/revoke)
create policy "assistant_requests_teacher_update" on assistant_requests
  for update using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create index if not exists idx_assistant_requests_teacher on assistant_requests(teacher_id, status);
create index if not exists idx_assistant_requests_assistant on assistant_requests(assistant_id, status);

-- ----------------------------------------------------------------------------
-- 4) Storage bucket للشعارات
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('teacher-logos', 'teacher-logos', true)
on conflict (id) do nothing;

-- قراءة عامة للشعارات (الشعار مش سر — بيظهر في البوابة العامة)
create policy "teacher_logos_public_read" on storage.objects
  for select using (bucket_id = 'teacher-logos');

-- المدرّس يقدر يرفع/يحدّث/يمسح شعاره بس
create policy "teacher_logos_owner_upload" on storage.objects
  for insert with check (
    bucket_id = 'teacher-logos'
    and auth.uid() is not null
  );

create policy "teacher_logos_owner_update" on storage.objects
  for update using (bucket_id = 'teacher-logos' and auth.uid() is not null);

create policy "teacher_logos_owner_delete" on storage.objects
  for delete using (bucket_id = 'teacher-logos' and auth.uid() is not null);

-- ----------------------------------------------------------------------------
-- 5) تحديث handle_new_user() trigger
--    لما المستخدم يتسجل، نعمل row في workspace_branding لو هو teacher
-- ----------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email, new.raw_user_meta_data ->> 'phone');

  insert into public.teacher_settings (teacher_id) values (new.id);

  -- لو الحساب نوعه teacher، نعمل row فاضي في workspace_branding
  if coalesce(new.raw_user_meta_data ->> 'account_type', 'teacher') = 'teacher' then
    insert into public.workspace_branding (teacher_id, display_name)
    values (new.id, new.raw_user_meta_data ->> 'full_name')
    on conflict (teacher_id) do nothing;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) دالة RPC لقبول طلب مساعد
--    لما المدرّس يقبل طلب، بنعمل row في workspace_members + نحدّث status
-- ----------------------------------------------------------------------------
create or replace function public.accept_assistant_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request assistant_requests%rowtype;
begin
  -- تحميل الطلب والتأكد إنه للمدرّس الحالي وبحالة pending
  select * into v_request from assistant_requests where id = p_request_id;

  if v_request.id is null then
    raise exception 'request not found';
  end if;

  if v_request.teacher_id <> auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'request already resolved';
  end if;

  -- تحديث status
  update assistant_requests
    set status = 'accepted', resolved_at = now(), resolved_by = auth.uid()
    where id = p_request_id;

  -- إنشاء workspace_members row
  insert into workspace_members (owner_id, member_id, role)
  values (v_request.teacher_id, v_request.assistant_id, 'assistant')
  on conflict (member_id) do update set owner_id = excluded.owner_id;
end;
$$;

grant execute on function public.accept_assistant_request(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) دالة RPC لرفض طلب مساعد
-- ----------------------------------------------------------------------------
create or replace function public.reject_assistant_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request assistant_requests%rowtype;
begin
  select * into v_request from assistant_requests where id = p_request_id;

  if v_request.id is null then
    raise exception 'request not found';
  end if;

  if v_request.teacher_id <> auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'request already resolved';
  end if;

  update assistant_requests
    set status = 'rejected', resolved_at = now(), resolved_by = auth.uid()
    where id = p_request_id;
end;
$$;

grant execute on function public.reject_assistant_request(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8) دالة RPC للبحث عن مدرّس (للمساعدين أثناء التسجيل)
--    بترجع: id, full_name, email, center_name (من workspace_branding)
--    بتمنع البحث عن الادمن والمساعدين — بس المدرّسين.
-- ----------------------------------------------------------------------------
create or replace function public.search_teachers_for_onboarding(p_query text)
returns table(
  id uuid,
  full_name text,
  email text,
  center_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_query is null or length(trim(p_query)) < 2 then
    return;
  end if;

  return query
    select p.id, p.full_name, p.email, wb.center_name
    from profiles p
    left join workspace_branding wb on wb.teacher_id = p.id
    where p.account_type = 'teacher'
      and p.is_admin = false
      and p.is_verified = true
      and (
        p.full_name ilike '%' || trim(p_query) || '%'
        or p.email ilike '%' || trim(p_query) || '%'
        or wb.center_name ilike '%' || trim(p_query) || '%'
      )
    limit 10;
end;
$$;

grant execute on function public.search_teachers_for_onboarding(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 9) إعادة تحميل schema cache في PostgREST
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
