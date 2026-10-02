-- ============================================================================
-- Migration 049 — ECOSYSTEM HARDENING: audit completion + rate limits + indexes
-- ============================================================================
-- التشغيل: Supabase Dashboard → SQL Editor → الصق الملف كامل → Run
-- الملف idempotent: آمن لإعادة التشغيل، لا يحذف ولا يغيّر أي بيانات قائمة.
--
-- المحتويات:
--   1) admin_log_audit() — RPC موحّد لكتابة سجلات التدقيق من Edge Functions
--      (service-role) ومن الأدمن نفسه. يكتب في admin_audit_logs الموجود
--      (migration 036 — جدول للإضافة فقط، لا يوجد update/delete إطلاقًا).
--   2) consume_rate_limit() — محدّد معدل ذرّي (sliding window) للـ Edge
--      Functions الحساسة (backup/restore/account actions). يمنع إساءة
--      الاستخدام حتى بجلسة أدمن مسروقة.
--   3) فهارس الأداء على الجداول الساخنة (exam_scores / attendance_records /
--      lesson_sessions / students / group_schedule / teacher_settings) —
--      كلها "if not exists" فلا تكرار ولا ضرر.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) RPC كتابة التدقيق الموحّد
-- ═══════════════════════════════════════════════════════════════════════════
-- القواعد:
--   • auth.uid() null  → سياق service-role (Edge Function) — مسموح فقط لو
--     مرّر actor_id صريح (الـ Edge Function تتحقق من الأدمن قبل الاستدعاء).
--   • auth.uid() موجود → يجب أن يكون أدمنًا، ويُسجَّل باسمه هو (لا انتحال).
create or replace function public.admin_log_audit(
  p_action text,
  p_target_user_id uuid default null,
  p_reason text default null,
  p_details text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_id uuid default null,
  p_actor_email text default null,
  p_success boolean default true,
  p_support_session_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_id bigint;
begin
  v_uid := auth.uid();

  if v_uid is null then
    -- service-role context: يتطلب معرّف فاعل صريح (نمنع سجلات مجهولة المصدر)
    if p_actor_id is null then
      raise exception 'admin_log_audit: service-role calls must pass p_actor_id';
    end if;
    v_uid := p_actor_id;
  else
    -- سياق مستخدم مسجّل: أدمن فقط، والفاعل = هو نفسه دائمًا
    select coalesce(is_admin, false) into v_is_admin
    from public.profiles where id = v_uid;
    if not v_is_admin then
      raise exception 'admin_log_audit: admin access required';
    end if;
  end if;

  insert into admin_audit_logs
    (admin_user_id, target_user_id, action, reason, details, metadata, support_session_id)
  values
    (v_uid, p_target_user_id,
     case when p_success then p_action else p_action || '_failed' end,
     p_reason, p_details, p_metadata, p_support_session_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_log_audit from public, anon;
grant execute on function public.admin_log_audit to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) محدّد المعدل الذرّي (للـ Edge Functions)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.edge_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

revoke all on public.edge_rate_limits from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count integer;
begin
  if p_max is null or p_max < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'consume_rate_limit: invalid arguments';
  end if;

  insert into edge_rate_limits (key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set window_start = case
          when edge_rate_limits.window_start + make_interval(secs => p_window_seconds) < v_now
          then v_now
          else edge_rate_limits.window_start
        end,
        count = case
          when edge_rate_limits.window_start + make_interval(secs => p_window_seconds) < v_now
          then 1
          else edge_rate_limits.count + 1
        end
  returning count into v_count;

  -- تنظيف عابر: نوافذ قديمة لمفاتيح أخرى (احتمال ضئيل، تكلفة زهيدة)
  delete from edge_rate_limits
   where key <> p_key
     and window_start + make_interval(secs => greatest(p_window_seconds * 4, 3600)) < v_now;

  return v_count <= p_max;
end;
$$;

revoke all on function public.consume_rate_limit from public, anon, authenticated;
grant execute on function public.consume_rate_limit to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) فهارس الأداء (الجداول الساخنة — كلها if not exists)
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists idx_exam_scores_student_date
  on public.exam_scores (student_id, created_at desc);
create index if not exists idx_exam_scores_exam
  on public.exam_scores (exam_id);
create index if not exists idx_attendance_records_session
  on public.attendance_records (lesson_session_id);
create index if not exists idx_attendance_records_student_date
  on public.attendance_records (student_id, attendance_date desc);
create index if not exists idx_lesson_sessions_teacher_date
  on public.lesson_sessions (teacher_id, session_date desc);
create index if not exists idx_students_teacher_created
  on public.students (teacher_id, created_at desc);
create index if not exists idx_group_schedule_teacher
  on public.group_schedule (teacher_id);
create index if not exists idx_teacher_settings_teacher
  on public.teacher_settings (teacher_id);
create index if not exists idx_student_notifications_student
  on public.student_notifications (student_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) سجل نتائج التشغيل
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  raise notice 'Migration 049 applied: admin_log_audit + consume_rate_limit + performance indexes';
end $$;
