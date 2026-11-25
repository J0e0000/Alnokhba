#!/usr/bin/env python3
"""Task 66 — apply migration_066 (merge_groups v2: duplicate-student unification
+ schedule mode) to PRODUCTION via direct Postgres. Idempotent (create or
replace). Prints no secrets."""
import pathlib, sys

REF, PW = None, None
for line in pathlib.Path('/home/z/my-project/.secrets/alnokhba-db.env').read_text().splitlines():
    if line.startswith('SUPABASE_REF='):
        REF = line.split('=', 1)[1].strip()
    if line.startswith('SUPABASE_DB_PASSWORD='):
        PW = line.split('=', 1)[1].strip()
if not (REF and PW):
    sys.exit('missing SUPABASE_REF / SUPABASE_DB_PASSWORD')

import psycopg2

REGIONS = ['eu-north-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'us-east-1', 'us-east-2',
           'us-west-1', 'us-west-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-south-1',
           'ap-northeast-1', 'ap-northeast-2', 'sa-east-1', 'me-central-1']

conn = None
used = None
for label, dsn in [('direct-ipv6', f'postgresql://postgres:{PW}@db.{REF}.supabase.co:5432/postgres')] + \
                  [(f'pooler-{p}-{r}', f'postgresql://postgres.{REF}:{PW}@{p}-{r}.pooler.supabase.com:5432/postgres')
                   for p in ('aws-0', 'aws-1', 'aws-2') for r in REGIONS]:
    try:
        conn = psycopg2.connect(dsn, sslmode='require', connect_timeout=8, application_name='nokhba-task66')
        used = label
        break
    except Exception:
        continue
if conn is None:
    sys.exit('ABORT: no connection')
print(f'CONNECTED via {used}')
cur = conn.cursor()

sql = pathlib.Path('/home/z/my-project/supabase/migration_066_merge_v2.sql').read_text(encoding='utf-8')
cur.execute(sql)
conn.commit()
print('APPLY executed')

# drop the old 4-arg v1 (migration_065) so every call hits the v2 (dedup+mode)
cur.execute("drop function if exists public.merge_groups(uuid, text, text, text);")
conn.commit()
print('OLD v1 signature dropped')

cur.execute("""
select
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='merge_groups' and pronargs=5) like '%merged_duplicates%' as v2_body,
  (select proargnames from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='merge_groups' and pronargs=5),
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='merge_groups'),
  exists(select 1 from information_schema.routine_privileges where routine_schema='public'
         and routine_name='merge_groups' and grantee='authenticated' and privilege_type='EXECUTE')
""")
body_v2, args, n_overloads, grant = cur.fetchone()
print(f'VERIFY v2_body={body_v2} args={args} overloads={n_overloads} authed_execute={grant}')

ok = bool(body_v2) and 'p_schedule_mode' in (args or []) and n_overloads == 1 and grant
print('RESULT:', 'MIGRATION_066_OK' if ok else 'CHECK_FAILED')
cur.close(); conn.close()
