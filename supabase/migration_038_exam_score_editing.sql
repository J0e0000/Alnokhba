-- ============================================================================
-- النخبة (Alnokhba) — Migration 038
-- تعديل درجات الامتحانات: عمليتان منفصلتان تمامًا
--   A) تعديل الدرجة العظمى للامتحان كله (update_exam_max_score)
--   B) تعديل درجة طالب واحد في الامتحان (update_student_exam_score)
-- ============================================================================
-- آمن وتراكمي 100%: لا يحذف أي بيانات ولا يغير أي سجلات قائمة.
-- يعمل مباشرة من Supabase SQL Editor (الصق الملف كاملاً ثم Run).
-- آمن لإعادة التشغيل أكثر من مرة (كل الأوامر idempotent).
--
-- المحتويات:
--   1) عمودا version + updated_at على exams و exam_scores
--      (حماية التعديل المتزامن: لو اتنين فتحوا نفس الدرجة، التعديل القديم
--       بيرفض مش بيكتب فوق الجديد)
--   2) جدول exam_score_audit_logs: سجل تدقيق append-only لكل تعديل
--      (من عدّل / إمتى / القيمة القديمة / الجديدة / ليه)
--   3) دالة update_exam_max_score:
--      - بتغير الدرجة العظمى الكلية للامتحان (مثال: 40 → 50)
--      - درجات الطلاب المسجلة مبتتغيرش (الطالب اللي 32 من 40 يفضل 32 من 50)
--      - النسب المئوية والدرجات المشتقة بتتحسب من العظمى الجديدة تلقائيًا
--   4) دالة update_student_exam_score:
--      - بتغير درجة طالب واحد بس (الباقي مبيتأثروش خالص)
--      - بتتحقق إن الطالب حاضر يوم الامتحان (الغايب مياخدش درجة عادية)
--      - بتتأكد إن الدرجة الجديدة ≤ الدرجة العظمى ومش سالبة
--      - بتظبط نقاط الطالب بنفس معادلة الرصد الأصلية (الفرق فوق/تحت النص)
--   5) القسم (section_scores) بيتوزع نسبيًا على الأقسام عشان التقارير
--      تفضل متسقة مع المجموع الجديد
--
-- الصلاحيات: نفس نظام الصلاحيات الموجود (can_access_workspace) —
-- صاحب الامتحان أو عضو مساحة عمله أو جلسة دعم فنية نشطة. مفيش نظام
-- صلاحيات جديد (منع الازدواجية).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) أعمدة التزامن (concurrency) على exams و exam_scores
-- ----------------------------------------------------------------------------
alter table public.exams
  add column if not exists version bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

alter table public.exam_scores
  add column if not exists version bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_exam_scores_exam
  on public.exam_scores(exam_id);

-- ----------------------------------------------------------------------------
-- 2) سجل تدقيق تعديل الدرجات (append-only)
--    مفيش أي UPDATE/DELETE — الجدول بيزيد بس، والتغييرات بتتم عبر الدوال بس.
-- ----------------------------------------------------------------------------
create table if not exists public.exam_score_audit_logs (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  change_type text not null check (change_type in ('max_score', 'student_score')),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  previous_value numeric,
  new_value numeric,
  reason text,
  exam_version bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_exam_audit_exam
  on public.exam_score_audit_logs(exam_id, created_at desc);

create index if not exists idx_exam_audit_teacher
  on public.exam_score_audit_logs(teacher_id, created_at desc);

alter table public.exam_score_audit_logs enable row level security;

-- قراءة: صاحب مساحة العمل بس (نفس نمط باقي الجداول)
drop policy if exists "exam_score_audit_workspace_read" on public.exam_score_audit_logs;
create policy "exam_score_audit_workspace_read" on public.exam_score_audit_logs
  for select using (can_access_workspace(teacher_id));

-- مفيش سياسات insert/update/delete: الكتابة من الدوال فقط (security definer)

-- ----------------------------------------------------------------------------
-- 3) العملية A: تعديل الدرجة العظمى للامتحان
--    p_exam_id            : الامتحان
--    p_new_max            : الدرجة العظمى الكلية الجديدة (رقم > 0)
--    p_expected_version   : رقم النسخة اللي شافها المستخدم (حماية التزامن)
--    p_reason             : سبب التعديل (اختياري — بيتسجل في سجل التدقيق)
-- ----------------------------------------------------------------------------
create or replace function public.update_exam_max_score(
  p_exam_id uuid,
  p_new_max numeric,
  p_expected_version bigint default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_id uuid;
  v_sections text[];
  v_old_per_section numeric;
  v_sections_count int;
  v_new_per_section numeric;
  v_old_max numeric;
  v_conflicts int;
  v_new_version bigint;
  v_scores_count int;
begin
  -- (1) تسجيل الدخول
  if auth.uid() is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;

  -- (2) الامتحان موجود؟ + بياناته المرجعية (server-side authoritative)
  --     for update = قفل الصف عشان تعديلين متزامنين ميتفيشوش على بعض
  select e.teacher_id, e.sections, e.max_score_per_section
    into v_teacher_id, v_sections, v_old_per_section
    from public.exams e
    where e.id = p_exam_id
    for update;
  if not found then
    raise exception 'الامتحان غير موجود';
  end if;

  -- (3) الصلاحية (نفس نظام الصلاحيات القائم — مفيش نظام جديد)
  if not can_access_workspace(v_teacher_id) then
    raise exception 'مش مسموح لك تعديل امتحان مش بتاعك';
  end if;

  -- (4) تحقق الدرجة الجديدة: رقمية وموجبة
  if p_new_max is null or p_new_max <> p_new_max or p_new_max <= 0 then
    raise exception 'الدرجة العظمى لازم تكون رقم أكبر من صفر';
  end if;

  v_sections_count := coalesce(array_length(v_sections, 1), 0);
  if v_sections_count <= 0 then
    raise exception 'الامتحان من غير أقسام — راجع بياناته الأول';
  end if;

  -- (5) لازم تقبل القسمة على عدد الأقسام عشان الدرجة لكل قسم تطلع رقم نظيف
  --     (زي 50 على 5 أقسام = 10 لكل قسم)
  if mod(p_new_max * 100, v_sections_count * 100) <> 0 then
    raise exception 'الدرجة العظمى (%) لازم تقبل القسمة على عدد الأقسام (%) عشان الدرجة لكل قسم تطلع رقم صحيح', p_new_max, v_sections_count;
  end if;

  v_new_per_section := p_new_max / v_sections_count;
  v_old_max := v_old_per_section * v_sections_count;

  -- (6) حماية من فساد البيانات التاريخية: مفيش درجة طالب أعلى من العظمى الجديدة
  select count(*) into v_conflicts
    from public.exam_scores s
    where s.exam_id = p_exam_id
      and s.total_score > p_new_max;
  if v_conflicts > 0 then
    raise exception 'فيه % درجة/درجات طلبة أعلى من العظمى الجديدة — عدّل درجاتهم الأول', v_conflicts;
  end if;

  -- (7) تحديث شرطي: بيوافق بس لو النسخة اللي شافها المستخدم هي الأحدث
  update public.exams
    set max_score_per_section = v_new_per_section,
        version = version + 1,
        updated_at = now()
    where id = p_exam_id
      and (p_expected_version is null or version = p_expected_version)
    returning version into v_new_version;

  if v_new_version is null then
    raise exception '[CONFLICT]الامتحان اتعدّل من مستخدم تاني — حدّث البيانات وجرب تاني';
  end if;

  -- (8) سجل التدقيق (append-only — ما بيمسحش أي حاجة تاريخية)
  insert into public.exam_score_audit_logs
    (teacher_id, actor_id, change_type, exam_id, student_id, previous_value, new_value, reason, exam_version)
  values
    (v_teacher_id, auth.uid(), 'max_score', p_exam_id, null, v_old_max, p_new_max,
     nullif(trim(coalesce(p_reason, '')), ''), v_new_version);

  select count(*) into v_scores_count from public.exam_scores where exam_id = p_exam_id;

  return jsonb_build_object(
    'ok', true,
    'exam_id', p_exam_id,
    'new_max_total', p_new_max,
    'per_section', v_new_per_section,
    'sections_count', v_sections_count,
    'version', v_new_version,
    'scores_affected', v_scores_count
  );
end $$;

revoke all on function public.update_exam_max_score(uuid, numeric, bigint, text) from public;
revoke all on function public.update_exam_max_score(uuid, numeric, bigint, text) from anon;
grant execute on function public.update_exam_max_score(uuid, numeric, bigint, text) to authenticated;
grant execute on function public.update_exam_max_score(uuid, numeric, bigint, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4) العملية B: تعديل درجة طالب واحد
--    p_score_id          : صف الدرجة بتاع الطالب في الامتحان ده
--    p_new_score         : الدرجة الجديدة (0 ≤ الدرجة ≤ العظمى)
--    p_expected_version  : رقم النسخة اللي شافها المستخدم (حماية التزامن)
--    p_reason            : سبب التعديل (اختياري — بيتسجل في سجل التدقيق)
-- ----------------------------------------------------------------------------
create or replace function public.update_student_exam_score(
  p_score_id uuid,
  p_new_score numeric,
  p_expected_version bigint default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score record;
  v_exam record;
  v_sections_count int;
  v_max_total numeric;
  v_passing numeric;
  v_points_delta int;
  v_new_version bigint;
  v_att_status text;
  v_keys text[];
  v_scale numeric;
  v_val numeric;
  v_running numeric;
  v_new_sections jsonb;
  v_total numeric;
  v_updated_at timestamptz;
begin
  -- (1) تسجيل الدخول
  if auth.uid() is null then
    raise exception 'لازم تسجل دخول الأول';
  end if;

  -- (2) صف الدرجة موجود؟ (server-side authoritative fetch)
  select s.id, s.teacher_id, s.exam_id, s.student_id, s.section_scores, s.total_score, s.version
    into v_score
    from public.exam_scores s
    where s.id = p_score_id;
  if not found then
    raise exception 'درجة الطالب دي مش موجودة';
  end if;

  -- (3) الامتحان المرجعي
  select e.teacher_id, e.title, e.sections, e.max_score_per_section, e.created_at, e.lesson_session_id
    into v_exam
    from public.exams e
    where e.id = v_score.exam_id;
  if not found then
    raise exception 'الامتحان مش موجود';
  end if;

  -- (4) الصلاحية: نفس نظام الصلاحيات القائم
  if not can_access_workspace(v_score.teacher_id) then
    raise exception 'مش مسموح لك تعديل درجات مدرّس تاني';
  end if;

  -- (5) اتساق البيانات: صف الدرجة تابع لنفس مدرّس الامتحان
  if v_score.teacher_id <> v_exam.teacher_id then
    raise exception 'بيانات الدرجة مش متطابقة مع الامتحان';
  end if;

  v_sections_count := coalesce(array_length(v_exam.sections, 1), 0);
  v_max_total := v_exam.max_score_per_section * v_sections_count;

  -- (6) تحقق الدرجة الجديدة
  if p_new_score is null or p_new_score <> p_new_score then
    raise exception 'الدرجة لازم تكون رقم';
  end if;
  if p_new_score < 0 then
    raise exception 'الدرجة مينفعش تكون سالبة';
  end if;
  if p_new_score > v_max_total then
    raise exception 'الدرجة (%) أكبر من الدرجة العظمى (%)', p_new_score, v_max_total;
  end if;

  -- (7) حماية الغايب: الطالب لازم يكون حاضر يوم الامتحان
  --     (أ) لو الامتحان مرتبط بحصة → حضور الحصة
  select a.status into v_att_status
    from public.attendance_records a
    where a.lesson_session_id = v_exam.lesson_session_id
      and a.student_id = v_score.student_id
    order by a.recorded_at desc
    limit 1;

  --     (ب) لو مفيش صف حضور للحصة → أي رصد حضور في نفس يوم الامتحان
  if v_att_status is null then
    select a.status into v_att_status
      from public.attendance_records a
      where a.student_id = v_score.student_id
        and a.teacher_id = v_score.teacher_id
        and a.recorded_at::date = v_exam.created_at::date
      order by a.recorded_at desc
      limit 1;
  end if;

  if v_att_status = 'غائب' then
    raise exception 'الطالب غائب في يوم الامتحان — مينفعش ياخد درجة عادية';
  end if;

  -- (8) إعادة توزيع الأقسام نسبيًا عشان التقارير تفضل متسقة مع المجموع الجديد
  --     (آخر قسم بياخد الباقي بالظبط عشان مجموع الأقسام = المجموع الجديد)
  v_keys := coalesce(array(select jsonb_object_keys(v_score.section_scores)), '{}');
  if coalesce(array_length(v_keys, 1), 0) = 0 then
    v_new_sections := v_score.section_scores;
  elsif v_score.total_score > 0 then
    v_scale := p_new_score / v_score.total_score;
    v_new_sections := '{}'::jsonb;
    v_running := 0;
    for i in 1 .. array_length(v_keys, 1) loop
      if i < array_length(v_keys, 1) then
        v_val := round(coalesce((v_score.section_scores ->> v_keys[i])::numeric, 0) * v_scale, 2);
        if v_val < 0 then v_val := 0; end if;
        v_new_sections := v_new_sections || jsonb_build_object(v_keys[i], v_val);
        v_running := v_running + v_val;
      else
        v_new_sections := v_new_sections || jsonb_build_object(v_keys[i],
          greatest(round(p_new_score - v_running, 2), 0));
      end if;
    end loop;
  else
    -- الدرجة القديمة صفر: توزيع متساوي
    v_new_sections := '{}'::jsonb;
    v_running := 0;
    for i in 1 .. array_length(v_keys, 1) loop
      if i < array_length(v_keys, 1) then
        v_val := round(p_new_score / array_length(v_keys, 1), 2);
        v_new_sections := v_new_sections || jsonb_build_object(v_keys[i], v_val);
        v_running := v_running + v_val;
      else
        v_new_sections := v_new_sections || jsonb_build_object(v_keys[i],
          greatest(round(p_new_score - v_running, 2), 0));
      end if;
    end loop;
  end if;

  -- (9) تحديث شرطي (حماية التزامن): يوافق بس لو النسخة اللي شافها المستخدم أحدث واحدة
  update public.exam_scores
    set total_score = p_new_score,
        section_scores = v_new_sections,
        version = version + 1,
        updated_at = now()
    where id = p_score_id
      and (p_expected_version is null or version = p_expected_version)
    returning version, updated_at, total_score into v_new_version, v_updated_at, v_total;

  if v_new_version is null then
    raise exception '[CONFLICT]الدرجة اتعدّلت من مستخدم تاني — حدّث البيانات وجرب تاني';
  end if;

  -- (10) نقاط الطالب: نفس معادلة الرصد الأصلية بالظبط
  --      (النقاط = الدرجة − نصف العظمى، فيتم تعديل الفرق بس)
  v_passing := v_max_total / 2;
  v_points_delta := (round(p_new_score - v_passing) - round(v_score.total_score - v_passing))::int;
  if v_points_delta <> 0 then
    update public.students
      set points = points + v_points_delta,
          updated_at = now()
      where id = v_score.student_id;
  end if;

  -- (11) سجل التدقيق (append-only)
  insert into public.exam_score_audit_logs
    (teacher_id, actor_id, change_type, exam_id, student_id, previous_value, new_value, reason, exam_version)
  values
    (v_score.teacher_id, auth.uid(), 'student_score', v_score.exam_id, v_score.student_id,
     v_score.total_score, p_new_score,
     nullif(trim(coalesce(p_reason, '')), ''), v_new_version);

  return jsonb_build_object(
    'ok', true,
    'score_id', p_score_id,
    'exam_id', v_score.exam_id,
    'student_id', v_score.student_id,
    'total_score', v_total,
    'section_scores', v_new_sections,
    'max_total', v_max_total,
    'version', v_new_version,
    'updated_at', v_updated_at,
    'points_delta', v_points_delta
  );
end $$;

revoke all on function public.update_student_exam_score(uuid, numeric, bigint, text) from public;
revoke all on function public.update_student_exam_score(uuid, numeric, bigint, text) from anon;
grant execute on function public.update_student_exam_score(uuid, numeric, bigint, text) to authenticated;
grant execute on function public.update_student_exam_score(uuid, numeric, bigint, text) to service_role;

-- ----------------------------------------------------------------------------
-- 5) Realtime: سجل التدقيق + الامتحانات والدرجات يوصلوا لحظيًا
--    (غالبًا عضو أصلًا من Round 7 — التأكيد هنا idempotent)
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.exam_score_audit_logs;
exception
  when duplicate_object then null;  -- عضو أصلًا
end $$;

do $$
begin
  alter publication supabase_realtime add table public.exams;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.exam_scores;
exception
  when duplicate_object then null;
end $$;
