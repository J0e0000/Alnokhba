#!/usr/bin/env python3
"""Verify new Supabase access token + re-check migration-054 security posture (7 assertions)."""
import json, sys, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
BASE = f'https://api.supabase.com/v1/projects/{REF}/database/query'


def q(sql):
    req = urllib.request.Request(
        BASE, data=json.dumps({'query': sql}).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


PASS, FAIL = 0, 0


def check(name, ok, extra=''):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f'PASS  {name} {extra}')
    else:
        FAIL += 1
        print(f'FAIL  {name} {extra}')


# 1) connection works
try:
    v = q('select 1 as ok')
    check('connection', v and v[0]['ok'] == 1)
except Exception as e:
    print('CONNECTION FAILED:', e)
    sys.exit(1)

# 2) teacher_id indexes on exam_scores / attendance_records / behavior_logs
idx = q("select indexname, tablename from pg_indexes where schemaname='public' and indexname in "
        "('idx_exam_scores_teacher_created','idx_attendance_teacher','idx_behavior_teacher_created')")
tabs = {r['tablename'] for r in idx}
check('teacher_id indexes (3 tables)', tabs == {'exam_scores', 'attendance_records', 'behavior_logs'}, f'found={sorted(tabs)}')

# 3) get_accounts_summary locked down: no anon in proacl, search_path set
p = q("select proacl::text acl, proconfig::text cfg from pg_proc where proname='get_accounts_summary' limit 1")
acl = p[0]['acl'] or ''
cfg = p[0]['cfg'] or ''
check('get_accounts_summary no-anon', 'anon' not in acl)
check('get_accounts_summary search_path', 'search_path' in cfg)

# 4) the 6 RPCs exist
rpcs = q("select proname from pg_proc where pronamespace='public'::regnamespace and proname in "
         "('get_student_portal_data','get_student_standalone_exams','mark_notification_read',"
         "'upsert_lesson_attendance','upsert_lesson_homework','link_assistant_by_email')")
have = {r['proname'] for r in rpcs}
check('6 RPCs present', len(have) == 6, f'have={sorted(have)}')

# 5) students archive columns (migration 053)
cols = q("select column_name from information_schema.columns where table_schema='public' and table_name='students' "
         "and column_name in ('archived','archived_at','archived_reason','auto_archive_marker')")
check('students archive columns (4)', len(cols) == 4, f"n={len(cols)}")

# 6) highest migration marker: standalone exams tables exist
t = q("select table_name from information_schema.tables where table_schema='public' "
      "and table_name in ('standalone_exams','standalone_exam_scores','admin_audit_logs','edge_rate_limits')")
check('m049+m051 tables', len(t) == 4, f"n={len(t)}")

# 7) demo/prod sanity: students count queryable
s = q('select count(*)::int c from students')
check('students queryable', s[0]['c'] > 0, f"count={s[0]['c']}")

print(f'RESULT: {PASS} pass / {FAIL} fail')
sys.exit(1 if FAIL else 0)
