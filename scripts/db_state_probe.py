#!/usr/bin/env python3
"""DB state via Management API on pbsyth: migrations list, portal functions, RLS policy state."""
import json, ssl, urllib.request, urllib.error

REF = 'pbsythpzncjoafpmijyd'
AT = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
ctx = ssl.create_default_context()

def api(path, method='GET', body=None):
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/{path}',
        method=method,
        headers={'Authorization': f'Bearer {AT}', 'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body else None)
    try:
        with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')[:500]

def query(sql):
    st, body = api('database/query', 'POST', {'query': sql})
    try:
        return st, json.loads(body)
    except Exception:
        return st, body[:400]

# 1) migrations applied (tail)
st, mig = api('database/migrations')
if st == 200:
    if isinstance(mig, dict):
        mig = mig.get('data') or mig.get('migrations') or []
    names = sorted([m if isinstance(m, str) else (m.get('name') or m.get('version') or str(m)) for m in mig])
    print(f"applied migrations: {len(names)}")
    print("  tail:", [n for n in names if any(t in n for t in ('05', '06'))][-14:])
else:
    print(f"migrations: HTTP {st} {mig[:200]}")

# 2) portal RPC functions existence
st, rows = query("""
select proname, pronargs, pg_get_function_arguments(oid) as args
from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('get_student_stage_schedule','get_student_portal_data','stage_category_of')
order by proname;
""")
print(f"\nportal functions (HTTP {st}):", json.dumps(rows, ensure_ascii=False)[:400] if st == 200 else rows)

# 3) RLS state on sensitive tables
st, rows = query("""
select c.relname, c.relrowsecurity as rls,
  (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('student_qr_tokens','students','attendance','exam_scores','lectures','lesson_sessions','groups','teacher_settings','admin_email_config','edge_rate_limits')
order by c.relname;
""")
print(f"\nRLS state (HTTP {st}):")
if st == 200:
    for r in rows:
        print(f"  {r['relname']}: rls={r['rls']} policies={r['policies']}")
else:
    print(' ', rows)

# 4) student_qr_tokens policies detail
st, rows = query("""
select policyname, cmd, roles, qual is not null as has_using, with_check is not null as has_check
from pg_policies where tablename = 'student_qr_tokens';
""")
print(f"\nstudent_qr_tokens policies (HTTP {st}):", json.dumps(rows, ensure_ascii=False)[:500] if st == 200 else rows)

# 5) quick data sanity: counts
st, rows = query("select (select count(*) from students) students, (select count(*) from student_qr_tokens) tokens, (select count(*) from groups) groups;")
print(f"\ncounts (HTTP {st}):", json.dumps(rows, ensure_ascii=False)[:200] if st == 200 else rows)
