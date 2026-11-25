#!/usr/bin/env python3
"""Task 64 — apply migration_064 (students.extra_groups) to PRODUCTION via a
direct Postgres connection (password from .secrets/alnokhba-db.env, gitignored).
Direct host is IPv6-only; falls back to the Supabase session pooler (IPv4)
across candidate regions. Preflight -> apply -> verify. Prints no secrets.
Idempotent: the migration uses ADD COLUMN IF NOT EXISTS.
"""
import json, pathlib, ssl, sys, urllib.error, urllib.request

REF, PW = None, None
for line in pathlib.Path('/home/z/my-project/.secrets/alnokhba-db.env').read_text().splitlines():
    if line.startswith('SUPABASE_REF='):
        REF = line.split('=', 1)[1].strip()
    if line.startswith('SUPABASE_DB_PASSWORD='):
        PW = line.split('=', 1)[1].strip()
if not (REF and PW):
    sys.exit('missing SUPABASE_REF / SUPABASE_DB_PASSWORD')

import psycopg2

REGIONS = ['eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'us-east-1', 'us-east-2',
           'us-west-1', 'us-west-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-south-1',
           'ap-northeast-1', 'ap-northeast-2', 'sa-east-1', 'eu-north-1', 'me-central-1']

def candidates():
    yield 'direct-ipv6', f'postgresql://postgres:{PW}@db.{REF}.supabase.co:5432/postgres'
    for prefix in ('aws-0', 'aws-1', 'aws-2'):
        for r in REGIONS:
            yield f'pooler-{prefix}-{r}', f'postgresql://postgres.{REF}:{PW}@{prefix}-{r}.pooler.supabase.com:5432/postgres'

conn = None
used = None
for label, dsn in candidates():
    try:
        conn = psycopg2.connect(dsn, sslmode='require', connect_timeout=8, application_name='nokhba-task64')
        used = label
        break
    except Exception as e:
        print(f'connect {label}: failed ({type(e).__name__})')
if conn is None:
    sys.exit('ABORT: could not connect via any candidate')

print(f'CONNECTED via {used}')
cur = conn.cursor()

def q(sql, args=None):
    cur.execute(sql, args)
    if cur.description:
        return cur.fetchall()
    conn.commit()
    return []

# ── PREFLIGHT ────────────────────────────────────────────────────────────────
(students_ok, already, authed_update, n_rows) = q("""
select
  to_regclass('public.students') is not null,
  exists(select 1 from information_schema.columns where table_schema='public'
         and table_name='students' and column_name='extra_groups'),
  exists(select 1 from information_schema.table_privileges where table_schema='public'
         and table_name='students' and grantee='authenticated' and privilege_type='UPDATE'),
  (select count(*) from public.students)
""")[0]
print(f'PREFLIGHT students={students_ok} already_applied={already} authed_update={authed_update} rows={n_rows}')
if not students_ok:
    sys.exit('ABORT: students table missing')

# ── APPLY ────────────────────────────────────────────────────────────────────
sql = pathlib.Path('/home/z/my-project/supabase/migration_064_multi_group.sql').read_text(encoding='utf-8')
cur.execute(sql)
conn.commit()
print('APPLY executed')

# ── VERIFY (schema) ──────────────────────────────────────────────────────────
(col, dtype, dflt, authed_select) = q("""
select
  exists(select 1 from information_schema.columns where table_schema='public'
         and table_name='students' and column_name='extra_groups'),
  (select data_type from information_schema.columns where table_schema='public'
   and table_name='students' and column_name='extra_groups'),
  (select column_default from information_schema.columns where table_schema='public'
   and table_name='students' and column_name='extra_groups'),
  exists(select 1 from information_schema.table_privileges where table_schema='public'
         and table_name='students' and grantee='authenticated' and privilege_type='SELECT')
""")[0]
print(f'VERIFY col={col} type={dtype} default={dflt} authed_select={authed_select}')
ok = col and dtype == 'ARRAY' and authed_select

# ── VERIFY (REST view — proves the frontend gate will flip) ─────────────────
# anon probe: BEFORE migration PostgREST answered 42703 "column does not
# exist"; after, parsing passes and RLS (42501/401) or empty 200 is returned.
try:
    ANON = pathlib.Path('/tmp/anonkey.txt').read_text().strip()
except FileNotFoundError:
    ANON = None
if ANON:
    req = urllib.request.Request(f'https://{REF}.supabase.co/rest/v1/students?select=extra_groups&limit=1',
        headers={'apikey': ANON, 'Authorization': f'Bearer {ANON}'})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ssl.create_default_context()) as r:
            print(f'REST probe: HTTP {r.status} (column visible, rows/empty)')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')[:160]
        tag = 'RLS (column EXISTS ✅)' if '42501' in body or 'row-level security' in body else 'unexpected'
        print(f'REST probe: HTTP {e.code} — {tag} | {body[:120]}')
else:
    print('REST probe skipped (no /tmp/anonkey.txt)')

print('RESULT:', 'MIGRATION_064_OK' if ok else 'CHECK_FAILED')
cur.close(); conn.close()
