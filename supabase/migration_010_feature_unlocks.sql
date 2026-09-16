-- ============================================================================
-- نظام النخبة — Migration 010: نظام قفل/فتح مميزات إضافية (يبدأ بالألعاب)
-- ============================================================================
-- فكرة عامة قابلة لإعادة الاستخدام: أي ميزة إضافية (زي الألعاب دلوقتي، أو أي
-- إضافة تانية بعدين) بتتفعّل للمدرّس من الأدمن بس، منفصلة عن الاشتراك الأساسي.
-- ============================================================================

create table if not exists feature_unlocks (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  feature_key text not null,
  unlocked boolean not null default false,
  unlocked_at timestamptz,
  unique (teacher_id, feature_key)
);

alter table feature_unlocks enable row level security;

-- صاحب البيانات أو مساعده يقدر يشوف حالة القفل بتاعته، والأدمن يشوف الكل
create policy "feature_unlocks_read" on feature_unlocks
  for select using (can_access_workspace(teacher_id) or is_admin_user());

-- الأدمن بس يقدر يفتح/يقفل
create policy "feature_unlocks_admin_insert" on feature_unlocks
  for insert with check (is_admin_user());

create policy "feature_unlocks_admin_update" on feature_unlocks
  for update using (is_admin_user());

create index if not exists idx_feature_unlocks_teacher on feature_unlocks(teacher_id);
