#!/usr/bin/env python3
"""End-to-end test of get_student_stage_schedule with a REAL portal token (read-only)."""
import json, ssl, urllib.request, urllib.error

REF = 'pbsythpzncjoafpmijyd'
AT = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
ANON = open('/tmp/anonkey.txt').read().strip()
ctx = ssl.create_default_context()

def query(sql):
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query',
        method='POST', headers={'Authorization': f'Bearer {AT}', 'Content-Type': 'application/json'},
        data=json.dumps({'query': sql}).encode())
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))

# find a student with a live token + a stage, whose teacher has group_schedule rows
rows = query("""
select q.token, s.name, s.stage as student_stage, s.group_name, s.teacher_id,
  (select count(*) from group_schedule gs where gs.teacher_id = s.teacher_id) as sched_rows,
  (select count(*) from groups g where g.teacher_id = s.teacher_id) as groups_n
from student_qr_tokens q
join students s on s.id = q.student_id
where q.revoked_at is null and coalesce(s.stage,'') <> ''
  and exists(select 1 from group_schedule gs where gs.teacher_id = s.teacher_id)
limit 3;
""")
print(f"candidates: {len(rows)}")
for r in rows:
    print(f"  {r['name']!r} stage={r['student_stage']!r} group={r['group_name']!r} sched={r['sched_rows']} groups={r['groups_n']} token={r['token'][:8]}…")

def rpc(token):
    req = urllib.request.Request(f'https://{REF}.supabase.co/rest/v1/rpc/get_student_stage_schedule',
        method='POST', headers={'apikey': ANON, 'Authorization': f'Bearer {ANON}',
        'Content-Type': 'application/json'}, data=json.dumps({'p_token': token}).encode())
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return json.loads(r.read().decode())

for r in rows[:2]:
    out = rpc(r['token'])
    sched = out.get('schedule') if isinstance(out, dict) else out
    n = len(sched) if isinstance(sched, list) else sched
    print(f"\nRPC for {r['name']!r}: stage={out.get('stage')!r} category={out.get('category')!r} schedule_rows={n}")
    if isinstance(sched, list) and sched:
        print("  sample:", json.dumps(sched[:4], ensure_ascii=False))
