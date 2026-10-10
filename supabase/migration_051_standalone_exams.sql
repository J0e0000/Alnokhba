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
