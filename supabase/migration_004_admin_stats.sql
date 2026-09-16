-- ============================================================================
-- نظام الفارس — Migration 004: إحصائيات الأدمن (عدد الطلاب + آخر نشاط)
-- ============================================================================
-- دالة بترجع أرقام مجمّعة بس (عدد الطلاب، آخر نشاط) من غير ما تكشف أي بيانات
-- تفصيلية عن طلاب أي مدرّس — بتفضل خصوصية بياناتهم محفوظة حتى منك.
-- شغّلها في Supabase → SQL Editor → New query → Run
-- ============================================================================

create or replace function admin_teacher_stats()
returns table(teacher_id uuid, student_count bigint, last_activity timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_user() then
    raise exception 'not authorized';
  end if;

  return query
    select
      p.id as teacher_id,
      count(distinct s.id)::bigint as student_count,
      greatest(max(s.created_at), max(bl.created_at)) as last_activity
    from profiles p
    left join students s on s.teacher_id = p.id
    left join behavior_logs bl on bl.teacher_id = p.id
    group by p.id;
end;
$$;

grant execute on function admin_teacher_stats() to authenticated;
