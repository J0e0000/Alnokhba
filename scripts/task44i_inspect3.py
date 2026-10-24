#!/usr/bin/env python3
"""Task 44i inspect #3 — can_access_workspace def + trigger fn on teacher_notification_events."""
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

show('can_access_workspace', "select pg_get_functiondef(oid) from pg_proc where proname='can_access_workspace'")
show('fns_touching_events', """
select proname, pg_get_functiondef(oid)
from pg_proc
where prosrc ilike '%teacher_notification_events%'
order by proname
""", limit=9000)
