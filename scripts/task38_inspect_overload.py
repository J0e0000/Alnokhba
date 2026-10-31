#!/usr/bin/env python3
import json, urllib.request, urllib.error
BASE = 'https://api.supabase.com/v1'; REF = 'pbsythpzncjoafpmijyd'
tok = open('.secrets/supabase-access-token').read().strip()
def sql(q):
    req = urllib.request.Request(BASE + f'/projects/{REF}/database/query',
        data=json.dumps({'query': q}).encode(), method='POST',
        headers={'authorization': f'Bearer {tok}', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, '(unreadable)'
st, res = sql("""
select p.oid::regprocedure::text as sig, p.prosecdef as secdef,
       (select string_agg(x, ', ') from unnest(proargtypes::oid[]) g(x), pg_type t where t.oid=g.x) is not null as ok
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='admin_log_audit'""")
print('admin_log_audit overloads ->', st)
if isinstance(res, list):
    for r in res: print(' ', r)
else:
    print(' ', res)
