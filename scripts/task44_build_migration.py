#!/usr/bin/env python3
"""Build migration_055_assessment_integrity.sql from LIVE prod function defs.

Patches (each asserted to match exactly once):
  1. get_student_standalone_exams      — portal release gate (status='completed')
  2. get_student_portal_access         — revocation honored in UUID fallback
  3. mark_all_notifications_read       — revocation honored in UUID fallback
  4. register_student_push_subscription— revocation honored in UUID fallback
  5. upsert_lesson_homework            — enum whitelist + students.hw_status sync
  6. admin_restore_apply               — allowlist += homework_task_status + standalone tables
Plus hand-written additive DDL (columns, indexes, bounds triggers, day-attendance RPC).
"""
import json, sys

defs = json.load(open('/home/z/my-project/scripts/task44_live_defs.json'))
# live defs carry CRLF — normalize to LF before anchored patching (054 lesson)
for k in defs:
    defs[k] = defs[k].replace('\r\n', '\n')
patches = []  # (fn_key, old, new, label)

def add(key, old, new, label):
    body = defs[key]
    n = body.count(old)
    if n != 1:
        print(f'FATAL: anchor for {label} matched {n} times in {key}'); sys.exit(1)
    patches.append((key, old, new, label))

K_STANDALONE = 'get_student_standalone_exams(text)'
K_ACCESS = 'get_student_portal_access(text)'
K_MARKALL = 'mark_all_notifications_read(text)'
K_PUSH = 'register_student_push_subscription(text,text,text,text,text)'
K_HW = 'upsert_lesson_homework(uuid,uuid,text)'
K_RESTORE = 'admin_restore_apply(uuid,uuid,jsonb,text)'

# 1. standalone release gate
add(K_STANDALONE,
    "    where es.student_id = v_student_id\n      and es.teacher_id = v_teacher_id\n  ), '[]'::jsonb);",
    "    where es.student_id = v_student_id\n      and es.teacher_id = v_teacher_id\n      -- TASK44 (release gate): امتحان لسه مفتوح (تحت التصحيح) نتايجه مبتنشرش للبوابة\n      and e.status = 'completed'\n  ), '[]'::jsonb);",
    'standalone release gate')

# 2. portal access fallback revocation
add(K_ACCESS,
    "select st.id, st.teacher_id into v, t from public.students st where st.id = p_token::uuid limit 1;",
    "select st.id, st.teacher_id into v, t from public.students st where st.id = p_token::uuid and not exists (select 1 from public.student_qr_tokens t_rev where t_rev.student_id = st.id and t_rev.revoked_at is not null) limit 1;",
    'portal access fallback revocation')

# 3. mark_all_notifications_read fallback revocation
add(K_MARKALL,
    "select id into v_student_id from students where id = p_token::uuid limit 1;",
    "select s.id into v_student_id from students s where s.id = p_token::uuid and not exists (select 1 from student_qr_tokens t_rev where t_rev.student_id = s.id and t_rev.revoked_at is not null) limit 1;",
    'mark_all fallback revocation')

# 4. push subscription fallback revocation
add(K_PUSH,
    "from public.students s where s.id = p_token::uuid limit 1;",
    "from public.students s where s.id = p_token::uuid and not exists (select 1 from public.student_qr_tokens t_rev where t_rev.student_id = s.id and t_rev.revoked_at is not null) limit 1;",
    'push fallback revocation')

# 5a. homework enum whitelist
add(K_HW,
    "  if p_homework_status is null or length(btrim(p_homework_status)) = 0 or length(p_homework_status) > 60 then\n    raise exception 'invalid_homework_status';\n  end if;\n",
    "  if p_homework_status is null or length(btrim(p_homework_status)) = 0 or length(p_homework_status) > 60 then\n    raise exception 'invalid_homework_status';\n  end if;\n\n  -- TASK44: restore the value whitelist that 040/041 enforced and 054 lost\n  if p_homework_status not in ('مكتمل','ناقص','لم يتم','لم يرصد') then\n    raise exception 'invalid_homework_status';\n  end if;\n",
    'homework enum whitelist')

# 5b. hw_status denormalized sync
add(K_HW,
    "  return v_row;\nend;\n$function$",
    "  -- TASK44: restore the denormalized quick-state sync (054 dropped it;\n  -- AnalyticsArea/StudentsArea filters still consume students.hw_status)\n  update public.students\n    set hw_status = p_homework_status, updated_at = now()\n  where id = p_student_id and teacher_id = v_teacher_id;\n\n  return v_row;\nend;\n$function$",
    'hw_status sync')

# 6. restore allowlist extension (order: FK deps respected — after homework_tasks & students)
add(K_RESTORE,
    "    'session_logs', 'feature_unlocks', 'qb_questions', 'qb_exams', 'teacher_settings'\n  ];",
    "    'session_logs', 'feature_unlocks', 'qb_questions', 'qb_exams', 'teacher_settings',\n    'homework_task_status', 'standalone_exams', 'standalone_exam_scores'\n  ];",
    'restore allowlist extension')

# ---- assemble ----
out = []
out.append("""-- migration_055_assessment_integrity.sql
-- TASK44 — exams & homework deep audit: integrity, release gate, restore parity.
-- ALL changes are additive/idempotent. No data is modified or deleted.
-- Verified against live prod before generation (scripts/task44_preprobe.py).

set check_function_bodies = false;

-- ============================================================
-- A. Canonical-migration repair: lesson_session_id on exams/exam_scores
--    (written by the app since 038 but missing from every migration file —
--    a fresh environment could not save exams at all)
-- ============================================================
alter table public.exams       add column if not exists lesson_session_id uuid references public.lesson_sessions(id) on delete cascade;
alter table public.exam_scores add column if not exists lesson_session_id uuid references public.lesson_sessions(id) on delete cascade;
create index if not exists idx_exams_lesson       on public.exams(lesson_session_id);
create index if not exists idx_exam_scores_lesson on public.exam_scores(lesson_session_id);

-- ============================================================
-- B. Standalone score bounds — server-side integrity
--    (server CHECK was score>=0 only; client clamp is the only guard)
-- ============================================================
create or replace function public.standalone_score_bounds_guard()
returns trigger
language plpgsql
set search_path to public
as $fn$
begin
  if new.score is not null and new.score > (
    select e.max_score from public.standalone_exams e where e.id = new.exam_id
  ) then
    raise exception 'score_exceeds_max';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_standalone_scores_bounds on public.standalone_exam_scores;
create trigger trg_standalone_scores_bounds
  before insert or update of score on public.standalone_exam_scores
  for each row execute function public.standalone_score_bounds_guard();

create or replace function public.standalone_max_guard()
returns trigger
language plpgsql
set search_path to public
as $fn$
begin
  if new.max_score is not null and exists (
    select 1 from public.standalone_exam_scores s
    where s.exam_id = old.id and s.score > new.max_score
  ) then
    raise exception 'max_below_existing_scores';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_standalone_exam_max_guard on public.standalone_exams;
create trigger trg_standalone_exam_max_guard
  before update of max_score on public.standalone_exams
  for each row execute function public.standalone_max_guard();

-- ============================================================
-- C. Day attendance RPC — offline replay parity with the online path
--    (the queued raw upsert used conflict target teacher_id,student_id
--    which matches NO unique index → replay always failed 42P10)
-- ============================================================
create or replace function public.upsert_student_day_attendance(p_student_id uuid, p_status text, p_day date default null)
returns void
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_teacher_id uuid;
  v_existing uuid;
  v_day date := coalesce(p_day, current_date);
begin
  if p_student_id is null or p_status is null or length(btrim(p_status)) = 0 or length(p_status) > 20 then
    raise exception 'invalid_args';
  end if;

  select teacher_id into v_teacher_id from public.students where id = p_student_id;
  if v_teacher_id is null then
    raise exception 'student_not_found';
  end if;
  if not public.can_access_workspace(v_teacher_id) then
    raise exception 'not_authorized';
  end if;

  -- same semantics as the online day path: newest no-lesson record of THIS day
  select id into v_existing
  from public.attendance_records
  where teacher_id = v_teacher_id and student_id = p_student_id
    and lesson_session_id is null
    and recorded_at >= v_day::timestamptz
    and recorded_at <  (v_day + 1)::timestamptz
  order by recorded_at desc
  limit 1;

  if v_existing is not null then
    update public.attendance_records set status = p_status, recorded_at = now() where id = v_existing;
  else
    insert into public.attendance_records (teacher_id, student_id, status, recorded_at)
    values (v_teacher_id, p_student_id, p_status, now());
  end if;
end;
$fn$;

revoke execute on function public.upsert_student_day_attendance(uuid, text, date) from anon, public;
grant execute on function public.upsert_student_day_attendance(uuid, text, date) to authenticated, service_role;
""")

grants = {
    K_STANDALONE: "grant execute on function public.get_student_standalone_exams(text) to anon, authenticated, service_role;",
    K_ACCESS:     "grant execute on function public.get_student_portal_access(text) to public;",
    K_MARKALL:    "grant execute on function public.mark_all_notifications_read(text) to public;",
    K_PUSH:       "grant execute on function public.register_student_push_subscription(text,text,text,text,text) to anon, authenticated, service_role;",
    K_HW:         "revoke execute on function public.upsert_lesson_homework(uuid,uuid,text) from anon;\ngrant execute on function public.upsert_lesson_homework(uuid,uuid,text) to authenticated, service_role;",
    K_RESTORE:    "grant execute on function public.admin_restore_apply(uuid,uuid,jsonb,text) to public;",
}

for key, old, new, label in patches:
    out.append(f"\n-- ============================================================\n-- {label}  ({key})\n-- ============================================================\n")
    out.append(defs[key].replace(old, new) + ";\n")
    out.append("\n" + grants[key] + "\n")
    defs[key] = defs[key].replace(old, new)  # keep patched copy for integrity check

sql = '\n'.join(out)
path = '/home/z/my-project/supabase/migration_055_assessment_integrity.sql'
open(path, 'w').write(sql)
print(f'written {path} ({len(sql)} chars, {len(patches)} patched functions)')
for key, old, new, label in patches:
    print(f'  ✓ {label}')
