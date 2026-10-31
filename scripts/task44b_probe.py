#!/usr/bin/env python3
"""Task 44b probe — prod DB state for exams/homework/QB tables + columns."""
import json, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
URL = f'https://api.supabase.com/v1/projects/{REF}/database/query'

def q(sql):
    req = urllib.request.Request(URL, data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]

# 1) columns of the tables we care about
cols = q("""
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and table_name in ('homework_tasks','homework_task_status','qb_questions','qb_exams','exams','exam_scores','standalone_exams','standalone_exam_scores')
order by table_name, ordinal_position""")
print('=== COLUMNS ===')
if isinstance(cols[1], list):
    cur = None
    for c in cols[1]:
        if c['table_name'] != cur:
            cur = c['table_name']; print(f"\n[{cur}]")
        print(f"  {c['column_name']} {c['data_type']}{' NULL' if c['is_nullable']=='YES' else ''}{' DEF ' + str(c['column_default'])[:40] if c['column_default'] else ''}")
else:
    print(cols)

# 2) row counts
for t in ['homework_tasks','homework_task_status','qb_questions','qb_exams','exams','exam_scores','standalone_exams','standalone_exam_scores']:
    s, r = q(f'select count(*) n from public.{t}')
    print(f"{t}: {r if isinstance(r,int) or isinstance(r,list) else r}" if s != 200 else f"{t}: {r[0]['n']}")

# 3) exams table columns + a sample of grade-related columns
s, r = q("""select column_name from information_schema.columns where table_schema='public' and table_name='exams' order by ordinal_position""")
print('\n=== exams cols ===', [c['column_name'] for c in r] if isinstance(r, list) else r)

# 4) homework_tasks sample row
s, r = q('select * from public.homework_tasks limit 2')
print('\n=== homework_tasks sample ===', json.dumps(r, ensure_ascii=False)[:800] if isinstance(r, list) else r)
s, r = q('select * from public.homework_task_status limit 2')
print('\n=== homework_task_status sample ===', json.dumps(r, ensure_ascii=False)[:600] if isinstance(r, list) else r)
s, r = q('select * from public.qb_questions limit 1')
print('\n=== qb_questions sample ===', json.dumps(r, ensure_ascii=False)[:900] if isinstance(r, list) else r)
s, r = q('select * from public.qb_exams limit 1')
print('\n=== qb_exams sample ===', json.dumps(r, ensure_ascii=False)[:900] if isinstance(r, list) else r)
