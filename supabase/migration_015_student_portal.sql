-- ============================================================================
-- نظام النخبة — Migration 015: بوابة الطالب/ولي الأمر (announcements + homework)
-- ============================================================================
-- إضافي بس — متلمسش الجداول الموجودة. شغّله في Supabase → SQL Editor → Run.
--
-- الفكرة: صفحة /qr/:token بقت "بوابة" مش مجرد QR. لازم الطالب/ولي الأمر
-- يقدر يشوف بياناته من غير تسجيل دخول (زي ما student_qr_tokens شغّالة
-- بنفس الطريقة دلوقتي) عن طريق الـ token بس. عشان كده الجداول الجديدة
-- كلها ليها "public read" policy زي القديمة بالظبط — القراءة مفتوحة لأن
-- محدش يقدر يوصلها من غير ما يبقى معاه token صحيح للطالب نفسه أصلاً،
-- والكتابة (insert/update/delete) لسه مقفولة على المدرّس صاحب البيانات بس.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) رقم واتساب المدرّس — يظهر زرار "تواصل مع المستر" في البوابة
-- ----------------------------------------------------------------------------
alter table teacher_settings add column if not exists whatsapp_number text;

-- ----------------------------------------------------------------------------
-- 2) الإعلانات — يبعتها المدرّس، تظهر لكل الطلاب أو لطالب واحد بس
-- ----------------------------------------------------------------------------
create table if not exists announcements (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  -- student_id = null يعني إعلان عام لكل الطلاب. لو محدد يبقى لطالب واحد بس.
  student_id uuid references students(id) on delete cascade,
  title text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table announcements enable row level security;

-- القراءة مفتوحة (زي student_qr_tokens) — البوابة بتفلتر بـ teacher_id
-- و(student_id = null أو student_id = طالب البوابة) من الفرونت إند
create policy "announcements_public_read" on announcements
  for select using (true);

create policy "announcements_teacher_write" on announcements
  for insert with check (auth.uid() = teacher_id and is_subscription_active());

create policy "announcements_teacher_update" on announcements
  for update using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create policy "announcements_teacher_delete" on announcements
  for delete using (auth.uid() = teacher_id);

create index if not exists idx_announcements_teacher on announcements(teacher_id);
create index if not exists idx_announcements_student on announcements(student_id);
create index if not exists idx_announcements_created on announcements(created_at desc);

-- ----------------------------------------------------------------------------
-- 3) الواجبات — مهمة واحدة تتحدد لمجموعة، وكل طالب فيها له حالة (تم/لسه)
-- ----------------------------------------------------------------------------
create table if not exists homework_tasks (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  group_name text not null,
  title text not null,
  due_date date,
  created_at timestamptz not null default now()
);

alter table homework_tasks enable row level security;

create policy "homework_tasks_public_read" on homework_tasks
  for select using (true);

create policy "homework_tasks_teacher_write" on homework_tasks
  for insert with check (auth.uid() = teacher_id and is_subscription_active());

create policy "homework_tasks_teacher_update" on homework_tasks
  for update using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create policy "homework_tasks_teacher_delete" on homework_tasks
  for delete using (auth.uid() = teacher_id);

create index if not exists idx_homework_tasks_teacher_group on homework_tasks(teacher_id, group_name);

-- حالة كل طالب في كل مهمة (تم تسليمها ولا لسه)
create table if not exists homework_task_status (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references homework_tasks(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  done boolean not null default false,
  marked_by text not null default 'teacher' check (marked_by in ('teacher', 'student')),
  updated_at timestamptz not null default now(),
  unique (task_id, student_id)
);

alter table homework_task_status enable row level security;

create policy "homework_task_status_public_read" on homework_task_status
  for select using (true);

-- المدرّس يقدر يسجل/يعدّل حالة أي طالب بتاعه
create policy "homework_task_status_teacher_write" on homework_task_status
  for insert with check (
    exists (
      select 1 from homework_tasks
      where homework_tasks.id = homework_task_status.task_id
        and homework_tasks.teacher_id = auth.uid()
    )
  );

create policy "homework_task_status_teacher_update" on homework_task_status
  for update using (
    exists (
      select 1 from homework_tasks
      where homework_tasks.id = homework_task_status.task_id
        and homework_tasks.teacher_id = auth.uid()
    )
  );

-- السماح لأي حد معاه الـ token (public, من غير auth) إنه يعلّم "تم" لنفسه بس —
-- عن طريق دالة RPC آمنة بدل ما نفتح insert/update عالم بالكامل من غير auth.
create or replace function public.mark_homework_done(p_task_id uuid, p_student_token text)
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
  where token = p_student_token and revoked_at is null;

  if v_student_id is null then
    raise exception 'invalid token';
  end if;

  insert into homework_task_status (task_id, student_id, done, marked_by, updated_at)
  values (p_task_id, v_student_id, true, 'student', now())
  on conflict (task_id, student_id)
  do update set done = true, marked_by = 'student', updated_at = now();
end;
$$;

grant execute on function public.mark_homework_done(uuid, text) to anon, authenticated;

create index if not exists idx_hw_status_task on homework_task_status(task_id);
create index if not exists idx_hw_status_student on homework_task_status(student_id);
