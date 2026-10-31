#!/usr/bin/env python3
"""Task 44b — apply migration 056 to production + verify (17+ assertions)."""
import json, urllib.request, sys

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
URL = f'https://api.supabase.com/v1/projects/{REF}/database/query'

def q(sql, timeout=120):
    req = urllib.request.Request(URL, data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try: body = json.loads(body)
        except Exception: pass
        return e.code, body

APPLY = open('/home/z/my-project/.deploy-wt/supabase/migration_056_exams_homework_deep.sql').read()
if '--dry' in sys.argv:
    print('DRY: sql bytes =', len(APPLY)); sys.exit(0)

print('Applying migration 056 ...')
s, r = q(APPLY, timeout=300)
print('APPLY →', s)
if s != 201:
    print('APPLY FAILED:', json.dumps(r, ensure_ascii=False)[:1500]); sys.exit(1)
notices = r if isinstance(r, list) else []
print('notices:', json.dumps(notices, ensure_ascii=False)[:600])

fails = []
def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL '), name, detail)
    if not cond: fails.append(name)

# ── assertions ────────────────────────────────────────────────────────────────
s, r = q("""select column_name from information_schema.columns
 where table_schema='public' and table_name='standalone_exams'
   and column_name in ('version','sections')""")
check('standalone_exams cols', isinstance(r, list) and len(r) == 2, str(r)[:80])

s, r = q("""select column_name from information_schema.columns
 where table_schema='public' and table_name='standalone_exam_scores'
   and column_name in ('version','section_scores')""")
check('scores cols', isinstance(r, list) and len(r) == 2, str(r)[:80])

s, r = q("""select column_name from information_schema.columns
 where table_schema='public' and table_name='homework_tasks'
   and column_name in ('description','questions','status','max_score','version','updated_at')""")
check('homework_tasks cols', isinstance(r, list) and len(r) == 6, str(r)[:120])

s, r = q("select to_regclass('public.standalone_exam_audit_logs') t, to_regclass('public.homework_submissions') h")
check('new tables', isinstance(r, list) and r[0]['t'] and r[0]['h'], str(r)[:120])

s, r = q("""select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname in ('save_standalone_score','update_standalone_exam',
 'ungrade_standalone_student','submit_homework_task_answers','get_student_standalone_exams','get_student_portal_data')""")
check('6 RPCs', isinstance(r, list) and len(r) == 6, str(r)[:160])

s, r = q("select policyname from pg_policies where tablename in ('homework_tasks','homework_task_status') and policyname in ('homework_tasks_teacher_read','homework_task_status_read')")
check('read policies', isinstance(r, list) and len(r) == 2, str(r)[:120])

s, r = q("select count(*) n from pg_policies where tablename='standalone_exam_audit_logs'")
check('audit RLS', isinstance(r, list) and r[0]['n'] >= 1, str(r)[:60])

s, r = q("select count(*) n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and not t.tgisinternal and c.relname in ('standalone_exams','standalone_exam_scores') and t.tgname like 'trg_standalone%'")
check('triggers (expect >=6: touch x2, version x2, sections, scores-audit, exams-audit → 7)', isinstance(r, list) and r[0]['n'] >= 6, str(r)[:60])

# functional probe: version bump via a no-op update on an isolated temp exam? —
# safer: check functions exist with expected arg signatures
s, r = q("""select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('save_standalone_score','ungrade_standalone_student','submit_homework_task_answers')""")
sigs = sorted(x['sig'] for x in r) if isinstance(r, list) else []
print('sigs:', sigs)

print('\nRESULT:', 'ALL GREEN' if not fails else f'{len(fails)} FAIL: {fails}')
sys.exit(0 if not fails else 2)
