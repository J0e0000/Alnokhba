#!/usr/bin/env python3
"""Dump live function definitions for migration 055 anchored patching."""
import json, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
URL = f'https://api.supabase.com/v1/projects/{REF}/database/query'

def q(sql):
    req = urllib.request.Request(
        URL, data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

fns = [
    'get_student_standalone_exams(text)',
    'get_student_portal_access(text)',
    'mark_all_notifications_read(text)',
    'register_student_push_subscription(text,text,text,text,text)',
    'upsert_lesson_homework(uuid,uuid,text)',
    'admin_restore_apply(uuid,uuid,jsonb,text)',
]
out = {}
for fn in fns:
    rows = q(f"select pg_get_functiondef('{fn}'::regprocedure) d")
    out[fn] = rows[0]['d']
    # also grab ACLs to preserve grants exactly
    acl = q(f"select proacl::text a from pg_proc where oid::regprocedure::text = '{fn}'")
    out[fn + ' #ACL'] = acl[0]['a'] if acl else '?'
    print(f"{fn}: len={len(out[fn])} acl={out[fn + ' #ACL']}")

with open('/home/z/my-project/scripts/task44_live_defs.json', 'w') as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print('saved -> scripts/task44_live_defs.json')
