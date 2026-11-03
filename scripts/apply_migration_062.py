#!/usr/bin/env python3
"""Apply migration_062 to production pbsyth via Management API (preflight -> apply -> verify)."""
import json, ssl, urllib.request, urllib.error

REF = 'pbsythpzncjoafpmijyd'
AT = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
SQL = open('/home/z/my-project/supabase/migration_062_stage_lecture_table.sql', encoding='utf-8').read()
ctx = ssl.create_default_context()

def query(sql):
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query',
        method='POST', headers={'Authorization': f'Bearer {AT}', 'Content-Type': 'application/json'},
        data=json.dumps({'query': sql}).encode())
    try:
        with urllib.request.urlopen(req, timeout=120, context=ctx) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')[:600]

# ── PREFLIGHT ────────────────────────────────────────────────────────────────
st, body = query("""
select
  to_regclass('public.group_schedule') as group_schedule,
  to_regclass('public.groups') as groups,
  to_regclass('public.students') as students,
  to_regclass('public.student_qr_tokens') as tokens,
  exists(select 1 from information_schema.columns where table_name='students' and column_name='stage') as has_stage,
  exists(select 1 from information_schema.columns where table_name='student_qr_tokens' and column_name='revoked_at') as has_revoked,
  exists(select 1 from information_schema.columns where table_name='group_schedule' and column_name='weekday') as has_weekday;
""")
print(f"PREFLIGHT HTTP {st}: {body[:400]}")
if st not in (200, 201):
    raise SystemExit('preflight failed')

checks = json.loads(body)[0]
ok = all([checks['group_schedule'], checks['groups'], checks['students'], checks['tokens'],
          checks['has_stage'], checks['has_revoked'], checks['has_weekday']])
print("preflight ok:", ok, checks)
if not ok:
    raise SystemExit('ABORT: missing prerequisites for migration 062')

# ── APPLY ────────────────────────────────────────────────────────────────────
st, body = query(SQL)
print(f"\nAPPLY HTTP {st}: {body[:500]}")
if st not in (200, 201):
    raise SystemExit('apply failed')

# ── VERIFY ───────────────────────────────────────────────────────────────────
st, body = query("""
select p.proname, p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_exec
from pg_proc p where p.pronamespace='public'::regnamespace
  and p.proname in ('get_student_stage_schedule','stage_category_of');
""")
print(f"\nVERIFY funcs HTTP {st}: {body[:300]}")
if st not in (200, 201):
    raise SystemExit('verify query failed')

# behavior: dummy token must return null (not error), empty stage must return empty schedule
import urllib.request as ur
ANON = open('/tmp/anonkey.txt').read().strip()
def rpc(fn, payload):
    req = urllib.request.Request(f'https://{REF}.supabase.co/rest/v1/rpc/{fn}', method='POST',
        headers={'apikey': ANON, 'Authorization': f'Bearer {ANON}', 'Content-Type': 'application/json'},
        data=json.dumps(payload).encode())
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            return r.status, r.read().decode()[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

st, body = rpc('get_student_stage_schedule', {'p_token': 'definitely-not-a-real-token-xyz'})
print(f"RPC dummy token: HTTP {st} -> {body[:200]}")
st, body = rpc('get_student_stage_schedule', {'p_token': ''})
print(f"RPC empty token: HTTP {st} -> {body[:200]}")
