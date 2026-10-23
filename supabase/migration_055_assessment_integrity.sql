-- migration_055_assessment_integrity.sql
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


-- ============================================================
-- standalone release gate  (get_student_standalone_exams(text))
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_student_standalone_exams(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student_id uuid;
  v_teacher_id uuid;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return '[]'::jsonb;
  end if;

  -- توكن البوابة → الطالب (نفس مسار 019/037 بالظبط)
  select q.student_id, s.teacher_id
    into v_student_id, v_teacher_id
  from public.student_qr_tokens q
  join public.students s on s.id = q.student_id
  where q.token = p_token and q.revoked_at is null
  limit 1;

  -- احتياط: روابط QR القديمة اللي كانت بتستخدم UUID الطالب نفسه كتوكن
  if v_student_id is null
     and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$' then
    select s.id, s.teacher_id
      into v_student_id, v_teacher_id
    from public.students s
    where s.id = p_token::uuid
      and not exists (select 1 from public.student_qr_tokens t_rev where t_rev.student_id = s.id and t_rev.revoked_at is not null)
    limit 1;
  end if;

  if v_student_id is null then
    return '[]'::jsonb;
  end if;

  -- درجات الطالب في الامتحانات المنفصلة (الممتحن = اللي ليه صف درجة)
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'exam_id', e.id,
      'title', e.title,
      'exam_date', e.exam_date,
      'exam_status', e.status,
      'score', es.score,
      'max_score', e.max_score,
      'grade_scale', e.grade_scale,
      'graded_at', es.updated_at
    ) order by e.exam_date desc, e.created_at desc)
    from public.standalone_exam_scores es
    join public.standalone_exams e on e.id = es.exam_id
    where es.student_id = v_student_id
      and es.teacher_id = v_teacher_id
      -- TASK44 (release gate): امتحان لسه مفتوح (تحت التصحيح) نتايجه مبتنشرش للبوابة
      and e.status = 'completed'
  ), '[]'::jsonb);
end;
$function$
;


grant execute on function public.get_student_standalone_exams(text) to anon, authenticated, service_role;


-- ============================================================
-- portal access fallback revocation  (get_student_portal_access(text))
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_student_portal_access(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v uuid; t uuid; s record; ts record; price numeric := 0; paid numeric := 0; maxw integer := 3; begin select qt.student_id, st.teacher_id into v, t from public.student_qr_tokens qt join public.students st on st.id = qt.student_id where qt.token = p_token and qt.revoked_at is null limit 1; if v is null and p_token ~ '^[0-9a-f-]{36}$' then select st.id, st.teacher_id into v, t from public.students st where st.id = p_token::uuid and not exists (select 1 from public.student_qr_tokens t_rev where t_rev.student_id = st.id and t_rev.revoked_at is not null) limit 1; end if; if v is null then return null; end if; select * into s from public.students where id = v and teacher_id = t; select * into ts from public.teacher_settings where teacher_id = t; if s.id is null then return null; end if; price := coalesce(public.resolve_student_price(t, v), 0); select coalesce(sum(sp.amount), 0) into paid from public.student_payments sp where sp.student_id = v and sp.teacher_id = t and sp.payment_date >= date_trunc('month', current_date)::date; maxw := coalesce((ts.entry_policy->>'max_warnings')::integer, 3); return jsonb_build_object('lessonPrice', price, 'paymentStatus', case when paid >= price and price > 0 then 'paid' when paid > 0 then 'partial' else 'unpaid' end, 'totalPaid', paid, 'entryAllowed', (coalesce((ts.entry_policy->>'require_payment')::boolean, true) = false or price <= 0 or paid >= price) and coalesce(s.warnings, 0) < maxw, 'blockedByWarnings', coalesce(s.warnings, 0) >= maxw, 'warnings', coalesce(s.warnings, 0), 'maxWarnings', maxw, 'sessionToday', (select coalesce(row_to_json(x), '{}'::json) from (select lesson_topic, homework_text, video_link, session_date from public.session_logs where teacher_id = t and group_name = s.group_name order by session_date desc limit 1) x)); end; $function$
;


grant execute on function public.get_student_portal_access(text) to public;


-- ============================================================
-- mark_all fallback revocation  (mark_all_notifications_read(text))
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student_id uuid;
begin
  select student_id into v_student_id
  from student_qr_tokens
  where token = p_token and revoked_at is null
  limit 1;

  if v_student_id is null and p_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select s.id into v_student_id from students s where s.id = p_token::uuid and not exists (select 1 from student_qr_tokens t_rev where t_rev.student_id = s.id and t_rev.revoked_at is not null) limit 1;
  end if;

  if v_student_id is null then
    raise exception 'invalid token';
  end if;

  update student_notifications
  set is_read = true
  where student_id = v_student_id and is_read = false;
end;
$function$
;


grant execute on function public.mark_all_notifications_read(text) to public;


-- ============================================================
-- push fallback revocation  (register_student_push_subscription(text,text,text,text,text))
-- ============================================================

CREATE OR REPLACE FUNCTION public.register_student_push_subscription(p_token text, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student_id uuid;
  v_teacher_id uuid;
begin
  if coalesce(length(trim(p_token)), 0) = 0
     or coalesce(length(trim(p_endpoint)), 0) = 0
     or coalesce(length(trim(p_p256dh)), 0) = 0
     or coalesce(length(trim(p_auth)), 0) = 0 then
    return false;
  end if;

  select q.student_id, s.teacher_id
    into v_student_id, v_teacher_id
  from public.student_qr_tokens q
  join public.students s on s.id = q.student_id
  where q.token = p_token and q.revoked_at is null
  limit 1;

  -- Preserve support for old QR links whose token is the student UUID.
  if v_student_id is null and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$' then
    select s.id, s.teacher_id into v_student_id, v_teacher_id
    from public.students s where s.id = p_token::uuid and not exists (select 1 from public.student_qr_tokens t_rev where t_rev.student_id = s.id and t_rev.revoked_at is not null) limit 1;
  end if;

  if v_student_id is null or v_teacher_id is null then return false; end if;

  insert into public.push_subscriptions (teacher_id, student_id, endpoint, p256dh, auth, user_agent, portal_url, updated_at)
  values (v_teacher_id, v_student_id, trim(p_endpoint), trim(p_p256dh), trim(p_auth), p_user_agent, '/qr/' || trim(p_token), now())
  on conflict (teacher_id, endpoint) do update set
    student_id = excluded.student_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    portal_url = coalesce(public.push_subscriptions.portal_url, excluded.portal_url),
    updated_at = now();

  return true;
end;
$function$
;


grant execute on function public.register_student_push_subscription(text,text,text,text,text) to anon, authenticated, service_role;


-- ============================================================
-- homework enum whitelist  (upsert_lesson_homework(uuid,uuid,text))
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_lesson_homework(p_lesson_session_id uuid, p_student_id uuid, p_homework_status text)
 RETURNS attendance_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_teacher_id uuid;
  v_row public.attendance_records;
begin
  select ls.teacher_id into v_teacher_id
  from public.lesson_sessions ls
  where ls.id = p_lesson_session_id;

  if v_teacher_id is null then
    raise exception 'lesson_not_found';
  end if;

  if not public.can_access_workspace(v_teacher_id) then
    raise exception 'not_authorized';
  end if;

  -- AUDIT 2026-10 (S7): the student must belong to THIS workspace — blocks
  -- pairing a local session/homework row with another teacher's student UUID.
  if not exists (select 1 from public.students s where s.id = p_student_id and s.teacher_id = v_teacher_id) then
    raise exception 'student_not_in_workspace';
  end if;

  if p_homework_status is null or length(btrim(p_homework_status)) = 0 or length(p_homework_status) > 60 then
    raise exception 'invalid_homework_status';
  end if;

  -- TASK44: restore the value whitelist that 040/041 enforced and 054 lost
  if p_homework_status not in ('مكتمل','ناقص','لم يتم','لم يرصد') then
    raise exception 'invalid_homework_status';
  end if;

  insert into public.attendance_records as ar
    (teacher_id, student_id, lesson_session_id, status, homework_status, recorded_at)
  values
    (v_teacher_id, p_student_id, p_lesson_session_id, 'لم يرصد', p_homework_status, now())
  on conflict (lesson_session_id, student_id)
  do update
    set homework_status = excluded.homework_status
  returning ar.* into v_row;

  return v_row;
end;
$function$
;


revoke execute on function public.upsert_lesson_homework(uuid,uuid,text) from anon;
grant execute on function public.upsert_lesson_homework(uuid,uuid,text) to authenticated, service_role;


-- ============================================================
-- hw_status sync  (upsert_lesson_homework(uuid,uuid,text))
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_lesson_homework(p_lesson_session_id uuid, p_student_id uuid, p_homework_status text)
 RETURNS attendance_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_teacher_id uuid;
  v_row public.attendance_records;
begin
  select ls.teacher_id into v_teacher_id
  from public.lesson_sessions ls
  where ls.id = p_lesson_session_id;

  if v_teacher_id is null then
    raise exception 'lesson_not_found';
  end if;

  if not public.can_access_workspace(v_teacher_id) then
    raise exception 'not_authorized';
  end if;

  -- AUDIT 2026-10 (S7): the student must belong to THIS workspace — blocks
  -- pairing a local session/homework row with another teacher's student UUID.
  if not exists (select 1 from public.students s where s.id = p_student_id and s.teacher_id = v_teacher_id) then
    raise exception 'student_not_in_workspace';
  end if;

  if p_homework_status is null or length(btrim(p_homework_status)) = 0 or length(p_homework_status) > 60 then
    raise exception 'invalid_homework_status';
  end if;

  -- TASK44: restore the value whitelist that 040/041 enforced and 054 lost
  if p_homework_status not in ('مكتمل','ناقص','لم يتم','لم يرصد') then
    raise exception 'invalid_homework_status';
  end if;

  insert into public.attendance_records as ar
    (teacher_id, student_id, lesson_session_id, status, homework_status, recorded_at)
  values
    (v_teacher_id, p_student_id, p_lesson_session_id, 'لم يرصد', p_homework_status, now())
  on conflict (lesson_session_id, student_id)
  do update
    set homework_status = excluded.homework_status
  returning ar.* into v_row;

  -- TASK44: restore the denormalized quick-state sync (054 dropped it;
  -- AnalyticsArea/StudentsArea filters still consume students.hw_status)
  update public.students
    set hw_status = p_homework_status, updated_at = now()
  where id = p_student_id and teacher_id = v_teacher_id;

  return v_row;
end;
$function$
;


revoke execute on function public.upsert_lesson_homework(uuid,uuid,text) from anon;
grant execute on function public.upsert_lesson_homework(uuid,uuid,text) to authenticated, service_role;


-- ============================================================
-- restore allowlist extension  (admin_restore_apply(uuid,uuid,jsonb,text))
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_restore_apply(p_backup_id uuid, p_teacher_id uuid, p_rows jsonb, p_strategy text DEFAULT 'skip'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tables constant text[] := array[
    'groups', 'lesson_sessions', 'students', 'attendance_records', 'behavior_logs',
    'homework_tasks', 'student_payments', 'announcements', 'exams', 'exam_scores',
    'student_notifications', 'student_qr_tokens', 'report_templates', 'group_schedule',
    'session_logs', 'feature_unlocks', 'qb_questions', 'qb_exams', 'teacher_settings',
    'homework_task_status', 'standalone_exams', 'standalone_exam_scores'
  ];
  v_table text;
  v_row jsonb;
  v_id uuid;
  v_row_id text;
  v_exists boolean;
  v_cols text[];
  v_set_clause text;
  v_col text;
  v_result jsonb := '{}'::jsonb;
  v_summary jsonb;
  v_json_value text;
begin
  if not is_admin_user() then raise exception 'Admin access required'; end if;
  if p_strategy not in ('skip', 'overwrite') then raise exception 'استراتيجية غير صحيحة (skip أو overwrite)'; end if;
  if not exists (select 1 from profiles where id = p_teacher_id) then
    raise exception 'المستخدم المستهدف غير موجود';
  end if;
  if not exists (select 1 from backups where id = p_backup_id) then
    raise exception 'النسخة الاحتياطية غير موجودة';
  end if;

  foreach v_table in array v_tables loop
    if p_rows ? v_table and jsonb_typeof(p_rows->v_table) = 'array' then
      v_summary := jsonb_build_object('inserted', 0, 'updated', 0, 'skipped_existing', 0, 'rejected', 0, 'errors', 0, 'error_messages', '[]'::jsonb);

      for v_row in select * from jsonb_array_elements(p_rows->v_table) loop
        begin
          -- حماية أساسية: أي صف يخص مدرّساً آخر يُرفض نهائياً
          if v_row ? 'teacher_id' and v_row->>'teacher_id' is not null
             and v_row->>'teacher_id' <> p_teacher_id::text then
            v_summary := jsonb_set(v_summary, '{rejected}', to_jsonb((v_summary->>'rejected')::int + 1));
            continue;
          end if;

          v_row_id := v_row->>'id';
          v_id := null;
          if v_row_id is not null then
            begin
              v_id := v_row_id::uuid;
            exception when others then
              v_id := null;
            end;
          end if;

          execute format('select exists (select 1 from public.%I where id = $1)', v_table) into v_exists using v_id;

          if v_exists then
            if p_strategy = 'overwrite' then
              -- تحديث الأعمدة الموجودة في الصف فقط (باستثناء id)
              select array_agg(key) into v_cols
              from jsonb_object_keys(v_row) key
              where key <> 'id' and not (key = 'teacher_id');
              if v_cols is not null then
                v_set_clause := '';
                foreach v_col in array v_cols loop
                  if v_set_clause <> '' then v_set_clause := v_set_clause || ', '; end if;
                  v_set_clause := v_set_clause || format('%I = src.%I', v_col, v_col);
                end loop;
                v_json_value := v_row::text;
                execute format(
                  'update public.%I set %s from (select * from jsonb_populate_record(null::public.%I, $1)) as src where public.%I.id = $2',
                  v_table, v_set_clause, v_table, v_table
                ) using v_json_value::jsonb, v_id;
              end if;
              v_summary := jsonb_set(v_summary, '{updated}', to_jsonb((v_summary->>'updated')::int + 1));
            else
              v_summary := jsonb_set(v_summary, '{skipped_existing}', to_jsonb((v_summary->>'skipped_existing')::int + 1));
            end if;
          else
            execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', v_table, v_table)
              using v_row;
            v_summary := jsonb_set(v_summary, '{inserted}', to_jsonb((v_summary->>'inserted')::int + 1));
          end if;
        exception when others then
          v_summary := jsonb_set(v_summary, '{errors}', to_jsonb((v_summary->>'errors')::int + 1));
          v_summary := jsonb_set(v_summary, '{error_messages}',
            (v_summary->'error_messages') || to_jsonb(left(sqlerrm, 200)));
        end;
      end loop;

      v_result := v_result || jsonb_build_object(v_table, v_summary);
    end if;
  end loop;

  insert into admin_audit_logs (admin_user_id, target_user_id, action, reason, details, metadata)
  values (auth.uid(), p_teacher_id, 'restore_applied', 'استعادة بيانات من نسخة احتياطية',
          'استعادة انتقائية — الاستراتيجية: ' || p_strategy,
          jsonb_build_object('backup_id', p_backup_id, 'strategy', p_strategy, 'result', v_result));

  return v_result;
end;
$function$
;


grant execute on function public.admin_restore_apply(uuid,uuid,jsonb,text) to public;
