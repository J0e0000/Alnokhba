#!/usr/bin/env python3
"""Task 44i inspect #2 — push job plumbing + echo-row counts + user's current bell view."""
import json, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'

def q(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")[:400]}') from e

def show(label, sql, limit=4000):
    try:
        print(f'--- {label} ---', flush=True)
        print(json.dumps(q(sql), ensure_ascii=False)[:limit], flush=True)
    except Exception as e:
        print(label, 'ERR', e, flush=True)

show('push_job_columns', "select column_name from information_schema.columns where table_name='push_notification_jobs' order by ordinal_position")
show('push_job_fn', "select pg_get_functiondef(oid) from pg_proc where proname='teacher_notification_push_job'")
show('echo_counts', """
select
  count(*) filter (where related_student_id is not null and title like '🎉 تحديث جديد%') as broadcast_echoes,
  count(*) filter (where related_student_id is not null and title = '📚 في واجب نزل') as hw_echoes,
  count(*) filter (where related_student_id is not null and title = '📝 امتحان أونلاين نزل') as exam_echoes,
  count(*) filter (where related_student_id is null and title like '🎉 تحديث جديد%') as real_teacher_broadcasts,
  count(*) as total_events
from teacher_notification_events
""")
show('bell_now_oldest_teacher', """
select title, event_type, is_read, created_at
from teacher_notification_events
where teacher_id = '8e2acae6-38d1-45bc-a5cf-8633e638ac1a'
order by created_at desc limit 12
""")
show('is_unread_ratio', "select count(*) filter (where not is_read) unread, count(*) total from teacher_notification_events")
