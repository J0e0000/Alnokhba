#!/usr/bin/env python3
"""Re-verify migration 054 artifacts on production (audit follow-up)."""
import json, urllib.request, sys

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
URL = f'https://api.supabase.com/v1/projects/{REF}/database/query'

def q(sql):
    req = urllib.request.Request(
        URL, data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')[:300]
        print(f'  HTTP {e.code} on query: {body}')
        raise

ok = fail = 0
def check(name, cond, detail=''):
    global ok, fail
    if cond: ok += 1;  print(f'  PASS {name} {detail}')
    else:    fail += 1; print(f'  FAIL {name} {detail}')

# 1. Hot-path indexes from 054 (PF2)
for tbl in ('exam_scores', 'attendance_records', 'behavior_logs'):
    s, rows = q(f"select indexname from pg_indexes where tablename='{tbl}' and indexdef ilike '%teacher_id%'")
    names = [r['indexname'] for r in rows]
    check(f'index on {tbl}', len(names) > 0, f'-> {names}')

# 2. get_accounts_summary locked down (S2): no anon grant, search_path pinned
s, rows = q("select proacl::text acl, proconfig::text cfg from pg_proc where proname='get_accounts_summary'")
if rows:
    acl, cfg = rows[0]['acl'], rows[0]['cfg']
    check('get_accounts_summary not granted to anon', 'anon' not in acl, f'acl={acl[:90]}')
    check('get_accounts_summary search_path pinned', 'search_path' in cfg, f'cfg={cfg[:90]}')
else:
    check('get_accounts_summary exists', False)

# 3. Portal RPCs exist and are callable-shaped (S4/S9 scope)
s, rows = q("select proname from pg_proc where proname in ('get_student_portal_data','get_student_standalone_exams','mark_notification_read','upsert_lesson_attendance','upsert_lesson_homework','link_assistant_by_email')")
got = sorted(r['proname'] for r in rows)
need = sorted(['get_student_portal_data','get_student_standalone_exams','mark_notification_read','upsert_lesson_attendance','upsert_lesson_homework','link_assistant_by_email'])
check('portal/workspace RPCs present (6)', got == need, f'-> {got}')

# 4. Migration 053 archive columns still present
s, rows = q("select column_name from information_schema.columns where table_name='students' and column_name in ('archived','archived_at','archived_reason','auto_archive_marker')")
check('students archive columns (4)', len(rows) == 4, f'-> {sorted(r["column_name"] for r in rows)}')

print(f'\nRESULT: {ok} pass / {fail} fail')
sys.exit(1 if fail else 0)
