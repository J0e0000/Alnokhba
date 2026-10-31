#!/usr/bin/env python3
"""Task 44 pre-implementation probe: verify claims against LIVE production DB."""
import json, urllib.request, re

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
URL = f'https://api.supabase.com/v1/projects/{REF}/database/query'

def q(sql):
    req = urllib.request.Request(
        URL, data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

print('=== 1. policies on homework tables (leak check) ===')
for r in q("select tablename, policyname, cmd, roles from pg_policies where tablename in ('homework_tasks','homework_task_status') order by 1,2"):
    print(' ', r)

print('=== 2. lesson_session_id columns exist in prod? ===')
for r in q("select table_name, column_name from information_schema.columns where table_name in ('exams','exam_scores') and column_name='lesson_session_id'"):
    print(' ', r)

print('=== 3. standalone dirty data: score > max_score ===')
print(' ', q("select count(*) n from standalone_exam_scores s join standalone_exams e on e.id=s.exam_id where s.score > e.max_score"))

print('=== 4. homework_status distinct values in prod ===')
for r in q("select homework_status, count(*) n from attendance_records group by 1 order by 2 desc limit 8"):
    print(' ', r)

print('=== 5. students.hw_status distinct values ===')
for r in q("select hw_status, count(*) n from students group by 1 order by 2 desc limit 8"):
    print(' ', r)

print('=== 6. unique indexes on attendance_records ===')
for r in q("select indexname, indexdef from pg_indexes where tablename='attendance_records' and indexdef ilike '%unique%'"):
    print(' ', r['indexname'])

print('=== 7. existing triggers on standalone tables ===')
for r in q("select event_object_table, trigger_name from information_schema.triggers where event_object_table in ('standalone_exams','standalone_exam_scores')"):
    print(' ', r)

print('=== 8. admin_restore_apply v_tables (current allowlist) ===')
r = q("select oid::regprocedure::text sig from pg_proc where proname='admin_restore_apply'")
if not r:
    print('  admin_restore_apply NOT FOUND')
else:
    sig = r[0]['sig']
    print('  signature:', sig)
    body = q(f"select pg_get_functiondef('{sig}'::regprocedure) d")[0]['d']
    m = re.search(r'v_tables[^=]*=\s*ARRAY\[([^\]]+)\]', body, re.S)
    print('  v_tables:', (m.group(1)[:600].replace(chr(10),' ') if m else body[:300]))

print('=== 8b. support_read_homework_tasks policy definition ===')
for r in q("select policyname, cmd, qual from pg_policies where policyname='support_read_homework_tasks'"):
    print(' ', r['cmd'], '| qual:', r['qual'][:300])

print('=== 9. portal RPC fallback shapes (revoked-check presence) ===')
for fn in ("select oid::regprocedure::text sig from pg_proc where proname in ('get_student_portal_access','mark_all_notifications_read','register_student_push_subscription') order by 1",):
    r = q(fn)
    for row in r:
        sig = row['sig']
        body = q(f"select pg_get_functiondef('{sig}'::regprocedure) d")[0]['d']
        print(f"  {sig}: revoked-check={'revoked_at is not null' in body} len={len(body)}")

print('=== 10. get_student_standalone_exams: does it filter by status? ===')
r = q("select pg_get_functiondef('get_student_standalone_exams(text)'::regprocedure) d")
body = r[0]['d']
print('  filters completed:', "status = 'completed'" in body or "status='completed'" in body, '| len:', len(body))

print('=== 11. upsert_lesson_homework: enum check + hw_status sync? ===')
r = q("select pg_get_functiondef('upsert_lesson_homework(uuid,uuid,text)'::regprocedure) d")
body = r[0]['d']
print('  has enum whitelist:', 'مكتمل' in body and ('any' in body.lower() or 'in (' in body), '| syncs students.hw_status:', 'update students' in body, '| len:', len(body))

print('=== 12. exam_score bounds: existing checks on exam_scores ===')
for r in q("select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid='exam_scores'::regclass and contype='c'"):
    print(' ', r)
for r in q("select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid='standalone_exam_scores'::regclass and contype='c'"):
    print(' ', r)
