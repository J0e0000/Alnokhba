#!/usr/bin/env python3
"""Task 44i — inspect prod state:
1) Was the 44g broadcast actually sent? (row counts by title)
2) RLS policies on teacher_notification_events (does UPDATE work for team members?)
3) profiles columns (created_at? owner/team columns?)
4) Events older than their teacher's profile creation — the «old messages» bug sample.
"""
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
        body = e.read().decode(errors='replace')[:500]
        raise RuntimeError(f'HTTP {e.code}: {body}') from e

def show(label, sql, limit=3000):
    try:
        print(f'--- {label} ---', flush=True)
        print(json.dumps(q(sql), ensure_ascii=False)[:limit], flush=True)
    except Exception as e:
        print(label, 'ERR', e, flush=True)

show('broadcast_teacher_rows', "select count(*) n, min(created_at) first_at from teacher_notification_events where title like '🎉 تحديث جديد%'")
show('broadcast_student_rows', "select count(*) n from student_notifications where title like '🎉 تحديث جديد%'")
show('events_policies', "select policyname, cmd, qual, with_check from pg_policies where tablename='teacher_notification_events'")
show('profiles_cols', "select column_name, data_type from information_schema.columns where table_name='profiles' order by ordinal_position")
show('events_vs_profile_age', """
select count(*) filter (where e.created_at < p.created_at) as events_before_own_profile,
       count(*) total
from teacher_notification_events e
join profiles p on p.id = (select auth_owner_placeholder from (select null::uuid as auth_owner_placeholder) x where false)
limit 1
""") if False else None

# events that predate the profile they are addressed to (impossible for solo, possible for shared/center accounts)
show('events_before_profile_created', """
select count(*) n from teacher_notification_events e
join profiles p on p.id = e.teacher_id
where e.created_at < p.created_at
""")
show('events_sample_old', """
select e.teacher_id, p.created_at as profile_created, min(e.created_at) as oldest_event, count(*) n
from teacher_notification_events e join profiles p on p.id = e.teacher_id
group by e.teacher_id, p.created_at
order by oldest_event asc
limit 8
""")
show('profiles_count', "select count(*) n from profiles")
show('team_columns_hint', "select column_name from information_schema.columns where table_name='profiles' and (column_name like '%owner%' or column_name like '%center%' or column_name like '%team%')")
