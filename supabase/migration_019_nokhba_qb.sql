-- ============================================================================
-- نظام النخبة — Migration 019: Nokhba QB (بنك الأسئلة + منشئ الامتحانات)
-- ============================================================================
-- نظام موازٍ لـ exams/exam_scores الموجودين (اللي بيرصدوا الدرجات فقط).
-- النظام ده بيوفر: بنك أسئلة كامل، استيراد قابل للمراجعة، منشئ امتحانات
-- احترافي، تصميم مخصص، نسخ متعددة (A/B/C)، ومفتاح إجابات، وPDF قابل للطباعة.
--
-- كل الجداول الجديدة مسبوقة بـ qb_ عشان نتجنب أي تعارض.
-- كلها محمية بـ RLS عبر can_access_workspace(teacher_id) الموجودة فعلاً
-- (migration_008) — فالمساعدين والاشتراكات بيشتغلوا أوتوماتيك.
--
-- طريقة التشغيل: Supabase → SQL Editor → New query → الصق الملف كامل → Run
-- الآمان: idempotent — create table if not exists / create policy if not exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) qb_questions — بنك الأسئلة الأساسي
-- ----------------------------------------------------------------------------
create table if not exists qb_questions (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  subject text not null default 'عام',
  grade text,
  unit text,
  lesson text,
  topic text,
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  type text not null default 'mcq' check (type in ('mcq','true_false','short_answer','essay','numerical','matching','custom')),
  question_text text not null,
  image_url text,           -- Supabase Storage URL OR base64 data URL
  diagram_url text,
  choices jsonb not null default '[]'::jsonb,        -- ["اختيار 1","اختيار 2",...]
  correct_answer jsonb not null default '{}'::jsonb, -- {index: 0} or {value: "..."} or {pairs: [...]}
  explanation text,
  marks numeric not null default 1 check (marks >= 0),
  source_ref text,
  is_favorite boolean not null default false,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2) qb_tags + qb_question_tags — وسم الأسئلة
-- ----------------------------------------------------------------------------
create table if not exists qb_tags (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  unique (teacher_id, name)
);

create table if not exists qb_question_tags (
  question_id uuid not null references qb_questions(id) on delete cascade,
  tag_id uuid not null references qb_tags(id) on delete cascade,
  primary key (question_id, tag_id)
);

-- ----------------------------------------------------------------------------
-- 3) qb_exams — تعريف الامتحان
-- ----------------------------------------------------------------------------
create table if not exists qb_exams (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  subject text,
  grade text,
  instructions text,
  header jsonb not null default '{
    "school_name":"","center_name":"","teacher_name":"",
    "exam_date":"","logo_url":"","show_student_name_field":true,
    "show_class_field":true,"show_date_field":true
  }'::jsonb,
  footer text,
  total_marks numeric not null default 0,
  design jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4) qb_exam_sections — أقسام الامتحان
-- ----------------------------------------------------------------------------
create table if not exists qb_exam_sections (
  id uuid primary key default uuid_generate_v4(),
  exam_id uuid not null references qb_exams(id) on delete cascade,
  title text not null,
  instructions text,
  order_idx integer not null default 0,
  total_marks numeric not null default 0
);

-- ----------------------------------------------------------------------------
-- 5) qb_exam_items — الأسئلة داخل كل قسم (التعريف الأصلي)
-- ----------------------------------------------------------------------------
create table if not exists qb_exam_items (
  id uuid primary key default uuid_generate_v4(),
  section_id uuid not null references qb_exam_sections(id) on delete cascade,
  question_id uuid not null references qb_questions(id) on delete restrict,
  order_idx integer not null default 0,
  marks numeric not null default 1 check (marks >= 0)
);

-- ----------------------------------------------------------------------------
-- 6) qb_versions — نسخ الامتحان (A/B/C)
-- ----------------------------------------------------------------------------
create table if not exists qb_versions (
  id uuid primary key default uuid_generate_v4(),
  exam_id uuid not null references qb_exams(id) on delete cascade,
  version_label text not null,        -- "A","B","C"...
  shuffle_questions boolean not null default false,
  shuffle_choices boolean not null default false,
  created_at timestamptz not null default now(),
  unique (exam_id, version_label)
);

-- ----------------------------------------------------------------------------
-- 7) qb_version_items — ترتيب الأسئلة والاختيارات في كل نسخة
-- ----------------------------------------------------------------------------
create table if not exists qb_version_items (
  id uuid primary key default uuid_generate_v4(),
  version_id uuid not null references qb_versions(id) on delete cascade,
  question_id uuid not null references qb_questions(id) on delete restrict,
  order_idx integer not null default 0,
  choice_order jsonb not null default '[]'::jsonb  -- [0,1,2,3] permuted indices for mcq
);

-- ----------------------------------------------------------------------------
-- 8) qb_templates — قوالب التصميم المحفوظة
-- ----------------------------------------------------------------------------
create table if not exists qb_templates (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  design jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (teacher_id, name)
);

-- ----------------------------------------------------------------------------
-- 9) qb_import_staging — الأسئلة المستوردة بانتظار المراجعة
-- ----------------------------------------------------------------------------
create table if not exists qb_import_staging (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  source_kind text not null check (source_kind in ('text','pdf','image')),
  raw_payload text,
  parsed_questions jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','imported')),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security — كلها عبر can_access_workspace الموجودة
-- ============================================================================
alter table qb_questions         enable row level security;
alter table qb_tags              enable row level security;
alter table qb_question_tags     enable row level security;
alter table qb_exams             enable row level security;
alter table qb_exam_sections     enable row level security;
alter table qb_exam_items        enable row level security;
alter table qb_versions          enable row level security;
alter table qb_version_items     enable row level security;
alter table qb_templates         enable row level security;
alter table qb_import_staging    enable row level security;

-- Use DO block + exception handling for policy creation to make it idempotent
-- across re-runs (CREATE POLICY IF NOT EXISTS is not supported in older PG).
DO $$
BEGIN
  -- qb_questions
  BEGIN
    create policy "qb_questions_workspace_access" on qb_questions
      for all using (can_access_workspace(teacher_id))
      with check (can_access_workspace(teacher_id));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- qb_tags
  BEGIN
    create policy "qb_tags_workspace_access" on qb_tags
      for all using (can_access_workspace(teacher_id))
      with check (can_access_workspace(teacher_id));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- qb_question_tags — الوصول عبر question.teacher_id
  BEGIN
    create policy "qb_qt_select" on qb_question_tags
      for select using (
        exists (select 1 from qb_questions q where q.id = qb_question_tags.question_id and can_access_workspace(q.teacher_id))
      );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    create policy "qb_qt_modify" on qb_question_tags
      for all using (
        exists (select 1 from qb_questions q where q.id = qb_question_tags.question_id and can_access_workspace(q.teacher_id))
      ) with check (
        exists (select 1 from qb_questions q where q.id = qb_question_tags.question_id and can_access_workspace(q.teacher_id))
      );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- qb_exams
  BEGIN
    create policy "qb_exams_workspace_access" on qb_exams
      for all using (can_access_workspace(teacher_id))
      with check (can_access_workspace(teacher_id));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- qb_exam_sections — عبر exam.teacher_id
  BEGIN
    create policy "qb_sections_access" on qb_exam_sections
      for all using (
        exists (select 1 from qb_exams e where e.id = qb_exam_sections.exam_id and can_access_workspace(e.teacher_id))
      ) with check (
        exists (select 1 from qb_exams e where e.id = qb_exam_sections.exam_id and can_access_workspace(e.teacher_id))
      );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- qb_exam_items — عبر section→exam→teacher
  BEGIN
    create policy "qb_items_access" on qb_exam_items
      for all using (
        exists (
          select 1 from qb_exam_sections s
          join qb_exams e on e.id = s.exam_id
          where s.id = qb_exam_items.section_id and can_access_workspace(e.teacher_id)
        )
      ) with check (
        exists (
          select 1 from qb_exam_sections s
          join qb_exams e on e.id = s.exam_id
          where s.id = qb_exam_items.section_id and can_access_workspace(e.teacher_id)
        )
      );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- qb_versions
  BEGIN
    create policy "qb_versions_access" on qb_versions
      for all using (
        exists (select 1 from qb_exams e where e.id = qb_versions.exam_id and can_access_workspace(e.teacher_id))
      ) with check (
        exists (select 1 from qb_exams e where e.id = qb_versions.exam_id and can_access_workspace(e.teacher_id))
      );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- qb_version_items
  BEGIN
    create policy "qb_version_items_access" on qb_version_items
      for all using (
        exists (
          select 1 from qb_versions v
          join qb_exams e on e.id = v.exam_id
          where v.id = qb_version_items.version_id and can_access_workspace(e.teacher_id)
        )
      ) with check (
        exists (
          select 1 from qb_versions v
          join qb_exams e on e.id = v.exam_id
          where v.id = qb_version_items.version_id and can_access_workspace(e.teacher_id)
        )
      );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- qb_templates
  BEGIN
    create policy "qb_templates_workspace_access" on qb_templates
      for all using (can_access_workspace(teacher_id))
      with check (can_access_workspace(teacher_id));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- qb_import_staging
  BEGIN
    create policy "qb_import_staging_workspace_access" on qb_import_staging
      for all using (can_access_workspace(teacher_id))
      with check (can_access_workspace(teacher_id));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ============================================================================
-- فهارس
-- ============================================================================
create index if not exists idx_qb_questions_teacher on qb_questions(teacher_id);
create index if not exists idx_qb_questions_subject on qb_questions(subject);
create index if not exists idx_qb_questions_grade on qb_questions(grade);
create index if not exists idx_qb_questions_difficulty on qb_questions(difficulty);
create index if not exists idx_qb_questions_type on qb_questions(type);
create index if not exists idx_qb_questions_favorite on qb_questions(teacher_id, is_favorite);
create index if not exists idx_qb_tags_teacher on qb_tags(teacher_id);
create index if not exists idx_qb_exams_teacher on qb_exams(teacher_id);
create index if not exists idx_qb_exam_sections_exam on qb_exam_sections(exam_id);
create index if not exists idx_qb_exam_items_section on qb_exam_items(section_id);
create index if not exists idx_qb_exam_items_question on qb_exam_items(question_id);
create index if not exists idx_qb_versions_exam on qb_versions(exam_id);
create index if not exists idx_qb_version_items_version on qb_version_items(version_id);
create index if not exists idx_qb_import_staging_teacher on qb_import_staging(teacher_id);

-- ============================================================================
-- updated_at trigger helper (one shared function)
-- ============================================================================
create or replace function qb_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_qb_questions_touch on qb_questions;
create trigger trg_qb_questions_touch before update on qb_questions
  for each row execute procedure qb_touch_updated_at();

drop trigger if exists trg_qb_exams_touch on qb_exams;
create trigger trg_qb_exams_touch before update on qb_exams
  for each row execute procedure qb_touch_updated_at();

-- ============================================================================
-- دالة مساعدة: ترقية سؤال من staging إلى qb_questions
-- ============================================================================
create or replace function qb_promote_import(staging_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  st qb_import_staging%rowtype;
  q uuid;
  parsed jsonb;
  item jsonb;
begin
  select * into st from qb_import_staging where id = staging_id;
  if not found then
    raise exception 'staging record not found';
  end if;
  if not can_access_workspace(st.teacher_id) then
    raise exception 'access denied';
  end if;

  parsed := st.parsed_questions;
  if jsonb_array_length(parsed) = 0 then
    raise exception 'no questions to import';
  end if;

  for item in select jsonb_array_elements(parsed) loop
    insert into qb_questions (
      teacher_id, subject, grade, unit, lesson, topic, difficulty, type,
      question_text, choices, correct_answer, explanation, marks, source_ref
    ) values (
      st.teacher_id,
      coalesce(item->>'subject', 'عام'),
      item->>'grade',
      item->>'unit',
      item->>'lesson',
      item->>'topic',
      coalesce(item->>'difficulty', 'medium'),
      coalesce(item->>'type', 'mcq'),
      item->>'question_text',
      coalesce(item->'choices', '[]'::jsonb),
      coalesce(item->'correct_answer', '{}'::jsonb),
      item->>'explanation',
      coalesce((item->>'marks')::numeric, 1),
      item->>'source_ref'
    )
    returning id into q;
  end loop;

  update qb_import_staging set status = 'imported' where id = staging_id;
  return q;
end;
$$;

grant execute on function qb_promote_import(uuid) to authenticated;

-- ============================================================================
-- تم — Nokhba QB جاهز للاستخدام بعد تشغيل هذا الملف.
-- ============================================================================
