#!/usr/bin/env python3
"""Task 44i inspect #4 — did ANY update ever land on teacher_notification_events? RLS on? push trigger fn?"""
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

def show(label, sql, limit=5000):
    try:
        print(f'--- {label} ---', flush=True)
        print(json.dumps(q(sql), ensure_ascii=False, indent=1)[:limit], flush=True)
    except Exception as e:
        print(label, 'ERR', e, flush=True)

show('tuple_stats', """
select relname, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup
from pg_stat_user_tables where relname in ('teacher_notification_events','student_notifications')
""")
show('rls_enabled', "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname='teacher_notification_events'")
show('teacher_push_trigger', """
select tgname, pg_get_triggerdef(t.oid)
from pg_trigger t
where tgrelid = 'teacher_notification_events'::regclass and not t.tgisinternal
""")
show('fns_enqueue_push_jobs', """
select proname, pg_get_functiondef(oid)
from pg_proc
where prosrc ilike '%push_notification_jobs%' and proname ilike '%teacher%'
""", limit=6000)
show('profiles_sub_status', "select subscription_status, count(*) from profiles group by 1")
