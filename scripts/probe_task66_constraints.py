#!/usr/bin/env python3
"""Read-only probe: constraints for group_schedule/exam_scores/attendance_records,
incoming FKs on students, teacher_notification_events columns, profiles count."""
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
select c.relname, con.conname, pg_get_constraintdef(con.oid)
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('group_schedule','exam_scores','attendance_records','teacher_notification_events')
""")
print('== constraints ==')
for r in cur.fetchall():
    print('  ', r[0], '|', r[1], '|', r[2][:150])

cur.execute("""
select c.relname, con.conname, pg_get_constraintdef(con.oid)
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and pg_get_constraintdef(con.oid) like '%students%'
  and con.contype = 'f'
""")
print('== FKs referencing students ==')
for r in cur.fetchall():
    print('  ', r[0], '|', r[1], '|', r[2][:150])

cur.execute("select column_name, data_type from information_schema.columns where table_schema='public' and table_name='teacher_notification_events' order by ordinal_position")
print('== teacher_notification_events ==')
print(cur.fetchall())

cur.execute("select count(*) from profiles")
print('== profiles count ==', cur.fetchone()[0])

cur.close(); conn.close()
