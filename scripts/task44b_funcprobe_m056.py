#!/usr/bin/env python3
"""Task 44b — functional probe of migration 056 RPCs on production.
Creates throwaway exam/task/token under a real teacher, exercises every path,
then deletes everything and verifies zero residue."""
import json, urllib.request, uuid as uuidlib

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
URL = f'https://api.supabase.com/v1/projects/{REF}/database/query'

def q(sql):
    req = urllib.request.Request(URL, data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try: body = json.loads(body)
        except Exception: pass
        return e.code, body

def one(sql):
    s, r = q(sql)
    if s != 201 or not isinstance(r, list) or not r:
        raise RuntimeError(f'probe failed {s}: {json.dumps(r, ensure_ascii=False)[:300]}')
    return r[0]

def qa(sql, teacher_id):
    """Run RPC with injected JWT-claims GUC (same transaction) so auth.uid() resolves."""
    claims = json.dumps({'sub': teacher_id, 'role': 'authenticated'})
    return q("select set_config('request.jwt.claims', '%s', true);\n%s" % (claims, sql))

fails = []
def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL '), name, ('' if cond else f'→ {detail}'))
    if not cond: fails.append(name)

# pick an ACTIVE-subscription teacher who owns standalone exams (real workspace)
teacher = one("""select s.teacher_id t, count(*) n from standalone_exams s
  join profiles p on p.id = s.teacher_id
  where p.subscription_status in ('trial','active') and p.subscription_expires_at > now()
  group by 1 order by n desc limit 1""")['t']
# pre-cleanup: remove leftovers from any earlier crashed probe run
q(f"delete from standalone_exams where teacher_id='{teacher}' and title in ('اختبار فني 056','اختبار فني معدل')")
q(f"delete from homework_tasks where teacher_id='{teacher}' and title = 'واجب فني 056'")
student = one(f"select id from students where teacher_id='{teacher}' and archived = false order by created_at limit 1")['id']
print('teacher:', teacher, 'student:', student)

# create a THROWAWAY portal token (valid 20-char format); fall back to the
# student's real token for read-only checks — a real token is NEVER revoked/deleted
own_token = False
s, r = q("insert into student_qr_tokens (student_id, token) values ('{0}', 'test44bfuncprobe0000') returning id".format(student))
if s == 201 and isinstance(r, list) and r:
    token = 'test44bfuncprobe0000'; own_token = True
else:
    print('temp token insert failed:', s, str(r)[:120])
    token = one(f"select token from student_qr_tokens where student_id='{student}' and revoked_at is null limit 1")['token']
print('portal token:', token[:10] + '...', '(own)' if own_token else '(REAL — read-only use)')

exam_id = str(uuidlib.uuid4()); task_id = str(uuidlib.uuid4())
sections = json.dumps([{'name': 'القسم الأول', 'max': 20}, {'name': 'القسم الثاني', 'max': 30}], ensure_ascii=False)

# ── 1) create exam directly (RLS bypassed via management query = postgres role)
s, r = q(f"""insert into standalone_exams (id, teacher_id, title, max_score, sections)
values ('{exam_id}', '{teacher}', 'اختبار فني 056', 50, '{sections}'::jsonb) returning version""")
check('exam created v1', s == 201 and r[0]['version'] == 1, str(r)[:200])

# ── 2) save_standalone_score: partial sections [15, null] → score=15
s, r = qa(f"select save_standalone_score('{exam_id}','{student}', null, '[15, null]'::jsonb, null, 'فني') d", teacher)
d = r[0]['d']
check('partial save → score 15, v1', d['score'] == 15 and d['version'] == 1, json.dumps(d, ensure_ascii=False)[:200])

# ── 3) same again with expected_version=1 → bump to v2, score=35
s, r = qa(f"select save_standalone_score('{exam_id}','{student}', null, '[15, 20]'::jsonb, 1, 'فني') d", teacher)
d = r[0]['d']
check('conflict-free update → 35, v2', d['score'] == 35 and d['version'] == 2, json.dumps(d, ensure_ascii=False)[:200])

# ── 4) stale version → version_conflict
s, r = qa(f"select save_standalone_score('{exam_id}','{student}', null, '[10, 10]'::jsonb, 1, 'فني') d", teacher)
check('stale version rejected', s == 400 and 'version_conflict' in json.dumps(r), f'{s} {str(r)[:150]}')

# ── 5) out-of-range section score rejected
s, r = qa(f"select save_standalone_score('{exam_id}','{student}', null, '[99, 20]'::jsonb, 2, 'فني') d", teacher)
check('section range rejected', s == 400 and 'section_score_out_of_range' in json.dumps(r), f'{s} {str(r)[:150]}')

# ── 6) update_standalone_exam with correct version → bump + audit
s, r = qa(f"select update_standalone_exam('{exam_id}', 1, '{{\"title\":\"اختبار فني معدل\"}}'::jsonb, 'فني') d", teacher)
d = r[0]['d']
check('meta update v2', d['version'] == 2 and d['exam']['title'] == 'اختبار فني معدل', json.dumps(d, ensure_ascii=False)[:200])

# ── 7) stale exam version rejected
s, r = qa(f"select update_standalone_exam('{exam_id}', 1, '{{\"title\":\"x\"}}'::jsonb) d", teacher)
check('stale meta rejected', s == 400 and 'version_conflict' in json.dumps(r), f'{s} {str(r)[:120]}')

# ── 8) audit trail rows exist
s, r = q(f"select change_type, count(*) n from standalone_exam_audit_logs where exam_id='{exam_id}' group by 1 order by 1")
types = {x['change_type']: x['n'] for x in r}
check('audit trail', 'student_score' in types and 'ungrade' not in types and types.get('meta', 0) >= 1, json.dumps(types))

# ── 9) portal hidden while open (055 gate)
s, r = q(f"select get_student_standalone_exams('{token}') d")
check('release gate: open hidden', r[0]['d'] == [], str(r)[:150])

# ── 10) complete → portal shows partial pct (35/50 = 70%) + sections
q(f"update standalone_exams set status='completed' where id='{exam_id}'")
s, r = q(f"select get_student_standalone_exams('{token}') d")
row = r[0]['d'][0]
check('portal pct 70 + grade', row['percentage'] == 70.0 and row['attempted_max'] == 50 and row['sections_count'] == 2,
      json.dumps(row, ensure_ascii=False)[:300])

# ── 11) ungrade → row gone + audit 'ungrade'
s, r = qa(f"select ungrade_standalone_student('{exam_id}','{student}','اختبار إلغاء') d", teacher)
s2, r2 = q(f"select count(*) n from standalone_exam_scores where exam_id='{exam_id}'")
s3, r3 = q(f"select change_type from standalone_exam_audit_logs where exam_id='{exam_id}' and change_type='ungrade'")
check('ungrade', r[0]['d'] is True and r2[0]['n'] == 0 and len(r3) == 1, f'{str(r)[:80]} scores={r2} audit={len(r3)}')

# ── 12) HOMEWORK: task with 2 MCQs + submit
questions = json.dumps([
  {'text': 'كم 2+2؟', 'choices': ['3', '4', '5'], 'correct': 1, 'marks': 5},
  {'text': 'عاصمة مصر؟', 'choices': ['القاهرة', 'أسوان'], 'correct': 0, 'marks': 5},
], ensure_ascii=False)
s, r = q(f"""insert into homework_tasks (id, teacher_id, title, group_name, questions, max_score)
values ('{task_id}', '{teacher}', 'واجب فني 056', null, '{questions}'::jsonb, 10) returning max_score""")
check('task created', s == 201 and float(r[0]['max_score']) == 10, str(r)[:200])

s, r = q(f"select submit_homework_task_answers('{token}','{task_id}','[1,1]'::jsonb) d")
d = r[0]['d']
check('submit: 5/10, 1 correct, results', d['score'] == 5 and d['correct_count'] == 1 and d['results'] == [True, False],
      json.dumps(d, ensure_ascii=False)[:250])

# resubmission (latest wins)
s, r = q(f"select submit_homework_task_answers('{token}','{task_id}','[1,0]'::jsonb) d")
d = r[0]['d']
check('resubmit → 10/10', d['score'] == 10 and d['correct_count'] == 2, json.dumps(d, ensure_ascii=False)[:200])

# invalid choice index rejected
s, r = q(f"select submit_homework_task_answers('{token}','{task_id}','[9,0]'::jsonb) d")
check('invalid choice rejected', s == 400 and 'invalid_answers' in json.dumps(r), f'{s} {str(r)[:120]}')

# ── 13) LEAK CHECK: portal data must NOT contain 'correct'
s, r = q(f"select get_student_portal_data('{token}') d")
blob = json.dumps(r[0]['d'], ensure_ascii=False)
hw = [t for t in r[0]['d']['homework_tasks'] if t['id'] == task_id]
check('portal: task present with questions', len(hw) == 1 and hw[0]['has_questions'] is True and len(hw[0]['questions']) == 2, str(len(hw)))
check('NO answer-key leak', "'correct'" not in json.dumps(hw[0]) and '"correct"' not in json.dumps(hw[0]), 'LEAK!' if 'correct' in json.dumps(hw[0]) else '')
sub = hw[0]['submission']
check('portal submission summary', sub and sub['score'] == 10 and sub['question_count'] == 2, json.dumps(sub, ensure_ascii=False)[:150])

# ── 14) closed task rejected
q(f"update homework_tasks set status='closed' where id='{task_id}'")
s, r = q(f"select submit_homework_task_answers('{token}','{task_id}','[0,0]'::jsonb) d")
check('closed task rejected', s == 400 and 'task_closed' in json.dumps(r), f'{s} {str(r)[:120]}')

# ── 15) revoked token rejected (only with our throwaway token — NEVER a real one)
if own_token:
    q(f"update student_qr_tokens set revoked_at = now() where token = '{token}'")
    s, r = q(f"select submit_homework_task_answers('{token}','{task_id}','[0,0]'::jsonb) d")
    check('revoked token rejected', s == 400 and 'invalid_token' in json.dumps(r), f'{s} {str(r)[:120]}')
else:
    print('SKIP revoked-token test (real token in use — never revoked)')

# ── CLEANUP + residue check (token deleted only if it was our throwaway)
q(f"delete from homework_tasks where id='{task_id}'")
if own_token:
    q(f"delete from student_qr_tokens where token='{token}'")
q(f"delete from standalone_exams where id='{exam_id}'")
s, r = q(f"""select
 (select count(*) from standalone_exams where id='{exam_id}') e,
 (select count(*) from standalone_exam_audit_logs where exam_id='{exam_id}') a,
 (select count(*) from homework_tasks where id='{task_id}') t,
 (select count(*) from homework_submissions where task_id='{task_id}') s2,
 (select count(*) from student_qr_tokens where token='{token}') tok""")
res = r[0]
check('zero residue', all(v == 0 for v in res.values()), json.dumps(res))

print('\nRESULT:', 'ALL GREEN' if not fails else f'{len(fails)} FAIL: {fails}')
