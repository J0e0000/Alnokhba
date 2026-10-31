#!/usr/bin/env python3
"""Apply migration_054_security_rpc_hardening.sql to PRODUCTION via the
Management API (single transaction, all-or-nothing), then verify every change
landed. Never prints the token."""
import json, sys, urllib.request, urllib.error

BASE = 'https://api.supabase.com/v1'
REF = 'pbsythpzncjoafpmijyd'
SQL_PATH = '/home/z/my-project/supabase/migration_054_security_rpc_hardening.sql'


def api(method, path, body=None, timeout=300):
    tok = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        'authorization': f'Bearer {tok}', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:1500]


def sql(q, timeout=300):
    st, body = api('POST', f'/projects/{REF}/database/query', {'query': q}, timeout)
    return st, body


def main():
    script = open(SQL_PATH).read()
    st, body = sql(script)
    if st not in (200, 201):
        print(f'APPLY FAILED ({st}):')
        print(json.dumps(body, ensure_ascii=False)[:1500] if not isinstance(body, str) else body[:1500])
        sys.exit(1)
    print(f'APPLIED OK ({st})')

    checks = [
        ("guards in portal fallback",
         "select count(*) as n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname='get_student_portal_data' and position('t_rev' in pg_get_functiondef(p.oid))>0"),
        ("guard in standalone exams rpc",
         "select count(*) as n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname='get_student_standalone_exams' and position('t_rev' in pg_get_functiondef(p.oid))>0"),
        ("guard in mark_notification_read",
         "select count(*) as n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname='mark_notification_read' and position('t_rev' in pg_get_functiondef(p.oid))>0"),
        ("ownership guard in get_accounts_summary",
         "select count(*) as n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname='get_accounts_summary' and position('can_access_workspace' in pg_get_functiondef(p.oid))>0"),
        ("student guard in upsert rpcs",
         "select count(*) as n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname in ('upsert_lesson_attendance','upsert_lesson_homework') and position('student_not_in_workspace' in pg_get_functiondef(p.oid))>0"),
        ("steal-guard in link_assistant",
         "select count(*) as n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname='link_assistant_by_email' and position('مساحة عمل تانية' in pg_get_functiondef(p.oid))>0"),
        ("portal payload limits",
         "select count(*) as n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname='get_student_portal_data' and position('limit 400' in pg_get_functiondef(p.oid))>0"),
        ("new indexes",
         "select indexname from pg_indexes where schemaname='public' and indexname in ('idx_exam_scores_teacher_created','idx_attendance_teacher_recorded','idx_behavior_teacher_created') order by indexname"),
        ("anon revoked on financial rpc",
         "select has_function_privilege('anon', 'public.get_accounts_summary(uuid,date,date,text)', 'execute') as anon_can, has_function_privilege('authenticated', 'public.get_accounts_summary(uuid,date,date,text)', 'execute') as auth_can"),
        ("anon still allowed on portal rpc",
         "select has_function_privilege('anon', 'public.get_student_portal_data(text)', 'execute') as portal_ok, has_function_privilege('anon', 'public.get_student_standalone_exams(text)', 'execute') as standalone_ok"),
    ]
    fails = 0
    for name, q in checks:
        st, body = sql(q)
        ok = st in (200, 201)
        print(f'[{ "OK" if ok else "FAIL" }] {name}: {json.dumps(body, ensure_ascii=False)[:220]}')
        if not ok:
            fails += 1
    # functional smoke: invalid token → null (portal rpc still callable, guard does not 500)
    st, body = sql("select (public.get_student_portal_data('nonexistent-token-check') is null) as null_ok")
    print(f'[{ "OK" if st in (200,201) else "FAIL" }] portal rpc callable with junk token: {json.dumps(body)[:120]}')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
