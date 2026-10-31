#!/usr/bin/env python3
"""Deep-audit probe — READ-ONLY production introspection for migration 054
design. Fetches current RPC definitions, indexes, and support structures.
Never prints the token."""
import json, sys, urllib.request, urllib.error

BASE = 'https://api.supabase.com/v1'
REF = 'pbsythpzncjoafpmijyd'

FUNCS = [
    'get_accounts_summary', 'upsert_lesson_attendance', 'upsert_lesson_homework',
    'get_student_portal_data', 'mark_notification_read', 'get_student_standalone_exams',
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
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:800]


def sql(query, timeout=300):
    st, body = api('POST', f'/projects/{REF}/database/query', {'query': query}, timeout)
    if st not in (200, 201):
        print(f'!! SQL FAILED ({st}): {json.dumps(body)[:400]}')
        return None
    return body


def main():
    out = {}
    # 1) function definitions + grants
    flist = ', '.join(f"'{f}'" for f in FUNCS)
    rows = sql(f"""
      select p.proname, pg_get_function_identity_arguments(p.oid) as args,
             p.prosecdef, pg_get_userbyid(p.proowner) as owner,
             pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ({flist})
      order by p.proname""")
    if rows is not None:
        out['functions'] = rows
        for r in rows:
            print(f"### {r['proname']} ({r['args']}) secdef={r['prosecdef']} len={len(r['def'])}")
    # 2) grants on those functions
    rows = sql(f"""
      select p.proname, g.grantee, g.privilege_type
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
           information_schema.routine_privileges g
      where g.specific_schema='public' and g.specific_name = p.proname
        and p.proname in ({flist}) and g.grantee in ('anon','authenticated')
      order by p.proname, g.grantee""")
    if rows is not None:
        out['grants'] = rows
        print('GRANTS:', json.dumps(rows))
    # 3) existing indexes on hot tables
    rows = sql("""
      select tablename, indexname, indexdef from pg_indexes
      where schemaname='public' and tablename in
        ('exam_scores','attendance_records','behavior_logs','standalone_exam_scores')
      order by tablename, indexname""")
    if rows is not None:
        out['indexes'] = rows
        for r in rows:
            print(f"IDX {r['tablename']}: {r['indexdef']}")
    # 4) student_qr_tokens columns + assistant structures
    rows = sql("""
      select table_name, column_name, data_type from information_schema.columns
      where table_schema='public' and table_name in ('student_qr_tokens','assistant_requests','workspace_members')
      order by table_name, ordinal_position""")
    if rows is not None:
        out['columns'] = rows
    rows = sql("select count(*) as n from public.assistant_requests")
    out['assistant_requests_count'] = rows
    rows = sql("select count(*) as n from public.workspace_members")
    out['workspace_members_count'] = rows
    # 5) edge function current config
    st, fns = api('GET', f'/projects/{REF}/functions')
    if st == 200:
        out['edge_functions'] = [{k: f.get(k) for k in ('slug', 'verify_jwt', 'status')} for f in fns]
        print('EDGE:', json.dumps(out['edge_functions']))
    # 6) existing secrets (names only)
    st, secs = api('GET', f'/projects/{REF}/secrets')
    if st == 200:
        out['secret_names'] = [s.get('name') for s in secs]
        print('SECRET NAMES:', out['secret_names'])
    with open('/home/z/my-project/scripts/audit54_probe_out.json', 'w') as f:
        json.dump(out, f, indent=1, default=str)
    print('saved -> scripts/audit54_probe_out.json')


if __name__ == '__main__':
    main()
