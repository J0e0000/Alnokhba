#!/usr/bin/env python3
"""Apply migration 058 (homework UX polish) to production via Management API."""
import json, sys, time, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
BASE = f'https://api.supabase.com/v1/projects/{REF}'
SQL = open('/home/z/my-project/supabase/migration_058_homework_ux.sql').read()


def q(sql, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(
                f'{BASE}/database/query', data=json.dumps({'query': sql}).encode(),
                method='POST',
                headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception as e:
            body = ''
            try:
                body = e.read().decode()[:400]
            except Exception:
                pass
            print(f'  attempt {i+1} failed: {e} {body}')
            if i == tries - 1:
                raise
            time.sleep(3)


print('== Applying migration 058 ==')
res = q('set check_function_bodies = false;\n' + SQL)
print('apply ok:', res if res else 'OK (201/200)')

# ── VERIFY ──────────────────────────────────────────────────────────────
print('== Verify ==')
FAIL = 0


def check(name, ok, extra=''):
    global FAIL
    print(('PASS  ' if ok else 'FAIL  ') + name, extra)
    if not ok:
        FAIL += 1


cols = q("select column_name from information_schema.columns where table_schema='public' "
         "and ((table_name='homework_tasks' and column_name='video_url') "
         "or (table_name='homework_submissions' and column_name='results'))")
check('new columns (video_url + results)', len(cols) == 2, f'n={len(cols)}')

fn = q("select prosrc from pg_proc where proname='submit_homework_task_answers'")
src = fn[0]['prosrc'] if fn else ''
check('submit RPC: already_submitted branch', 'already_submitted' in src)
check('submit RPC: auto-record via _upsert_attendance_day', '_upsert_attendance_day' in src)
check('submit RPC: no upsert-overwrite anymore', 'do update' not in src)

fn2 = q("select prosrc from pg_proc where proname='get_student_portal_data'")
src2 = fn2[0]['prosrc'] if fn2 else ''
check('portal RPC: results projected', 'results', ) if False else None
check('portal RPC: results projected', "'results', v_sub.results" in src2)
check('portal RPC: video_url gated by submission', "case when v_sub.id is not null then ht.video_url else null end" in src2)
check('portal RPC: correct key never leaked', src2.count("q->>'correct'") == 0 and "'correct'" not in src2.split('homework_tasks')[1].split('v_homework_status')[0] if 'v_homework_status' in src2 else False)

# smoke: call submit with garbage token → must raise invalid_token (P0001)
try:
    req = urllib.request.Request(
        f'{BASE}/database/query', data=json.dumps({'query': "select public.submit_homework_task_answers('totally-invalid-token', gen_random_uuid(), '[]'::jsonb)"}).encode(),
        method='POST', headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        json.load(r)
    check('submit RPC rejects bad token', False, 'no exception raised')
except urllib.error.HTTPError as e:
    body = e.read().decode()
    check('submit RPC rejects bad token', 'invalid_token' in body, f'HTTP {e.code}')

print(f'RESULT: {"ALL GREEN" if FAIL == 0 else f"{FAIL} FAILURES"}')
sys.exit(1 if FAIL else 0)
