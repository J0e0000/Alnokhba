#!/usr/bin/env python3
"""Task 44 — apply migration_055 (homework MCQ quizzes) to production via Management API."""
import json, sys, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
SQL_PATH = '/home/z/my-project/supabase/migration_055_homework_quizzes.sql'


def query(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


sql = open(SQL_PATH).read()
print(f'Applying {SQL_PATH} ({len(sql)} bytes)…')
try:
    res = query(sql)
    print('APPLY RESULT:', json.dumps(res, ensure_ascii=False)[:2000])
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print('APPLY FAILED HTTP', e.code, ':', body[:3000])
    sys.exit(1)

# ── verification ──
ok = True
v = query("select table_name from information_schema.tables where table_schema='public' "
          "and table_name in ('homework_quizzes','homework_quiz_questions','homework_quiz_submissions')")
names = {r['table_name'] for r in v}
print('tables:', sorted(names))
ok &= len(names) == 3

v = query("select column_name from information_schema.columns where table_schema='public' "
          "and table_name='attendance_records' and column_name='homework_grade'")
ok &= len(v) == 1
print('attendance_records.homework_grade:', 'present' if v else 'MISSING')

v = query("select proname from pg_proc where pronamespace='public'::regnamespace "
          "and proname in ('get_homework_quiz_public','submit_homework_quiz','sync_homework_quiz_results','hw_quiz_result_json')")
procs = {r['proname'] for r in v}
print('rpcs:', sorted(procs))
ok &= len(procs) == 4

v = query("select p.polname, c.relname as tablename from pg_policy p "
          "join pg_class c on c.oid = p.polrelid "
          "join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' "
          "and c.relname in ('homework_quizzes','homework_quiz_questions','homework_quiz_submissions')")
print('policies:', [(r['tablename'], r['polname']) for r in v])
ok &= len(v) == 3

v = query("select conname from pg_constraint where conrelid = 'public.homework_quiz_submissions'::regclass "
          "and conname in ('homework_quiz_submissions_student_uniq','homework_quiz_submissions_device_uniq')")
print('unique constraints:', [r['conname'] for r in v])
ok &= len(v) == 2

v = query("select count(*)::int c from students where teacher_id is not null")
print('students still sane:', v[0]['c'])

print('RESULT:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
