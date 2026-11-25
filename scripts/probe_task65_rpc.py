#!/usr/bin/env python3
"""Read-only probe: teacher_settings columns + upsert_lesson_attendance source
(attendance_date semantics) + lesson_sessions RLS policies + sample extra check."""
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

cur.execute("select column_name, data_type from information_schema.columns where table_schema='public' and table_name='teacher_settings' order by ordinal_position")
print('== teacher_settings ==')
print(cur.fetchall())

cur.execute("select proname, prosrc from pg_proc join pg_namespace n on n.oid = pronamespace where nspname='public' and proname in ('upsert_lesson_attendance','upsert_lesson_homework','finalize_lesson_session')")
print('== rpc sources ==')
for name, src in cur.fetchall():
    print(f'--- {name} ---')
    print((src or '')[:1400])

cur.execute("select policyname, cmd, qual from pg_policies where schemaname='public' and tablename='lesson_sessions'")
print('== lesson_sessions policies ==')
for r in cur.fetchall():
    print(r[0], '|', r[1], '|', (r[2] or '')[:120])

cur.close(); conn.close()
