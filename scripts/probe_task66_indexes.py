#!/usr/bin/env python3
"""Read-only probe: columns + unique indexes of the per-student record tables
that must be re-pointed when merging duplicate students."""
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

TABLES = ['homework_task_status', 'homework_submissions', 'homework_quiz_submissions',
          'standalone_exam_scores', 'online_exam_attempts', 'student_payments', 'behavior_logs']
cur.execute("""
select table_name, column_name from information_schema.columns
where table_schema='public' and table_name = any(%s)
order by table_name, ordinal_position
""", (TABLES,))
by = {}
for t, c in cur.fetchall():
    by.setdefault(t, []).append(c)
for t in TABLES:
    print(f'{t}: {by.get(t, [])}')

cur.execute("""
select tablename, indexname, indexdef from pg_indexes
where schemaname='public'
  and tablename in ('attendance_records','exam_scores','standalone_exam_scores','online_exam_attempts',
                    'homework_task_status','homework_submissions','homework_quiz_submissions')
  and indexdef ilike '%unique%'
""")
print('== unique indexes ==')
for r in cur.fetchall():
    print('  ', r[0], '|', r[1], '|', r[2][:170])

cur.close(); conn.close()
