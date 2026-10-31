#!/usr/bin/env python3
"""Build supabase/migration_054_security_rpc_hardening.sql from the LIVE
production function definitions (fetched via Management API). Every patch is
anchored — the builder aborts loudly if an anchor is missing. Read-only on DB;
writes only the local .sql file."""
import json, re, sys, urllib.request, urllib.error

BASE = 'https://api.supabase.com/v1'
REF = 'pbsythpzncjoafpmijyd'
FUNCS = [
    'get_student_portal_data', 'get_student_standalone_exams', 'mark_notification_read',
    'get_accounts_summary', 'upsert_lesson_attendance', 'upsert_lesson_homework',
    'link_assistant_by_email',
]


def api(method, path, body=None, timeout=300):
    tok = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        'authorization': f'Bearer {tok}', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]


def fetch_defs():
    flist = ', '.join(f"'{f}'" for f in FUNCS)
    q = (f"select p.proname, pg_get_function_identity_arguments(p.oid) as args, "
         f"pg_get_functiondef(p.oid) as def from pg_proc p "
         f"join pg_namespace n on n.oid = p.pronamespace "
         f"where n.nspname='public' and p.proname in ({flist}) order by p.proname")
    st, rows = api('POST', f'/projects/{REF}/database/query', {'query': q})
    if st not in (200, 201):
        print('FETCH FAILED', st, rows); sys.exit(1)
    rows = {r['proname']: r for r in rows}
    # live bodies were uploaded with CRLF line endings — normalize so the
    # anchored patches match; SQL line endings are insignificant.
    for r in rows.values():
        r['def'] = r['def'].replace('\r\n', '\n')
    return rows


REVOKED_GUARD = "and not exists (select 1 from student_qr_tokens t_rev where t_rev.student_id = s.id and t_rev.revoked_at is not null)"


def patch_portal(defn):
    """get_student_portal_data: revocation-aware UUID fallback + bounded history."""
    out, n = defn, 0
    # 1) fallback guard (unique anchor: the bare students select in the fallback)
    anchor = "from students s where s.id = p_token::uuid limit 1;"
    if anchor not in out:
        print('PORTAL: fallback anchor missing'); sys.exit(1)
    out = out.replace(anchor, f"from students s where s.id = p_token::uuid {REVOKED_GUARD} limit 1;")
    n += 1
    # 2) v_attendance distinct-on subquery → cap at 400 latest days
    anchor = "order by coalesce(ls.session_date, (ar.recorded_at at time zone 'UTC')::date) desc, ar.recorded_at desc\n  ) q;"
    if anchor not in out:
        print('PORTAL: attendance subquery anchor missing'); sys.exit(1)
    out = out.replace(anchor, anchor.replace(') q;', 'limit 400\n  ) q;'))
    n += 1
    # 3) bounded source selects (order-by mirrors the jsonb_agg order, then limit)
    bounded = [
        ("  ) order by ar.recorded_at desc), '[]'::jsonb) into v_lesson_attendance\n  from attendance_records ar\n  inner join lesson_sessions ls on ls.id = ar.lesson_session_id\n  where ar.student_id = v_student.id and ar.teacher_id = v_teacher_id;",
         "  ) order by ar.recorded_at desc), '[]'::jsonb) into v_lesson_attendance\n  from attendance_records ar\n  inner join lesson_sessions ls on ls.id = ar.lesson_session_id\n  where ar.student_id = v_student.id and ar.teacher_id = v_teacher_id\n  order by ar.recorded_at desc limit 200;"),
        ("  ) order by bl.created_at desc), '[]'::jsonb) into v_behavior\n  from behavior_logs bl\n  where bl.student_id = v_student.id and bl.teacher_id = v_teacher_id;",
         "  ) order by bl.created_at desc), '[]'::jsonb) into v_behavior\n  from behavior_logs bl\n  where bl.student_id = v_student.id and bl.teacher_id = v_teacher_id\n  order by bl.created_at desc limit 100;"),
        ("  ) order by an.created_at desc), '[]'::jsonb) into v_announcements\n  from announcements an\n  where an.teacher_id = v_teacher_id\n    and (an.student_id is null or an.student_id = v_student.id);",
         "  ) order by an.created_at desc), '[]'::jsonb) into v_announcements\n  from announcements an\n  where an.teacher_id = v_teacher_id\n    and (an.student_id is null or an.student_id = v_student.id)\n  order by an.created_at desc limit 50;"),
        ("  ) order by es.created_at desc), '[]'::jsonb) into v_exam_scores\n  from exam_scores es\n  inner join exams ex on ex.id = es.exam_id\n  where es.student_id = v_student.id and es.teacher_id = v_teacher_id;",
         "  ) order by es.created_at desc), '[]'::jsonb) into v_exam_scores\n  from exam_scores es\n  inner join exams ex on ex.id = es.exam_id\n  where es.student_id = v_student.id and es.teacher_id = v_teacher_id\n  order by es.created_at desc limit 150;"),
        ("  ) order by ex.created_at desc), '[]'::jsonb) into v_exams\n  from exams ex where ex.teacher_id = v_teacher_id;",
         "  ) order by ex.created_at desc), '[]'::jsonb) into v_exams\n  from exams ex where ex.teacher_id = v_teacher_id\n  order by ex.created_at desc limit 100;"),
        ("  ) order by ht.created_at desc), '[]'::jsonb) into v_homework_tasks\n  from homework_tasks ht\n  where ht.teacher_id = v_teacher_id and ht.group_name = v_student.group_name;",
         "  ) order by ht.created_at desc), '[]'::jsonb) into v_homework_tasks\n  from homework_tasks ht\n  where ht.teacher_id = v_teacher_id and ht.group_name = v_student.group_name\n  order by ht.created_at desc limit 100;"),
    ]
    for old, new in bounded:
        if old not in out:
            print(f'PORTAL: bounded-select anchor missing: {old[:80]!r}'); sys.exit(1)
        out = out.replace(old, new); n += 1
    return out, n


def patch_standalone(defn):
    anchor = "from public.students s\n    where s.id = p_token::uuid\n    limit 1;"
    if anchor not in defn:
        print('STANDALONE: fallback anchor missing'); sys.exit(1)
    guard = "from public.students s\n    where s.id = p_token::uuid\n      and not exists (select 1 from public.student_qr_tokens t_rev where t_rev.student_id = s.id and t_rev.revoked_at is not null)\n    limit 1;"
    return defn.replace(anchor, guard), 1


def patch_mark_read(defn):
    anchor = "select id into v_student_id from students where id = p_token::uuid limit 1;"
    if anchor not in defn:
        print('MARK_READ: fallback anchor missing'); sys.exit(1)
    new = ("select id into v_student_id from students where id = p_token::uuid\n"
           "      and not exists (select 1 from student_qr_tokens t_rev where t_rev.student_id = students.id and t_rev.revoked_at is not null)\n"
           "    limit 1;")
    return defn.replace(anchor, new), 1


def patch_accounts(defn):
    anchor = "begin\n"
    idx = defn.find(anchor)
    if idx == -1:
        print('ACCOUNTS: begin anchor missing'); sys.exit(1)
    guard = ("begin\n"
             "  -- AUDIT 2026-10 (S2): financial summary was callable by ANY authenticated\n"
             "  -- user (security definer, no ownership check). Restrict to the workspace\n"
             "  -- itself: owner, workspace member, or active support session.\n"
             "  if not coalesce(public.can_access_workspace(p_teacher_id), false) then\n"
             "    raise exception 'not_authorized';\n"
             "  end if;\n")
    return defn[:idx] + guard + defn[idx + len(anchor):], 1


def patch_upsert(defn, name):
    anchor = "  if not public.can_access_workspace(v_teacher_id) then\n    raise exception 'not_authorized';\n  end if;\n"
    if anchor not in defn:
        print(f'{name}: workspace-check anchor missing'); sys.exit(1)
    guard = anchor + (
        "\n  -- AUDIT 2026-10 (S7): the student must belong to THIS workspace — blocks\n"
        "  -- pairing a local session/homework row with another teacher's student UUID.\n"
        "  if not exists (select 1 from public.students s where s.id = p_student_id and s.teacher_id = v_teacher_id) then\n"
        "    raise exception 'student_not_in_workspace';\n"
        "  end if;\n")
    return defn.replace(anchor, guard), 1


LINK_BODY = """declare
  target_id uuid;
begin
  select id into target_id from auth.users where email = assistant_email;
  if target_id is null then
    raise exception 'لا يوجد حساب مسجّل بهذا الإيميل';
  end if;
  if target_id = auth.uid() then
    raise exception 'مينفعش تربط حسابك بنفسه';
  end if;
  -- AUDIT 2026-10 (S5): hardening of the assistant-binding path.
  -- (a) cannot bind an account that runs its OWN workspace: linking flips the
  --     target's my_workspace_owner to the caller — an account with its own
  --     students/groups loses access to its own data (verified live: one
  --     bound member owns 29 students).
  if exists (select 1 from public.students s where s.teacher_id = target_id)
     or exists (select 1 from public.groups g where g.teacher_id = target_id) then
    raise exception 'الحساب ده عليه مركزه الخاص — مش ممكن يتربط كمساعد';
  end if;
  -- (b) never STEAL a bound assistant: the old on-conflict re-point hijacked
  --     the assistant's whole workspace view to a new owner without consent.
  if exists (select 1 from public.workspace_members w where w.member_id = target_id and w.owner_id <> auth.uid()) then
    raise exception 'الحساب ده مرتبط بالفعل بمساحة عمل تانية';
  end if;
  insert into workspace_members (owner_id, member_id)
  values (auth.uid(), target_id)
  on conflict (member_id) do update set owner_id = excluded.owner_id;
end;"""


def relink(defn):
    m = re.search(r"\$function$\n(.*)\$function$$", defn, re.S)
    return defn, 0  # replaced wholesale below


def main():
    defs = fetch_defs()
    missing = [f for f in FUNCS if f not in defs]
    if missing:
        print('MISSING FUNCTIONS:', missing); sys.exit(1)
    patches = []
    total = 0
    for name, fn in [('get_student_portal_data', patch_portal),
                     ('get_student_standalone_exams', patch_standalone),
                     ('mark_notification_read', patch_mark_read),
                     ('get_accounts_summary', patch_accounts),
                     ('upsert_lesson_attendance', lambda d: patch_upsert(d, 'upsert_lesson_attendance')),
                     ('upsert_lesson_homework', lambda d: patch_upsert(d, 'upsert_lesson_homework'))]:
        out, n = fn(defs[name]['def'])
        patches.append((name, defs[name]['args'], out))
        total += n
        print(f'patched {name}: {n} edit(s)')
    # link_assistant_by_email: replace the whole body between the $$ markers
    la = defs['link_assistant_by_email']['def']
    m = re.search(r"^(.*\$function\$\n)\s*(.*)\s*\n(\$function\$$)", la, re.S)
    if not m:
        print('LINK: body markers not found'); sys.exit(1)
    la_new = m.group(1) + LINK_BODY + '\n' + m.group(3)
    patches.append(('link_assistant_by_email', defs['link_assistant_by_email']['args'], la_new))
    total += 1
    print(f'patched link_assistant_by_email: body replaced')

    header = """-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION 054 — security RPC hardening + hot-path indexes (deep product audit)
-- Generated 2026-10-23 from the LIVE production function definitions via the
-- Management API (scripts/audit54_build_migration.py). Idempotent:
-- create-or-replace keeps every identity signature, indexes use IF NOT EXISTS.
--
-- Contents:
--   1. get_student_portal_data / get_student_standalone_exams /
--      mark_notification_read: legacy UUID-fallback now honors QR-token
--      REVOCATION (block only when a revoked token exists — 1069/1822
--      students have no token row, the fallback is load-bearing) + bounded
--      portal history arrays (payload/perf).
--   2. get_accounts_summary: ownership guard (was IDOR — any authenticated
--      user could read any teacher's financials). Function unused by the UI.
--   3. upsert_lesson_attendance / upsert_lesson_homework: student-ownership
--      check (student must belong to the lesson's workspace).
--   4. link_assistant_by_email: only assistant accounts bindable + cannot
--      steal a bound assistant from another owner.
--   5. Grants: financial/admin-path functions revoked from anon+public.
--   6. Three hot-path indexes: exam_scores(teacher_id, created_at desc),
--      attendance_records(teacher_id, recorded_at desc),
--      behavior_logs(teacher_id, created_at desc).
-- No data is read, modified, or deleted. Fully reversible by re-deploying the
-- previous function bodies (worklog preserves the audit probe output).
-- ═══════════════════════════════════════════════════════════════════════
set check_function_bodies = false;

"""
    parts = [header]
    for name, args, body in patches:
        # pg_get_functiondef emits the statement WITHOUT a trailing semicolon
        parts.append(f"-- ── {name} ({args}) ──────────────────────────────────────────────\n{body};\n")
    parts.append("""
-- ── grants: close the anon/public paths on non-portal RPCs ──────────────
revoke execute on function public.get_accounts_summary(uuid, date, date, text) from anon, public;
revoke execute on function public.link_assistant_by_email(text) from anon, public;
revoke execute on function public.upsert_lesson_attendance(uuid, uuid, text) from anon, public;
revoke execute on function public.upsert_lesson_homework(uuid, uuid, text) from anon, public;
grant execute on function public.get_accounts_summary(uuid, date, date, text) to authenticated;
grant execute on function public.link_assistant_by_email(text) to authenticated;
grant execute on function public.upsert_lesson_attendance(uuid, uuid, text) to authenticated;
grant execute on function public.upsert_lesson_homework(uuid, uuid, text) to authenticated;

-- ── hot-path indexes (audit PF2): every-boot loadAll scans ──────────────
create index if not exists idx_exam_scores_teacher_created
  on public.exam_scores (teacher_id, created_at desc);
create index if not exists idx_attendance_teacher_recorded
  on public.attendance_records (teacher_id, recorded_at desc);
create index if not exists idx_behavior_teacher_created
  on public.behavior_logs (teacher_id, created_at desc);
""")
    out_path = '/home/z/my-project/supabase/migration_054_security_rpc_hardening.sql'
    open(out_path, 'w').write('\n'.join(parts))
    print(f'WROTE {out_path} — {total} patches, {len(patches)} functions')


if __name__ == '__main__':
    main()
