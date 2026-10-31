#!/usr/bin/env python3
"""Post-apply verification for migration 055 (catalog + functional, zero residue)."""
import json, urllib.request, sys

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
URL = f'https://api.supabase.com/v1/projects/{REF}/database/query'

def q(sql, expect_error=None):
    req = urllib.request.Request(
        URL, data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode()), None
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')
        if expect_error and expect_error in body:
            return e.code, None, body
        return e.code, None, body

ok = fail = 0
def check(name, cond, detail=''):
    global ok, fail
    if cond: ok += 1; print(f'  PASS {name} {detail}')
    else:    fail += 1; print(f'  FAIL {name} {detail}')

# 1. columns + indexes
s, rows, _ = q("select column_name from information_schema.columns where table_name in ('exams','exam_scores') and column_name='lesson_session_id'")
check('lesson_session_id columns', len(rows) == 2, f'-> {len(rows)}/2')
s, rows, _ = q("select indexname from pg_indexes where indexname in ('idx_exams_lesson','idx_exam_scores_lesson')")
check('2 new indexes', len(rows) == 2)

# 2. triggers + guard functions (information_schema lists one row PER EVENT —
#    the scores trigger covers insert+update = 2 rows; count distinct names)
s, rows, _ = q("select distinct trigger_name from information_schema.triggers where trigger_name in ('trg_standalone_scores_bounds','trg_standalone_exam_max_guard')")
check('2 bounds triggers', len(rows) == 2, f'-> {sorted(r["trigger_name"] for r in rows)}')

# 3. standalone RPC release gate
s, rows, _ = q("select pg_get_functiondef('get_student_standalone_exams(text)'::regprocedure) d")
check('standalone RPC filters completed', "e.status = 'completed'" in rows[0]['d'])
check('standalone RPC keeps 054 revocation guard', 'revoked_at is not null' in rows[0]['d'])

# 4. three fallback revocation patches
for fn, sig in (('get_student_portal_access', 'get_student_portal_access(text)'),
                ('mark_all_notifications_read', 'mark_all_notifications_read(text)'),
                ('register_student_push_subscription', 'register_student_push_subscription(text,text,text,text,text)')):
    s, rows, _ = q(f"select pg_get_functiondef('{sig}'::regprocedure) d")
    n = rows[0]['d'].count('revoked_at is not null')
    # active-token path uses 'revoked_at is null'; the NEW fallback clause is
    # the 'is not null' NOT-EXISTS — 1 occurrence proves the patch is in
    check(f'{fn}: revocation in fallback', n >= 1, f'(fallback clause occurrences={n})')

# 5. homework enum + sync
s, rows, _ = q("select pg_get_functiondef('upsert_lesson_homework(uuid,uuid,text)'::regprocedure) d")
d = rows[0]['d']
check('homework enum whitelist', 'لم يرصد' in d and 'invalid_homework_status' in d and d.count('raise exception') >= 4)
check('hw_status sync restored', 'update public.students' in d and 'hw_status = p_homework_status' in d)

# 6. restore allowlist
s, rows, _ = q("select pg_get_functiondef('admin_restore_apply(uuid,uuid,jsonb,text)'::regprocedure) d")
d = rows[0]['d']
check('restore allowlist += 3 tables', all(t in d for t in ('homework_task_status', 'standalone_exams', 'standalone_exam_scores')))

# 7. day-attendance RPC + grants
s, rows, _ = q("select proacl::text a from pg_proc where proname='upsert_student_day_attendance'")
check('day-attendance RPC exists', len(rows) == 1)
check('day-attendance not granted to anon', rows and 'anon' not in rows[0]['a'], f"acl={rows[0]['a'][:80]}")

# 8. FUNCTIONAL: bounds trigger rejects score > max (single txn → auto rollback, zero residue)
s, pair, _ = q("select es.exam_id, es.student_id from standalone_exam_scores es join standalone_exams e on e.id=es.exam_id limit 1")
if pair:
    eid, sid = pair[0]['exam_id'], pair[0]['student_id']
    code, _, err = q(f"insert into standalone_exam_scores (teacher_id, exam_id, student_id, score) select teacher_id, '{eid}', '{sid}', 99999 from standalone_exams where id='{eid}'", expect_error='score_exceeds_max')
    check('trigger rejects score>max', code == 400 and err and 'score_exceeds_max' in err)
    s, cnt, _ = q(f"select count(*) n from standalone_exam_scores where exam_id='{eid}' and student_id='{sid}' and score=99999")
    check('no residue from rejected insert', cnt[0]['n'] == 0)
else:
    check('trigger rejects score>max (no exam rows to test with)', False, 'SKIP — no standalone exams in prod')

# 9. FUNCTIONAL: day-attendance guard rejects foreign student
code, _, err = q("select public.upsert_student_day_attendance('11111111-1111-1111-1111-111111111111','حاضر')", expect_error='student_not_found')
check('day RPC rejects unknown student', code == 400 and err and 'student_not_found' in err)

# 10. FUNCTIONAL: standalone RPC still callable with junk token (empty result, not error)
#     jsonb arrives parsed — the value may be [] (list) or '[]' depending on driver
s, rows, _ = q("select public.get_student_standalone_exams('nonexistent-token-junk')")
val = rows[0]['get_student_standalone_exams'] if rows else None
check('standalone RPC junk token -> []', val in ([], '[]'), f'-> {val!r}')

print(f'\nRESULT: {ok} pass / {fail} fail')
sys.exit(1 if fail else 0)
