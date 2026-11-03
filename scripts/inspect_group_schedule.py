#!/usr/bin/env python3
"""Inspect group_schedule schema + data (Management API)."""
import json, urllib.request, urllib.error

AT = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()

def query(sql):
    req = urllib.request.Request('https://api.supabase.com/v1/projects/pbsythpzncjoafpmijyd/database/query',
        method='POST', headers={'Authorization': f'Bearer {AT}', 'Content-Type': 'application/json'},
        data=json.dumps({'query': sql}).encode())
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')[:400]

st, cols = query("select column_name, data_type from information_schema.columns where table_name='group_schedule' order by ordinal_position")
print(f"group_schedule columns (HTTP {st}):")
if st in (200, 201):
    for c in cols:
        print(f"   {c['column_name']}: {c['data_type']}")
    st, rows = query('select * from group_schedule order by teacher_id limit 8')
    print(f"\nsample rows (HTTP {st}):")
    for r in (rows if isinstance(rows, list) else [])[:8]:
        print('  ', json.dumps(r, ensure_ascii=False)[:220])
    st, dist = query("select coalesce(stage,'␀') as stage, count(*) from group_schedule group by 1 order by 2 desc limit 12")
    print(f"\nstage distribution (HTTP {st}):", json.dumps(dist, ensure_ascii=False)[:400])
    st, dist = query("select count(distinct teacher_id) teachers, count(*) rows_total from group_schedule")
    print("totals:", json.dumps(dist, ensure_ascii=False))
else:
    print(cols)
