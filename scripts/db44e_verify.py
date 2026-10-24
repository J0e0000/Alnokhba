#!/usr/bin/env python3
"""Task 44e — inspect broadcast targets (v2)."""
import json, sys, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'

def q(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def show(label, sql):
    try:
        print(label, json.dumps(q(sql), ensure_ascii=False)[:600], flush=True)
    except Exception as e:
        print(label, 'ERR', e, flush=True)

show('tne_cols:', "select column_name from information_schema.columns where table_schema='public' and table_name='teacher_notification_events' order by ordinal_position")
show('sn_cols:', "select column_name from information_schema.columns where table_schema='public' and table_name='student_notifications' order by ordinal_position")
show('profiles:', "select column_name from information_schema.columns where table_schema='public' and table_name='profiles' order by ordinal_position")
show('students_per_teacher:', "select teacher_id, count(*) n from students where archived_at is null group by teacher_id order by n desc limit 6")
show('profiles_roles:', "select role, count(*) from profiles group by role")
show('portal_students:', "select count(*) n from students where portal_token is not null and archived_at is null")
