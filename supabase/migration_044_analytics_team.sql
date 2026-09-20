-- ============================================================================
-- Migration 044 — فريق التحليل: الذاكرة التحليلية الدائمة
-- (analytics_runs / analytics_reports / analytics_insights)
-- إعادة هيكلة تجربة التحليلات بالكامل — سبتمبر 2026
-- ============================================================================
-- التشغيل: Supabase Dashboard → SQL Editor → الصق الملف كامل → Run
-- الملف idempotent: آمن لإعادة التشغيل أكثر من مرة، ولا يمسح أو يعدّل أي بيانات قائمة.
--
-- ليه الجداول دي؟
--   قبل الملف ده، تحليل «فريق التحليل» كان محفوظًا في المتصفح فقط
--   (localStorage): آخر تقرير أسبوعي واحد لكل جهاز، بلا تاريخ، وبلا قدرة
--   يفهم النظام إن «الملاحظة دي اتقالت الأسبوع اللي فات ولا لأ».
--   التلات جداول دول بيحوّلوا التحليل لمنتج داخلي له ذاكرة:
--     • analytics_runs      — كل عملية تحليل (أسبوعي مجدول / استنتاج لحظي
--                             on-demand): إمتأخر، خد قد إيه، أنتج إيه.
--                             التطبيق بيقرأ آخر run عشان يحدد موعد
--                             التحليل الأسبوعي الجاي («آخر تحليل: منذ...»).
--     • analytics_reports   — التقرير المولّد من كل run: ملخص الحالة
--                             الحالية + حالة كل مجال (أكاديمي/حضور/
--                             واجبات/تشغيل) — بحدوده الزمنية.
--     • analytics_insights  — الاستنتاجات المادية فقط (بعد فلتر
--                             المادية materiality): مع دورة حياة كاملة
--                             (new/ongoing/worsening/improving/resolved/
--                             dismissed) وعلامة dedupe_key تمنع تكرار
--                             نفس الملاحظة كل أسبوع من غير تغيير،
--                             وevidence يحفظ الأرقام والحدود والمصادر
--                             اللي الاستنتاج طلع منها (قابل للتفسير
--                             والتتبع — مفيش استنتاج من الهوا).
--   الجداول تخزين نتائج تحليل مكتمل — مش بيانات حية — وده اللي بيسمح
--   بالكاش الآمن: التطبيق بيقرا النتائج المخزنة، والحساب التقيل بيحصل
--   مرة في الأسبوع (أو لما المدرّس يطلبه بنفسه).
--
-- الحماية:
--   • RLS مفعّل على التلاتة: المدرّس يكتب/يقرأ صفوفه فقط، وأعضاء فريق
--     العمل (المساعدون) عبر can_access_workspace — نفس نمط 042/043.
--     الاستنتاجات التحليلية محمية بنفس مستوى بيانات المصدر (RLS).
--   • runs/reports append-only: لا سياسات update/delete للمستخدمين.
--   • insights: update مسموح فقط لتغيير حالة دورة الحياة (dismiss/resolve/
--     تحديث الحالة) لنفس المدرّس — لا delete (تاريخ التحليل ما يتحوش؛
--     التنظيف عبر service-role فقط).
--   • كل استعلام في التطبيق بيفلتر teacher_id من الجلسة نفسها
--     (auth-derived) — تغيير أي ID في الطلب ما يكشفش بيانات مركز تاني.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) analytics_runs — سجل عمليات التحليل
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.analytics_runs (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  run_type text not null check (run_type in ('weekly', 'on_demand')),
  status text not null default 'completed' check (status in ('completed', 'failed')),
  scope text not null default 'teacher',
  period_start date,
  period_end date,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  findings_total integer not null default 0,
  insights_total integer not null default 0,
  meta jsonb not null default '{}'::jsonb
);

-- نمط الاستعلام الفعلي: «آخر تحليل أسبوعي emتى؟» + قائمة التاريخ التحليلي
create index if not exists idx_analytics_runs_teacher_completed
  on public.analytics_runs (teacher_id, completed_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) analytics_reports — التقارير المولّدة (الذاكرة التحليلية)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.analytics_reports (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.analytics_runs(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  analysis_type text not null check (analysis_type in ('weekly', 'on_demand')),
  period_start date,
  period_end date,
  generated_at timestamptz not null default now(),
  summary text,
  situation jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_analytics_reports_teacher_generated
  on public.analytics_reports (teacher_id, generated_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) analytics_insights — الاستنتاجات المادية + دورة الحياة
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.analytics_insights (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.analytics_reports(id) on delete cascade,
  run_id uuid references public.analytics_runs(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  dedupe_key text not null,
  category text not null,
  title text not null,
  description jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  impact text,
  severity text not null default 'watch' check (severity in ('needs-attention', 'watch')),
  status text not null default 'new' check (status in ('new', 'ongoing', 'worsening', 'improving', 'resolved', 'dismissed')),
  period_start date,
  period_end date,
  first_detected_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

-- «الاستنتاجات المفتوحة الحالية» — الاستعلام الأكثر تكرارًا في الشاشة
create index if not exists idx_analytics_insights_teacher_updated
  on public.analytics_insights (teacher_id, last_updated_at desc);

-- سلامة دورة الحياة: استنتاج واحد مفتوح فقط لكل (مدرّس، مفتاح) —
-- تاريخيًا ممكن يتكرر بعد الإغلاق (اتحل → ظهر تاني لاحقًا) وده مقصود.
create unique index if not exists uq_analytics_insights_open
  on public.analytics_insights (teacher_id, dedupe_key)
  where status not in ('resolved', 'dismissed');

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — نفس نمط can_access_workspace المستخدم في 042/043
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.analytics_runs enable row level security;
alter table public.analytics_reports enable row level security;
alter table public.analytics_insights enable row level security;

-- ── analytics_runs: append-only ──
drop policy if exists "analytics_runs_owner_insert" on public.analytics_runs;
create policy "analytics_runs_owner_insert" on public.analytics_runs
  for insert to authenticated with check (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

drop policy if exists "analytics_runs_owner_read" on public.analytics_runs;
create policy "analytics_runs_owner_read" on public.analytics_runs
  for select to authenticated using (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

-- ── analytics_reports: append-only ──
drop policy if exists "analytics_reports_owner_insert" on public.analytics_reports;
create policy "analytics_reports_owner_insert" on public.analytics_reports
  for insert to authenticated with check (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

drop policy if exists "analytics_reports_owner_read" on public.analytics_reports;
create policy "analytics_reports_owner_read" on public.analytics_reports
  for select to authenticated using (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

-- ── analytics_insights: insert + read + lifecycle-update فقط (بلا delete) ──
drop policy if exists "analytics_insights_owner_insert" on public.analytics_insights;
create policy "analytics_insights_owner_insert" on public.analytics_insights
  for insert to authenticated with check (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

drop policy if exists "analytics_insights_owner_read" on public.analytics_insights;
create policy "analytics_insights_owner_read" on public.analytics_insights
  for select to authenticated using (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

drop policy if exists "analytics_insights_owner_update" on public.analytics_insights;
create policy "analytics_insights_owner_update" on public.analytics_insights
  for update to authenticated
  using (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  )
  with check (
    teacher_id = auth.uid() or public.can_access_workspace(teacher_id)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- فحص ذاتي بعد التشغيل — النتائج المتوقعة جوار كل استعلام
-- ═══════════════════════════════════════════════════════════════════════════
-- أ) السياسات — المتوقع 9: لكل جدول insert+select، وinsights ليهم update كمان،
--    ومفيش أي delete:
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename in ('analytics_runs', 'analytics_reports', 'analytics_insights')
order by tablename, policyname;

-- ب) الفهارس — المتوقع: 2 runs + 1 reports + 2 insights (بينهم الجزئي uq_):
select tablename, indexname
from pg_indexes
where schemaname = 'public' and tablename in ('analytics_runs', 'analytics_reports', 'analytics_insights')
order by tablename, indexname;

-- ج) الاختبار الحقيقي من التطبيق: افتح «فريق التحليل» وشغّل التحليل الأسبوعي —
--    هتلاقي صف run + صف report هنا:
--    select run_type, completed_at, insights_total from public.analytics_runs order by completed_at desc limit 5;
--
-- ملاحظة: لو مشغّلتش الملف ده، «فريق التحليل» يفضل شغال طبيعي 100% —
-- التخزين المحلي (localStorage) بيشيل الحمل مؤقتًا، وأول ما الجداول تتبني
-- الذاكرة التحليلية الدائمة تبدأ لوحدها من غير أي خطوة إضافية.
