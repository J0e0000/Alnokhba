-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 059 — teacher notification hygiene (Task 44i)
-- المشكلة اللي أبلغ عنها المستر:
--   1) «عايزك تخليها لما ادوس عليها خلاص تبقي read» — الضغط على التنبيه
--      مبيتحفظش: صفر صفوف مقروءة من أصل 10,908 في الإنتاج. السبب: سياسة RLS
--      can_access_workspace() بترفض الحسابات اللي اشتراكها مش trial/active
--      (14 expired + 5 cancelled من 25) فبيبقى الـ UPDATE بيتصفّر بصمت
--      (0 rows، من غير error) والواجهة بتفل تاني بعد أي reload.
--   2) «ميظهرليش غير الرسايل اللي اتبعتت بعد ما سجلت مش قبل» — مفيش حد
--      زمني على التنبيهات + الجسر بيعيد إرسال رسايل المدرس نفسه كنسخ لكل طالب.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) الجسر: مفيش صدى لرسايل المدرس نفسه ──────────────────────────────────
-- announcement: الإعلانات بتبعت للطالب من إجراء المدرس (notify_announcement
--   بيرفع تنبيه للمدرس مباشرة) — الإعادة = سبام.
-- homework: إشعار «في واجب نزل» المدرس هو اللي بعتّه — مرة واحدة تكفي.
-- exam_result: نتيجة الامتحان بتوصل المدرس من notify_exam_result مباشرة
--   («رصد درجة امتحان») — صدى «نتيجة امتحان جديدة» تكرار.
-- الحضور والدفعات فضلت زي ما هي (تأكيدات حقيقية بتستحق Push).
create or replace function public.bridge_student_notification_to_teacher_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- لوحة الإعلانات + رسايل المدرس الخاصة بالواجبات/النتايج: لا صدى.
  if coalesce(new.category, 'general') in ('announcement', 'homework', 'exam_result') then
    return new;
  end if;

  insert into public.teacher_notification_events (
    teacher_id,
    event_type,
    title,
    body,
    related_student_id,
    category
  ) values (
    new.teacher_id,
    case
      when new.category = 'payment' then 'payment_recorded'
      when new.category = 'attendance' then 'other'
      else 'student_insight'
    end,
    coalesce(new.title, 'تنبيه جديد'),
    coalesce(new.body, ''),
    new.student_id,
    coalesce(new.category, 'general')
  );
  return new;
end;
$$;

-- ── 2) RPC محصّن لتحديد التنبيه كمقروء ─────────────────────────────────────
-- SECURITY DEFINER عشان تحديث «مقروء» يشتغل دايمًا حتى لو اشتراك المدرس
-- مش active حاليًا (كان بيندفع بصمت من سياسة RLS). التحقق عضوية الورك سبيس
-- بيتم مباشرة: صاحب التنبيه نفسه أو عضو في نفس الورك سبيس.
-- الاستخدام:
--   p_event_id + p_title/p_body  → يقرأ التنبيه + كل النسخ المطابقة له
--   p_event_id فقط              → يقرأ تنبيه واحد بالمعرّف
--   كلها null                   → قراءة الكل (mark all read)
create or replace function public.mark_teacher_events_read(
  p_event_id uuid default null,
  p_title text default null,
  p_body text default null
)
returns integer
language plpgsql
security definer
set search_path to public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.teacher_notification_events e
     set is_read = true
   where e.is_read = false
     and (
       e.teacher_id = v_uid
       or exists (
         select 1 from public.workspace_members m
         where m.owner_id = e.teacher_id
           and m.member_id = v_uid
       )
     )
     and (
       (p_event_id is not null and e.id = p_event_id)
       or (p_title is not null and e.title = p_title
           and coalesce(e.body, '') = coalesce(p_body, ''))
     );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.mark_teacher_events_read(uuid, text, text) to authenticated;
revoke execute on function public.mark_teacher_events_read(uuid, text, text) from anon;
revoke execute on function public.mark_teacher_events_read(uuid, text, text) from public;

-- ── 3) تنظيف لمرة واحدة: تنبيهات أقدم من 60 يوم ────────────────────────────
-- صدى حضور ودفعات قديم بقايا تراكمية — مالهاش قيمة تشغيلية وبتثقل القايمة.
delete from public.teacher_notification_events
where created_at < now() - interval '60 days';
