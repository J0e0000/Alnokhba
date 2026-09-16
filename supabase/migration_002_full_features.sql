-- ============================================================================
-- نظام الفارس — Migration 002: كل المميزات + صفحة الأدمن
-- ============================================================================
-- إضافي بس — متلمسش الجداول الموجودة، تقدر تشغله فوق قاعدة البيانات الحالية
-- من غير ما تعيد schema.sql تاني.
-- طريقة التشغيل: Supabase → SQL Editor → New query → الصق الملف كامل → Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) صلاحية الأدمن على البروفايل
-- ----------------------------------------------------------------------------
alter table profiles add column if not exists is_admin boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2) حقول إضافية على جدول الطلاب (الكود، الإنذارات، حالة الواجب)
-- ----------------------------------------------------------------------------
alter table students add column if not exists code text;
alter table students add column if not exists warnings integer not null default 0;
alter table students add column if not exists hw_status text not null default 'لم يرصد';
alter table students add column if not exists group_name text;
alter table students alter column attendance_status set default 'لم يرصد';

-- ----------------------------------------------------------------------------
-- 3) إعدادات كل مدرّس (المجموعات، قيم النقاط، الرتب، قوالب الرسائل)
--    صف واحد لكل مدرّس
-- ----------------------------------------------------------------------------
create table if not exists teacher_settings (
  teacher_id uuid primary key references profiles(id) on delete cascade,
  groups text[] not null default array['المجموعة الافتراضية'],
  points_interact integer not null default 3,
  points_interrupt integer not null default -3,
  points_present integer not null default 1,
  points_absent integer not null default -1,
  ranks jsonb not null default '[
    {"min":0,"title":"مبتدئ"},{"min":30,"title":"مستكشف"},{"min":60,"title":"طالب علم"},
    {"min":90,"title":"باحث"},{"min":120,"title":"فارس"},{"min":150,"title":"بطل"},
    {"min":180,"title":"عالم"},{"min":210,"title":"نابغة"},{"min":240,"title":"سيبويه"},
    {"min":270,"title":"المتنبي"}
  ]'::jsonb,
  msg_welcome text not null default 'أهلاً بك يا بطل في نظام الفارس للغة العربية 🛡️
استعد لرحلة التميز، يا {studentName}!',
  msg_warning text not null default '⚠️ تنبيه هام من أكاديمية الفارس:
يرجى الانتباه لمستوى الطالب {studentName}. نتمنى رؤية تحسن في الحصة القادمة.',
  msg_promotion text not null default '🎉 مبروك يا {studentName}!
لقد تم ترقيتك للرتبة الجديدة: {rank} 🛡️ استمر في الإبداع.'
);

-- ----------------------------------------------------------------------------
-- 4) الامتحانات: تعريف الامتحان + درجات كل طالب
-- ----------------------------------------------------------------------------
create table if not exists exams (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  sections text[] not null,
  max_score_per_section numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists exam_scores (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  exam_id uuid not null references exams(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  section_scores jsonb not null default '{}',
  total_score numeric not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security على الجداول الجديدة
-- ============================================================================
alter table teacher_settings enable row level security;
alter table exams enable row level security;
alter table exam_scores enable row level security;

create policy "settings_teacher_access" on teacher_settings
  for all using (auth.uid() = teacher_id and is_subscription_active())
  with check (auth.uid() = teacher_id and is_subscription_active());

create policy "exams_teacher_access" on exams
  for all using (auth.uid() = teacher_id and is_subscription_active())
  with check (auth.uid() = teacher_id and is_subscription_active());

create policy "exam_scores_teacher_access" on exam_scores
  for all using (auth.uid() = teacher_id and is_subscription_active())
  with check (auth.uid() = teacher_id and is_subscription_active());

-- ----------------------------------------------------------------------------
-- 5) صلاحيات الأدمن: يقدر يشوف/يعدّل بيانات الاشتراك بتاعة كل المدرّسين
--    (مقصودة تقتصر على الحسابات والاشتراكات فقط، مش بيانات طلاب أي مدرّس —
--    ده أنسب لخصوصية بيانات المدرّسين حتى منك كصاحب المنصة)
-- ----------------------------------------------------------------------------
create or replace function is_admin_user()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create policy "profiles_admin_read" on profiles
  for select using (is_admin_user());

create policy "profiles_admin_update" on profiles
  for update using (is_admin_user());

-- ----------------------------------------------------------------------------
-- 6) عند تسجيل مدرّس جديد، ننشئ له صف إعدادات افتراضي كمان
-- ----------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  insert into public.teacher_settings (teacher_id) values (new.id);
  return new;
end;
$$;
-- (التريجر نفسه اتعمل قبل كده في schema.sql، مش محتاجين نعيده)

-- ----------------------------------------------------------------------------
-- 7) لو عندك مدرّسين سجلوا قبل هذه الهجرة، أنشئ لهم صف إعدادات ينقصهم
-- ----------------------------------------------------------------------------
insert into teacher_settings (teacher_id)
select id from profiles
where id not in (select teacher_id from teacher_settings)
on conflict (teacher_id) do nothing;

-- ----------------------------------------------------------------------------
-- 8) فهارس
-- ----------------------------------------------------------------------------
create index if not exists idx_exams_teacher on exams(teacher_id);
create index if not exists idx_exam_scores_exam on exam_scores(exam_id);
create index if not exists idx_exam_scores_student on exam_scores(student_id);

-- ============================================================================
-- 9) اجعل حسابك أنت أدمن — استبدل الإيميل بإيميلك المسجّل به، وشغّل السطر ده
--    لوحده بعد كده (بعد ما تكون عملت حساب على المنصة بالفعل)
-- ============================================================================
-- update profiles set is_admin = true where email = 'your-email@example.com';
