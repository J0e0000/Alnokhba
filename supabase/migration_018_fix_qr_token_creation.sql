-- ============================================================================
-- نظام النخبة — Migration 018: إصلاح إنشاء توكن QR للمدرّس المسجّل دخول
-- ============================================================================
-- المشكلة: لما المدرّس يدوس "إرسال QR"، الكود بيعمل INSERT في جدول
-- student_qr_tokens. سياسة الإدراج (qr_token_teacher_insert) بتتحقق:
--
--   exists (select 1 from students
--           where students.id = student_qr_tokens.student_id
--             and students.teacher_id = auth.uid())
--
-- المشكلة إن الـ SELECT جوه الـ EXISTS بيشتغل تحت RLS على جدول students،
-- وسياسة students_workspace_access بتمنع القراءة إلا لو:
--   can_access_workspace(teacher_id) = true
-- يعني لو أي سياسة تانية (زي workspace_access) ما إتطبقتش على المستخدم
-- الحالي لأي سبب، الـ EXISTS بترجع false → INSERT بيترفض → التوكن ما
-- بينشأش → الكود بيطلع رسالة "تأكد إنك داخل بحسابك" للطالب.
--
-- نفس المشكلة ممكن تحصل لو:
--   - الجلسة (session) انتهت من غير ما الـ client يلاحظ
--   - مفيش سياسة can_access_workspace بتغطّي الـ edge case ده
--   - الـ RLS على students فيها تعارض بين policies
--
-- الحل: نعمل دالة RPC بـ SECURITY DEFINER (بتشتغل بصلاحيات الـ owner،
-- يعني بتتجاوز RLS تمامًا). الدالة بتتحقق بنفسها إن:
--   1. المستخدم مسجّل دخول (auth.uid() is not null)
--   2. المستخدم هو صاحب الطالب (owner) أو مساعد مربوط بيه
--   3. اشتراك صاحب البيانات ساري
-- وبعدين بتنشئ التوكن أو ترجع الموجود. ده نفس النمط اللي شغّال بنجاح في
-- mark_homework_done (migration_015).
-- ============================================================================

create or replace function public.get_or_create_student_qr_token(p_student_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_token text;
  v_new_token text;
  v_owner_id uuid;
  v_chars text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  v_arr bytea;
begin
  -- 1) Must be authenticated
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- 2) Find the student's owner (teacher_id), bypassing RLS so we can
  --    verify ownership even if the students table RLS is restrictive.
  --    This is safe because we never RETURN the student row — we only
  --    use the teacher_id internally for the ownership check.
  select students.teacher_id into v_owner_id
  from public.students
  where students.id = p_student_id;

  if v_owner_id is null then
    raise exception 'student_not_found';
  end if;

  -- 3) Verify the caller is the owner OR a workspace assistant of the owner,
  --    AND that the owner's subscription is active. We re-use the same
  --    can_access_workspace() helper so the rules stay identical to the
  --    rest of the app.
  if not public.can_access_workspace(v_owner_id) then
    raise exception 'not_authorized';
  end if;

  -- 4) Return existing active token if any (cheap path — no insert)
  select token into v_existing_token
  from public.student_qr_tokens
  where student_id = p_student_id
    and revoked_at is null
  limit 1;

  if v_existing_token is not null then
    return v_existing_token;
  end if;

  -- 5) No existing token — generate a new 20-char random token.
  --    Using gen_random_bytes (pgcrypto) for server-side randomness.
  v_arr := gen_random_bytes(20);
  v_new_token := '';
  for i in 0..19 loop
    v_new_token := v_new_token || substr(v_chars, (get_byte(v_arr, i) % 36) + 1, 1);
  end loop;

  -- 6) Insert. If a race condition causes a unique violation on the
  --    partial unique index (one active token per student), re-read.
  begin
    insert into public.student_qr_tokens (student_id, token)
    values (p_student_id, v_new_token);
    return v_new_token;
  exception when unique_violation then
    select token into v_existing_token
    from public.student_qr_tokens
    where student_id = p_student_id
      and revoked_at is null
    limit 1;
    if v_existing_token is not null then
      return v_existing_token;
    end if;
    -- Should not happen, but as a last resort return the one we generated
    -- (the insert above may have actually succeeded just before raising).
    return v_new_token;
  end;
end;
$$;

-- Allow any authenticated user to call it (the function itself checks ownership).
grant execute on function public.get_or_create_student_qr_token(uuid) to authenticated;

-- ============================================================================
-- Optional: also make sure the existing RLS policies on student_qr_tokens
-- don't get in the way of NORMAL reads (the .select() in getOrCreateStudentToken).
-- The public read policy from migration_014 already covers this, so no change
-- needed. The RPC is only needed for the INSERT path.
-- ============================================================================
