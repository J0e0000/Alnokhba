#!/usr/bin/env python3
"""Audit follow-up probe — READ-ONLY. Checks legacy-UUID portal fallback
safety (students without unrevoked token rows) + workspace member state."""
import json, urllib.request, urllib.error

BASE = 'https://api.supabase.com/v1'
REF = 'pbsythpzncjoafpmijyd'


def api(method, path, body=None, timeout=120):
    tok = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        'authorization': f'Bearer {tok}', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


def sql(q):
    st, b = api('POST', f'/projects/{REF}/database/query', {'query': q})
    print(f'[{st}]', json.dumps(b)[:600] if st in (200, 201) else b)
    return b


sql("select count(*) as total_students, count(*) filter (where not exists (select 1 from student_qr_tokens t where t.student_id = s.id)) as no_token_row, count(*) filter (where exists (select 1 from student_qr_tokens t where t.student_id = s.id and t.revoked_at is null)) as has_live_token from students s")
sql("select count(*) as revoked_tokens from student_qr_tokens where revoked_at is not null")
sql("select wm.member_id, p.account_type, p.role from workspace_members wm join profiles p on p.id = wm.member_id limit 10")
