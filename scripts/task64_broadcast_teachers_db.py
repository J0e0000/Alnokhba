#!/usr/bin/env python3
"""Task 64 — ONE-TIME broadcast to EVERY teacher account on the platform:
insert one teacher_notification_events row per profile (the DB trigger
auto-queues web push). Idempotent by title guard, so re-running never
duplicates. Connection via .secrets/alnokhba-db.env (gitignored, never printed).
"""
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

REGIONS = ['eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'us-east-1', 'us-east-2',
           'us-west-1', 'us-west-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-south-1',
           'ap-northeast-1', 'ap-northeast-2', 'sa-east-1', 'eu-north-1', 'me-central-1']

def connect():
    for label, dsn in [('direct-ipv6', f'postgresql://postgres:{PW}@db.{REF}.supabase.co:5432/postgres')] + \
                      [(f'pooler-{p}-{r}', f'postgresql://postgres.{REF}:{PW}@{p}-{r}.pooler.supabase.com:5432/postgres')
                       for p in ('aws-0', 'aws-1', 'aws-2') for r in REGIONS]:
        try:
            return psycopg2.connect(dsn, sslmode='require', connect_timeout=8, application_name='nokhba-task64-broadcast'), label
        except Exception:
            continue
    sys.exit('ABORT: no connection')

TITLE = '✨ تحديث جديد — نفس الطالب في أكثر من مجموعة'
BODY = (
    'ميزة جديدة وصلت:\n'
    '• من شاشة الطلاب افتح تعديل أي طالب (أو إضافة طالب جديد) وستجد قسم '
    '«مجموعات إضافية» — اختر أي مجموعة أخرى وسيظهر الطالب في الحصص والواجبات '
    'والامتحانات والتقارير لكل مجموعاته معًا.\n'
    '• المجموعة الأساسية تبقى هي المرجع لمرحلة الطالب، والمجموعات الإضافية '
    'توسّع ظهوره فقط.\n'
    '• الحضور والنقاط تُسجَّل لكل مجموعة حسب حصتها كما هي.\n'
    '• إعادة تسمية أو حذف أي مجموعة تتحدث تلقائيًا عند كل الطلاب المضافين لها.\n'
    'كذلك عند رصد رسالة أو واجب أو امتحان على مجموعة معينة سيشمله الطالب '
    'المضاف لها كمجموعة إضافية.'
)
esc = lambda s: s.replace("'", "''")

conn, used = connect()
cur = conn.cursor()
print(f'CONNECTED via {used}')

def q(sql):
    cur.execute(sql)
    if cur.description:
        return cur.fetchall()
    conn.commit()
    return []

# sanity: trigger that auto-queues web push exists on this table
trig = q("select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid "
         "where c.relname = 'teacher_notification_events' and not t.tgisinternal")[0]
print('triggers on teacher_notification_events:', [r[0] for r in trig])

before_p = q('select count(*) from public.profiles')[0][0]
t_exist = q(f"select count(*) from public.teacher_notification_events where title = '{esc(TITLE)}'")[0][0]
print(f'profiles={before_p} existing_title_rows={t_exist}')

if t_exist < before_p:
    inserted = q(
        "insert into public.teacher_notification_events (teacher_id, event_type, title, body, category) "
        f"select id, 'other', '{esc(TITLE)}', '{esc(BODY)}', 'announcement' from public.profiles "
        "where id not in (select teacher_id from public.teacher_notification_events where title = '" + esc(TITLE) + "') "
        "returning id"
    )
    conn.commit()
    print('inserted:', len(inserted))
else:
    print('already complete — skip (one-time guard)')

t_final = q(f"select count(*) from public.teacher_notification_events where title = '{esc(TITLE)}'")[0][0]
try:
    jobs = q("select count(*) from public.push_notification_jobs where created_at > now() - interval '10 minutes'")[0][0]
except Exception:
    jobs = '?'
print(f'FINAL title_rows={t_final}/{before_p} | recent push jobs queued: {jobs}')
print('RESULT:', 'BROADCAST_OK' if t_final >= before_p else 'CHECK_FAILED')
cur.close(); conn.close()
