#!/usr/bin/env python3
"""Task 64 — apply migration_064 (students.extra_groups) to PROD via
Supabase Management API: preflight -> apply -> verify (schema + REST probe).

Needs /home/z/my-project/.secrets/supabase-access-token (was wiped in the
2026-11-25 sandbox rebuild — re-provide it to run this).
Read-only prints: no tokens, no student data.
"""
import json, ssl, urllib.request, urllib.error

REF = 'pbsythpzncjoafpmijyd'
AT = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
SQL = open('/home/z/my-project/supabase/migration_064_multi_group.sql', encoding='utf-8').read()
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
  to_regclass('public.students') as students,
  exists(select 1 from information_schema.columns
         where table_schema='public' and table_name='students'
           and column_name='extra_groups') as already_applied,
  exists(select 1 from information_schema.table_privileges
         where table_schema='public' and table_name='students'
           and grantee='authenticated' and privilege_type='UPDATE') as authed_can_update,
  (select count(*) from public.students) as student_rows;
""")
print(f"PREFLIGHT HTTP {st}: {body[:400]}")
if st not in (200, 201):
    raise SystemExit('preflight failed')
checks = json.loads(body)[0]
if not checks['students'] or not checks['authed_can_update']:
    raise SystemExit('ABORT: students table or authenticated UPDATE grant missing')
if checks['already_applied']:
    print('column already exists — apply step will be a no-op (IF NOT EXISTS)')
else:
    print(f"students rows: {checks['student_rows']} — applying")

# ── APPLY ────────────────────────────────────────────────────────────────────
st, body = query(SQL)
print(f"APPLY HTTP {st}: {body[:500]}")
if st not in (200, 201):
    raise SystemExit('apply failed')

# ── VERIFY ───────────────────────────────────────────────────────────────────
st, body = query("""
select
  exists(select 1 from information_schema.columns
         where table_schema='public' and table_name='students'
           and column_name='extra_groups') as col_exists,
  (select column_default from information_schema.columns
   where table_schema='public' and table_name='students'
     and column_name='extra_groups') as col_default,
  (select data_type from information_schema.columns
   where table_schema='public' and table_name='students'
     and column_name='extra_groups') as col_type,
  exists(select 1 from information_schema.table_privileges
         where table_schema='public' and table_name='students'
           and grantee='authenticated' and privilege_type='SELECT') as authed_can_select;
""")
print(f"VERIFY HTTP {st}: {body[:400]}")
if st != 200:
    raise SystemExit('verify query failed')
v = json.loads(body)[0]
ok = v['col_exists'] and v['col_type'] == 'ARRAY' and v['authed_can_select']
print("schema ok:", ok, v)

# REST probe with the ANON key: before migration PostgREST answers 400
# PGRST204 ("Could not find the 'extra_groups' column"); after, the request
# passes parsing and fails only at RLS (42501) — that difference proves the
# column is visible through the API.
try:
    ANON = open('/tmp/anonkey.txt').read().strip()
except FileNotFoundError:
    ANON = None
if ANON:
    req = urllib.request.Request(f'https://{REF}.supabase.co/rest/v1/students?select=extra_groups&limit=1',
        headers={'apikey': ANON, 'Authorization': f'Bearer {ANON}'})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            print(f"REST probe: HTTP {r.status} (column visible, rows returned)")
    except urllib.error.HTTPError as e:
        msg = e.read().decode('utf-8', 'replace')[:200]
        kind = 'RLS (column EXISTS ✅)' if e.code == 401 and ('row-level security' in msg or '42501' in msg) else f'unexpected: {msg}'
        print(f"REST probe: HTTP {e.code} — {kind}")
else:
    print('REST probe skipped: /tmp/anonkey.txt missing')

print('DONE migration_064')
