#!/usr/bin/env python3
"""Read-only schema probe of production: tables + key columns for the
sessions/attendance/groups/students surface. Prints no data, no secrets."""
import pathlib, sys

REF, PW = None, None
for line in pathlib.Path('/home/z/my-project/.secrets/alnokhba-db.env').read_text().splitlines():
    if line.startswith('SUPABASE_REF='):
        REF = line.split('=', 1)[1].strip()
    if line.startswith('SUPABASE_DB_PASSWORD='):
        PW = line.split('=', 1)[1].strip()
import psycopg2

REGIONS = ['eu-north-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'us-east-1', 'us-east-2',
           'us-west-1', 'us-west-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-south-1',
           'ap-northeast-1', 'ap-northeast-2', 'sa-east-1', 'me-central-1']
conn = None
for label, dsn in [('direct-ipv6', f'postgresql://postgres:{PW}@db.{REF}.supabase.co:5432/postgres')] + \
                  [(f'pooler-{p}-{r}', f'postgresql://postgres.{REF}:{PW}@{p}-{r}.pooler.supabase.com:5432/postgres')
                   for p in ('aws-0', 'aws-1', 'aws-2') for r in REGIONS]:
    try:
        conn = psycopg2.connect(dsn, sslmode='require', connect_timeout=6); break
    except Exception:
        continue
if conn is None:
    sys.exit('no connection')
cur = conn.cursor()

cur.execute("""
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position
""")
rows = cur.fetchall()
bytable = {}
for t, c, d, n, df in rows:
    bytable.setdefault(t, []).append(f'{c} {d}{"" if n == "YES" else " NN"}' + (f' default={df}' if df else ''))
for t in sorted(bytable):
    print(f'== {t} ==')
    for line in bytable[t]:
        print('  ', line)

# row counts (scale awareness for merge ops)
cur.execute("""
select relname, n_live_tup from pg_stat_user_tables
where relname in ('sessions','attendance','groups','students','homeworks','exams','messages','payments')
order by relname
""")
print('== row counts ==')
print(cur.fetchall())

# check constraints / uniques on sessions & attendance that constrain dates
cur.execute("""
select c.relname, con.conname, pg_get_constraintdef(con.oid)
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('sessions','attendance','groups')
""")
print('== constraints ==')
for r in cur.fetchall():
    print('  ', r[0], '|', r[1], '|', r[2][:160])

cur.close(); conn.close()
