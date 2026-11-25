#!/usr/bin/env python3
"""Task 65 — apply migration_065 (lesson_sessions.extra_dates + merge_groups RPC)
to PRODUCTION via direct Postgres (pooler). Idempotent. Prints no secrets."""
import pathlib, sys

REF, PW = None, None
for line in pathlib.Path('/home/z/my-project/.secrets/alnokhba-db.env').read_text().splitlines():
    if line.startswith('SUPABASE_REF='):
        REF = line.split('=', 1)[1].strip()
    if line.startswith('SUPABASE_DB_PASSWORD='):
        PW = line.split('=', 1)[1].strip()
if not (REF and PW):
    sys.exit('missing SUPABASE_REF / SUPABASE_DB_PASSWORD')

import psycopg2, ssl, urllib.request, urllib.error

REGIONS = ['eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'us-east-1', 'us-east-2',
           'us-west-1', 'us-west-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-south-1',
           'ap-northeast-1', 'ap-northeast-2', 'sa-east-1', 'eu-north-1', 'me-central-1']

conn = None
used = None
for label, dsn in [('direct-ipv6', f'postgresql://postgres:{PW}@db.{REF}.supabase.co:5432/postgres')] + \
                  [(f'pooler-{p}-{r}', f'postgresql://postgres.{REF}:{PW}@{p}-{r}.pooler.supabase.com:5432/postgres')
                   for p in ('aws-0', 'aws-1', 'aws-2') for r in REGIONS]:
    try:
        conn = psycopg2.connect(dsn, sslmode='require', connect_timeout=8, application_name='nokhba-task65')
        used = label
        break
    except Exception:
        continue
if conn is None:
    sys.exit('ABORT: no connection')
print(f'CONNECTED via {used}')
cur = conn.cursor()

sql = pathlib.Path('/home/z/my-project/supabase/migration_065_extra_dates_merge.sql').read_text(encoding='utf-8')
cur.execute(sql)
conn.commit()
print('APPLY executed')

cur.execute("""
select
  exists(select 1 from information_schema.columns where table_schema='public'
         and table_name='lesson_sessions' and column_name='extra_dates'),
  (select data_type from information_schema.columns where table_schema='public'
   and table_name='lesson_sessions' and column_name='extra_dates'),
  (select column_default from information_schema.columns where table_schema='public'
   and table_name='lesson_sessions' and column_name='extra_dates'),
  exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'merge_groups'),
  exists(select 1 from information_schema.routine_privileges where routine_schema='public'
         and routine_name='merge_groups' and grantee='authenticated' and privilege_type='EXECUTE')
""")
col, dtype, dflt, fn, grant = cur.fetchone()
print(f'VERIFY col={col} type={dtype} default={dflt} fn={fn} authed_execute={grant}')

try:
    ANON = pathlib.Path('/tmp/anonkey.txt').read_text().strip()
except FileNotFoundError:
    ANON = None
if ANON:
    req = urllib.request.Request(f'https://{REF}.supabase.co/rest/v1/lesson_sessions?select=extra_dates&limit=1',
        headers={'apikey': ANON, 'Authorization': f'Bearer {ANON}'})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ssl.create_default_context()) as r:
            print(f'REST probe: HTTP {r.status} (column visible)')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')[:140]
        tag = 'RLS (column EXISTS)' if '42501' in body or 'row-level security' in body else 'unexpected'
        print(f'REST probe: HTTP {e.code} — {tag}')

ok = col and dtype == 'ARRAY' and fn and grant
print('RESULT:', 'MIGRATION_065_OK' if ok else 'CHECK_FAILED')
cur.close(); conn.close()
